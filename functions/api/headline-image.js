// Cloudflare Pages Function — fetches a real stock photo for one boiled-
// down headline in builder.html's "swipe today's headlines" path, via
// Unsplash's Search Photos API. Replaces an earlier OpenAI gpt-image-1
// generation attempt: the citizen explicitly asked for real photos from a
// public source instead of AI-generated illustrations, and search is free
// where generation had a real per-image cost.
//
// Unsplash's API Guidelines require two things this function honors:
// attribution (the response carries the photographer's name + profile
// link and the photo's own page link, which the client displays under the
// image) and a "download" tracking ping (`links.download_location`) fired
// once per photo actually shown to a citizen, not per search query.
//
// NOTE: Unsplash's free/demo application tier caps at 50 requests/hour —
// fine for development and modest traffic, but a live app with real usage
// should apply for Unsplash's Production tier
// (unsplash.com/oauth/applications) to lift that cap. Nothing here needs
// to change when that upgrade happens — same Access Key either way.

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // a headline's photo never needs to change
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 2;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilMidnightUTC() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(1, Math.round((midnight.getTime() - now.getTime()) / 1000));
}

// djb2 — good enough for a cache key, not a security boundary.
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.UNSPLASH_ACCESS_KEY;
  if (!apiKey) {
    return json({ error: { message: 'Server is missing UNSPLASH_ACCESS_KEY — set it in the Cloudflare Pages project env vars.' } }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const query = body && body.query;
  if (!query || typeof query !== 'string') {
    return json({ error: { message: 'Missing "query" string in request body' } }, 400);
  }

  const kv = env.DIG_KV;
  const cacheKey = `photocache:${hash(query)}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json(Object.assign({}, cached, { cached: true }));
    } catch (e) {
      // fall through to a live search on a storage hiccup
    }
  }

  // No cost to guard here (Unsplash search is free), but the shared Access
  // Key's hourly quota is a real shared resource — a modest per-IP daily
  // cap keeps one visitor from burning through it alone.
  const dailyLimitPerIp = Number(env.PHOTO_DAILY_LIMIT_PER_IP || 40);
  const day = todayKey();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = `photorate:${ip}:${day}`;

  let rateRecord = { count: 0 };
  if (kv) {
    try {
      rateRecord = (await kv.get(rateKey, { type: 'json' })) || { count: 0 };
    } catch (e) {
      rateRecord = { count: 0 };
    }
  }

  if (rateRecord.count >= dailyLimitPerIp) {
    return json(
      { error: { message: `Daily limit of ${dailyLimitPerIp} photos reached for this visitor — resets at UTC midnight.` } },
      429,
      { 'retry-after': String(secondsUntilMidnightUTC()) }
    );
  }

  if (kv) {
    try {
      await kv.put(rateKey, JSON.stringify({ count: (rateRecord.count || 0) + 1 }), { expirationTtl: COUNTER_TTL_SECONDS });
    } catch (e) {}
  }

  let res;
  try {
    res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=squarish&content_filter=high`,
      { headers: { Authorization: `Client-ID ${apiKey}` } }
    );
  } catch (e) {
    return json({ error: { message: 'Could not reach Unsplash API' } }, 502);
  }

  if (!res.ok) {
    const text = await res.text();
    return json({ error: { message: `Unsplash returned HTTP ${res.status}: ${text.slice(0, 200)}` } }, res.status);
  }

  const data = await res.json();
  const photo = data.results && data.results[0];
  if (!photo) {
    return json({ error: { message: 'No photo found for this query' } }, 404);
  }

  // Best-effort, never blocks the response — Unsplash's guideline is to
  // ping this once a photo is actually shown to an end user, not per
  // search, so this call is where "actually shown" happens.
  if (photo.links && photo.links.download_location) {
    fetch(`${photo.links.download_location}&client_id=${encodeURIComponent(apiKey)}`).catch(() => {});
  }

  const payload = {
    image: photo.urls.small,
    photographerName: photo.user.name,
    photographerUrl: `${photo.user.links.html}?utm_source=civix&utm_medium=referral`,
    photoUrl: `${photo.links.html}?utm_source=civix&utm_medium=referral`
  };

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (e) {}
  }

  return json(Object.assign({}, payload, { cached: false }));
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {})
  });
}

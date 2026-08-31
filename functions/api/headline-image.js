// Cloudflare Pages Function — generates the illustration for one boiled-
// down headline in builder.html's "swipe today's headlines" path. Holds
// the OpenAI key server-side (CiViX's first non-Anthropic AI vendor) and
// mirrors dig-check.js's daily-budget / per-IP-rate-limit shape, since
// image generation is meaningfully more expensive per call than a text
// check. The one addition dig-check.js doesn't need: a persistent cache
// keyed by the prompt itself, in DIG_KV — every citizen who swipes through
// the same cached headline batch (headlines.js caches for 30 minutes)
// reuses the same generated image instead of re-paying for it.

const IMAGE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // a headline's image never needs to change
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
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({ error: { message: 'Server is missing OPENAI_API_KEY — set it in the Cloudflare Pages project env vars.' } }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const prompt = body && body.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return json({ error: { message: 'Missing "prompt" string in request body' } }, 400);
  }

  const kv = env.DIG_KV;
  const cacheKey = `imgcache:${hash(prompt)}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json({ image: cached.image, cached: true });
    } catch (e) {
      // fall through to a live generation on a storage hiccup
    }
  }

  const dailyBudget = Number(env.IMAGE_DAILY_BUDGET_USD || 5);
  const dailyLimitPerIp = Number(env.IMAGE_DAILY_LIMIT_PER_IP || 20);
  const costPerImage = Number(env.IMAGE_COST_USD || 0.02); // flat estimate — tune once real billing is visible
  const day = todayKey();

  let record = { spent: 0 };
  if (kv) {
    try {
      record = (await kv.get(`imgusage:${day}`, { type: 'json' })) || { spent: 0 };
    } catch (e) {
      record = { spent: 0 };
    }
  }

  if (record.spent >= dailyBudget) {
    return json(
      { error: { message: `Daily image budget of $${dailyBudget} reached — resets at UTC midnight. Try again tomorrow.` } },
      402
    );
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = `imgrate:${ip}:${day}`;
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
      { error: { message: `Daily limit of ${dailyLimitPerIp} images reached for this visitor — resets at UTC midnight.` } },
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
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1024x1024',
        quality: 'low',
        n: 1
      })
    });
  } catch (e) {
    return json({ error: { message: 'Could not reach OpenAI API' } }, 502);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return json({ error: { message: 'OpenAI returned an unparseable response' } }, 502);
  }

  if (!res.ok) {
    return json({ error: { message: (data.error && data.error.message) || `OpenAI returned HTTP ${res.status}` } }, res.status);
  }

  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) {
    return json({ error: { message: 'OpenAI response had no image data' } }, 502);
  }

  const image = `data:image/png;base64,${b64}`;

  if (kv) {
    try {
      await kv.put(`imgusage:${day}`, JSON.stringify({ spent: (record.spent || 0) + costPerImage }), { expirationTtl: COUNTER_TTL_SECONDS });
    } catch (e) {}
    try {
      await kv.put(cacheKey, JSON.stringify({ image, at: Date.now() }), { expirationTtl: IMAGE_CACHE_TTL_SECONDS });
    } catch (e) {}
  }

  return json({ image, cached: false });
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {})
  });
}

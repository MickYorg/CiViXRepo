// Cloudflare Pages Function — looks up a visitor's representatives by ZIP
// via the 5calls API (https://apidocs.5calls.org/representatives), same
// pattern as dig-check.js and calendar.js: holds the token server-side,
// caches in the shared DIG_KV namespace so repeat lookups for a ZIP (or a
// second visitor in the same area) don't re-hit 5calls.

const CACHE_TTL_SECONDS = 60 * 60 * 24; // reps rarely change day to day

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const zip = (url.searchParams.get('zip') || '').trim();
  if (!/^\d{5}(-?\d{4})?$/.test(zip)) {
    return json({ error: { message: 'Missing or invalid "zip" query param' } }, 400);
  }

  const cacheKey = 'reps:' + zip;
  const kv = env.DIG_KV;
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json(cached);
    } catch (e) {
      // fall through to a live fetch on a storage hiccup
    }
  }

  const token = env.FIVECALLS_API_TOKEN;
  if (!token) {
    return json(
      { error: { message: 'Server is missing FIVECALLS_API_TOKEN — set it in the Cloudflare Pages project env vars.' } },
      500
    );
  }

  let res;
  try {
    res = await fetch('https://api.5calls.org/v1/representatives?location=' + encodeURIComponent(zip), {
      headers: { 'X-5Calls-Token': token }
    });
  } catch (e) {
    return json({ error: { message: 'Could not reach 5calls' } }, 502);
  }

  if (!res.ok) {
    return json({ error: { message: `5calls returned HTTP ${res.status}` } }, 502);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return json({ error: { message: '5calls returned an unparseable response' } }, 502);
  }

  // Federal only, matching the calendar slice — state/local reps aren't
  // matched against anything CiViX shows yet.
  const reps = (data.representatives || [])
    .filter(r => r.area === 'US House' || r.area === 'US Senate')
    .map(r => ({
      id: r.id,
      name: r.name,
      party: r.party || '',
      phone: r.phone || '',
      area: r.area,
      state: r.state || data.state || '',
      district: r.district || data.district || '',
      photoURL: r.photoURL || '',
      url: r.url || ''
    }));

  const payload = { zip, lowAccuracy: !!data.lowAccuracy, reps };

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (e) {
      // best-effort
    }
  }

  return json(payload);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

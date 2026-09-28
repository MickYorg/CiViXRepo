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
    return json({ error: { message: 'Could not reach 5calls' } }, 500);
  }

  if (!res.ok) {
    // 5calls can't place US territories (Puerto Rico, Guam, the Virgin
    // Islands...) or ZIPs it doesn't know; say that, not a raw HTTP code.
    return json({ error: { message: failureMessage(res.status, zip) } }, 500);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return json({ error: { message: '5calls returned an unparseable response' } }, 500);
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
      district: r.area === 'US Senate' ? '' : (r.district || data.district || ''),
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

// Puerto Rico and the Virgin Islands (006-009), Guam and the Northern
// Mariana Islands (969), American Samoa (96799). 967/968 are Hawaii.
export function failureMessage(status, zip) {
  if (status !== 400) return `5calls returned HTTP ${status}`;
  return /^(00[6-9]|969|96799)/.test(zip)
    ? "CiViX can't look up representatives for US territories yet."
    : "CiViX couldn't place that ZIP. Check it in your manifesto.";
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

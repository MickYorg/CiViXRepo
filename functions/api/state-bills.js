// Cloudflare Pages Function — state legislative slice of the calendar,
// same pattern as calendar.js (federal) and reps.js. OpenStates covers all
// 50 states' legislatures the way congress.gov covers Congress. Takes a
// ZIP (what the profile already has — no separate state field) and
// resolves it to a state server-side via Zippopotam.us, a free, keyless
// ZIP lookup, so the frontend doesn't need its own ZIP-to-state table.

const ZIP_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // ZIP->state is effectively static
const BILLS_CACHE_TTL_SECONDS = 60 * 60; // 1 hour, matching calendar.js
const BILL_LIMIT = 20;

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const zip = (url.searchParams.get('zip') || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return json({ error: { message: 'Missing or invalid "zip" query param' } }, 400);
  }

  const kv = env.DIG_KV;

  let state = null;
  if (kv) {
    try { state = await kv.get('zipstate:' + zip); } catch (e) {}
  }
  if (!state) {
    let geoRes;
    try {
      geoRes = await fetch('https://api.zippopotam.us/us/' + zip);
    } catch (e) {
      return json({ error: { message: 'Could not resolve a state for that ZIP' } }, 502);
    }
    if (!geoRes.ok) {
      return json({ error: { message: geoRes.status === 404 ? 'Unrecognized ZIP code' : 'Could not resolve a state for that ZIP' } }, geoRes.status === 404 ? 404 : 502);
    }
    const geo = await geoRes.json();
    const place = geo.places && geo.places[0];
    if (!place || !place.state) {
      return json({ error: { message: 'Could not resolve a state for that ZIP' } }, 502);
    }
    state = place.state; // full name, e.g. "California" — what OpenStates' jurisdiction filter wants
    if (kv) {
      try { await kv.put('zipstate:' + zip, state, { expirationTtl: ZIP_CACHE_TTL_SECONDS }); } catch (e) {}
    }
  }

  const cacheKey = 'statebills:' + state;
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json(Object.assign({ state }, cached));
    } catch (e) {}
  }

  const apiKey = env.OPENSTATES_API_KEY;
  if (!apiKey) {
    return json(
      { error: { message: 'Server is missing OPENSTATES_API_KEY — set it in the Cloudflare Pages project env vars.' } },
      500
    );
  }

  const billsUrl = 'https://v3.openstates.org/bills?jurisdiction=' + encodeURIComponent(state) +
    '&sort=updated_desc&per_page=' + BILL_LIMIT + '&apikey=' + encodeURIComponent(apiKey);

  let res;
  try {
    res = await fetch(billsUrl);
  } catch (e) {
    return json({ error: { message: 'Could not reach Open States' } }, 502);
  }
  if (!res.ok) {
    return json({ error: { message: `Open States returned HTTP ${res.status}` } }, 502);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return json({ error: { message: 'Open States returned an unparseable response' } }, 502);
  }

  const bills = (data.results || []).map(b => ({
    identifier: b.identifier,
    title: b.title,
    session: b.session,
    latestAction: b.latest_action_description
      ? { date: b.latest_action_date, text: b.latest_action_description }
      : null,
    updateDate: b.updated_at,
    url: b.openstates_url
  }));

  const payload = { bills, fetchedAt: Date.now() };
  if (kv) {
    try { await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: BILLS_CACHE_TTL_SECONDS }); } catch (e) {}
  }

  return json(Object.assign({ state }, payload));
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

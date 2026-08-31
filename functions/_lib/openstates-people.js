// Shared OpenStates "who represents this location" resolver — used by
// both /api/state-reps (the rep picker) and /api/send-state-email (which
// re-derives the real recipient address server-side rather than trusting
// whatever a client sends, so it can't become an open relay to arbitrary
// addresses).
//
// OpenStates' /people.geo endpoint (v3) takes lat/lng and returns BOTH
// state legislators and members of Congress for that point — filtered
// here to state legislators only (jurisdiction.classification === 'state'),
// since federal representation already has its own canonical source
// (5calls, via reps.js) and this app shouldn't grow two divergent
// federal-rep lists. Unlike 5calls' federal data, OpenStates' Person
// object carries a real `email` field whenever a state publishes one —
// that's what makes a genuine one-button send possible for state
// legislators where it isn't for Congress.

const ZIP_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // ZIP->coordinates is effectively static
const REPS_CACHE_TTL_SECONDS = 60 * 60 * 24; // legislator rosters change rarely

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function resolveZipToLatLng(zip, kv) {
  const cacheKey = 'zipgeo:' + zip;
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return cached;
    } catch (e) {
      // fall through to a live lookup on a storage hiccup
    }
  }
  let res;
  try {
    res = await fetch('https://api.zippopotam.us/us/' + zip);
  } catch (e) {
    throw apiError('Could not resolve that ZIP', 502);
  }
  if (!res.ok) {
    throw apiError(res.status === 404 ? 'Unrecognized ZIP code' : 'Could not resolve that ZIP', res.status === 404 ? 404 : 502);
  }
  const geo = await res.json();
  const place = geo.places && geo.places[0];
  if (!place || !place.latitude || !place.longitude) {
    throw apiError('Could not resolve coordinates for that ZIP', 502);
  }
  const result = { lat: place.latitude, lng: place.longitude, state: place.state, city: place['place name'] };
  if (kv) {
    try { await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: ZIP_CACHE_TTL_SECONDS }); } catch (e) {}
  }
  return result;
}

function slimPerson(p) {
  const office = (p.offices || [])[0];
  const upper = p.current_role && p.current_role.org_classification === 'upper';
  return {
    id: p.id,
    name: p.name,
    party: p.party || '',
    chamber: p.current_role ? p.current_role.org_classification : null, // 'upper' | 'lower'
    chamberLabel: upper ? 'State Senate' : 'State House',
    district: p.current_role ? p.current_role.district : null,
    email: p.email || null,
    phone: (office && office.voice) || null,
    url: p.openstates_url || null
  };
}

export async function resolveStateReps(zip, env) {
  const kv = env.DIG_KV;
  const { lat, lng, state } = await resolveZipToLatLng(zip, kv);

  const cacheKey = `statereps:${lat}:${lng}`;
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return { reps: cached, state };
    } catch (e) {
      // fall through to a live lookup on a storage hiccup
    }
  }

  const apiKey = env.OPENSTATES_API_KEY;
  if (!apiKey) {
    throw apiError('Server is missing OPENSTATES_API_KEY — set it in the Cloudflare Pages project env vars.', 500);
  }

  const url = `https://v3.openstates.org/people.geo?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&apikey=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw apiError('Could not reach Open States', 502);
  }
  if (!res.ok) {
    throw apiError(`Open States returned HTTP ${res.status}`, 502);
  }
  const data = await res.json();
  const reps = (data.results || [])
    .filter(p => p.jurisdiction && p.jurisdiction.classification === 'state')
    .map(slimPerson);

  if (kv) {
    try { await kv.put(cacheKey, JSON.stringify(reps), { expirationTtl: REPS_CACHE_TTL_SECONDS }); } catch (e) {}
  }

  return { reps, state };
}

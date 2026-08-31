// Cloudflare Pages Function — municipal slice of the calendar. No unified
// national API exists for city/county government the way congress.gov
// covers federal and OpenStates covers every state — Legistar (Granicus'
// legislative platform) is the closest thing: hundreds of cities/counties
// run it with a free, keyless read API, but it's per-city, so this is a
// curated list of cities verified to actually work, not attempted
// nationwide coverage. A ZIP outside the list gets an honest "not covered
// yet" response, not fake sample data pretending to be real.
//
// Every client slug below was verified live against the real Legistar Web
// API (31 Aug 2026): real, recent, non-test data returned. Cities that
// exist on Legistar but need a per-jurisdiction API token (NYC,
// Philadelphia) or returned stale/sandbox data (SF, San Antonio,
// Miami-Dade, Denver, Sacramento) are deliberately left out — verify the
// same way before adding a new one, don't assume a big city is covered.
const CITY_CLIENTS = {
  'boston|ma': 'boston',
  'seattle|wa': 'seattle',
  'baltimore|md': 'baltimore',
  'nashville|tn': 'nashville',
  'phoenix|az': 'phoenix',
  'charlotte|nc': 'charlottenc',
  'st. paul|mn': 'stpaul',
  'saint paul|mn': 'stpaul',
  'pittsburgh|pa': 'pittsburgh'
};

const ZIP_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30; // ZIP->city is effectively static
const MATTERS_CACHE_TTL_SECONDS = 60 * 60; // 1 hour, matching calendar.js/state-bills.js
const MATTER_LIMIT = 20;

function cityKey(city, stateAbbr) {
  return (city || '').trim().toLowerCase() + '|' + (stateAbbr || '').trim().toLowerCase();
}

// Legistar doesn't expose a direct public URL field on Matters the way it
// does on Events (EventInSiteURL) — this is constructed from the
// frontend's own known URL pattern, spot-checked against Boston's site,
// not something the API confirms per-record.
function matterUrl(client, m) {
  if (!m.MatterId) return null;
  return `https://${client}.legistar.com/LegislationDetail.aspx?ID=${m.MatterId}${m.MatterGuid ? '&GUID=' + m.MatterGuid : ''}`;
}

// Named "bills" (not "matters") in the response on purpose — federal and
// state both use this shape, and digest.js's matchBills()/scoreAgainstIssues()
// already work against exactly this { title, latestAction: {date, text} }
// shape, so municipal slots into the same matching pipeline for free.
function slim(m, client) {
  const latestDate = m.MatterPassedDate || m.MatterEnactmentDate || m.MatterAgendaDate || m.MatterIntroDate || null;
  const statusText = m.MatterStatusName
    ? `${m.MatterStatusName}${m.MatterBodyName ? ' — ' + m.MatterBodyName : ''}`
    : 'No recorded status yet.';
  return {
    identifier: m.MatterFile || m.MatterTypeName || 'Item',
    title: m.MatterTitle || '',
    type: m.MatterTypeName || '',
    latestAction: { date: latestDate, text: statusText },
    updateDate: latestDate,
    url: matterUrl(client, m)
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const zip = (url.searchParams.get('zip') || '').trim();
  if (!/^\d{5}$/.test(zip)) {
    return json({ error: { message: 'Missing or invalid "zip" query param' } }, 400);
  }

  const kv = env.DIG_KV;

  let place = null;
  if (kv) {
    try {
      place = await kv.get('zipcity:' + zip, { type: 'json' });
    } catch (e) {
      place = null;
    }
  }
  if (!place) {
    let geoRes;
    try {
      geoRes = await fetch('https://api.zippopotam.us/us/' + zip);
    } catch (e) {
      return json({ error: { message: 'Could not resolve a city for that ZIP' } }, 502);
    }
    if (!geoRes.ok) {
      return json(
        { error: { message: geoRes.status === 404 ? 'Unrecognized ZIP code' : 'Could not resolve a city for that ZIP' } },
        geoRes.status === 404 ? 404 : 502
      );
    }
    const geo = await geoRes.json();
    const p = geo.places && geo.places[0];
    if (!p || !p['place name']) {
      return json({ error: { message: 'Could not resolve a city for that ZIP' } }, 502);
    }
    place = { city: p['place name'], state: p.state, stateAbbr: p['state abbreviation'] };
    if (kv) {
      try { await kv.put('zipcity:' + zip, JSON.stringify(place), { expirationTtl: ZIP_CACHE_TTL_SECONDS }); } catch (e) {}
    }
  }

  const client = CITY_CLIENTS[cityKey(place.city, place.stateAbbr)];
  if (!client) {
    return json({ covered: false, city: place.city, state: place.state, bills: [] });
  }

  const cacheKey = 'municipal:' + client;
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json(Object.assign({ covered: true, city: place.city, state: place.state }, cached));
    } catch (e) {
      // fall through to a live fetch on a storage hiccup
    }
  }

  const mattersUrl = `https://webapi.legistar.com/v1/${client}/matters?$orderby=MatterIntroDate desc&$top=${MATTER_LIMIT}`;
  let res;
  try {
    res = await fetch(mattersUrl);
  } catch (e) {
    return json({ error: { message: "Could not reach " + place.city + "'s legislative system" } }, 502);
  }
  if (!res.ok) {
    return json({ error: { message: `${place.city}'s legislative system returned HTTP ${res.status}` } }, 502);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return json({ error: { message: `${place.city}'s legislative system returned an unparseable response` } }, 502);
  }

  const bills = (Array.isArray(data) ? data : [])
    .filter(m => m.MatterTitle && !/^(test|wkj test)\b/i.test(m.MatterTitle.trim()))
    .map(m => slim(m, client));

  const payload = { bills, fetchedAt: Date.now() };
  if (kv) {
    try { await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: MATTERS_CACHE_TTL_SECONDS }); } catch (e) {}
  }

  return json(Object.assign({ covered: true, city: place.city, state: place.state }, payload));
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

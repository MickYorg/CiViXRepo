// Cloudflare Pages Function — direct single-bill lookup by citation
// (type + number, e.g. "hr" + "9694"), for when a citizen names a
// specific real bill in their manifesto. Added 10 Sep 2026 after a real,
// confirmed failure: calendar.js's own federal pool is only the ~100
// bills congress.gov reports as most-recently *updated* — a real,
// specific bill a citizen explicitly named can simply not be in that
// window on a given day (verified live: H.R.9694 wasn't), so it could
// never be genuinely matched, and digest.js's fallback scoring then let
// it dominate the top-3 unconditionally for the wrong reason (see
// CLAUDE.md's own note on this). congress.gov's per-bill *detail*
// endpoint doesn't need full-text search the way the list endpoint's
// missing search capability blocked before — a citizen who names a real
// bill has already given exactly what's needed to fetch it directly.
//
// Reuses calendar.js's own slim()/deriveStatus()/publicUrl() (moved to
// functions/_lib/congress-bill.js) so a directly-looked-up bill has the
// exact same shape as one from the regular pool — digest.js's matching
// and every card renderer downstream treat them identically.

import { slim } from '../_lib/congress-bill.js';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour, same freshness window as calendar.js
const CURRENT_CONGRESS = 119;

const VALID_TYPES = new Set(['hr', 's', 'hjres', 'sjres', 'hconres', 'sconres', 'hres', 'sres']);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const type = (url.searchParams.get('type') || '').toLowerCase().trim();
  const number = (url.searchParams.get('number') || '').trim();
  const congress = parseInt(url.searchParams.get('congress'), 10) || CURRENT_CONGRESS;

  if (!VALID_TYPES.has(type) || !/^\d{1,6}$/.test(number)) {
    return json({ error: { message: 'Expected ?type=<hr|s|hjres|sjres|hconres|sconres|hres|sres>&number=<digits>' } }, 400);
  }

  const kv = env.DIG_KV;
  const cacheKey = `billlookup:${congress}:${type}:${number}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json(cached);
    } catch (e) {
      // fall through to a live lookup on a storage hiccup
    }
  }

  const apiKey = env.CONGRESS_API_KEY;
  if (!apiKey) {
    return json(
      { error: { message: 'Server is missing CONGRESS_API_KEY — set it in the Cloudflare Pages project env vars.' } },
      500
    );
  }

  const apiUrl = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?format=json&api_key=${encodeURIComponent(apiKey)}`;

  let res;
  try {
    res = await fetch(apiUrl);
  } catch (e) {
    return json({ error: { message: 'Could not reach congress.gov' } }, 500);
  }

  if (res.status === 404) {
    return json({ error: { message: 'No such bill on file at congress.gov', notFound: true } }, 404);
  }
  if (!res.ok) {
    return json({ error: { message: `congress.gov returned HTTP ${res.status}` } }, 500);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return json({ error: { message: 'congress.gov returned an unparseable response' } }, 500);
  }

  if (!data.bill) {
    return json({ error: { message: 'No such bill on file at congress.gov', notFound: true } }, 404);
  }

  const bill = slim(data.bill);
  const payload = { bill, fetchedAt: Date.now() };

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (e) {
      // best-effort — a failed cache write just means the next lookup refetches
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

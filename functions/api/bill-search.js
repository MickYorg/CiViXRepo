// Cloudflare Pages Function — wide, title-phrase search for one specific
// recurring/annual bill (e.g. "the NDAA," no year given). Added 10 Sep
// 2026 after calendar.js's own ~100-most-recently-updated pool (and even
// a first attempt at searching that same pool from digest.js) both
// confirmed-live failed to contain the real, currently-active NDAA
// (S.4784) — a bill this significant can still fall outside a 100-item
// recency window on any given day, especially between floor-action
// steps. congress.gov's public API still has no true full-text search,
// but its list endpoint does accept up to 250 results per request
// (its own documented max) scoped to one Congress — a much wider net
// than calendar.js pulls for its general pool, used here only for this
// narrow, deliberate case rather than for every citizen's every digest
// build (that would be real, unnecessary congress.gov load).
//
// Reuses calendar.js's own slim()/deriveStatus()/publicUrl() (moved to
// functions/_lib/congress-bill.js) so a match has the exact same shape
// as any other bill digest.js already knows how to render.

import { slim } from '../_lib/congress-bill.js';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour, same freshness window as calendar.js
const CURRENT_CONGRESS = 119;
const SEARCH_LIMIT = 250; // congress.gov's own documented per-request max

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const phrase = (url.searchParams.get('title') || '').trim().toLowerCase();
  const congress = parseInt(url.searchParams.get('congress'), 10) || CURRENT_CONGRESS;

  if (!phrase || phrase.length < 4) {
    return json({ error: { message: 'Expected ?title=<a real phrase, at least 4 characters>' } }, 400);
  }

  const kv = env.DIG_KV;
  const cacheKey = `billsearch:${congress}:${phrase}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json(cached);
    } catch (e) {
      // fall through to a live search on a storage hiccup
    }
  }

  const apiKey = env.CONGRESS_API_KEY;
  if (!apiKey) {
    return json(
      { error: { message: 'Server is missing CONGRESS_API_KEY — set it in the Cloudflare Pages project env vars.' } },
      500
    );
  }

  const apiUrl = `https://api.congress.gov/v3/bill/${congress}?format=json&sort=updateDate+desc&limit=${SEARCH_LIMIT}&api_key=${encodeURIComponent(apiKey)}`;

  let res;
  try {
    res = await fetch(apiUrl);
  } catch (e) {
    return json({ error: { message: 'Could not reach congress.gov' } }, 500);
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

  const matches = (data.bills || [])
    .filter(b => (b.title || '').toLowerCase().includes(phrase))
    .map(slim)
    .sort((a, b) => {
      const ad = (a.latestAction && a.latestAction.date) || '';
      const bd = (b.latestAction && b.latestAction.date) || '';
      return bd.localeCompare(ad);
    });

  const payload = {
    bill: matches[0] || null,
    fetchedAt: Date.now(),
    debugPoolSize: (data.bills || []).length,
    debugSampleTitles: (data.bills || []).slice(0, 3).map(b => b.title)
  };

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (e) {
      // best-effort — a failed cache write just means the next search refetches
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

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
// 6 pages x 250 = up to 1,500 bills, fetched in parallel. Confirmed live
// that even one full page (250, sorted by most-recently-updated) didn't
// contain the real, currently-active NDAA — a bill this major can still
// rank well outside the top 250 "most recently touched" on a quiet week
// between its own floor actions, with thousands of smaller bills getting
// routine metadata updates ahead of it.
const PAGE_OFFSETS = [0, 250, 500, 750, 1000, 1250];

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const phrase = (url.searchParams.get('title') || '').trim().toLowerCase();
  const congress = parseInt(url.searchParams.get('congress'), 10) || CURRENT_CONGRESS;

  if (!phrase || phrase.length < 4) {
    return json({ error: { message: 'Expected ?title=<a real phrase, at least 4 characters>' } }, 400);
  }

  const kv = env.DIG_KV;
  const cacheKey = `billsearch:${congress}:${phrase}`;
  const skipCache = url.searchParams.get('fresh') === '1'; // TEMP debug bypass

  if (kv && !skipCache) {
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

  // Confirmed live: even a single 250-item page (congress.gov's own
  // per-request max) wasn't enough — the real, currently-active NDAA
  // simply sits further down the "most recently updated" ranking than
  // that on a quiet week between its own floor actions, with thousands
  // of other bills getting minor metadata touches ahead of it. Pages a
  // few requests deep (offset-based, in parallel) rather than one — a
  // heavier fetch, but only for this narrow, cached, deliberately rare
  // lookup, not general digest traffic.
  const apiUrlFor = offset =>
    `https://api.congress.gov/v3/bill/${congress}?format=json&sort=updateDate+desc&limit=${SEARCH_LIMIT}&offset=${offset}&api_key=${encodeURIComponent(apiKey)}`;

  let pages;
  try {
    pages = await Promise.all(
      PAGE_OFFSETS.map(offset => fetch(apiUrlFor(offset)).then(r => (r.ok ? r.json() : { bills: [] })).catch(() => ({ bills: [] })))
    );
  } catch (e) {
    return json({ error: { message: 'Could not reach congress.gov' } }, 500);
  }

  const allBills = pages.reduce((acc, page) => acc.concat(page.bills || []), []);
  const matches = allBills
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
    debugPoolSize: allBills.length
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

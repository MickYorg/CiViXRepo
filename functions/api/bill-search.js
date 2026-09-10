// Cloudflare Pages Function — wide, title-phrase search for one specific
// recurring/annual bill (e.g. "the NDAA," no year given). Added 10 Sep
// 2026 after calendar.js's own ~100-most-recently-updated pool (and even
// a first attempt at searching that same pool from digest.js) both
// confirmed-live failed to contain the real, currently-active NDAA.
// congress.gov's public API still has no true full-text search, but its
// list endpoint does accept pagination — verified live that even one
// full 250-item page (its own per-request max) still wasn't enough on a
// quiet week between the bill's own floor actions, with thousands of
// smaller bills getting routine metadata touches ahead of it; six pages
// (1,500 bills total, fetched in parallel) is what it actually took to
// find H.R.8800, the real, current NDAA. Used only for this narrow,
// deliberate, cached case — not for every citizen's every digest build,
// which is real, unnecessary congress.gov load this endpoint exists
// specifically to avoid imposing generally.
//
// Reuses calendar.js's own slim()/deriveStatus()/publicUrl() (moved to
// functions/_lib/congress-bill.js) so a match has the exact same shape
// as any other bill digest.js already knows how to render.

import { slim } from '../_lib/congress-bill.js';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour, same freshness window as calendar.js
const CURRENT_CONGRESS = 119;
const PAGE_SIZE = 250; // congress.gov's own documented per-request max
const PAGE_OFFSETS = [0, 250, 500, 750, 1000, 1250]; // 6 pages = up to 1,500 bills

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

  const apiUrlFor = offset =>
    `https://api.congress.gov/v3/bill/${congress}?format=json&sort=updateDate+desc&limit=${PAGE_SIZE}&offset=${offset}&api_key=${encodeURIComponent(apiKey)}`;

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

  const payload = { bill: matches[0] || null, fetchedAt: Date.now() };

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

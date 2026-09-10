// Cloudflare Pages Function — federal slice of the civic calendar.
// Pulls recent bill activity from the congress.gov API (server-side key,
// never exposed to the browser) and hands the frontend a slim JSON list to
// match against a visitor's profile. Reuses the DIG_KV namespace under a
// separate key prefix rather than provisioning a new one — this is a low
// volume, short-TTL cache, not shared state with DIG.
//
// Bill-shaping helpers (slim/deriveStatus/publicUrl/etc.) moved to
// functions/_lib/congress-bill.js 10 Sep 2026 so bill-lookup.js (a direct
// single-bill fetch for when a citizen names a specific real bill that
// isn't in this file's own top-100-most-recently-updated window) can
// reuse them instead of duplicating this logic.

import { slim } from '../_lib/congress-bill.js';

const CACHE_KEY = 'calendar:bills:latest';
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour: fresh enough for a legislative calendar
const BILL_LIMIT = 100;

export async function onRequestGet({ env }) {
  const kv = env.DIG_KV;

  if (kv) {
    try {
      const cached = await kv.get(CACHE_KEY, { type: 'json' });
      if (cached) return json(cached);
    } catch (e) {
      // fall through to a live fetch on a storage hiccup
    }
  }

  const apiKey = env.CONGRESS_API_KEY;
  if (!apiKey) {
    return json(
      { error: { message: 'Server is missing CONGRESS_API_KEY — set it in the Cloudflare Pages project env vars.' } },
      500
    );
  }

  const url = `https://api.congress.gov/v3/bill?format=json&sort=updateDate+desc&limit=${BILL_LIMIT}&api_key=${encodeURIComponent(apiKey)}`;

  let res;
  try {
    res = await fetch(url);
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

  // congress.gov's own sort=updateDate+desc (the request above) sorts by
  // the bill's overall metadata-update timestamp, which gets bumped by
  // things that aren't a real legislative action at all — a cosponsor
  // added, a text version republished. Net effect: a bill can lead this
  // list looking "recent" while the latestAction it actually shows is
  // months stale. Re-sorting here by latestAction's own date fixes what
  // "recent" means for a page whose whole point is legislative activity.
  const bills = (data.bills || []).map(slim).sort((a, b) => {
    const ad = a.latestAction && a.latestAction.date;
    const bd = b.latestAction && b.latestAction.date;
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return bd.localeCompare(ad);
  });
  const payload = { bills, fetchedAt: Date.now() };

  if (kv) {
    try {
      await kv.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (e) {
      // best-effort — a failed cache write just means the next visitor refetches
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

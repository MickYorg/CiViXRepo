// Cloudflare Pages Function — federal slice of the civic calendar.
// Pulls recent bill activity from the congress.gov API (server-side key,
// never exposed to the browser) and hands the frontend a slim JSON list to
// match against a visitor's profile. Reuses the DIG_KV namespace under a
// separate key prefix rather than provisioning a new one — this is a low
// volume, short-TTL cache, not shared state with DIG.

const CACHE_KEY = 'calendar:bills:latest';
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour: fresh enough for a legislative calendar
const BILL_LIMIT = 100;

const TYPE_SLUG = {
  hr: 'house-bill',
  s: 'senate-bill',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution',
  sres: 'senate-resolution'
};

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function publicUrl(bill) {
  const slug = TYPE_SLUG[String(bill.type || '').toLowerCase()];
  if (!slug || !bill.congress || !bill.number) return null;
  return `https://www.congress.gov/bill/${ordinal(bill.congress)}-congress/${slug}/${bill.number}`;
}

function slim(bill) {
  return {
    congress: bill.congress,
    type: bill.type,
    number: bill.number,
    title: bill.title || '',
    latestAction: bill.latestAction ? { date: bill.latestAction.actionDate, text: bill.latestAction.text } : null,
    updateDate: bill.updateDate || null,
    url: publicUrl(bill)
  };
}

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
    return json({ error: { message: 'Could not reach congress.gov' } }, 502);
  }

  if (!res.ok) {
    return json({ error: { message: `congress.gov returned HTTP ${res.status}` } }, 502);
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return json({ error: { message: 'congress.gov returned an unparseable response' } }, 502);
  }

  const bills = (data.bills || []).map(slim);
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

// Cloudflare Pages Function — pre-warms builder.html's "swipe today's
// headlines" pipeline into a single ready-to-serve batch, so tapping in
// gets an instant deck instead of watching fetch -> boildown -> photo run
// live. Stale-while-revalidate: any GET returns whatever's cached
// immediately (even if stale) and kicks off a background rebuild via
// waitUntil() when it's past its freshness window, so the next caller
// gets the fresh batch without waiting on it. index.html pings this on
// load specifically to be that background-refresh trigger — "ready and
// waiting by the first splash-page load of the hour" — without needing
// its own response.
//
// Reuses the exact same downstream endpoints the client already calls
// (/api/dig-check, /api/headline-image) via internal same-origin fetches,
// rather than duplicating their spend-cap/rate-limit/Anthropic/Unsplash
// logic here — this batch job's calls count against the same shared
// daily budgets those endpoints already enforce, same as any citizen's
// own usage would.

import { fetchGNews } from '../_lib/gnews.js';
import { ALL_ISSUE_NAMES } from '../_lib/issue-taxonomy.js';

const BATCH_KEY = 'headlinebatch:ready';
const FRESH_SECONDS = 60 * 60; // "ready by the top of the hour" framing
const STORE_TTL_SECONDS = FRESH_SECONDS * 6; // keep a stale batch around well past freshness as a fallback
const BATCH_SIZE = 5;

function boildownPrompt(article) {
  return `A citizen is swiping through today's news headlines to build a civic-engagement manifesto. Reduce this one headline to something a busy person can react to in five seconds.

Headline: "${article.title}"
${article.description ? `Description: "${article.description}"` : ''}

Reply with ONLY a JSON object, no markdown fences, no other text:
{
  "topic": one of these exact strings, whichever is the closest fit — ${JSON.stringify(ALL_ISSUE_NAMES)},
  "talkingPoint": one plain sentence (under 22 words) capturing what's actually at stake for an ordinary person — not a restatement of the headline,
  "imageQuery": 2-4 concrete, photographable keywords for a stock-photo search that captures the scene (e.g. "apartment building renters", "hospital waiting room") — no proper nouns, no politician or public-figure names, nothing that would try to identify a real specific person
}`;
}

async function boildownOne(origin, article) {
  try {
    const res = await fetch(new URL('/api/dig-check', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: boildownPrompt(article) })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const raw = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(raw);
    if (!parsed.topic || !parsed.talkingPoint) return null;
    if (ALL_ISSUE_NAMES.indexOf(parsed.topic) === -1) parsed.topic = ALL_ISSUE_NAMES[0];
    return parsed;
  } catch (e) {
    return null;
  }
}

async function photoFor(origin, query) {
  if (!query) return null;
  try {
    const res = await fetch(new URL('/api/headline-image', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error || !data.image) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function buildBatch(env, origin) {
  const articles = await fetchGNews(env, { q: '', limit: BATCH_SIZE });
  const boiled = await Promise.all(articles.map(async article => {
    const boildown = await boildownOne(origin, article);
    return boildown ? { article, boildown } : null;
  }));
  const survivors = boiled.filter(Boolean);
  await Promise.all(survivors.map(async s => {
    s.photo = await photoFor(origin, s.boildown.imageQuery);
  }));
  return survivors.map(s => ({
    article: s.article,
    topic: s.boildown.topic,
    talkingPoint: s.boildown.talkingPoint,
    photo: s.photo
  }));
}

async function refreshBatch(env, origin, kv) {
  try {
    const cards = await buildBatch(env, origin);
    if (!cards.length) return; // don't overwrite a good stale batch with an empty failed rebuild
    await kv.put(BATCH_KEY, JSON.stringify({ cards, builtAt: Date.now() }), { expirationTtl: STORE_TTL_SECONDS });
  } catch (e) {
    // best-effort — next caller (or the next hourly ping) just tries again
  }
}

export async function onRequestGet({ request, env, waitUntil }) {
  const kv = env.DIG_KV;
  const origin = new URL(request.url).origin;

  let cached = null;
  if (kv) {
    try {
      cached = await kv.get(BATCH_KEY, { type: 'json' });
    } catch (e) {
      cached = null;
    }
  }

  const isFresh = !!cached && Date.now() - cached.builtAt < FRESH_SECONDS * 1000;

  if (cached && !isFresh && kv) {
    const refresh = refreshBatch(env, origin, kv);
    if (waitUntil) waitUntil(refresh);
    else await refresh; // no background-task support in this runtime — refresh inline as a fallback
  }

  if (cached) {
    return json({ cards: cached.cards, builtAt: cached.builtAt, fresh: isFresh });
  }

  // Nothing cached yet at all — this caller pays the one-time full build
  // cost (same as the live pipeline would anyway), everyone after it
  // within the freshness window gets the instant path. Best-effort: a
  // missing GNEWS_API_KEY or any other failure here should degrade to an
  // empty batch (the client falls back to its own live pipeline), not a
  // 500 — this endpoint is a fast-path optimization, not a hard
  // dependency.
  let cards = [];
  try {
    cards = await buildBatch(env, origin);
  } catch (e) {
    cards = [];
  }
  const builtAt = Date.now();
  if (kv && cards.length) {
    try {
      await kv.put(BATCH_KEY, JSON.stringify({ cards, builtAt }), { expirationTtl: STORE_TTL_SECONDS });
    } catch (e) {}
  }
  return json({ cards, builtAt, fresh: true });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

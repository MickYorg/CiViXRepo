// Cloudflare Pages Function — headline feed for builder.html's "swipe
// today's headlines" alternate manifesto-building path. Deliberately built
// as a source-adapter registry rather than one hardcoded fetch: today only
// GNews is wired up, but the shape exists so a second/third source can be
// added later without reworking the endpoint or the client, and so the
// query can eventually be built from a citizen's own manifesto (their top
// P.issues) rather than always pulling the generic national feed — the
// `q` param already threads through to a real keyword search today, the
// client just doesn't send one for a brand-new citizen yet.

import { fetchGNews } from '../_lib/gnews.js';

const CACHE_TTL_SECONDS = 60 * 30; // headlines move faster than the bill calendar
const DEFAULT_LIMIT = 10;

// Registered sources, in the order results are pulled from when more than
// one is active. Adding a source later: write a fetchX(env, {q, limit})
// adapter above returning the same normalized shape, then list it here.
const SOURCES = { gnews: fetchGNews };
const ACTIVE_SOURCES = ['gnews'];

export async function onRequestGet({ request, env }) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim().slice(0, 200);
  const limit = Math.max(1, Math.min(20, Number(params.get('limit')) || DEFAULT_LIMIT));

  const kv = env.DIG_KV;
  const cacheKey = `headlines:${q ? 'q:' + q : 'general'}:${limit}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json(cached);
    } catch (e) {
      // fall through to a live fetch on a storage hiccup
    }
  }

  const errors = [];
  let articles = [];
  for (const name of ACTIVE_SOURCES) {
    try {
      articles = articles.concat(await SOURCES[name](env, { q, limit }));
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }

  if (!articles.length) {
    return json(
      { error: { message: errors.length ? errors.join('; ') : 'No headlines available right now.' } },
      errors.some(e => e.indexOf('missing-key') !== -1) ? 500 : 502
    );
  }

  const payload = { articles: articles.slice(0, limit), fetchedAt: Date.now() };

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS });
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

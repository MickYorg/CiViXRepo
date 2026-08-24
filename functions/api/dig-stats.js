// Cloudflare Pages Function — ported from netlify/functions/dig-stats.js.
//
// Anonymous, aggregate usage stats for DIG — deliberately NOT tied to
// any device, IP, or account. Three counters live here, all disclosed in
// the app's privacy note and readable by anyone via GET (rendered in the
// in-app STATS panel):
//
//   - sources: how many times each source name has been added to someone's
//     local profile (onboarding picks, custom adds, settings-panel adds)
//   - topics:  how many times each topic string has been checked
//   - ratings: aggregate like/dislike + star-rating totals per source,
//     submitted from the results "focus" view
//
// Every entry is a plain count/sum keyed by a name string — nothing here
// links back to a particular visitor, session, or request.

const MAX_ENTRIES = 500; // per counter map, trimmed to the top entries so this can't grow unbounded
const MAX_NAME_LEN = 200;

function clampName(s) {
  return String(s || '').trim().slice(0, MAX_NAME_LEN);
}

function trimMap(map, scoreFn) {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ENTRIES) return map;
  entries.sort((a, b) => scoreFn(b[1]) - scoreFn(a[1]));
  return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

async function readJson(kv, key, fallback) {
  try {
    const v = await kv.get(key, { type: 'json' });
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGet(kv) {
  const [sources, topics, ratings] = await Promise.all([
    readJson(kv, 'stats:sources', {}),
    readJson(kv, 'stats:topics', {}),
    readJson(kv, 'stats:ratings', {})
  ]);

  const topSources = Object.entries(sources)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const topTopics = Object.entries(topics)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const ratingList = Object.entries(ratings)
    .map(([name, r]) => ({
      name,
      likes: r.likes || 0,
      dislikes: r.dislikes || 0,
      avgStars: r.starCount ? Math.round((r.starSum / r.starCount) * 100) / 100 : null,
      starCount: r.starCount || 0
    }))
    .filter(r => r.likes || r.dislikes || r.starCount)
    .sort((a, b) => (b.likes - b.dislikes) - (a.likes - a.dislikes));

  return jsonResponse({ sources: topSources, topics: topTopics, ratings: ratingList }, 200);
}

async function handlePost(request, kv) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const type = body && body.type;
  const name = clampName(body && body.name);
  if (!name || !['source', 'topic', 'rating'].includes(type)) {
    return jsonResponse({ error: { message: 'Expected { type: "source"|"topic"|"rating", name }' } }, 400);
  }

  // Stats are nice-to-have, never load-bearing — any storage hiccup here
  // fails open (200 { ok: false }) rather than surfacing an error to the
  // person checking a topic.
  try {
    if (type === 'source' || type === 'topic') {
      const key = type === 'source' ? 'stats:sources' : 'stats:topics';
      const map = await readJson(kv, key, {});
      map[name] = (map[name] || 0) + 1;
      await kv.put(key, JSON.stringify(trimMap(map, v => v)));
    } else if (type === 'rating') {
      const action = body.action; // 'like' | 'dislike' | 'star'
      const ratings = await readJson(kv, 'stats:ratings', {});
      const r = ratings[name] || { likes: 0, dislikes: 0, starSum: 0, starCount: 0 };

      if (action === 'like') {
        r.likes += 1;
      } else if (action === 'dislike') {
        r.dislikes += 1;
      } else if (action === 'star') {
        const stars = Math.max(1, Math.min(5, Number(body.stars) || 0));
        if (stars) {
          r.starSum += stars;
          r.starCount += 1;
        }
      } else {
        return jsonResponse({ error: { message: 'Unknown rating action' } }, 400);
      }

      ratings[name] = r;
      await kv.put('stats:ratings', JSON.stringify(trimMap(ratings, v => (v.likes || 0) + (v.dislikes || 0) + (v.starCount || 0))));
    }
  } catch (e) {
    return jsonResponse({ ok: false }, 200);
  }

  return jsonResponse({ ok: true }, 200);
}

export async function onRequestGet({ env }) {
  try {
    return await handleGet(env.DIG_KV);
  } catch (e) {
    // Empty-but-valid shape, so the STATS panel renders "No data yet"
    // instead of the frontend's fetch-failed message.
    return jsonResponse({ sources: [], topics: [], ratings: [] }, 200);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    return await handlePost(request, env.DIG_KV);
  } catch (e) {
    return jsonResponse({ ok: false }, 200);
  }
}

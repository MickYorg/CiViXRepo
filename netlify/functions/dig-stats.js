// Netlify serverless function (v2, Deno-style Request/Response).
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

import { getStore } from '@netlify/blobs';

const MAX_ENTRIES = 500; // per counter map, trimmed to the top entries so this can't grow unbounded
const MAX_NAME_LEN = 200;

function clampName(s) {
  return String(s || '').trim().slice(0, MAX_NAME_LEN);
}

// Keeps a map from growing forever under abuse/spam by trimming to the
// top MAX_ENTRIES by score once it gets too big. scoreFn turns a map value
// into a comparable number (a plain count for sources/topics, or an
// engagement total for ratings).
function trimMap(map, scoreFn) {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ENTRIES) return map;
  entries.sort((a, b) => scoreFn(b[1]) - scoreFn(a[1]));
  return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

async function readJson(store, key, fallback) {
  try {
    const v = await store.get(key, { type: 'json' });
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

async function handleGet(store) {
  const [sources, topics, ratings] = await Promise.all([
    readJson(store, 'sources', {}),
    readJson(store, 'topics', {}),
    readJson(store, 'ratings', {})
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

async function handlePost(req, store) {
  let body;
  try {
    body = await req.json();
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
      const key = type === 'source' ? 'sources' : 'topics';
      const map = await readJson(store, key, {});
      map[name] = (map[name] || 0) + 1;
      await store.setJSON(key, trimMap(map, v => v));
    } else if (type === 'rating') {
      const action = body.action; // 'like' | 'dislike' | 'star'
      const ratings = await readJson(store, 'ratings', {});
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
      await store.setJSON('ratings', trimMap(ratings, v => (v.likes || 0) + (v.dislikes || 0) + (v.starCount || 0)));
    }
  } catch (e) {
    return jsonResponse({ ok: false }, 200);
  }

  return jsonResponse({ ok: true }, 200);
}

export default async (req) => {
  // Everything below is wrapped in one outer try/catch. Stats are a
  // nice-to-have, view-only feature — a Blobs hiccup, a cold-start init
  // error, anything unexpected should degrade to an empty-but-valid
  // response instead of an unhandled 500 (which the browser can't tell
  // apart from "this endpoint doesn't exist", and which is what turns
  // into the frontend's generic "Could not load stats right now").
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return jsonResponse({ error: { message: 'Method not allowed' } }, 405);
    }

    const store = getStore({ name: 'dig-stats', consistency: 'strong' });

    if (req.method === 'GET') return await handleGet(store);
    return await handlePost(req, store);
  } catch (e) {
    if (req.method === 'GET') {
      // Empty-but-valid shape, so the STATS panel renders "No data yet"
      // instead of the frontend's fetch-failed message.
      return jsonResponse({ sources: [], topics: [], ratings: [] }, 200);
    }
    return jsonResponse({ ok: false }, 200);
  }
};

export const config = {
  path: '/api/dig-stats'
};

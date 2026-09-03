// Cloudflare Pages Function — anonymous, aggregate platform usage stats.
// Same shape and privacy contract as dig-stats.js: nothing here is tied
// to a visitor, session, IP, or device — every entry is a plain running
// count keyed by a name string. Feeds analytics.html's real-data view.
//
//   - manifestos: how many profiles have ever crossed from empty to
//     having real content (fired once per profile, guarded client-side
//     by builder.html's own P.statsReported flag)
//   - levels:     how many completed actions (a real send, or a drafted
//     call/email actually copied) happened at each jurisdiction level
//   - topics:     which matched priority/issue names those actions were
//     actually about — the exact topic names digest.js's own matching
//     already produces (ACTIVE.hits / GENERAL_ACTIVE.hits / STATE_ACTIVE.hits
//     in take-action.html), not a separate taxonomy invented here

const MAX_TOPIC_ENTRIES = 500;
const MAX_NAME_LEN = 200;
const MAX_TOPICS_PER_REQUEST = 10;
const LEVELS = ['federal', 'state', 'municipal', 'general'];

function clampName(s) {
  return String(s || '').trim().slice(0, MAX_NAME_LEN);
}

function trimTopics(map) {
  const entries = Object.entries(map);
  if (entries.length <= MAX_TOPIC_ENTRIES) return map;
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, MAX_TOPIC_ENTRIES));
}

async function readJson(kv, key, fallback) {
  try {
    const v = await kv.get(key, { type: 'json' });
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGet(kv) {
  const [manifestos, levels, topics] = await Promise.all([
    readJson(kv, 'pstats:manifestos', { count: 0 }),
    readJson(kv, 'pstats:levels', {}),
    readJson(kv, 'pstats:topics', {})
  ]);

  const actionsTotal = Object.values(levels).reduce((a, b) => a + b, 0);
  const topTopics = Object.entries(topics)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return json({
    manifestos: manifestos.count || 0,
    actionsTotal,
    levels,
    topTopics
  });
}

async function handlePost(request, kv) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const type = body && body.type;
  if (type !== 'manifesto' && type !== 'action') {
    return json({ error: { message: 'Expected { type: "manifesto" | "action" }' } }, 400);
  }

  // Stats are nice-to-have, never load-bearing — any storage hiccup here
  // fails open (200 { ok: false }) rather than surfacing an error over
  // something the citizen didn't ask to see.
  try {
    if (type === 'manifesto') {
      const m = await readJson(kv, 'pstats:manifestos', { count: 0 });
      m.count = (m.count || 0) + 1;
      await kv.put('pstats:manifestos', JSON.stringify(m));
    } else {
      const level = LEVELS.includes(body.level) ? body.level : 'general';
      const levels = await readJson(kv, 'pstats:levels', {});
      levels[level] = (levels[level] || 0) + 1;
      await kv.put('pstats:levels', JSON.stringify(levels));

      const rawTopics = Array.isArray(body.topics) ? body.topics : [];
      if (rawTopics.length) {
        const topics = await readJson(kv, 'pstats:topics', {});
        rawTopics.slice(0, MAX_TOPICS_PER_REQUEST).forEach(t => {
          const name = clampName(t);
          if (name) topics[name] = (topics[name] || 0) + 1;
        });
        await kv.put('pstats:topics', JSON.stringify(trimTopics(topics)));
      }
    }
  } catch (e) {
    return json({ ok: false }, 200);
  }

  return json({ ok: true }, 200);
}

export async function onRequestGet({ env }) {
  try {
    return await handleGet(env.DIG_KV);
  } catch (e) {
    return json({ manifestos: 0, actionsTotal: 0, levels: {}, topTopics: [] }, 200);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    return await handlePost(request, env.DIG_KV);
  } catch (e) {
    return json({ ok: false }, 200);
  }
}

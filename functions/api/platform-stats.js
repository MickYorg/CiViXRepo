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
//   - wins:       10 Sep 2026 — how many bills a citizen was actually
//     watching went on to become law (take-action.html's
//     checkWatchlistUpdates(), fired once per bill via a `won` flag
//     persisted on the watch item itself, guarded the same "count once,
//     ever" way manifestos is). A different signal than `levels`/`topics`
//     — those count a citizen taking an action; this counts a real
//     outcome, kept in its own counters (winsTotal, winTopics) rather
//     than folded into the action ones so the two aren't conflated
//   - functions:  13 Sep 2026 — a free-form name -> count map for AI-backed
//     features that aren't a completed take-action (so don't fit
//     `levels`), for the platform-wide "usage celebration" ticker
//     (usage-ticker.js): today just DIG's own `dig_check` and `dig_debate`.
//     Same open-set shape as `topics` — add a new name at its call site,
//     no backend change needed — rather than a fixed enum, since more
//     functions (plain-summary, strategic-plan, ...) will likely join.

const MAX_TOPIC_ENTRIES = 500;
const MAX_NAME_LEN = 200;
const MAX_TOPICS_PER_REQUEST = 10;
const MAX_FUNCTION_ENTRIES = 50;
const LEVELS = ['federal', 'state', 'municipal', 'general'];

function clampName(s) {
  return String(s || '').trim().slice(0, MAX_NAME_LEN);
}

function trimMap(map, max) {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, max));
}

async function readJson(kv, key, fallback) {
  try {
    const v = await kv.get(key, { type: 'json' });
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

// pstats:trackingSince is written as a bare date string (see
// functions/_lib/token-stats.js), not JSON — needs its own plain-text read.
async function readText(kv, key, fallback) {
  try {
    const v = await kv.get(key);
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
  const [manifestos, levels, topics, wins, winTopics, functions, tokens, dailySpend, trackingSince] = await Promise.all([
    readJson(kv, 'pstats:manifestos', { count: 0 }),
    readJson(kv, 'pstats:levels', {}),
    readJson(kv, 'pstats:topics', {}),
    readJson(kv, 'pstats:wins', { count: 0 }),
    readJson(kv, 'pstats:winTopics', {}),
    readJson(kv, 'pstats:functions', {}),
    readJson(kv, 'pstats:tokens', {}),
    readJson(kv, 'pstats:dailySpend', {}),
    readText(kv, 'pstats:trackingSince', null)
  ]);

  const actionsTotal = Object.values(levels).reduce((a, b) => a + b, 0);
  const topTopics = Object.entries(topics)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const topWinTopics = Object.entries(winTopics)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Real per-feature Anthropic spend (functions/_lib/token-stats.js writes
  // this on every call to dig-check.js/plain-summary.js/strategic-plan.js
  // — the only three Functions that call Anthropic directly), plus the
  // grand totals the transparency dashboard leads with.
  const tokenFeatures = Object.entries(tokens)
    .map(([name, t]) => ({
      name,
      calls: t.calls || 0,
      inputTokens: t.inputTokens || 0,
      outputTokens: t.outputTokens || 0,
      costUsd: t.costUsd || 0
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const tokensSummary = tokenFeatures.reduce((sum, t) => ({
    calls: sum.calls + t.calls,
    inputTokens: sum.inputTokens + t.inputTokens,
    outputTokens: sum.outputTokens + t.outputTokens,
    costUsd: sum.costUsd + t.costUsd
  }), { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });

  // Chronological, for the dashboard's spend-over-time chart — the KV map
  // itself has no guaranteed key order, so this is where it gets sorted.
  const dailySpendSeries = Object.entries(dailySpend)
    .map(([date, d]) => ({
      date,
      calls: d.calls || 0,
      inputTokens: d.inputTokens || 0,
      outputTokens: d.outputTokens || 0,
      costUsd: d.costUsd || 0
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const daysTracked = trackingSince
    ? Math.max(1, Math.round((Date.now() - new Date(trackingSince + 'T00:00:00Z').getTime()) / 86400000) + 1)
    : 0;

  return json({
    manifestos: manifestos.count || 0,
    actionsTotal,
    levels,
    topTopics,
    winsTotal: wins.count || 0,
    topWinTopics,
    functions,
    tokenFeatures,
    tokensSummary,
    dailySpend: dailySpendSeries,
    trackingSince,
    daysTracked
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
  if (type !== 'manifesto' && type !== 'action' && type !== 'win' && type !== 'function') {
    return json({ error: { message: 'Expected { type: "manifesto" | "action" | "win" | "function" }' } }, 400);
  }

  // Stats are nice-to-have, never load-bearing — any storage hiccup here
  // fails open (200 { ok: false }) rather than surfacing an error over
  // something the citizen didn't ask to see.
  try {
    if (type === 'manifesto') {
      const m = await readJson(kv, 'pstats:manifestos', { count: 0 });
      m.count = (m.count || 0) + 1;
      await kv.put('pstats:manifestos', JSON.stringify(m));
    } else if (type === 'function') {
      const name = clampName(body.name);
      if (name) {
        const functions = await readJson(kv, 'pstats:functions', {});
        functions[name] = (functions[name] || 0) + 1;
        await kv.put('pstats:functions', JSON.stringify(trimMap(functions, MAX_FUNCTION_ENTRIES)));
      }
    } else if (type === 'win') {
      // A watched bill actually became law — a real outcome, not an
      // action the citizen took, so this stays in its own counters
      // rather than folding into levels/topics above.
      const w = await readJson(kv, 'pstats:wins', { count: 0 });
      w.count = (w.count || 0) + 1;
      await kv.put('pstats:wins', JSON.stringify(w));

      const rawTopics = Array.isArray(body.topics) ? body.topics : [];
      if (rawTopics.length) {
        const winTopics = await readJson(kv, 'pstats:winTopics', {});
        rawTopics.slice(0, MAX_TOPICS_PER_REQUEST).forEach(t => {
          const name = clampName(t);
          if (name) winTopics[name] = (winTopics[name] || 0) + 1;
        });
        await kv.put('pstats:winTopics', JSON.stringify(trimMap(winTopics, MAX_TOPIC_ENTRIES)));
      }
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
        await kv.put('pstats:topics', JSON.stringify(trimMap(topics, MAX_TOPIC_ENTRIES)));
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
    return json({
      manifestos: 0, actionsTotal: 0, levels: {}, topTopics: [], winsTotal: 0, topWinTopics: [],
      functions: {}, tokenFeatures: [], tokensSummary: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      dailySpend: [], trackingSince: null, daysTracked: 0
    }, 200);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    return await handlePost(request, env.DIG_KV);
  } catch (e) {
    return json({ ok: false }, 200);
  }
}

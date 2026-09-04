// Cloudflare Pages Function — shared, server-side cache for the
// plain-language legislative-activity rewrite digest.js's plainSummarize()
// shows on every bill card. Previously that cache lived only in each
// citizen's own browser (localStorage) — no shared server cache existed,
// so the first citizen anywhere to see a given bill spent a real Anthropic
// call summarizing it, and every OTHER citizen's own first visit to that
// same bill spent an independent call too, each one eating into that
// visitor's personal /api/dig-check daily rate limit for something that
// had nothing to do with their own usage of DIG/Inbox/drafting elsewhere
// in the app. This endpoint fixes that: one Anthropic call per bill, ever,
// shared across every visitor who's ever asked — not per-browser.
//
// Deliberately NOT rate-limited per-IP the way /api/dig-check is. A cache
// MISS here is a rare, system-wide event (the first citizen anywhere to
// see a particular bill), not personal usage that should compete against
// that visitor's own quota for interactive features. It still shares
// dig-check.js's own overall daily $ budget (same usage:<date> KV key) —
// this is real Anthropic spend either way, and the existing budget cap
// exists specifically to bound total spend regardless of which endpoint
// spent it.
//
// Cache is keyed by bill id alone, same semantics plainSummarize() already
// had client-side: a bill's cached summary can go mildly stale once its
// latestAction moves on to something new (a fresh committee referral, a
// floor vote) and this doesn't auto-regenerate for that — accepted
// then, still accepted now, not something this pass changes.

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days — cheap to keep, real spend to regenerate
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 2;
const PRICE_PER_MTOK_INPUT = 2;
const PRICE_PER_MTOK_OUTPUT = 10;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // UTC date
}

function estimateCost(usage) {
  if (!usage) return 0;
  const inputCost = ((usage.input_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_INPUT;
  const outputCost = ((usage.output_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_OUTPUT;
  return inputCost + outputCost;
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: { message: 'Server is missing ANTHROPIC_API_KEY — set it in the Cloudflare Pages project env vars.' } }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: 'Invalid JSON body' } }, 400);
  }

  const id = body && body.id;
  const title = body && body.title;
  if (!id || typeof id !== 'string' || !title || typeof title !== 'string') {
    return json({ error: { message: 'Missing "id" or "title" string in request body' } }, 400);
  }
  const actionText = (body && body.actionText) || '';

  const kv = env.DIG_KV;
  const cacheKey = `plainsummary:${id}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached && cached.text) return json({ text: cached.text, cached: true });
    } catch (e) {
      // fall through to a live summarize on a storage hiccup
    }
  }

  const dailyBudget = Number(env.DIG_DAILY_BUDGET_USD || 20);
  const dateKey = todayKey();
  let record = { spent: 0 };
  if (kv) {
    try {
      record = (await kv.get(`usage:${dateKey}`, { type: 'json' })) || { spent: 0 };
    } catch (e) {
      record = { spent: 0 };
    }
  }

  if (record.spent >= dailyBudget) {
    return json({ error: { message: `Daily budget of $${dailyBudget} reached — resets at UTC midnight.` } }, 402);
  }

  // 4 Sep 2026: the earlier prompt ("what it actually does OR what just
  // happened") gave the model an easy out to just paraphrase the latest
  // procedural action — the only genuinely fresh input it had — which
  // read as a status update ("was just sent to committee for review"),
  // not a summary a citizen could react to. A real bill summary isn't
  // fetched here (that's a separate per-bill congress.gov/OpenStates call
  // this endpoint doesn't make), but the bill's own title is real
  // substantive text, not filler — official titles describe what a bill
  // would actually do, just in dense legalese. Leaning on the title for
  // subject matter and explicitly ruling out procedural framing (a
  // citizen-facing status indicator already covers "what stage is it
  // at," separately from this text — see deriveStatus() in
  // functions/api/calendar.js) gets closer to a real description instead
  // of a narrower rewrite of the same status line.
  const prompt = `Rewrite this bill in plain language a busy person with no policy background could understand in five seconds — what it would actually DO or change, based on its title (which describes the real subject matter, just in legalese). Do NOT describe legislative procedure or what stage it's at ("referred to committee," "passed the House," etc.) — a separate status indicator already covers that, so this text would just be redundant with it. One to two sentences, no markdown, no quotes, under 40 words total.

Bill: ${title}
(background only, not to be described procedurally) Latest action: ${actionText || 'No recorded action yet.'}`;

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      // No web_search tool here (unlike dig-check.js) — this is a pure
      // rewrite of text already in hand, never needs to look anything up.
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (e) {
    return json({ error: { message: 'Could not reach Anthropic API' } }, 502);
  }

  const raw = await anthropicRes.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return json({ error: { message: 'Anthropic returned an unparseable response' } }, 502);
  }

  // Track spend regardless of success/failure, same as dig-check.js —
  // some error responses still report partial usage.
  if (kv) {
    try {
      const cost = estimateCost(parsed.usage);
      if (cost > 0) {
        await kv.put(`usage:${dateKey}`, JSON.stringify({ spent: (record.spent || 0) + cost }), { expirationTtl: COUNTER_TTL_SECONDS });
      }
    } catch (e) {}
  }

  if (!anthropicRes.ok) {
    const message = (parsed.error && parsed.error.message) || `Anthropic returned HTTP ${anthropicRes.status}`;
    return json({ error: { message } }, anthropicRes.status);
  }

  const text = (parsed.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
    .replace(/^["']|["']$/g, '');

  if (!text) {
    return json({ error: { message: 'Empty response from Anthropic' } }, 502);
  }

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify({ text, at: Date.now() }), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (e) {}
  }

  return json({ text, cached: false });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Cloudflare Pages Function — ported from netlify/functions/dig-check.js.
// Holds the real Anthropic API key server-side so it's never exposed to the
// browser. The frontend calls /api/dig-check with { prompt, feature? }; this
// enforces a daily spend cap and a per-IP daily request cap (both tracked in
// the DIG_KV namespace, since functions are stateless between invocations),
// then forwards the Anthropic response. `feature` (13 Sep 2026) is an
// optional short tag — every distinct caller across the app passes its own
// name (dig_check, dig_debate, inbox_classify, headline_boildown, ...) so
// real spend can be attributed per function for the transparency dashboard
// (see functions/_lib/token-stats.js) — falls back to 'other' if omitted,
// never rejected, so this stays backward-compatible with any caller that
// doesn't pass one.

import { todayKey, readDailyUsage, recordSpend } from '../_lib/token-stats.js';

// Daily counters are only ever read/written within their own UTC day, so a
// short TTL lets KV clean them up on its own instead of accumulating forever.
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 2;

function secondsUntilMidnightUTC() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(1, Math.round((midnight.getTime() - now.getTime()) / 1000));
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'Server is missing ANTHROPIC_API_KEY — set it in the Cloudflare Pages project env vars.' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON body' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const prompt = body && body.prompt;
  if (!prompt || typeof prompt !== 'string') {
    return new Response(JSON.stringify({ error: { message: 'Missing "prompt" string in request body' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const feature = (body && typeof body.feature === 'string' && body.feature) || 'other';

  const dailyBudget = Number(env.DIG_DAILY_BUDGET_USD || 20);
  const dailyLimitPerIp = Number(env.DIG_DAILY_LIMIT_PER_IP || 100);
  const key = todayKey();
  const kv = env.DIG_KV;

  const record = await readDailyUsage(kv, key);

  if (record.spent >= dailyBudget) {
    return new Response(
      JSON.stringify({
        error: { message: `Daily budget of $${dailyBudget} reached — resets at UTC midnight. Try again tomorrow.` }
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Per-visitor cap, so one IP can't burn through the whole shared budget.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = `rate:${ip}:${key}`;

  let rateRecord = { count: 0 };
  if (kv) {
    try {
      rateRecord = (await kv.get(rateKey, { type: 'json' })) || { count: 0 };
    } catch (e) {
      rateRecord = { count: 0 };
    }
  }

  if (rateRecord.count >= dailyLimitPerIp) {
    return new Response(
      JSON.stringify({
        error: { message: `Daily limit of ${dailyLimitPerIp} checks reached for this visitor — resets at UTC midnight.` }
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'retry-after': String(secondsUntilMidnightUTC()) }
      }
    );
  }

  if (kv) {
    try {
      await kv.put(rateKey, JSON.stringify({ count: (rateRecord.count || 0) + 1 }), { expirationTtl: COUNTER_TTL_SECONDS });
    } catch (e) {
      // best-effort — a failed write here just means this one request goes uncounted
    }
  }

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
        // max_uses gives the model room to run several searches per check
        // instead of settling for one and quitting — matters most for
        // commentators/analysts who mainly show up as guests on other
        // people's podcasts and YouTube shows rather than publishing under
        // their own byline, where a single search often comes up empty.
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }]
      })
    });
  } catch (e) {
    // 502/504/521-526 are Cloudflare-reserved status codes — the edge
    // always discards the origin's body for those and substitutes its
    // own bare "error code: NNN" plain-text page, so this endpoint's own
    // JSON message would never actually reach the caller. Confirmed live
    // 9 Sep 2026 (on strategic-plan.js first, this being the same
    // underlying bug) — 500 instead everywhere in this file.
    return new Response(JSON.stringify({ error: { message: 'Could not reach Anthropic API' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const text = await anthropicRes.text();

  // Track spend from whatever usage info came back, success or not — some
  // error responses still report partial usage. Updates both the daily
  // budget-cap counter and the per-feature lifetime totals in one call.
  if (kv) {
    try {
      const parsed = JSON.parse(text);
      await recordSpend(kv, feature, parsed.usage, key, record);
    } catch (e) {
      // response wasn't JSON or had no usage field — nothing to record
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  const retryAfter = anthropicRes.headers.get('retry-after');
  if (retryAfter) headers['retry-after'] = retryAfter;

  return new Response(text, { status: anthropicRes.status, headers });
}

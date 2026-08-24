// Cloudflare Pages Function — ported from netlify/functions/dig-check.js.
// Holds the real Anthropic API key server-side so it's never exposed to the
// browser. The frontend calls /api/dig-check with just { prompt }; this
// enforces a daily spend cap and a per-IP daily request cap (both tracked in
// the DIG_KV namespace, since functions are stateless between invocations),
// then forwards the Anthropic response.

const PRICE_PER_MTOK_INPUT = 2;
const PRICE_PER_MTOK_OUTPUT = 10;
const PRICE_PER_1000_WEB_SEARCHES = 10;

// Daily counters are only ever read/written within their own UTC day, so a
// short TTL lets KV clean them up on its own instead of accumulating forever.
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 2;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // UTC date, e.g. "2026-08-13"
}

function secondsUntilMidnightUTC() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(1, Math.round((midnight.getTime() - now.getTime()) / 1000));
}

function estimateCost(usage) {
  if (!usage) return 0;
  const inputCost = ((usage.input_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_INPUT;
  const outputCost = ((usage.output_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_OUTPUT;
  const searches = (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  const searchCost = (searches / 1000) * PRICE_PER_1000_WEB_SEARCHES;
  return inputCost + outputCost + searchCost;
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

  const dailyBudget = Number(env.DIG_DAILY_BUDGET_USD || 20);
  const dailyLimitPerIp = Number(env.DIG_DAILY_LIMIT_PER_IP || 30);
  const key = todayKey();
  const kv = env.DIG_KV;

  let record = { spent: 0 };
  if (kv) {
    try {
      record = (await kv.get(`usage:${key}`, { type: 'json' })) || { spent: 0 };
    } catch (e) {
      record = { spent: 0 }; // fail open on a storage hiccup rather than blocking all checks
    }
  }

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
    return new Response(JSON.stringify({ error: { message: 'Could not reach Anthropic API' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const text = await anthropicRes.text();

  // Track spend from whatever usage info came back, success or not — some
  // error responses still report partial usage.
  if (kv) {
    try {
      const parsed = JSON.parse(text);
      const cost = estimateCost(parsed.usage);
      if (cost > 0) {
        const updated = { spent: (record.spent || 0) + cost };
        await kv.put(`usage:${key}`, JSON.stringify(updated), { expirationTtl: COUNTER_TTL_SECONDS });
      }
    } catch (e) {
      // response wasn't JSON or had no usage field — nothing to record
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  const retryAfter = anthropicRes.headers.get('retry-after');
  if (retryAfter) headers['retry-after'] = retryAfter;

  return new Response(text, { status: anthropicRes.status, headers });
}

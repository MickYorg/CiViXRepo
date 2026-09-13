// Shared real-usage/spend tracking for every Function that calls Anthropic
// directly (dig-check.js, plain-summary.js, strategic-plan.js — confirmed
// via `grep -rl api.anthropic.com functions/` to be the only three; every
// other AI-backed feature in the app reuses dig-check.js's own HTTP
// endpoint, so its spend is already captured there under whatever
// `feature` tag that caller passes).
//
// 13 Sep 2026: before this, each of those three files independently
// duplicated estimateCost()/todayKey() and wrote only a single aggregate
// `spent` float to `usage:<date>` — enough to gate the shared daily budget
// cap, but with no record of which feature spent it, no token counts, and
// no running lifetime total. The citizen asked for a real, transparent
// dashboard of token spend and per-function usage ("celebrate every
// cycle, dig, search, interaction") — future donation/sponsorship pitches
// (institutional users donating usage credits to citizens) will also lean
// on this being real, auditable data, not a vanity number — so this
// centralizes the existing budget-cap bookkeeping (unchanged behavior)
// and adds a genuine per-feature, lifetime-running-total structure
// (`pstats:tokens`) alongside it, in one place instead of three drifting
// copies.
const PRICE_PER_MTOK_INPUT = 2;
const PRICE_PER_MTOK_OUTPUT = 10;
const PRICE_PER_1000_WEB_SEARCHES = 10; // only dig-check.js's calls ever carry this (its own web_search tool) — 0 for the other two
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 2; // daily budget counter only — pstats:tokens/pstats:dailySpend never expire
const MAX_FEATURES = 50;
const MAX_DAILY_ENTRIES = 400; // ~13 months — bounds pstats:dailySpend's growth without losing real recent history

export function todayKey() {
  return new Date().toISOString().slice(0, 10); // UTC date
}

export function estimateCost(usage) {
  if (!usage) return 0;
  const inputCost = ((usage.input_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_INPUT;
  const outputCost = ((usage.output_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_OUTPUT;
  const searches = (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  const searchCost = (searches / 1000) * PRICE_PER_1000_WEB_SEARCHES;
  return inputCost + outputCost + searchCost;
}

// Reads the shared daily-budget record (used by every caller's own
// `record.spent >= dailyBudget` gate) — kept here too so all three files
// read the exact same shape rather than three copies of the same query.
export async function readDailyUsage(kv, dateKey) {
  if (!kv) return { spent: 0 };
  try {
    return (await kv.get(`usage:${dateKey}`, { type: 'json' })) || { spent: 0 };
  } catch (e) {
    return { spent: 0 };
  }
}

// Call once per real Anthropic response (success or error — some error
// responses still report partial usage, same as all three callers already
// treated it). Fails silently on any KV hiccup — spend tracking is
// nice-to-have, never load-bearing, same stance platform-stats.js itself
// already takes.
export async function recordSpend(kv, feature, usage, dateKey, priorRecord) {
  if (!kv || !usage) return;
  const cost = estimateCost(usage);
  if (cost <= 0 && !usage.input_tokens && !usage.output_tokens) return;

  try {
    const spent = (priorRecord && priorRecord.spent) || 0;
    await kv.put(`usage:${dateKey}`, JSON.stringify({ spent: spent + cost }), { expirationTtl: COUNTER_TTL_SECONDS });
  } catch (e) { /* budget-cap bookkeeping is best-effort */ }

  try {
    const tokens = (await kv.get('pstats:tokens', { type: 'json' })) || {};
    const key = (feature && String(feature).trim().slice(0, 60)) || 'other';
    const entry = tokens[key] || { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    entry.calls += 1;
    entry.inputTokens += usage.input_tokens || 0;
    entry.outputTokens += usage.output_tokens || 0;
    entry.costUsd += cost;
    tokens[key] = entry;

    const entries = Object.entries(tokens);
    const trimmed = entries.length > MAX_FEATURES
      ? Object.fromEntries(entries.sort((a, b) => b[1].costUsd - a[1].costUsd).slice(0, MAX_FEATURES))
      : tokens;
    await kv.put('pstats:tokens', JSON.stringify(trimmed));
  } catch (e) { /* real-usage dashboard is best-effort */ }

  // Day-by-day history, for the dashboard's spend-over-time chart — a
  // separate structure from the daily budget-cap counter above (that one
  // expires after 2 days and only ever holds a single float; this one is
  // kept, bounded to MAX_DAILY_ENTRIES, so a real trend can be shown).
  try {
    const daily = (await kv.get('pstats:dailySpend', { type: 'json' })) || {};
    const d = daily[dateKey] || { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    d.calls += 1;
    d.inputTokens += usage.input_tokens || 0;
    d.outputTokens += usage.output_tokens || 0;
    d.costUsd += cost;
    daily[dateKey] = d;

    const dayEntries = Object.entries(daily);
    const trimmedDaily = dayEntries.length > MAX_DAILY_ENTRIES
      ? Object.fromEntries(dayEntries.sort((a, b) => a[0].localeCompare(b[0])).slice(-MAX_DAILY_ENTRIES))
      : daily;
    await kv.put('pstats:dailySpend', JSON.stringify(trimmedDaily));
  } catch (e) { /* real-usage dashboard is best-effort */ }

  // Written once, the first time any real spend is ever recorded — a
  // plain "get, write only if absent" (no atomic compare-and-set in KV,
  // but a rare simultaneous first-write race is harmless here: worst
  // case it's set twice to the same date).
  try {
    const since = await kv.get('pstats:trackingSince');
    if (!since) await kv.put('pstats:trackingSince', dateKey);
  } catch (e) { /* real-usage dashboard is best-effort */ }
}

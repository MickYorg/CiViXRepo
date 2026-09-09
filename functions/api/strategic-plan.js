// Cloudflare Pages Function — Calendar's strategist. Takes a citizen's
// manifesto, gathers real fetched legislative/municipal-event data plus
// the real (deterministic) federal election calendar, and makes ONE
// Claude call to produce a structured multi-year plan: near-term tactical
// moves and longer-term strategic goals. This is a "map," not an
// "execute" surface — every returned item's actionHref points into
// take-action.html, which is where a citizen actually sends/calls/emails.
//
// Deliberately NOT a live-regenerate-per-interaction endpoint: the
// frontend calls this once per distinct manifesto (content-hashed) and
// caches the result — the effort dial and time/detail sliders on
// calendar.html are pure client-side filters over one cached plan, not
// triggers for a new call. See CLAUDE.md's Calendar entry for the full
// design rationale.

import { electionFacts } from '../_lib/election-dates.js';
import { matchBills, slug } from '../_lib/bill-matching.js';

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h — same manifesto, same plan, no new spend on a reload
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 2;
const PRICE_PER_MTOK_INPUT = 2;
const PRICE_PER_MTOK_OUTPUT = 10;

const FED_MATCH_CAP = 20;
const FED_BACKFILL_MIN = 8;
const STATE_MATCH_CAP = 15;
const MUNI_BILL_MATCH_CAP = 10;
const MUNI_EVENT_CAP = 10;

// Short, server-side copy of calendar.html's fixed contingency-scenario
// catalog — id/name/one-line framing only, just enough for the model to
// rank which are most relevant to this citizen via contingencyFocus. The
// full 3-5-item action lists per scenario are hand-authored content that
// lives only in calendar.html (never AI-generated) — if that catalog's
// ids or names change, update this list to match, same manually-synced
// convention functions/_lib/issue-taxonomy.js already documents.
const CONTINGENCY_SCENARIOS = [
  { id: 'economic-crash', name: 'Market / economic crash', framing: "A sharp downturn changes what's politically possible almost overnight." },
  { id: 'armed-conflict', name: 'Armed conflict escalation', framing: 'A war or major escalation shifts near-term legislative attention toward authorizations, defense spending, and civil-liberties tradeoffs.' },
  { id: 'cyberattack', name: 'Major cyberattack / infrastructure breach', framing: 'A significant breach usually triggers fast-moving data-privacy, critical-infrastructure, and tech-regulation bills.' },
  { id: 'climate-disaster', name: 'Natural disaster / climate emergency', framing: 'A major disaster reliably moves disaster-relief funding and resilience/infrastructure bills.' },
  { id: 'public-health-emergency', name: 'Public health emergency', framing: 'A fast-moving health crisis brings emergency-authorization and funding questions into play at all three levels at once.' },
  { id: 'electoral-constitutional-crisis', name: 'Constitutional / electoral crisis', framing: 'A contested election or a serious breach of democratic norms is the moment Democracy-category priorities matter most.' }
];
const CONTINGENCY_SCENARIO_IDS = CONTINGENCY_SCENARIOS.map(s => s.id);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function estimateCost(usage) {
  if (!usage) return 0;
  const inputCost = ((usage.input_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_INPUT;
  const outputCost = ((usage.output_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_OUTPUT;
  return inputCost + outputCost;
}

function secondsUntilMidnightUTC() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return Math.max(1, Math.round((midnight.getTime() - now.getTime()) / 1000));
}

// Same canonical-hash algorithm as calendar.html's client-side copy — kept
// in sync by hand (no shared module between a Function and a plain
// <script>). Deliberately excludes watching/sources/actions/backlog/
// identity/token — see the file comment on canonicalManifestoString below
// for why only issues/traits/jurisdictionLean/zip belong in the hash.
function canonicalManifestoString(input) {
  const issues = (input.issues || [])
    .map(i => ({ id: i.id, weight: i.weight || 1, stance: (i.stance || '').trim() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const traits = (input.traits || []).slice().sort();
  const lean = input.jurisdictionLean || { municipal: 1, state: 1, federal: 1 };
  return JSON.stringify({ issues, traits, lean, zip: input.zip || '' });
}

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function manifestoHash(input) {
  return hashString(canonicalManifestoString(input));
}

function dateSortKey(item) {
  return (item.latestAction && item.latestAction.date) || '';
}

// Ranks bills by manifesto match (score desc, then most-recent action
// first), caps to `cap`, and — if too few real matches exist — backfills
// with the most-recent unmatched bills up to `backfillMin`, so a niche or
// brand-new manifesto still gets real material to reason over instead of
// an empty pool.
function trimPool(bills, issues, cap, backfillMin) {
  const matched = matchBills(bills, issues).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ad = dateSortKey(a.bill), bd = dateSortKey(b.bill);
    if (!ad && !bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return bd.localeCompare(ad);
  });
  const pool = matched.slice(0, cap);
  if (pool.length < backfillMin) {
    const already = new Set(pool.map(m => m.bill));
    const rest = bills
      .filter(b => !already.has(b))
      .slice()
      .sort((a, b) => dateSortKey(b).localeCompare(dateSortKey(a)));
    for (const b of rest) {
      if (pool.length >= backfillMin) break;
      pool.push({ bill: b, score: 0, hits: [] });
    }
  }
  return pool;
}

function billLabel(b) {
  if (b.identifier) return b.identifier;
  return ((b.type || '').toUpperCase() + ' ' + (b.number || '')).trim();
}

function billLine(m) {
  const b = m.bill;
  const text = ((b.latestAction && b.latestAction.text) || '').slice(0, 140);
  const date = (b.latestAction && b.latestAction.date) || 'no date';
  return `- "${b.title}" [${billLabel(b)}] — ${text} (${date})`;
}

function eventLine(e) {
  return `- ${e.body || 'Meeting'} — ${e.date || 'date TBD'} ${e.time || ''} at ${e.location || 'location TBD'}`.trim();
}

function poolBlock(pool, emptyNote) {
  if (!pool.length) return emptyNote;
  return pool.map(billLine).join('\n');
}

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

function buildPrompt({ issues, traits, lean, facts, fedPool, statePool, stateName, muniPool, muniEvents, city }) {
  const issuesBlock = issues.map(i => `- ${i.name} (weight ${i.weight || 1}/3)${i.stance ? `: "${i.stance}"` : ''}`).join('\n');
  const scenarioBlock = CONTINGENCY_SCENARIOS.map(s => `- ${s.id}: ${s.name} — ${s.framing}`).join('\n');

  return `You are a sophisticated, civic-strategy analyst — like a nonpartisan think tank or advocacy group's own internal strategist — working FOR one individual citizen, not for any party, candidate, or institution. Your job is to turn their manifesto into a realistic, multi-year civic strategy: near-term tactical moves and longer-term strategic goals, mapped against real known legislative activity and the real, fixed federal election calendar.

CITIZEN'S MANIFESTO
Issues (name, weight 1-3 where 3 is a high-conviction typed priority, and their own words where given):
${issuesBlock}

Traits: ${traits.length ? traits.join(', ') : 'none recorded'}
Jurisdiction lean (relative weight the citizen already puts on each level of government, from their own past behavior): municipal ${lean.municipal}, state ${lean.state}, federal ${lean.federal}

REAL, FIXED ELECTION-CALENDAR FACTS (computed, not estimates)
- Today: ${facts.todayISO}
- Next federal general election: ${facts.nextGeneralElectionDateISO} (${facts.isNextElectionPresidential ? 'a presidential election year' : 'a midterm election'})
- Current Congress: the ${facts.currentCongressNumber}th, convened ${facts.currentCongressConveneDateISO}
- Next Congress convenes: ${facts.nextCongressConveneDateISO}
- Next presidential inauguration (if applicable): ${facts.nextInaugurationDateISO}
Note: state and local election calendars vary by state/city and are NOT included here — do not invent specific state or local election dates. Where a strategic goal is inherently electoral at the state or local level, describe it in relative/qualitative terms ("your next gubernatorial cycle," "your next city council election") rather than a specific date.

REAL, CURRENTLY-PENDING LEGISLATION AND EVENTS (trimmed to what's most relevant to this citizen — use these where you can, but you're not limited to only these)
-- Federal bills --
${poolBlock(fedPool, '(none fetched this run)')}
-- State bills (${stateName || "citizen's state, unknown"}) --
${poolBlock(statePool, "(no ZIP on file, or this citizen's state isn't returning matches right now)")}
-- Municipal bills (${city || 'not covered for this ZIP'}) --
${poolBlock(muniPool, 'not covered for this ZIP')}
-- Upcoming municipal meetings/hearings --
${muniEvents.length ? muniEvents.map(eventLine).join('\n') : 'not covered for this ZIP, or none scheduled'}

CONTINGENCY SCENARIO CATALOG (fixed, already built into the product — your ONLY job regarding these is to rank which are most relevant to THIS citizen, not to write new content for them)
${scenarioBlock}

WHAT TO PRODUCE
Return ONLY a JSON object (no markdown fences, no commentary) with this exact shape:
{
  "tactical": [ { "title": string, "jurisdiction": "municipal"|"state"|"federal", "issueMatches": [exact issue name(s) from above], "effort": "light"|"moderate"|"heavy", "timeframeDays": integer (approx. days from today), "timeframe": short human label like "Next 30 days" or "This legislative session", "grounded": boolean, "groundedRef": null or {"kind":"bill"|"event","title":string,"date":"YYYY-MM-DD or null","url":string}, "rationale": "exactly 1 short sentence" } ],
  "strategic": [ { "title": string, "jurisdiction": "municipal"|"state"|"federal"|"cross-jurisdiction", "issueMatches": [...], "effort": "light"|"moderate"|"heavy", "horizonMonths": integer (approx. months from today), "horizon": qualitative window e.g. "By the 2026 midterms" or "Over the next two redistricting cycles", "electoral": boolean (true only if grounded in the real election-calendar facts above), "rationale": "1 short sentence" } ],
  "contingencyFocus": [ 2 to 4 scenario ids from the catalog above, most relevant to this citizen first ]
}

Produce 5-7 tactical items and 3-5 strategic items, spread across the jurisdictions this citizen has real signal for — weight jurisdictions loosely by jurisdiction lean above, but don't ignore one just because its number is lower. Every item MUST cite at least one issueMatches name that exactly matches one of the citizen's own listed issue names above. Keep every "title" under 12 words and every "rationale" genuinely short — this plan needs to generate quickly, so terse and concrete beats thorough.

STRATEGIC-GOAL GUARDRAIL (follow exactly)
Some citizens will hold the position that current officeholders have failed and should be removed, AND barred from becoming lobbyists/regulators/consultants afterward — a real, existing policy area (revolving-door and cooling-off-period law). Reason about this in general CIVIC-STRATEGY terms only:
- Never name a specific real elected official, candidate, or public figure.
- Frame accountability goals around the OFFICE/SEAT/CYCLE ("your district's House seat," "your state's governor's race," "your state legislature's majority"), the POLICY LEVER (cooling-off-period and revolving-door legislation, campaign finance and voting-access measures, redistricting timelines), and REAL PROCESS (registering, filing deadlines, organizing, contacting).
- Do not produce attack rhetoric, insults, or language demeaning an individual — every item is a strategic, civic-process action a citizen can actually take, not a statement about a person.

Return ONLY the JSON object.`;
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {})
  });
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

  const issues = Array.isArray(body && body.issues) ? body.issues : [];
  if (!issues.length) {
    return json({ error: { message: 'Add at least one issue to your manifesto before building a Calendar plan.' } }, 400);
  }
  const traits = Array.isArray(body && body.traits) ? body.traits : [];
  const lean = (body && body.jurisdictionLean) || { municipal: 1, state: 1, federal: 1 };
  const zip = (body && body.zip) || '';
  const force = !!(body && body.force);

  const kv = env.DIG_KV;
  const hash = manifestoHash({ issues, traits, jurisdictionLean: lean, zip });
  const cacheKey = `stratplan:${hash}`;

  if (kv && !force) {
    try {
      const cached = await kv.get(cacheKey, { type: 'json' });
      if (cached) return json(Object.assign({}, cached, { cached: true }));
    } catch (e) {
      // fall through to a live generation on a storage hiccup
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
    return json({ error: { message: `Daily budget of $${dailyBudget} reached — resets at UTC midnight. Try again tomorrow.` } }, 402);
  }

  const dailyLimitPerIp = Number(env.STRATPLAN_DAILY_LIMIT_PER_IP || 12);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rateKey = `rate:stratplan:${ip}:${dateKey}`;
  let rateRecord = { count: 0 };
  if (kv) {
    try {
      rateRecord = (await kv.get(rateKey, { type: 'json' })) || { count: 0 };
    } catch (e) {
      rateRecord = { count: 0 };
    }
  }
  if (rateRecord.count >= dailyLimitPerIp) {
    return json(
      { error: { message: `Daily limit of ${dailyLimitPerIp} plans reached for this visitor — resets at UTC midnight.` } },
      429,
      { 'retry-after': String(secondsUntilMidnightUTC()) }
    );
  }
  if (kv) {
    try {
      await kv.put(rateKey, JSON.stringify({ count: (rateRecord.count || 0) + 1 }), { expirationTtl: COUNTER_TTL_SECONDS });
    } catch (e) {}
  }

  // Gather real data via internal same-origin fetches — same precedent as
  // headlines-batch.js calling /api/dig-check and /api/headline-image
  // internally — rather than duplicating congress.gov/OpenStates/Legistar
  // fetch logic here. Each source is allowed to fail independently.
  const origin = new URL(request.url).origin;
  const [fedRes, stateRes, muniRes] = await Promise.allSettled([
    fetchJSON(new URL('/api/calendar', origin)),
    zip ? fetchJSON(new URL('/api/state-bills?zip=' + encodeURIComponent(zip), origin)) : Promise.resolve(null),
    zip ? fetchJSON(new URL('/api/municipal?zip=' + encodeURIComponent(zip), origin)) : Promise.resolve(null)
  ]);

  const fedBills = (fedRes.status === 'fulfilled' && fedRes.value && Array.isArray(fedRes.value.bills)) ? fedRes.value.bills : [];
  const stateData = (stateRes.status === 'fulfilled' && stateRes.value) || {};
  const stateBills = Array.isArray(stateData.bills) ? stateData.bills : [];
  const muniData = (muniRes.status === 'fulfilled' && muniRes.value) || {};
  const muniBills = muniData.covered && Array.isArray(muniData.bills) ? muniData.bills : [];
  const muniEvents = (muniData.covered && Array.isArray(muniData.events) ? muniData.events : []).slice(0, MUNI_EVENT_CAP);

  const fedPool = trimPool(fedBills, issues, FED_MATCH_CAP, FED_BACKFILL_MIN);
  const statePool = trimPool(stateBills, issues, STATE_MATCH_CAP, 0);
  const muniPool = trimPool(muniBills, issues, MUNI_BILL_MATCH_CAP, 0);

  const facts = electionFacts(new Date());

  const prompt = buildPrompt({
    issues, traits, lean, facts,
    fedPool, statePool, stateName: stateData.state || '',
    muniPool, muniEvents, city: muniData.covered ? muniData.city : ''
  });

  // 502/504/521-526 are Cloudflare-reserved "gateway error" status codes —
  // for those specific codes Cloudflare's edge always discards whatever
  // body an origin/Worker actually returns and substitutes its own bare
  // "error code: NNN" plain-text page. Every error path below intentionally
  // avoids those codes (500 instead) so a citizen's browser actually sees
  // this endpoint's own JSON error message instead of a stripped one.
  //
  // The Anthropic call itself is also explicitly time-boxed: an earlier
  // version had no timeout, and a slow, non-streamed, max_tokens:2200
  // generation (rare, but real under load) could run past whatever
  // outbound-connection ceiling sits between here and api.anthropic.com,
  // which surfaces client-side as an opaque failure with no useful
  // message. Aborting explicitly at 25s produces a clear, honest one.
  const ANTHROPIC_TIMEOUT_MS = 25_000;
  let anthropicRes;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        // No web_search tool — this is reasoning over data already fetched
        // above, not a live-lookup task (same posture as plain-summary.js).
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 3200,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const message = e && e.name === 'AbortError'
      ? 'Building your plan is taking longer than usual — try again in a moment.'
      : 'Could not reach Anthropic API';
    return json({ error: { message } }, 500);
  }

  let raw, parsed;
  try {
    raw = await anthropicRes.text();
    parsed = JSON.parse(raw);
  } catch (e) {
    return json({ error: { message: 'Anthropic returned an unparseable response' } }, 500);
  }

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
    return json({ error: { message } }, 500);
  }

  const text = (parsed.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const stripped = text.replace(/^```(json)?/i, '').replace(/```$/i, '').trim();

  // stop_reason 'max_tokens' means the response was cut off mid-generation
  // (almost always mid-JSON, so it'll fail to parse below) — surfaced as
  // its own message rather than the generic "unusable plan" one, since the
  // fix for that case (raise max_tokens, or ask for fewer items) is a
  // different fix than for a genuine malformed-JSON response.
  const truncated = parsed.stop_reason === 'max_tokens';

  let plan;
  try {
    plan = JSON.parse(stripped);
  } catch (e) {
    return json({ error: { message: truncated
      ? 'Your plan was too large to finish generating — try again, or narrow your manifesto\'s priorities.'
      : 'Anthropic returned an unusable plan' } }, 500);
  }

  if (!plan || !Array.isArray(plan.tactical) || !Array.isArray(plan.strategic)) {
    return json({ error: { message: 'Anthropic returned an unusable plan' } }, 500);
  }

  const usedIds = new Set();
  function assignId(title) {
    const base = slug(title) || 'item';
    let id = base, n = 2;
    while (usedIds.has(id)) { id = `${base}-${n}`; n++; }
    usedIds.add(id);
    return id;
  }

  const knownIssueNames = new Set(issues.map(i => i.name));
  function cleanItem(item) {
    if (!item || typeof item.title !== 'string' || !Array.isArray(item.issueMatches)) return null;
    item.id = assignId(item.title);
    item.issueMatches = item.issueMatches.filter(n => knownIssueNames.has(n));
    if (!item.issueMatches.length) return null;
    return item;
  }

  const tactical = plan.tactical.map(cleanItem).filter(Boolean);
  const strategic = plan.strategic.map(cleanItem).filter(Boolean);
  const contingencyFocus = (Array.isArray(plan.contingencyFocus) ? plan.contingencyFocus : [])
    .filter(id => CONTINGENCY_SCENARIO_IDS.indexOf(id) !== -1)
    .slice(0, 4);

  const result = {
    version: 1,
    generatedAt: Date.now(),
    manifestoHash: hash,
    electionFacts: facts,
    tactical,
    strategic,
    contingencyFocus
  };

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
    } catch (e) {}
  }

  return json(Object.assign({}, result, { cached: false }));
}

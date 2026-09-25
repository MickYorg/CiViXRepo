// POST /api/capture-dig — "your team gets on it" for Send to CiViX.
//
// Called by the civix-capture Worker (server to server, shared secret) the
// moment a citizen sends something in from the share sheet, Siri, email or
// the web. Reads what was sent (X posts via X's public oEmbed, other links
// via their page title/description), then one Claude call with web search
// works out what's actually going on, checks any claims, looks for a real
// bill, and ranks the most effective moves. The result is stored with the
// filing and shown in the "Sent to CiViX" feed on Take Action.
//
// Deliberately NOT personalized here: the manifesto never leaves the phone,
// so this never sees it. Matching to the citizen's own priorities and reps
// happens in the app, where the manifesto lives.
import { todayKey, readDailyUsage, recordSpend } from '../_lib/token-stats.js';
import { ALL_ISSUE_NAMES } from '../_lib/issue-taxonomy.js';

const MAX_SOURCE_CHARS = 4000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, '—')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = re.exec(html) || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i').exec(html);
  return m ? stripTags(m[1]) : '';
}

// What the citizen actually sent, as text: best effort, never fatal.
export async function readSource(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (/^(x|twitter|mobile\.twitter)\.com$/.test(host)) {
      const r = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`);
      if (r.ok) {
        const d = await r.json();
        return `Post by ${d.author_name || 'unknown'}: ${stripTags(d.html)}`.slice(0, MAX_SOURCE_CHARS);
      }
      return '';
    }
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CiViX/1.0; +https://mycivix.com)' }, redirect: 'follow' });
    if (!r.ok || !/text\/html/i.test(r.headers.get('content-type') || '')) return '';
    const html = (await r.text()).slice(0, 300000);
    const title = meta(html, 'og:title') || stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
    const desc = meta(html, 'og:description') || meta(html, 'description');
    return [title, desc].filter(Boolean).join('\n').slice(0, MAX_SOURCE_CHARS);
  } catch (e) {
    return '';
  }
}

export function buildPrompt({ title, text, url, source }) {
  return `A citizen using CiViX, a civic engagement app, saw something while scrolling, reading or listening and sent it in. Your job is to be their team: figure out what's actually going on, whether it's accurate, and the most effective things they could do about it. Be even-handed; the citizen's own politics are unknown to you.

What they sent:
${title ? `Title/text: ${title}\n` : ''}${text ? `More text (may include "Why it matters to me:" in their own words): ${text}\n` : ''}${url ? `Link: ${url}\n` : ''}${source ? `Content read from the link:\n${source}\n` : ''}
Use web search to understand the real context: what happened, when, who is involved, and whether any legislation, regulation, hearing, vote or public comment period is connected. Prefer primary and reputable sources.

Reply with ONLY a JSON object, no prose before or after, in this shape:
{
  "headline": "one plain-language line saying what this is really about (max 90 characters)",
  "summary": "2-3 plain sentences: what's actually going on, with the context a citizen needs",
  "kind": "bill" | "policy" | "event" | "claim" | "news" | "other",
  "topic": "the single closest topic from this list: ${ALL_ISSUE_NAMES.join(', ')}",
  "level": "federal" | "state" | "local" | "none",
  "claims": [ { "claim": "a factual claim in what they sent", "assessment": "accurate" | "misleading" | "false" | "unverified", "note": "one sentence why, citing what you found" } ],
  "bill": { "citation": "e.g. H.R. 1234 or S. 56 (federal only)", "congress": 119, "title": "official short title" } or null,
  "moves": [ { "action": "call" | "email" | "comment" | "attend" | "share" | "learn", "title": "short imperative, e.g. Call your senators before Thursday's vote", "why": "one sentence on why this move is effective right now", "target": "who, e.g. your U.S. senators / the FCC public comment docket / your city council" } ],
  "sources": [ { "title": "source name and headline", "url": "https://..." } ]
}
Rules: claims at most 3 (empty list if nothing checkable). moves: 1 to 3, most effective first (a constituent call to their own representative usually beats an email; an open public comment period or upcoming vote/hearing is the highest-leverage moment). Only include a bill if you actually found one; never guess a citation. sources: up to 3 real URLs you used. If what they sent has no civic angle at all, say so plainly in the summary and give one "learn" move.`;
}

// Raw line breaks inside a JSON string are invalid; turn them into spaces
// (only inside strings, tracking quotes and escapes).
function softenNewlinesInStrings(s) {
  let out = '', inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr && c === '\\') { out += c + (s[i + 1] || ''); i++; continue; }
    if (c === '"') inStr = !inStr;
    out += inStr && (c === '\n' || c === '\r') ? ' ' : c;
  }
  return out;
}

export function parseDig(raw) {
  const s = String(raw || '').trim().replace(/^```(json)?/i, '').replace(/```$/i, '').trim();
  let obj;
  const attempt = (t) => { try { return JSON.parse(t); } catch (e) { return undefined; } };
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  const slice = a !== -1 && b > a ? s.slice(a, b + 1) : s;
  obj = attempt(s) ?? attempt(slice) ?? attempt(softenNewlinesInStrings(slice));
  if (obj === undefined) return null;
  if (!obj || typeof obj.headline !== 'string' || typeof obj.summary !== 'string') return null;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  return {
    headline: str(obj.headline, 140),
    summary: str(obj.summary, 800),
    kind: str(obj.kind, 20),
    topic: str(obj.topic, 60),
    level: str(obj.level, 20),
    claims: (Array.isArray(obj.claims) ? obj.claims : []).slice(0, 3).map((c) => ({
      claim: str(c.claim, 300), assessment: str(c.assessment, 20), note: str(c.note, 400),
    })),
    bill: obj.bill && obj.bill.citation ? { citation: str(obj.bill.citation, 30), congress: Number(obj.bill.congress) || null, title: str(obj.bill.title, 200) } : null,
    moves: (Array.isArray(obj.moves) ? obj.moves : []).slice(0, 3).map((m) => ({
      action: str(m.action, 20), title: str(m.title, 140), why: str(m.why, 300), target: str(m.target, 120),
    })),
    sources: (Array.isArray(obj.sources) ? obj.sources : []).slice(0, 3)
      .filter((x) => /^https?:\/\//.test(String(x.url || '')))
      .map((x) => ({ title: str(x.title, 160), url: str(x.url, 500) })),
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.CAPTURE_DIG_SECRET || request.headers.get('X-Capture-Secret') !== env.CAPTURE_DIG_SECRET) {
    return json({ error: { message: 'not allowed' } }, 403);
  }
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: { message: 'Server is missing ANTHROPIC_API_KEY' } }, 500);
  const kv = env.DIG_KV;

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: { message: 'Invalid JSON' } }, 400); }
  const item = { title: String(body.title || '').slice(0, 500), text: String(body.text || '').slice(0, 3000), url: String(body.url || '').slice(0, 1000) };
  if (!item.title && !item.text && !item.url) return json({ error: { message: 'Nothing to dig into' } }, 400);

  const dailyBudget = Number(env.DIG_DAILY_BUDGET_USD || 20);
  const dateKey = todayKey();
  const record = kv ? await readDailyUsage(kv, dateKey) : { spent: 0 };
  if (record.spent >= dailyBudget) {
    return json({ error: { message: `Daily AI budget reached; CiViX will dig in after UTC midnight.` } }, 402);
  }

  const source = await readSource(item.url);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{ role: 'user', content: buildPrompt({ ...item, source }) }],
      }),
    });
  } catch (e) {
    return json({ error: { message: 'Could not reach Anthropic API' } }, 500);
  }
  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return json({ error: { message: 'Anthropic returned an unparseable response' } }, 500); }
  if (kv) { try { await recordSpend(kv, 'capture_dig', parsed.usage, dateKey, record); } catch (e) {} }
  if (!res.ok) return json({ error: { message: (parsed.error && parsed.error.message) || `Anthropic HTTP ${res.status}` } }, 500);

  // With web search, the reply arrives as several text blocks split around
  // citations, sometimes mid-string: join them with nothing, not newlines.
  const text = (parsed.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const dig = parseDig(text);
  if (!dig) {
    // Enough to diagnose without dumping the whole reply.
    const blocks = (parsed.content || []).map((b) => b.type).join(',');
    console.log('capture-dig parse failure', parsed.stop_reason, blocks, text.length, JSON.stringify(text.slice(0, 300)), JSON.stringify(text.slice(-200)));
    return json({ error: { message: `Couldn’t read the analysis (${parsed.stop_reason}, ${text.length} chars)` } }, 500);
  }
  return json({ dig, at: Date.now() });
}

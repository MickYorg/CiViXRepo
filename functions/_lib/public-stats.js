// What may appear on CiViX's public stats (DIG's Community stats panel,
// analytics.html). Added 30 Sep 2026: DIG had been posting every search
// verbatim to a publicly readable counter, so a slur, something illegal or
// a private person's name typed into DIG could sit on a public list, and a
// one-off search could point back at whoever typed it.
//
// The rule: never filter what a citizen looks up, only what becomes public.
//   1. Searches are counted by broad subject (one of CiViX's issue names),
//      never by the words typed. topicCategory() does that mapping.
//   2. Nothing is shown until it's common: PUBLIC_MIN_COUNT.
//   3. A display-only backstop keeps profanity, slurs and anything shaped
//      like personal details off public lists (fitForPublic).
import { ALL_ISSUE_NAMES } from './issue-taxonomy.js';
import { SYNONYMS, slug } from './bill-matching.js';
import { todayKey, readDailyUsage, recordSpend } from './token-stats.js';

export const PUBLIC_MIN_COUNT = 5;

const BLOCKED_WORDS = /\b(fuck\w*|shit\w*|cunt\w*|bitch\w*|asshole\w*|bastard\w*|dick(head)?s?|cock\w*|pussy|pussies|whores?|sluts?|fag(got)?s?|nigg\w*|retard\w*|kikes?|spics?|chinks?|trann(y|ies)|wetbacks?|rape\w*|pedo\w*)\b/i;

// A name is fit for a public list only if it's short, has no profanity or
// slurs, and doesn't look like personal details (email, phone number,
// street address, link).
export function fitForPublic(name) {
  const s = String(name || '').trim();
  if (!s || s.length > 60) return false;
  if (BLOCKED_WORDS.test(s)) return false;
  if (/@|https?:\/\/|www\./i.test(s)) return false;
  if (/\d[\d\s().-]{6,}\d/.test(s)) return false; // phone-number shaped
  if (/\b\d{1,5}\s+\w+(\s+\w+)?\s+(st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive|ct|court|way)\b/i.test(s)) return false;
  return true;
}

// Keeps only entries that are both common and fit to show.
export function publicEntries(map, countOf) {
  return Object.entries(map || {})
    .filter(([name, v]) => countOf(v) >= PUBLIC_MIN_COUNT && fitForPublic(name));
}

function keywordCategory(text) {
  const h = ' ' + String(text || '').toLowerCase() + ' ';
  for (const name of ALL_ISSUE_NAMES) {
    const words = [name.toLowerCase()].concat(SYNONYMS[slug(name)] || []);
    if (words.some(w => new RegExp('\\b' + w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(h))) return name;
  }
  return null;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Maps a typed DIG search onto one of CiViX's issue names, or null when it
// fits none. Keywords first (free); otherwise one short AI classification,
// cached by a hash of the text (the text itself is never stored), and only
// while the shared daily AI budget allows.
export async function topicCategory(text, env) {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!normalized) return null;
  const byKeyword = keywordCategory(normalized);
  if (byKeyword) return byKeyword;

  const kv = env.DIG_KV;
  const cacheKey = 'topiccat:v1:' + await sha256(normalized);
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached !== null) return cached === 'none' ? null : cached;
    } catch (e) { /* fall through */ }
  }
  if (!env.ANTHROPIC_API_KEY) return null;

  const dateKey = todayKey();
  const record = await readDailyUsage(kv, dateKey);
  if (record.spent >= Number(env.DIG_DAILY_BUDGET_USD || 20)) return null;

  let category = null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 256,
        thinking: { type: 'disabled' },
        messages: [{
          role: 'user',
          content: `Which one of these civic issues is this search about? Reply with the issue name exactly as written, or None if it fits none of them.\n\nIssues: ${ALL_ISSUE_NAMES.join('; ')}\n\nSearch: ${normalized}`
        }]
      })
    });
    const parsed = await res.json();
    if (kv) { try { await recordSpend(kv, 'dig_topic_category', parsed.usage, dateKey, record); } catch (e) {} }
    if (res.ok) {
      const reply = (parsed.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim().toLowerCase();
      category = ALL_ISSUE_NAMES.find(n => reply.replace(/[."']/g, '') === n.toLowerCase()) || null;
    } else {
      return null; // not cached: a later search can try again
    }
  } catch (e) {
    return null;
  }
  if (kv) { try { await kv.put(cacheKey, category || 'none', { expirationTtl: 60 * 60 * 24 * 90 }); } catch (e) {} }
  return category;
}

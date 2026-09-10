// Shared congress.gov bill-shaping helpers — split out of calendar.js
// 10 Sep 2026 so functions/api/bill-lookup.js (a direct single-bill fetch,
// for when a citizen names a specific real bill that isn't in
// calendar.js's own top-100-most-recently-updated window) can produce the
// exact same slim shape without duplicating this logic a second time.

const TYPE_SLUG = {
  hr: 'house-bill',
  s: 'senate-bill',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution',
  sres: 'senate-resolution'
};

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function publicUrl(bill) {
  const slug = TYPE_SLUG[String(bill.type || '').toLowerCase()];
  if (!slug || !bill.congress || !bill.number) return null;
  return `https://www.congress.gov/bill/${ordinal(bill.congress)}-congress/${slug}/${bill.number}`;
}

// congress.gov's list endpoint (unlike its per-bill detail endpoint) has
// no categorical "status"/"stage" field — just latestAction.text, free
// text like "Referred to the Committee on..." or "Became Public Law
// No. 119-4". This pattern-matches the most recent action's own text
// against congress.gov's own bill-tracker stage names. It's a heuristic
// read of the latest action, not a guaranteed-authoritative field — order
// matters here (most-advanced stage checked first) since latestAction
// only ever reflects the bill's single most recent action.
const STATUS_PATTERNS = [
  { status: 'Became Law', re: /became public law|public law no\./i },
  { status: 'Vetoed', re: /vetoed by (the )?president/i },
  { status: 'To President', re: /presented to president/i },
  { status: 'Passed Senate', re: /passed senate|passed\/agreed to in senate/i },
  { status: 'Passed House', re: /passed house|passed\/agreed to in house/i },
  { status: 'Reported by Committee', re: /committee reported|reported.*committee/i },
  { status: 'In Committee', re: /referred to (the )?(committee|subcommittee)/i }
];
function deriveStatus(latestActionText) {
  const text = latestActionText || '';
  for (const p of STATUS_PATTERNS) {
    if (p.re.test(text)) return p.status;
  }
  return 'Introduced';
}

function slim(bill) {
  return {
    congress: bill.congress,
    type: bill.type,
    number: bill.number,
    title: bill.title || '',
    latestAction: bill.latestAction ? { date: bill.latestAction.actionDate, text: bill.latestAction.text } : null,
    status: deriveStatus(bill.latestAction && bill.latestAction.text),
    updateDate: bill.updateDate || null,
    url: publicUrl(bill)
  };
}

export { TYPE_SLUG, ordinal, publicUrl, STATUS_PATTERNS, deriveStatus, slim };

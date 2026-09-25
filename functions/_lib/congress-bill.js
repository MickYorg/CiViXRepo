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
  // Senate simple resolutions are "Submitted in the Senate, considered, and
  // agreed to" / "Resolution agreed to in Senate" — that is passage.
  // "Senate agreed to the House amendment" = the Senate's final step on a
  // bill both chambers have now passed.
  { status: 'Passed Senate', re: /passed senate|passed\/agreed to in senate|agreed to in (the )?senate|senate agreed to|considered,? and agreed to/i },
  // A bill "Received in the Senate" / "Held at the desk" has passed the House.
  // "Motion to reconsider laid on the table" is the House's routine
  // follow-up right after a successful vote.
  { status: 'Passed House', re: /passed house|passed\/agreed to in house|agreed to in (the )?house|house agreed to|received in the senate|held at the desk|motion to reconsider laid on the table|title of the measure was amended/i },
  // "Placed on the Union/House Calendar" follows a committee report; the
  // Senate's "Placed on Senate Legislative Calendar" means it's awaiting
  // floor action (sometimes without going through committee at all).
  { status: 'Reported by Committee', re: /committee reported|reported.*committee|ordered to be reported|filed written report|placed on the (union|house) calendar/i },
  { status: 'On Floor Calendar', re: /placed on (the )?senate legislative calendar|placed on (the )?calendar/i },
  // 24 Sep 2026: this used to require "referred to the committee", so the
  // House's standard "Referred to the House Committee on …" (and hearings /
  // markups) fell through to 'Introduced' — ~40% of live bills mislabeled.
  { status: 'In Committee', re: /referred to (the )?((house|senate) )?(committee|subcommittee)|hearings? held|mark-?up session held|committee consideration/i }
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

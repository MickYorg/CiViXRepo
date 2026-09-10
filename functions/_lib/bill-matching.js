// Manually-synced server-side copy of digest.js's slug()/keywordsFor()/
// scoreAgainstIssues()/matchBills() — needed because Cloudflare Pages
// Functions can't import a browser <script> global the way client pages
// do. Used only by functions/api/strategic-plan.js, to rank/trim fetched
// bill pools against a manifesto before they're sent into an AI prompt —
// not a new source of truth for anything client-facing. If digest.js's
// SYNONYMS map or matching heuristic changes, update this file to match —
// same sync caveat functions/_lib/issue-taxonomy.js already documents for
// its own copy of builder.html's CATALOG.

export const SYNONYMS = {
  'wages-and-labor': ['minimum wage', 'wage', 'labor', 'union', 'worker', 'overtime'],
  'taxes': ['tax', 'taxes', 'irs', 'tax credit', 'tax cut'],
  'cost-of-living': ['inflation', 'cost of living', 'affordability'],
  'small-business': ['small business', 'entrepreneur'],
  'trade-and-tariffs': ['tariff', 'trade', 'import', 'export'],
  'healthcare-access': ['healthcare', 'health care', 'medicaid', 'medicare', 'insurance'],
  'drug-pricing': ['drug price', 'prescription drug', 'pharmaceutical', 'insulin'],
  'public-health': ['public health', 'cdc', 'disease', 'vaccine'],
  'reproductive-health': ['abortion', 'reproductive', 'contraception'],
  'mental-health': ['mental health', 'suicide', 'substance abuse', 'opioid'],
  'housing-affordability': ['housing', 'affordable housing', 'rent'],
  'zoning-and-development': ['zoning', 'land use', 'development'],
  'homelessness': ['homeless', 'homelessness', 'shelter'],
  'tenant-rights': ['tenant', 'landlord', 'eviction'],
  'public-schools': ['school', 'k-12', 'education funding', 'teacher'],
  'higher-education-cost': ['student loan', 'college', 'university', 'tuition'],
  'curriculum-and-books': ['curriculum', 'book ban', 'textbook'],
  'childcare': ['childcare', 'child care', 'daycare'],
  'climate-policy': ['climate', 'emissions', 'carbon', 'greenhouse gas'],
  'energy-costs': ['energy', 'electricity', 'utility', 'fuel'],
  'water-and-air-quality': ['water quality', 'air quality', 'pollution', 'clean water', 'clean air'],
  'public-lands': ['public lands', 'national park', 'forest service', 'wilderness'],
  'policing': ['police', 'policing', 'law enforcement'],
  'criminal-justice-reform': ['criminal justice', 'sentencing', 'incarceration', 'prison'],
  'gun-policy': ['gun', 'firearm', 'second amendment'],
  'courts': ['court', 'judiciary', 'judge'],
  'voting-access': ['voting', 'voter', 'ballot', 'election'],
  'redistricting': ['redistricting', 'gerrymander'],
  'campaign-finance': ['campaign finance', 'super pac', 'election spending'],
  'government-transparency': ['transparency', 'foia', 'open government'],
  'data-privacy': ['data privacy', 'privacy'],
  'ai-regulation': ['artificial intelligence', ' ai '],
  'platform-accountability': ['social media', 'platform', 'section 230'],
  'broadband-access': ['broadband', 'internet access', 'rural broadband'],
  'transit': ['transit', 'bus', 'rail', 'public transportation'],
  'roads-and-bridges': ['infrastructure', 'road', 'bridge', 'highway'],
  'immigration': ['immigration', 'immigrant', 'border', 'visa', 'asylum'],
  'rural-access': ['rural']
};

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// 10 Sep 2026: kept in sync with digest.js's own copy — plain substring
// search (`indexOf`) has no concept of word boundaries, so a short/common
// keyword can silently match inside an unrelated longer word (confirmed
// live: "high," from a citizen's own stance text, matched inside "Higher
// Education Act"). See digest.js's own comment for the full story.
function matchesWord(haystack, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + escaped + '\\b').test(haystack);
}

// 10 Sep 2026: kept in sync with digest.js's own copy — word-boundary
// matching alone still lets a short/generic word be a real whole-word
// false positive (confirmed live: "National Defense Authorization Act
// for Fiscal Year 2027" false-matched "National Fossil Act of 2026" via
// the bare word "National"). See digest.js's own comment for the story.
const LOOSE_WORD_STOPLIST = new Set([
  'national', 'federal', 'government', 'public', 'state', 'states', 'america', 'american',
  'united', 'act', 'authorization', 'authorize', 'authorizing', 'committee', 'department',
  'agency', 'program', 'programs', 'service', 'services', 'fiscal', 'year', 'years',
  'congress', 'congressional', 'law', 'legislation', 'bill', 'amendment', 'amendments',
  'section', 'title', 'general', 'office', 'administration', 'policy', 'affairs', 'related',
  'certain', 'other', 'purposes', 'require', 'requires', 'establish', 'establishes',
  'provide', 'provides', 'improve', 'improving', 'support', 'supporting', 'protection',
  'protecting', 'reform', 'modernization', 'accountability'
]);
function looseWords(text) {
  return (text || '').toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !LOOSE_WORD_STOPLIST.has(w));
}

export function keywordsFor(issue) {
  const extra = SYNONYMS[issue.id] || [];
  return [(issue.name || '').toLowerCase()].concat(extra, looseWords(issue.name), looseWords(issue.stance));
}

export function scoreAgainstIssues(hay, issues) {
  const h = (hay || '').toLowerCase();
  const hits = [];
  let score = 0;
  (issues || []).forEach(issue => {
    const kws = keywordsFor(issue);
    if (kws.some(k => matchesWord(h, k))) {
      score += issue.weight || 1;
      hits.push(issue.name);
    }
  });
  return { score, hits };
}

// 10 Sep 2026: kept in sync with digest.js's own copy of this same fix —
// see its comment for the full story (a purely ceremonial resolution
// matched a citizen's real priority only because its committee-referral
// note happened to contain a generic word from that issue's own name).
// Curated SYNONYMS + the issue's full name are specific enough to trust
// anywhere in a bill's title + latest action; the loose, single-word
// extraction only matches against the title now, not committee-name
// boilerplate.
function curatedKeywordsFor(issue) {
  return [(issue.name || '').toLowerCase()].concat(SYNONYMS[issue.id] || []);
}
function looseKeywordsFor(issue) {
  return looseWords(issue.name).concat(looseWords(issue.stance));
}

export function matchBills(bills, issues) {
  const scored = (bills || []).map(bill => {
    const title = (bill.title || '').toLowerCase();
    const full = title + ' ' + (bill.latestAction ? (bill.latestAction.text || '').toLowerCase() : '');
    const hits = [];
    let score = 0;
    (issues || []).forEach(issue => {
      const matched = curatedKeywordsFor(issue).some(k => matchesWord(full, k))
        || looseKeywordsFor(issue).some(k => matchesWord(title, k));
      if (matched) {
        score += issue.weight || 1;
        hits.push(issue.name);
      }
    });
    return { bill, score, hits };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
}

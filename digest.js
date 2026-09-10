// digest.js — shared "what should this citizen actually do right now"
// engine. Single source of truth for matching manifesto issues against
// federal/state bills (previously duplicated only in take-action.html —
// moved here so builder.html's Citizen-mode digest and take-action.html's
// own lists can't drift the way index.html/builder.html's hasManifesto
// check once did) plus two additions:
//   - Docket items filed via Send to CiViX feed into the same ranked pool
//     as legislative matches, via the same AI topic-classification already
//     used for Inbox triage (civix-inbox-topics), not a separate mechanism.
//   - A cached, AI-backed plain-language one-liner for any bill/item, so
//     raw legislative text ("Referred to the Subcommittee on...") doesn't
//     have to be the thing a citizen reads first.
(function () {
  'use strict';
  if (window.CivixDigest) return;

  const CAPTURE_API = 'https://civix-capture.mycivix.workers.dev';
  const INBOX_TOPICS_KEY = 'civix-inbox-topics'; // shared with builder.html's Inbox
  const SUMMARY_KEY = 'civix-plain-summaries';

  // ---- Matching (moved from take-action.html) ---------------------------
  const SYNONYMS = {
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

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // 10 Sep 2026: every keyword check in this file used plain substring
  // search (`hay.indexOf(k) !== -1`) — confirmed live as a second,
  // distinct false-positive source beyond the committee-boilerplate one
  // fixed the same day: the loose word "high" (pulled from a citizen's
  // own stance text, "rent is too high...") silently matched inside
  // "Higher Education Act," a bill with nothing to do with housing.
  // Substring search has no concept of word boundaries, so any short or
  // common keyword ("high", "act", "rent") can hide inside an unrelated
  // longer word. Word-boundary matching is strictly more correct for
  // every keyword here — curated phrases and loose single words alike —
  // with no legitimate case that depended on the old partial-word
  // behavior.
  function matchesWord(haystack, phrase) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '\\b').test(haystack);
  }

  // 4 Sep 2026: matching used to run only against the fixed taxonomy name
  // and its hand-authored SYNONYMS — real, specific-enough asks a citizen
  // actually types ("release the Epstein files," "defund Flock
  // surveillance," "country of origin beef labeling") get force-classified
  // onto one of ~40 broad buckets (see builder.html's
  // classifyFreeformPriority()) whose SYNONYMS were written for the
  // bucket in general, not for whatever specific proper nouns a citizen
  // actually cares about — so a bill titled "American Beef Labeling Act"
  // or "Epstein Files Transparency Act" could sit right in the fetched
  // pool and never match, because "beef"/"labeling"/"Epstein" appear
  // nowhere in trade-and-tariffs' or government-transparency's synonym
  // lists. issue.stance (the citizen's own typed words, preserved by
  // builder.html's mergeStance() even when several distinct priorities
  // share one bucket) is real signal specifically for this — same >=4-char
  // heuristic already applied to the topic name itself.
  // 10 Sep 2026: word-boundary matching (see matchesWord() above) closed
  // the "high" hiding inside "Higher" class of false positive, but a
  // short/generic word can still be a real whole word in two totally
  // unrelated bills — confirmed live: "National Defense Authorization
  // Act for Fiscal Year 2027" is a citizen's own specific priority, but
  // the model isn't confident enough to resolve it to a real citation
  // (a very recent bill; see buildTopDigest()'s own comment), so it
  // falls through to this loose word extraction — and nearly every word
  // in that official title ("National," "Defense," "Fiscal," "Year") is
  // generic legislative-institution vocabulary that plenty of unrelated
  // bills also legitimately contain as whole words ("National Fossil
  // Act of 2026" false-matched this exact way). A fixed stoplist of
  // common bureaucratic filler isn't a complete fix — no stoplist ever
  // is — but it directly closes this specific, confirmed class of bug.
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
    return text.toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !LOOSE_WORD_STOPLIST.has(w));
  }

  function keywordsFor(issue) {
    const extra = SYNONYMS[issue.id] || [];
    return [issue.name.toLowerCase()].concat(extra, looseWords(issue.name), looseWords(issue.stance || ''));
  }

  // Scores one haystack of text against a citizen's issues — the per-item
  // core that both matchBills() and docket matching share.
  function scoreAgainstIssues(hay, issues) {
    const h = hay.toLowerCase();
    const hits = [];
    let score = 0;
    issues.forEach(issue => {
      const kws = keywordsFor(issue);
      if (kws.some(k => matchesWord(h, k))) {
        score += issue.weight || 1;
        hits.push(issue.name);
      }
    });
    return { score, hits };
  }

  // 10 Sep 2026: matchBills() (bills specifically, not docket items —
  // scoreAgainstIssues() above is unchanged and still shared with docket
  // matching) split its keyword scoring into two tiers after a live,
  // confirmed false-positive: a purely ceremonial resolution ("Liturgical
  // Dance Day") ranked into a citizen's real top-3 because its ONLY
  // matching text was "Referred to the House Committee on Oversight and
  // Government Reform" — the bare word "government" (from
  // keywordsFor()'s loose nameWords extraction on "Government
  // transparency") happened to appear in a committee's bureaucratic name,
  // nothing to do with the resolution's actual (nonexistent) substance.
  // Congressional committee names are themselves built from generic
  // policy-area words, which makes any bill's latestAction/committee-
  // referral text an unusually bad place to trust single generic-word
  // matches. Curated SYNONYMS entries and the issue's own full name (both
  // specific, low-false-positive-risk phrases) still match anywhere in a
  // bill's title + latest action; the loose, single-word extraction
  // (nameWords/stanceWords — real signal for a citizen's own specific
  // typed priorities, per the 4 Sep 2026 note above) now only matches
  // against the bill's own title, where a generic word is at least about
  // the bill itself rather than which committee happened to receive it.
  function curatedKeywordsFor(issue) {
    return [issue.name.toLowerCase()].concat(SYNONYMS[issue.id] || []);
  }
  function looseKeywordsFor(issue) {
    return looseWords(issue.name).concat(looseWords(issue.stance || ''));
  }
  function scoreBillAgainstIssues(bill, issues) {
    const title = (bill.title || '').toLowerCase();
    const full = title + ' ' + ((bill.latestAction && bill.latestAction.text) || '').toLowerCase();
    const hits = [];
    let score = 0;
    issues.forEach(issue => {
      const matched = curatedKeywordsFor(issue).some(k => matchesWord(full, k))
        || looseKeywordsFor(issue).some(k => matchesWord(title, k));
      if (matched) {
        score += issue.weight || 1;
        hits.push(issue.name);
      }
    });
    return { score, hits };
  }

  function matchBills(bills, issues) {
    const scored = bills.map(bill => {
      const { score, hits } = scoreBillAgainstIssues(bill, issues);
      return { bill, score, hits };
    });
    return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  }

  // ---- Fetching ----------------------------------------------------------
  async function fetchFederalBills() {
    const r = await fetch('/api/calendar');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data.error) throw new Error(data.error.message || 'error');
    return data.bills || [];
  }

  async function fetchStateBills(zip) {
    if (!zip) return { bills: [], state: '' };
    const r = await fetch('/api/state-bills?zip=' + encodeURIComponent(zip));
    const data = await r.json();
    if (!r.ok || data.error) throw new Error((data.error && data.error.message) || 'HTTP ' + r.status);
    return { bills: data.bills || [], state: data.state || '' };
  }

  // Municipal wasn't part of the digest at all before 31 Aug 2026 — added
  // alongside jurisdiction-lean weighting (see buildTopDigest) so a
  // citizen who cares most about local government can actually have that
  // show up in their top 3, not just federal/state. `covered: false`
  // (an uncovered city) is a normal, silent no-op here, same as it is on
  // take-action.html — not an error.
  async function fetchMunicipalBills(zip) {
    if (!zip) return { bills: [], covered: false };
    const r = await fetch('/api/municipal?zip=' + encodeURIComponent(zip));
    const data = await r.json();
    if (!r.ok || data.error) throw new Error((data.error && data.error.message) || 'HTTP ' + r.status);
    return { bills: data.bills || [], covered: !!data.covered };
  }

  async function fetchDocketItems(token) {
    if (!token) return [];
    const r = await fetch(CAPTURE_API + '/api/filings?token=' + encodeURIComponent(token));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    return (d.items || []).filter(i => i.state === 'docket');
  }

  // 10 Sep 2026: matches a federal bill citation (H.R./S./H.Res./S.Res./
  // H.J.Res./S.J.Res./H.Con.Res./S.Con.Res. + a number) in whatever
  // punctuation/spacing a citizen actually typed ("H.R.9694", "HR 9694",
  // "hr9694" all match). Longer/more specific type tokens are tried
  // before their shorter substrings (HJRES before HR, SRES before S) so
  // e.g. "H.RES.1517" can't accidentally resolve as type "hr". Used by
  // buildTopDigest() to try a direct congress.gov lookup (see
  // lookupBillDirect()) before ever falling back to the unconditional
  // "general priority" scoring further down.
  const BILL_TYPE_TOKENS = ['HJRES', 'SJRES', 'HCONRES', 'SCONRES', 'HRES', 'SRES', 'HR', 'S'];
  const BILL_TYPE_MAP = { HJRES: 'hjres', SJRES: 'sjres', HCONRES: 'hconres', SCONRES: 'sconres', HRES: 'hres', SRES: 'sres', HR: 'hr', S: 's' };
  function parseBillCitation(text) {
    if (!text) return null;
    const cleaned = text.toUpperCase().replace(/\./g, '');
    const re = new RegExp('\\b(' + BILL_TYPE_TOKENS.join('|') + ')\\s*(\\d{1,6})\\b');
    const m = cleaned.match(re);
    if (!m) return null;
    return { type: BILL_TYPE_MAP[m[1]], number: m[2] };
  }

  // Best-effort direct fetch of one specific, named bill — null on any
  // failure (not found, congress.gov hiccup, missing key) so the caller
  // can fall through to the general-priority path rather than breaking
  // the whole digest over one lookup. `congress` is only ever present on
  // an AI-resolved citation (builder.html's classifyFreeformPriority()) —
  // a citizen-typed literal citation (parseBillCitation() above) has no
  // way to know which Congress, so bill-lookup.js's own default
  // (current Congress) applies instead.
  async function lookupBillDirect(citation) {
    try {
      const congressParam = citation.congress ? `&congress=${encodeURIComponent(citation.congress)}` : '';
      const r = await fetch(`/api/bill-lookup?type=${encodeURIComponent(citation.type)}&number=${encodeURIComponent(citation.number)}${congressParam}`);
      if (!r.ok) return null;
      const data = await r.json();
      return (data && data.bill) ? data.bill : null;
    } catch (e) {
      return null;
    }
  }

  // 10 Sep 2026: "NDAA" without a year genuinely can't be resolved from
  // the model's own memory (a very recent bill, and the citizen pushed
  // back, fairly, that treating this as unresolvable "hogwash" — in
  // common usage "the NDAA" always means whichever one is currently
  // active, not some unspecified year). Two narrower attempts confirmed-
  // live before this one worked: buildTopDigest()'s own already-fetched
  // federal pool (only ~100 items) didn't contain it, and neither did a
  // single 250-item page from bill-search.js — the real, currently-
  // active NDAA can rank well outside even that on a quiet week between
  // its own floor actions. bill-search.js now pages 6 requests deep
  // (1,500 bills) to actually find it — real, current data instead of a
  // memorized fact that may not even be in the model's training window.
  // Extensible to other well-known recurring/annual bills later; NDAA is
  // the one actually reported live so far.
  const RECURRING_BILL_PATTERNS = [
    { mention: /\bndaa\b/i, phrase: 'national defense authorization act' }
  ];
  function recurringBillPatternFor(issue) {
    const text = (issue.name || '') + ' ' + (issue.stance || '');
    return RECURRING_BILL_PATTERNS.find(p => p.mention.test(text)) || null;
  }
  async function lookupRecurringBillDirect(pattern) {
    try {
      const r = await fetch('/api/bill-search?title=' + encodeURIComponent(pattern.phrase));
      if (!r.ok) return null;
      const data = await r.json();
      return (data && data.bill) ? data.bill : null;
    } catch (e) {
      return null;
    }
  }

  // ---- AI helpers (both hit /api/dig-check, both cached) -----------------
  async function digCheckCall(prompt) {
    const r = await fetch('/api/dig-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { const b = await r.json(); if (b.error && b.error.message) msg = b.error.message; } catch (e) {}
      throw new Error(msg);
    }
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) throw new Error('empty response');
    return text;
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  // Same prompt shape and cache (civix-inbox-topics) builder.html's Inbox
  // already uses — a docket item classified once, from either surface,
  // never costs a second AI call.
  async function classifyDocketItem(item) {
    const topics = loadJSON(INBOX_TOPICS_KEY, {});
    const cached = topics[item.id];
    if (cached && cached.topic) return cached.topic;
    try {
      const prompt = `Someone captured this item into a civic-engagement inbox and it needs to be placed under a general, ongoing policy topic — not the specific headline itself.

Captured item: "${item.title}"${item.note ? `\nTheir note: "${item.note}"` : ''}${item.host ? `\nSource: ${item.host}` : ''}

Reply with ONLY a short phrase of 3-7 words naming the broad, durable policy area this falls under (e.g. "Housing affordability", "Immigration and border policy", "Criminal justice reform") — general enough that it would still make sense as a topic next month, not tied to this one event. No markdown, no explanation, no surrounding quotes.`;
      const topic = (await digCheckCall(prompt)).replace(/^["']|["']$/g, '').trim();
      topics[item.id] = { topic, at: Date.now() };
      saveJSON(INBOX_TOPICS_KEY, topics);
      return topic;
    } catch (e) {
      return item.title; // fall back to the raw title — still usable for matching
    }
  }

  // Rewrites a bill's title + raw legislative action text into one plain
  // sentence. Cached locally per bill id first (this browser's own copy,
  // for an instant repeat view with no network round-trip at all), then
  // against /api/plain-summary's own server-side KV cache (2 Sep 2026,
  // new — see that file's own comment) — a bill only ever costs one real
  // Anthropic call, period, shared across every citizen who's ever asked,
  // not once per browser the way this used to work when it called
  // /api/dig-check directly with a fresh prompt every time a browser
  // hadn't personally seen that bill before.
  async function plainSummarize(id, title, actionText) {
    const cache = loadJSON(SUMMARY_KEY, {});
    if (cache[id]) return cache[id].text;
    try {
      const r = await fetch('/api/plain-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title, actionText })
      });
      const data = await r.json();
      if (!r.ok || data.error || !data.text) return null;
      cache[id] = { text: data.text, at: Date.now() };
      saveJSON(SUMMARY_KEY, cache);
      return data.text;
    } catch (e) {
      return null; // caller falls back to the raw text
    }
  }

  // ---- The digest itself ---------------------------------------------
  // Normalizes federal bills, state bills, and docket items into one
  // shape, scores all of them against the citizen's declared issues (a
  // docket item goes through the exact same scoreAgainstIssues() call a
  // bill does, once classified — "as if it was a match," not a separate
  // always-included lane), and returns the top `limit`.
  function billEntry(kind, bill, hits, score) {
    const label = (bill.type || '').toUpperCase() + ' ' + (bill.number || bill.identifier || '');
    return {
      kind, hits, score, bill, // the full bill object travels with the entry —
      // take-action.html's focus view uses it to open the Take Action modal
      // directly on a federal entry, instead of only linking to a filtered list
      title: bill.title,
      label: label.trim(),
      rawSummary: bill.latestAction ? bill.latestAction.text : '',
      summaryId: bill.identifier || (bill.congress + '-' + bill.type + bill.number),
      url: bill.url || '',
      actionHref: 'take-action.html' + (hits.length ? '?focus=' + encodeURIComponent(slug(hits[0])) : '')
    };
  }

  async function buildTopDigest(profile, opts) {
    opts = opts || {};
    const limit = opts.limit || 3;
    const allIssues = (profile && profile.issues) || [];
    const zip = profile && profile.place && profile.place.zip;
    const results = [];

    // 10 Sep 2026: an issue that names one specific, citable bill
    // ("Epstein Files Transparency Act II", "the CHIPS Act") must NEVER
    // be run through the generic pool keyword-matching below — confirmed
    // live, with a citizen's own real top-3, that it produces real,
    // damaging false positives: that exact issue's own loose words
    // ("transparency") false-matched a totally unrelated "Fiscal
    // Sponsorship Transparency Act," and "NDAA for Fiscal Year 2027"
    // false-matched multiple unrelated ceremonial resolutions the same
    // way — a specific bill's name is full of short, generic words
    // ("act," "transparency," "national") that plenty of OTHER bills'
    // titles also happen to contain. Worse than a cosmetic wrong tag:
    // that false match satisfied the "already matched" check the
    // citation-lookup step below relies on, so the CORRECT bill (found
    // via direct lookup) never even got a chance to run. Split up front
    // instead: a citable issue is resolved via direct lookup only, full
    // stop, never fed into matchBills()'s keyword search at all.
    const citable = [];
    const poolIssues = [];
    allIssues.forEach(i => {
      const citation = (i.weight === 3 && i.stance)
        ? (i.billCitation || parseBillCitation(i.name) || parseBillCitation(i.stance))
        : null;
      if (citation) citable.push({ issue: i, citation });
      else poolIssues.push(i);
    });

    const [fed, state, municipal, docket] = await Promise.allSettled([
      fetchFederalBills(),
      fetchStateBills(zip),
      fetchMunicipalBills(zip),
      fetchDocketItems(profile && profile.token)
    ]);

    // A well-known recurring/annual bill referred to by its common
    // acronym alone ("NDAA," no year) has no formal citation to parse
    // and isn't something the model can safely guess a number for from
    // memory — but "the current one" is a real, searchable fact via
    // bill-search.js's wider lookup. Resolved matches are pulled out of
    // poolIssues before generic matching runs, same reasoning as the
    // citable split above: this issue's own name is exactly as prone to
    // false-positive keyword matches as any other specific-bill
    // reference, so it shouldn't go through that path too.
    const recurringResolved = [];
    for (let idx = poolIssues.length - 1; idx >= 0; idx--) {
      const i = poolIssues[idx];
      if (i.weight !== 3 || !i.stance) continue;
      const pattern = recurringBillPatternFor(i);
      if (!pattern) continue;
      const bill = await lookupRecurringBillDirect(pattern);
      if (bill) {
        recurringResolved.push({ issue: i, bill });
        poolIssues.splice(idx, 1);
      }
    }

    if (fed.status === 'fulfilled' && poolIssues.length) {
      matchBills(fed.value, poolIssues).forEach(m => results.push(billEntry('federal', m.bill, m.hits, m.score)));
    }
    if (state.status === 'fulfilled' && poolIssues.length) {
      matchBills(state.value.bills, poolIssues).forEach(m => results.push(billEntry('state', m.bill, m.hits, m.score)));
    }
    if (municipal.status === 'fulfilled' && municipal.value.covered && poolIssues.length) {
      matchBills(municipal.value.bills, poolIssues).forEach(m => results.push(billEntry('municipal', m.bill, m.hits, m.score)));
    }

    // Before ever falling back to the unconditional "general priority"
    // scoring further down, resolve every citable issue split out above
    // via a direct congress.gov lookup. The pools fetched above are each
    // only the ~100 most-recently-updated items for their jurisdiction —
    // a real, specific bill a citizen actually named can easily not be
    // in that window on a given day (confirmed live: H.R.9694 wasn't),
    // and real people don't talk in bill numbers anyway ("the CHIPS
    // Act," "Obamacare," "the Patriot Act," "NDAA" is how this actually
    // gets typed) — issue.billCitation (set by builder.html's
    // classifyFreeformPriority() when the model confidently resolves a
    // popular name to a real citation) is tried first, a citizen-typed
    // literal citation the regex can find is the fallback. Deliberately
    // NOT gated on a keyword-overlap sanity check against the fetched
    // bill's title — tried that, and it broke the exact case this
    // exists to fix: "Obamacare" correctly resolves to H.R.3590
    // ("Patient Protection and Affordable Care Act"), which shares zero
    // words with the popular name a citizen actually typed, by design —
    // that's what a popular name *is*. The real safety net is the
    // citizen-facing confirm screen (renderFreeformConfirm() shows
    // "Matched to HR 3590, 111th Congress" before committing) plus
    // bill-lookup.js's own 404 on a citation that doesn't exist at all.
    // Runs before the jurisdiction-lean block below on purpose, so a
    // bill found this way gets weighted the same way as any other
    // federal match rather than skipping that step.
    for (const { issue: i, citation } of citable) {
      const bill = await lookupBillDirect(citation);
      if (bill) {
        const entry = billEntry('federal', bill, [i.name], i.weight);
        // Confirmed live 10 Sep 2026: scoring this the same as an
        // ordinary keyword match (i.weight alone, ~1-9 after lean) was
        // a real regression, not just "more correct" — a citizen who
        // explicitly named a specific bill (directly, or via a common
        // name like "the CHIPS Act") could still fail to see it in
        // their own top-3, buried behind a pile of *other* priorities'
        // incidental keyword ties that happened to come first in
        // insertion order. Naming an exact bill is a stronger, more
        // deliberate signal than an algorithm finding a keyword in a
        // bill's text — it should consistently surface, without going
        // back to the old score:1000+ that let it unconditionally beat
        // even a citizen's OTHER equally-explicit priorities. +50
        // clears any realistic tie from ordinary matching while still
        // letting several cited bills rank fairly among each other.
        entry.score = 50 + i.weight;
        results.push(entry);
      }
    }

    // Same treatment for a recurring/annual bill resolved via
    // lookupRecurringBillDirect() — a real, current match, not a guess,
    // so it earns the same score boost a direct citation lookup gets.
    recurringResolved.forEach(({ issue: i, bill }) => {
      const entry = billEntry('federal', bill, [i.name], i.weight);
      entry.score = 50 + i.weight;
      results.push(entry);
    });

    // Jurisdiction lean (31 Aug 2026, P.jurisdictionLean — set once during
    // Citizen mode's onboarding, see builder.html's 'jurisdiction-lean'
    // card, refined afterward by which jurisdiction's actions a citizen
    // actually takes) weights which level's matches surface first. Only
    // applied to the three bill-derived kinds — 'general' entries below
    // outrank everything regardless of jurisdiction on purpose (a
    // citizen's own explicit priority isn't about which level of
    // government it happens to touch), and 'docket' isn't tied to a
    // jurisdiction at all.
    const lean = (profile && profile.jurisdictionLean) || { municipal: 1, state: 1, federal: 1 };
    results.forEach(r => {
      if (r.kind === 'federal' || r.kind === 'state' || r.kind === 'municipal') {
        r.score = r.score * (lean[r.kind] || 1);
      }
    });

    if (docket.status === 'fulfilled' && docket.value.length && poolIssues.length) {
      for (const item of docket.value) {
        const topic = await classifyDocketItem(item);
        const { score, hits } = scoreAgainstIssues(topic, poolIssues);
        if (score > 0) {
          results.push({
            kind: 'docket', hits, score,
            title: item.title,
            label: topic,
            rawSummary: item.note || '',
            summaryId: null, // already plain — no AI summary needed
            url: item.url || '',
            actionHref: (profile.token ? 'send-to-civix.html#' + profile.token : 'send-to-civix.html')
          });
        }
      }
    }

    // A citizen who bothered to type something in their own words (the
    // Citizen-mode "anything else on your mind?" card, or a stance
    // written directly in § 03) deserves to see it land somewhere, even
    // when nothing in the matched bill/docket pool happens to touch it —
    // otherwise typing it in felt like it went nowhere. weight === 3 +
    // a written stance is the signal for "this was a deliberate,
    // high-conviction addition," not just a swiped-in issue. Scored to
    // always outrank bill/docket matches — an explicit personal
    // statement leads, algorithmic matching follows.
    const matchedNames = new Set();
    results.forEach(r => (r.hits || []).forEach(h => matchedNames.add(h)));
    allIssues
      .filter(i => i.weight === 3 && i.stance && !matchedNames.has(i.name))
      .forEach(i => {
        results.push({
          kind: 'general', hits: [i.name], score: 1000 + i.weight,
          title: i.name,
          rawSummary: i.stance, // no summaryId (nothing to AI-summarize) — the plain-language pass below falls back to this verbatim
          summaryId: null,
          actionHref: 'take-action.html?general=' + encodeURIComponent(i.name)
        });
      });

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, limit);

    // Plain-language pass, only for the handful actually being shown —
    // never summarize the whole matched pool, just what's rendered.
    await Promise.all(top.map(async entry => {
      if (!entry.summaryId) { entry.summary = entry.rawSummary; return; }
      const plain = await plainSummarize(entry.summaryId, entry.title, entry.rawSummary);
      entry.summary = plain || entry.rawSummary || 'No recorded action yet.';
    }));

    return top;
  }

  window.CivixDigest = {
    slug, keywordsFor, scoreAgainstIssues, matchBills,
    fetchFederalBills, fetchStateBills, fetchMunicipalBills, fetchDocketItems,
    classifyDocketItem, plainSummarize, buildTopDigest
  };
})();

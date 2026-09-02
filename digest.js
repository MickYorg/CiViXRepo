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

  function keywordsFor(issue) {
    const extra = SYNONYMS[issue.id] || [];
    const nameWords = issue.name.toLowerCase().split(/\W+/).filter(w => w.length >= 4);
    return [issue.name.toLowerCase()].concat(extra, nameWords);
  }

  // Scores one haystack of text against a citizen's issues — the per-item
  // core that both matchBills() and docket matching share.
  function scoreAgainstIssues(hay, issues) {
    const h = hay.toLowerCase();
    const hits = [];
    let score = 0;
    issues.forEach(issue => {
      const kws = keywordsFor(issue);
      if (kws.some(k => h.indexOf(k) !== -1)) {
        score += issue.weight || 1;
        hits.push(issue.name);
      }
    });
    return { score, hits };
  }

  function matchBills(bills, issues) {
    const scored = bills.map(bill => {
      const hay = bill.title + ' ' + (bill.latestAction ? bill.latestAction.text : '');
      const { score, hits } = scoreAgainstIssues(hay, issues);
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
    const issues = (profile && profile.issues) || [];
    const zip = profile && profile.place && profile.place.zip;
    const results = [];

    const [fed, state, municipal, docket] = await Promise.allSettled([
      fetchFederalBills(),
      fetchStateBills(zip),
      fetchMunicipalBills(zip),
      fetchDocketItems(profile && profile.token)
    ]);

    if (fed.status === 'fulfilled' && issues.length) {
      matchBills(fed.value, issues).forEach(m => results.push(billEntry('federal', m.bill, m.hits, m.score)));
    }
    if (state.status === 'fulfilled' && issues.length) {
      matchBills(state.value.bills, issues).forEach(m => results.push(billEntry('state', m.bill, m.hits, m.score)));
    }
    if (municipal.status === 'fulfilled' && municipal.value.covered && issues.length) {
      matchBills(municipal.value.bills, issues).forEach(m => results.push(billEntry('municipal', m.bill, m.hits, m.score)));
    }

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

    if (docket.status === 'fulfilled' && docket.value.length && issues.length) {
      for (const item of docket.value) {
        const topic = await classifyDocketItem(item);
        const { score, hits } = scoreAgainstIssues(topic, issues);
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
    issues
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

// digest.js — the "top 3" engine. Each test pins a bug that was fixed live
// and then came back or nearly did (see the dated entries in CLAUDE.md).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, routeFetch } = require('../helpers/load');

function bill(type, number, title, actionText, extra = {}) {
  return {
    congress: 119, type, number, title,
    latestAction: { date: '2026-09-01', text: actionText || 'Introduced in House' },
    status: 'Introduced', url: `https://www.congress.gov/bill/119th-congress/x/${number}`,
    ...extra,
  };
}

function digestWith(routes) {
  const fetch = routeFetch(Object.assign({
    '/api/calendar': { bills: [] },
    '/api/state-bills': { bills: [], state: '' },
    '/api/municipal': { bills: [], covered: false },
    '/api/plain-summary': { summary: '' },
  }, routes));
  const w = loadScript('digest.js', { fetch });
  return { D: w.CivixDigest, fetch };
}

// parseBillCitation isn't exported, so these go through the lookup URL
// buildTopDigest builds — which is the behavior that actually matters.
for (const typed of ['H.R.9694', 'HR 9694', 'hr9694', 'H.R. 9694 - Epstein Files Transparency Act II']) {
  test(`a cited bill ("${typed}") is looked up directly and lands in the top 3`, async () => {
    const efta = bill('HR', '9694', 'Epstein Files Transparency Act II', 'Referred to the House Committee on the Judiciary.');
    const { D, fetch } = digestWith({ '/api/bill-lookup': { bill: efta } });
    const top = await D.buildTopDigest({
      place: { zip: '' },
      issues: [{ id: 'x', name: typed, weight: 3, stance: typed }],
    });
    assert.ok(fetch.calls.some((u) => u.startsWith('/api/bill-lookup?type=hr&number=9694')), 'looked up H.R.9694 directly');
    assert.equal(top[0].kind, 'federal');
    assert.equal(top[0].bill.number, '9694');
  });
}

test('named, resolved bills outrank unmatched freeform priorities (24 Sep 2026)', async () => {
  // Reproduces the citizen's real manifesto shape: two named bills plus
  // three typed priorities nothing matches. The "general" fallback used to
  // score 1000+ and push both real bills out of the top 3.
  const efta = bill('HR', '9694', 'Epstein Files Transparency Act II');
  const ndaa = bill('HR', '8800', 'National Defense Authorization Act for Fiscal Year 2027');
  const { D } = digestWith({
    '/api/bill-lookup': { bill: efta },
    '/api/bill-search': { bill: ndaa },
  });
  const top = await D.buildTopDigest({
    place: { zip: '' },
    issues: [
      { id: 'a', name: 'Epstein Files Transparency Act II', weight: 3, stance: 'H.R.9694 - release the files', billCitation: { type: 'hr', number: '9694' } },
      { id: 'b', name: 'Defense spending', weight: 3, stance: 'the NDAA' },
      { id: 'c', name: 'Rural broadband', weight: 3, stance: 'Fix rural internet' },
      { id: 'd', name: 'Flock surveillance', weight: 3, stance: 'Defund Flock cameras' },
      { id: 'e', name: 'Beef labeling', weight: 3, stance: 'Country of origin labels' },
    ],
  });
  const numbers = top.filter((e) => e.kind === 'federal').map((e) => e.bill.number).sort().join(',');
  assert.equal(numbers, '8800,9694', 'both named bills are in the top 3');
});

test('a bare "NDAA" resolves via bill-search, not a guessed number', async () => {
  const ndaa = bill('HR', '8800', 'National Defense Authorization Act for Fiscal Year 2027');
  const { D, fetch } = digestWith({ '/api/bill-search': { bill: ndaa } });
  const top = await D.buildTopDigest({ place: { zip: '' }, issues: [{ id: 'n', name: 'NDAA', weight: 3, stance: 'the NDAA' }] });
  assert.ok(fetch.calls.some((u) => u.startsWith('/api/bill-search?title=national')));
  assert.equal(top[0].bill.number, '8800');
});

test('an unmatched high-conviction priority still shows up (never silently dropped)', async () => {
  const { D } = digestWith({});
  const top = await D.buildTopDigest({ place: { zip: '' }, issues: [{ id: 'r', name: 'Rural broadband', weight: 3, stance: 'Fix rural internet' }] });
  assert.equal(top.length, 1);
  assert.equal(top[0].kind, 'general');
});

test('committee-referral boilerplate does not create a match (HRES 1517, 10 Sep 2026)', () => {
  const { D } = digestWith({});
  const ceremonial = bill('HRES', '1517',
    'Expressing support for the recognition of September 7, 2026, as "Liturgical Dance Day"',
    'Referred to the House Committee on Oversight and Government Reform.');
  const matches = D.matchBills([ceremonial], [{ id: 'government-transparency', name: 'Government transparency', weight: 2, stance: '' }]);
  assert.equal(matches.length, 0);
});

test("a specific bill's generic words don't false-match unrelated bills", () => {
  const { D } = digestWith({});
  const unrelated = bill('HR', '5000', 'Fiscal Sponsorship Transparency Act', 'Referred to the Committee on Ways and Means.');
  const matches = D.matchBills([unrelated], [{ id: 'x', name: 'NDAA for Fiscal Year 2027', weight: 3, stance: 'National defense authorization' }]);
  assert.equal(matches.length, 0);
});

test('a real topical match still matches (the fixes above did not kill matching)', () => {
  const { D } = digestWith({});
  const housing = bill('HR', '4000', 'Affordable Housing Construction Act', 'Referred to the Committee on Financial Services.');
  const matches = D.matchBills([housing], [{ id: 'housing-affordability', name: 'Housing affordability', weight: 3, stance: '' }]);
  assert.equal(matches.length, 1);
});

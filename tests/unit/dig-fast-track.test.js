// DIG fast track (19 Nov 2026): "Where it stands" for a topic, what changed
// in each source's take since it was last checked, and Follow (manifesto +
// Take Action watchlist in one tap, undone exactly by Stop following).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractFunction } = require('../helpers/load');

const DIG = 'dig/index.html';
const parsePointList = extractFunction(DIG, 'parsePointList');
const parseResponseText = extractFunction(DIG, 'parseResponseText');
const describeChange = extractFunction(DIG, 'describeChange');
const parseFields = extractFunction(DIG, 'parseFields');
const parseStatusText = extractFunction(DIG, 'parseStatusText', { parseFields, parsePointList });
const topicKey = extractFunction(DIG, 'topicKey');
const slug = extractFunction(DIG, 'slug');

test('source check: CHANGE line is parsed and kept out of the summary', () => {
  const r = parseResponseText('STANCE: Skeptical of the deal\nSUMMARY: Argued on her podcast\nthat it fails.\nCHANGE: SHIFTED: Now calls it a reasonable first step.');
  assert.strictEqual(r.stance, 'Skeptical of the deal');
  assert.strictEqual(r.summary, 'Argued on her podcast\nthat it fails.');
  assert.strictEqual(r.change, 'SHIFTED: Now calls it a reasonable first step.');
});

test('source check: replies without CHANGE parse as before', () => {
  const r = parseResponseText('STANCE: Supportive\nSUMMARY: Two sentences.');
  assert.deepStrictEqual({ ...r }, { stance: 'Supportive', summary: 'Two sentences.', change: '' });
});

test('change: SAME and SHIFTED carry the date and earlier stance; anything else is dropped', () => {
  const prior = { stance: 'Opposed', savedAt: 1700000000000 };
  assert.deepStrictEqual({ ...describeChange('SAME', prior) }, { kind: 'same', text: '', since: prior.savedAt, before: 'Opposed' });
  const s = describeChange('SHIFTED: now open to it', prior);
  assert.strictEqual(s.kind, 'shifted');
  assert.strictEqual(s.text, 'now open to it');
  assert.strictEqual(describeChange('maybe?', prior), null);
  assert.strictEqual(describeChange('SAME', null), null);
});

test('where it stands: fields, multi-line values, and only real URLs as sources (max 3)', () => {
  const st = parseStatusText([
    'NOW: The House passed H.R. 8800.',
    'The Senate returns Nov 9.',
    'LATEST: Jul 22: House vote, 216-212.',
    'NEXT: Lame-duck session.',
    'CHANGED: Nothing significant',
    'SOURCE: https://www.congress.gov/bill/119th-congress/house-bill/8800',
    'SOURCE: not a url',
    'SOURCE: <https://example.org/a>',
    'SOURCE: https://example.org/b',
    'SOURCE: https://example.org/c',
  ].join('\n'));
  assert.strictEqual(st.now, 'The House passed H.R. 8800. The Senate returns Nov 9.');
  assert.strictEqual(st.latest, 'Jul 22: House vote, 216-212.');
  assert.strictEqual(st.next, 'Lame-duck session.');
  assert.strictEqual(st.changed, 'Nothing significant');
  assert.deepStrictEqual([...st.sources], ['https://www.congress.gov/bill/119th-congress/house-bill/8800', 'https://example.org/a', 'https://example.org/b']);
});

function followHarness(initial) {
  let store = JSON.parse(JSON.stringify(initial));
  const deps = {
    loadManifesto: () => JSON.parse(JSON.stringify(store)),
    saveManifesto: (m) => { store = JSON.parse(JSON.stringify(m)); },
    topicKey, slug,
  };
  const followedWatches = extractFunction(DIG, 'followedWatches', deps);
  const isFollowing = extractFunction(DIG, 'isFollowing', { ...deps, followedWatches });
  return {
    get: () => store,
    isFollowing,
    follow: extractFunction(DIG, 'followTopic', deps),
    unfollow: extractFunction(DIG, 'unfollowTopic', deps),
  };
}

test('follow adds the topic to the manifesto and watchlist; stop following removes both', () => {
  const h = followHarness({ issues: [{ id: 'housing', name: 'Housing', weight: 1 }], watching: [] });
  const rec = h.follow('NDAA 2027');
  assert.strictEqual(rec.added, true);
  assert.ok(h.isFollowing('ndaa 2027 '));
  assert.ok(h.get().issues.some(i => i.id === 'ndaa-2027' && i.name === 'NDAA 2027'));
  assert.deepStrictEqual(h.get().watching.map(w => [w.key, w.kind, w.title]), [['general:NDAA 2027', 'general', 'NDAA 2027']]);
  h.unfollow('NDAA 2027');
  assert.ok(!h.isFollowing('NDAA 2027'));
  assert.deepStrictEqual(h.get().issues.map(i => i.id), ['housing']);
});

test('following a topic already in the manifesto raises it, and stop following puts the weight back', () => {
  const h = followHarness({ issues: [{ id: 'housing', name: 'Housing', weight: 1 }] });
  assert.strictEqual(h.follow('housing').added, false);
  assert.strictEqual(h.get().issues[0].weight, 2);
  h.unfollow('Housing');
  assert.strictEqual(h.get().issues[0].weight, 1);
  assert.strictEqual(h.get().issues.length, 1);
});

test('Take Action reads DIG\'s saved status for a followed topic', () => {
  const data = { 'ndaa 2027': { now: 'Stalled in the Senate.', savedAt: 1 } };
  const localStorage = { getItem: (k) => (k === 'dig-status-cache' ? JSON.stringify(data) : null) };
  const digStatusFor = extractFunction('take-action.html', 'digStatusFor', { localStorage });
  assert.strictEqual(digStatusFor('NDAA 2027').now, 'Stalled in the Senate.');
  assert.strictEqual(digStatusFor('Something else'), null);
});

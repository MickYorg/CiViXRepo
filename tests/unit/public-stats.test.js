// Public stats (DIG's Community stats, analytics.html): a citizen's search
// words are never stored, and nothing rare or unfit is ever shown.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT } = require('../helpers/load');

const lib = () => import(path.join(ROOT, 'functions/_lib/public-stats.js'));
const digStats = () => import(path.join(ROOT, 'functions/api/dig-stats.js'));

function fakeKV(initial = {}) {
  const m = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    m,
    async get(k, opts) { if (!m.has(k)) return null; const v = m.get(k); return opts && opts.type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

test('public stats: profanity, slurs and personal details never reach a public list', async () => {
  const { fitForPublic } = await lib();
  for (const bad of ['fuck the senate', 'call 617-555-0142', 'someone@example.com', '12 Elm Street', 'https://x.com/someone']) {
    assert.equal(fitForPublic(bad), false, bad);
  }
  for (const ok of ['Immigration', 'Public health', 'Reuters', 'Breaking Points']) assert.equal(fitForPublic(ok), true, ok);
});

test('public stats: nothing shows until at least 5 share it', async () => {
  const { publicEntries, PUBLIC_MIN_COUNT } = await lib();
  assert.equal(PUBLIC_MIN_COUNT, 5);
  const shown = publicEntries({ Immigration: 5, Taxes: 4, 'fuck this': 50 }, v => v).map(([n]) => n);
  assert.deepEqual(shown, ['Immigration']);
});

test('public stats: a search maps to a broad issue by keyword, without AI', async () => {
  const { topicCategory } = await lib();
  const env = {}; // no API key: keywords only
  assert.equal(await topicCategory('Is the new border wall working?', env), 'Immigration');
  assert.equal(await topicCategory('minimum wage hike in Ohio', env), 'Wages and labor');
  assert.equal(await topicCategory('Gloria Steinem cia', env), null); // fits no keyword; AI would decide
});

test('DIG stats: the words typed are never stored, only the broad issue', async () => {
  const { onRequestPost, onRequestGet } = await digStats();
  const kv = fakeKV({ 'stats:topics': { 'old raw search text': 3 } });
  const env = { DIG_KV: kv };
  const post = (name) => onRequestPost({ request: new Request('https://x/api/dig-stats', { method: 'POST', body: JSON.stringify({ type: 'topic', name }) }), env });
  for (let i = 0; i < 5; i++) await post(`what is happening at the border ${i}`);
  await post('Gloria Steinem cia'); // no keyword, no AI key: not counted
  const stored = [...kv.m.values()].join(' ');
  assert.doesNotMatch(stored, /border|Steinem/);
  assert.deepEqual(JSON.parse(kv.m.get('stats:topics:v2')), { Immigration: 5 });

  const body = await (await onRequestGet({ env })).json();
  assert.deepEqual(body.topics, [{ name: 'Immigration', count: 5 }]);
  assert.equal(kv.m.has('stats:topics'), false, 'the old raw-text list is deleted');
});

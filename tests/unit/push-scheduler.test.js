// Watchlist alerts (workers/push-scheduler): the server half of "tell me when
// a bill I'm watching changes." Runs the real run()/simulate() against a fake
// KV, fake bill data and a fake push sender.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT } = require('../helpers/load');

const mod = () => import(path.join(ROOT, 'workers/push-scheduler/index.js'));

function fakeKV(entries = {}) {
  const m = new Map(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    m,
    async get(k, opts) { const v = m.get(k); if (v == null) return null; return opts && opts.type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}

const env = (kv) => ({ DIG_KV: kv, FCM_SERVICE_ACCOUNT_JSON: '{}', FCM_PROJECT_ID: 'test' });
const bill = (number, date) => ({ congress: 119, type: 'HR', number, title: `Bill ${number}`, latestAction: { date, text: 'x' } });

function net({ pool = [], lookup = {} } = {}) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.endsWith('/api/calendar')) return { bills: pool };
    const m = /bill-lookup\?type=(\w+)&number=(\d+)/.exec(url);
    if (m) return lookup[m[2]] ? { bill: lookup[m[2]] } : null;
    return { bills: [] };
  };
  const sent = [];
  const send = async (sa, pid, token, title, body) => { sent.push({ token, title, body }); return { ok: true }; };
  return { fetchJson, send, sent, calls };
}

const device = (watching, token = 'tok1') => ({ token, platform: 'ios', zip: '', watching });

test('no change, no alert', async () => {
  const { run } = await mod();
  const kv = fakeKV({ 'pushdevice:tok1': device([{ key: 'federal:119:HR100', kind: 'federal', lastSeenActionDate: '2026-09-01' }]) });
  const n = net({ pool: [bill('100', '2026-09-01')] });
  await run(env(kv), n);
  assert.equal(n.sent.length, 0);
});

test('a real change sends one generic alert, then not again', async () => {
  const { run } = await mod();
  const kv = fakeKV({ 'pushdevice:tok1': device([{ key: 'federal:119:HR100', kind: 'federal', lastSeenActionDate: '2026-09-01' }]) });
  const n = net({ pool: [bill('100', '2026-09-20')] });
  await run(env(kv), n);
  assert.equal(n.sent.length, 1);
  assert.doesNotMatch(n.sent[0].body + n.sent[0].title, /Bill 100|HR ?100/, 'alert text never names the bill');
  await run(env(kv), n);
  assert.equal(n.sent.length, 1, 'same change is not re-sent every hour');
});

test('a watched bill outside the recent-activity list is looked up directly (25 Sep 2026)', async () => {
  const { run } = await mod();
  const kv = fakeKV({ 'pushdevice:tok1': device([{ key: 'federal:119:HR9694', kind: 'federal', lastSeenActionDate: '2026-07-15' }]) });
  const n = net({ pool: [], lookup: { 9694: bill('9694', '2026-09-24') } });
  await run(env(kv), n);
  assert.ok(n.calls.some((u) => u.includes('/api/bill-lookup?type=hr&number=9694&congress=119')));
  assert.equal(n.sent.length, 1);
});

test('simulate: a rewound watch on a registered device gets a real alert', async () => {
  const { simulate } = await mod();
  const kv = fakeKV({
    'pushdevice:tok1': device([{ key: 'federal:119:HR100', kind: 'federal', lastSeenActionDate: '2000-01-01' }]),
    'pushnotified:tok1': { 'federal:119:HR100': '2026-09-01' },
  });
  const n = net({ pool: [bill('100', '2026-09-01')] });
  const r = await simulate(env(kv), 'tok1', n);
  assert.equal(r.status, 200);
  assert.equal(n.sent.length, 1, 'old "already notified" record is cleared so the alert goes out');
});

test('simulate: an unregistered device gets a clear error, not a silent no-op', async () => {
  const { simulate } = await mod();
  const r = await simulate(env(fakeKV()), 'nope', net());
  assert.equal(r.status, 404);
  assert.match(r.body.error.message, /turn on alerts/);
});

test('an uninstalled app (invalid token) is removed, not retried forever', async () => {
  const { run } = await mod();
  const kv = fakeKV({ 'pushdevice:tok1': device([{ key: 'federal:119:HR100', kind: 'federal', lastSeenActionDate: '2026-09-01' }]) });
  const n = net({ pool: [bill('100', '2026-09-20')] });
  n.send = async () => ({ invalidToken: true });
  await run(env(kv), n);
  assert.equal(kv.m.has('pushdevice:tok1'), false);
});

test('watch keys parse back into a bill citation', async () => {
  const { parseFederalWatchKey } = await mod();
  assert.equal(JSON.stringify(parseFederalWatchKey('federal:119:HR9694')), JSON.stringify({ congress: '119', type: 'hr', number: '9694' }));
  assert.equal(parseFederalWatchKey('general:Housing'), null);
});

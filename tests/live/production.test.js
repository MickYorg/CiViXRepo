// Live checks against production (https://mycivix.com and the capture
// Worker). These catch what offline tests can't: an expired API key, an
// upstream API changing shape, a deploy that didn't take. Run nightly by CI
// and by hand with `npm run test:live`. Deliberately avoids anything that
// spends AI budget or sends email.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const SITE = process.env.CIVIX_SITE || 'https://mycivix.com';
const CAPTURE = 'https://civix-capture.mycivix.workers.dev';

async function getJSON(path, init) {
  const r = await fetch(SITE + path, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { assert.fail(`${path} returned non-JSON (${r.status}): ${text.slice(0, 120)}`); }
  return { status: r.status, body, headers: r.headers };
}

test('federal bills load, with a real status on every bill', async () => {
  const { status, body } = await getJSON('/api/calendar');
  assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
  assert.ok(body.bills.length >= 20, `only ${body.bills.length} bills`);
  const introduced = body.bills.filter((b) => b.status === 'Introduced' && /referred to|placed on|agreed to/i.test((b.latestAction || {}).text || ''));
  assert.equal(introduced.length, 0, `mislabeled 'Introduced': ${introduced.map((b) => b.latestAction.text).slice(0, 3).join(' | ')}`);
});

test('a named bill resolves directly (H.R.9694)', async () => {
  const { status, body } = await getJSON('/api/bill-lookup?type=hr&number=9694');
  assert.equal(status, 200);
  assert.match(body.bill.title, /Epstein/i);
});

test('"the NDAA" resolves to a current National Defense Authorization Act', async () => {
  const { status, body } = await getJSON('/api/bill-search?title=' + encodeURIComponent('national defense authorization act'));
  assert.equal(status, 200);
  assert.match(body.bill.title, /National Defense Authorization Act/i);
});

test('state bills load for a real ZIP', async () => {
  const { status, body } = await getJSON('/api/state-bills?zip=02118');
  assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
  assert.ok(Array.isArray(body.bills));
});

test('municipal data loads for a covered city (Boston)', async () => {
  const { status, body } = await getJSON('/api/municipal?zip=02118');
  assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
  assert.equal(body.covered, true);
});

test('federal reps resolve from a ZIP', async () => {
  const { status, body } = await getJSON('/api/reps?zip=02118');
  assert.equal(status, 200, JSON.stringify(body).slice(0, 200));
  assert.ok((body.representatives || body.reps || []).length > 0, 'no reps returned');
});

test('the pre-warmed headline deck has cards', async () => {
  const { status, body } = await getJSON('/api/headlines-batch');
  assert.equal(status, 200);
  assert.ok((body.cards || body.headlines || body.items || []).length > 0, 'headline batch is empty');
});

test('platform stats answer', async () => {
  const { status, body } = await getJSON('/api/platform-stats');
  assert.equal(status, 200);
  assert.equal(typeof body.manifestos, 'number');
});

for (const [name, base, path] of [['site API', SITE, '/api/dig-check'], ['capture Worker', CAPTURE, '/api/filings?token=zzzzzzzzzz']]) {
  test(`${name} accepts the iOS app origin (capacitor://mycivix.com)`, async () => {
    const r = await fetch(base + path, { method: 'OPTIONS', headers: { Origin: 'capacitor://mycivix.com', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'capacitor://mycivix.com');
  });
}

test('served JS is always revalidated (no 4-hour stale fixes, 10 Sep 2026)', async () => {
  const r = await fetch(SITE + '/digest.js', { method: 'HEAD' });
  const cc = r.headers.get('cache-control') || '';
  assert.ok(/no-cache|max-age=[0-9]\b|max-age=[0-5][0-9]\b/.test(cc), `digest.js cache-control is "${cc}"`);
});

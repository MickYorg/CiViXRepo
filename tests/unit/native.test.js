// The native-app shims. These only matter inside the iPhone/Android app,
// where nobody notices them break until a phone is in hand.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, read } = require('../helpers/load');

function shimmed(href) {
  const seen = [];
  const w = loadScript('native-fetch.js', {
    location: { href },
    fetch: async (input) => { seen.push(typeof input === 'string' ? input : input.url); return new Response('{}'); },
  });
  return { w, seen };
}

test('iOS app: relative /api/ calls go to the real server (24 Sep 2026)', async () => {
  const { w, seen } = shimmed('capacitor://mycivix.com/builder.html');
  await w.fetch('/api/headlines-batch');
  await w.fetch('/api/reps?zip=02118');
  await w.fetch(new Request('capacitor://mycivix.com/api/dig-check', { method: 'POST', body: '{}' }));
  assert.equal(seen[0], 'https://mycivix.com/api/headlines-batch');
  assert.equal(seen[1], 'https://mycivix.com/api/reps?zip=02118');
  assert.equal(seen[2], 'https://mycivix.com/api/dig-check');
});

test('iOS app: non-API and third-party URLs are left alone', async () => {
  const { w, seen } = shimmed('capacitor://mycivix.com/builder.html');
  await w.fetch('/digest.js');
  await w.fetch('https://civix-capture.mycivix.workers.dev/api/filings?token=x');
  assert.equal(seen[0], '/digest.js');
  assert.equal(seen[1], 'https://civix-capture.mycivix.workers.dev/api/filings?token=x');
});

test('website: the shim does nothing', async () => {
  const { w, seen } = shimmed('https://mycivix.com/builder.html');
  await w.fetch('/api/calendar');
  assert.equal(seen[0], '/api/calendar');
});

test('every page that calls /api/ loads native-fetch.js in <head>, before its scripts', () => {
  const pages = ['index.html', 'builder.html', 'take-action.html', 'calendar.html', 'analytics.html', 'health.html', 'send-to-civix.html', 'dig/index.html'];
  for (const page of pages) {
    const html = read(page);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<script src="(\.\.\/)?native-fetch\.js"><\/script>/, `${page} loads native-fetch.js in <head>`);
    const shimAt = html.indexOf('native-fetch.js');
    const firstInline = html.search(/<script>(?![^<]*localStorage\.getItem\('civix-theme'\))/);
    if (firstInline !== -1) assert.ok(shimAt < firstInline || /theme/.test(html.slice(firstInline, firstInline + 400)), `${page}: shim before page scripts`);
  }
});

test('API CORS allows the iOS app origin', () => {
  assert.match(read('functions/api/_middleware.js'), /'capacitor:\/\/mycivix\.com'/);
});

test('app shell opens CiViX links in place instead of handing them to iOS (DIG → AAA bug)', () => {
  const src = read('app-shell.js');
  assert.match(src, /a\.target !== '_blank'/);
  assert.match(src, /u\.origin !== location\.origin/);
});

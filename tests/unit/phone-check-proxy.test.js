// phone-check.js proxies /api/* to production so pages fill with real data.
// A late upstream socket error (after the response already started) must not
// crash the whole layout check — it took down every page after
// 'send-to-civix' in the 23 Nov 2026 nightly run (ERR_HTTP_HEADERS_SENT).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');
const { extractFunction } = require('../helpers/load');

function fakeUpstream(statusCode) {
  const req = new EventEmitter();
  req.write = () => true;
  req.end = () => {};
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.headers = { 'content-type': 'application/json' };
  res.pipe = (dest) => dest.end('{}');
  return { req, res };
}

test('/api proxy: a late upstream error after headers are sent does not crash the server', async () => {
  let upstream;
  const https = { request: (url, opts, cb) => {
    const { req, res } = fakeUpstream(200);
    process.nextTick(() => cb(res));
    upstream = req;
    return req;
  } };
  const serve = extractFunction('scripts/phone-check.js', 'serve', {
    http, https, fs: require('fs'), path: require('path'),
    ROOT: require('path').resolve(__dirname, '..', '..'),
    PORT: 18787 + Math.floor(Math.random() * 1000),
    TYPES: {},
    decodeURIComponent,
  });

  const server = await serve();
  const port = server.address().port;

  const uncaught = [];
  const onUncaught = (e) => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  try {
    const body = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/api/test' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      r.on('error', reject);
      r.end();
    });
    assert.equal(body.status, 200);
    // Headers already sent before the response finished; now fire the late error.
    upstream.emit('error', new Error('socket hang up'));
    await new Promise((r) => setImmediate(r));
  } finally {
    process.removeListener('uncaughtException', onUncaught);
    server.close();
  }
  assert.deepEqual(uncaught, []);
});

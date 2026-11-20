// scripts/phone-check.js proxies /api/* to production so layout-check pages
// fill with real data. A mid-stream network blip on the upstream request
// used to crash the whole check (ERR_HTTP_HEADERS_SENT, 19 Nov 2026) because
// the error handler called res.writeHead again after the response had
// already started piping to the client.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');
const { ROOT } = require('../helpers/load');

const { proxyApi } = require(path.join(ROOT, 'scripts/phone-check.js'));

function fakeReq() {
  const req = new EventEmitter();
  req.url = '/api/platform-stats';
  req.method = 'GET';
  req.headers = {};
  req.pipe = () => {};
  return req;
}

function fakeRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.writeHeadCalls = [];
  res.writeHead = (...args) => { res.headersSent = true; res.writeHeadCalls.push(args); };
  res.ended = false;
  res.end = () => { res.ended = true; };
  return res;
}

test('a late upstream error after headers are already sent does not crash', () => {
  const req = fakeReq();
  const res = fakeRes();
  const up = new EventEmitter();
  up.on = EventEmitter.prototype.on.bind(up);

  const request = (url, opts, callback) => {
    // Upstream responds, headers go out, piping begins...
    const upstreamRes = new EventEmitter();
    upstreamRes.statusCode = 200;
    upstreamRes.headers = { 'content-type': 'application/json' };
    upstreamRes.pipe = () => {};
    callback(upstreamRes);
    return up;
  };

  proxyApi(req, res, request);
  assert.equal(res.writeHeadCalls.length, 1);

  // ...then the upstream connection errors mid-stream.
  assert.doesNotThrow(() => up.emit('error', new Error('socket hang up')));
  // No second writeHead (that's the ERR_HTTP_HEADERS_SENT crash); the
  // response is simply ended.
  assert.equal(res.writeHeadCalls.length, 1);
  assert.equal(res.ended, true);
});

test('an upstream error before any response still returns a 500', () => {
  const req = fakeReq();
  const res = fakeRes();
  const up = new EventEmitter();
  up.on = EventEmitter.prototype.on.bind(up);
  const request = () => up;

  proxyApi(req, res, request);
  up.emit('error', new Error('ENOTFOUND'));
  assert.equal(res.writeHeadCalls.length, 1);
  assert.equal(res.writeHeadCalls[0][0], 500);
  assert.equal(res.ended, true);
});

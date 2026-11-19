// scripts/phone-check.js's local /api/ proxy crashed the whole layout run
// (civix101 @ iphone-se, 14 Nov 2026 nightly CI) with ERR_HTTP_HEADERS_SENT:
// the upstream request's 'error' handler called res.writeHead(500)
// unconditionally, even when the success callback had already written
// headers and started piping the real response.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { proxyApiError } = require('../../scripts/phone-check');

test('proxy error handler does not re-write headers once a response is underway', () => {
  let destroyed = false;
  const res = {
    headersSent: true,
    destroy: () => { destroyed = true; },
    writeHead: () => { throw new Error('must not write headers twice'); },
    end: () => { throw new Error('must not end a response that was never started here'); },
  };
  proxyApiError(res);
  assert.equal(destroyed, true);
});

test('proxy error handler still answers with a 500 when nothing was written yet', () => {
  const calls = [];
  const res = {
    headersSent: false,
    writeHead: (code) => { calls.push(['writeHead', code]); res.headersSent = true; },
    end: (body) => calls.push(['end', body]),
    destroy: () => calls.push(['destroy']),
  };
  proxyApiError(res);
  assert.deepEqual(calls, [['writeHead', 500], ['end', '{}']]);
});

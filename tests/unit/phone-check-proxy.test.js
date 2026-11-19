// phone-check.js proxies /api/* to production so pages fill with real data
// during the layout check. A dropped upstream connection used to crash the
// whole run if it errored after the response had already started (headers
// sent) — found in CI, 14 & 16 Nov 2026.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { proxyUpstreamError } = require('../../scripts/phone-check.js');

function fakeRes(headersSent) {
  const calls = [];
  return {
    headersSent,
    writeHead: (...a) => calls.push(['writeHead', ...a]),
    end: (...a) => calls.push(['end', ...a]),
    destroy: (...a) => calls.push(['destroy', ...a]),
    calls,
  };
}

test('upstream error before headers sent: responds 500', () => {
  const res = fakeRes(false);
  proxyUpstreamError(res);
  assert.deepEqual(res.calls, [['writeHead', 500], ['end', '{}']]);
});

test('upstream error after headers sent: destroys instead of re-writing headers', () => {
  const res = fakeRes(true);
  proxyUpstreamError(res);
  assert.deepEqual(res.calls, [['destroy']]);
});

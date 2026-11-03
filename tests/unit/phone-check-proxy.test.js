// phone-check.js proxies /api/* to mycivix.com while shooting screenshots.
// If the upstream socket errors after it already piped a response (a mid-
// stream reset), the error handler used to call res.writeHead() a second
// time, which throws ERR_HTTP_HEADERS_SENT and killed the whole
// phone-check run (seen in CI 2 Nov 2026, after the tax-dollars page).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT } = require('../helpers/load');

const { apiProxyErrorHandler } = require(path.join(ROOT, 'scripts/phone-check.js'));

function fakeRes(headersSent) {
  const calls = [];
  return {
    headersSent,
    writeHead(...args) {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT: Cannot write headers after they are sent to the client');
      calls.push(['writeHead', ...args]);
    },
    end(...args) { calls.push(['end', ...args]); },
    destroy() { calls.push(['destroy']); },
    calls,
  };
}

test('upstream error before any response: replies 500', () => {
  const res = fakeRes(false);
  apiProxyErrorHandler(res)();
  assert.deepEqual(res.calls, [['writeHead', 500], ['end', '{}']]);
});

test('upstream error after headers already sent: destroys the response instead of writing headers again', () => {
  const res = fakeRes(true);
  assert.doesNotThrow(() => apiProxyErrorHandler(res)());
  assert.deepEqual(res.calls, [['destroy']]);
});

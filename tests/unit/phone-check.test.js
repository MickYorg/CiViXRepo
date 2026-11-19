// scripts/phone-check.js proxies /api/* to production so pages render with
// real data. The nightly layout run (27 Oct 2026) crashed the whole job —
// ERR_HTTP_HEADERS_SENT — because the proxy's error handler called
// res.writeHead() again after the upstream response had already started
// streaming back. See CLAUDE.md "Testing".
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT } = require('../helpers/load');

const { handleProxyError } = require(path.join(ROOT, 'scripts/phone-check.js'));

// A bare-bones ServerResponse stand-in that throws the way Node really does
// when writeHead is called twice, so this test fails against the old code.
function fakeRes({ headersSent = false, writableEnded = false } = {}) {
  const res = {
    headersSent,
    writableEnded,
    writeHeadCalls: 0,
    endCalls: 0,
    writeHead(status) {
      if (res.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT: Cannot write headers after they are sent to the client');
      res.headersSent = true;
      res.writeHeadCalls++;
    },
    end(body) {
      res.writableEnded = true;
      res.endCalls++;
    },
  };
  return res;
}

test('proxy error after headers are already sent does not crash (ERR_HTTP_HEADERS_SENT)', () => {
  const res = fakeRes({ headersSent: true });
  assert.doesNotThrow(() => handleProxyError(res));
  assert.equal(res.writeHeadCalls, 0, 'must not write headers a second time');
  assert.equal(res.endCalls, 1);
});

test('proxy error before any response started still sends a 500', () => {
  const res = fakeRes();
  handleProxyError(res);
  assert.equal(res.writeHeadCalls, 1);
  assert.equal(res.endCalls, 1);
});

test('proxy error after the response already ended does not end it again', () => {
  const res = fakeRes({ headersSent: true, writableEnded: true });
  assert.doesNotThrow(() => handleProxyError(res));
  assert.equal(res.writeHeadCalls, 0);
  assert.equal(res.endCalls, 0);
});

// DIG cached results (16 Oct 2026): a cached card used to show only the
// clock time it was checked ("2:14 PM · cached"), which can't tell this
// morning from yesterday inside the 24h cache window. It now shows its age.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractFunction } = require('../helpers/load');

const relativeTime = extractFunction('dig/index.html', 'relativeTime');
const cachedAgeLabel = extractFunction('dig/index.html', 'cachedAgeLabel', { relativeTime });

test('DIG cached card shows how old the result is', () => {
  assert.strictEqual(cachedAgeLabel(Date.now() - 5 * 3600e3, '2:14 PM'), 'saved 5h ago');
  assert.strictEqual(cachedAgeLabel(Date.now() - 20 * 60e3, '2:14 PM'), 'saved 20m ago');
});

test('DIG cached card without a saved time falls back to the clock time', () => {
  assert.strictEqual(cachedAgeLabel(undefined, '2:14 PM'), '2:14 PM · saved');
});

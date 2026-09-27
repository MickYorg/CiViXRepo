// Source Map experiment (sources-map.html): page functions run for real.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFunction } = require('../helpers/load');

test('Source Map: a 5-star DIG rating starts a source near the top (trusted), 1 star near the bottom', () => {
  // Was inverted: best-rated sources landed at the bottom of the board.
  const trustY = extractFunction('sources-map.html', 'trustY');
  const rated = (stars) => ({ ratings: { housing: { stars } } });
  assert.equal(trustY(rated(5)), 0.9);
  assert.equal(trustY(rated(1)), 0.1);
  assert.ok(trustY(rated(4)) > trustY(rated(2)));
  assert.equal(trustY({}), null);
});

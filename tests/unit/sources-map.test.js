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

test('Source Map: every DIG source has a sourced funding entry inside the board', () => {
  const src = require('../helpers/load').read('sources-map.html');
  const block = (marker, end) => { const i = src.indexOf(marker); return src.slice(i + marker.length, src.indexOf(end, i) + end.length - 1); };
  const FUNDING = new Function('return ' + block('const FUNDING = ', '\n  };'))();
  const names = [...block('const CATEGORIES = ', '\n  ];').matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
  for (const n of names) {
    const f = FUNDING[n];
    assert.ok(f, `funding entry for ${n}`);
    assert.ok(f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1, `${n} inside the board`);
    assert.ok(f.who && /^https:\/\//.test(f.src), `${n} says who pays and links a source`);
  }
});

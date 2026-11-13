// Pure helpers inside tests/live/production.test.js, unit-tested here so
// a fix to the live smoke check itself is verified offline too.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFunction } = require('../helpers/load');

const looksMislabeledIntroduced = extractFunction('tests/live/production.test.js', 'looksMislabeledIntroduced');

test('live check: "Assuming First Sponsorship" notices are not mislabeling (H.R.537, 13 Nov 2026)', () => {
  const text = "ASSUMING FIRST SPONSORHSIP - Mr. Magaziner asked unanimous consent that he may be hereafter be considered as the first sponsor of H.R. 537, a bill originally introduced by Representative Sherrill, for the purpose of adding cosponsors and requesting reprintings pursuant to clause 7 of rule XII. Agreed to without objection.";
  assert.equal(looksMislabeledIntroduced(text), false);
});

test('live check: real missed-progress phrasings still flag', () => {
  assert.equal(looksMislabeledIntroduced('Referred to the House Committee on the Judiciary.'), true);
  assert.equal(looksMislabeledIntroduced('Placed on the Union Calendar, Calendar No. 412.'), true);
  assert.equal(looksMislabeledIntroduced('Resolution agreed to in Senate without amendment by Unanimous Consent.'), true);
});

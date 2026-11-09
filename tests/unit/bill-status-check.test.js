'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { looksMislabeledIntroduced } = require('../helpers/bill-status-check');

test("ASSUMING FIRST SPONSORSHIP actions don't count as a bill moving past Introduced", () => {
  const text = "ASSUMING FIRST SPONSORSHIP - Mr. Pfluger asked unanimous consent that he may hereafter be considered as the first sponsor of H.R. 4006, a bill originally introduced by Representative Johnson (OH), for the purpose of adding cosponsors and requesting reprintings pursuant to clause 7 of rule XII, House of Representatives. Agreed to without objection.";
  assert.equal(looksMislabeledIntroduced(text), false);
});

test('a real committee referral still flags as mislabeled', () => {
  assert.equal(looksMislabeledIntroduced('Referred to the House Committee on Energy and Commerce.'), true);
});

test('a real chamber passage still flags as mislabeled', () => {
  assert.equal(looksMislabeledIntroduced('On passage Passed by recorded vote: 220-210. Agreed to in Senate.'), true);
});

test('no latest action text is not mislabeled', () => {
  assert.equal(looksMislabeledIntroduced(undefined), false);
  assert.equal(looksMislabeledIntroduced(''), false);
});

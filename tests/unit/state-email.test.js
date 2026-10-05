// State legislator email (5 Oct 2026): CiViX no longer sends anything in
// its own name. The drafted email opens in the citizen's own mail app (a
// mailto: link) with the legislator's published address, the subject and
// the body, signed with their name and address only if they added them.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractFunction, read } = require('../helpers/load');

const stateEmailParts = extractFunction('take-action.html', 'stateEmailParts');
const rep = { name: 'Jane Doe', email: 'jane.doe@house.state.example.us' };
const draft = { subject: 'Please support HB 12 & transit', body: 'Dear Rep. Doe,\n\nI support HB 12.' };

test('state email: mailto opens the citizen mail app addressed, with subject and body', () => {
  const p = stateEmailParts(rep, draft, null);
  assert.ok(p.href.startsWith('mailto:jane.doe@house.state.example.us?subject='));
  const q = new URLSearchParams(p.href.split('?')[1]);
  assert.strictEqual(q.get('subject'), draft.subject);
  assert.strictEqual(q.get('body'), draft.body);
  assert.strictEqual(p.text, draft.subject + '\n\n' + draft.body);
});

test('state email: name and address are added as a signature only when given', () => {
  const p = stateEmailParts(rep, draft, { name: 'Sam Citizen', address: '1 Main St, Springfield' });
  assert.ok(p.body.endsWith('\n\nSam Citizen\n1 Main St, Springfield'));
  assert.ok(decodeURIComponent(p.href).includes('Sam Citizen'));
  assert.ok(stateEmailParts(rep, draft, { name: 'Sam Citizen' }).body.endsWith('\n\nSam Citizen'));
});

test('state email: no published address means no mail link (Copy only)', () => {
  assert.strictEqual(stateEmailParts({ name: 'No Email' }, draft, null).href, '');
});

test('CiViX never sends email to officials itself: the sender endpoint is gone and nothing calls it', () => {
  const root = path.resolve(__dirname, '..', '..');
  assert.ok(!fs.existsSync(path.join(root, 'functions/api/send-state-email.js')));
  assert.ok(!read('take-action.html').includes('/api/send-state-email'));
});

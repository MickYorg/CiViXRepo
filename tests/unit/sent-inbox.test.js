// Take Action's "Sent to CiViX" inbox (4 Oct 2026): one-line summaries that
// open into collapsible sections. Tapping a "CiViX dug in" push opens that
// item with every section open; otherwise everything starts collapsed; and
// whatever the citizen opened or closed survives the inbox re-rendering
// while a dig runs.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractFunction } = require('../helpers/load');

const sentOpenState = extractFunction('take-action.html', 'sentOpenState');
const sentLineText = extractFunction('take-action.html', 'sentLineText');
const sentStatus = extractFunction('take-action.html', 'sentStatus');

const items = [{ id: 'a1' }, { id: 'b2' }, { id: 'c3' }];

test('sent inbox: without a push, every item and section starts collapsed', () => {
  const open = sentOpenState(items, '', {});
  assert.ok(Object.keys(open).length === 12);
  assert.ok(Object.values(open).every(v => v === false));
});

test('sent inbox: from a push, that item and all its sections start open, nothing else', () => {
  const open = sentOpenState(items, 'b2', {});
  for (const part of ['', ':moves', ':claims', ':sources']) {
    assert.strictEqual(open['b2' + part], true, 'b2' + part);
    assert.strictEqual(open['a1' + part], false, 'a1' + part);
  }
});

test('sent inbox: what the citizen opened or closed is kept across re-renders', () => {
  const open = sentOpenState(items, 'b2', { 'a1': true, 'b2:claims': false });
  assert.strictEqual(open.a1, true);
  assert.strictEqual(open['b2:claims'], false);
  assert.strictEqual(open['b2:moves'], true);
});

test('sent inbox: the one-liner is the dig headline, else what was sent', () => {
  assert.strictEqual(sentLineText({ title: 'Raw page title', dig: { headline: 'The Fed and rates, checked' } }), 'The Fed and rates, checked');
  assert.strictEqual(sentLineText({ title: 'Raw page title', dig: null, dig_state: 'queued' }), 'Raw page title');
  assert.strictEqual(sentLineText({ title: 'Raw page title', dig: { error: 'Timed out' } }), 'Raw page title');
  assert.strictEqual(sentLineText({ url: 'https://x.com/p/1' }), 'https://x.com/p/1');
});

test('sent inbox: the one-liner says when a dig is still running or failed', () => {
  assert.strictEqual(sentStatus({ dig: { headline: 'h' } }), '');
  assert.strictEqual(sentStatus({ dig: null, dig_state: 'digging' }), 'Digging in…');
  assert.strictEqual(sentStatus({ dig: { error: 'x' }, dig_state: 'failed' }), 'Couldn’t dig in');
});

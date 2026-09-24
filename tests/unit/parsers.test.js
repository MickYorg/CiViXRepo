// Parsers for model output. Models add unprompted preambles, wrap quoted
// lines, and add markdown — each of these broke a real screen once.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFunction } = require('../helpers/load');

const parsePointList = extractFunction('dig/index.html', 'parsePointList');
const parseAIJSON = extractFunction('builder.html', 'parseAIJSON');
const cleanDraftText = extractFunction('take-action.html', 'cleanDraftText');
const mergeStance = extractFunction('builder.html', 'mergeStance');

test('DIG DEBATE: preamble is dropped and wrapped points stay whole (22 Sep 2026)', () => {
  const raw = `Here are the strongest points from this source's coverage.

POINT: The bill would cut funding for rural clinics by 12%.
POINT: The outlet quotes a hospital director saying
"we will close two wards"
if it passes.
POINT: Critics argue the savings are overstated.`;
  const points = parsePointList(raw, 'POINT');
  assert.equal(points.length, 3);
  assert.equal(points[1], 'The outlet quotes a hospital director saying "we will close two wards" if it passes.');
  assert.ok(!points.some((p) => /Here are/.test(p)), 'preamble not treated as a point');
});

test('DIG DEBATE: no points means an empty list, not junk', () => {
  assert.equal(parsePointList('I could not find coverage of this topic.', 'POINT').length, 0);
});

test('AI JSON: survives a chatty preamble and code fences (10 Sep 2026)', () => {
  assert.equal(parseAIJSON('This is a real, specific piece of legislation. {"specific": true, "topic": "EFTA II"}').topic, 'EFTA II');
  assert.equal(parseAIJSON('```json\n{"a":1}\n```').a, 1);
  assert.equal(parseAIJSON('Sure! [1,2,3] hope that helps').length, 3);
});

test('AI JSON: real garbage still throws rather than inventing a result', () => {
  assert.throws(() => parseAIJSON('no json here at all'));
});

test('drafts: mid-sentence line wraps are joined, signature breaks kept (23 Sep 2026)', () => {
  const draft = `Dear Representative Smith,
I am writing to urge you to
support the bill.

Sincerely,
A constituent in 02118`;
  const out = cleanDraftText(draft);
  assert.match(out, /I am writing to urge you to support the bill\./);
  assert.match(out, /Sincerely,\nA constituent in 02118/);
});

test('stances merge instead of overwriting (never silently lose input, 4 Sep 2026)', () => {
  assert.equal(mergeStance('Release the Epstein files', 'Defund Flock'), 'Release the Epstein files Also: Defund Flock');
  assert.equal(mergeStance('', 'New'), 'New');
  assert.equal(mergeStance('Same', 'Same'), 'Same');
  assert.equal(mergeStance('Keep me', ''), 'Keep me');
});

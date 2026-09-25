// Send to CiViX phase 2: the dig that turns a capture into "here's your move".
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ROOT } = require('../helpers/load');
const mod = () => import(path.join(ROOT, 'functions/api/capture-dig.js'));

const good = {
  headline: 'Senate vote on a data broker bill', summary: 'A bill would restrict data brokers.',
  kind: 'bill', topic: 'Data privacy', level: 'federal',
  claims: [{ claim: 'It bans all data sales', assessment: 'misleading', note: 'Only brokers of sensitive data.' }],
  bill: { citation: 'S. 1234', congress: 119, title: 'Data Broker Act' },
  moves: [{ action: 'call', title: 'Call your senators', why: 'Vote Thursday.', target: 'your U.S. senators' }],
  sources: [{ title: 'Congress.gov', url: 'https://www.congress.gov/bill/119th-congress/senate-bill/1234' }, { title: 'bad', url: 'javascript:alert(1)' }],
};

test('the analysis survives a chatty preamble and code fences', async () => {
  const { parseDig } = await mod();
  const d = parseDig('Here is what I found:\n```json\n' + JSON.stringify(good) + '\n```');
  assert.equal(d.headline, good.headline);
  assert.equal(d.bill.citation, 'S. 1234');
  assert.equal(d.moves[0].action, 'call');
});

test('only real http(s) source links are kept', async () => {
  const { parseDig } = await mod();
  const d = parseDig(JSON.stringify(good));
  assert.equal(d.sources.length, 1);
  assert.match(d.sources[0].url, /^https:\/\//);
});

test('junk or missing fields give null, not a half-empty card', async () => {
  const { parseDig } = await mod();
  assert.equal(parseDig('I could not find anything.'), null);
  assert.equal(parseDig(JSON.stringify({ summary: 'no headline' })), null);
});

test('limits: at most 3 claims, 3 moves', async () => {
  const { parseDig } = await mod();
  const many = { ...good, claims: Array(6).fill(good.claims[0]), moves: Array(6).fill(good.moves[0]) };
  const d = parseDig(JSON.stringify(many));
  assert.equal(d.claims.length, 3);
  assert.equal(d.moves.length, 3);
});

test('the prompt includes what was sent and the citizen\'s own words, and never asks for a guessed citation', async () => {
  const { buildPrompt } = await mod();
  const p = buildPrompt({ title: 'Awful post', text: 'Why it matters to me: my kids', url: 'https://x.com/a/status/1', source: 'Post by A: text' });
  assert.match(p, /Awful post/);
  assert.match(p, /my kids/);
  assert.match(p, /never guess a citation/);
});

test('a reply split around citations (line breaks inside strings) still parses', async () => {
  const { parseDig } = await mod();
  const broken = JSON.stringify(good).replace('restrict data brokers', 'restrict\ndata brokers');
  const d = parseDig(broken);
  assert.ok(d, 'parsed');
  assert.match(d.summary, /restrict data brokers/);
});

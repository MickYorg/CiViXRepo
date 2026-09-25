// Server-side rules, plus the hand-kept copies that must stay identical.
// The client pages and Cloudflare Functions can't share modules, so several
// tables exist in 2-3 copies (see CLAUDE.md); drift between them has caused
// real bugs, so these tests compare the copies directly.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { read, ROOT } = require('../helpers/load');

const lib = (f) => import(path.join(ROOT, 'functions/_lib', f));

// Evaluates the object/array literal that follows `marker` in a file.
function literalAfter(file, marker) {
  const src = read(file);
  const at = src.indexOf(marker);
  if (at === -1) throw new Error(`"${marker}" not found in ${file}`);
  const open = src.slice(at + marker.length).search(/[[{]/) + at + marker.length;
  const pairs = { '[': ']', '{': '}' };
  let depth = 0, quote = null, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) break;
  }
  void pairs;
  return new Function(`return ${src.slice(open, i + 1)}`)();
}

test('bill status is read from the latest action text', async () => {
  const { deriveStatus } = await lib('congress-bill.js');
  assert.equal(deriveStatus('Became Public Law No: 119-4.'), 'Became Law');
  assert.equal(deriveStatus('Referred to the House Committee on the Judiciary.'), 'In Committee');
  assert.equal(deriveStatus('Passed/agreed to in Senate: Passed Senate without amendment.'), 'Passed Senate');
  assert.equal(deriveStatus('Introduced in House'), 'Introduced');
  // Real latestAction phrasings from congress.gov that were mislabeled
  // 'Introduced' until 24 Sep 2026:
  assert.equal(deriveStatus('Referred to the House Committee on Oversight and Government Reform.'), 'In Committee');
  assert.equal(deriveStatus('Subcommittee Hearings Held'), 'In Committee');
  assert.equal(deriveStatus('Submitted in the Senate, considered, and agreed to without amendment and with a preamble by Unanimous Consent.'), 'Passed Senate');
  assert.equal(deriveStatus('Resolution agreed to in Senate without amendment by Unanimous Consent.'), 'Passed Senate');
  assert.equal(deriveStatus('Received in the Senate.'), 'Passed House');
  // Found by the live checks, 25 Sep 2026:
  assert.equal(deriveStatus('Senate agreed to the House amendment to S. 240 by Unanimous Consent.'), 'Passed Senate');
  assert.equal(deriveStatus('Motion to reconsider laid on the table Agreed to without objection.'), 'Passed House');
  assert.equal(deriveStatus('Held at the desk.'), 'Passed House');
  assert.equal(deriveStatus('Ordered to be Reported (Amended) by the Yeas and Nays: 28 - 21.'), 'Reported by Committee');
  assert.equal(deriveStatus('Placed on the Union Calendar, Calendar No. 412.'), 'Reported by Committee');
  assert.equal(deriveStatus('Placed on Senate Legislative Calendar under General Orders. Calendar No. 501.'), 'On Floor Calendar');
});

test('election facts come from fixed rules, not guesses', async () => {
  const e = await lib('election-dates.js');
  assert.equal(e.generalElectionDateForYear(2026).toISOString().slice(0, 10), '2026-11-03');
  assert.equal(e.generalElectionDateForYear(2028).toISOString().slice(0, 10), '2028-11-07');
  assert.equal(e.currentCongressNumber(new Date('2026-09-24')), 119);
});

test('server bill matching ignores committee-referral boilerplate too (HRES 1517)', async () => {
  const { matchBills } = await lib('bill-matching.js');
  const ceremonial = {
    title: 'Expressing support for the recognition of September 7, 2026, as "Liturgical Dance Day"',
    latestAction: { text: 'Referred to the House Committee on Oversight and Government Reform.' },
  };
  assert.equal(matchBills([ceremonial], [{ id: 'government-transparency', name: 'Government transparency', weight: 2 }]).length, 0);
});

test('no Function returns a Cloudflare-reserved status (502/504/52x hide the real error)', () => {
  const dir = path.join(ROOT, 'functions');
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } })(dir);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const bad = src.match(/status\s*:\s*(502|504|52[0-9])\b|,\s*(502|504|52[0-9])\s*\)/);
    assert.equal(bad, null, `${path.relative(ROOT, f)} uses reserved status ${bad && bad[0]}`);
  }
});

test('synced copy: bill-matching.js SYNONYMS === digest.js SYNONYMS', async () => {
  const { SYNONYMS } = await lib('bill-matching.js');
  assert.deepEqual(JSON.parse(JSON.stringify(SYNONYMS)), literalAfter('digest.js', 'const SYNONYMS ='));
});

test('synced copy: loose-word stoplists match in all three places', () => {
  const a = [...literalAfter('digest.js', 'const LOOSE_WORD_STOPLIST = new Set(')].sort();
  const b = [...literalAfter('functions/_lib/bill-matching.js', 'const LOOSE_WORD_STOPLIST = new Set(')].sort();
  const c = [...literalAfter('builder.html', 'const LOOSE_WORD_STOPLIST_MATCH = new Set(')].sort();
  assert.deepEqual(b, a, 'bill-matching.js vs digest.js');
  assert.deepEqual(c, a, 'builder.html vs digest.js');
});

test('synced copy: issue-taxonomy.js lists exactly builder.html CATALOG issues', async () => {
  const { ALL_ISSUE_NAMES } = await lib('issue-taxonomy.js');
  const catalog = literalAfter('builder.html', 'const CATALOG =').flatMap(([, issues]) => issues);
  assert.deepEqual([...ALL_ISSUE_NAMES].sort(), catalog.sort());
});

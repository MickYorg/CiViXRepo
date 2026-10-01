// Send to CiViX feeds the manifesto: each dug capture adds (or raises) its
// topic once, keeps the citizen's own "why it matters", and can be undone.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFunction } = require('../helpers/load');

function setup(profile, items) {
  const store = { profile: JSON.parse(JSON.stringify(profile)) };
  const deps = {
    SENT_ITEMS: items,
    loadRawProfile: () => store.profile,
    saveProfile: (p) => { store.profile = p; },
    slug: (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  };
  deps.sentWhy = extractFunction('take-action.html', 'sentWhy', deps);
  return {
    store,
    apply: extractFunction('take-action.html', 'applySentToManifesto', deps),
    undo: extractFunction('take-action.html', 'undoSentManifesto', deps),
  };
}
const dug = (id, topic, note = '') => ({ id, note, dig: { topic, headline: 'h' } });

test('a new topic is added with the citizen\'s own words as the stance', () => {
  const { store, apply } = setup({ issues: [] }, [dug('a1', 'Public health', 'Why it matters to me: my kids')]);
  assert.equal(apply(), true);
  const iss = store.profile.issues[0];
  assert.equal(iss.name, 'Public health');
  assert.equal(iss.weight, 2);
  assert.equal(iss.stance, 'my kids');
});

test('an existing topic is raised a notch (max 3), not duplicated', () => {
  const { store, apply } = setup({ issues: [{ id: 'public-health', name: 'Public health', weight: 2, stance: '' }] }, [dug('a1', 'Public health')]);
  apply();
  assert.equal(store.profile.issues.length, 1);
  assert.equal(store.profile.issues[0].weight, 3);
});

test('each capture is applied once, ever', () => {
  const items = [dug('a1', 'Public health')];
  const { store, apply } = setup({ issues: [] }, items);
  apply();
  assert.equal(apply(), false);
  assert.equal(store.profile.issues.length, 1);
});

test('undo removes a topic the capture added, or restores the old priority', () => {
  const s1 = setup({ issues: [] }, [dug('a1', 'Public health')]);
  s1.apply(); s1.undo({ id: 'a1' });
  assert.equal(s1.store.profile.issues.length, 0);
  const s2 = setup({ issues: [{ id: 'public-health', name: 'Public health', weight: 1 }] }, [dug('a1', 'Public health')]);
  s2.apply(); s2.undo({ id: 'a1' });
  assert.equal(s2.store.profile.issues[0].weight, 1);
});

test('failed digs and captures with no topic never touch the manifesto', () => {
  const { store, apply } = setup({ issues: [] }, [{ id: 'x', dig: { error: 'HTTP 524' } }, dug('y', '')]);
  assert.equal(apply(), false);
  assert.equal(store.profile.issues.length, 0);
});

test('Send to CiViX: "Not for me" really deletes the item from the server ("Delete it anytime")', () => {
  const src = require('../helpers/load').read('take-action.html');
  const handler = /const sentNot = [^\n]*\n\s*if \(sentNot\)[^\n]*/.exec(src);
  assert.ok(handler && /deleteSent\(it\)/.test(handler[0]), 'Not for me calls deleteSent');
  const fn = /async function deleteSent\(it\) \{[\s\S]*?\n  \}/.exec(src);
  assert.ok(fn && /method: 'DELETE'/.test(fn[0]) && /\/api\/filing\?token=/.test(fn[0]), 'deleteSent sends DELETE /api/filing');
});

// Shared with tests/live/production.test.js and tests/unit: the heuristic
// that flags a federal bill labeled 'Introduced' whose latestAction text
// suggests it actually moved further (a sign functions/_lib/congress-bill.js
// missed a status pattern). "ASSUMING FIRST SPONSORSHIP" actions are a
// routine unanimous-consent request to reassign sponsor credit for
// cosponsor/reprinting purposes — unrelated to the bill's own progress —
// and their boilerplate ends "Agreed to without objection.", which was
// tripping this heuristic daily (H.R. 4006, 5658, 4213, 1522 seen 4-8 Nov
// 2026) even though congress-bill.js's own status was already correct.
function looksMislabeledIntroduced(latestActionText) {
  const text = latestActionText || '';
  if (/assuming (the )?first sponsorship/i.test(text)) return false;
  return /referred to|placed on|agreed to/i.test(text);
}

module.exports = { looksMislabeledIntroduced };

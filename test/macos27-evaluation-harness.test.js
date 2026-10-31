const test = require('node:test');
const assert = require('node:assert/strict');

test('macOS 27 evaluation fixtures materialize deterministically and preserve critical rules', async () => {
  const { evaluateAssertions, materializeInput, sha256 } = await import('../scripts/run-macos27-evaluation.mjs');
  const item = { id: 'long', input_builder: { text: '3500 不要上線。', repeat: 2 } };
  assert.equal(materializeInput(item), '3500 不要上線。3500 不要上線。');
  assert.equal(sha256(materializeInput(item)), sha256(materializeInput(item)));
  assert.deepEqual(evaluateAssertions('費用三千五百元，不要上線。', {
    must_contain_all: ['三千五百', '不要上線'], must_not_contain_any: ['三萬'],
    must_match_all: ['(?:不要|不得)上線'],
  }), { passed: true, missing: [], forbidden: [], missingPatterns: [], forbiddenPatterns: [], occurrenceDeficits: [] });
  assert.equal(evaluateAssertions('費用三萬元，現在上線。', {
    must_contain_all: ['三千五百', '不要上線'], must_not_contain_any: ['三萬'],
    must_not_match_any: ['費用(?:是|為)?三萬'],
  }).passed, false);
  assert.equal(evaluateAssertions('這個費用是三萬，不是三千五百元。', {
    must_not_match_any: ['三萬[，,、\\s]*(?:而)?不是(?:是)?三千五百'],
  }).passed, false);
  assert.deepEqual(evaluateAssertions('3500，不要上線。', {
    min_occurrences: { '3500': 2, '不要上線': 2 },
  }).occurrenceDeficits, [
    { fragment: '3500', minimum: 2, actual: 1 },
    { fragment: '不要上線', minimum: 2, actual: 1 },
  ]);
});

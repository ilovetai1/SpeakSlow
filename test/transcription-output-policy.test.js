const assert = require("node:assert/strict");
const test = require("node:test");

for (const scenario of [
  { pasteEnabled: false, enterEnabled: false, pasteSucceeded: false, expected: { paste: false, enter: false } },
  { pasteEnabled: false, enterEnabled: true, pasteSucceeded: false, expected: { paste: false, enter: false } },
  { pasteEnabled: true, enterEnabled: false, pasteSucceeded: true, expected: { paste: true, enter: false } },
  { pasteEnabled: true, enterEnabled: true, pasteSucceeded: false, expected: { paste: true, enter: false } },
  { pasteEnabled: true, enterEnabled: true, pasteSucceeded: true, expected: { paste: true, enter: true } },
]) {
  test(`paste=${scenario.pasteEnabled}, enter=${scenario.enterEnabled}, success=${scenario.pasteSucceeded}`, async () => {
    const { decideOutputActions } = await import("../src/utils/transcriptionOutputPolicy.mjs");
    assert.deepEqual(decideOutputActions(scenario), scenario.expected);
  });
}

test("只有後續潤稿成功才清除既有 issue", async () => {
  const { nextPolishingIssue } = await import("../src/utils/transcriptionOutputPolicy.mjs");

  assert.equal(
    nextPolishingIssue("先前潤稿失敗", { enhanced_by_ai: false, issue: null }),
    "先前潤稿失敗",
  );
  assert.equal(
    nextPolishingIssue("先前潤稿失敗", { enhanced_by_ai: true, issue: null }),
    null,
  );
  assert.equal(
    nextPolishingIssue(null, { enhanced_by_ai: false, issue: "歷史紀錄保存失敗" }),
    "歷史紀錄保存失敗",
  );
});

test('candidate-only 結果可顯示但永遠不進入貼上路徑', async () => {
  const { decideFinalizationPresentation } = await import('../src/utils/transcriptionOutputPolicy.mjs');
  assert.deepEqual(decideFinalizationPresentation({
    success: true,
    enhanced_by_ai: true,
    text: 'Apple 潤稿候選。',
    outputAction: 'candidate_only',
  }), { paste: false, showCandidate: true });
  assert.deepEqual(decideFinalizationPresentation({
    success: true,
    enhanced_by_ai: false,
    text: '穩定原稿',
    outputAction: 'baseline_output',
  }), { paste: true, showCandidate: false });
});

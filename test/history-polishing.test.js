const assert = require("node:assert/strict");
const test = require("node:test");

test("history contract 只呈現 baseline 與一份最新 final，不重複 processed_text", async () => {
  const { historyTextContract } = await import("../src/utils/historyPolishing.mjs");
  const legacy = historyTextContract({
    id: 7,
    raw_text: "AI 前文字",
    text: "最新結果",
    processed_text: "最新結果",
  });

  assert.equal(legacy.baselineText, "AI 前文字");
  assert.equal(legacy.finalText, "最新結果");
  assert.equal(legacy.showBaseline, true);
  assert.equal(Object.hasOwn(legacy, "processedText"), false);
});

test("歷史重新潤稿永遠使用 raw_text baseline，不使用目前 final", async () => {
  const { previewHistoryPolish } = await import("../src/utils/historyPolishing.mjs");
  const inputs = [];
  const preview = await previewHistoryPolish({
    record: { raw_text: "基準逐字稿", text: "舊的最終結果" },
    processText: async (text, mode) => {
      inputs.push([text, mode]);
      return { success: true, text: "新的候選結果" };
    },
  });

  assert.deepEqual(inputs, [["基準逐字稿", "optimize"]]);
  assert.deepEqual(preview, {
    success: true,
    baselineText: "基準逐字稿",
    currentText: "舊的最終結果",
    candidateText: "新的候選結果",
  });
});

test("歷史重新潤稿失敗不產生候選或修改內容", async () => {
  const { previewHistoryPolish } = await import("../src/utils/historyPolishing.mjs");
  const preview = await previewHistoryPolish({
    record: { raw_text: "基準逐字稿", text: "舊結果" },
    processText: async () => ({ success: false, error: "timeout" }),
  });

  assert.deepEqual(preview, { success: false, error: "timeout" });
});

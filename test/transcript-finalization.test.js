const assert = require("node:assert/strict");
const test = require("node:test");

test("潤稿關閉或操作模式時不呼叫 provider，並保存 baseline 作為 final", async () => {
  const { finalizeTranscript } = await import("../src/utils/transcriptFinalization.mjs");
  for (const options of [
    { polishingEnabled: false, commandMode: false },
    { polishingEnabled: true, commandMode: true },
  ]) {
    let aiCalls = 0;
    const saved = [];
    const result = await finalizeTranscript({
      rawText: "原始內容",
      ...options,
      processText: async () => { aiCalls += 1; return { success: true, text: "不應使用" }; },
      saveTranscription: async (data) => { saved.push(data); return { lastInsertRowid: 1 }; },
      transcriptionData: { language: "zh-TW" },
    });

    assert.equal(aiCalls, 0);
    assert.equal(result.finalText, "原始內容");
    assert.equal(result.issue, null);
    assert.equal(saved[0].raw_text, "原始內容");
    assert.equal(saved[0].text, "原始內容");
  }
});

test("潤稿成功採用 non-empty final content，並清除先前 issue", async () => {
  const { finalizeTranscript } = await import("../src/utils/transcriptFinalization.mjs");
  const result = await finalizeTranscript({
    rawText: "嗯我要測試",
    polishingEnabled: true,
    commandMode: false,
    processText: async () => ({ success: true, text: "我要測試。" }),
    saveTranscription: async () => ({ lastInsertRowid: 2 }),
    transcriptionData: {},
  });

  assert.equal(result.finalText, "我要測試。");
  assert.equal(result.polished, true);
  assert.equal(result.issue, null);
});

test("潤稿失敗使用 baseline 並繼續保存，不嘗試替代 provider", async () => {
  const { finalizeTranscript } = await import("../src/utils/transcriptFinalization.mjs");
  let aiCalls = 0;
  const saved = [];
  const result = await finalizeTranscript({
    rawText: "原始內容",
    polishingEnabled: true,
    commandMode: false,
    processText: async () => { aiCalls += 1; return { success: false, code: "timeout" }; },
    saveTranscription: async (data) => { saved.push(data); return { lastInsertRowid: 3 }; },
    transcriptionData: {},
  });

  assert.equal(aiCalls, 1);
  assert.equal(result.finalText, "原始內容");
  assert.equal(result.issue, "潤稿失敗，已使用原始文字");
  assert.equal(saved[0].text, "原始內容");
});

test("DB 保存失敗仍回傳可輸出的 final text 與 inline issue", async () => {
  const { finalizeTranscript } = await import("../src/utils/transcriptFinalization.mjs");
  const result = await finalizeTranscript({
    rawText: "原始內容",
    polishingEnabled: true,
    commandMode: false,
    processText: async () => ({ success: true, text: "最終內容" }),
    saveTranscription: async () => { throw new Error("disk full"); },
    transcriptionData: {},
  });

  assert.equal(result.finalText, "最終內容");
  assert.equal(result.saved, false);
  assert.equal(result.issue, "歷史紀錄保存失敗");
});

test("single-flight gate 在上一條 pipeline 完成前拒絕且不排隊", async () => {
  const { createSingleFlightGate } = await import("../src/utils/transcriptFinalization.mjs");
  const gate = createSingleFlightGate();

  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  assert.equal(gate.busy, true);
  gate.finish();
  assert.equal(gate.tryStart(), true);
});

test("runtime shutdown 取消結果，不保存也不貼上 fallback", async () => {
  const { finalizeTranscript } = await import("../src/utils/transcriptFinalization.mjs");
  let saveCalls = 0;
  const result = await finalizeTranscript({
    rawText: "不得在結束後貼上的內容",
    polishingEnabled: true,
    commandMode: false,
    processText: async () => ({
      success: false,
      code: "runtime_stopping",
      cancelled: true,
    }),
    saveTranscription: async () => { saveCalls += 1; },
    transcriptionData: {},
  });

  assert.equal(result.cancelled, true);
  assert.equal(result.finalText, null);
  assert.equal(saveCalls, 0);
});

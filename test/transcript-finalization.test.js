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

test('normal and Apple live-preview finalization preserve raw text on provider failure or disable', async () => {
  const { finalizeTranscript } = await import('../src/utils/transcriptFinalization.mjs');
  for (const mode of ['offline', 'streaming']) {
    for (const providerResult of [{ success: false, code: 'timeout' }, { success: false, code: 'provider_unavailable' }, { success: true, text: ' ' }, { success: false, code: 'polishing_disabled' }]) {
      const saved = []; let calls = 0;
      const result = await finalizeTranscript({ rawText: '三萬，不是三千五。', polishingEnabled: true, transcriptionData: { mode }, processText: async () => { calls++; return providerResult; }, saveTranscription: async data => { saved.push(data); return { changes: 1 }; } });
      assert.equal(result.finalText, '三萬，不是三千五。'); assert.equal(result.polished, false);
      assert.equal(result.issue, providerResult.code === 'polishing_disabled' ? null : '潤稿失敗，已使用原始文字');
      assert.equal(calls, 1); assert.equal(saved.length, 1); assert.equal(saved[0].raw_text, saved[0].text);
    }
  }
});

test('cancellation before generation or after persistence suppresses final output', async () => {
  const { finalizeTranscript } = await import('../src/utils/transcriptFinalization.mjs');
  let saved = 0, generated = 0, cancelled = true;
  const options = { rawText: '原文', polishingEnabled: true, transcriptionData: {}, isCancelled: () => cancelled, processText: async () => { generated++; return { success: true, text: '候選' }; }, saveTranscription: async () => { saved++; cancelled = true; return { changes: 1 }; } };
  const early = await finalizeTranscript(options);
  assert.equal(early.cancelled, true); assert.equal(generated, 0); assert.equal(saved, 0);
  cancelled = false;
  const afterSave = await finalizeTranscript(options);
  assert.equal(afterSave.cancelled, true); assert.equal(afterSave.finalText, null);
  assert.equal(afterSave.saved, true, 'an already-completed write must not be reported as undone');
  assert.equal(saved, 1); assert.equal(generated, 1);
});

test('structured persistence failures retain usable final text but never report saved', async () => {
  const { finalizeTranscript } = await import('../src/utils/transcriptFinalization.mjs');
  for (const failure of [false, { success: false }, { changes: 0 }]) {
    let writes = 0;
    const result = await finalizeTranscript({ rawText: '原文', polishingEnabled: false, transcriptionData: {}, saveTranscription: async () => { writes++; return failure; } });
    assert.equal(result.saved, false); assert.equal(result.issue, '歷史紀錄保存失敗');
    assert.equal(result.finalText, '原文'); assert.equal(writes, 1);
  }
});

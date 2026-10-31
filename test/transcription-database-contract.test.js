const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const databaseManagerPath = process.env.SPEAKSLOW_PACKAGED_DB_MANAGER
  || "../src/helpers/database";
const DatabaseManager = require(databaseManagerPath);

test("歷史紀錄分開保存 baseline 與 final，且可獨立更新", {
  skip: !process.env.SPEAKSLOW_PACKAGED_DB_MANAGER && process.versions.modules !== "125"
    ? "better-sqlite3 使用 Electron ABI，須在打包後用 Electron runtime 驗證"
    : false,
}, (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-db-contract-"));
  const database = new DatabaseManager();
  database.initialize(dataDirectory);
  t.after(() => {
    database.close();
    fs.rmSync(dataDirectory, { recursive: true });
  });

  const saved = database.saveTranscription({
    raw_text: "辨識原文",
    text: "第一次潤稿。",
    processed_text: null,
    language: "zh-TW",
  });

  let row = database.getTranscriptionById(saved.lastInsertRowid);
  assert.equal(row.raw_text, "辨識原文");
  assert.equal(row.text, "第一次潤稿。");
  assert.equal(row.processed_text, null);

  database.updateTranscriptionFinalText(row.id, "第二次潤稿。");
  row = database.getTranscriptionById(row.id);
  assert.equal(row.raw_text, "辨識原文");
  assert.equal(row.text, "第二次潤稿。");
  assert.equal(row.processed_text, null);

  database.replaceTranscriptionBaseline(row.id, "重新辨識原文");
  row = database.getTranscriptionById(row.id);
  assert.equal(row.raw_text, "重新辨識原文");
  assert.equal(row.text, "重新辨識原文");
  assert.equal(row.processed_text, null);
});

test("Apple 快速輸出只在 baseline 未變時更新同一筆歷史紀錄", {
  skip: !process.env.SPEAKSLOW_PACKAGED_DB_MANAGER && process.versions.modules !== "125"
    ? "better-sqlite3 使用 Electron ABI，須在打包後用 Electron runtime 驗證"
    : false,
}, (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "speakslow-fast-candidate-"));
  const database = new DatabaseManager();
  database.initialize(dataDirectory);
  t.after(() => {
    database.close();
    fs.rmSync(dataDirectory, { recursive: true });
  });

  const baseline = "三萬，不是三千五。";
  const saved = database.saveTranscription({ raw_text: baseline, text: baseline, language: "zh-TW" });
  const id = Number(saved.lastInsertRowid);
  database.updateTranscriptionText(id, baseline, "不得保留的舊候選");

  assert.deepEqual(
    database.updateFastTranscriptionCandidate(id, baseline, "三萬，不是三千五元。"),
    { success: true, changes: 1 },
  );
  let row = database.getTranscriptionById(id);
  assert.equal(row.raw_text, baseline);
  assert.equal(row.text, "三萬，不是三千五元。");
  assert.equal(row.processed_text, null);

  database.updateTranscriptionFinalText(id, "使用者稍後修改的內容");
  assert.deepEqual(database.updateFastTranscriptionCandidate(id, baseline, "晚到的 Apple 候選"), {
    success: false,
    changes: 0,
    code: "history_changed",
    error: "歷史紀錄已變更，未套用潤稿候選",
  });
  assert.equal(database.getTranscriptionById(id).text, "使用者稍後修改的內容");

  assert.deepEqual(database.updateFastTranscriptionCandidate(id + 9999, baseline, "候選"), {
    success: false,
    changes: 0,
    code: "history_missing",
    error: "找不到歷史紀錄，未套用潤稿候選",
  });
});

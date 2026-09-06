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

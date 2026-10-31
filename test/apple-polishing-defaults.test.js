const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const DatabaseManager = require('../src/helpers/database');

const sqliteOptions = { skip: process.versions.modules !== '125' ? 'better-sqlite3 requires Electron ABI 125; run this file with Electron runtime' : false };
function directory(t) {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-apple-defaults-'));
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}
function open(t, dir, supported) {
  const database = new DatabaseManager(null, { platformSupported: () => supported });
  database.initialize(dir);
  t.after(() => database.close());
  return database;
}

test('Only a newly created supported Mac database receives Apple provider with polishing off', sqliteOptions, t => {
  const database = open(t, directory(t), true);
  assert.equal(database.getSetting('ai_provider'), 'apple_on_device');
  assert.equal(database.getSetting('enable_ai_optimization'), false);
  assert.equal(database.getSetting('ai_api_key'), null);
});

test('Existing database retains provider, prompt, key and enable preference', sqliteOptions, t => {
  const dir = directory(t);
  const first = open(t, dir, false);
  const settings = { ai_provider: 'ollama', enable_ai_optimization: true, ai_model: 'keep-model', ai_api_key: 'fixture-key', transcript_polishing_prompt: '保留提示詞' };
  for (const [key, value] of Object.entries(settings)) first.setSetting(key, value);
  first.close();
  const second = open(t, dir, true);
  assert.deepEqual(second.getAllSettings(), settings);
});

test('Existing unconfigured database is not misclassified as a new installation', sqliteOptions, t => {
  const dir = directory(t);
  const first = open(t, dir, false);
  first.setSetting('language', 'zh-TW');
  first.close();
  const second = open(t, dir, true);
  assert.deepEqual(second.getAllSettings(), { language: 'zh-TW' });
});

test('Unsupported platform does not persist Apple AI defaults', sqliteOptions, t => {
  assert.deepEqual(open(t, directory(t), false).getAllSettings(), {});
});

test('Failed fresh-default transaction reports failure and rolls back provider selection', sqliteOptions, t => {
  const dir = directory(t);
  const first = new DatabaseManager(null, { platformSupported: () => true });
  const write = first.setSetting.bind(first);
  first.setSetting = (key, value) => {
    if (key === 'enable_ai_optimization') throw Error('fixture persistence failure');
    return write(key, value);
  };
  assert.throws(() => first.initialize(dir), /fixture persistence failure/);
  first.close();
  assert.deepEqual(open(t, dir, true).getAllSettings(), {});
});

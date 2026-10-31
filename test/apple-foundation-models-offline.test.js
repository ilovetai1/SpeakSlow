const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { AppleFoundationModelsManager } = require('../src/helpers/ai/appleFoundationModelsManager');
const { PRIVATE_SENTINEL } = require('./fixtures/macos27-native-contract');

const enabled = process.env.SPEAKSLOW_NATIVE_FOUNDATION_MODELS_OFFLINE_TEST === '1';

test('native Apple model remains ready and generates with all network access denied', {
  skip: !enabled,
  timeout: 120000,
}, async t => {
  const helperPath = path.resolve(__dirname, '../native/build/apple-foundation-models');
  const logs = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message, data) => logs.push({ level, message, data })]));
  const spawnFn = (file, args, options) => spawn('/usr/bin/sandbox-exec', [
    '-p', '(version 1) (allow default) (deny network*)', file, ...args,
  ], options);
  const manager = new AppleFoundationModelsManager({ logger, helperPath, spawnFn });
  t.after(() => manager.dispose());

  const status = await manager.probe();
  assert.equal(status.available, true, status.reason);
  const result = await manager.generate({
    instructions: '只整理標點，保留所有數字與否定關係。',
    prompt: `${PRIVATE_SENTINEL}，不要上線，金額是三千五百元。`,
    maxOutputTokens: 128,
  });
  assert.equal(result.complete, true);
  assert.ok(result.text.trim());
  assert.equal(JSON.stringify(logs).includes(PRIVATE_SENTINEL), false);
  t.diagnostic(JSON.stringify({ network: 'denied by sandbox profile', variant: result.variant,
    contextSize: result.contextSize, locale: result.locale, outputTokens: result.outputTokenCount }));
});

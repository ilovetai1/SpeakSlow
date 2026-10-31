const test = require('node:test');
const assert = require('node:assert/strict');
const { AppleFoundationModelsManager } = require('../src/helpers/ai/appleFoundationModelsManager');

// Explicit synthetic-only native integration. No microphone, user DB, network
// adapter, clipboard or real user transcript is involved.
const enabled = process.env.SPEAKSLOW_NATIVE_FOUNDATION_MODELS_TEST === '1';
test('native macOS27 helper probes, budgets, rejects token-limited partials and runs isolated sessions', {
  skip: !enabled, timeout: 150000,
}, async t => {
  const logs = [];
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message, data) => logs.push({ message, data })]));
  const manager = new AppleFoundationModelsManager({ logger });
  t.after(() => manager.dispose());
  const ready = await manager.probe();
  t.diagnostic(JSON.stringify({ scope: 'Native helper only; not packaged app or semantic quality acceptance',
    state: ready.state, reason: ready.reason, variant: ready.variant, contextSize: ready.contextSize, locale: ready.locale }));
  if (!ready.available) {
    await assert.rejects(manager.generate({ instructions: '只回覆測試。', prompt: '測試資料。' }), error => error.code === ready.reason);
    return;
  }
  await assert.rejects(manager.generate({ instructions: '保留文字。', prompt: '甲乙丙丁'.repeat(10000) }), error => error.code === 'context_exceeded');
  await assert.rejects(manager.generate({ instructions: '完整照抄輸入，不省略。', prompt: '這是一段必須完整保留的測試文字。', maxOutputTokens: 1 }), error => error.code === 'output_over_limit' || error.code === 'invalid_response');
  for (const prompt of ['測試甲。', '測試乙。']) {
    const response = await manager.generate({ instructions: '只照抄輸入文字，不新增內容。', prompt });
    assert.equal(response.complete, true); assert.ok(response.text.trim());
    assert.ok(response.outputTokenCount < response.maxOutputTokens);
    assert.equal(response.locale, 'zh-TW');
  }
  const controller = new AbortController();
  const operation = manager.generate({ instructions: '詳細列出一百個不同水果並逐一說明。', prompt: '水果列表', signal: controller.signal });
  const cancelled = assert.rejects(operation, error => error.code === 'cancelled');
  setTimeout(() => controller.abort(), 30); await cancelled;
  assert.equal((await manager.probe()).available, true);
  assert.equal(JSON.stringify(logs).includes('測試甲'), false);
});

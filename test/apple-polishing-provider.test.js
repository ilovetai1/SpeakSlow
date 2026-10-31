const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const AITextProcessor = require('../src/helpers/aiTextProcessor');

const logger = { info() {}, error() {}, warn() {} };
function fixture(initial = {}, overrides = {}) {
  const settings = new Map(Object.entries({ ai_provider: 'apple_on_device', enable_ai_optimization: false, ...initial }));
  const reads = [], writes = [], requests = [], routes = [];
  const databaseManager = {
    getSetting(key, fallback) { reads.push(key); return settings.has(key) ? settings.get(key) : fallback; },
    setSetting(key, value) { writes.push([key, value]); settings.set(key, value); return { changes: 1 }; },
  };
  const apple = {
    checkStatus: async () => ({ available: true, variant: 'AFM fixture', contextSize: 8192, locale: 'zh-TW', tokenCountAvailable: true }),
    process: async request => { requests.push(request); return { success: true, text: '已校正。', variant: 'AFM fixture' }; },
    ...overrides.apple,
  };
  const processor = new AITextProcessor(databaseManager, logger, {
    platformSupported: overrides.platformSupported || (() => true),
    appleOnDevice: apple,
    ollama: { process: async () => { throw Error('Unexpected Ollama dispatch'); } },
    openAICompatible: { process: async () => { throw Error('Unexpected HTTP dispatch'); } },
    ollamaRuntime: { shutdown() {}, releaseResources: async () => {} },
  });
  processor.latencyManager = { classify: (id, provider) => routes.push([id, provider]) };
  return { processor, apple, settings, reads, writes, requests, routes, databaseManager };
}

test('Apple dispatch excludes saved secrets, endpoint and DeepSeek environment fallback', async () => {
  const prior = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'ENV-SECRET-SENTINEL';
  try {
    const f = fixture({ ai_api_key: 'SAVED-SECRET-SENTINEL', ai_base_url: 'https://private.invalid', ai_model: 'remote-model' });
    const result = await f.processor.processTextWithAI('原稿', 'optimize', null, { metricId: 'metric' });
    assert.equal(result.success, true);
    assert.equal(result.provider, 'apple_on_device');
    assert.equal(result.local, true);
    assert.equal(f.requests[0].model, 'system');
    assert.equal(f.requests[0].apiKey, undefined);
    assert.equal(f.requests[0].baseUrl, undefined);
    assert.equal(f.reads.includes('ai_api_key'), false);
    assert.equal(f.reads.includes('ai_base_url'), false);
    assert.equal(f.reads.includes('ai_model'), false);
    assert.doesNotMatch(JSON.stringify(f.requests), /SECRET-SENTINEL|private.invalid|remote-model/);
    assert.deepEqual(f.routes, [['metric', 'apple_on_device']]);
    assert.deepEqual(f.writes, []);
  } finally {
    if (prior === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prior;
  }
});

test('Apple status probes capability without generating test text or accepting injected credentials', async () => {
  const f = fixture();
  const status = await f.processor.checkAIStatus({ ai_provider: 'apple_on_device', ai_api_key: 'do-not-read', use_saved_api_key: true, ai_base_url: 'https://wrong.invalid' });
  assert.deepEqual(status, {
    available: true, provider: 'apple_on_device', local: true, platformSupported: true,
    model: 'system', status: 'ready', code: undefined, reason: undefined, error: undefined,
    variant: 'AFM fixture', modelDisplayName: null, contextSize: 8192, locale: 'zh-TW', tokenCountAvailable: true,
  });
  assert.equal(f.requests.length, 0);
  assert.equal(f.reads.includes('ai_api_key'), false);
});

test('Unknown provider rejects process and status before reading secrets or dispatching', async () => {
  for (const provider of ['unexpected', '', '__proto__', 'constructor']) {
    const f = fixture({ ai_provider: provider });
    assert.equal((await f.processor.processTextWithAI('原稿')).code, 'provider_invalid');
    assert.equal((await f.processor.checkAIStatus()).code, 'provider_invalid');
    assert.equal(f.reads.includes('ai_api_key'), false);
    assert.equal(f.requests.length, 0);
    assert.throws(() => f.processor.validateProviderSetting(provider), { code: 'provider_invalid' });
  }
});

test('Unsupported platform never probes or processes Apple helper', async () => {
  let probes = 0;
  const f = fixture({}, { platformSupported: () => false, apple: { checkStatus: async () => { probes++; return { available: true }; } } });
  assert.equal((await f.processor.checkAIStatus()).code, 'platform_unsupported');
  assert.equal((await f.processor.processTextWithAI('原稿')).code, 'platform_unsupported');
  assert.equal(probes, 0);
  assert.equal(f.requests.length, 0);
});

test('Apple keeps full long input and excludes Ollama cursor-context calibration', async () => {
  const text = '長稿'.repeat(600);
  const f = fixture({ enable_ai_optimization: true, context_aware_polishing_enabled: true });
  f.processor.contextManager = { capture: () => { throw Error('Apple must not capture context'); } };
  const result = await f.processor.processTextWithAI(text, 'optimize', null, { requireEnabled: true, workflow: 'automatic_offline' });
  assert.equal(result.success, true);
  assert.equal(result.contextStatus, 'off');
  assert.ok(f.requests[0].messages.some(message => message.content.includes(text)));
  assert.equal(f.reads.includes('context_budget_v1'), false);
});

test('External abort cancels file request and rejects a late successful adapter response', async () => {
  let complete, request;
  const f = fixture({}, { apple: { process: value => { request = value; return new Promise(resolve => { complete = resolve; }); } } });
  const owner = new AbortController();
  const result = f.processor.processTextWithAI('原稿', 'optimize', null, { workflow: 'file_preview', signal: owner.signal });
  await new Promise(resolve => setImmediate(resolve));
  owner.abort();
  assert.equal(request.signal.aborted, true);
  complete({ success: true, text: '過期文字' });
  assert.deepEqual(await result, { success: false, code: 'cancelled', error: '文字處理已取消', cancelled: true });
});

function ipcHarness(f) {
  const handlers = new Map(), broadcasts = [];
  const originalLoad = Module._load;
  Module._load = function(name, ...args) {
    if (name === 'electron') return {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (...args) => broadcasts.push(args) } }] },
    };
    return originalLoad.call(this, name, ...args);
  };
  try {
    for (const name of ['../src/helpers/ipc/ai', '../src/helpers/ipc/database']) {
      delete require.cache[require.resolve(name)];
      require(name)({ aiProcessor: f.processor, databaseManager: f.databaseManager });
    }
  } finally { Module._load = originalLoad; }
  return { handlers, broadcasts, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('Both settings IPC routes reject unavailable Apple enable without saving or broadcasting', async () => {
  const f = fixture({}, { apple: { checkStatus: async () => ({ available: false, code: 'model_not_ready', error: '模型尚未就緒' }) } });
  const ipc = ipcHarness(f);
  for (const channel of ['set-setting', 'save-setting']) {
    await assert.rejects(ipc.invoke(channel, 'enable_ai_optimization', true), { code: 'model_not_ready' });
    await assert.rejects(ipc.invoke(channel, 'ai_provider', 'not-real'), { code: 'provider_invalid' });
  }
  assert.deepEqual(f.writes, []);
  assert.deepEqual(ipc.broadcasts, []);
  assert.equal(f.settings.get('enable_ai_optimization'), false);
  await ipc.invoke('set-setting', 'enable_ai_optimization', false);
  assert.deepEqual(f.writes, [['enable_ai_optimization', false]]);
});

test('Changing enabled provider to unavailable Apple leaves previous provider intact', async () => {
  const f = fixture({ ai_provider: 'openai', enable_ai_optimization: true }, { apple: { checkStatus: async () => ({ available: false, code: 'model_not_ready' }) } });
  const ipc = ipcHarness(f);
  await assert.rejects(ipc.invoke('set-setting', 'ai_provider', 'apple_on_device'), { code: 'model_not_ready' });
  assert.equal(f.settings.get('ai_provider'), 'openai');
  assert.deepEqual(f.writes, []);
});

test('Disabling while Apple enable-readiness is pending cancels stale enable before persistence', async () => {
  let finishProbe;
  const f = fixture({}, { apple: { checkStatus: () => new Promise(resolve => { finishProbe = resolve; }) } });
  const ipc = ipcHarness(f);
  const enable = ipc.invoke('set-setting', 'enable_ai_optimization', true);
  const rejected = assert.rejects(enable, { code: 'cancelled' });
  await new Promise(resolve => setImmediate(resolve));
  await ipc.invoke('set-setting', 'enable_ai_optimization', false);
  finishProbe({ available: true, variant: 'late capability' });
  await rejected;
  assert.deepEqual(f.writes, [['enable_ai_optimization', false]]);
});

test('File preview is explicit, validates input and cleans owner cancellation listeners', async () => {
  const f = fixture();
  const ipc = ipcHarness(f);
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const handler = ipc.handlers.get('preview-file-polish');
  assert.equal((await handler({ sender }, '  ')).code, 'invalid_input');
  assert.equal((await handler({ sender }, {})).code, 'invalid_input');
  assert.equal((await handler({ sender }, '檔案原稿')).success, true);
  assert.equal(sender.listenerCount('destroyed'), 0);
  assert.equal(sender.listenerCount('render-process-gone'), 0);
  assert.equal(f.settings.get('enable_ai_optimization'), false);
  assert.equal((await ipc.invoke('process-text', '一般錄音')).code, 'polishing_disabled');
  assert.equal(f.requests.length, 1);
});

test('File preview cancels on renderer destruction and does not retain listeners', async () => {
  let complete;
  const f = fixture({}, { apple: { process: () => new Promise(resolve => { complete = resolve; }) } });
  const ipc = ipcHarness(f);
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const result = ipc.handlers.get('preview-file-polish')({ sender }, '原稿');
  await new Promise(resolve => setImmediate(resolve));
  sender.emit('render-process-gone');
  complete({ success: true, text: '不可使用' });
  assert.equal((await result).code, 'cancelled');
  assert.equal(sender.listenerCount('destroyed'), 0);
  assert.equal(sender.listenerCount('render-process-gone'), 0);
});

test('normal and custom processing IPC abort with their owner and reject late provider output', async () => {
  for (const [mode, ownerEvent] of [['optimize', 'destroyed'], ['freeform', 'render-process-gone']]) {
    let complete, request, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const f = fixture({ enable_ai_optimization: true }, { apple: { process: value => {
      request = value; entered(); return new Promise(resolve => { complete = resolve; });
    } } });
    const ipc = ipcHarness(f), sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
    const operation = ipc.handlers.get('process-text')({ sender }, '不得在原視窗結束後輸出的內容', mode);
    await started; sender.emit(ownerEvent);
    assert.equal(request.signal.aborted, true);
    complete({ success: true, text: '過期輸出' });
    assert.deepEqual(await operation, { success: false, code: 'cancelled', error: '文字處理已取消', cancelled: true });
    assert.equal(sender.listenerCount('destroyed'), 0); assert.equal(sender.listenerCount('render-process-gone'), 0);
    assert.equal(f.requests.length, 0, 'injected delayed provider must not trigger a second adapter');
  }
});

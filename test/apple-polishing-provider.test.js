const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const AITextProcessor = require('../src/helpers/aiTextProcessor');
const { LatencyManager } = require('../src/helpers/latencyManager');

const logger = { info() {}, error() {}, warn() {} };
function fixture(initial = {}, overrides = {}) {
  const settings = new Map(Object.entries({ ai_provider: 'apple_on_device', enable_ai_optimization: false, ...initial }));
  const reads = [], writes = [], requests = [], routes = [], metrics = [], candidateUpdates = [];
  const databaseManager = {
    getSetting(key, fallback) { reads.push(key); return settings.has(key) ? settings.get(key) : fallback; },
    setSetting(key, value) { writes.push([key, value]); settings.set(key, value); return { changes: 1 }; },
    updateFastTranscriptionCandidate(...args) {
      candidateUpdates.push(args);
      return overrides.candidateUpdateResult || { success: true, changes: 1 };
    },
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
  processor.latencyManager = {
    classify: (id, provider) => routes.push([id, provider]),
    record: (...args) => metrics.push(args),
  };
  return { processor, apple, settings, reads, writes, requests, routes, metrics, candidateUpdates, databaseManager };
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

test('Apple native timings are recorded by allowlist and never escape the processor result', async () => {
  const f = fixture({}, { apple: { process: async request => {
    f.requests.push(request);
    return { success: true, text: '已校正。', variant: 'AFM fixture', nativeTimings: {
      capabilityMs: 1.5, tokenCountMs: 2.5, responseCompleteMs: 900.25,
      transcript: 'private-telemetry-sentinel', invalidMs: -1,
    } };
  } } });
  const result = await f.processor.processTextWithAI('原稿', 'optimize', null, { metricId: 'metric' });
  assert.equal(result.success, true);
  assert.equal(result.nativeTimings, undefined);
  assert.equal(JSON.stringify(result).includes('private-telemetry-sentinel'), false);
  assert.deepEqual(f.metrics, [
    ['metric', 'apple_capability', 'success', 1.5],
    ['metric', 'apple_token_count', 'success', 2.5],
    ['metric', 'apple_response_complete', 'success', 900.25],
  ]);
});

test('Apple telemetry failures never invalidate usable model text', async () => {
  const f = fixture({}, { apple: { process: async () => ({
    success: true,
    text: '仍可使用的結果。',
    variant: 'AFM fixture',
    usage: { input_tokens: 20, output_tokens: 5 },
    nativeTimings: { capabilityMs: 1, tokenCountMs: 2, responseCompleteMs: 3 },
  }) } });
  f.processor.latencyManager = {
    classify() {},
    record() { throw new Error('metrics backend unavailable'); },
    recordUsage() { throw new Error('metrics backend unavailable'); },
  };
  const result = await f.processor.processTextWithAI('原稿', 'optimize', null, { metricId: 'metric' });
  assert.equal(result.success, true);
  assert.equal(result.text, '仍可使用的結果。');
});

test('Latency export associates Apple token usage and timings without model-content sentinels', async () => {
  const sentinels = {
    transcript: 'TRANSCRIPT-PRIVATE-SENTINEL',
    response: 'RESPONSE-PRIVATE-SENTINEL',
  };
  const f = fixture({}, { apple: { process: async () => ({
    success: true,
    text: sentinels.response,
    variant: 'AFM fixture',
    usage: { input_tokens: 401, output_tokens: 22 },
    nativeTimings: { capabilityMs: 1.25, tokenCountMs: 2.5, responseCompleteMs: 800.75 },
  }) } });
  const metricSettings = new Map();
  const metrics = new LatencyManager({
    getSetting: (key, fallback) => metricSettings.has(key) ? metricSettings.get(key) : fallback,
    setSetting: (key, value) => metricSettings.set(key, structuredClone(value)),
  });
  f.processor.latencyManager = metrics;
  const metricId = metrics.start('offline');
  const result = await f.processor.processTextWithAI(sentinels.transcript, 'optimize', null, { metricId });
  assert.equal(result.text, sentinels.response);
  metrics.finish(metricId, 'success');
  const exported = metrics.export();
  assert.equal(exported.sessions[0].inputTokens, 401);
  assert.equal(exported.sessions[0].outputTokens, 22);
  assert.equal(exported.sessions[0].observations.find(item => item.stage === 'apple_response_complete').duration, 800.75);
  assert.equal(JSON.stringify(exported).includes(sentinels.transcript), false);
  assert.equal(JSON.stringify(exported).includes(sentinels.response), false);
});

test('Expected provider snapshot cancels before dispatch when the saved provider changed', async () => {
  const f = fixture({ enable_ai_optimization: true });
  const result = await ipcHarness(f).invoke('process-text', '原稿', 'optimize', { expectedProvider: 'ollama' });
  assert.deepEqual(result, { success: false, code: 'provider_changed', error: 'AI 服務已變更', cancelled: true });
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.routes, []);
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

function ipcHarness(f, speechEngineOverrides = {}) {
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
    const speechEngineManager = {
      generation: 5,
      job: { id: 'recording-job', owner: 101, kind: 'recording', cancelled: false, generation: 5 },
      ...speechEngineOverrides,
    };
    for (const name of ['../src/helpers/ipc/ai', '../src/helpers/ipc/database']) {
      delete require.cache[require.resolve(name)];
      require(name)({
        aiProcessor: f.processor,
        databaseManager: f.databaseManager,
        speechEngineManager,
      });
    }
  } finally { Module._load = originalLoad; }
  return {
    handlers,
    broadcasts,
    invoke: (name, ...args) => handlers.get(name)({
      sender: Object.assign(new EventEmitter(), { id: 101, isDestroyed: () => false }),
    }, ...args),
  };
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

test('Apple output mode settings accept only fast and wait_for_polished', async () => {
  const f = fixture({ apple_polishing_output_mode: 'wait_for_polished' });
  const ipc = ipcHarness(f);

  await ipc.invoke('set-setting', 'apple_polishing_output_mode', 'fast');
  assert.equal(f.settings.get('apple_polishing_output_mode'), 'fast');
  await ipc.invoke('save-setting', 'apple_polishing_output_mode', 'wait_for_polished');
  assert.equal(f.settings.get('apple_polishing_output_mode'), 'wait_for_polished');

  for (const invalid of ['', 'wait', 'stream', true, null]) {
    await assert.rejects(
      ipc.invoke('set-setting', 'apple_polishing_output_mode', invalid),
      /Apple 潤稿輸出模式無效/,
    );
    assert.equal(f.settings.get('apple_polishing_output_mode'), 'wait_for_polished');
  }
});

test('Fast candidate IPC preserves structured update and conflict outcomes', async () => {
  const success = fixture({ enable_ai_optimization: true, apple_polishing_output_mode: 'fast' });
  const successIpc = ipcHarness(success);
  assert.deepEqual(
    await successIpc.invoke('update-fast-transcription-candidate', 7, '辨識原文', 'Apple 候選', 'recording-job'),
    { success: true, changes: 1 },
  );
  assert.deepEqual(success.candidateUpdates, [[7, '辨識原文', 'Apple 候選']]);

  const conflict = fixture({ enable_ai_optimization: true, apple_polishing_output_mode: 'fast' }, {
    candidateUpdateResult: { success: false, changes: 0, code: 'history_changed', error: '歷史紀錄已變更，未套用潤稿候選' },
  });
  assert.deepEqual(
    await ipcHarness(conflict).invoke('update-fast-transcription-candidate', 8, '辨識原文', '晚到候選', 'recording-job'),
    { success: false, changes: 0, code: 'history_changed', error: '歷史紀錄已變更，未套用潤稿候選' },
  );
});

test('Fast candidate IPC atomically rejects stale job, provider, mode, or enable state', async () => {
  for (const [name, settings, jobId] of [
    ['disabled', { enable_ai_optimization: false, apple_polishing_output_mode: 'fast' }, 'recording-job'],
    ['provider changed', { enable_ai_optimization: true, ai_provider: 'ollama', apple_polishing_output_mode: 'fast' }, 'recording-job'],
    ['wait mode', { enable_ai_optimization: true, apple_polishing_output_mode: 'wait_for_polished' }, 'recording-job'],
    ['invalid mode', { enable_ai_optimization: true, apple_polishing_output_mode: 'corrupt-value' }, 'recording-job'],
    ['old job', { enable_ai_optimization: true, apple_polishing_output_mode: 'fast' }, 'old-job'],
  ]) {
    const f = fixture(settings);
    assert.deepEqual(
      await ipcHarness(f).invoke('update-fast-transcription-candidate', 7, '辨識原文', '晚到候選', jobId),
      { success: false, changes: 0, code: 'candidate_stale', error: 'Apple 潤稿工作已結束，未更新歷史紀錄' },
      name,
    );
    assert.deepEqual(f.candidateUpdates, [], name);
  }
});

test('Fast candidate IPC rejects shutdown and invalidated speech generations', async () => {
  const shuttingDown = fixture({ enable_ai_optimization: true, apple_polishing_output_mode: 'fast' });
  shuttingDown.processor.stopping = true;
  assert.deepEqual(
    await ipcHarness(shuttingDown).invoke('update-fast-transcription-candidate', 7, '辨識原文', '晚到候選', 'recording-job'),
    { success: false, changes: 0, code: 'candidate_stale', error: 'Apple 潤稿工作已結束，未更新歷史紀錄' },
  );
  assert.deepEqual(shuttingDown.candidateUpdates, []);

  const invalidated = fixture({ enable_ai_optimization: true, apple_polishing_output_mode: 'fast' });
  assert.deepEqual(
    await ipcHarness(invalidated, {
      generation: 6,
      job: { id: 'recording-job', owner: 101, kind: 'recording', cancelled: false, generation: 5 },
    }).invoke('update-fast-transcription-candidate', 7, '辨識原文', '晚到候選', 'recording-job'),
    { success: false, changes: 0, code: 'candidate_stale', error: 'Apple 潤稿工作已結束，未更新歷史紀錄' },
  );
  assert.deepEqual(invalidated.candidateUpdates, []);
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

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const AITextProcessor = require('../src/helpers/aiTextProcessor');
const OllamaRuntime = require('../src/helpers/ai/ollamaRuntime');
const OllamaAdapter = require('../src/helpers/ai/ollamaAdapter');

const logger = { info() {}, warn() {}, error() {} };
const response = (data) => ({ ok: true, json: async () => data });

function harness({ owned = false, chat, health, unload } = {}) {
  const settings = new Map(Object.entries({
    ai_provider: 'ollama', ai_model: 'qwen3:1.7b', enable_ai_optimization: true,
  }));
  const calls = [];
  const broadcasts = [];
  const handlers = new Map();
  const runtime = new OllamaRuntime({
    fetchImpl: async (url, options = {}) => {
      const body = options.body && JSON.parse(options.body);
      calls.push({ url, body, signal: options.signal });
      if (url.endsWith('/api/chat')) {
        return chat ? chat(options) : response({ message: { content: '潤稿結果' } });
      }
      if (url.endsWith('/api/generate')) return unload ? unload() : response({ done: true, done_reason: 'unload' });
      if (health && url.endsWith('/api/tags')) return health(options);
      return response({ capabilities: ['completion'], models: [] });
    },
  });
  const process = Object.assign(new EventEmitter(), {
    killed: false, kill() { this.killed = true; this.emit('exit'); },
  });
  if (owned) runtime.ownedProcess = process;
  const databaseManager = {
    getSetting: (key, initial) => settings.has(key) ? settings.get(key) : initial,
    setSetting: (key, value) => { settings.set(key, value); return { changes: 1 }; },
  };
  const aiProcessor = new AITextProcessor(databaseManager, logger, {
    ollamaRuntime: runtime,
    ollama: new OllamaAdapter({ logger, runtime, fetchImpl: runtime.fetchImpl }),
  });
  const electron = {
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    BrowserWindow: { getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send: (...args) => broadcasts.push(args) } },
    ] },
  };
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    return name === 'electron' ? electron : originalLoad.call(this, name, ...args);
  };
  try {
    for (const file of ['../src/helpers/ipc/database', '../src/helpers/ipc/ai']) {
      delete require.cache[require.resolve(file)];
      require(file)({ databaseManager, aiProcessor, logger });
    }
  } finally {
    Module._load = originalLoad;
  }
  const invoke = (name, ...args) => handlers.get(name)(null, ...args);
  return { runtime, calls, broadcasts, process, settings, databaseManager, invoke };
}

test('從設定 IPC 關閉 AI 後立即卸載使用過的模型，停止自有 Ollama，並可重新啟用', async () => {
  const h = harness({ owned: true });
  assert.equal((await h.invoke('process-text', '原文')).success, true);
  await h.invoke('set-setting', 'enable_ai_optimization', false);
  assert.equal(h.settings.get('enable_ai_optimization'), false);
  assert.equal(h.process.killed, true, '關閉開關必須停止 SpeakSlow 自己啟動的 Ollama');
  assert.deepEqual(h.broadcasts.at(-1), ['setting-changed', { key: 'enable_ai_optimization', value: false }]);
  await h.invoke('set-setting', 'enable_ai_optimization', true);
  assert.equal((await h.invoke('process-text', '重新啟用')).success, true);
});

test('共用外部 Ollama 時只卸載 SpeakSlow 使用的模型', async () => {
  const h = harness();
  await h.invoke('process-text', '原文');
  await h.invoke('set-setting', 'enable_ai_optimization', false);
  const unloads = h.calls.filter(call => call.url.endsWith('/api/generate'));
  assert.equal(unloads.length, 1, '關閉開關必須送出立即卸載請求');
  assert.deepEqual(unloads[0].body, { model: 'qwen3:1.7b', keep_alive: 0, stream: false });
  assert.equal(h.process.killed, false);
});

test('關閉時取消正在進行的潤稿，晚到結果不得當成成功', async () => {
  let finish;
  let signal;
  const h = harness({ chat: options => {
    signal = options.signal;
    return new Promise(resolve => { finish = () => resolve(response({ message: { content: '晚到結果' } })); });
  } });
  const request = h.invoke('process-text', '原文');
  await new Promise(resolve => setImmediate(resolve));
  const disabled = h.invoke('set-setting', 'enable_ai_optimization', false);
  await new Promise(resolve => setImmediate(resolve));
  const aborted = signal.aborted;
  finish();
  await disabled;
  const result = await request;
  assert.equal(aborted, true, '關閉時應立即 abort');
  assert.equal(result.success, false);
  assert.equal(result.code, 'polishing_disabled');
});

test('關閉狀態的錄音 IPC 不會啟動服務或呼叫模型，包括重新建立主程序', async () => {
  const h = harness();
  h.settings.set('enable_ai_optimization', false);
  const result = await h.invoke('process-text', '不應潤稿');
  assert.equal(result.code, 'polishing_disabled');
  assert.equal(h.calls.length, 0);
});

test('還在健康檢查時關閉，取消後不得開始 chat 或重啟服務', async () => {
  let finishHealth;
  const h = harness({ owned: true, health: () => new Promise(resolve => {
    finishHealth = () => resolve(response({ models: [] }));
  }) });
  const request = h.invoke('process-text', '原文');
  await new Promise(resolve => setImmediate(resolve));
  const disabled = h.invoke('set-setting', 'enable_ai_optimization', false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls[0].signal.aborted, true);
  finishHealth();
  await disabled;
  assert.equal((await request).code, 'polishing_disabled');
  assert.equal(h.calls.some(call => call.url.endsWith('/api/chat')), false);
  assert.equal(h.process.killed, true);
});

test('模型探索開始後同 tick 關閉，尚未執行的探索不得重啟已停止的 owned server', async () => {
  const spawned = [];
  const makeProcess = () => Object.assign(new EventEmitter(), {
    killed: false,
    kill() { this.killed = true; this.emit('exit'); },
  });
  let healthCalls = 0;
  const runtime = new OllamaRuntime({
    platform: 'darwin', arch: 'arm64', accessImpl() {}, delayImpl: async () => {},
    spawnImpl() {
      const child = makeProcess();
      spawned.push(child);
      return child;
    },
    fetchImpl: async url => {
      if (url.endsWith('/api/tags') && ++healthCalls === 1) {
        throw new Error('fixture server stopping');
      }
      return response({ models: [] });
    },
  });
  const originalProcess = makeProcess();
  runtime.ownedProcess = originalProcess;
  try {
    const discovery = runtime.listModels();
    const disabled = runtime.releaseResources();
    const [discoveryResult, releaseResult] = await Promise.allSettled([discovery, disabled]);
    assert.equal(discoveryResult.status, 'rejected', '同 tick 關閉必須取消尚未開始的探索');
    assert.equal(discoveryResult.reason.name, 'AbortError');
    assert.equal(releaseResult.status, 'fulfilled');
    assert.equal(originalProcess.killed, true);
    assert.equal(spawned.length, 0, '關閉完成後不能留下探索重新啟動的 Ollama');
    assert.equal(healthCalls, 0);
    assert.equal(runtime.ownedProcess, null);
    assert.equal(runtime.requestControllers.size, 0);
  } finally {
    runtime.shutdown();
  }
});

test('卸載失敗會回報錯誤，已保存的關閉狀態仍同步到視窗，且可重試釋放', async () => {
  let fail = true;
  const h = harness({ unload: () => fail
    ? { ok: false, status: 503 }
    : response({ done: true, done_reason: 'unload' }),
  });
  await h.invoke('process-text', '原文');
  await assert.rejects(h.invoke('set-setting', 'enable_ai_optimization', false), /卸載失敗 HTTP 503/);
  assert.equal(h.settings.get('enable_ai_optimization'), false);
  assert.equal(h.broadcasts.at(-1)[1].value, false);
  fail = false;
  await h.invoke('set-setting', 'enable_ai_optimization', false);
  assert.equal(h.calls.filter(call => call.url.endsWith('/api/generate')).length, 2);
});

test('設定儲存失敗時，不廣播不存在的成功狀態，也不停止仍啟用的模型', async () => {
  const h = harness({ owned: true });
  h.databaseManager.setSetting = () => { throw new Error('disk full'); };
  await assert.rejects(h.invoke('set-setting', 'enable_ai_optimization', false), /disk full/);
  assert.equal(h.broadcasts.length, 0);
  assert.equal(h.process.killed, false);
});

test('舊 save-setting 入口也會釋放模型；未使用 AI 時關閉不啟動 Ollama', async () => {
  const h = harness();
  await h.invoke('save-setting', 'enable_ai_optimization', false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.broadcasts.at(-1)[1].value, false);
});

test('快速關閉再開啟時，舊請求的結果仍被取消，新請求等待卸載完成', async () => {
  let finish;
  let chats = 0;
  const h = harness({ chat: () => {
    chats++;
    if (chats === 1) return new Promise(resolve => { finish = () => resolve(response({ message: { content: '舊結果' } })); });
    return response({ message: { content: '新結果' } });
  } });
  const oldRequest = h.invoke('process-text', '舊原文');
  await new Promise(resolve => setImmediate(resolve));
  const disabled = h.invoke('set-setting', 'enable_ai_optimization', false);
  await new Promise(resolve => setImmediate(resolve));
  await h.invoke('set-setting', 'enable_ai_optimization', true);
  const newRequest = h.invoke('process-text', '新原文');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(chats, 1);
  finish();
  await disabled;
  assert.equal((await oldRequest).code, 'polishing_disabled');
  assert.equal((await newRequest).text, '新結果');
  const inferenceCalls = h.calls.filter(call => /\/(chat|generate)$/.test(call.url));
  assert.deepEqual(inferenceCalls.map(call => call.url.split('/').at(-1)), ['chat', 'generate', 'chat']);
});

test('潤稿中途被關閉時，正常保存原文而不報模型失敗', async () => {
  const { finalizeTranscript } = await import('../src/utils/transcriptFinalization.mjs');
  let saved;
  const result = await finalizeTranscript({
    rawText: '原文', polishingEnabled: true, commandMode: false,
    processText: async () => ({ success: false, code: 'polishing_disabled' }),
    saveTranscription: async data => { saved = data; },
  });
  assert.equal(result.finalText, '原文');
  assert.equal(result.issue, null);
  assert.equal(result.polished, false);
  assert.equal(saved.text, '原文');
});

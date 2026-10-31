const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { SpeechEngineManager } = require('../src/helpers/speechEngineManager');

async function fixture(t) {
  const handlers = new Map(), starts = [], errors = [], sent = [], states = [];
  let callbacks;
  const apple = Object.assign(new EventEmitter(), { supportReason: () => null, prepare: async () => ({ state: 'ready' }), cancel: async () => {} });
  const database = { getSetting: (key, fallback) => key === 'asr_engine' ? 'apple' : fallback };
  const manager = new SpeechEngineManager({ database, sherpa: {}, apple, audioStore: {} });
  const windows = [1, 2, 3].map(id => ({ isDestroyed: () => false, webContents: Object.assign(new EventEmitter(), {
    id, send(channel) {
      sent.push([id, channel]);
      // Both main and hidden control panel load App/useRecording; the indicator does not.
      if (channel === 'typeless-start-recording' && id !== 3) {
        starts.push(id);
        try { handlers.get('speech-job-begin')({ sender: this }, 'recording'); }
        catch (error) { errors.push(error.message); }
      }
    },
  }) }));
  const ctx = {
    speechEngineManager: manager, databaseManager: database,
    windowManager: { mainWindow: windows[0], controlPanelWindow: windows[1], showTypelessIndicator: () => states.push(['indicator', true]), hideTypelessIndicator: () => states.push(['indicator', false]) },
    hotkeyManager: { getDefaultHotkeys: () => ({}), setRecordingState: value => states.push(['hotkey', value]) },
    typelessManager: { setTriggerById() {}, setCallbacks: value => { callbacks = value; }, enable() {}, syncActiveState: value => states.push(['typeless', value]) },
    clipboardManager: { saveForegroundWindow() {} },
    logger: { info() {}, warn() {}, error() {} },
  };
  const originalLoad = Module._load;
  try {
    Module._load = function(name, ...args) {
      if (name === 'electron') return { ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, BrowserWindow: { getAllWindows: () => windows } };
      return originalLoad.call(this, name, ...args);
    };
    for (const file of ['../src/helpers/ipc/speech', '../src/helpers/ipc/hotkeys']) {
      delete require.cache[require.resolve(file)]; require(file)(ctx);
    }
    await manager.initialize();
    const result = await handlers.get('enable-typeless-mode')({ sender: windows[0].webContents });
    assert.equal(result.success, true);
  } finally { t.after(() => { Module._load = originalLoad; }); }
  return { manager, windows, handlers, starts, errors, sent, states, callbacks };
}

test('one TypeLess shortcut starts one speech job despite the hidden control panel', async t => {
  const f = await fixture(t);
  f.callbacks.onStartRecording();
  assert.deepEqual(f.errors, [], 'the hidden second App must not cause speech_busy');
  assert.deepEqual(f.starts, [1]);
  assert.equal(f.manager.job.owner, 1);
  await f.manager.end(f.manager.job.id, 1, true);
});

test('stop and cancel target the recording owner, including manual control-panel recording', async t => {
  const f = await fixture(t);
  const job = f.handlers.get('speech-job-begin')({ sender: f.windows[1].webContents }, 'recording');
  f.callbacks.onStopRecording(); f.callbacks.onCancelRecording();
  assert.deepEqual(f.sent.filter(([,channel]) => ['typeless-stop-recording','typeless-cancel-recording'].includes(channel)), [[2,'typeless-stop-recording'],[2,'typeless-cancel-recording']]);
  await f.manager.end(job.id, 2, true);
});

test('an idle renderer cannot overwrite the active owner’s recording/indicator state', async t => {
  const f = await fixture(t);
  const sender = f.windows[0].webContents, other = f.windows[1].webContents;
  const job = f.handlers.get('speech-job-begin')({ sender }, 'recording');
  for (const name of ['set-recording-state', 'sync-typeless-state']) f.handlers.get(name)({ sender }, true);
  const before = [...f.states];
  for (const name of ['set-recording-state', 'sync-typeless-state']) f.handlers.get(name)({ sender: other }, false);
  assert.deepEqual(f.states, before);
  await f.manager.end(job.id, sender.id, true);
  for (const name of ['set-recording-state', 'sync-typeless-state']) f.handlers.get(name)({ sender }, false);
  assert.deepEqual(f.states.slice(-3), [['hotkey', false], ['typeless', false], ['indicator', false]]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

test('comparison IPC resolves only a stored recording, handles renderer loss and sanitizes file errors', async () => {
  const handlers = new Map(), old = Module._load;
  Module._load = function (name, ...args) { return name === 'electron' ? { ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} } } : old.call(this, name, ...args); };
  let register;
  try { register = require('../src/helpers/ipc/transcription'); } finally { Module._load = old; }
  const sender = Object.assign(new EventEmitter(), { id: 7 }), calls = [], ended = [];
  let complete;
  const manager = {
    compareAppleFilePath(file, owner, options) { calls.push({ file, owner, options }); this.job = { id: 'test-lease', owner, comparing: true }; return new Promise(resolve => { complete = resolve; }); },
    async end(id, owner, cancel) { ended.push({ id, owner, cancel }); },
    async cancel(id, owner) { ended.push({ id, owner, cancel: true }); },
  };
  register({ speechEngineManager: manager, databaseManager: { getTranscriptionById: id => id === 42 ? { audio_path: '/fixture/recording.wav' } : null } });
  const compare = handlers.get('compare-apple-transcription');
  const request = compare({ sender }, 42, { first: 'dictation' });
  assert.deepEqual(calls, [{ file: '/fixture/recording.wav', owner: 7, options: { first: 'dictation' } }]);
  sender.emit('destroyed');
  assert.deepEqual(ended, [{ id: 'test-lease', owner: 7, cancel: true }]);
  complete({ success: true, results: [] }); await request;
  assert.equal(sender.listenerCount('destroyed'), 0); assert.equal(sender.listenerCount('render-process-gone'), 0);
  const missing = await compare({ sender }, 999); assert.equal(missing.success, false); assert.equal(calls.length, 1);
  await handlers.get('cancel-apple-comparison')({ sender: { id: 8 } }); assert.equal(ended.length, 1);
  await handlers.get('cancel-apple-comparison')({ sender }); assert.equal(ended.length, 2);
  manager.compareAppleFilePath = () => { throw Object.assign(Error('ENOENT /private/recording.wav'), { code: 'ENOENT' }); };
  const failure = await compare({ sender }, 42); assert.deepEqual(failure, { success: false, error: '錄音檔已不存在' });
});

test('comparison progress reaches only its renderer owner', () => {
  const old = Module._load, deliveries = [], manager = new EventEmitter(); manager.job = { owner: 7 };
  Module._load = function (name, ...args) {
    if (name === 'electron') return { ipcMain: { handle() {} }, BrowserWindow: { getAllWindows: () => [7, 8].map(id => ({ isDestroyed: () => false, webContents: { id, send: (...args) => deliveries.push({ id, args }) } })) } };
    return old.call(this, name, ...args);
  };
  try { require('../src/helpers/ipc/speech')({ speechEngineManager: manager }); } finally { Module._load = old; }
  manager.emit('comparison-progress', { profile: 'dictation', completed: 1 });
  assert.deepEqual(deliveries, [{ id: 7, args: ['speech-comparison-progress', { profile: 'dictation', completed: 1 }] }]);
});

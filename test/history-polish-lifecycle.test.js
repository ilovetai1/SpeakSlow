const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const HistoryPolishManager = require('../src/helpers/historyPolishManager');

const owner = id => Object.assign(new EventEmitter(), { id, isDestroyed: () => false });
function fixture() {
  const records = new Map([[1, { id: 1, raw_text: '基準逐字稿', text: '目前結果', processed_text: null }], [2, { id: 2, raw_text: '第二筆', text: '第二筆結果' }]]);
  const writes = [], inputs = [];
  const database = {
    getTranscriptionById: id => records.has(id) ? { ...records.get(id) } : null,
    updateTranscriptionFinalText(id, text) { writes.push([id, text]); records.set(id, { ...records.get(id), text, processed_text: null }); return { changes: 1 }; },
  };
  const processor = { async processTextWithAI(text, mode, prompt, options) { inputs.push({ text, mode, prompt, options }); return { success: true, text: '主程序產生的候選' }; } };
  const manager = new HistoryPolishManager(database, processor);
  return { records, writes, inputs, database, processor, manager, sender: owner(7) };
}

test('history confirmation accepts only the main-process token and writes its stored candidate once', async () => {
  const f = fixture(), preview = await f.manager.preview(f.sender, 1);
  assert.equal(preview.success, true); assert.equal(typeof preview.candidateToken, 'string');
  assert.equal(preview.baselineText, '基準逐字稿'); assert.equal(preview.currentText, '目前結果');
  assert.equal(f.inputs[0].text, '基準逐字稿'); assert.equal(f.inputs[0].mode, 'optimize');
  assert.equal(f.inputs[0].options.workflow, 'history_preview');
  assert.deepEqual(f.writes, [], 'preview must not persist');
  for (const [sender, id, token] of [[f.sender, 1, 'renderer supplied text'], [owner(8), 1, preview.candidateToken], [f.sender, 2, preview.candidateToken]]) {
    assert.equal(f.manager.apply(sender, id, token).code, 'candidate_invalid');
  }
  assert.deepEqual(f.manager.apply(f.sender, 1, preview.candidateToken), { success: true, text: '主程序產生的候選' });
  assert.equal(f.records.get(1).raw_text, '基準逐字稿');
  assert.deepEqual(f.writes, [[1, '主程序產生的候選']]);
  assert.equal(f.manager.apply(f.sender, 1, preview.candidateToken).code, 'candidate_invalid');
  assert.equal(f.sender.listenerCount('destroyed'), 0); assert.equal(f.sender.listenerCount('render-process-gone'), 0);
});

test('changed baseline, changed final, and deleted records invalidate confirmation without overwriting history', async () => {
  for (const change of [record => ({ ...record, raw_text: '新辨識' }), record => ({ ...record, text: '別的視窗更新' }), () => null]) {
    const f = fixture(), preview = await f.manager.preview(f.sender, 1);
    const updated = change(f.records.get(1));
    if (updated) f.records.set(1, updated); else f.records.delete(1);
    assert.equal(f.manager.apply(f.sender, 1, preview.candidateToken).code, 'history_changed');
    assert.deepEqual(f.writes, []); assert.equal(f.manager.previews.size, 0);
  }
});

test('history changes during generation never create a confirmable candidate', async () => {
  const f = fixture();
  f.processor.processTextWithAI = async () => { f.records.get(1).text = '另一個視窗的新結果'; return { success: true, text: '舊來源候選' }; };
  assert.equal((await f.manager.preview(f.sender, 1)).code, 'history_changed');
  assert.equal(f.manager.previews.size, 0); assert.equal(f.sender.listenerCount('destroyed'), 0);
  assert.deepEqual(f.writes, []);
});

test('owner destruction and renderer failure abort pending history work and reject late success', async () => {
  for (const event of ['destroyed', 'render-process-gone']) {
    const f = fixture(); let complete, request, entered;
    const started = new Promise(resolve => { entered = resolve; });
    f.processor.processTextWithAI = (_text, _mode, _prompt, options) => { request = options; entered(); return new Promise(resolve => { complete = resolve; }); };
    const operation = f.manager.preview(f.sender, 1); await started;
    f.sender.emit(event); assert.equal(request.signal.aborted, true);
    complete({ success: true, text: '不得交付' });
    assert.equal((await operation).cancelled, true); assert.equal(f.manager.previews.size, 0);
    assert.equal(f.sender.listenerCount('destroyed'), 0); assert.equal(f.sender.listenerCount('render-process-gone'), 0);
    assert.deepEqual(f.writes, []);
  }
});

test('replacement aborts older pending work without releasing the newer candidate', async () => {
  const f = fixture(); let complete, firstSignal, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.processor.processTextWithAI = (text, _mode, _prompt, options) => {
    if (text === '基準逐字稿') { firstSignal = options.signal; entered(); return new Promise(resolve => { complete = resolve; }); }
    return { success: true, text: '第二筆候選' };
  };
  const first = f.manager.preview(f.sender, 1); await started;
  const second = await f.manager.preview(f.sender, 2);
  assert.equal(firstSignal.aborted, true);
  complete({ success: true, text: '過期候選' }); assert.equal((await first).cancelled, true);
  assert.deepEqual(f.manager.apply(f.sender, 2, second.candidateToken), { success: true, text: '第二筆候選' });
  assert.deepEqual(f.writes, [[2, '第二筆候選']]);
});

test('replacement, explicit cancel, and destruction clear successful candidates and owner listeners', async () => {
  const f = fixture(), first = await f.manager.preview(f.sender, 1), second = await f.manager.preview(f.sender, 2);
  assert.equal(f.manager.apply(f.sender, 1, first.candidateToken).code, 'candidate_invalid');
  assert.equal(f.sender.listenerCount('destroyed'), 1);
  f.manager.cancel(f.sender);
  assert.equal(f.manager.apply(f.sender, 2, second.candidateToken).code, 'candidate_invalid');
  const third = await f.manager.preview(f.sender, 1); f.sender.emit('destroyed');
  assert.equal(f.manager.apply(f.sender, 1, third.candidateToken).code, 'candidate_invalid');
  assert.equal(f.sender.listenerCount('destroyed'), 0); assert.equal(f.sender.listenerCount('render-process-gone'), 0);
  assert.deepEqual(f.writes, []);
});

test('generation failures, disable, and cancellation preserve old history and release candidates', async () => {
  for (const result of [{ success: false, code: 'timeout', error: '逾時' }, { success: false, code: 'polishing_disabled', error: 'AI 潤稿已關閉' }, { success: false, cancelled: true, code: 'cancelled' }, { success: true, text: '  ' }]) {
    const f = fixture(); f.processor.processTextWithAI = async () => result;
    assert.equal((await f.manager.preview(f.sender, 1)).success, false);
    assert.deepEqual(f.writes, []); assert.equal(f.records.get(1).text, '目前結果');
    assert.equal(f.manager.previews.size, 0); assert.equal(f.sender.listenerCount('destroyed'), 0);
  }
});

test('failed confirmation persistence consumes the token without reporting success or changing history', async () => {
  for (const result of [false, { success: false }, { changes: 0 }, new Error('disk full')]) {
    const f = fixture(), preview = await f.manager.preview(f.sender, 1);
    let attempts = 0;
    f.database.updateTranscriptionFinalText = () => { attempts++; if (result instanceof Error) throw result; return result; };
    assert.equal(f.manager.apply(f.sender, 1, preview.candidateToken).code, 'history_save_failed');
    assert.equal(f.manager.apply(f.sender, 1, preview.candidateToken).code, 'candidate_invalid');
    assert.equal(attempts, 1); assert.equal(f.records.get(1).text, '目前結果');
  }
});

test('history IPC exposes token confirmation and explicit owner cancellation instead of arbitrary text writes', async () => {
  const f = fixture(), handlers = new Map(), originalLoad = Module._load;
  try {
    Module._load = function(name, ...args) {
      if (name === 'electron') return { ipcMain: { handle: (name, handler) => handlers.set(name, handler), on() {} } };
      return originalLoad.call(this, name, ...args);
    };
    delete require.cache[require.resolve('../src/helpers/ipc/transcription')];
    require('../src/helpers/ipc/transcription')({ databaseManager: f.database, aiProcessor: f.processor });
  } finally { Module._load = originalLoad; delete require.cache[require.resolve('../src/helpers/ipc/transcription')]; }
  const event = { sender: f.sender }, invoke = (name, ...args) => handlers.get(name)(event, ...args);
  const preview = await invoke('preview-history-polish', 1);
  assert.equal((await invoke('apply-history-polish', 1, '偽造候選文字')).code, 'candidate_invalid');
  await invoke('cancel-history-polish');
  assert.equal((await invoke('apply-history-polish', 1, preview.candidateToken)).code, 'candidate_invalid');
  const next = await invoke('preview-history-polish', 1);
  assert.equal((await invoke('apply-history-polish', 1, next.candidateToken)).success, true);
  assert.deepEqual(f.writes, [[1, '主程序產生的候選']]);
});

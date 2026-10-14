const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SpeechEngineManager } = require('../src/helpers/speechEngineManager');
const { SpeechTranscript } = require('../src/helpers/speechTranscript');
const { readWav, AppleSpeechManager } = require('../src/helpers/appleSpeechManager');
const { LatencyManager } = require('../src/helpers/latencyManager');
const TextUtilityService = require('../src/helpers/textUtilityService');

function fixture(initial = {}) {
  const settings = new Map(Object.entries(initial)), calls = [];
  const db = { getSetting: (key, value) => settings.has(key) ? settings.get(key) : value, setSetting(key, value) { settings.set(key, value); return true; } };
  const sherpa = {
    serverReady: false, initializationPromise: null,
    async checkModelFiles() { return { models_downloaded: true }; },
    async preInitializeModels() { calls.push('sherpa.prepare'); this.serverReady = true; },
    async transcribeAudio(_bytes, options) { calls.push(options.profile); return { success: true, text: '測試。' }; },
  };
  const apple = Object.assign(new EventEmitter(), {
    supportReason: () => null,
    async prepare() { calls.push('apple.prepare'); return { state: 'ready' }; },
    async dispose() { calls.push('apple.dispose'); },
    async cancel() { calls.push('apple.cancel'); },
    async transcribeAudio() { return { success: true, text: '測試。' }; },
  });
  const manager = new SpeechEngineManager({ database: db, sherpa, apple, audioStore: {} });
  return { settings, calls, db, sherpa, apple, manager };
}
test('default startup prepares only Sherpa; saved Apple prepares only Apple', async () => {
  const f = fixture(); await f.manager.initialize(); assert.deepEqual(f.calls, ['sherpa.prepare']);
  const a = fixture({ asr_engine: 'apple' }); await a.manager.initialize(); assert.deepEqual(a.calls, ['apple.prepare']);
});
test('all job kinds lock selection, profile and new jobs through the whole output lifetime', async () => {
  const f = fixture(); await f.manager.initialize();
  for (const kind of ['recording', 'file', 'history', 'streaming']) {
    const job = f.manager.begin(kind, 7);
    await assert.rejects(f.manager.select('asr_engine', 'apple'), /speech_busy/);
    await assert.rejects(f.manager.select('apple_response_profile', 'responsive'), /speech_busy/);
    assert.throws(() => f.manager.begin('recording', 8), /speech_busy/);
    assert.throws(() => f.manager.requireJob(job.id, 8), /speech_job_invalid/);
    await f.manager.end(job.id, 7);
  }
  assert.equal(f.manager.snapshot().busy, false);
});
test('failed persistence preserves working engine and emits no new preparation', async () => {
  const f = fixture(); await f.manager.initialize();
  f.db.setSetting = () => { throw new Error('disk_failed'); };
  await assert.rejects(f.manager.select('asr_engine', 'apple'), /disk_failed/);
  assert.equal(f.manager.selected, 'sherpa'); assert.equal(f.sherpa.serverReady, true);
  assert.deepEqual(f.calls, ['sherpa.prepare']);
});
test('old owned child exits before new prepare; failed Apple retains the new choice', async () => {
  const f = fixture(); await f.manager.initialize();
  const child = new EventEmitter(); child.exitCode = null;
  child.stdin = { end() { f.calls.push('sherpa.exit'); queueMicrotask(() => child.emit('exit', 0)); } };
  f.sherpa.serverProcess = child;
  f.apple.prepare = async () => { f.calls.push('apple.failed'); throw new Error('locale_unsupported'); };
  await f.manager.select('asr_engine', 'apple');
  assert.deepEqual(f.calls, ['sherpa.prepare', 'sherpa.exit', 'apple.failed']);
  assert.equal(f.manager.snapshot().selected, 'apple'); assert.equal(f.manager.snapshot().state, 'failed');
  assert.equal(f.settings.get('asr_engine'), 'apple'); assert.equal(f.sherpa.serverReady, false);
});
test('profiles freeze at job creation and stale or foreign jobs cannot transcribe', async () => {
  const f = fixture({ asr_profile: 'fast' }); await f.manager.initialize();
  const job = f.manager.begin('recording', 1); f.settings.set('asr_profile', 'standard');
  await f.manager.transcribe(Buffer.alloc(44), { jobId: job.id, profile: 'standard', no_persist: true }, 1);
  assert.equal(f.calls.at(-1), 'fast');
  await f.manager.end(job.id, 1);
  await assert.rejects(f.manager.transcribe(Buffer.alloc(44), { jobId: job.id }, 1), /speech_job_invalid/);
});
test('a cancelled in-flight job keeps the gate until ASR settles and rejects its output', async () => {
  const f = fixture(); await f.manager.initialize();
  let finish; f.sherpa.transcribeAudio = () => new Promise(resolve => { finish = resolve; });
  const job = f.manager.begin('recording', 1);
  const result = f.manager.transcribe(Buffer.alloc(44), { jobId: job.id }, 1);
  const ended = f.manager.end(job.id, 1, true);
  assert.equal(f.manager.snapshot().busy, true);
  finish({ success: true, text: '不可輸出' });
  await assert.rejects(result, /speech_job_invalid/); await ended;
  assert.equal(f.manager.snapshot().busy, false);
});
test('old Apple events are ignored after cancel or engine switch', async () => {
  const f = fixture({ asr_engine: 'apple' }); await f.manager.initialize();
  const job = f.manager.begin('recording', 1); const events = [];
  f.manager.on('preview', event => events.push(event));
  f.apple.emit('preview', { sessionId: job.id, text: '有效' });
  await f.manager.end(job.id, 1, true);
  f.apple.emit('preview', { sessionId: job.id, text: '遲到' });
  assert.equal(events.length, 1);
});
test('range reducer retains volatile text that becomes final without reissue', () => {
  const r = new SpeechTranscript();
  r.update({ start: 0, end: 1, text: '明天開會，', finalizedThrough: 0 });
  r.update({ start: 1, end: 2, text: '下午三點。', finalizedThrough: 1 });
  assert.equal(r.snapshot().text, '明天開會，下午三點。');
  assert.equal(r.finalizedThrough, 1);
});
test('range revisions replace overlap exactly once and reject invalid or finalized rewrites', () => {
  const r = new SpeechTranscript();
  r.update({ start: 0, end: 2, text: '你號', finalizedThrough: 0 });
  r.update({ start: 0, end: 2, text: '你好。', finalizedThrough: 2 });
  assert.equal(r.snapshot().text, '你好。');
  assert.throws(() => r.update({ start: 0, end: 2, text: '遲到', finalizedThrough: 2 }), /result_after_final/);
  assert.throws(() => r.update({ start: 3, end: 2, text: '', finalizedThrough: 2 }), /result_range/);
});
test('native final timing can narrow a whole-input volatile placeholder range', () => {
  const reducer = new SpeechTranscript();
  reducer.update({ start: 0, end: 4.7, text: '我們的人口結構極速老化。', finalizedThrough: 0 });
  reducer.update({ start: 1.08, end: 4.7, text: '我們的人口結構極速老化。', finalizedThrough: 4.7 });
  assert.equal(reducer.snapshot().text, '我們的人口結構極速老化。');
  assert.equal(reducer.snapshot().segments.length, 1);
});
test('v2 imports v1 read-only, deduplicates, separates ASR from provider, and clears both stores', () => {
  const f = fixture(); const old = new LatencyManager(f.db); const id = old.start('offline'); old.finish(id);
  const entry = structuredClone(f.settings.get('latency_metrics_v2').sessions[0]);
  delete entry.payload.asrEngine; delete entry.payload.asrProfile;
  f.settings.set('latency_metrics_v1', { version: 1, sessions: [entry] });
  const m = new LatencyManager(f.db);
  assert.equal(m.export().sessions.length, 1); assert.equal(m.export().version, 2);
  const current = m.start('offline'); m.classify(current, 'ollama'); m.classifyASR(current, 'apple', 'accurate'); m.finish(current);
  assert.equal(m.export().sessions.at(-1).provider, 'ollama'); assert.equal(m.export().sessions.at(-1).asrEngine, 'apple');
  assert.equal(f.settings.get('latency_metrics_v1').sessions.length, 1);
  m.clear(); assert.equal(new LatencyManager(f.db).stats().sessions, 0);
});
test('text conversion and emoji work without any recognizer or worker', async () => {
  const f = fixture({ custom_emojis: { 回收: '♻️' } }); const service = new TextUtilityService(f.db);
  assert.equal((await service.transformText('帐号里面的资料', 'to_traditional')).text, '帳號裡面的資料');
  assert.equal((await service.transformText('臺灣繁體', 'to_simplified')).text, '台湾繁体');
  assert.equal(service.applyEmoji('你好，微笑。表情。回收的符號'), '你好🙂♻️');
  assert.equal(service.applyEmoji('開心表情'), '開心表情');
  assert.equal(service.worker, undefined);
  f.settings.set('custom_emojis', { happy: '🙂' });
  assert.equal(service.applyEmoji('HAPPY表情'), 'HAPPY表情');
});
test('cancellation invalidates results but holds the lease until explicit end', async () => {
  const f = fixture({ asr_engine: 'apple' }); await f.manager.initialize();
  const job = f.manager.begin('recording', 1);
  await f.manager.cancel(job.id, 1);
  assert.equal(f.manager.snapshot().busy, true);
  assert.throws(() => f.manager.requireJob(job.id, 1), /speech_job_invalid/);
  await f.manager.end(job.id, 1, true); assert.equal(f.manager.snapshot().busy, false);
});
test('shared asset downloading can become ready without starting the unselected engine', async () => {
  const f = fixture({ asr_engine: 'apple' });
  f.manager.state = 'downloading'; f.apple.probe = async () => ({ state: 'ready' });
  assert.equal((await f.manager.checkState()).state, 'ready');
  assert.deepEqual(f.calls, ['apple.prepare']);
});
test('failed helper spawn can dispose immediately without awaiting an exit event that never exists', async () => {
  const manager = new AppleSpeechManager();
  manager.child = { pid: undefined, exitCode: null, signalCode: null };
  await manager.dispose(); assert.equal(manager.child, null);
});
test('unexpected Sherpa exit invalidates readiness and prevents acquiring a recording lease', async () => {
  const f = fixture(); await f.manager.initialize();
  f.sherpa.serverReady = false; f.sherpa.onRuntimeExit();
  assert.equal(f.manager.state, 'failed');
  assert.throws(() => f.manager.begin('recording', 1), /sherpa_not_ready/);
});
test('a historical shutdown reason cannot prevent a later successful explicit switch', async () => {
  const f = fixture(); await f.manager.initialize();
  f.manager.reason = 'engine_shutdown_failed'; f.manager.state = 'failed';
  const state = await f.manager.select('asr_engine', 'apple');
  assert.equal(state.state, 'ready'); assert.equal(state.reason, null);
});
test('WAV parser rejects malformed input, and Apple gate never launches on an unsupported platform', async () => {
  assert.throws(() => readWav(Buffer.alloc(44)), /audio_format/);
  const manager = new AppleSpeechManager({ platform: 'linux', spawnFn: () => { throw new Error('must_not_launch'); } });
  assert.equal((await manager.probe()).reason, 'platform_unsupported');
});
test('renderer PCM keeps tail frames and fails visibly on backpressure or rejected ACK', async () => {
  const { createPcmTransport } = await import('../src/utils/pcmTransport.mjs');
  const packets = [];
  const transport = createPcmTransport({ sampleRate: 48000, send: async packet => packets.push(packet) });
  transport.push(new Float32Array(4096)); transport.push(new Float32Array(4096));
  await transport.flush();
  assert.equal(packets.reduce((sum, p) => sum + p.frames, 0), 8192);
  assert.deepEqual(packets.map(p => p.sequence), [0, 1]);
  let failure;
  const blocked = createPcmTransport({ sampleRate: 16000, send: () => new Promise(() => {}), onFailure: error => { failure = error; } });
  blocked.push(new Float32Array(33600));
  assert.match(failure.message, /audio_backpressure/); blocked.cancel();
  const rejected = createPcmTransport({ sampleRate: 16000, send: async () => { throw new Error('helper_exited'); } });
  rejected.push(new Float32Array(1600)); await assert.rejects(rejected.flush(), /helper_exited/);
});
test('cancel during polishing does not write transcript history', async () => {
  const { finalizeTranscript } = await import('../src/utils/transcriptFinalization.mjs');
  let cancelled = false, saved = false;
  const result = await finalizeTranscript({ rawText: '原文', polishingEnabled: true, isCancelled: () => cancelled, processText: async () => { cancelled = true; return { success: true, text: '不輸出' }; }, saveTranscription: async () => { saved = true; }, transcriptionData: {} });
  assert.equal(result.cancelled, true); assert.equal(saved, false);
});

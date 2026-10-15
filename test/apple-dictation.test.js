const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { SpeechEngineManager } = require('../src/helpers/speechEngineManager');
const { AppleSpeechManager } = require('../src/helpers/appleSpeechManager');
const { LatencyManager } = require('../src/helpers/latencyManager');

function fixture(t, profile = 'responsive') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-paired-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const audio = Buffer.from('one immutable recording'), file = path.join(directory, 'recording.wav'); fs.writeFileSync(file, audio);
  const settings = new Map([['asr_engine', 'apple'], ['apple_response_profile', profile]]), calls = [];
  const database = { getSetting: (key, fallback) => settings.has(key) ? settings.get(key) : fallback, setSetting: (key, value) => { settings.set(key, value); return true; } };
  const apple = Object.assign(new EventEmitter(), {
    supportReason: () => null,
    async prepare(p) { calls.push(['prepare', p]); return { state: 'ready' }; },
    async probe(p) { calls.push(['probe', p]); return { state: 'ready' }; },
    async cancel() {}, async dispose() {},
    async transcribeAudio(bytes, options) { calls.push(['transcribe', bytes, options]); return { success: true, text: options.appleProfile === 'dictation' ? '頁面，程式碼。' : '頁麵，城市碼。', duration: 1, timings: { prepareMs: 2, firstTextMs: 300, audioEndToFinalMs: 20 } }; },
  });
  const manager = new SpeechEngineManager({ database, apple, sherpa: {}, audioStore: { createTempAudioFile: () => { throw Error('must not save audio'); } }, textUtilities: { applyEmoji: () => { throw Error('must not post-process'); } } });
  return { manager, apple, database, settings, calls, audio, file };
}
test('Dictation is explicit, persists, freezes for jobs and has its own latency group', async t => {
  const f = fixture(t); await f.manager.initialize();
  await f.manager.select('apple_response_profile', 'dictation');
  assert.equal(f.settings.get('apple_response_profile'), 'dictation');
  const job = f.manager.begin('recording', 9);
  assert.equal(job.profile, 'dictation');
  await assert.rejects(f.manager.select('apple_response_profile', 'accurate'), /speech_busy/);
  await f.manager.end(job.id, 9);
  const metrics = new LatencyManager(f.database), id = metrics.start('offline');
  metrics.classifyASR(id, 'apple', 'dictation'); metrics.finish(id);
  assert.equal(new LatencyManager(f.database).export().sessions[0].asrProfile, 'dictation');
});
test('paired comparison uses identical audio, preserves raw output and saved preferences, and restores selected profile', async t => {
  const f = fixture(t); await f.manager.initialize();
  const original = [...f.settings];
  const result = await f.manager.compareAppleFilePath(f.file, 9, { first: 'dictation', speechProfile: 'accurate' });
  assert.equal(result.success, true);
  assert.deepEqual(result.results.map(row => row.profile), ['dictation', 'accurate']);
  assert.deepEqual(result.results.map(row => row.text), ['頁面，程式碼。', '頁麵，城市碼。']);
  const runs = f.calls.filter(call => call[0] === 'transcribe');
  assert.strictEqual(runs[0][1], runs[1][1]); assert.deepEqual(runs[0][1], f.audio);
  assert.ok(runs.every(run => run[2].realtime === true));
  assert.equal(result.audioSha256, createHash('sha256').update(f.audio).digest('hex'));
  assert.deepEqual([...f.settings], original);
  assert.deepEqual(f.calls.at(-1), ['prepare', 'responsive']);
  assert.equal(f.manager.snapshot().busy, false);
});
test('comparison retains one busy lease through cancellation and cannot emit preview or later module output', async t => {
  const f = fixture(t); await f.manager.initialize();
  let complete, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.apple.transcribeAudio = async () => { entered(); return new Promise(resolve => { complete = resolve; }); };
  const previews = []; f.manager.on('preview', value => previews.push(value));
  const operation = f.manager.compareAppleFilePath(f.file, 9);
  const rejected = assert.rejects(operation, /speech_job_invalid/);
  await started;
  f.apple.emit('preview', { sessionId: f.manager.job.id, text: '比較用原文' });
  assert.deepEqual(previews, []);
  await assert.rejects(f.manager.select('asr_engine', 'sherpa'), /speech_busy/);
  assert.throws(() => f.manager.begin('recording', 1), /speech_busy/);
  await f.manager.cancel(f.manager.job.id, 9);
  assert.equal(f.manager.snapshot().busy, true);
  complete({ success: true, text: '取消後不能交付' }); await rejected;
  assert.equal(f.manager.snapshot().busy, false);
  assert.equal(f.calls.filter(call => call[0] === 'probe').length, 1);
  assert.deepEqual(f.calls.at(-1), ['prepare', 'responsive']);
});
test('missing Dictation assets are an explicit failed row; no download, fallback or preference change', async t => {
  const f = fixture(t); await f.manager.initialize();
  f.apple.probe = async profile => ({ state: profile === 'dictation' ? 'needs_download' : 'ready' });
  const result = await f.manager.compareAppleFilePath(f.file, 9);
  assert.equal(result.success, false);
  assert.equal(result.results[0].success, true);
  assert.deepEqual(result.results[1], { profile: 'dictation', success: false, error: 'assets_not_ready' });
  assert.equal(f.settings.get('apple_response_profile'), 'responsive');
  assert.equal(f.calls.filter(call => call[0] === 'transcribe').length, 1);
});
test('comparison does not relaunch a disposed runtime; restore failure blocks recording visibly', async t => {
  const f = fixture(t); await f.manager.initialize();
  let complete, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.apple.transcribeAudio = async () => { entered(); return new Promise(resolve => { complete = resolve; }); };
  const operation = f.manager.compareAppleFilePath(f.file, 9), rejected = assert.rejects(operation, /speech_job_invalid/);
  await started; f.manager.generation++;
  complete({ success: true, text: 'old' }); await rejected;
  assert.equal(f.calls.filter(call => call[0] === 'prepare').length, 1);
  const next = fixture(t); await next.manager.initialize();
  next.apple.prepare = async () => { throw Error('helper_exited'); };
  const failedRestore = await next.manager.compareAppleFilePath(next.file, 9);
  assert.equal(failedRestore.success, false); assert.equal(failedRestore.restoreError, 'helper_exited');
  assert.equal(next.manager.snapshot().state, 'failed');
  assert.throws(() => next.manager.begin('recording', 9), /helper_exited/);
});
test('real-time replay schedules identical complete PCM frames and separates preparation, first text and final tail', async () => {
  let time = 0; const packets = [];
  const manager = new AppleSpeechManager({ clock: () => time, sleep: async ms => { time += ms; } });
  manager.start = async id => { time += 20; manager.session = { id, firstTextAt: null }; };
  manager.feed = async (_id, packet) => { if (packet.sequence === 0) manager.session.firstTextAt = time + 10; time += 10; packets.push(packet); };
  manager.finish = async () => { time += 40; return { success: true, text: '頁面', duration: .25 }; };
  const pcm = Buffer.alloc(8000), wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  const result = await manager.transcribeAudio(wav, { realtime: true, appleProfile: 'dictation' });
  assert.deepEqual(packets.map(packet => packet.frames), [1600, 1600, 800]);
  assert.deepEqual(result.timings, { prepareMs: 20, firstTextMs: 110, audioEndToFinalMs: 50, inputToFinalMs: 300, realtime: true });
});
test('CER counts homophone substitutions, omissions and insertions without normalizing away traditional spelling', async () => {
  const { characterErrorRate: score } = await import('../src/utils/transcriptComparison.mjs');
  assert.deepEqual(score('頁面，程式碼。', '頁麵城市碼'), { errors: 3, characters: 5, rate: .6 });
  assert.deepEqual(score('頁面程式碼', '頁面'), { errors: 3, characters: 5, rate: .6 });
  assert.equal(score('Ａ B！', 'ab').rate, 0);
  assert.equal(score('', '文'), null);
  assert.equal(score('字', '字字字').rate, 2);
  assert.ok(score('字'.repeat(2001), '字').error);
});

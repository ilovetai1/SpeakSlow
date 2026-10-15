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

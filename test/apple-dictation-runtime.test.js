const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AppleSpeechManager } = require('../src/helpers/appleSpeechManager');
const { SpeechEngineManager } = require('../src/helpers/speechEngineManager');

// Opt in with an explicit audio fixture. Never opens the microphone or user DB.
const audioFile = process.env.SPEAKSLOW_NATIVE_SPEECH_TEST_AUDIO;
test('native modules switch, compare identical real-time PCM and recover after cancellation', { skip: !audioFile, timeout: 120000 }, async t => {
  const settings = new Map([['asr_engine', 'apple'], ['apple_response_profile', 'accurate']]);
  const apple = new AppleSpeechManager({ helperPath: path.resolve(__dirname, '../native/build/apple-speech') });
  const manager = new SpeechEngineManager({ database: { getSetting: (key, fallback) => settings.get(key) ?? fallback, setSetting: (key, value) => { settings.set(key, value); return true; } }, apple, sherpa: {}, audioStore: {} });
  t.after(() => manager.dispose());
  await manager.initialize(); assert.equal(manager.state, 'ready');
  const audio = fs.readFileSync(audioFile), switches = [];
  for (const profile of ['accurate', 'responsive', 'dictation']) {
    await manager.select('apple_response_profile', profile);
    assert.equal(manager.snapshot().state, 'ready');
    const result = await manager.transcribe(audio, { no_persist: true }, 7);
    assert.equal(result.success, true); assert.ok(result.text.trim());
    assert.equal(result.asrProfile, profile); assert.ok(result.segments.length);
    switches.push({ profile, characters: result.text.length, duration: result.duration });
  }
  const original = [...settings], progress = [], previews = [];
  manager.on('comparison-progress', value => progress.push(value));
  manager.on('preview', value => previews.push(value));
  const operation = manager.compareAppleFilePath(audioFile, 7);
  await assert.rejects(manager.select('apple_response_profile', 'accurate'), /speech_busy/);
  const pair = await operation;
  assert.equal(pair.success, true, JSON.stringify(pair.results?.map(row => ({ profile: row.profile, error: row.error }))));
  assert.equal(pair.audioSha256, createHash('sha256').update(audio).digest('hex'));
  assert.deepEqual(pair.results.map(row => row.profile), ['accurate', 'dictation']);
  assert.equal(pair.results[0].duration, pair.results[1].duration);
  for (const row of pair.results) {
    assert.ok(row.text.trim()); assert.equal(row.timings.realtime, true);
    for (const name of ['prepareMs', 'firstTextMs', 'audioEndToFinalMs', 'inputToFinalMs']) assert.ok(Number.isFinite(row.timings[name]) && row.timings[name] >= 0, name);
  }
  assert.equal(previews.length, 0); assert.equal(progress.length, 2);
  assert.deepEqual([...settings], original); assert.equal(manager.snapshot().state, 'ready');
  const cancelled = manager.compareAppleFilePath(audioFile, 7, { first: 'dictation' });
  const rejected = assert.rejects(cancelled, /speech_job_invalid|session_closed/);
  await new Promise(resolve => setTimeout(resolve, 300));
  await manager.cancel(manager.job.id, 7); await rejected;
  assert.equal(manager.snapshot().busy, false); assert.equal(manager.snapshot().state, 'ready');
  const retry = await manager.transcribe(audio, { no_persist: true }, 7);
  assert.ok(retry.success && retry.text.trim()); assert.equal(retry.asrProfile, 'dictation');
  if (process.env.SPEAKSLOW_NATIVE_SPEECH_TEST_REPORT) {
    const output = path.resolve(process.env.SPEAKSLOW_NATIVE_SPEECH_TEST_REPORT);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ scope: 'Native production helper/coordinator, explicit audio fixture, no microphone/user DB/paste; not packaged Electron acceptance.', switches, pair, cancellation: 'passed', retry: 'passed', selectedAfter: manager.profile }, null, 2));
  }
});

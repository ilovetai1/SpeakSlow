const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { SpeechEngineManager } = require('../src/helpers/speechEngineManager');

function fixture(initial = {}, runtime = {}) {
  const settings = new Map(Object.entries(initial)), calls = [], writes = [];
  const database = {
    getSetting: (key, fallback) => settings.has(key) ? settings.get(key) : fallback,
    setSetting(key, value) { writes.push([key, value]); settings.set(key, value); return true; },
  };
  const apple = Object.assign(new EventEmitter(), {
    supportReason: () => null,
    async prepare(profile) { calls.push(['apple.prepare', profile, settings.get('asr_engine')]); return { state: 'ready' }; },
    async cancel() {}, async dispose() {},
    async install() { calls.push(['apple.install']); },
    async transcribeAudio(_audio, options) { calls.push(['apple.transcribe', options.appleProfile]); return { success: true, text: '辨識結果。' }; },
  });
  const sherpa = {
    serverReady: false,
    async checkModelFiles() { calls.push(['sherpa.check']); return { models_downloaded: true }; },
    async preInitializeModels() { calls.push(['sherpa.prepare']); this.serverReady = true; },
  };
  const manager = new SpeechEngineManager({ database, apple, sherpa, audioStore: {}, platform: 'darwin', arch: 'arm64', release: '26.0.0', ...runtime });
  return { manager, apple, sherpa, database, settings, calls, writes };
}

test('Mac fresh and legacy engines persist Apple before preparation and preserve every profile and other setting', async t => {
  for (const engine of [undefined, 'sherpa', 'apple']) {
    for (const profile of [undefined, 'accurate', 'responsive', 'dictation']) {
      await t.test(`${engine || 'missing'} / ${profile || 'missing'}`, async () => {
        const initial = { asr_profile: 'fast', enable_streaming_mode: true, ai_provider: 'custom_provider', enable_ai_optimization: false };
        if (engine !== undefined) initial.asr_engine = engine;
        if (profile !== undefined) initial.apple_response_profile = profile;
        const f = fixture(initial);
        assert.equal(f.manager.selected, 'apple', 'legacy IPC must not see Sherpa before initialize');
        const state = await f.manager.initialize();
        assert.equal(state.selected, 'apple'); assert.equal(state.state, 'ready'); assert.equal(state.platform, 'darwin');
        assert.equal(state.profile, profile || 'accurate');
        assert.deepEqual(f.calls, [['apple.prepare', profile || 'accurate', 'apple']]);
        assert.deepEqual(f.writes, engine === 'apple' ? [] : [['asr_engine', 'apple']]);
        assert.deepEqual(Object.fromEntries(f.settings), { ...initial, asr_engine: 'apple' });
        const next = fixture(Object.fromEntries(f.settings)); await next.manager.initialize();
        assert.deepEqual(next.writes, [], 'migration must not repeat on restart');
      });
    }
  }
});

test('Mac migration failures block runtime and jobs until a successful explicit retry', async t => {
  for (const failure of [false, { success: false }, new Error('private storage error')]) {
    await t.test(String(failure), async () => {
      const f = fixture({ asr_engine: 'sherpa', apple_response_profile: 'dictation' });
      const persist = f.database.setSetting;
      f.database.setSetting = () => { if (failure instanceof Error) throw failure; return failure; };
      const state = await f.manager.initialize();
      assert.equal(state.state, 'failed'); assert.equal(state.reason, 'engine_setting_save_failed');
      assert.equal(state.activeEngine, null); assert.equal(state.selected, 'apple');
      assert.deepEqual(f.calls, []); assert.equal(f.settings.get('asr_engine'), 'sherpa');
      assert.throws(() => f.manager.begin('recording', 1), /engine_setting_save_failed/);
      f.database.setSetting = persist;
      assert.equal((await f.manager.retry()).state, 'ready');
      assert.deepEqual(f.calls, [['apple.prepare', 'dictation', 'apple']]);
    });
  }
});

test('invalid engine or profile settings do not migrate, prepare, or acquire a job', async () => {
  for (const initial of [{ asr_engine: 'invalid' }, { asr_engine: 'sherpa', apple_response_profile: 'invalid' }]) {
    const f = fixture(initial), state = await f.manager.initialize();
    assert.equal(state.reason, 'engine_setting_invalid');
    assert.deepEqual(f.writes, []); assert.deepEqual(f.calls, []);
    assert.throws(() => f.manager.begin('file', 1), /engine_setting_invalid/);
  }
});

test('Mac26, Intel, and invalid OS versions fail closed without migration or ASR startup', async () => {
  for (const runtime of [{ release: '25.6.0' }, { arch: 'x64' }, { release: 'unknown' }]) {
    const f = fixture({ asr_engine: 'sherpa' }, runtime), state = await f.manager.initialize();
    assert.equal(state.state, 'unavailable'); assert.equal(state.reason, 'platform_unsupported');
    assert.equal(state.appleAvailable, false); assert.equal(state.activeEngine, null);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.calls, []);
    assert.throws(() => f.manager.begin('recording', 1), /platform_unsupported/);
    await assert.rejects(f.manager.install(), /platform_unsupported/);
  }
});

test('Windows and Linux preserve missing and saved Sherpa engines and streaming profiles', async () => {
  for (const platform of ['win32', 'linux']) {
    for (const initial of [{}, { asr_engine: 'sherpa', asr_profile: 'fast', enable_streaming_mode: true }]) {
      const f = fixture(initial, { platform }); await f.manager.initialize();
      assert.equal(f.manager.selected, 'sherpa');
      assert.deepEqual(f.writes, []); assert.deepEqual(f.calls, [['sherpa.check'], ['sherpa.prepare']]);
      const job = f.manager.begin('streaming', 1);
      assert.equal(job.engine, 'sherpa'); assert.equal(job.profile, 'streaming');
      await f.manager.end(job.id, 1);
    }
  }
});

test('Windows and Linux reject saved or requested Apple without preparing or probing its helper', async () => {
  for (const platform of ['win32', 'linux']) {
    const f = fixture({ asr_engine: 'apple' }, { platform });
    f.apple.supportReason = () => { throw Error('must not probe Apple on another platform'); };
    const state = await f.manager.initialize();
    assert.equal(state.reason, 'engine_setting_invalid'); assert.equal(state.appleAvailable, false);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
    assert.throws(() => f.manager.begin('file', 1), /engine_setting_invalid/);
    await assert.rejects(f.manager.select('asr_engine', 'apple'), /engine_setting_invalid/);
    await assert.rejects(f.manager.install(), /engine_setting_invalid/);
  }
});

test('all Mac job kinds freeze Apple and the selected profile; failures never prepare Sherpa', async () => {
  const f = fixture({ asr_engine: 'sherpa', apple_response_profile: 'responsive' }); await f.manager.initialize();
  for (const kind of ['recording', 'streaming', 'file', 'history']) {
    const job = f.manager.begin(kind, 1);
    assert.equal(job.engine, 'apple'); assert.equal(job.profile, 'responsive');
    await assert.rejects(f.manager.select('apple_response_profile', 'dictation'), /speech_busy/);
    await f.manager.end(job.id, 1);
  }
  await assert.rejects(f.manager.select('asr_engine', 'sherpa'), /engine_setting_invalid/);
  f.apple.prepare = async () => { throw new Error('locale_unsupported'); };
  const state = await f.manager.retry();
  assert.equal(state.selected, 'apple'); assert.equal(state.reason, 'locale_unsupported');
  assert.equal(f.calls.some(call => call[0].startsWith('sherpa.')), false);
});

test('dedicated, generic, and legacy IPC cannot activate Sherpa on Mac', async () => {
  const f = fixture({ asr_engine: 'sherpa' }), handlers = new Map();
  const originalLoad = Module._load;
  const files = ['../src/helpers/ipc/speech', '../src/helpers/ipc/database', '../src/helpers/ipc/transcription'];
  try {
    Module._load = function(name, ...args) {
      if (name === 'electron') return { ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} }, BrowserWindow: { getAllWindows: () => [] } };
      return originalLoad.call(this, name, ...args);
    };
    for (const file of files) {
      delete require.cache[require.resolve(file)];
      require(file)({ speechEngineManager: f.manager, databaseManager: f.database, sherpaManager: f.sherpa });
    }
  } finally {
    Module._load = originalLoad;
    for (const file of files) delete require.cache[require.resolve(file)];
  }
  const event = { sender: Object.assign(new EventEmitter(), { id: 3 }) };
  for (const name of ['speech-engine-select', 'set-setting']) {
    await assert.rejects(handlers.get(name)(event, 'asr_engine', 'sherpa'), /engine_setting_invalid/);
  }
  for (const name of ['check-sherpa-status', 'sherpa-status', 'check-model-files', 'download-models', 'get-download-progress', 'precog-start', 'precog-feed', 'precog-abort', 'streaming-start', 'streaming-feed', 'streaming-end', 'preload-streaming-model', 'check-streaming-model-files', 'download-streaming-model']) {
    assert.deepEqual(await handlers.get(name)(event), { success: false, error: 'engine_not_selected' }, name);
  }
  assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
  await f.manager.initialize();
  await handlers.get('set-setting')(event, 'apple_response_profile', 'dictation');
  const result = await handlers.get('transcribe-audio')(event, Buffer.alloc(44), { no_persist: true });
  assert.equal(result.asrEngine, 'apple'); assert.equal(result.asrProfile, 'dictation');
  assert.equal(f.calls.some(call => call[0].startsWith('sherpa.')), false);
});

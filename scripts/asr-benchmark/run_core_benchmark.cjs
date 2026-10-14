// Production managers/helper with an isolated JSON settings adapter. No Electron
// UI, physical microphone, SQLite or target-app paste acceptance is claimed.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { SpeechEngineManager } = require('../../src/helpers/speechEngineManager');
const { AppleSpeechManager } = require('../../src/helpers/appleSpeechManager');
const SherpaManager = require('../../src/helpers/sherpaManager');
const TextUtilityService = require('../../src/helpers/textUtilityService');
const AudioStore = require('../../src/helpers/audioStore');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'out/apple-engine-product');
const directory = path.join(out, 'core-data'); fs.mkdirSync(directory, { recursive: true });
const settings = { asr_engine: 'sherpa', apple_response_profile: 'accurate', asr_profile: 'standard' };
const database = { getSetting: (key, value) => key in settings ? settings[key] : value, setSetting(key, value) { settings[key] = value; fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify(settings)); return true; } };
const logger = { info() {}, debug() {}, warn() {}, error() {} };
const sherpa = new SherpaManager(logger, { userDataPath: directory });
const apple = new AppleSpeechManager({ logger, helperPath: path.join(root, 'native/build/apple-speech') });
const utilities = new TextUtilityService(database, logger);
const manager = new SpeechEngineManager({ database, sherpa, apple, audioStore: new AudioStore(logger), textUtilities: utilities });
const report = { status: 'running', scope: 'Production engine coordinator, Sherpa adapter, Swift helper, JSONL PCM bridge, converter and reducer; isolated JSON settings; no Electron UI/microphone/SQLite/paste', checks: [], results: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function phase(name, data = {}) {
  fs.writeFileSync(path.join(directory, 'speech-phase.json'), JSON.stringify({ phase: name, rootPid: process.pid, time: performance.now(), sherpaPid: sherpa.serverProcess?.pid || null, applePid: apple.child?.pid || null, ...data }));
  fs.writeFileSync(path.join(directory, 'speech-acceptance.json'), JSON.stringify(report, null, 2));
}
(async () => {
  try {
    phase('startup'); await manager.initialize();
    if (manager.state !== 'ready') throw new Error(manager.reason || 'sherpa_not_ready');
    phase('switch_cycles');
    for (let i = 0; i < 20; i++) {
      await manager.select('asr_engine', i % 2 ? 'sherpa' : 'apple');
      if (manager.state === 'needs_download' && manager.selected === 'apple') await manager.install();
      if (manager.state !== 'ready') throw new Error(manager.reason || 'switch_failed');
      if (manager.selected === 'apple' && sherpa.serverProcess || manager.selected === 'sherpa' && apple.child) throw new Error('double_asr_runtime');
    }
    report.checks.push({ name: '20 actual engine switches; only selected owned ASR process', passed: true });
    await manager.select('asr_engine', 'apple');
    if (manager.state === 'needs_download') await manager.install();
    await utilities.transformText('帐号资料', 'to_traditional'); utilities.getEmojiMap();
    report.checks.push({ name: 'Apple text/emoji utilities do not start Sherpa', passed: !sherpa.serverProcess });
    const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json')));
    for (const config of [{ engine: 'sherpa', profile: 'standard' }, { engine: 'apple', profile: 'accurate' }, { engine: 'apple', profile: 'responsive' }]) {
      await manager.select('asr_engine', config.engine);
      if (config.engine === 'apple') await manager.select('apple_response_profile', config.profile);
      if (manager.state === 'needs_download') await manager.install();
      if (manager.state !== 'ready') throw new Error(manager.reason || 'engine_not_ready');
      phase('ready_idle', config); await delay(1500);
      for (const [cohort, manifest] of [['natural', plan.manifest], ['synthetic', plan.syntheticManifest]]) {
        for (const [index, clip] of JSON.parse(fs.readFileSync(manifest)).entries()) {
          phase('workload', { ...config, cohort, index });
          const started = performance.now();
          const recognized = await manager.transcribe(fs.readFileSync(clip.path), { no_persist: true });
          if (!recognized.success || !recognized.text.trim()) throw new Error('recognition_failed_or_empty');
          report.results.push({ id: clip.id, ...config, cohort, reference: clip.reference, duration_s: clip.duration_s, text: recognized.text, segments: recognized.segments || [], elapsed_ms: performance.now() - started });
        }
      }
      phase('post_idle', config); await delay(1500);
    }
    report.status = 'completed'; phase('complete');
  } catch (error) { report.status = 'failed'; report.error = error.message; phase('failed'); }
  finally {
    await manager.dispose(); await utilities.dispose();
    phase('exited'); process.exit(report.status === 'completed' ? 0 : 1);
  }
})();

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { SpeechEngineManager } = require('../../src/helpers/speechEngineManager');
const { AppleSpeechManager } = require('../../src/helpers/appleSpeechManager');
const SherpaManager = require('../../src/helpers/sherpaManager');
const AudioStore = require('../../src/helpers/audioStore');
const root = path.resolve(__dirname, '../..');
const engine = process.argv[2];
if (!['apple', 'sherpa'].includes(engine)) throw new Error('hardware_engine_invalid');
const directory = path.join(root, 'out/apple-engine-product/hardware'); fs.mkdirSync(directory, { recursive: true });
const settings = { asr_engine: engine, apple_response_profile: 'accurate' };
const database = { getSetting: (key, value) => settings[key] ?? value, setSetting: (key, value) => { settings[key] = value; return true; } };
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const sherpa = new SherpaManager(logger, { userDataPath: directory });
const apple = new AppleSpeechManager({ logger, helperPath: path.join(root, 'native/build/apple-speech') });
const manager = new SpeechEngineManager({ database, sherpa, apple, audioStore: new AudioStore(logger) });
(async () => {
  let count = 0;
  try {
    await manager.initialize();
    if (manager.state === 'needs_download' && engine === 'apple') await manager.install();
    if (manager.state !== 'ready') throw new Error(manager.reason || 'hardware_prepare_failed');
    const clips = JSON.parse(fs.readFileSync(path.join(root, 'out/apple-engine-product/synthetic-manifest.json')));
    const begin = performance.now();
    while (performance.now() - begin < 22000) {
      const result = await manager.transcribe(fs.readFileSync(clips[count % clips.length].path), { no_persist: true });
      if (!result.success || !result.text.trim()) throw new Error('hardware_transcription_failed');
      count++;
    }
    fs.writeFileSync(path.join(directory, `${engine}-workload.json`), JSON.stringify({ engine, completed: count, rootPid: process.pid, sherpaPid: sherpa.serverProcess?.pid || null, applePid: apple.child?.pid || null }));
  } finally { await manager.dispose(); }
  process.exit(0);
})().catch(error => { process.stderr.write(error.message); process.exit(1); });

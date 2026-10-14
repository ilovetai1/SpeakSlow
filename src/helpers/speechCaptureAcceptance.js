// Explicit software microphone fixture. Does not exercise physical microphone
// permission, real speaker acoustics or a foreground target's paste handling.
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await delay(30); }
  throw new Error(`capture_timeout_${label}`);
}
async function runCaptureAcceptance({ app, acceptance, windowManager, databaseManager: db, ipcHandlers: ipc }) {
  const manager = ipc.speechEngineManager, win = windowManager.mainWindow;
  const directory = acceptance.dataDirectory;
  const result = { scope: 'packaged app, software microphone fixture, real recording hook/PCM/SDK/SQLite/finalization; paste disabled; no physical microphone/TCC or target receipt claim', status: 'running', cases: [], metrics: null };
  const save = () => fs.writeFileSync(path.join(directory, 'capture-acceptance.json'), JSON.stringify(result, null, 2));
  const evaluate = (fn, args = []) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
  try {
    await waitFor(() => manager.state === 'ready', 'startup', 60000);
    await evaluate(async () => {
      await window.electronAPI.setSetting('paste_after_transcription', false);
      await window.electronAPI.setSetting('enable_ai_optimization', false);
      await window.electronAPI.setSetting('mic_device_id', '');
      await window.electronAPI.setCommandMode(false);
    });
    const fixture = fs.readFileSync(path.join(directory, '..', 'capture-fixture.wav')).toString('base64');
    await evaluate(async encoded => {
      // A generated MediaStream avoids Electron/Chromium fake-file switch
      // forwarding differences. This is expressly a software-source test.
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext(); await context.resume();
        const buffer = await context.decodeAudioData(bytes.slice().buffer);
        const destination = context.createMediaStreamDestination();
        const source = context.createBufferSource(); source.buffer = buffer;
        source.connect(destination); source.start();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); try { source.stop(); } catch {} context.close().catch(() => {}); };
        }
        return destination.stream;
      };
    }, [fixture]);
    await delay(1500);
    const capture = async (config, mode) => {
      const count = db.getTranscriptionStats().total;
      const known = new Set(ipc.latencyManager.export().sessions.map(entry => entry.id));
      win.webContents.send('typeless-start-recording');
      await waitFor(() => manager.job?.kind === 'recording' && ipc.typelessManager.isActive && [...ipc.latencyManager.active.values()].some(collector => collector.observations.some(observation => observation.stage === 'capture' && observation.outcome === 'success')), 'start');
      await delay(mode === 'cancel' ? 200 : mode === 'silence' ? 300 : 5900);
      win.webContents.send(mode === 'cancel' ? 'typeless-cancel-recording' : 'typeless-stop-recording');
      if (mode === 'double_stop') win.webContents.send('typeless-stop-recording');
      await waitFor(() => manager.job === null && !ipc.typelessManager.isActive, 'finish');
      await delay(150);
      const after = db.getTranscriptionStats().total;
      const row = after > count ? db.getTranscriptions(1, 0)[0] : null;
      const normal = !['cancel', 'silence'].includes(mode);
      const passed = normal ? after === count + 1 && row.text.includes('人口') : after === count;
      const metric = ipc.latencyManager.export().sessions.find(entry => !known.has(entry.id));
      result.cases.push({ ...config, mode, passed, history_delta: after - count, characters: row?.text?.length || 0, observations: metric?.observations || [] });
      save();
      if (!passed) throw new Error(`capture_assertion_${mode}`);
    };
    for (const config of [{ engine: 'sherpa', profile: 'standard' }, { engine: 'apple', profile: 'accurate' }, { engine: 'apple', profile: 'responsive' }]) {
      await evaluate(async engine => window.electronAPI.selectSpeechEngine('asr_engine', engine), [config.engine]);
      if (config.engine === 'apple') {
        if (manager.state === 'needs_download') await manager.install();
        await evaluate(async profile => window.electronAPI.selectSpeechEngine('apple_response_profile', profile), [config.profile]);
      }
      await waitFor(() => manager.state === 'ready', 'engine'); await delay(200);
      await capture(config, 'normal'); await capture(config, 'double_stop');
      await capture(config, 'cancel'); await capture(config, 'silence');
    }
    const settings = await windowManager.createSettingsWindow();
    await delay(500);
    fs.writeFileSync(path.join(directory, 'apple-settings.png'), (await settings.webContents.capturePage()).toPNG());
    result.metrics = ipc.latencyManager.export(); result.status = 'completed'; save();
  } catch (error) { result.status = 'failed'; result.error = error.message; save(); }
  finally { await ipc.shutdown(); app.exit(result.status === 'completed' ? 0 : 1); }
}
module.exports = { runCaptureAcceptance };

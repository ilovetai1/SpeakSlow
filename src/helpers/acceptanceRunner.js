const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { percentile } = require('./latencyManager');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeout = 20000) {
  const started = performance.now();
  while (performance.now() - started < timeout) { if (await predicate()) return; await delay(50); }
  throw Object.assign(new Error('acceptance_timeout'), { code: 'acceptance_timeout' });
}
function play(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/afplay', [file], { stdio: 'ignore' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('audio_play_failed')));
  });
}
async function runAcceptance({ app, acceptance, windowManager, databaseManager: db, sherpaManager, hotkeyManager, clipboardManager, ipcHandlers: ipc }) {
  const plan = JSON.parse(fs.readFileSync(acceptance.planPath, 'utf8'));
  if (!['com.apple.TextEdit', 'com.google.Chrome'].includes(plan.targetBundle) || !Number.isInteger(plan.pairs) || plan.pairs < 1 || plan.pairs > 50 || !path.isAbsolute(plan.audioFile) || !fs.existsSync(plan.audioFile) || !Array.isArray(plan.requiredWords) || plan.requiredWords.some(x => typeof x !== 'string' || x.length > 40) || typeof plan.fixtureMarker !== 'string' || plan.fixtureMarker.length > 40) throw new Error('acceptance_plan_invalid');
  const output = path.join(acceptance.dataDirectory, 'physical-pairs.json');
  const result = { version: 1, scope: 'real default microphone, existing hotkey IPC, ASR, isolated SQLite, real paste command and bounded read-back; no fake device or ASR', pairs: [], excluded: [], status: 'waiting' };
  const save = () => fs.writeFileSync(output, JSON.stringify(result, null, 2));
  save();
  await waitFor(() => sherpaManager.serverReady, 60000);
  result.phase = 'renderer_settling'; save();
  await delay(4500); // Model hook polls every 3 s; successful real capture is required below.
  for (const win of [windowManager.mainWindow, windowManager.controlPanelWindow]) win?.hide();
  app.hide();
  const reader = ipc.contextManager.reader;
  result.phase = 'helper_warm'; save();
  await ipc.contextManager.warm();
  result.phase = 'waiting_target'; save();
  await waitFor(async () => { const m = await reader.request('metadata'); result.lastTargetStatus = { status: m.status, targetMatched: m.bundleId === plan.targetBundle }; save(); return m.bundleId === plan.targetBundle; }, 180000);
  result.phase = 'field_proof'; save();
  const initial = await reader.request('captureContext');
  if (initial.status !== 'available' || ![initial.before, initial.selected, initial.after].join('').includes(plan.fixtureMarker)) throw new Error('acceptance_field_unproven');
  await reader.request('release', { fieldId: initial.fieldId });
  let pasted = null;
  const originalPaste = clipboardManager.pasteText.bind(clipboardManager);
  clipboardManager.pasteText = async (text, options) => {
    const metadata = await reader.request('metadata');
    if (metadata.bundleId !== plan.targetBundle) throw new Error('acceptance_focus_changed');
    const before = await reader.request('prepareObservation');
    if (before.status !== 'available') throw new Error('acceptance_field_unavailable');
    const command = await originalPaste(text, options);
    const ack = performance.now();
    const proof = await reader.request('observeSpan', { fieldId: before.fieldId, start: before.selection.location, length: text.length });
    const received = proof.status === 'available' && proof.span === text && proof.before === before.before && proof.after === before.after;
    await reader.request('release', { fieldId: before.fieldId });
    pasted = { ack, received, characters: [...text].length };
    return command;
  };
  try {
    for (let index = 0; index < plan.pairs; index++) {
      const pair = {};
      for (const enabled of index % 2 ? [true, false] : [false, true]) {
        const metadata = await reader.request('metadata');
        if (metadata.bundleId !== plan.targetBundle) throw new Error('acceptance_focus_changed');
        db.setSetting('latency_metrics_enabled', enabled); ipc.latencyManager.configure(enabled);
        const beforeCount = db.getTranscriptionStats().total; pasted = null;
        ipc.latencyManager.noteHotkey();
        result.phase = 'capture_start'; save();
        let lastStart = -Infinity;
        await waitFor(() => {
          if (ipc.typelessManager.isActive === true) return true;
          if (performance.now() - lastStart > 1000) { windowManager.mainWindow.webContents.send('typeless-start-recording'); lastStart = performance.now(); }
          return false;
        }, 15000);
        await delay(900); // Same settling period in both conditions; first microphone grant must complete.
        result.phase = 'speaker_playback'; save();
        await play(plan.audioFile);
        await delay(250);
        result.phase = 'stop_asr_and_paste'; save();
        const stop = performance.now();
        windowManager.mainWindow.webContents.send('typeless-stop-recording');
        await waitFor(() => pasted !== null || db.getTranscriptionStats().total > beforeCount, 30000);
        await waitFor(() => pasted !== null, 10000);
        const row = db.getTranscriptions(1, 0)[0];
        const wordsRetained = !!row && plan.requiredWords.every(word => row.text?.includes(word));
        pair[enabled ? 'on' : 'off'] = { duration: pasted.ack - stop, received: pasted.received, wordsRetained, characters: pasted.characters };
        await waitFor(() => ipc.typelessManager.isActive === false && ipc.latencyManager.active.size === 0);
        await delay(300);
      }
      if (pair.off.received && pair.on.received && pair.off.wordsRetained && pair.on.wordsRetained) result.pairs.push(pair);
      else result.excluded.push({ index, reason: !pair.off.received || !pair.on.received ? 'readback_unproven' : 'synthetic_words_missing' });
      result.status = 'running'; save();
    }
    const durations = result.pairs.map(x => x.off.duration);
    result.offP95 = percentile(durations, .95);
    result.addedP95 = percentile(result.pairs.map(x => x.on.duration - x.off.duration), .95);
    result.budget = result.offP95 === null ? null : Math.max(10, result.offP95 * .02);
    result.passed = result.pairs.length >= 30 && result.addedP95 <= result.budget;
    result.status = 'completed'; save();
    fs.writeFileSync(path.join(acceptance.dataDirectory, 'metrics-export.json'), JSON.stringify(ipc.latencyManager.export(), null, 2));
  } catch (error) {
    result.status = 'failed'; result.code = ['acceptance_timeout', 'acceptance_focus_changed', 'acceptance_field_unavailable'].includes(error.message) ? error.message : 'acceptance_failed'; save();
    throw error;
  } finally { clipboardManager.pasteText = originalPaste; }
}
module.exports = { runAcceptance };

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

test('Apple recording and live preview finalize once, discard cancelled results and preserve raw fallback', { timeout: 20000 }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-finalization-ui-'));
  try {
    esbuild.buildSync({
      stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'jsx', contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useRecording } from './src/hooks/useRecording';
const wait = async predicate => { for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 0)); } throw Error('Timed out: ' + predicate); };
const check = (condition, message) => { if (!condition) throw Error(message); };
const track = { stop() {}, getSettings: () => ({}) };
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } });
let processor;
window.AudioContext = class {
  sampleRate = 48000; state = 'running';
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { processor = { connect() {}, disconnect() {} }; return processor; }
  async close() {}
};
(async () => {
  for (const scenario of ['success', 'live_preview', 'cancel', 'owner_unmount', 'disabled', 'provider_failed', 'save_failed']) {
    let recording, resolvePolish, previewListener, asrCalls = 0, polishCalls = 0, saves = 0, releases = 0, outputs = [];
    const holder = document.createElement('div'); document.querySelector('#root').append(holder);
    const root = createRoot(holder);
    window.electronAPI = {
      getSetting: async (key, fallback) => key === 'enable_ai_optimization' ? true : fallback,
      beginSpeechJob: async () => ({ id: scenario, engine: 'apple', profile: 'accurate' }),
      endSpeechJob: async () => { releases++; }, cancelSpeechJob: async () => {},
      startSpeechSession: async () => {}, feedSpeechSession: async () => {},
      finishSpeechSession: async () => { asrCalls++; return { success: true, text: '三萬，不是三千五。' }; },
      applyDictionaryWithContext: async text => ({ text }), getCommandMode: async () => false,
      onSpeechPreview: callback => { previewListener = callback; return () => {}; },
      processText: async () => { polishCalls++; return new Promise(resolve => { resolvePolish = resolve; }); },
      saveTranscription: async data => { saves++; check(data.raw_text === '三萬，不是三千五。', 'baseline changed'); return scenario === 'save_failed' ? { success: false } : { changes: 1 }; },
    };
    window.onTranscriptionComplete = () => {};
    window.onAIOptimizationComplete = async result => { outputs.push(result); };
    function Harness() { recording = useRecording({ isReady: true }); return null; }
    flushSync(() => root.render(<Harness/>));
    check(await recording.startRecording(), 'start failed: ' + scenario);
    await wait(() => recording.isRecording);
    if (scenario === 'live_preview') {
      previewListener(null, { jobId: scenario, text: '尚未定稿' });
      check(polishCalls === 0 && saves === 0 && outputs.length === 0, 'partial caused side effects');
    }
    processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(8192) } });
    const stopped = recording.stopRecording();
    await recording.stopRecording();
    await wait(() => !!resolvePolish);
    check(asrCalls === 1 && polishCalls === 1 && saves === 0, 'duplicate stop repeated work');
    if (scenario === 'cancel') recording.cancelRecording();
    if (scenario === 'owner_unmount') root.unmount();
    resolvePolish(scenario === 'disabled' ? { success: false, code: 'polishing_disabled' } : scenario === 'provider_failed' ? { success: false, code: 'timeout' } : { success: true, text: '主程序潤稿結果。' });
    await stopped;
    if (scenario === 'cancel' || scenario === 'owner_unmount') {
      check(saves === 0 && outputs.length === 0, 'cancelled owner saved or output late text');
    } else {
      check(saves === 1 && outputs.length === 1, 'finalized more than once');
      if (scenario === 'disabled' || scenario === 'provider_failed') check(outputs[0].text === '三萬，不是三千五。', 'raw fallback changed');
      if (scenario === 'disabled') check(!outputs[0].issue, 'disable reported a model failure');
      if (scenario === 'provider_failed') check(outputs[0].issue === '潤稿失敗，已使用原始文字', 'fallback failure was hidden');
      if (scenario === 'save_failed') check(outputs[0].issue === '歷史紀錄保存失敗', 'save failure was hidden');
    }
    check(releases >= 1, 'job was not released');
    if (scenario !== 'owner_unmount') root.unmount();
  }
  document.querySelector('#result').textContent = 'Recording lifecycle PASS';
})().catch(error => { document.querySelector('#result').textContent = error.message; });
` },
      outfile: path.join(directory, 'renderer.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    });
    fs.writeFileSync(path.join(directory, 'index.html'), '<div id="root"></div><pre id="result">pending</pre><script src="renderer.js"></script>');
    const stdout = execFileSync(process.env.SPEAKSLOW_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', '--virtual-time-budget=5000', `file://${path.join(directory, 'index.html')}`], { timeout: 17000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1], 'Recording lifecycle PASS');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

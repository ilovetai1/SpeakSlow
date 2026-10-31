const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, ms, message) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
};

async function runScenarios(scenarios) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-finalization-ui-'));
  try {
    esbuild.buildSync({
      stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'jsx', contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useRecording } from './src/hooks/useRecording';
const wait = async predicate => { for (let attempt = 0; attempt < 10000; attempt++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Timed out: ' + predicate); };
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
  for (const scenario of ${JSON.stringify(scenarios)}) {
    let recording, resolvePolish, previewListener, asrCalls = 0, polishCalls = 0, saves = 0, updates = 0, releases = 0, outputs = [];
    const fast = scenario.startsWith('fast_');
    const deferred = ['cancel', 'owner_unmount', 'fast_cancel'].includes(scenario);
    const providerResult = () => ['disabled', 'fast_disabled'].includes(scenario) ? { success: false, code: 'polishing_disabled' }
      : ['provider_failed', 'fast_failed'].includes(scenario) ? { success: false, code: 'timeout' }
      : { success: true, text: '主程序潤稿結果。' };
    const holder = document.createElement('div'); document.querySelector('#root').append(holder);
    const root = createRoot(holder);
    window.electronAPI = {
      getSetting: async (key, fallback) => key === 'enable_ai_optimization' ? true
        : key === 'ai_provider' && fast ? 'apple_on_device'
        : key === 'apple_polishing_output_mode' && fast ? 'fast'
        : fallback,
      beginSpeechJob: async () => ({ id: scenario, engine: 'apple', profile: 'accurate' }),
      endSpeechJob: async () => { releases++; }, cancelSpeechJob: async () => {},
      startSpeechSession: async () => {}, feedSpeechSession: async () => {},
      finishSpeechSession: async () => { asrCalls++; return { success: true, text: '三萬，不是三千五。' }; },
      applyDictionaryWithContext: async text => ({ text }), getCommandMode: async () => false,
      onSpeechPreview: callback => { previewListener = callback; return () => {}; },
      processText: async () => {
        polishCalls++;
        if (fast) check(saves === 1 && outputs.length === 1 && outputs[0].outputAction === 'baseline_output', 'fast generation started before baseline output');
        else check(saves === 0 && outputs.length === 0, 'wait mode saved or output before generation');
        return deferred ? new Promise(resolve => { resolvePolish = resolve; }) : providerResult();
      },
      saveTranscription: async data => { saves++; check(data.raw_text === '三萬，不是三千五。', 'baseline changed'); return scenario === 'save_failed' ? { success: false } : { changes: 1, lastInsertRowid: 71 }; },
      updateFastTranscriptionCandidate: async (id, expected, candidate, jobId) => {
        updates++;
        check(id === 71 && expected === '三萬，不是三千五。' && candidate === '主程序潤稿結果。' && jobId === scenario, 'wrong conditional update');
        if (scenario === 'fast_conflict') return { success: false, changes: 0, code: 'history_changed' };
        if (scenario === 'fast_disabled_after_generation') return { success: false, changes: 0, code: 'candidate_stale' };
        return { success: true, changes: 1 };
      },
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
    if (deferred) {
      try {
        await wait(() => !!resolvePolish || !!recording.error);
      } catch {
        throw Error('Timed out before polishing: ' + scenario + '; recording=' + JSON.stringify({ isRecording: recording.isRecording, isProcessing: recording.isProcessing, isOptimizing: recording.isOptimizing, error: recording.error }));
      }
      check(!recording.error, 'recording error before polishing: ' + recording.error);
      if (fast) {
        check(asrCalls === 1 && polishCalls === 1 && saves === 1, 'fast baseline was not saved before generation');
        check(outputs.length === 1 && outputs[0].outputAction === 'baseline_output' && outputs[0].text === '三萬，不是三千五。', 'fast baseline output missing');
      } else {
        check(asrCalls === 1 && polishCalls === 1 && saves === 0, 'duplicate stop repeated work');
      }
    }
    if (scenario === 'cancel') recording.cancelRecording();
    if (scenario === 'owner_unmount') root.unmount();
    if (scenario === 'fast_cancel') recording.cancelRecording();
    if (deferred) resolvePolish(providerResult());
    await stopped;
    check(asrCalls === 1 && polishCalls === 1, 'duplicate stop repeated recognition or polishing');
    if (scenario === 'cancel' || scenario === 'owner_unmount') {
      check(saves === 0 && outputs.length === 0, 'cancelled owner saved or output late text');
    } else if (scenario === 'fast_cancel' || scenario === 'fast_disabled') {
      check(saves === 1 && updates === 0 && outputs.length === 1, 'fast cancellation changed output or history late');
    } else if (scenario === 'fast_disabled_after_generation') {
      check(saves === 1 && updates === 1 && outputs.length === 1, 'stale candidate escaped after disable');
    } else if (fast) {
      check(saves === 1 && outputs.length === 2, 'fast flow did not emit exactly two phases');
      check(outputs[1].outputAction === 'candidate_only', 'fast terminal event can paste again');
      if (scenario === 'fast_success') check(updates === 1 && outputs[1].enhanced_by_ai, 'fast candidate was not applied');
      if (scenario === 'fast_failed') check(updates === 0 && outputs[1].issue === '潤稿失敗，已使用原始文字', 'fast failure was not terminal without update');
      if (scenario === 'fast_conflict') check(updates === 1 && outputs[1].issue === '歷史紀錄保存失敗', 'history conflict was hidden');
    } else {
      check(saves === 1 && outputs.length === 1, 'finalized more than once');
      if (scenario === 'disabled' || scenario === 'provider_failed') check(outputs[0].text === '三萬，不是三千五。', 'raw fallback changed');
      if (scenario === 'disabled') check(!outputs[0].issue, 'disable reported a model failure');
      if (scenario === 'provider_failed') check(outputs[0].issue === '潤稿失敗，已使用原始文字', 'fallback failure was hidden');
      if (scenario === 'save_failed') check(outputs[0].issue === '歷史紀錄保存失敗', 'save failure was hidden');
    }
    check(releases >= 1, 'job was not released');
    if (scenario !== 'owner_unmount') root.unmount();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  document.querySelector('#result').textContent = 'Recording lifecycle PASS';
})().catch(error => { document.querySelector('#result').textContent = error.message; });
` },
      outfile: path.join(directory, 'renderer.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    });
    fs.writeFileSync(path.join(directory, 'index.html'), '<div id="root"></div><pre id="result">pending</pre><script src="renderer.js"></script>');
    const profile = path.join(directory, 'profile');
    const pageUrl = pathToFileURL(path.join(directory, 'index.html')).href;
    const browser = spawn(
      process.env.SPEAKSLOW_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, pageUrl],
      { stdio: 'ignore' },
    );
    let socket;
    try {
      const portFile = path.join(profile, 'DevToolsActivePort');
      const startupDeadline = Date.now() + 10000;
      while (!fs.existsSync(portFile) && Date.now() < startupDeadline) {
        if (browser.exitCode !== null) throw new Error(`Chrome exited before DevTools became ready: ${browser.exitCode}`);
        await delay(20);
      }
      if (!fs.existsSync(portFile)) throw new Error('Timed out waiting for Chrome DevTools');
      const [port] = fs.readFileSync(portFile, 'utf8').trim().split('\n');

      let target;
      while (!target && Date.now() < startupDeadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/list`);
          const targets = await response.json();
          target = targets.find(item => item.type === 'page' && item.url === pageUrl)
            || targets.find(item => item.type === 'page');
        } catch {
          await delay(20);
        }
      }
      if (!target?.webSocketDebuggerUrl) throw new Error('Chrome page target was unavailable');

      socket = new WebSocket(target.webSocketDebuggerUrl);
      await withTimeout(
        new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true });
          socket.addEventListener('error', () => reject(new Error('Chrome DevTools socket failed')), { once: true });
        }),
        5000,
        'Timed out connecting to Chrome DevTools',
      );
      let nextId = 0;
      const pending = new Map();
      socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data));
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      });
      const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
      await call('Runtime.enable');

      let lifecycleResult = 'pending';
      const completionDeadline = Date.now() + 30000;
      while (lifecycleResult === 'pending' && Date.now() < completionDeadline) {
        if (browser.exitCode !== null) throw new Error(`Chrome exited before lifecycle completion: ${browser.exitCode}`);
        const evaluated = await call('Runtime.evaluate', {
          expression: "document.querySelector('#result')?.textContent || 'missing'",
          returnByValue: true,
        });
        lifecycleResult = evaluated.result?.value;
        if (lifecycleResult === 'pending') await delay(20);
      }
      assert.equal(lifecycleResult, 'Recording lifecycle PASS');
    } finally {
      socket?.close();
      if (browser.exitCode === null) {
        browser.kill('SIGTERM');
        await withTimeout(once(browser, 'exit'), 3000, 'Timed out stopping Chrome').catch(() => {});
        if (browser.exitCode === null) browser.kill('SIGKILL');
      }
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('Apple wait-mode recording finalizes once and discards cancelled results', { timeout: 45000 }, async () => {
  await runScenarios(['success', 'live_preview', 'cancel', 'owner_unmount', 'disabled', 'provider_failed', 'save_failed']);
});

test('Apple fast-mode recording emits one baseline output and a non-pasting candidate', { timeout: 45000 }, async () => {
  await runScenarios(['fast_success', 'fast_failed', 'fast_disabled', 'fast_disabled_after_generation', 'fast_cancel', 'fast_conflict']);
});

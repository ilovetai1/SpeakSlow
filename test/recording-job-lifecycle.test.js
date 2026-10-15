const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const esbuild = require('esbuild');
const http = require('node:http');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { SpeechEngineManager } = require('../src/helpers/speechEngineManager');

for (const cancelFails of [false, true]) {
test(`recording cancellation holds the gate until job release (cancellation fails: ${cancelFails})`, { timeout: 15000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-recording-job-'));
  const handlers = new Map();
  let beginRequests = 0;
  let finishBrowser, browser;
  const browserResult = new Promise(resolve => { finishBrowser = resolve; });
  const sender = Object.assign(new EventEmitter(), { id: 7 });
  let release, notifyCancelling;
  const cancelling = new Promise(resolve => { notifyCancelling = resolve; });
  const apple = Object.assign(new EventEmitter(), {
    supportReason: () => null, prepare: async () => ({ state: 'ready' }), start: async () => {},
    cancel: async () => {
      notifyCancelling();
      await new Promise((resolve, reject) => { release = () => cancelFails ? reject(Error('helper_pipe')) : resolve(); });
    },
  });
  const manager = new SpeechEngineManager({
    database: { getSetting: (key, fallback) => key === 'asr_engine' ? 'apple' : fallback },
    sherpa: {}, apple, audioStore: {},
  });
  const originalLoad = Module._load;
  try {
    Module._load = function (name, ...args) {
      if (name === 'electron') return { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, BrowserWindow: { getAllWindows: () => [] } };
      return originalLoad.call(this, name, ...args);
    };
    delete require.cache[require.resolve('../src/helpers/ipc/speech')];
    require('../src/helpers/ipc/speech')({ speechEngineManager: manager });
  } finally { Module._load = originalLoad; }
  handlers.set('test-wait-cancelling', () => cancelling);
  handlers.set('test-release-cancellation', () => { release(); apple.cancel = async () => {}; });
  handlers.set('test-assert-cancelling', () => {
    assert.equal(manager.snapshot().busy, true);
    assert.equal(beginRequests, 1, 'renderer must not request a new job during cancellation');
  });
  const server = http.createServer(async (request, response) => {
    if (request.url === '/result') {
      let body = '';
      for await (const chunk of request) body += chunk;
      response.end('ok'); finishBrowser(body); return;
    }
    if (request.url === '/ipc') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { name, args } = JSON.parse(body);
      if (name === 'speech-job-begin') beginRequests++;
      try {
        const value = await handlers.get(name)({ sender }, ...args);
        response.end(JSON.stringify({ value }));
      } catch (error) {
        response.end(JSON.stringify({ error: `Error invoking remote method '${name}': Error: ${error.message}` }));
      }
      return;
    }
    const file = request.url === '/renderer.js' ? 'renderer.js' : 'index.html';
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(fs.readFileSync(path.join(directory, file)));
  });
  try {
    await manager.initialize();
    const project = path.resolve(__dirname, '..');
    esbuild.buildSync({
      stdin: { contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useRecording } from './src/hooks/useRecording';
const invoke = async (name, ...args) => {
  const response = await fetch('/ipc', { method: 'POST', body: JSON.stringify({ name, args }) });
  const result = await response.json();
  if (result.error) throw Error(result.error);
  return result.value;
};
window.electronAPI = {
  getSetting: async (_key, fallback) => fallback,
  beginSpeechJob: kind => invoke('speech-job-begin', kind),
  endSpeechJob: (id, cancel) => invoke('speech-job-end', id, cancel),
  startSpeechSession: (id, format) => invoke('speech-session-start', id, format),
};
const track = { stop() {}, getSettings: () => ({}) };
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }),
}});
window.AudioContext = class {
  sampleRate = 48000; state = 'running';
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {} }; }
  async close() {}
};
let recording;
function Harness() { recording = useRecording({ isReady: true }); return null; }
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<Harness />));
(async () => {
  if (!await recording.startRecording()) throw Error('Initial recording failed');
  flushSync(() => {});
  recording.cancelRecording();
  // Main-process Apple cancellation is deliberately held, without a timing race.
  await invoke('test-wait-cancelling');
  // Repeated cancel must not clear the gate while the first cancellation is pending.
  recording.cancelRecording();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await recording.startRecording()) throw Error('Started before cancellation completed');
    await new Promise(resolve => setTimeout(resolve, 0));
    if (recording.error?.includes('speech_busy')) throw Error(recording.error);
    if (!recording.isProcessing) throw Error('UI returned to idle before job release');
  }
  await invoke('test-assert-cancelling');
  await invoke('test-release-cancellation');
  for (let attempt = 0; recording.isProcessing && attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (recording.isProcessing) throw Error('UI stayed busy after job release');
  if (TEST_CANCEL_FAILURE && !recording.error?.includes('語音引擎發生錯誤')) throw Error('Cancellation failure was hidden');
  if ((await invoke('speech-engine-state')).busy) throw Error('Main-process job was not released');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await recording.startRecording()) {
      root.unmount();
      await fetch('/result', { method: 'POST', body: 'PASS' });
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw Error('Recording cannot restart after cancellation: ' + recording.error);
})().catch(error => { root.unmount(); fetch('/result', { method: 'POST', body: error.message }); });
`, resolveDir: project, loader: 'jsx' },
      outfile: path.join(directory, 'renderer.js'), bundle: true, platform: 'browser', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"', TEST_CANCEL_FAILURE: String(cancelFails) },
    });
    fs.writeFileSync(path.join(directory, 'index.html'), '<div id="root"></div><pre id="result">pending</pre><script src="renderer.js"></script>');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = execFile(process.env.SPEAKSLOW_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${path.join(directory, 'profile')}`,
      `http://127.0.0.1:${server.address().port}`,
    ], { timeout: 12000, maxBuffer: 1024 * 1024 }, error => { if (error) finishBrowser(`Browser failed: ${error.message}`); });
    assert.equal(await browserResult, 'PASS');
    if (manager.job) await manager.end(manager.job.id, sender.id, true);
    assert.equal(manager.snapshot().busy, false);
    assert.equal(sender.listenerCount('destroyed'), 0);
    assert.equal(sender.listenerCount('render-process-gone'), 0);
  } finally {
    if (browser && browser.exitCode === null) {
      browser.kill(); await new Promise(resolve => browser.once('exit', resolve));
    }
    release?.();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
}

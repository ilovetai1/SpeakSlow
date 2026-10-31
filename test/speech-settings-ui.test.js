const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

test('Mac Apple-only controls retain all profiles, busy gates, downloads, failures and retry without Sherpa fallback', { timeout: 20000 }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-mac-engine-ui-'));
  try {
    esbuild.buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import SpeechEngineSettings from './src/components/SpeechEngineSettings'; createRoot(document.getElementById('root')).render(<SpeechEngineSettings/>);`, resolveDir: path.resolve(__dirname, '..'), loader: 'jsx' }, outfile: path.join(directory, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/macos-native-speech-settings-ui.js'), 'utf8');
    fs.writeFileSync(path.join(directory, 'index.html'), `<div id="root"></div><pre id="test-result"></pre><script>${fixture}</script><script src="./ui.js"></script>`);
    const stdout = execFileSync(process.env.SPEAKSLOW_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', '--virtual-time-budget=5000', `file://${path.join(directory, 'index.html')}`], { timeout: 17000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(stdout.match(/<pre id="test-result">([^<]*)<\/pre>/)?.[1], 'Mac Apple-only UI PASS');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

for (const platform of ['win32', 'linux']) {
test(`${platform} retains Sherpa controls and does not expose Apple recognition`, { timeout: 20000 }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-engine-ui-'));
  try {
    esbuild.buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import SpeechEngineSettings from './src/components/SpeechEngineSettings'; createRoot(document.getElementById('root')).render(<SpeechEngineSettings/>);`, resolveDir: path.resolve(__dirname, '..'), loader: 'jsx' }, outfile: path.join(directory, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/speech-settings-ui.js'), 'utf8');
    fs.writeFileSync(path.join(directory, 'index.html'), `<div id="root"></div><pre id="test-result"></pre><script>window.TEST_SPEECH_PLATFORM=${JSON.stringify(platform)};${fixture}</script><script src="./ui.js"></script>`);
    const stdout = execFileSync(process.env.SPEAKSLOW_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', '--virtual-time-budget=5000', `file://${path.join(directory, 'index.html')}`], { timeout: 17000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(stdout.match(/<pre id="test-result">([^<]*)<\/pre>/)?.[1], 'Speech engine UI PASS');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
}

test('same-recording comparison UI locks runs, cancels, preserves raw text and scores a supplied reference', { timeout: 20000 }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-comparison-ui-'));
  try {
    esbuild.buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import AppleSpeechComparison from './src/components/AppleSpeechComparison'; createRoot(document.getElementById('root')).render(<AppleSpeechComparison recordId={42} onClose={window.comparisonClosed}/>);`, resolveDir: path.resolve(__dirname, '..'), loader: 'jsx' }, outfile: path.join(directory, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/apple-comparison-ui.js'), 'utf8');
    fs.writeFileSync(path.join(directory, 'index.html'), `<div id="root"></div><pre id="test-result"></pre><script>${fixture}</script><script src="./ui.js"></script>`);
    const stdout = execFileSync(process.env.SPEAKSLOW_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-proxy-server', `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', '--virtual-time-budget=5000', `file://${path.join(directory, 'index.html')}`], { timeout: 17000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(stdout.match(/<pre id="test-result">([^<]*)<\/pre>/)?.[1], 'Apple comparison UI PASS');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

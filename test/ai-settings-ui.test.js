const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const esbuild = require('esbuild');

test('已開啟的設定視窗同步 AI 開關，儲存提示詞不覆寫開關', { timeout: 20000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-ai-settings-test-'));
  try {
    esbuild.buildSync({
      entryPoints: [path.join(__dirname, '../src/settings.jsx')],
      outfile: path.join(directory, 'settings.js'),
      bundle: true, platform: 'browser', jsx: 'automatic',
      loader: { '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/ai-settings-ui.js'), 'utf8');
    fs.writeFileSync(path.join(directory, 'settings.html'), `<div id="settings-root"></div><pre id="test-result"></pre><script>${fixture}</script>`);
    const browser = process.env.SPEAKSLOW_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const { stdout } = await promisify(execFile)(browser, [
      '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--no-proxy-server', `--user-data-dir=${path.join(directory, 'profile')}`,
      '--dump-dom', '--virtual-time-budget=5000',
      `file://${path.join(directory, 'settings.html')}`,
    ], { timeout: 17000, maxBuffer: 2 * 1024 * 1024 });
    const result = stdout.match(/<pre id="test-result">([^<]*)<\/pre>/)?.[1];
    assert.equal(result, 'AI settings UI PASS');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

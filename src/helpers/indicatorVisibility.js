const { execFile } = require('node:child_process');
const path = require('node:path');

function readIndicatorVisibility(win) {
  if (!win || win.isDestroyed()) return Promise.resolve(false);
  const match = /^window:(\d+):/.exec(win.getMediaSourceId());
  if (!match) return Promise.reject(new Error('無法取得錄音指示器的原生視窗 ID'));
  const helper = require('electron').app.isPackaged
    ? path.join(process.resourcesPath, 'window-visibility')
    : path.join(__dirname, '../../native/build/window-visibility');
  return new Promise((resolve, reject) => {
    execFile(helper, [String(process.pid), match[1]], { timeout: 1500, maxBuffer: 4096 }, (error, stdout) => {
      if (error) return reject(error);
      try {
        const state = JSON.parse(stdout);
        if (typeof state.onScreen !== 'boolean') throw new Error('原生視窗可見性回應無效');
        resolve(state.onScreen);
      } catch (error) { reject(error); }
    });
  });
}

// Electron isVisible() does not prove membership in the current macOS Space.
// Two missed samples tolerate Space/Dock transitions. Recovery is bounded per recording.
function createIndicatorVisibilityMonitor({ readVisible, recover, reportError, interval = 1200 }) {
  let active = false;
  let generation = 0;
  let timer = null;
  let misses = 0;
  let attempts = 0;
  let failed = false;
  function stop() {
    active = false;
    ++generation;
    clearTimeout(timer);
    timer = null;
    failed = false;
  }
  function schedule(token) {
    timer = setTimeout(() => check(token), interval);
    timer.unref?.();
  }
  async function check(token) {
    const current = () => active && token === generation;
    try {
      const visible = await readVisible();
      if (!current()) return;
      misses = visible ? 0 : misses + 1;
      if (misses >= 2) {
        if (attempts >= 2) throw new Error('錄音仍在進行，但 macOS 未顯示錄音指示器；重新顯示及重建視窗後仍失敗');
        misses = 0;
        await recover(++attempts, current);
      }
      if (current()) schedule(token);
    } catch (error) {
      if (!current()) return;
      stop();
      failed = true;
      reportError(error);
    }
  }
  return {
    start() {
      if (active || failed) return;
      active = true;
      misses = 0;
      attempts = 0;
      schedule(++generation);
    },
    stop,
  };
}

module.exports = { readIndicatorVisibility, createIndicatorVisibilityMonitor };

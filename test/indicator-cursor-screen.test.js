const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');
const macTest = (name, run) => test(name, { skip: process.platform !== 'darwin' }, run);

async function withWindowManager(run) {
  const primary = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  const secondary = { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } };
  let cursor = { x: -1000, y: 200 };
  let foregroundQueries = 0;
  let secondaryConnected = true;
  let pendingLoad = null;
  const errors = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.position = { x: options.x, y: options.y };
      this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), { send() {} });
    }
    isDestroyed() { return this.destroyed; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setPosition(x, y) { this.position = { x, y }; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    close() { this.destroy(); }
    async loadFile() { if (pendingLoad) await pendingLoad; this.webContents.emit('did-finish-load'); }
  }
  const electron = {
    BrowserWindow: Window,
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => primary,
      getCursorScreenPoint: () => ({ ...cursor }),
      getDisplayNearestPoint: point => secondaryConnected && point.x < 0 ? secondary : primary,
      getDisplayMatching: rect => rect.x < 0 ? secondary : primary,
    }),
  };
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'electron') return electron;
    if (name === 'child_process') return {
      ...originalLoad.call(this, name, ...args),
      execFile: (_file, _args, _options, callback) => {
        foregroundQueries++;
        setImmediate(() => callback(null, JSON.stringify({ x: 0, y: 0, width: 1000, height: 800, bundleId: 'focused.on.primary' }), ''));
      },
    };
    return originalLoad.call(this, name, ...args);
  };
  let manager;
  try {
    delete require.cache[require.resolve('../src/helpers/windowManager')];
    const WindowManager = require('../src/helpers/windowManager');
    manager = new WindowManager(null, { info() {}, error: (...args) => errors.push(args) });
    await run({ manager, setCursor: value => { cursor = value; }, queries: () => foregroundQueries, errors,
      holdLoad: promise => { pendingLoad = promise; },
      disconnectSecondary: () => { secondaryConnected = false; cursor = { x: 400, y: 200 }; electron.screen.emit('display-removed', {}, secondary); },
    });
  } finally {
    manager?.closeTypelessIndicator();
    Module._load = originalLoad;
  }
}

const flush = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

macTest('滑鼠在副螢幕但鍵盤焦點在主螢幕，錄音圖示必須顯示在滑鼠螢幕', async () => {
  await withWindowManager(async h => {
    h.manager.showTypelessIndicator();
    await flush();
    assert.deepEqual(h.manager.typelessIndicatorWindow.position, { x: -1080, y: 984 });
    assert.equal(h.manager.typelessIndicatorWindow.visible, true);
    assert.equal(h.queries(), 0, '游標定位不應依賴前景視窗 JXA');
  });
});

macTest('錄音中拔除外接螢幕，必須重建原生指示器並定位到剩餘螢幕', async () => {
  await withWindowManager(async h => {
    h.manager.showTypelessIndicator(); await flush();
    const original = h.manager.typelessIndicatorWindow;
    h.disconnectSecondary(); await flush();
    assert.equal(original.destroyed, true, '不可沿用已移除螢幕的原生 panel');
    assert.notEqual(h.manager.typelessIndicatorWindow, original);
    assert.deepEqual(h.manager.typelessIndicatorWindow.position, { x: 600, y: 804 });
    assert.equal(h.manager.typelessIndicatorWindow.visible, true);
  });
});

macTest('未錄音時拔除螢幕只清除舊視窗，下次錄音才建立新視窗', async () => {
  await withWindowManager(async h => {
    h.manager.showTypelessIndicator(); await flush();
    const original = h.manager.typelessIndicatorWindow;
    h.manager.hideTypelessIndicator(); h.disconnectSecondary(); await flush();
    assert.equal(original.destroyed, true);
    assert.equal(h.manager.typelessIndicatorWindow, null);
    h.manager.showTypelessIndicator(); await flush();
    assert.equal(h.manager.typelessIndicatorWindow.visible, true);
    assert.deepEqual(h.manager.typelessIndicatorWindow.position, { x: 600, y: 804 });
  });
});

macTest('拔除螢幕時仍在載入，停止錄音後不得被重建流程重新顯示', async () => {
  await withWindowManager(async h => {
    let finish;
    h.holdLoad(new Promise(resolve => { finish = resolve; }));
    h.manager.showTypelessIndicator();
    h.disconnectSecondary(); h.manager.hideTypelessIndicator();
    finish(); await flush();
    assert.equal(h.manager.typelessIndicatorWindow, null);
    assert.deepEqual(h.errors, []);
  });
});

macTest('下一次錄音會重新讀取滑鼠位置，不沿用上次的螢幕', async () => {
  await withWindowManager(async h => {
    h.setCursor({ x: 400, y: 200 });
    h.manager.showTypelessIndicator();
    await flush();
    assert.deepEqual(h.manager.typelessIndicatorWindow.position, { x: 600, y: 804 });
    h.manager.hideTypelessIndicator();
    h.setCursor({ x: -1000, y: 200 });
    h.manager.showTypelessIndicator();
    await flush();
    assert.deepEqual(h.manager.typelessIndicatorWindow.position, { x: -1080, y: 984 });
  });
});

macTest('持續錄音時，滑鼠跨螢幕會更新圖示；停止後不再移動', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  await withWindowManager(async h => {
    h.setCursor({ x: 400, y: 200 });
    h.manager.showTypelessIndicator();
    await flush();
    h.setCursor({ x: -1000, y: 200 });
    t.mock.timers.tick(250);
    await flush();
    assert.deepEqual(h.manager.typelessIndicatorWindow.position, { x: -1080, y: 984 });
    h.manager.hideTypelessIndicator();
    h.setCursor({ x: 400, y: 200 });
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(h.manager.typelessIndicatorWindow.visible, false);
    assert.deepEqual(h.manager.typelessIndicatorWindow.position, { x: -1080, y: 984 });
  });
});

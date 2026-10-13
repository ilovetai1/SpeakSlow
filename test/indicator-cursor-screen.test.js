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
    async loadFile() { this.webContents.emit('did-finish-load'); }
  }
  const electron = {
    BrowserWindow: Window,
    screen: {
      getPrimaryDisplay: () => primary,
      getCursorScreenPoint: () => ({ ...cursor }),
      getDisplayNearestPoint: point => point.x < 0 ? secondary : primary,
      getDisplayMatching: rect => rect.x < 0 ? secondary : primary,
    },
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
    await run({ manager, setCursor: value => { cursor = value; }, queries: () => foregroundQueries, errors });
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

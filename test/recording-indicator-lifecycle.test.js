const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const test = require('node:test');

async function withHarness(run, { load } = {}) {
  const errors = [];
  const windows = [];
  const handlers = new Map();
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.visible = false;
      this.webContents = Object.assign(new EventEmitter(), { send() {}, isLoading: () => false });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setPosition() {}
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
    async loadFile() {
      if (load) await load();
      this.webContents.emit('did-finish-load');
    }
  }
  const electron = {
    BrowserWindow: Object.assign(Window, { getAllWindows: () => windows }),
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 1000 } }),
      getCursorScreenPoint: () => ({ x: 400, y: 300 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 1000 } }),
    },
  };
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'electron') return electron;
    return originalLoad.call(this, name, ...args);
  };
  let manager;
  try {
    for (const file of ['../src/helpers/windowManager', '../src/helpers/ipc/hotkeys']) {
      delete require.cache[require.resolve(file)];
    }
    const WindowManager = require('../src/helpers/windowManager');
    manager = new WindowManager(null, { info() {}, warn() {}, error: (...args) => errors.push(args) });
    manager._typelessIndicatorPositioner = {
      requestShow: callback => callback({ x: 200, y: 800 }, { stillCurrent: () => true }),
      notifyHidden() {},
    };
    require('../src/helpers/ipc/hotkeys')({
      windowManager: manager,
      typelessManager: { syncActiveState() {} },
      logger: { info() {}, warn() {}, error() {} },
    });
    await run({ manager, windows, handlers, errors });
  } finally { Module._load = originalLoad; }
}

test('renderer 確認麥克風正在錄音時，指示器必須同步顯示；停止時同步隱藏', async () => {
  await withHarness(async h => {
    await h.handlers.get('sync-typeless-state')(null, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.manager.typelessIndicatorWindow?.visible, true,
      '實際錄音狀態為 true，卻未顯示錄音指示器');
    await h.handlers.get('sync-typeless-state')(null, false);
    assert.equal(h.manager.typelessIndicatorWindow.visible, false);
  });
});

test('指示器 renderer 結束後不能重用空白視窗，下一次錄音應建立可顯示的視窗', async () => {
  await withHarness(async h => {
    await h.manager.createTypelessIndicatorWindow();
    const original = h.manager.typelessIndicatorWindow;
    original.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    h.manager.showTypelessIndicator();
    await new Promise(resolve => setImmediate(resolve));
    assert.notEqual(h.manager.typelessIndicatorWindow, original,
      'renderer 已結束，後續錄音仍重用同一個空白 BrowserWindow');
    assert.equal(h.manager.typelessIndicatorWindow.visible, true);
  });
});

test('開始後立即停止，載入晚到的圖示不能再次冒出', async () => {
  let finishLoad;
  const loading = new Promise(resolve => { finishLoad = resolve; });
  await withHarness(async h => {
    h.manager.showTypelessIndicator();
    h.manager.showTypelessIndicator();
    assert.equal(h.windows.length, 1);
    assert.equal(h.windows[0].visible, false);
    h.manager.hideTypelessIndicator();
    finishLoad();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.windows[0].visible, false);
  }, { load: () => loading });
});

test('首次載入失敗會回報並清除視窗，下一次開始可重新載入', async () => {
  let fail = true;
  await withHarness(async h => {
    h.manager.showTypelessIndicator();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.manager.typelessIndicatorWindow, null);
    assert.equal(h.windows[0].destroyed, true);
    assert.equal(h.errors.length, 1);
    fail = false;
    h.manager.showTypelessIndicator();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.windows.length, 2);
    assert.equal(h.windows[1].visible, true);
  }, { load: async () => { if (fail) throw new Error('fixture load failure'); } });
});

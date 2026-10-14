const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');
function fixture(platform = 'darwin') {
  let now = 0, visible = true, showResolve;
  const calls = [], timers = new Map(); let timerId = 0;
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); }
    async loadFile() {}
    isDestroyed() { return false; }
    isVisible() { return visible; }
    hide() { visible = false; this.emit('hide'); }
    show() { visible = true; this.emit('show'); }
    setOpacity() {}
  }
  const dock = { isVisible: () => calls.at(-1)?.[0] === 'show', hide: () => calls.push(['hide', now]), show: () => { calls.push(['show', now]); return new Promise(resolve => { showResolve = resolve; }); } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve('src/helpers/windowManager.js'), 'utf8'), {
    module, __dirname: path.resolve('src/helpers'), process: { platform, env: {} },
    require: name => name === 'electron' ? { BrowserWindow: Window, app: { dock }, screen: { on() {} } } : name === 'node:perf_hooks' ? { performance: { now: () => now } } : name === './indicatorPlacement' ? require('../src/helpers/indicatorPlacement') : require(name),
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, at: now + ms }); return timerId; },
    clearTimeout: id => timers.delete(id), console,
  });
  const manager = new module.exports({ getSetting: (_, fallback) => fallback }, { info() {}, error: () => assert.fail('Dock update failed') });
  manager._healMainBounds = () => {};
  return { manager, calls, timers, resolveShow: () => showResolve?.(), tick: async ms => {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    await Promise.resolve();
  } };
}
test('macOS close keeps the main window alive, hides Dock, and reopening restores Dock', async () => {
  const f = fixture(); const win = await f.manager.createMainWindow();
  let prevented = false; win.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(win.isVisible(), false);
  assert.equal(f.manager.mainWindow, win); assert.equal(f.calls.at(-1)[0], 'hide');
  win.show(); assert.equal(f.calls.at(-1)[0], 'show');
});
test('rapid close/reopen cancels pending hides and late Dock show cannot leave a hidden panel in Dock', async () => {
  const f = fixture(); const win = await f.manager.createMainWindow();
  win.hide(); win.show(); await f.tick(100); win.hide();
  assert.equal(f.timers.size, 1); assert.equal(f.calls.filter(x => x[0] === 'hide').length, 1);
  f.resolveShow(); await f.tick(0);
  await f.tick(1000); assert.equal(f.calls.at(-1)[0], 'hide');
  win.show(); await f.tick(100); win.hide(); win.show();
  await f.tick(1200); assert.equal(f.calls.at(-1)[0], 'show'); assert.equal(f.timers.size, 0);
});
test('Windows/Linux do not touch Dock; genuine quit does not intercept close', async () => {
  const f = fixture('win32'); const win = await f.manager.createMainWindow();
  win.hide(); win.show(); assert.equal(f.calls.length, 0);
  f.manager.isQuitting = true;
  win.emit('close', { preventDefault: () => assert.fail('Quit intercepted') });
});

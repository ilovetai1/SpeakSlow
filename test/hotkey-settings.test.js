const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function createHotkeyHarness() {
  const handlers = new Map();
  const registeredAccelerators = new Map();
  const electron = {
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    BrowserWindow: {
      getAllWindows: () => [],
    },
    globalShortcut: {
      register(accelerator, callback) {
        if (registeredAccelerators.has(accelerator)) return false;
        registeredAccelerators.set(accelerator, callback);
        return true;
      },
      unregister(accelerator) {
        registeredAccelerators.delete(accelerator);
      },
      unregisterAll() {
        registeredAccelerators.clear();
      },
    },
  };

  const originalLoad = Module._load;
  Module._load = function loadWithElectronBoundary(request, parent, isMain) {
    if (request === "electron") return electron;
    return originalLoad.call(this, request, parent, isMain);
  };

  let HotkeyManager;
  let registerHotkeyHandlers;
  try {
    const hotkeyManagerPath = require.resolve("../src/helpers/hotkeyManager");
    const hotkeyHandlersPath = require.resolve("../src/helpers/ipc/hotkeys");
    delete require.cache[hotkeyManagerPath];
    delete require.cache[hotkeyHandlersPath];
    HotkeyManager = require(hotkeyManagerPath);
    registerHotkeyHandlers = require(hotkeyHandlersPath);
  } finally {
    Module._load = originalLoad;
  }

  const savedSettings = new Map();
  const databaseManager = {
    getSetting(key, defaultValue) {
      return savedSettings.has(key) ? savedSettings.get(key) : defaultValue;
    },
    setSetting(key, value) {
      savedSettings.set(key, value);
    },
  };

  const hotkeyManager = new HotkeyManager();
  const logger = { info() {}, warn() {}, error() {} };
  const typelessCalls = [];
  const typelessManager = {
    isEnabled: true,
    isKeyDown: false,
    setTriggerById() {},
    setCallbacks() {},
    enable() {
      typelessCalls.push("enable");
      this.isEnabled = true;
    },
    disable() {
      typelessCalls.push("disable");
      this.isEnabled = false;
    },
    syncActiveState() {},
    setHotkey() {},
  };
  const ctx = {
    databaseManager,
    hotkeyManager,
    typelessManager,
    clipboardManager: { saveForegroundWindow() {} },
    windowManager: { mainWindow: null },
    f2RegisteredSenders: new Set(),
    logger,
  };
  registerHotkeyHandlers(ctx);

  return { handlers, hotkeyManager, registeredAccelerators, typelessCalls, typelessManager };
}

test("關閉「複製上次結果」會立即釋放快捷鍵，重新初始化後仍保持關閉", async () => {
  const { handlers, hotkeyManager, registeredAccelerators } = createHotkeyHarness();

  await handlers.get("init-custom-hotkeys")();
  assert.equal(registeredAccelerators.has("CommandOrControl+Shift+C"), true);

  const disabled = await handlers.get("set-hotkey-enabled")(null, "copy-last", false);
  assert.deepEqual(disabled, { success: true, enabled: false });
  assert.equal(registeredAccelerators.has("CommandOrControl+Shift+C"), false);

  hotkeyManager.unregisterAllHotkeys();
  await handlers.get("init-custom-hotkeys")();

  assert.equal(registeredAccelerators.has("CommandOrControl+Shift+C"), false);
  const settings = await handlers.get("get-hotkey-settings")();
  assert.equal(settings.enabled["copy-last"], false);

  const reenabled = await handlers.get("set-hotkey-enabled")(null, "copy-last", true);
  assert.deepEqual(reenabled, { success: true, enabled: true });
  assert.equal(registeredAccelerators.has("CommandOrControl+Shift+C"), true);
});

test("關閉 TypeLess 後，主視窗重新初始化不會把它強制開啟", async () => {
  const { handlers, typelessCalls, typelessManager } = createHotkeyHarness();

  const disabled = await handlers.get("set-hotkey-enabled")(null, "typeless-recording", false);
  assert.deepEqual(disabled, { success: true, enabled: false });
  assert.equal(typelessManager.isEnabled, false);

  const initialized = await handlers.get("enable-typeless-mode")(null, "AltRight");

  assert.deepEqual(initialized, { success: true, enabled: false });
  assert.equal(typelessManager.isEnabled, false);
  assert.equal(typelessCalls.includes("enable"), false);

  const reenabled = await handlers.get("set-hotkey-enabled")(null, "typeless-recording", true);
  assert.deepEqual(reenabled, { success: true, enabled: true });
  assert.equal(typelessManager.isEnabled, true);
});

test("重設快捷鍵組合不會重新啟用已關閉的「複製上次結果」", async () => {
  const { handlers, registeredAccelerators } = createHotkeyHarness();

  await handlers.get("init-custom-hotkeys")();
  await handlers.get("set-hotkey-enabled")(null, "copy-last", false);
  const reset = await handlers.get("reset-hotkeys")(null, null);

  assert.equal(reset.success, true);
  assert.equal(reset.enabled["copy-last"], false);
  assert.equal(registeredAccelerators.has("CommandOrControl+Shift+C"), false);
});

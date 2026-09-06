const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function loadClipboardManager() {
  const originalLoad = Module._load;
  Module._load = function mockElectron(request, parent, isMain) {
    if (request === "electron") {
      return { clipboard: { readText: () => "", writeText() {} } };
    }
    if (request === "osascript") return {};
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const modulePath = require.resolve("../src/helpers/clipboard");
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("完成時貼到目前游標，不恢復錄音開始時保存的 macOS app", async () => {
  const ClipboardManager = loadClipboardManager();
  const manager = new ClipboardManager({ info() {} });
  manager.previousMacForegroundApp = { bundleId: "recording.start.app" };
  let restoreCalls = 0;
  let pasteCalls = 0;
  manager.restoreMacOSForegroundApp = async () => { restoreCalls += 1; return { success: true }; };
  manager.sendMacOSPaste = async () => { pasteCalls += 1; };

  await manager.pasteMacOS("original clipboard", { restoreFocus: false });

  assert.equal(restoreCalls, 0);
  assert.equal(pasteCalls, 1);
});

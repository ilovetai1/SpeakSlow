const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const esbuild = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dependenciesChanged(previous, next) {
  if (!previous || !next || previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

function createHookRuntime(renderHook) {
  const stateSlots = [];
  const refSlots = [];
  const callbackSlots = [];
  const effectSlots = [];
  let cursor = 0;
  let dirty = false;
  let current;
  let pendingEffects = [];

  const react = {
    useState(initialValue) {
      const index = cursor++;
      if (!(index in stateSlots)) {
        stateSlots[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      }
      const setState = (nextValue) => {
        const resolved = typeof nextValue === "function" ? nextValue(stateSlots[index]) : nextValue;
        if (!Object.is(resolved, stateSlots[index])) {
          stateSlots[index] = resolved;
          dirty = true;
        }
      };
      return [stateSlots[index], setState];
    },
    useRef(initialValue) {
      const index = cursor++;
      if (!(index in refSlots)) refSlots[index] = { current: initialValue };
      return refSlots[index];
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      const previous = callbackSlots[index];
      if (!previous || dependenciesChanged(previous.dependencies, dependencies)) {
        callbackSlots[index] = { callback, dependencies };
      }
      return callbackSlots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = effectSlots[index];
      if (!previous || dependenciesChanged(previous.dependencies, dependencies)) {
        pendingEffects.push({ index, effect, dependencies });
      }
    },
  };

  function render() {
    cursor = 0;
    pendingEffects = [];
    current = renderHook();
    for (const pending of pendingEffects) {
      effectSlots[pending.index]?.cleanup?.();
      const cleanup = pending.effect();
      effectSlots[pending.index] = {
        dependencies: pending.dependencies,
        cleanup: typeof cleanup === "function" ? cleanup : null,
      };
    }
    dirty = false;
  }

  async function flush() {
    for (let attempt = 0; attempt < 12; attempt++) {
      await Promise.resolve();
      if (dirty) render();
      await Promise.resolve();
      if (!dirty) return;
    }
    throw new Error("hook 狀態在 12 次刷新後仍未穩定");
  }

  render();
  return {
    react,
    flush,
    rerender: render,
    get current() {
      return current;
    },
  };
}

async function bundleHook(relativeEntry, exportName, runtime, virtualModules = {}) {
  globalThis.__SPEAKSLOW_REACT_TEST__ = runtime.react;
  globalThis.__SPEAKSLOW_VIRTUAL_MODULES__ = virtualModules;

  const result = await esbuild.build({
    entryPoints: [path.join(projectRoot, relativeEntry)],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    plugins: [{
      name: "speakslow-hook-test-mocks",
      setup(build) {
        build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "speakslow-test" }));
        build.onResolve({ filter: /(^|\/)i18n$/ }, () => ({ path: "i18n", namespace: "speakslow-test" }));
        build.onResolve({ filter: /useModelStatus$/ }, () => ({ path: "useModelStatus", namespace: "speakslow-test" }));
        build.onLoad({ filter: /.*/, namespace: "speakslow-test" }, ({ path: virtualPath }) => {
          if (virtualPath === "react") {
            return { contents: "module.exports = globalThis.__SPEAKSLOW_REACT_TEST__;", loader: "js" };
          }
          if (virtualPath === "i18n") {
            return {
              contents: `
                const t = (key, values) => values?.error || key;
                module.exports = {
                  convertText: (value) => value,
                  useTranslation: () => ({ t }),
                };
              `,
              loader: "js",
            };
          }
          return {
            contents: "module.exports = { useModelStatus: () => globalThis.__SPEAKSLOW_VIRTUAL_MODULES__.modelStatus };",
            loader: "js",
          };
        });
      },
    }],
  });

  const compiled = result.outputFiles[0].text;
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", compiled)(loadedModule, loadedModule.exports, require);
  return loadedModule.exports[exportName];
}

function installBrowserFakes(getUserMedia) {
  const descriptors = new Map();
  const replace = (key, value) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };

  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.state = "running";
      this.destination = {};
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      return { connect() {}, disconnect() {}, onaudioprocess: null };
    }
    async close() {}
    async resume() {}
  }

  const electronAPI = {
    getSetting: async (_key, defaultValue) => defaultValue,
    recoveryBegin() {},
    recoveryEnd() {},
    recoveryAppend() {},
    precogAbort() {},
    log() {},
    streamingStart: async () => ({ success: true }),
    streamingFeed: async () => ({ success: true }),
    streamingEnd: async () => ({ success: true, final_text: "" }),
  };

  replace("navigator", {
    permissions: { query: async () => ({ state: "granted", onchange: null }) },
    mediaDevices: {
      getUserMedia,
      enumerateDevices: async () => [],
    },
  });
  replace("window", { electronAPI, AudioContext: FakeAudioContext, webkitAudioContext: FakeAudioContext });
  replace("setInterval", () => 1);
  replace("clearInterval", () => {});

  return () => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    delete globalThis.__SPEAKSLOW_REACT_TEST__;
    delete globalThis.__SPEAKSLOW_VIRTUAL_MODULES__;
  };
}

function createFakeStream() {
  const track = {
    stopCalls: 0,
    label: "Test microphone",
    stop() { this.stopCalls++; },
    getSettings: () => ({ sampleRate: 48000 }),
  };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    },
  };
}

test("一般錄音：啟動尚未完成就取消，遲到的麥克風串流仍必須停止", async () => {
  const media = createFakeStream();
  const pendingStream = deferred();
  const getUserMediaStarted = deferred();
  const restore = installBrowserFakes(() => {
    getUserMediaStarted.resolve();
    return pendingStream.promise;
  });
  try {
    let hook = () => ({});
    const runtime = createHookRuntime(() => hook({ isReady: true, isLoading: false, error: null }));
    hook = await bundleHook("src/hooks/useRecording.js", "useRecording", runtime);
    runtime.rerender();
    await runtime.flush();
    const startPromise = runtime.current.startRecording();
    await runtime.flush();
    assert.equal(runtime.current.isRecording, true);
    await getUserMediaStarted.promise;

    runtime.current.cancelRecording();
    await runtime.flush();
    assert.equal(runtime.current.isRecording, false);

    pendingStream.resolve(media.stream);
    await startPromise;
    await runtime.flush();
    assert.equal(media.track.stopCalls, 1, "取消後才抵達的 track 必須立即 stop，否則 macOS 綠點會殘留");
  } finally {
    restore();
  }
});

test("一般錄音：啟動尚未完成就按第二次停止，遲到串流仍必須停止", async () => {
  const media = createFakeStream();
  const pendingStream = deferred();
  const getUserMediaStarted = deferred();
  const restore = installBrowserFakes(() => {
    getUserMediaStarted.resolve();
    return pendingStream.promise;
  });
  try {
    let hook = () => ({});
    const runtime = createHookRuntime(() => hook({ isReady: true, isLoading: false, error: null }));
    hook = await bundleHook("src/hooks/useRecording.js", "useRecording", runtime);
    runtime.rerender();
    await runtime.flush();

    const startPromise = runtime.current.startRecording();
    await runtime.flush();
    await getUserMediaStarted.promise;
    await runtime.current.stopRecording();
    await runtime.flush();

    pendingStream.resolve(media.stream);
    await startPromise;
    await runtime.flush();
    assert.equal(runtime.current.isRecording, false);
    assert.equal(runtime.current.error, null, "停止 pending start 不應被誤報成空錄音處理失敗");
    assert.equal(media.track.stopCalls, 1, "停止後才抵達的 track 必須立即 stop");
  } finally {
    restore();
  }
});

test("串流錄音：啟動尚未完成就取消，必須停止遲到串流並結束初始化提示", async () => {
  const media = createFakeStream();
  const pendingStream = deferred();
  const getUserMediaStarted = deferred();
  const restore = installBrowserFakes(() => {
    getUserMediaStarted.resolve();
    return pendingStream.promise;
  });
  try {
    let hook = () => ({});
    const bootstrapRuntime = createHookRuntime(() => hook());
    hook = await bundleHook(
      "src/hooks/useStreamingRecording.js",
      "useStreamingRecording",
      bootstrapRuntime,
      { modelStatus: { isReady: true, isLoading: false } }
    );
    bootstrapRuntime.rerender();
    await bootstrapRuntime.flush();

    const startPromise = bootstrapRuntime.current.startStreaming();
    await bootstrapRuntime.flush();
    assert.equal(bootstrapRuntime.current.isRecording, true);
    assert.equal(bootstrapRuntime.current.isInitializing, true);
    await getUserMediaStarted.promise;

    bootstrapRuntime.current.cancelStreaming();
    await bootstrapRuntime.flush();
    assert.equal(bootstrapRuntime.current.isRecording, false);
    assert.equal(bootstrapRuntime.current.isInitializing, false, "取消後不能留下看似消失或卡住的初始化提示");

    pendingStream.resolve(media.stream);
    await startPromise;
    await bootstrapRuntime.flush();
    assert.equal(media.track.stopCalls, 1, "取消後才抵達的串流 track 必須立即 stop");
  } finally {
    restore();
  }
});

test("串流錄音：啟動尚未完成就按停止，必須停止遲到串流", async () => {
  const media = createFakeStream();
  const pendingStream = deferred();
  const getUserMediaStarted = deferred();
  const restore = installBrowserFakes(() => {
    getUserMediaStarted.resolve();
    return pendingStream.promise;
  });
  try {
    let hook = () => ({});
    const runtime = createHookRuntime(() => hook());
    hook = await bundleHook(
      "src/hooks/useStreamingRecording.js",
      "useStreamingRecording",
      runtime,
      { modelStatus: { isReady: true, isLoading: false } }
    );
    runtime.rerender();
    await runtime.flush();

    const startPromise = runtime.current.startStreaming();
    await runtime.flush();
    await getUserMediaStarted.promise;
    await runtime.current.stopStreaming();
    await runtime.flush();

    pendingStream.resolve(media.stream);
    await startPromise;
    await runtime.flush();
    assert.equal(runtime.current.isRecording, false);
    assert.equal(runtime.current.isInitializing, false);
    assert.equal(media.track.stopCalls, 1, "停止後才抵達的串流 track 必須立即 stop");
  } finally {
    restore();
  }
});

test("權限測試只驗證授權，不得持續占用麥克風", async () => {
  const media = createFakeStream();
  const restore = installBrowserFakes(async () => media.stream);
  try {
    let hook = () => ({});
    const bootstrapRuntime = createHookRuntime(() => hook(() => {}));
    hook = await bundleHook("src/hooks/usePermissions.js", "usePermissions", bootstrapRuntime);
    bootstrapRuntime.rerender();

    await bootstrapRuntime.current.requestMicPermission();
    await bootstrapRuntime.flush();
    assert.equal(media.track.stopCalls, 1, "權限確認完成後必須停止測試串流");
  } finally {
    restore();
  }
});

test("設定視窗關閉到背景時不得留下仍在監測的麥克風 renderer", () => {
  const originalLoad = Module._load;
  const windowManagerPath = path.join(projectRoot, "src/helpers/windowManager.js");
  Module._load = function mockElectron(request, parent, isMain) {
    if (request === "electron") return { BrowserWindow: class BrowserWindow {} };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[windowManagerPath];
    const WindowManager = require(windowManagerPath);
    const manager = new WindowManager();
    let closeCalls = 0;
    let hideCalls = 0;
    manager.settingsWindow = {
      close() { closeCalls++; },
      hide() { hideCalls++; },
    };

    manager.hideSettingsWindow();

    assert.equal(closeCalls, 1, "關閉設定窗應銷毀 renderer，觸發 React cleanup 停止麥克風監測");
    assert.equal(hideCalls, 0, "只 hide 會讓麥克風監測在無可見視窗時繼續執行");
  } finally {
    Module._load = originalLoad;
    delete require.cache[windowManagerPath];
  }
});

test("前景視窗定位失敗時仍要顯示錄音提示", () => {
  const originalLoad = Module._load;
  const windowManagerPath = path.join(projectRoot, "src/helpers/windowManager.js");
  Module._load = function mockElectron(request, parent, isMain) {
    if (request === "electron") return { BrowserWindow: class BrowserWindow {} };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[windowManagerPath];
    const WindowManager = require(windowManagerPath);
    const manager = new WindowManager();
    let showCalls = 0;
    let positionCalls = 0;
    manager.typelessIndicatorWindow = {
      isDestroyed: () => false,
      setPosition() { positionCalls++; },
      showInactive() { showCalls++; },
      webContents: { send() {} },
    };
    manager._typelessIndicatorPositioner = {
      requestShow(apply) { apply(null); },
      notifyHidden() {},
    };

    manager.showTypelessIndicator();

    assert.equal(positionCalls, 0, "定位失敗時不應套用錯誤座標");
    assert.equal(showCalls, 1, "定位失敗只能影響位置，不能略過錄音提示");
  } finally {
    Module._load = originalLoad;
    delete require.cache[windowManagerPath];
  }
});

test("任何實際錄音來源仍在工作時，錄音提示都必須保持顯示", async () => {
  const { resolveRecordingUiState } = await import("../src/utils/recordingUiState.mjs");
  const state = resolveRecordingUiState({
    streamingMode: true,
    isRecordingNormal: true,
    isRecordingStreaming: false,
    isProcessingNormal: false,
    isProcessingStreaming: false,
    errorNormal: null,
    errorStreaming: null,
  });

  assert.equal(
    state.isRecording,
    true,
    "TypeLess 固定走一般錄音時，即使串流設定開啟也不能讓錄音提示消失"
  );
});

test("TypeLess 停止事件在 React 錄音狀態尚未刷新時也必須送進 hook", () => {
  const appSource = fs.readFileSync(path.join(projectRoot, "src/App.jsx"), "utf8");
  const listenerStart = appSource.indexOf("const unsubscribeStop = window.electronAPI.onTypelessStopRecording");
  const listenerEnd = appSource.indexOf("const unsubscribeCancel", listenerStart);
  assert.notEqual(listenerStart, -1);
  assert.notEqual(listenerEnd, -1);
  const stopListener = appSource.slice(listenerStart, listenerEnd);

  assert.match(stopListener, /stopRecordingNormal\(\)/);
  assert.doesNotMatch(
    stopListener,
    /if\s*\(\s*isRecordingNormal\s*\)/,
    "pending getUserMedia 期間 isRecording 仍可能是 false，不能因此吞掉停止事件"
  );
});

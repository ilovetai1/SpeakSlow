const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseFrontmostWindowResult,
  computeIndicatorPosition,
  createIndicatorPositioner,
} = require("../src/helpers/indicatorPlacement");

const INDICATOR_SIZE = { width: 240, height: 72, marginBottom: 24 };

// =====================================================
// a. parseFrontmostWindowResult
// =====================================================

test("parseFrontmostWindowResult 接受合法輸入", () => {
  const stdout = JSON.stringify({
    name: "Finder",
    bundleId: "com.apple.finder",
    pid: 123,
    x: -224,
    y: -1050,
    width: 800,
    height: 600,
  });
  const result = parseFrontmostWindowResult(stdout);
  assert.deepEqual(result, {
    x: -224,
    y: -1050,
    width: 800,
    height: 600,
    name: "Finder",
    bundleId: "com.apple.finder",
    pid: 123,
  });
});

test("parseFrontmostWindowResult 拒絕非 JSON 亂字串", () => {
  assert.throws(() => parseFrontmostWindowResult("not json at all"), /無法解析|JSON/);
});

test("parseFrontmostWindowResult 拒絕缺欄位的輸入", () => {
  const stdout = JSON.stringify({ x: 0, y: 0, width: 800 }); // 缺 height
  assert.throws(() => parseFrontmostWindowResult(stdout), /height/);
});

test("parseFrontmostWindowResult 拒絕 width=0", () => {
  const stdout = JSON.stringify({ x: 0, y: 0, width: 0, height: 600 });
  assert.throws(() => parseFrontmostWindowResult(stdout), /不合法/);
});

test("parseFrontmostWindowResult 拒絕 height=0", () => {
  const stdout = JSON.stringify({ x: 0, y: 0, width: 800, height: 0 });
  assert.throws(() => parseFrontmostWindowResult(stdout), /不合法/);
});

// =====================================================
// b. computeIndicatorPosition
// =====================================================

test("computeIndicatorPosition：主螢幕 workArea（實機 fixture）", () => {
  // 主螢幕 {bounds:{x:0,y:0,width:1512,height:982}, workArea:{x:0,y:33,width:1512,height:885}}
  const workArea = { x: 0, y: 33, width: 1512, height: 885 };
  const position = computeIndicatorPosition(workArea, INDICATOR_SIZE);
  assert.deepEqual(position, { x: 636, y: 822 });
});

test("computeIndicatorPosition：副螢幕 workArea（實機 fixture，負座標、在主螢幕上方）", () => {
  // 副螢幕 {bounds:{x:-224,y:-1080,width:1920,height:1080}, workArea:{x:-224,y:-1050,width:1920,height:1050}}
  const workArea = { x: -224, y: -1050, width: 1920, height: 1050 };
  const position = computeIndicatorPosition(workArea, INDICATOR_SIZE);
  assert.deepEqual(position, { x: 616, y: -96 });
});

test("computeIndicatorPosition：自編排列，副螢幕在左側、x 為負", () => {
  // 自編：一個 1080p 螢幕擺在主螢幕左側，x 為負、y 與主螢幕對齊
  const workArea = { x: -1920, y: 25, width: 1920, height: 1055 };
  const position = computeIndicatorPosition(workArea, INDICATOR_SIZE);
  // x = -1920 + round((1920-240)/2) = -1920 + 840 = -1080
  // y = 25 + 1055 - 72 - 24 = 984
  assert.deepEqual(position, { x: -1080, y: 984 });
});

// =====================================================
// c/d. createIndicatorPositioner：競態控制
// =====================================================

// 建立一個「可外部控制何時 resolve/reject」的 deferred promise，模擬慢/快到達的 getFrontmostBounds()。
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("positioner：連續兩次 requestShow，慢的舊結果後到 → 只套用新結果", async () => {
  const deferreds = [];
  const positioner = createIndicatorPositioner({
    getFrontmostBounds: () => {
      const d = deferred();
      deferreds.push(d);
      return d.promise;
    },
    getDisplayMatching: (bounds) => ({ workArea: { x: 0, y: 0, width: 1000, height: 1000 } }),
    logError: () => {},
  });

  const applied = [];
  positioner.requestShow((position) => applied.push({ call: 1, position })); // 慢的第一次
  positioner.requestShow((position) => applied.push({ call: 2, position })); // 快的第二次

  assert.equal(deferreds.length, 2);

  // 第二次（新）先 resolve，讓它有機會跑完
  deferreds[1].resolve({ x: 0, y: 0, width: 100, height: 100 });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // 第一次（舊）後到
  deferreds[0].resolve({ x: 0, y: 0, width: 100, height: 100 });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(applied.length, 1);
  assert.equal(applied[0].call, 2);
});

test("positioner：requestShow 後呼叫 notifyHidden，結果後到 → 不套用不顯示", async () => {
  const d = deferred();
  const positioner = createIndicatorPositioner({
    getFrontmostBounds: () => d.promise,
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 1000 } }),
    logError: () => {},
  });

  let called = false;
  positioner.requestShow(() => { called = true; });
  positioner.notifyHidden();

  d.resolve({ x: 0, y: 0, width: 100, height: 100 });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(called, false);
});

test("positioner：getFrontmostBounds reject → logError 被呼叫、applyFn 收到 null、無 unhandledRejection", async () => {
  let unhandled = null;
  const onUnhandledRejection = (err) => { unhandled = err; };
  process.on("unhandledRejection", onUnhandledRejection);

  try {
    const errors = [];
    const positioner = createIndicatorPositioner({
      getFrontmostBounds: () => Promise.reject(new Error("no frontmost application")),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 1000 } }),
      logError: (msg) => errors.push(msg),
    });

    let appliedPosition = "not-called";
    positioner.requestShow((position) => { appliedPosition = position; });

    // 讓 microtask queue 跑完
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(errors.length, 1);
    assert.match(errors[0], /無法取得前景視窗位置/);
    assert.equal(appliedPosition, null);
    assert.equal(unhandled, null);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

test("positioner：每次 requestShow 都重新呼叫 getFrontmostBounds（不沿用上次結果）", async () => {
  let callCount = 0;
  const positioner = createIndicatorPositioner({
    getFrontmostBounds: () => {
      callCount++;
      return Promise.resolve({ x: 0, y: 0, width: 100, height: 100 });
    },
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 1000 } }),
    logError: () => {},
  });

  positioner.requestShow(() => {});
  positioner.requestShow(() => {});
  positioner.requestShow(() => {});

  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(callCount, 3);
});

// 缺口 1：getDisplayMatching throw（位置計算失敗分支）→ logError、applyFn 收到 null、無外洩
test("positioner：getDisplayMatching throw → logError、applyFn 收到 null、無 unhandledRejection", async () => {
  let unhandled = null;
  const onUnhandledRejection = (err) => { unhandled = err; };
  process.on("unhandledRejection", onUnhandledRejection);

  try {
    const errors = [];
    const positioner = createIndicatorPositioner({
      getFrontmostBounds: () => Promise.resolve({ x: 0, y: 0, width: 100, height: 100 }),
      getDisplayMatching: () => { throw new Error("screen module boom"); },
      logError: (msg) => errors.push(msg),
    });

    let appliedPosition = "not-called";
    positioner.requestShow((position) => { appliedPosition = position; });

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(errors.length, 1);
    assert.match(errors[0], /計算指示器位置失敗/);
    assert.equal(appliedPosition, null);
    assert.equal(unhandled, null);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

// 缺口 2：applyFn 同步 throw → 被保底 catch 吞掉並 logError，不外洩成 unhandledRejection
test("positioner：applyFn 同步 throw → 被保底 catch 吞掉並 logError、無 unhandledRejection", async () => {
  let unhandled = null;
  const onUnhandledRejection = (err) => { unhandled = err; };
  process.on("unhandledRejection", onUnhandledRejection);

  try {
    const errors = [];
    const positioner = createIndicatorPositioner({
      getFrontmostBounds: () => Promise.resolve({ x: 0, y: 0, width: 100, height: 100 }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 1000 } }),
      logError: (msg) => errors.push(msg),
    });

    positioner.requestShow(() => { throw new Error("applyFn boom"); });

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(errors.length, 1);
    assert.match(errors[0], /positioner 發生未預期錯誤/);
    assert.equal(unhandled, null);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

// 缺口 3：成功路徑座標斷言（實機副螢幕 fixture）
test("positioner：成功路徑套用實機副螢幕 fixture → applyFn 收到 {x:616, y:-96}", async () => {
  const positioner = createIndicatorPositioner({
    // 前景視窗落在副螢幕（負座標、在主螢幕上方）
    getFrontmostBounds: () => Promise.resolve({ x: -224, y: -1080, width: 1920, height: 1080 }),
    // getDisplayMatching 回傳該副螢幕的 workArea（實機 fixture）
    getDisplayMatching: () => ({ workArea: { x: -224, y: -1050, width: 1920, height: 1050 } }),
    logError: () => {},
  });

  let applied = "not-called";
  positioner.requestShow((position) => { applied = position; });

  await new Promise((resolve) => setTimeout(resolve, 10));

  // x = -224 + round((1920-240)/2) = -224 + 840 = 616
  // y = -1050 + 1050 - 72 - 24 = -96
  assert.deepEqual(applied, { x: 616, y: -96 });
});

// 缺口 4：parseFrontmostWindowResult 對 height=NaN、x=Infinity、空字串三案例皆 throw
test("parseFrontmostWindowResult 拒絕 height=NaN / x=Infinity / 空字串（三案例皆 throw）", () => {
  // NaN / Infinity 不是合法 JSON token → JSON.parse 失敗 → 走「無法解析」分支
  assert.throws(
    () => parseFrontmostWindowResult('{"x":0,"y":0,"width":800,"height":NaN}'),
    /無法解析|JSON/
  );
  assert.throws(
    () => parseFrontmostWindowResult('{"x":Infinity,"y":0,"width":800,"height":600}'),
    /無法解析|JSON/
  );
  // 空字串同樣不是合法 JSON
  assert.throws(() => parseFrontmostWindowResult(""), /無法解析|JSON/);
});

// 缺口 5：阻擋 1 回歸——延遲套用前必須複驗序號。
// 模擬 windowManager 冷啟動：requestShow 的回呼把 meta.stillCurrent 存起來（代表「已入隊、
// 但還在等 windowReady」），其後 notifyHidden()（Esc 取消錄音）→ 斷言 stillCurrent() 轉為 false，
// 鎖住「延遲套用前複驗過期 → 不顯示」的合約，防止指示器在錄音取消後才浮現且殘留。
test("positioner：延遲套用前複驗 stillCurrent — notifyHidden 後 meta.stillCurrent() 轉 false（阻擋 1 回歸）", async () => {
  const d = deferred();
  const positioner = createIndicatorPositioner({
    getFrontmostBounds: () => d.promise,
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 1000 } }),
    logError: () => {},
  });

  let capturedStillCurrent = null;
  let currentAtApply = null;
  positioner.requestShow((position, meta) => {
    capturedStillCurrent = meta.stillCurrent; // windowManager 冷啟動會延後到 windowReady 後才真正套用
    currentAtApply = meta.stillCurrent();
  });

  d.resolve({ x: 0, y: 0, width: 100, height: 100 });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // bounds 剛回來、尚未 hidden：序號仍有效
  assert.equal(typeof capturedStillCurrent, "function");
  assert.equal(currentAtApply, true);
  assert.equal(capturedStillCurrent(), true);

  // 使用者 Esc → hideTypelessIndicator → notifyHidden
  positioner.notifyHidden();

  // 延遲套用前複驗 → 過期。windowManager cold-start continuation 據此直接 return，不顯示。
  assert.equal(capturedStillCurrent(), false);
});

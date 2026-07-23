// TypeLess 錄音指示器的定位邏輯（純函式 / 零 electron 依賴，可被 node:test 直接 require）。
//
// 背景：雙螢幕環境下，指示器過去只在視窗「首次建立」時用主螢幕座標算一次位置，
// 之後每次顯示都直接沿用舊位置 → 使用者實際操作在副螢幕時，指示器仍固定出現在
// 主螢幕（看起來像沒出現）。這裡把「每次顯示前重新定位到前景視窗所在螢幕」的
// 邏輯抽成可獨立測試的模組。

// 指示器視窗尺寸與底部留白，windowManager.js 建立視窗時的初始尺寸與這裡的位置
// 計算共用同一組常數，避免兩處各自寫死數字而不同步。
const INDICATOR_WIDTH = 240;
const INDICATOR_HEIGHT = 72;
const INDICATOR_MARGIN_BOTTOM = 24;

// 取得「前景應用程式的最上層一般視窗」bounds 的 JXA 腳本，供 osascript -l JavaScript 執行。
// 注意：ObjC.deepUnwrap(CFMakeCollectable(...)) 會回空物件、$.CFBridgingRelease 會 segfault，
// castRefToObject 是唯一驗證可行的寫法，不要「優化」這段。
const FRONTMOST_WINDOW_JXA = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
function run() {
  const ws = $.NSWorkspace.sharedWorkspace;
  const front = ws.frontmostApplication;
  if (front.isNil()) throw new Error('no frontmost application');
  const pid = front.processIdentifier;
  const name = front.localizedName.js;
  const bundleId = front.bundleIdentifier.isNil() ? '' : front.bundleIdentifier.js;
  const opts = $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements;
  const ns = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(opts, $.kCGNullWindowID));
  if (ns.isNil()) throw new Error('CGWindowListCopyWindowInfo returned null');
  const n = parseInt(ns.count);
  for (let i = 0; i < n; i++) {
    const d = ObjC.deepUnwrap(ns.objectAtIndex(i));
    if (d && d.kCGWindowOwnerPID === pid && d.kCGWindowLayer === 0) {
      const b = d.kCGWindowBounds;
      return JSON.stringify({ name: name, bundleId: bundleId, pid: pid,
        x: b.X, y: b.Y, width: b.Width, height: b.Height });
    }
  }
  throw new Error('frontmost app "' + name + '" (pid ' + pid + ') has no layer-0 on-screen window');
}
`;

// 供錯誤訊息使用：把任意輸入截斷成一行摘要，避免把整段輸出灌進錯誤訊息。
function summarize(input) {
  const str = typeof input === "string" ? input : String(input);
  const oneLine = str.replace(/\s+/g, " ").trim();
  return oneLine.length > 200 ? oneLine.slice(0, 200) + "…" : oneLine;
}

// 解析 FRONTMOST_WINDOW_JXA 的 stdout（JSON 字串）。不合法就 throw，訊息附原始輸入摘要。
function parseFrontmostWindowResult(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      "無法解析前景視窗位置（非合法 JSON）：" + summarize(stdout) + "；" + err.message
    );
  }

  if (!data || typeof data !== "object") {
    throw new Error("前景視窗位置格式錯誤（非物件）：" + summarize(stdout));
  }

  const { x, y, width, height } = data;
  for (const [key, value] of Object.entries({ x, y, width, height })) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        "前景視窗位置缺少或非法欄位「" + key + "」：" + summarize(stdout)
      );
    }
  }
  if (width <= 0 || height <= 0) {
    throw new Error(
      "前景視窗尺寸不合法（width=" + width + ", height=" + height + "）：" + summarize(stdout)
    );
  }

  return { x, y, width, height, name: data.name, bundleId: data.bundleId, pid: data.pid };
}

// 依「目前螢幕的 workArea」與「指示器尺寸」算出指示器左上角座標：
// 水平置中、貼齊 workArea 底部（扣掉 marginBottom）。
function computeIndicatorPosition(workArea, { width, height, marginBottom }) {
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - marginBottom,
  };
}

function describeError(err) {
  if (!err) return String(err);
  return err.message || String(err);
}

// 封裝「每次顯示前重新定位」的完整流程與競態控制。
//
// deps:
//   - getFrontmostBounds(): Promise<{x,y,width,height}>  取得前景視窗 bounds（每次都重新呼叫，絕不沿用上次結果）
//   - getDisplayMatching(bounds): {workArea}              依 bounds 選出對應螢幕
//   - logError(message): void                             記錄失敗原因（不得拋出、拋出也會被吞掉）
//
// 回傳 { requestShow, notifyHidden }：
//   - requestShow(applyFn): 每次呼叫遞增序號並重新取得前景 bounds；結果回來時若序號已過期
//     （其後又呼叫過 requestShow 或 notifyHidden）就直接丟棄，不呼叫 applyFn。
//     成功 → applyFn({x, y}, meta)；失敗 → logError(...) 後 applyFn(null, meta)（= 不重定位、照樣顯示）。
//     meta 一律帶 stillCurrent()：回傳「此請求序號至今是否仍有效」（其後未再被 requestShow /
//     notifyHidden 取代）。呼叫端若在 applyFn 之後還要「延遲套用」（例如等視窗 loadFile 完成才
//     顯示），必須在真正套用前再呼叫一次 meta.stillCurrent() 複驗，過期就放棄——因為序號的
//     過期檢查只在 bounds settle 當下做一次，無法涵蓋 applyFn 之後的等待期。
//     嚴禁任何游標位置或主螢幕 fallback 定位；任何路徑都不會讓 rejection 外洩。
//   - notifyHidden(): 讓所有仍在途的 requestShow 結果作廢（視窗已隱藏，不該再套用/顯示）。
function createIndicatorPositioner(deps) {
  const { getFrontmostBounds, getDisplayMatching, logError } = deps;
  let seq = 0;

  function requestShow(applyFn) {
    const mySeq = ++seq;

    // 供呼叫端在「延遲套用」前複驗序號用（閉包捕捉 mySeq）：一旦其後又呼叫過
    // requestShow 或 notifyHidden，seq 就會遞增，stillCurrent() 隨即轉為 false。
    const stillCurrent = () => mySeq === seq;

    // 立即（同一個 tick 內）重新呼叫 getFrontmostBounds，絕不沿用上次結果。
    // 用 try/catch 包一層是防禦性寫法：即使 deps.getFrontmostBounds 沒遵守「一定回 Promise」
    // 的約定、同步拋了例外，也要轉成 rejection 走同一條錯誤處理路徑，不讓例外同步外洩。
    let boundsPromise;
    try {
      boundsPromise = Promise.resolve(getFrontmostBounds());
    } catch (err) {
      boundsPromise = Promise.reject(err);
    }

    boundsPromise
      .then(
        (bounds) => {
          if (mySeq !== seq) return; // 序號已過期（被新的 requestShow 或 notifyHidden 取代），丟棄

          let position;
          try {
            const display = getDisplayMatching(bounds);
            position = computeIndicatorPosition(display.workArea, {
              width: INDICATOR_WIDTH,
              height: INDICATOR_HEIGHT,
              marginBottom: INDICATOR_MARGIN_BOTTOM,
            });
          } catch (err) {
            logError("[typeless-indicator] 計算指示器位置失敗：" + describeError(err));
            applyFn(null, { bounds, error: err, stillCurrent });
            return;
          }
          applyFn(position, { bounds, stillCurrent });
        },
        (err) => {
          if (mySeq !== seq) return; // 過期的失敗結果同樣丟棄，不套用、不顯示
          logError("[typeless-indicator] 無法取得前景視窗位置：" + describeError(err));
          applyFn(null, { error: err, stillCurrent });
        }
      )
      .catch((err) => {
        // 保底：理論上不會走到這裡（上面兩條分支各自處理成功/失敗），
        // 但無論如何都不准讓 rejection 外洩成 unhandledRejection（例如 applyFn 本身拋出）。
        try {
          logError("[typeless-indicator] positioner 發生未預期錯誤：" + describeError(err));
        } catch (e) { /* ignore */ }
      });
  }

  function notifyHidden() {
    seq++; // 任何仍在途的 requestShow 結果回來時都會發現序號過期
  }

  return { requestShow, notifyHidden };
}

module.exports = {
  INDICATOR_WIDTH,
  INDICATOR_HEIGHT,
  INDICATOR_MARGIN_BOTTOM,
  FRONTMOST_WINDOW_JXA,
  parseFrontmostWindowResult,
  computeIndicatorPosition,
  createIndicatorPositioner,
};

// 錄音圖示以滑鼠所在螢幕為準；Electron cursor 與 workArea 均為 DIP 座標。
const INDICATOR_WIDTH = 240;
const INDICATOR_HEIGHT = 72;
const INDICATOR_MARGIN_BOTTOM = 24;
const CURSOR_POLL_INTERVAL_MS = 250;

function computeIndicatorPosition(workArea, { width, height, marginBottom }) {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(workArea?.[key])) throw new Error(`螢幕工作區 ${key} 無效`);
  }
  if (workArea.width <= 0 || workArea.height <= 0) throw new Error('螢幕工作區尺寸無效');
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - marginBottom,
  };
}

// 只在錄音顯示期間查詢滑鼠；同螢幕內移動不重排視窗。
// 每次位置更新都有獨立序號，避免載入中的舊位置在跨螢幕／停止後才套用。
function createIndicatorPositioner({ getCursorScreenPoint, getDisplayNearestPoint, logError }) {
  let generation = 0;
  let timer = null;

  function notifyHidden() {
    ++generation;
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function requestShow(applyFn) {
    notifyHidden();
    const requestGeneration = generation;
    let revision = 0;
    let lastPlacement = null;
    const fail = error => {
      if (requestGeneration !== generation) return;
      notifyHidden();
      logError(`錄音圖示無法定位到滑鼠螢幕：${error.message}`);
    };
    const update = () => {
      if (requestGeneration !== generation) return;
      try {
        const cursor = getCursorScreenPoint();
        if (!Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) {
          throw new Error('滑鼠座標無效');
        }
        const display = getDisplayNearestPoint(cursor);
        const position = computeIndicatorPosition(display?.workArea, {
          width: INDICATOR_WIDTH,
          height: INDICATOR_HEIGHT,
          marginBottom: INDICATOR_MARGIN_BOTTOM,
        });
        if (lastPlacement?.id === display.id &&
            lastPlacement.x === position.x && lastPlacement.y === position.y) return;
        lastPlacement = { id: display.id, ...position };
        const currentRevision = ++revision;
        const stillCurrent = () => requestGeneration === generation && currentRevision === revision;
        Promise.resolve(applyFn(position, { cursor, displayId: display.id, stillCurrent }))
          .catch(error => { if (stillCurrent()) fail(error); });
      } catch (error) {
        fail(error);
      }
    };
    update();
    if (requestGeneration === generation) timer = setInterval(update, CURSOR_POLL_INTERVAL_MS);
  }

  return { requestShow, notifyHidden };
}

module.exports = {
  INDICATOR_WIDTH,
  INDICATOR_HEIGHT,
  INDICATOR_MARGIN_BOTTOM,
  CURSOR_POLL_INTERVAL_MS,
  computeIndicatorPosition,
  createIndicatorPositioner,
};

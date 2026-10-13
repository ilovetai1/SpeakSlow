const assert = require('node:assert/strict');
const test = require('node:test');
const { computeIndicatorPosition, createIndicatorPositioner, CURSOR_POLL_INTERVAL_MS } = require('../src/helpers/indicatorPlacement');
const INDICATOR_SIZE = { width: 240, height: 72, marginBottom: 24 };

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


function fixture(t) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let point = { x: 20, y: 30 };
  let area = { x: 0, y: 33, width: 1512, height: 885 };
  const errors = [];
  const calls = [];
  let reads = 0;
  const positioner = createIndicatorPositioner({
    getCursorScreenPoint: () => { reads++; return point; },
    getDisplayNearestPoint: () => ({ id: 1, workArea: area }),
    logError: message => errors.push(message),
  });
  t.after(() => positioner.notifyHidden());
  return {
    positioner, errors, calls,
    setPoint: value => { point = value; },
    setArea: value => { area = value; },
    reads: () => reads,
    show: () => positioner.requestShow((position, meta) => calls.push({ position, meta })),
    tick: () => t.mock.timers.tick(CURSOR_POLL_INTERVAL_MS),
  };
}

test('同螢幕內滑鼠移動不重排圖示，螢幕工作區變更會重新定位', t => {
  const h = fixture(t);
  h.show();
  h.setPoint({ x: 100, y: 200 }); h.tick();
  assert.equal(h.calls.length, 1);
  h.setArea({ x: 0, y: 0, width: 1920, height: 1080 }); h.tick();
  assert.deepEqual(h.calls.at(-1).position, { x: 840, y: 984 });
});

test('跨螢幕時舊的待載入座標失效，只有最新座標可套用', t => {
  const h = fixture(t);
  h.show();
  const first = h.calls[0].meta;
  h.setArea({ x: -1920, y: 0, width: 1920, height: 1080 }); h.tick();
  assert.equal(first.stillCurrent(), false);
  assert.equal(h.calls[1].meta.stillCurrent(), true);
  h.positioner.notifyHidden();
  assert.equal(h.calls[1].meta.stillCurrent(), false);
});

test('停止後不再讀取滑鼠，連續開始不會累積計時器', t => {
  const h = fixture(t);
  h.show(); h.show();
  assert.equal(h.calls[0].meta.stillCurrent(), false);
  const reads = h.reads();
  h.tick();
  assert.equal(h.reads(), reads + 1);
  h.positioner.notifyHidden(); h.tick(); h.tick();
  assert.equal(h.reads(), reads + 1);
});

test('無效滑鼠座標會回報錯誤，不顯示在預設螢幕也不持續查詢', t => {
  const h = fixture(t);
  h.setPoint({ x: NaN, y: 10 });
  h.show(); h.tick();
  assert.equal(h.calls.length, 0);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /滑鼠座標無效/);
  assert.equal(h.reads(), 1);
});

test('無效工作區會回報錯誤，不沿用舊位置', t => {
  const h = fixture(t);
  h.show();
  h.setArea({ x: 0, y: 0, width: 0, height: 900 }); h.tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].meta.stillCurrent(), false);
  assert.match(h.errors[0], /工作區尺寸無效/);
});

test('位置套用失敗會回報錯誤並停止查詢', async t => {
  const h = fixture(t);
  h.positioner.requestShow(async () => { throw new Error('window moved failure'); });
  await new Promise(resolve => setImmediate(resolve));
  h.tick();
  assert.equal(h.reads(), 1);
  assert.match(h.errors[0], /window moved failure/);
});

test('已過期的非同步套用失敗不影響新錄音', async t => {
  const h = fixture(t);
  let reject;
  h.positioner.requestShow(() => new Promise((_resolve, fail) => { reject = fail; }));
  h.show();
  reject(new Error('old recording failure'));
  await new Promise(resolve => setImmediate(resolve));
  h.tick();
  assert.equal(h.errors.length, 0);
  assert.equal(h.calls[0].meta.stillCurrent(), true);
});

test('100 次位置變化都採用最新螢幕工作區', t => {
  const h = fixture(t);
  h.show();
  for (let i = 1; i <= 100; i++) {
    h.setArea({ x: -1920 * i, y: -1080, width: 1920, height: 1080 }); h.tick();
    assert.deepEqual(h.calls.at(-1).position, { x: -1920 * i + 840, y: -96 });
  }
  assert.equal(h.calls.length, 101);
});

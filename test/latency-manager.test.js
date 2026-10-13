const test = require('node:test');
const assert = require('node:assert/strict');
const { LatencyManager, percentile } = require('../src/helpers/latencyManager');
function fixture() {
  let now = 0, wall = 1000; const settings = new Map();
  const db = { getSetting: (k, v) => settings.has(k) ? settings.get(k) : v, setSetting: (k, v) => settings.set(k, structuredClone(v)) };
  return { m: new LatencyManager(db, { clock: () => now, wallClock: () => wall }), settings, tick: n => { now += n; }, age: n => { wall += n; } };
}
test('nearest rank, partial outcomes and clock origins do not fabricate zero samples', () => {
  const f = fixture(); f.m.noteHotkey(); f.tick(8); const id = f.m.start('offline'); f.tick(12);
  f.m.record(id, 'capture', 'success', 5); f.m.record(id, 'asr', 'failed', 25);
  assert.equal(f.m.record(id, 'capture', 'success', 999), false); f.m.finish(id, 'missing');
  const stats = f.m.stats().groups;
  assert.equal(stats.find(x => x.stage === 'hotkey_to_capture_ready').p50, 20);
  assert.equal(stats.find(x => x.stage === 'asr').p95, null);
  assert.equal(stats.find(x => x.stage === 'polish').counts.missing, 1);
  assert.equal(percentile(Array.from({ length: 30 }, (_, i) => i + 1), .95), 29);
});
test('disable and clear invalidate callbacks; exports contain only allowlisted fields', () => {
  const f = fixture(); let id = f.m.start('secret app'); f.m.classify(id, 'https://secret');
  f.m.record(id, 'capture', 'success', 3); f.m.clear(); assert.equal(f.m.record(id, 'asr', 'success', 2), false);
  id = f.m.start('offline'); f.m.configure(false); assert.equal(f.m.finish(id), false); assert.equal(f.m.start('offline'), null);
  f.m.configure(true); id = f.m.start('offline'); f.m.record(id, 'capture', 'success', 1); f.m.finish(id);
  const s = JSON.stringify(f.m.export()); assert(!s.includes('createdAt')); assert(!s.includes('secret')); assert(!s.includes('hotkey"'));
  assert.throws(() => f.m.record(f.m.start('offline'), 'transcript', 'success', 1));
});
test('1000-session and seven-day limits survive restart', () => {
  const f = fixture(); for (let i = 0; i < 1002; i++) { const id = f.m.start('offline'); f.m.finish(id); }
  assert.equal(f.m.stats().sessions, 1000); f.age(7 * 86400000); assert.equal(f.m.export().sessions.length, 0);
});

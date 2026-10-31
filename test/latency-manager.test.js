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
test('Apple on-device polishing remains a distinct bounded provider class', () => {
  const f = fixture(); const id = f.m.start('offline');
  f.m.classify(id, 'apple_on_device'); f.m.record(id, 'polish', 'success', 12);
  f.m.record(id, 'apple_capability', 'success', 1.5);
  f.m.record(id, 'apple_token_count', 'success', 2.5);
  f.m.record(id, 'apple_response_complete', 'success', 8.5);
  f.m.recordUsage(id, 320, 24);
  f.m.finish(id);
  const group = f.m.stats().groups.find(item => item.stage === 'polish');
  assert.equal(group.provider, 'apple_on_device');
  assert.equal(group.p50, 12);
  assert.equal(f.m.stats().groups.find(item => item.stage === 'apple_response_complete').p50, 8.5);
  assert.equal(f.m.export().sessions[0].inputTokens, 320);
  assert.equal(f.m.export().sessions[0].outputTokens, 24);
});
test('Non-Apple sessions do not fabricate missing Apple-native stages', () => {
  const f = fixture(); const id = f.m.start('offline');
  f.m.classify(id, 'ollama'); f.m.record(id, 'polish', 'success', 10); f.m.finish(id);
  assert.equal(f.m.export().sessions[0].observations.some(item => item.stage.startsWith('apple_')), false);
  assert.equal(Object.hasOwn(f.m.export().sessions[0], 'inputTokens'), false);
});
test('token usage is bounded and persisted records remain backward compatible', () => {
  const f = fixture(); const id = f.m.start('offline');
  assert.throws(() => f.m.recordUsage(id, -1, 2), /metrics_invalid/);
  assert.throws(() => f.m.recordUsage(id, 2, 'private-token-sentinel'), /metrics_invalid/);
  assert.equal(f.m.recordUsage(id, 12, 3), true); f.m.finish(id);
  const restarted = new LatencyManager({
    getSetting: (key, fallback) => f.settings.has(key) ? f.settings.get(key) : fallback,
    setSetting: (key, value) => f.settings.set(key, structuredClone(value)),
  }, { wallClock: () => 1000 });
  assert.equal(restarted.export().sessions[0].inputTokens, 12);
  assert.equal(restarted.export().sessions[0].outputTokens, 3);
});

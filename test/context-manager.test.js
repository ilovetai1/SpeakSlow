const test = require('node:test');
const assert = require('node:assert/strict');
const { ContextManager, NativeReader } = require('../src/helpers/contextManager');
function fixture() {
  let enabled = true, now = 0; const calls = [];
  const reader = { async request(op) { calls.push(op); return op === 'captureContext' ? { status: 'available', fieldId: 'opaque', editable: true, secure: false, before: '之前', selected: '', after: '之後' } : { status: 'available' }; }, stop() {} };
  const manager = new ContextManager({ getSetting: (key, fallback) => key === 'context_aware_polishing_enabled' ? enabled : fallback }, { reader, clock: () => now });
  return { manager, reader, calls, off: () => { enabled = false; manager.reset(); }, time: v => { now = v; } };
}
test('context is opaque, single consume, bounded and fresh', async () => {
  const f = fixture(), s = await f.manager.capture();
  assert.deepEqual(Object.keys(s).sort(), ['handle', 'status']);
  assert.deepEqual((await f.manager.consume(s.handle)).text, { before: '之前', selected: '', after: '之後' });
  assert.equal((await f.manager.consume(s.handle)).status, 'expired');
  const next = await f.manager.capture(); f.time(2001);
  assert.equal((await f.manager.consume(next.handle)).status, 'expired');
  assert.equal(f.calls.at(-1), 'release');
});
test('invalid/secure payload and changed field fail closed', async () => {
  for (const bad of [{ before: '字'.repeat(201) }, { editable: false }, { secure: true }, { fieldId: 1 }]) {
    const f = fixture(), request = f.reader.request;
    f.reader.request = async op => ({ ...await request(op), ...bad });
    assert.equal((await f.manager.capture()).status, 'protocol_error');
  }
  const f = fixture(), s = await f.manager.capture();
  f.reader.request = async () => ({ status: 'focus_changed' });
  assert.equal((await f.manager.consume(s.handle)).status, 'focus_changed');
});
test('turning off invalidates late capture and late consume', async () => {
  const f = fixture(); let resolve;
  const original = f.reader.request;
  f.reader.request = () => new Promise(r => { resolve = r; });
  const capture = f.manager.capture(); f.off(); resolve({ status: 'available' });
  assert.equal((await capture).status, 'off');
  const g = fixture(), s = await g.manager.capture();
  g.reader.request = op => op === 'validate' ? new Promise(r => { resolve = r; }) : original(op);
  const consume = g.manager.consume(s.handle); g.off(); resolve({ status: 'available' });
  assert.equal((await consume).status, 'off');
  assert.equal((await g.manager.capture()).status, 'off');
});
test('non-mac does not spawn native process', async () => {
  const reader = new NativeReader({ platform: 'linux', spawnImpl: () => { throw Error('spawn forbidden'); } });
  assert.equal((await reader.request('captureContext')).status, 'unsupported');
});
test('native protocol rejects oversized/invalid responses and request timeout', async () => {
  const { EventEmitter } = require('node:events');
  function fake() { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.stdin.write = () => {}; child.kill = () => { child.killed = true; }; return child; }
  for (const data of ['x'.repeat(65537), JSON.stringify({ id: 1, version: 9, status: 'available' })+'\n', '{bad}\n']) {
    const child = fake(), r = new NativeReader({ platform: 'darwin', spawnImpl: () => child });
    const pending = r.request('captureContext'); child.stdout.emit('data', Buffer.from(data));
    assert.equal((await pending).status, 'protocol_error');r.stop();
  }
  const child = fake(), r = new NativeReader({ platform: 'darwin', spawnImpl: () => child });
  assert.equal((await r.request('captureContext')).status, 'timeout'); assert(child.killed);
});

const { spawn } = require('node:child_process');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const STATUS = ['available', 'released', 'secure_field', 'denied_app', 'permission_denied', 'unsupported', 'noneditable', 'timeout', 'focus_changed', 'expired', 'off', 'omitted_budget', 'protocol_error'];
class NativeReader {
  constructor({ executable, platform = process.platform, spawnImpl = spawn } = {}) {
    this.executable = executable; this.platform = platform; this.spawn = spawnImpl;
    this.child = null; this.pending = new Map(); this.buffer = ''; this.counter = 0;
  }
  request(operation, params = {}) {
    if (this.platform !== 'darwin') return Promise.resolve({ status: 'unsupported' });
    if (!this.child) {
      const child = this.spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); this.child = child;
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => { if (this.child === child) this.stop('protocol_error'); });
      child.stdout.on('data', chunk => {
        if (this.child !== child) return;
        this.buffer += chunk.toString('utf8');
        if (Buffer.byteLength(this.buffer) > 65536) { this.stop('protocol_error'); return; }
        let index;
        while ((index = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
          try {
            const value = JSON.parse(line); const pending = this.pending.get(value.id);
            if (!pending) continue;
            clearTimeout(pending.timer); this.pending.delete(value.id);
            pending.resolve(value.version === 1 && STATUS.includes(value.status) ? value : { status: 'protocol_error' });
          } catch { this.stop('protocol_error'); }
        }
      });
      child.on('error', () => { if (this.child === child) this.stop('unsupported'); });
      child.on('exit', () => { if (this.child === child) this.stop('protocol_error'); });
    }
    return new Promise(resolve => {
      const id = ++this.counter;
      const timer = setTimeout(() => this.stop('timeout'), ['metadata', 'listApps'].includes(operation) ? 2000 : 250);
      this.pending.set(id, { resolve, timer });
      this.child.stdin.write(JSON.stringify({ ...params, version: 1, operation, id }) + '\n', error => { if (error) this.stop('protocol_error'); });
    });
  }
  stop(status = 'off') {
    const child = this.child; this.child = null; this.buffer = '';
    for (const { resolve, timer } of this.pending.values()) { clearTimeout(timer); resolve({ status }); }
    this.pending.clear(); if (child && !child.killed) child.kill();
  }
}
class ContextManager {
  constructor(database, { reader, clock = () => performance.now() } = {}) {
    this.database = database; this.clock = clock; this.snapshots = new Map(); this.generation = 0;
    if (!reader) {
      const { app } = require('electron');
      reader = new NativeReader({ executable: app.isPackaged ? path.join(process.resourcesPath, 'context-reader') : path.join(__dirname, '../../native/build/context-reader') });
    }
    this.reader = reader;
    if (database.getSetting('context_aware_polishing_enabled', false) === true || database.getSetting('local_correction_learning_enabled', false) === true) this.warm();
  }
  denylist() { const d = this.database.getSetting('context_app_denylist', []); return Array.isArray(d) ? d.filter(x => typeof x === 'string').slice(0, 100) : []; }
  warm() { return this.reader.request('metadata').catch(() => ({ status: 'unsupported' })); }
  metadata() { return this.reader.request('metadata'); }
  async capture() {
    if (this.database.getSetting('context_aware_polishing_enabled', false) !== true) return { status: 'off' };
    const generation = this.generation;
    const s = await this.reader.request('captureContext', { denylist: this.denylist() });
    if (generation !== this.generation) return { status: 'off' };
    if (s.status !== 'available') return { status: s.status };
    if (typeof s.fieldId !== 'string' || !s.editable || s.secure !== false || ['selected', 'before', 'after'].some(k => typeof s[k] !== 'string') || ['selected', 'before', 'after'].reduce((n, k) => n + [...s[k]].length, 0) > 200) return { status: 'protocol_error' };
    const handle = randomUUID(); this.snapshots.clear(); this.snapshots.set(handle, { ...s, created: this.clock() });
    return { status: 'available', handle };
  }
  async consume(handle) {
    const s = this.snapshots.get(handle); this.snapshots.delete(handle);
    const generation = this.generation;
    if (!s) return { status: 'expired' };
    try {
      if (this.database.getSetting('context_aware_polishing_enabled', false) !== true) return { status: 'off' };
      if (this.clock() - s.created > 2000) return { status: 'expired' };
      const current = await this.reader.request('validate', { fieldId: s.fieldId, denylist: this.denylist() });
      if (generation !== this.generation || this.database.getSetting('context_aware_polishing_enabled', false) !== true) return { status: 'off' };
      if (this.clock() - s.created > 2000) return { status: 'expired' };
      if (current.status !== 'available') return { status: current.status };
      return { status: 'available', text: { selected: s.selected, before: s.before, after: s.after } };
    } finally { await this.reader.request('release', { fieldId: s.fieldId }); }
  }
  reset() { this.generation++; this.snapshots.clear(); this.reader.stop(); }
  shutdown() { this.reset(); }
}
module.exports = { ContextManager, NativeReader };

const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const STAGES = ['capture', 'asr', 'polish', 'history_save', 'paste_command', 'context', 'hotkey_to_capture_ready', 'stop_to_paste_command_ack', 'first_preview', 'stop_to_asr_final'];
const OUTCOMES = ['success', 'failed', 'cancelled', 'skipped', 'missing'];
const ASR_ENGINES = ['sherpa', 'apple', 'unknown'];
const ASR_PROFILES = ['standard', 'fast', 'streaming', 'accurate', 'responsive', 'dictation', 'unknown'];
const DAYS = 7 * 86400000;
const choose = (value, allowed, fallback = 'unknown') => allowed.includes(value) ? value : fallback;
function observation(stage, outcome, duration) {
  if (!STAGES.includes(stage) || !OUTCOMES.includes(outcome)) throw new Error('metrics_invalid');
  if (duration !== null && (!Number.isFinite(duration) || duration < 0)) throw new Error('metrics_invalid');
  if (outcome === 'success' && duration === null) throw new Error('metrics_invalid');
  return { stage, outcome, duration };
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
}
class LatencyManager {
  constructor(database, { clock = () => performance.now(), wallClock = () => Date.now(), uuid = randomUUID } = {}) {
    this.database = database; this.clock = clock; this.wallClock = wallClock; this.uuid = uuid;
    this.active = new Map(); this.hotkey = null;
    this.enabled = database.getSetting('latency_metrics_enabled', true) !== false;
    const legacy = database.getSetting('latency_metrics_v1', { version: 1, sessions: [] });
    const store = database.getSetting('latency_metrics_v2', { version: 2, sessions: [] });
    const records = new Map();
    if (legacy?.version === 1 && Array.isArray(legacy.sessions)) for (const entry of legacy.sessions) {
      if (this.validEnvelope(entry, true)) records.set(entry.payload.id, { ...entry, payload: { ...entry.payload, asrEngine: 'unknown', asrProfile: 'unknown' } });
    }
    if (store?.version === 2 && Array.isArray(store.sessions)) for (const entry of store.sessions) {
      if (this.validEnvelope(entry)) records.set(entry.payload.id, entry);
    }
    this.retained = [...records.values()].sort((a, b) => a.createdAt - b.createdAt);
    this.prune();
  }
  validEnvelope(x, legacy = false) {
    try {
      if (Object.keys(x).some(k => !['createdAt', 'payload'].includes(k))) return false;
      if (!Number.isFinite(x.createdAt) || !/^[a-f0-9-]{36}$/i.test(x.payload?.id)) return false;
      const p = x.payload;
      if (!legacy && (!ASR_ENGINES.includes(p.asrEngine) || !ASR_PROFILES.includes(p.asrProfile))) return false;
      if (!['offline', 'streaming', 'command', 'unknown'].includes(p.mode) || !['ollama', 'openai_compatible', 'none', 'unknown'].includes(p.provider) || !['cold', 'warm', 'unknown'].includes(p.temperature)) return false;
      return Array.isArray(p.observations) && p.observations.length <= STAGES.length && new Set(p.observations.map(o => o.stage)).size === p.observations.length && p.observations.every(o => { observation(o.stage, o.outcome, o.duration); return Object.keys(o).every(k => ['stage', 'outcome', 'duration'].includes(k)); }) && Object.keys(p).every(k => (legacy ? ['id', 'mode', 'provider', 'temperature', 'observations'] : ['id', 'mode', 'provider', 'temperature', 'observations', 'asrEngine', 'asrProfile']).includes(k));
    } catch { return false; }
  }
  prune() { this.retained = this.retained.filter(x => this.wallClock() - x.createdAt < DAYS && x.createdAt <= this.wallClock()).slice(-1000); }
  persist() { this.prune(); this.database.setSetting('latency_metrics_v2', { version: 2, sessions: this.retained }); }
  configure(enabled) { this.enabled = enabled === true; if (!this.enabled) { this.active.clear(); this.hotkey = null; } }
  noteHotkey() { if (this.enabled) this.hotkey = this.clock(); }
  start(mode) {
    if (!this.enabled) return null;
    const id = this.uuid();
    this.active.set(id, { id, mode: choose(mode, ['offline', 'streaming', 'command']), provider: 'unknown', asrEngine: 'unknown', asrProfile: 'unknown', temperature: 'unknown', observations: [], hotkey: this.hotkey !== null && this.clock() - this.hotkey <= 2000 ? this.hotkey : null });
    this.hotkey = null;
    // A recording normally ends in minutes; abandoned collectors cannot grow forever.
    if (this.active.size > 8) this.active.delete(this.active.keys().next().value);
    return id;
  }
  record(id, stage, outcome, duration) {
    const s = this.enabled && this.active.get(id); if (!s) return false;
    const o = observation(stage, outcome, duration);
    if (s.observations.some(x => x.stage === stage)) return false;
    s.observations.push(o);
    if (stage === 'capture' && outcome === 'success' && s.hotkey !== null) s.observations.push(observation('hotkey_to_capture_ready', 'success', this.clock() - s.hotkey));
    return true;
  }
  classifyASR(id, engine, profile) { const s = this.active.get(id); if (s) { s.asrEngine = choose(engine, ASR_ENGINES); s.asrProfile = choose(profile, ASR_PROFILES); } }
  classify(id, provider) { const s = this.active.get(id); if (s) s.provider = choose(provider, ['ollama', 'openai_compatible', 'none']); }
  finish(id, outcome = 'missing') {
    const s = this.active.get(id); if (!s || !this.enabled) return false;
    this.active.delete(id);
    for (const stage of STAGES) if (!s.observations.some(x => x.stage === stage)) s.observations.push(observation(stage, outcome === 'success' ? 'missing' : choose(outcome, OUTCOMES, 'missing'), null));
    const { hotkey: _hotkey, ...payload } = s;
    this.retained.push({ createdAt: this.wallClock(), payload });
    try { this.persist(); this.status = 'available'; } catch (error) { this.retained.pop(); this.status = 'metrics_persistence_failed'; throw error; }
    return true;
  }
  clear() { this.active.clear(); this.hotkey = null; this.retained = []; this.database.setSetting('latency_metrics_v1', { version: 1, sessions: [] }); this.persist(); }
  export() { this.prune(); return { version: 2, sessions: this.retained.map(x => structuredClone(x.payload)) }; }
  stats() {
    this.prune(); const groups = new Map();
    for (const { payload: p } of this.retained) for (const o of p.observations) {
      const key = [o.stage, p.mode, p.provider, p.temperature, p.asrEngine, p.asrProfile].join(':');
      if (!groups.has(key)) groups.set(key, { stage: o.stage, mode: p.mode, provider: p.provider, temperature: p.temperature, asrEngine: p.asrEngine, asrProfile: p.asrProfile, values: [], counts: Object.fromEntries(OUTCOMES.map(x => [x, 0])) });
      const g = groups.get(key); g.counts[o.outcome]++;
      if (o.outcome === 'success' && Number.isFinite(o.duration)) g.values.push(o.duration);
    }
    return { enabled: this.enabled, status: this.status || 'available', sessions: this.retained.length, groups: [...groups.values()].map(({ values, ...g }) => ({ ...g, n: values.length, p50: percentile(values, .5), p95: percentile(values, .95), insufficient: values.length < 30 })) };
  }
}
module.exports = { LatencyManager, STAGES, OUTCOMES, percentile };

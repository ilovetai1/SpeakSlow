const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const KEY = 'scoped_dictionary_rules_v1';
const QUEUE = 'correction_learning_v1';
const UNDO = 'correction_undo_v1';
const term = s => typeof s === 'string' && /^[\p{L}\p{M}_-]{2,40}$/u.test(s) && [...s].length <= 40;
const bundle = s => typeof s === 'string' && /^[\w-]+(?:\.[\w-]+)+$/.test(s);
function changedWord(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string' || before === after || /[\d\r\n]/u.test(before + after)) return null;
  const a = [...before], b = [...after]; let head = 0, tail = 0;
  while (head < Math.min(a.length, b.length) && a[head] === b[head]) head++;
  while (tail < Math.min(a.length, b.length) - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  let expanded = false;
  let original = a.slice(head, a.length - tail).join(''), replacement = b.slice(head, b.length - tail).join('');
  if (!term(original) || !term(replacement)) {
    // Expand a one-character spelling edit to its complete lexical word.
    const utfHead = a.slice(0, head).join('').length;
    const utfEnd = a.slice(0, a.length - tail).join('').length;
    const segment = [...new Intl.Segmenter('zh-TW', { granularity: 'word' }).segment(before)].find(x => x.isWordLike && x.index <= utfHead && x.index + x.segment.length >= utfEnd);
    if (!segment) return null;
    expanded = true;
    original = segment.segment;
    replacement = after.slice(segment.index, segment.index + original.length + after.length - before.length);
    if (before.slice(0, segment.index) + replacement + before.slice(segment.index + original.length) !== after) return null;
  }
  if (!term(original) || !term(replacement)) return null;
  // Interior unchanged chunks indicate more than one edit, not one word replacement.
  const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'word' });
  if (!expanded && [original, replacement].some(s => [...segmenter.segment(s)].filter(x => x.isWordLike).length !== 1)) return null;
  const aa = [...original], bb = [...replacement];
  for (let i = 1; !expanded && i < aa.length - 2; i++) if (bb.join('').includes(aa.slice(i, i + 2).join(''))) return null;
  return { original, replacement };
}
class CorrectionLearningManager {
  constructor(database, context, { clock = () => performance.now(), wallClock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.database = database; this.context = context; this.clock = clock; this.wallClock = wallClock;
    this.setTimer = setTimer; this.clearTimer = clearTimer; this.observer = null; this.timer = null; this.generation = 0;
  }
  transaction(fn) { return this.database.db.transaction(fn)(); }
  rules() {
    const v = this.database.getSetting(KEY, { version: 1, rules: [] });
    if (v?.version !== 1 || !Array.isArray(v.rules) || v.rules.some(r => !term(r.original) || !term(r.replacement) || !bundle(r.scope?.bundleId) || r.scope.kind !== 'app' || !Number.isInteger(r.revision) || typeof r.enabled !== 'boolean' || typeof r.id !== 'string')) throw new Error('scoped_store_invalid');
    return v.rules;
  }
  saveRules(rules) { this.database.setSetting(KEY, { version: 1, rules }); }
  queue() {
    const value = this.database.getSetting(QUEUE, { version: 1, candidates: [] });
    if (value?.version !== 1 || !Array.isArray(value.candidates)) throw new Error('learning_store_invalid');
    if (value.candidates.some(c => !term(c.original) || !term(c.replacement) || !bundle(c.bundleId) || typeof c.id !== 'string' || !['pending', 'approved', 'dismissed', 'undone'].includes(c.state) || !Number.isFinite(c.createdAt) || !Number.isInteger(c.count) || c.count < 1)) throw new Error('learning_store_invalid');
    return value.candidates.filter(x => this.wallClock() - x.createdAt < 14 * 86400000).slice(-100);
  }
  saveQueue(candidates) { this.database.setSetting(QUEUE, { version: 1, candidates }); }
  undoStore() { const v = this.database.getSetting(UNDO, { version: 1, records: [] }); if (v?.version !== 1 || !Array.isArray(v.records)) throw new Error('learning_store_invalid'); return v.records; }
  addCandidate(pair, bundleId) {
    if (!term(pair.original) || !term(pair.replacement) || !bundle(bundleId)) throw new Error('candidate_invalid');
    return this.transaction(() => {
      const queue = this.queue(); const existing = queue.find(x => x.state === 'pending' && x.original === pair.original && x.replacement === pair.replacement && x.bundleId === bundleId);
      if (existing) existing.count++;
      else if (queue.length >= 100) return { status: 'queue_full' };
      else queue.push({ id: randomUUID(), ...pair, bundleId, state: 'pending', count: 1, createdAt: this.wallClock() });
      this.saveQueue(queue); return { status: 'candidate_added' };
    });
  }
  decide(id, decision, scope = 'app') {
    return this.transaction(() => {
      const queue = this.queue(); const candidate = queue.find(x => x.id === id && x.state === 'pending');
      if (!candidate || !['approve', 'dismiss'].includes(decision)) throw new Error('candidate_unavailable');
      if (decision === 'dismiss') { candidate.state = 'dismissed'; this.saveQueue(queue); return { status: 'dismissed' }; }
      if (!['app', 'global'].includes(scope)) throw new Error('scope_invalid');
      let approved;
      if (scope === 'app') {
        if (!bundle(candidate.bundleId)) throw new Error('scope_invalid');
        const rules = this.rules();
        if (rules.some(r => r.original.toLowerCase() === candidate.original.toLowerCase() && r.scope.bundleId === candidate.bundleId)) throw new Error('rule_conflict');
        approved = { id: `app:${randomUUID()}`, original: candidate.original, replacement: candidate.replacement, enabled: true, scope: { kind: 'app', bundleId: candidate.bundleId }, revision: 1, source: 'passive' };
        rules.push(approved); this.saveRules(rules);
      } else {
        if (this.database.getDictionaryEntries(100000, 0).some(r => r.original.toLowerCase() === candidate.original.toLowerCase())) throw new Error('rule_conflict');
        const inserted = this.database.addDictionaryEntry(candidate.original, candidate.replacement, '');
        approved = this.database.getDictionaryEntries(100000, 0).find(r => r.id === Number(inserted.lastInsertRowid));
      }
      const records = this.undoStore(); records.push({ id: candidate.id, source: scope, approved });
      this.database.setSetting(UNDO, { version: 1, records }); candidate.state = 'approved'; this.saveQueue(queue);
      return { status: 'approved' };
    });
  }
  undo(id) {
    return this.transaction(() => {
      const records = this.undoStore(), u = records.find(x => x.id === id); if (!u) throw new Error('undo_conflict');
      if (u.source === 'app') {
        const rules = this.rules(), r = rules.find(x => x.id === u.approved.id);
        if (JSON.stringify(r) !== JSON.stringify(u.approved)) throw new Error('undo_conflict');
        this.saveRules(rules.filter(x => x.id !== r.id));
      } else {
        const r = this.database.getDictionaryEntries(100000, 0).find(x => x.id === u.approved.id);
        if (JSON.stringify(r) !== JSON.stringify(u.approved)) throw new Error('undo_conflict');
        this.database.deleteDictionaryEntry(r.id);
      }
      this.database.setSetting(UNDO, { version: 1, records: records.filter(x => x.id !== id) });
      const q = this.queue(); const c = q.find(x => x.id === id); if (c) c.state = 'undone'; this.saveQueue(q); return { status: 'undone' };
    });
  }
  updateRule(id, data) {
    return this.transaction(() => {
      const rules = this.rules(), r = rules.find(x => x.id === id); if (!r) throw new Error('rule_unavailable');
      if (data.delete) { this.saveRules(rules.filter(x => x.id !== id)); this.database.setSetting(UNDO, { version: 1, records: this.undoStore().filter(x => x.approved.id !== id) }); }
      else { if (data.original !== undefined && rules.some(x => x.id !== id && x.scope.bundleId === r.scope.bundleId && x.original.toLowerCase() === data.original.toLowerCase())) throw new Error('rule_conflict'); if (data.original !== undefined) { if (!term(data.original)) throw new Error('rule_invalid'); r.original = data.original; } if (data.replacement !== undefined) { if (!term(data.replacement)) throw new Error('rule_invalid'); r.replacement = data.replacement; } if (data.enabled !== undefined) r.enabled = data.enabled === true; r.revision++; this.saveRules(rules); }
      return { status: 'updated' };
    });
  }
  apply(text, bundleId) {
    let appRules; try { appRules = bundle(bundleId) ? this.rules().filter(r => r.enabled && r.scope.bundleId === bundleId) : []; } catch { return { text: this.database.applyDictionary(text), status: 'scoped_store_invalid' }; }
    if (!appRules.length) return { text: this.database.applyDictionary(text), status: bundle(bundleId) ? 'available' : 'scope_unavailable' };
    const rules = [...appRules, ...this.database.getEnabledDictionaryEntries().filter(r => !appRules.some(a => a.original.toLowerCase() === r.original.toLowerCase()))].sort((a, b) => b.original.length - a.original.length);
    const escaped = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(rules.map(r => escaped(r.original)).join('|'), 'gi');
    // One replacement pass: generated replacement strings are never input to another rule.
    return { text: text.replace(pattern, match => rules.find(r => r.original.toLowerCase() === match.toLowerCase()).replacement), status: 'available' };
  }
  stop(reason = null) {
    if (reason) this.lastStatus = reason;
    this.generation++; if (this.timer !== null) this.clearTimer(this.timer); this.timer = null;
    const o = this.observer; this.observer = null; if (o?.fieldId) this.context.reader.request('release', { fieldId: o.fieldId });
  }
  async prepare(expected) {
    this.stop();
    if (this.database.getSetting('local_correction_learning_enabled', false) !== true) return { status: 'off' };
    if (typeof expected !== 'string' || [...expected].length > 500) return { status: 'unsupported' };
    const generation = this.generation;
    const s = await this.context.reader.request('prepareObservation', { denylist: this.context.denylist() });
    if (generation !== this.generation) return { status: 'off' };
    if (s.status !== 'available') return { status: s.status };
    if (typeof s.fieldId !== 'string' || !bundle(s.bundleId) || s.editable !== true || s.secure !== false || !Number.isInteger(s.selection?.location) || !Number.isInteger(s.selection?.length) || s.selection.location < 0 || s.selection.length < 0 || !Number.isInteger(s.count) || s.count < s.selection.location + s.selection.length || ['before', 'after'].some(k => typeof s[k] !== 'string' || [...s[k]].length > 50)) {
      if (typeof s.fieldId === 'string') await this.context.reader.request('release', { fieldId: s.fieldId });
      return { status: 'protocol_error' };
    }
    this.observer = { ...s, expected, generation, proven: false, started: this.clock() }; return { status: 'prepared' };
  }
  async inserted() {
    const o = this.observer; if (!o) return { status: 'off' };
    const s = await this.context.reader.request('observeSpan', { fieldId: o.fieldId, start: o.selection.location, length: o.expected.length, denylist: this.context.denylist() });
    if (this.observer !== o) return { status: 'off' };
    if (s.status !== 'available' || s.span !== o.expected || s.bundleId !== o.bundleId || s.fieldId !== o.fieldId || s.count !== o.count - o.selection.length + o.expected.length || s.selection?.location !== o.selection.location + o.expected.length || s.selection?.length !== 0 || s.before !== o.before || s.after !== o.after || !bundle(s.bundleId)) { this.stop(); return { status: s.status === 'available' ? 'span_unproven' : s.status }; }
    o.proven = true; o.started = this.clock(); o.originalCount = s.count; o.before = s.before; o.after = s.after;
    this.timer = this.setTimer(() => this.poll().catch(() => { this.lastStatus = 'observation_failed'; this.stop(); }), 250); return { status: 'observing' };
  }
  async poll() {
    this.timer = null; const o = this.observer; if (!o) return;
    if (this.clock() - o.started >= 15000) { this.stop('expired'); return; }
    if (this.database.getSetting('local_correction_learning_enabled', false) !== true) { this.stop('off'); return; }
    const s = await this.context.reader.request('validate', { fieldId: o.fieldId, denylist: this.context.denylist() });
    if (this.observer !== o) return;
    const length = o.expected.length + (s.count - o.originalCount);
    if (s.status !== 'available' || !Number.isInteger(length) || length < 0 || length > 1000) { this.stop(s.status === 'available' ? 'span_unproven' : s.status); return; }
    const next = await this.context.reader.request('observeSpan', { fieldId: o.fieldId, start: o.selection.location, length, denylist: this.context.denylist() });
    if (this.observer !== o) return;
    if (next.status !== 'available' || next.before !== o.before || next.after !== o.after) { this.stop(next.status === 'available' ? 'span_unproven' : next.status); return; }
    if (next.span !== o.expected) {
      const pair = changedWord(o.expected, next.span);
      if (pair) { try { this.lastStatus = this.addCandidate(pair, o.bundleId).status; } catch { this.lastStatus = 'learning_persistence_failed'; } }
      else this.lastStatus = 'edit_ineligible';
      this.stop(); return;
    }
    this.timer = this.setTimer(() => this.poll().catch(() => { this.lastStatus = 'observation_failed'; this.stop(); }), 250);
  }
}
module.exports = { CorrectionLearningManager, changedWord, term, bundle };

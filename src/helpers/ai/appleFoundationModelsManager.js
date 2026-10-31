const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { accessSync, constants } = require('node:fs');
const { TextDecoder } = require('node:util');
const os = require('node:os');
const path = require('node:path');
const { isMacOS27OrNewer } = require('../macos27Support');

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 262144;
const MAX_TEXT_BYTES = 131072;
const MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_OUTPUT_TOKENS = 1024;
const ERROR_CODES = new Set([
  'platform_unsupported', 'helper_missing', 'helper_launch_failed', 'helper_exited',
  'helper_pipe', 'helper_protocol', 'helper_stopped', 'runtime_stopping',
  'provider_busy', 'input_invalid', 'input_over_limit', 'unsupported_input',
  'model_unavailable', 'device_not_eligible', 'apple_intelligence_not_enabled',
  'model_not_ready', 'locale_unsupported', 'capability_unavailable', 'budget_unavailable',
  'context_exceeded', 'guardrail_violation', 'refusal', 'rate_limited',
  'output_over_limit', 'invalid_response', 'cancelled', 'timeout', 'provider_error',
]);

function nativeError(code) {
  const safe = ERROR_CODES.has(code) ? code : 'provider_error';
  return Object.assign(new Error(safe), { code: safe });
}

function defaultHelperPath(app) {
  if (!app) {
    try { app = require('electron').app; } catch { /* Plain Node tests use the development path. */ }
  }
  return app?.isPackaged
    ? path.join(process.resourcesPath, 'apple-foundation-models')
    : path.resolve(__dirname, '../../../native/build/apple-foundation-models');
}

function validCapabilities(value) {
  if (!value || typeof value !== 'object' || typeof value.available !== 'boolean') return false;
  if (value.available === false) return value.state === 'unavailable' && ERROR_CODES.has(value.reason);
  return value.state === 'ready' && ['core3', 'core_advanced3'].includes(value.variant)
    && value.locale === 'zh-TW' && Number.isSafeInteger(value.contextSize) && value.contextSize > 0
    && value.tokenCounting === true && typeof value.modelDisplayName === 'string'
    && value.modelDisplayName.length > 0 && value.modelDisplayName.length <= 128;
}

class AppleFoundationModelsManager {
  constructor({ logger, helperPath, app, platform = process.platform, arch = process.arch,
    release = os.release(), spawnFn = spawn, cancellationGraceMs = 1000 } = {}) {
    if (!logger) throw new Error('AppleFoundationModelsManager 需要 LogManager');
    this.logger = logger;
    this.helperPath = helperPath || defaultHelperPath(app);
    this.platform = platform; this.arch = arch; this.release = release; this.spawnFn = spawnFn;
    this.cancellationGraceMs = Math.max(1, Math.min(5000, cancellationGraceMs));
    this.child = null; this.starting = null; this.pending = new Map();
    this.completed = new Map(); this.generation = 0; this.active = null;
    this.cancelling = null; this.stopping = false;
  }

  supportReason() {
    if (!isMacOS27OrNewer({ platform: this.platform, arch: this.arch, release: this.release })) return 'platform_unsupported';
    try { accessSync(this.helperPath, constants.X_OK); } catch { return 'helper_missing'; }
    return null;
  }

  _remember(id, generation) {
    this.completed.set(id, generation);
    if (this.completed.size > 256) this.completed.delete(this.completed.keys().next().value);
  }

  _settle(id, error, value) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id); this._remember(id, entry.generation);
    entry.signal?.removeEventListener('abort', entry.onAbort);
    if (error) entry.reject(error); else entry.resolve(value);
  }

  _invalidate(code, child = this.child) {
    if (!child || this.child !== child) return;
    this.child = null;
    for (const [id, entry] of this.pending) if (entry.child === child) this._settle(id, nativeError(code));
    this.logger.warn('Apple Foundation Models runtime stopped', { provider: 'apple_on_device', code });
    // Signals only this exact owned process. Old callbacks cannot kill a retry.
    if (child.exitCode == null && !child.signalCode) {
      try { child.kill(); } catch { /* An already-exited owned child needs no signal. */ }
      const force = setTimeout(() => {
        if (child.exitCode == null && !child.signalCode) { try { child.kill('SIGKILL'); } catch { /* Already exited. */ } }
      }, this.cancellationGraceMs);
      force.unref?.();
      child.once('exit', () => clearTimeout(force));
    }
  }

  _receive(message, child) {
    if (this.child !== child) return;
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || message.protocolVersion !== PROTOCOL_VERSION || typeof message.id !== 'string'
      || !Number.isSafeInteger(message.generation) || typeof message.success !== 'boolean') {
      this._invalidate('helper_protocol', child); return;
    }
    if (this.completed.get(message.id) === message.generation) return;
    const entry = this.pending.get(message.id);
    if (!entry) {
      if (message.generation < this.generation) return;
      this._invalidate('helper_protocol', child); return;
    }
    if (entry.child !== child || entry.generation !== message.generation) {
      this._invalidate('helper_protocol', child); return;
    }
    if (message.success !== true) {
      if (!ERROR_CODES.has(message.code)) { this._invalidate('helper_protocol', child); return; }
      this._settle(message.id, nativeError(message.code)); return;
    }
    this._settle(message.id, null, message.result);
  }

  _request(op, fields, generation, signal, { cancelOnAbort = false } = {}) {
    const child = this.child;
    if (!child) return Promise.reject(nativeError('helper_exited'));
    if (signal?.aborted) return Promise.reject(nativeError(signal.reason?.code || 'cancelled'));
    const id = randomUUID();
    const line = JSON.stringify({ protocolVersion: PROTOCOL_VERSION, id, generation, op, ...fields }) + '\n';
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) return Promise.reject(nativeError('input_over_limit'));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this._settle(id, nativeError(signal.reason?.code || 'cancelled'));
        if (cancelOnAbort) this._cancel(id, generation, child);
        else this._invalidate('cancelled', child);
      };
      this.pending.set(id, { resolve, reject, generation, child, signal, onAbort });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        child.stdin.write(line, error => {
          if (error && this.child === child) this._invalidate('helper_pipe', child);
        });
      } catch { this._invalidate('helper_pipe', child); }
    });
  }

  _cancel(id, generation, child) {
    if (this.child !== child || this.cancelling) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(nativeError('timeout')), this.cancellationGraceMs);
    const pending = this._request('cancel', { targetId: id, targetGeneration: generation }, generation, controller.signal)
      .catch(() => this._invalidate('cancelled', child))
      .finally(() => { clearTimeout(timer); if (this.cancelling === pending) this.cancelling = null; });
    this.cancelling = pending;
  }

  async _ensureChild(generation, signal) {
    if (signal.aborted) throw nativeError(signal.reason?.code || 'cancelled');
    if (this.starting) return this.starting;
    if (this.child) return;
    const reason = this.supportReason(); if (reason) throw nativeError(reason);
    const start = (async () => {
      let child;
      try { child = this.spawnFn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
      catch { throw nativeError('helper_launch_failed'); }
      this.child = child;
      let buffer = Buffer.alloc(0);
      const decoder = new TextDecoder('utf-8', { fatal: true });
      child.stdout.on('data', chunk => {
        if (this.child !== child) return;
        buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        let at;
        while ((at = buffer.indexOf(10)) >= 0) {
          if (at + 1 > MAX_MESSAGE_BYTES || at === 0) { this._invalidate('helper_protocol', child); return; }
          const frame = buffer.subarray(0, at); buffer = buffer.subarray(at + 1);
          try { this._receive(JSON.parse(decoder.decode(frame)), child); }
          catch { this._invalidate('helper_protocol', child); return; }
          if (this.child !== child) return;
        }
        if (buffer.length >= MAX_MESSAGE_BYTES) this._invalidate('helper_protocol', child);
      });
      // Framework diagnostics may include text. Drain without forwarding them.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => this._invalidate('helper_pipe', child));
      child.stdout.on('error', () => this._invalidate('helper_pipe', child));
      child.stdout.on('end', () => this._invalidate('helper_exited', child));
      child.on('error', () => this._invalidate('helper_launch_failed', child));
      child.on('exit', () => this._invalidate('helper_exited', child));
      const hello = await this._request('handshake', {}, generation, signal);
      if (hello?.helper !== 'apple-foundation-models' || hello.maximumMessageBytes !== MAX_MESSAGE_BYTES) {
        this._invalidate('helper_protocol', child); throw nativeError('helper_protocol');
      }
    })();
    this.starting = start;
    try { await start; } finally { if (this.starting === start) this.starting = null; }
  }

  async _operation(action, { signal, timeoutMs = 60000 } = {}) {
    if (this.stopping) throw nativeError('runtime_stopping');
    if (this.active) throw nativeError('provider_busy');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw nativeError('input_invalid');
    if (signal?.aborted) throw nativeError('cancelled');
    const generation = ++this.generation;
    const controller = new AbortController();
    const onAbort = () => controller.abort(nativeError('cancelled'));
    const timer = setTimeout(() => controller.abort(nativeError('timeout')), Math.min(60000, timeoutMs));
    signal?.addEventListener('abort', onAbort, { once: true });
    this.active = controller;
    try {
      if (this.cancelling) await Promise.race([
        this.cancelling,
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(nativeError(controller.signal.reason?.code)), { once: true })),
      ]);
      if (controller.signal.aborted) throw nativeError(controller.signal.reason?.code);
      await this._ensureChild(generation, controller.signal);
      const result = await action(generation, controller.signal);
      if (controller.signal.aborted) throw nativeError(controller.signal.reason?.code);
      return result;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (this.active === controller) this.active = null;
    }
  }

  _probe(generation, signal) {
    return this._request('probe', { locale: 'zh-TW' }, generation, signal).then(value => {
      if (!validCapabilities(value)) { this._invalidate('helper_protocol'); throw nativeError('helper_protocol'); }
      return value;
    });
  }

  probe(options = {}) {
    const reason = this.supportReason();
    if (reason) return Promise.resolve({ state: 'unavailable', available: false, reason, locale: 'zh-TW' });
    return this._operation((generation, signal) => this._probe(generation, signal), options);
  }

  generate({ instructions = '', prompt, locale = 'zh-TW', maxOutputTokens = DEFAULT_OUTPUT_TOKENS,
    signal, timeoutMs = 60000 } = {}) {
    if (typeof instructions !== 'string' || typeof prompt !== 'string' || !prompt.trim()
      || locale !== 'zh-TW' || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1
      || maxOutputTokens > MAX_OUTPUT_TOKENS) return Promise.reject(nativeError('input_invalid'));
    if (Buffer.byteLength(instructions) > MAX_TEXT_BYTES || Buffer.byteLength(prompt) > MAX_TEXT_BYTES) {
      return Promise.reject(nativeError('input_over_limit'));
    }
    return this._operation(async (generation, operationSignal) => {
      const capability = await this._probe(generation, operationSignal);
      if (!capability.available) throw nativeError(capability.reason);
      const result = await this._request('generate', { instructions, prompt, locale, maxOutputTokens,
        timeoutMs: Math.max(1, Math.floor(Math.min(60000, timeoutMs))) }, generation, operationSignal, { cancelOnAbort: true });
      if (!validCapabilities(result) || result.complete !== true || typeof result.text !== 'string'
        || !result.text.trim() || !Number.isSafeInteger(result.inputTokenCount) || result.inputTokenCount < 1
        || !Number.isSafeInteger(result.outputTokenCount) || result.outputTokenCount < 1
        || result.maxOutputTokens !== maxOutputTokens || result.framingAllowance !== 64) {
        this._invalidate('helper_protocol'); throw nativeError('helper_protocol');
      }
      if (Buffer.byteLength(result.text) > MAX_TEXT_BYTES || result.outputTokenCount >= maxOutputTokens) throw nativeError('output_over_limit');
      if (result.inputTokenCount + maxOutputTokens + result.framingAllowance > result.contextSize) throw nativeError('context_exceeded');
      return result;
    }, { signal, timeoutMs });
  }

  async releaseResources() {
    const child = this.child;
    const exited = child && child.exitCode == null && !child.signalCode
      ? new Promise(resolve => child.once('exit', resolve)) : null;
    this.active?.abort(nativeError(this.stopping ? 'runtime_stopping' : 'cancelled'));
    this._invalidate('helper_stopped');
    if (this.cancelling) await this.cancelling;
    if (exited) {
      let timer;
      try {
        await Promise.race([exited, new Promise(resolve => {
          timer = setTimeout(resolve, this.cancellationGraceMs * 2);
        })]);
      } finally { clearTimeout(timer); }
    }
  }

  async dispose() { this.stopping = true; await this.releaseResources(); }
  shutdown() { return this.dispose(); }
}

module.exports = { AppleFoundationModelsManager, defaultHelperPath, nativeError, ERROR_CODES,
  PROTOCOL_VERSION, MAX_MESSAGE_BYTES, MAX_TEXT_BYTES, MAX_OUTPUT_TOKENS, DEFAULT_OUTPUT_TOKENS };

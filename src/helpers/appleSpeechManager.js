const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { SpeechTranscript } = require('./speechTranscript');

const MAX_MESSAGE = 262144;
function readWav(value) {
  const buffer = Buffer.from(value);
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('audio_format');
  let format, pcm;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + size > buffer.length) throw new Error('audio_format');
    const kind = buffer.toString('ascii', offset, offset + 4);
    if (kind === 'fmt ' && size >= 16) format = { encoding: buffer.readUInt16LE(offset + 8), channelCount: buffer.readUInt16LE(offset + 10), sampleRate: buffer.readUInt32LE(offset + 12), bits: buffer.readUInt16LE(offset + 22) };
    if (kind === 'data') pcm = buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!format || !pcm || format.encoding !== 1 || format.bits !== 16 || ![1, 2].includes(format.channelCount) || format.sampleRate < 8000 || format.sampleRate > 96000 || pcm.length % (format.channelCount * 2)) throw new Error('audio_format');
  return { ...format, pcm };
}

class AppleSpeechManager extends EventEmitter {
  constructor({ logger, helperPath, platform = process.platform, arch = process.arch, release = os.release(), spawnFn = spawn, clock = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    super(); this.logger = logger; this.helperPath = helperPath; this.platform = platform; this.arch = arch; this.release = release; this.spawnFn = spawnFn;
    this.pending = new Map(); this.child = null; this.session = null; this.profile = 'accurate'; this.starting = null;
    this.clock = clock; this.sleep = sleep;
  }
  supportReason() {
    if (this.platform !== 'darwin' || this.arch !== 'arm64' || Number(this.release.split('.')[0]) < 25) return 'platform_unsupported';
    if (!existsSync(this.helperPath || '')) return 'helper_missing';
    return null;
  }
  async ensureChild() {
    if (this.starting) return this.starting;
    if (this.child) return;
    const reason = this.supportReason(); if (reason) throw new Error(reason);
    this.starting = (async () => {
      this.stopping = false;
      const child = this.spawnFn(this.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child = child; let buffered = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (this.child !== child) return;
        buffered += chunk;
        if (Buffer.byteLength(buffered) > MAX_MESSAGE * 2) { this.failAll('helper_protocol'); child.kill(); return; }
        let at;
        while ((at = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, at); buffered = buffered.slice(at + 1);
          try { this.receive(JSON.parse(line)); }
          catch (error) { this.failAll(['result_range', 'result_after_final'].includes(error.message) ? error.message : 'helper_protocol'); child.kill(); }
        }
      });
      // stderr may contain framework internals. Never forward it to product logs.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => { if (this.child === child) this.failAll('helper_pipe'); });
      child.stdout.on('error', () => { if (this.child === child) this.failAll('helper_pipe'); });
      child.on('error', () => { if (this.child === child) this.failAll('helper_launch_failed'); });
      child.on('exit', () => { if (this.child === child) { this.child = null; this.failAll('helper_exited'); } });
      const hello = await this.request('hello');
      if (hello.protocol !== 2) { child.kill(); throw new Error('helper_protocol'); }
    })();
    try { await this.starting; } finally { this.starting = null; }
  }
  failAll(code) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(code)); }
    this.pending.clear();
    if (!this.stopping) this.emit('runtime-error', code);
    if (this.session) { this.session.failure = code; if (!this.stopping && !this.session.cancelled) this.emit('session-error', code); }
    if (this.stopping) this.logger?.info?.('Apple speech runtime stopped', { code: 'helper_stopped' });
    else this.logger?.warn?.('Apple speech runtime failure', { code });
  }
  receive(message) {
    if (message.event === 'result') {
      const session = this.session;
      if (!session || session.id !== message.sessionId || session.cancelled) return;
      const result = session.transcript.update(message);
      if (session.firstTextAt === null && result.text.trim()) session.firstTextAt = this.clock();
      this.emit('preview', { sessionId: session.id, ...result });
      return;
    }
    if (message.event === 'download') {
      const progress = message.progress;
      if (Number.isFinite(progress)) this.emit('download', Math.max(0, Math.min(100, progress * 100)));
      return;
    }
    const entry = this.pending.get(message.id); if (!entry) return;
    this.pending.delete(message.id); clearTimeout(entry.timer);
    if (message.success !== true) entry.reject(new Error(typeof message.error === 'string' && /^[a-z_]+$/.test(message.error) ? message.error : 'apple_analysis_failed'));
    else entry.resolve(message.result);
  }
  request(op, fields = {}, timeout = 30000) {
    const child = this.child; if (!child) return Promise.reject(new Error('helper_exited'));
    const id = randomUUID(); const line = JSON.stringify({ id, op, profile: this.profile, ...fields }) + '\n';
    if (Buffer.byteLength(line) > MAX_MESSAGE) return Promise.reject(new Error('audio_protocol'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('helper_timeout')); child.kill(); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(line, error => { if (error && this.pending.has(id)) { clearTimeout(timer); this.pending.delete(id); reject(new Error('helper_pipe')); } });
    });
  }
  async probe(profile = this.profile) {
    const reason = this.supportReason(); if (reason) return { state: 'unavailable', reason };
    this.profile = profile; await this.ensureChild(); return this.request('probe');
  }
  async prepare(profile) {
    const capability = await this.probe(profile);
    if (capability.state !== 'ready') return capability;
    await this.request('prepare');
    return capability;
  }
  async install(profile) { this.profile = profile; await this.ensureChild(); return this.request('install', {}, 600000); }
  async start(id, sampleRate, channelCount = 1, profile = 'accurate') {
    if (this.session) throw new Error('speech_busy');
    this.profile = profile; await this.ensureChild();
    this.session = { id, profile, sampleRate, channelCount, sequence: 0, transcript: new SpeechTranscript(), chain: Promise.resolve(), pendingFrames: 0, firstTextAt: null };
    try { await this.request('start', { sessionId: id, sampleRate, channelCount }); }
    catch (error) { this.session = null; throw error; }
  }
  feed(id, packet) {
    const session = this.session;
    if (!session || session.id !== id || session.cancelled || session.failure) return Promise.reject(new Error(session?.failure || 'session_closed'));
    const { pcm, frames, sampleRate, channelCount, sequence } = packet || {};
    if (typeof pcm !== 'string' || !Number.isInteger(frames) || frames <= 0 || frames > sampleRate / 5 || sampleRate !== session.sampleRate || channelCount !== session.channelCount || sequence !== session.sequence || Buffer.from(pcm, 'base64').length !== frames * channelCount * 2) return Promise.reject(new Error('audio_protocol'));
    if (session.pendingFrames + frames > sampleRate * 2) { session.failure = 'audio_backpressure'; return Promise.reject(new Error(session.failure)); }
    session.sequence++; session.pendingFrames += frames;
    const operation = session.chain.then(async () => {
      if (session.cancelled || session.failure) throw new Error(session.failure || 'session_closed');
      await this.request('feed', { sessionId: id, ...packet });
    }).finally(() => { session.pendingFrames -= frames; });
    session.chain = operation.catch(error => { session.failure = error.message; });
    return operation;
  }
  async finish(id) {
    const session = this.session; if (!session || session.id !== id) throw new Error('session_closed');
    if (session.finishing) return session.finishing;
    session.finishing = (async () => {
      await session.chain;
      if (session.failure || session.cancelled) throw new Error(session.failure || 'session_closed');
      const result = await this.request('finish', { sessionId: id }, 120000);
      if (session.failure || session.cancelled || this.session !== session) throw new Error(session.failure || 'session_closed');
      this.session = null;
      return { success: true, ...session.transcript.snapshot(), duration: result.duration, language: 'zh-TW', asrEngine: 'apple', asrProfile: session.profile };
    })();
    return session.finishing;
  }
  async cancel(id) {
    const session = this.session; if (!session || session.id !== id) return;
    if (session.cancelling) return session.cancelling;
    session.cancelled = true;
    session.cancelling = (async () => {
      try { if (this.child) await this.request('cancel', { sessionId: id }, 5000); await session.chain; }
      finally { if (this.session === session) this.session = null; }
    })();
    return session.cancelling;
  }
  async transcribeAudio(value, options = {}) {
    const wav = readWav(value); const id = options.sessionId || randomUUID();
    const prepareAt = this.clock();
    await this.start(id, wav.sampleRate, wav.channelCount, options.appleProfile || 'accurate');
    const session = this.session, inputAt = this.clock();
    const durationMs = wav.pcm.length / (wav.sampleRate * wav.channelCount * 2) * 1000;
    try {
      const stride = Math.floor(wav.sampleRate / 10) * wav.channelCount * 2; let sequence = 0;
      for (let offset = 0; offset < wav.pcm.length; offset += stride) {
        const bytes = wav.pcm.subarray(offset, Math.min(offset + stride, wav.pcm.length));
        if (options.realtime === true) {
          const due = inputAt + (offset + bytes.length) / (wav.sampleRate * wav.channelCount * 2) * 1000;
          const delay = due - this.clock();
          if (delay > 0) await this.sleep(delay);
        }
        await this.feed(id, { pcm: bytes.toString('base64'), sampleRate: wav.sampleRate, channelCount: wav.channelCount, frames: bytes.length / (wav.channelCount * 2), sequence: sequence++ });
      }
      const audioEndAt = options.realtime === true ? inputAt + durationMs : this.clock();
      const result = await this.finish(id), doneAt = this.clock();
      return { ...result, timings: {
        prepareMs: inputAt - prepareAt,
        firstTextMs: session.firstTextAt === null ? null : session.firstTextAt - inputAt,
        audioEndToFinalMs: Math.max(0, doneAt - audioEndAt),
        inputToFinalMs: doneAt - inputAt,
        realtime: options.realtime === true,
      } };
    } catch (error) { await this.cancel(id).catch(() => {}); throw error; }
  }
  async dispose() {
    const child = this.child; if (!child || !child.pid || child.exitCode !== null || child.signalCode) { this.child = null; this.session = null; return; }
    this.stopping = true;
    if (this.session) this.session.cancelled = true;
    // Bound all owned-child shutdowns. Never signal system speech/ANE services.
    const exited = new Promise(resolve => child.once('exit', resolve));
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await this.request('shutdown', {}, 3000).catch(() => child.kill()); await exited; }
    finally { clearTimeout(killTimer); if (this.child === child) this.child = null; this.session = null; this.failAll('helper_stopped'); }
  }
}
function defaultHelperPath(app) { return app.isPackaged ? path.join(process.resourcesPath, 'apple-speech') : path.join(__dirname, '../../native/build/apple-speech'); }
module.exports = { AppleSpeechManager, defaultHelperPath, readWav };

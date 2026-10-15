const { EventEmitter } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');

class SherpaAdapter {
  constructor(manager) { this.manager = manager; }
  async capabilities() {
    const files = await this.manager.checkModelFiles();
    return { state: !files.models_downloaded ? 'needs_download' : this.manager.serverReady ? 'ready' : 'preparing', missingModels: files.missing_models || [] };
  }
  async prepare() {
    const caps = await this.capabilities(); if (caps.state === 'needs_download') return caps;
    this.manager.isInitialized = true;
    await this.manager.preInitializeModels();
    if (!this.manager.serverReady) throw new Error('sherpa_not_ready');
    return { state: 'ready' };
  }
  async dispose() {
    // Invalidate asynchronous preflight too; it must not spawn after switching.
    this.manager.runtimeGeneration = (this.manager.runtimeGeneration || 0) + 1;
    const child = this.manager.serverProcess;
    if (child && child.exitCode === null && !child.signalCode) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      if (child.stdin.destroyed || child.stdin.writableEnded) child.kill();
      else child.stdin.end(JSON.stringify({ action: 'exit' }) + '\n');
      try { await exited; } finally { clearTimeout(killTimer); }
    }
    this.manager.serverProcess = null; this.manager.serverReady = false;
    this.manager.modelsInitialized = false; this.manager.initializationPromise = null;
  }
  transcribeAudio(audio, options) { return this.manager.transcribeAudio(audio, options); }
  transcribeFilePath(file, options) { return this.manager.transcribeFilePath(file, options); }
}

class SpeechEngineManager extends EventEmitter {
  constructor({ database, sherpa, apple, audioStore, textUtilities }) {
    super(); this.database = database; this.sherpa = sherpa; this.apple = apple; this.audioStore = audioStore; this.textUtilities = textUtilities;
    this.adapters = { sherpa: new SherpaAdapter(sherpa), apple };
    this.selected = database.getSetting('asr_engine', 'sherpa');
    this.profile = database.getSetting('apple_response_profile', 'accurate');
    this.state = 'checking'; this.reason = null; this.generation = 0; this.job = null; this.transition = false;
    sherpa.onRuntimeExit = () => {
      if (this.selected !== 'sherpa' || this.transition || this.state !== 'ready') return;
      this.state = 'failed'; this.reason = 'sherpa_not_ready'; this.publish();
      if (this.job) this.emit('job-error', { jobId: this.job.id, error: 'sherpa_not_ready' });
    };
    apple.on('download', progress => { if (this.selected === 'apple') { this.progress = progress; this.publish(); } });
    apple.on('preview', data => { if (this.job?.id === data.sessionId && !this.job.cancelled && !this.job.comparing) this.emit('preview', { jobId: this.job.id, text: data.text }); });
    apple.on('session-error', code => { if (this.job && this.job.engine === 'apple') this.emit('job-error', { jobId: this.job.id, error: code }); });
    apple.on('runtime-error', code => { if (this.selected === 'apple' && !this.transition && this.state === 'ready') { this.state = 'failed'; this.reason = code; this.publish(); } });
  }
  snapshot() {
    return { selected: this.selected, activeEngine: this.state === 'ready' ? this.selected : null, profile: this.profile, state: this.job ? 'busy' : this.state, reason: this.reason, progress: this.progress || 0, isReady: this.state === 'ready', busy: !!this.job || this.transition, appleAvailable: !this.apple.supportReason() };
  }
  async checkState() {
    if (this.selected === 'sherpa' && this.state === 'ready' && !this.job && !this.sherpa.serverReady) { this.state = 'failed'; this.reason = 'sherpa_not_ready'; this.publish(); }
    if (this.selected === 'apple' && this.state === 'downloading' && !this.installing && !this.transition) {
      if (!this.polling) this.polling = (async () => {
        const generation = this.generation;
        try {
          const result = await this.apple.probe(this.profile);
          if (generation !== this.generation) return;
          if (result.state === 'ready') { this.preparing = this.prepare(); await this.preparing; }
          else { this.state = result.state; this.reason = result.reason || null; this.publish(); }
        } catch { if (generation === this.generation) { this.state = 'failed'; this.reason = 'asset_probe_failed'; this.publish(); } }
      })().finally(() => { this.polling = null; });
      await this.polling;
    }
    return this.snapshot();
  }
  publish() { const state = this.snapshot(); this.emit('state', state); return state; }
  initialize() { this.preparing = this.prepare(); return this.preparing; }
  async prepare() {
    if (!['sherpa', 'apple'].includes(this.selected) || !['accurate', 'responsive', 'dictation'].includes(this.profile)) { this.state = 'failed'; this.reason = 'engine_setting_invalid'; return this.publish(); }
    const generation = this.generation;
    this.state = 'preparing'; this.reason = null; this.progress = 0; this.publish();
    try {
      const result = await this.adapters[this.selected].prepare(this.profile);
      if (generation !== this.generation) return this.snapshot();
      this.state = result.state; this.reason = result.reason || null;
    } catch (error) { if (generation === this.generation) { this.state = 'failed'; this.reason = error.message; } }
    return this.publish();
  }
  async select(key, value) {
    if (!['asr_engine', 'apple_response_profile'].includes(key)) throw new Error('engine_setting_invalid');
    if (!(key === 'asr_engine' ? ['sherpa', 'apple'] : ['accurate', 'responsive', 'dictation']).includes(value)) throw new Error('engine_setting_invalid');
    if (this.job || this.transition) throw new Error('speech_busy');
    if (key === 'asr_engine' && value === 'apple' && this.apple.supportReason()) throw new Error(this.apple.supportReason());
    this.transition = true;
    try {
      await this.preparing;
      // Persist before invalidating or stopping the old runtime. Failed writes
      // leave both the old selection and its working runtime untouched.
      const saved = await this.database.setSetting(key, value);
      if (saved === false || saved?.success === false) throw new Error('engine_setting_save_failed');
      const old = this.selected; this.generation++; this.state = 'stopping'; this.publish();
      let shutdownFailed = false;
      try { await this.adapters[old]?.dispose(); }
      catch { shutdownFailed = true; this.state = 'failed'; this.reason = 'engine_shutdown_failed'; }
      if (key === 'asr_engine') this.selected = value; else this.profile = value;
      if (shutdownFailed) return this.publish();
      this.preparing = this.prepare(); return await this.preparing;
    } finally { this.transition = false; this.publish(); }
  }
  async retry() {
    if (this.job || this.transition) throw new Error('speech_busy');
    this.transition = true;
    try { await this.adapters[this.selected]?.dispose(); this.preparing = this.prepare(); return await this.preparing; }
    finally { this.transition = false; this.publish(); }
  }
  async install() {
    if (this.job || this.transition) throw new Error('speech_busy');
    const generation = this.generation;
    if (this.installing) throw new Error('speech_busy');
    this.installing = true; this.state = 'downloading'; this.progress = 0; this.publish();
    try {
      if (this.selected === 'apple') await this.apple.install(this.profile);
      else {
        const result = await this.sherpa.downloadModels(progress => { this.progress = progress.overall_progress || progress.progress || 0; this.publish(); });
        if (!result.success) throw new Error('assets_install_failed');
      }
      if (generation === this.generation) { this.installing = false; return await this.retry(); }
    } catch (error) { if (generation === this.generation) { this.state = 'failed'; this.reason = error.message; this.publish(); } }
    this.installing = false; return this.snapshot();
  }
  begin(kind, owner) {
    if (this.selected === 'sherpa' && this.state === 'ready' && !this.sherpa.serverReady) { this.state = 'failed'; this.reason = 'sherpa_not_ready'; this.publish(); }
    if (this.job || this.transition || this.state !== 'ready') throw new Error(this.job || this.transition ? 'speech_busy' : this.reason || 'speech_not_ready');
    if (!['recording', 'streaming', 'file', 'history'].includes(kind)) throw new Error('speech_job_invalid');
    const profile = this.selected === 'apple' ? this.profile : kind === 'streaming' ? 'streaming' : this.database.getSetting('asr_profile', 'standard');
    this.job = { id: randomUUID(), engine: this.selected, profile, kind, owner, generation: this.generation, cancelled: false };
    this.publish(); return { ...this.job };
  }
  requireJob(id, owner) {
    if (!this.job || this.job.id !== id || this.job.owner !== owner || this.job.cancelled || this.job.generation !== this.generation) throw new Error('speech_job_invalid');
    return this.job;
  }
  async end(id, owner, cancel = false) {
    if (!this.job || this.job.id !== id || this.job.owner !== owner) return;
    const job = this.job; job.cancelled = cancel;
    try {
      if (job.engine === 'apple') await this.apple.cancel(id);
      if (cancel && job.engine === 'sherpa' && job.kind === 'streaming') await this.sherpa.streamingEnd();
      await job.pending?.catch(() => {});
    }
    finally { if (this.job === job) { job.releaseOwnerListener?.(); this.job = null; this.publish(); } }
  }
  async startSession(id, owner, format) {
    const job = this.requireJob(id, owner); if (job.engine !== 'apple') throw new Error('engine_not_selected');
    await this.apple.start(id, format.sampleRate, format.channelCount, job.profile);
  }
  feed(id, owner, packet) { this.requireJob(id, owner); return this.apple.feed(id, packet); }
  async cancel(id, owner) {
    const job = this.requireJob(id, owner); job.cancelled = true;
    if (job.engine === 'apple') await this.apple.cancel(id);
    this.publish();
  }
  async processApple(result, job) {
    const convert = async text => {
      let output = this.textUtilities ? this.textUtilities.applyEmoji(text) : text;
      if (job.kind !== 'recording') {
        if (this.database.getSetting('convert_transcription', true) !== false && this.database.getSetting('language', 'zh-TW') === 'zh-TW' && this.textUtilities) output = (await this.textUtilities.transformText(output, 'to_traditional')).text;
        output = this.database.applyDictionary ? this.database.applyDictionary(output) : output;
      }
      return output;
    };
    result.text = await convert(result.text);
    if (result.segments) result.segments = await Promise.all(result.segments.map(async segment => ({ ...segment, text: await convert(segment.text) })));
    return result;
  }
  async finishSession(id, owner, audio, options) {
    const job = this.requireJob(id, owner);
    const result = await this.processApple(await this.apple.finish(id), job);
    this.requireJob(id, owner);
    if (result.text.trim() && !options?.no_persist && options?.save_audio !== false) {
      const temporary = await this.audioStore.createTempAudioFile(audio);
      result.audio_path = this.audioStore._persistAudioInBackground(temporary);
    }
    return result;
  }
  async transcribe(audio, options = {}, owner = 0) {
    const own = !options.jobId;
    const job = own ? this.begin('file', owner) : this.requireJob(options.jobId, owner);
    try {
      job.pending = this.adapters[job.engine].transcribeAudio(audio, { ...options, profile: job.profile, appleProfile: job.profile, sessionId: job.id });
      let result = await job.pending;
      if (job.engine === 'apple') result = await this.processApple(result, job);
      this.requireJob(job.id, owner);
      if (job.engine === 'apple' && result.text.trim() && !options.no_persist && options.save_audio !== false) {
        const temp = await this.audioStore.createTempAudioFile(audio);
        result.audio_path = this.audioStore._persistAudioInBackground(temp);
      }
      return { ...result, asrEngine: job.engine, asrProfile: job.engine === 'apple' ? job.profile : options.profile || 'standard' };
    } finally { if (own) await this.end(job.id, owner); }
  }
  async transcribeFilePath(file, options, owner, commit) {
    const job = this.begin('history', owner);
    try {
      job.pending = job.engine === 'apple' ? this.apple.transcribeAudio(await fs.readFile(file), { appleProfile: job.profile, sessionId: job.id }) : this.sherpa.transcribeFilePath(file, options);
      let result = await job.pending;
      if (job.engine === 'apple') result = await this.processApple(result, job);
      this.requireJob(job.id, owner); await commit?.(result); return { ...result, asrEngine: job.engine };
    } finally { await this.end(job.id, owner); }
  }
  async compareAppleFilePath(file, owner, { speechProfile = 'accurate', first = 'speech' } = {}) {
    if (!['accurate', 'responsive'].includes(speechProfile) || !['speech', 'dictation'].includes(first)) throw new Error('engine_setting_invalid');
    if (this.selected !== 'apple') throw new Error('engine_not_selected');
    const lease = this.begin('history', owner);
    const job = this.requireJob(lease.id, owner);
    job.comparing = true;
    // The whole pair owns one lease. Neither run changes saved preferences,
    // applies dictionaries/AI, writes history/audio, or sends text to another App.
    job.pending = (async () => {
      const rows = [];
      let output;
      try {
        const audio = await fs.readFile(file);
        const profiles = first === 'speech' ? [speechProfile, 'dictation'] : ['dictation', speechProfile];
        for (const profile of profiles) {
          this.requireJob(job.id, owner);
          this.emit('comparison-progress', { profile, completed: rows.length });
          try {
            const capability = await this.apple.probe(profile);
            this.requireJob(job.id, owner);
            if (capability.state !== 'ready') throw new Error(capability.reason || 'assets_not_ready');
            const result = await this.apple.transcribeAudio(audio, { appleProfile: profile, sessionId: job.id, realtime: true });
            this.requireJob(job.id, owner);
            if (!result.success) throw new Error(result.error || 'apple_analysis_failed');
            rows.push({ profile, success: true, text: result.text, duration: result.duration, timings: result.timings });
          } catch (error) {
            this.requireJob(job.id, owner);
            rows.push({ profile, success: false, error: error.message });
          }
        }
        output = { success: rows.every(row => row.success), results: rows, audioSha256: createHash('sha256').update(audio).digest('hex'), speechProfile, first };
        return output;
      } finally {
        // Restore the selected module even after a failed/cancelled comparison.
        try {
          await this.apple.cancel(job.id);
          if (job.generation === this.generation) {
            const capability = await this.apple.prepare(job.profile);
            this.state = capability.state; this.reason = capability.reason || null;
            if (capability.state !== 'ready' && output) { output.success = false; output.restoreError = capability.reason || 'assets_not_ready'; }
          }
        } catch (error) {
          this.state = 'failed'; this.reason = error.message;
          if (output) { output.success = false; output.restoreError = error.message; }
        }
      }
    })();
    try { return await job.pending; }
    finally { await this.end(job.id, owner); }
  }
  async dispose() { this.generation++; await Promise.all([this.adapters.sherpa.dispose(), this.apple.dispose()]); }
}
module.exports = { SpeechEngineManager, SherpaAdapter };

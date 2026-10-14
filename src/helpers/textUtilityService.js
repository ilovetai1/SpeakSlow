const OpenCC = require('opencc-js');
const builtin = require('./builtinEmojis.json');
class TextUtilityService {
  constructor(database, logger) {
    this.database = database; this.logger = logger;
    this.toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });
    this.toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
  }
  async transformText(text, mode) {
    if (typeof text !== 'string') throw new Error('text_invalid');
    if (['to_traditional', 's2tw'].includes(mode)) return { success: true, text: this.toTraditional(text).replaceAll('賬', '帳') };
    if (['to_simplified', 'tw2s'].includes(mode)) return { success: true, text: this.toSimplified(text) };
    throw new Error('text_mode_invalid');
  }
  getEmojiMap() { return { success: true, builtin: { ...builtin } }; }
  applyEmoji(text) {
    const custom = this.database.getSetting('custom_emojis', {});
    const map = { ...builtin, ...custom };
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keys = Object.keys(map).filter(Boolean).sort((a, b) => b.length - a.length).map(escape);
    if (!keys.length) return text;
    return text.replace(new RegExp(`[，、\\s]?(${keys.join('|')})[。，、！？\\s]{0,3}的?(?:[表錶]情符號|[表錶]情|符號|emoji)[。，、！？\\s]?`, 'gi'), (whole, name) => map[name] ?? whole);
  }
  async tts(text, voice, rate) {
    if (!this.worker) {
      const SherpaManager = require('./sherpaManager');
      // The separate worker is explicitly restricted to utilities. Its run loop
      // skips initialize() and rejects every ASR command, including preload.
      this.worker = new SherpaManager({ info() {}, debug() {}, warn() {}, error() {} }, { utilityOnly: true });
    }
    clearTimeout(this.idleTimer);
    try {
      await this.worker.preInitializeModels();
      if (!this.worker.serverReady) throw new Error('utility_unavailable');
      return await this.worker.tts(text, voice, rate);
    } finally {
      this.idleTimer = setTimeout(() => this.dispose(), 30000); this.idleTimer.unref?.();
    }
  }
  async dispose() {
    clearTimeout(this.idleTimer);
    if (this.worker) { const worker = this.worker; this.worker = null; await new (require('./speechEngineManager').SherpaAdapter)(worker).dispose(); }
  }
}
module.exports = TextUtilityService;

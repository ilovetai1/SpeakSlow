// SDK results revise audio ranges, not an ever-growing string. Finality can
// advance without an earlier volatile result being reissued as isFinal=true.
class SpeechTranscript {
  constructor() { this.parts = []; this.finalizedThrough = 0; }
  update(event) {
    const { start, end, text, finalizedThrough } = event;
    if (![start, end, finalizedThrough].every(Number.isFinite) || start < 0 || end < start || typeof text !== 'string') throw new Error('result_range');
    if (start < this.finalizedThrough - 0.001 && this.parts.some(p => p.end > start && p.start < end)) throw new Error('result_after_final');
    // Apple may initially give a volatile passage the whole input range,
    // including silence, then narrow its start when final word times arrive.
    // Follow the official sample: replace overlapping result passages as a
    // unit. Do not split placeholder times into invented word/SRT boundaries.
    this.parts = this.parts.filter(part => !(part.start < end && part.end > start));
    this.parts.push({ start, end, text });
    this.parts.sort((a, b) => a.start - b.start);
    this.finalizedThrough = Math.max(this.finalizedThrough, finalizedThrough);
    return this.snapshot();
  }
  snapshot() {
    const text = this.parts.reduce((out, part) => out + (/[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(part.text) ? ' ' : '') + part.text, '').trim();
    return { text, segments: this.parts.filter(p => p.text.trim()).map(p => ({ start: p.start, end: p.end, text: p.text.trim() })) };
  }
}
module.exports = { SpeechTranscript };

const { createHash, randomUUID } = require('node:crypto');

const cancelled = () => ({ success: false, code: 'cancelled', cancelled: true, error: '重新潤稿已取消' });
const changed = () => ({ success: false, code: 'history_changed', error: '歷史紀錄已變更，請重新產生潤稿預覽' });
const revision = record => record && createHash('sha256').update(JSON.stringify([
  record.raw_text ?? null, record.text ?? null, record.processed_text ?? null, record.updated_at ?? null,
])).digest('hex');

class HistoryPolishManager {
  constructor(database, processor) {
    this.database = database;
    this.processor = processor;
    this.previews = new Map();
  }

  release(entry) {
    if (this.previews.get(entry.owner.id) === entry) this.previews.delete(entry.owner.id);
    entry.controller.abort();
    entry.owner.removeListener('destroyed', entry.cancel);
    entry.owner.removeListener('render-process-gone', entry.cancel);
  }

  cancel(owner) {
    const entry = this.previews.get(owner.id);
    if (entry?.owner === owner) this.release(entry);
    return { success: true };
  }

  async preview(owner, id) {
    this.cancel(owner);
    if (owner.isDestroyed?.()) return cancelled();
    const record = this.database.getTranscriptionById(id);
    if (!record) return { success: false, error: '找不到該筆紀錄' };
    const entry = { owner, id, revision: revision(record), controller: new AbortController(), token: randomUUID() };
    entry.cancel = () => this.release(entry);
    this.previews.set(owner.id, entry);
    owner.once('destroyed', entry.cancel);
    owner.once('render-process-gone', entry.cancel);
    try {
      const { previewHistoryPolish } = await import('../utils/historyPolishing.mjs');
      if (entry.controller.signal.aborted) return cancelled();
      const result = await previewHistoryPolish({
        record,
        processText: (text, mode) => this.processor.processTextWithAI(text, mode, null, {
          workflow: 'history_preview', requireEnabled: false, signal: entry.controller.signal,
        }),
      });
      if (entry.controller.signal.aborted || this.previews.get(owner.id) !== entry) return cancelled();
      if (!result.success) return result;
      if (revision(this.database.getTranscriptionById(id)) !== entry.revision) return changed();
      entry.candidateText = result.candidateText;
      return { ...result, candidateToken: entry.token };
    } finally {
      // A successful candidate retains its owner listeners until confirmation,
      // replacement, cancellation, or destruction. Failed work retains nothing.
      if (!entry.candidateText) this.release(entry);
    }
  }

  apply(owner, id, token) {
    const entry = this.previews.get(owner.id);
    if (!entry || entry.owner !== owner || entry.id !== id || entry.token !== token || !entry.candidateText) {
      return { success: false, code: 'candidate_invalid', error: '潤稿候選已失效，請重新產生預覽' };
    }
    if (owner.isDestroyed?.() || entry.controller.signal.aborted) { this.release(entry); return cancelled(); }
    const record = this.database.getTranscriptionById(id);
    if (revision(record) !== entry.revision) { this.release(entry); return changed(); }
    // Consume before the synchronous database mutation so duplicate confirms
    // cannot repeat a write, including when persistence throws.
    this.release(entry);
    try {
      const saved = this.database.updateTranscriptionFinalText(id, entry.candidateText);
      if (saved === false || saved?.success === false || saved?.changes === 0) throw new Error('history_save_failed');
      return { success: true, text: entry.candidateText };
    } catch {
      return { success: false, code: 'history_save_failed', error: '歷史紀錄保存失敗，原內容未取代' };
    }
  }
}

module.exports = HistoryPolishManager;

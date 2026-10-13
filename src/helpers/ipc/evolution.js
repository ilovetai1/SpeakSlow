const { ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
module.exports = function register(ctx) {
  ipcMain.on('evolution-recording-started', () => ctx.learningManager.stop('recording_started'));
  const safeAction = fn => async (...args) => { try { return await fn(...args); } catch (error) { return { status: 'failed', error: ['rule_conflict', 'undo_conflict', 'scope_invalid', 'candidate_unavailable', 'scoped_store_invalid'].includes(error.message) ? error.message : 'learning_persistence_failed' }; } };
  ipcMain.handle('evolution-state', safeAction(() => ({ candidates: ctx.learningManager.queue(), rules: ctx.learningManager.rules(), undo: ctx.learningManager.undoStore().map(x => ({ id: x.id, original: x.approved.original, replacement: x.approved.replacement })), learningStatus: ctx.learningManager.lastStatus || 'off' })));
  ipcMain.handle('learning-decide', safeAction((_event, id, decision, scope) => ctx.learningManager.decide(id, decision, scope)));
  ipcMain.handle('learning-undo', safeAction((_event, id) => ctx.learningManager.undo(id)));
  ipcMain.handle('evolution-apps', () => ctx.contextManager.reader.request('listApps'));
  ipcMain.handle('apply-dictionary-context', async (_event, text) => {
    const needsApp = ctx.databaseManager.getSetting('writing_profile', 'neutral') === 'auto' || ctx.databaseManager.getSetting('scoped_dictionary_rules_v1', { rules: [] })?.rules?.length > 0;
    const metadata = needsApp ? await ctx.contextManager.metadata() : { status: 'off' };
    const { bundle } = require('../correctionLearningManager');
    const bundleId = metadata.status === 'available' && bundle(metadata.bundleId) && metadata.bundleId !== 'com.speakslow.app' && !ctx.contextManager.denylist().includes(metadata.bundleId) ? metadata.bundleId : null;
    const result = ctx.learningManager.apply(text, bundleId);
    const handle = require('node:crypto').randomUUID();
    ctx.wordScopes.clear(); ctx.wordScopes.set(handle, { bundleId });
    return { ...result, scopeHandle: handle, bundleId };
  });
  ipcMain.on('latency-unavailable', () => { ctx.latencyManager.status = 'metrics_unavailable'; });
  ipcMain.handle('latency-start', (_event, mode) => ctx.latencyManager.start(mode));
  ipcMain.on('latency-record', (_event, id, stage, outcome, duration) => {
    try { ctx.latencyManager.record(id, stage, outcome, duration); }
    catch { ctx.logger.warn('延遲觀測格式無效', { code: 'metrics_invalid' }); }
  });
  ipcMain.on('latency-finish', (_event, id, outcome) => {
    try { ctx.latencyManager.finish(id, outcome); }
    catch { ctx.logger.warn('延遲資料保存失敗', { code: 'metrics_persistence_failed' }); }
  });
  ipcMain.handle('export-performance-stats', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({ title: '匯出本機延遲資料', defaultPath: 'speakslow-latency.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (canceled) return { canceled: true };
    try { await fs.writeFile(filePath, JSON.stringify(ctx.latencyManager.export(), null, 2)); return { success: true }; }
    catch { return { success: false, error: '延遲資料匯出失敗' }; }
  });
};

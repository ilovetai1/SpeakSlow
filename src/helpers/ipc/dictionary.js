const { ipcMain } = require("electron");

module.exports = function register(ctx) {
  // ===== 字典功能 =====
  ipcMain.handle("get-dictionary-entries", (event, limit, offset) => {
    return [...ctx.databaseManager.getDictionaryEntries(limit, offset), ...(ctx.learningManager?.rules() || []).map(r => ({ ...r, category: `App：${r.scope.bundleId}` }))];
  });

  ipcMain.handle("add-dictionary-entry", (event, original, replacement, category) => {
    return ctx.databaseManager.addDictionaryEntry(original, replacement, category);
  });

  ipcMain.handle("update-dictionary-entry", (event, id, data) => {
    if (typeof id === 'string' && id.startsWith('app:')) return ctx.learningManager.updateRule(id, data);
    return ctx.databaseManager.updateDictionaryEntry(id, data);
  });

  ipcMain.handle("delete-dictionary-entry", (event, id) => {
    if (typeof id === 'string' && id.startsWith('app:')) return ctx.learningManager.updateRule(id, { delete: true });
    if (!ctx.learningManager) return ctx.databaseManager.deleteDictionaryEntry(id);
    return ctx.learningManager.transaction(() => {
      const result = ctx.databaseManager.deleteDictionaryEntry(id);
      ctx.databaseManager.setSetting('correction_undo_v1', { version: 1, records: ctx.learningManager.undoStore().filter(x => !(x.source === 'global' && x.approved.id === id)) });
      return result;
    });
  });

  ipcMain.handle("search-dictionary", (event, query) => {
    return [...ctx.databaseManager.searchDictionary(query), ...(ctx.learningManager?.rules() || []).filter(r => [r.original, r.replacement, r.scope.bundleId].some(s => s.includes(query))).map(r => ({ ...r, category: `App：${r.scope.bundleId}` }))];
  });

  ipcMain.handle("get-dictionary-categories", () => {
    return [...new Set([...ctx.databaseManager.getDictionaryCategories(), ...(ctx.learningManager?.rules() || []).map(r => `App：${r.scope.bundleId}`)])];
  });

  ipcMain.handle("apply-dictionary", (event, text) => {
    return ctx.databaseManager.applyDictionary(text);
  });

  ipcMain.handle("toggle-dictionary-entry", (event, id) => {
    if (typeof id === 'string' && id.startsWith('app:')) { const r = ctx.learningManager.rules().find(x => x.id === id); if (!r) throw new Error('rule_unavailable'); return ctx.learningManager.updateRule(id, { enabled: !r.enabled }); }
    const entry = ctx.databaseManager.db.prepare("SELECT enabled FROM dictionary WHERE id = ?").get(id);
    if (entry) {
      return ctx.databaseManager.updateDictionaryEntry(id, { enabled: !entry.enabled });
    }
    return null;
  });

  // 字典匯出
  ipcMain.handle("export-dictionary", async () => {
    try {
      const { dialog } = require("electron");
      const fs = require("fs");

      const entries = ctx.databaseManager.exportDictionary();

      const { filePath, canceled } = await dialog.showSaveDialog({
        title: "匯出字典",
        defaultPath: `dictionary_${new Date().toISOString().slice(0, 10)}.json`,
        filters: [
          { name: "JSON 檔案", extensions: ["json"] },
          { name: "CSV 檔案", extensions: ["csv"] }
        ]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      if (filePath.endsWith(".csv")) {
        // CSV 格式
        const csvHeader = "原始詞彙,替換為,分類,啟用\n";
        const csvRows = entries.map(e =>
          `"${e.original}","${e.replacement}","${e.category || ''}",${e.enabled ? '是' : '否'}`
        ).join("\n");
        fs.writeFileSync(filePath, csvHeader + csvRows, "utf-8");
      } else {
        // JSON 格式
        fs.writeFileSync(filePath, JSON.stringify({ version: 1, global: entries, scoped: ctx.learningManager?.rules() || [] }, null, 2), "utf-8");
      }

      return { success: true, count: entries.length, path: filePath, excludedScoped: filePath.endsWith('.csv') ? ctx.learningManager?.rules().length || 0 : 0 };
    } catch (error) {
      ctx.logger.error("匯出字典失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 字典匯入
  ipcMain.handle("import-dictionary", async (event, mode) => {
    try {
      const { dialog } = require("electron");
      const fs = require("fs");

      const { filePaths, canceled } = await dialog.showOpenDialog({
        title: "匯入字典",
        filters: [
          { name: "JSON 檔案", extensions: ["json"] },
          { name: "CSV 檔案", extensions: ["csv"] },
          { name: "所有檔案", extensions: ["*"] }
        ],
        properties: ["openFile"]
      });

      if (canceled || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = filePaths[0];
      const content = fs.readFileSync(filePath, "utf-8");
      let entries = [];

      if (filePath.endsWith(".csv")) {
        // 解析 CSV
        const lines = content.split("\n").filter(l => l.trim());
        // 跳過標題行
        for (let i = 1; i < lines.length; i++) {
          const match = lines[i].match(/"([^"]*)",?"([^"]*)",?"([^"]*)",?(是|否|1|0|true|false)?/i);
          if (match) {
            entries.push({
              original: match[1],
              replacement: match[2],
              category: match[3] || '',
              enabled: !match[4] || ['是', '1', 'true'].includes(match[4].toLowerCase())
            });
          }
        }
      } else {
        // 解析 JSON
        const parsed = JSON.parse(content);
        if (parsed && !Array.isArray(parsed) && parsed.version === 1 && Array.isArray(parsed.global) && Array.isArray(parsed.scoped)) {
          // Validate every scoped rule before any write; imports never downgrade scope.
          const { term, bundle } = require('../correctionLearningManager');
          if (parsed.global.some(r => r.scope !== undefined || r.id?.toString().startsWith('app:'))) throw new Error('scope_invalid');
          if (parsed.scoped.some(r => !term(r.original) || !term(r.replacement) || r.scope?.kind !== 'app' || !bundle(r.scope.bundleId) || typeof r.enabled !== 'boolean')) throw new Error('scope_invalid');
          const result = ctx.databaseManager.db.transaction(() => {
            const global = ctx.databaseManager.importDictionary(parsed.global, mode || 'merge');
            const current = ctx.learningManager.rules();
            for (const rule of parsed.scoped) {
              if (current.some(r => r.original.toLowerCase() === rule.original.toLowerCase() && r.scope.bundleId === rule.scope.bundleId)) throw new Error('rule_conflict');
              current.push({ id: `app:${require('node:crypto').randomUUID()}`, original: rule.original, replacement: rule.replacement, scope: rule.scope, enabled: rule.enabled, revision: 1, source: 'import' });
            }
            ctx.learningManager.saveRules(current); return global;
          })();
          return { success: true, ...result, path: filePath };
        }
        if (!Array.isArray(parsed) || parsed.some(r => r.scope !== undefined || r.id?.toString().startsWith('app:'))) throw new Error('scope_invalid');
        entries = parsed;
        if (!Array.isArray(entries)) {
          entries = [entries];
        }
      }

      const result = ctx.databaseManager.importDictionary(entries, mode || 'merge');
      return { success: true, ...result, path: filePath };
    } catch (error) {
      ctx.logger.error("匯入字典失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 清空字典
  ipcMain.handle("clear-dictionary", () => {
    if (!ctx.learningManager) return ctx.databaseManager.clearDictionary();
    return ctx.learningManager.transaction(() => {
      const result = ctx.databaseManager.clearDictionary(); ctx.learningManager.saveRules([]);
      ctx.databaseManager.setSetting('correction_undo_v1', { version: 1, records: [] });
      return result;
    });
  });
};

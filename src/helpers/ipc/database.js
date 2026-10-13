const { ipcMain, BrowserWindow } = require("electron");
const {
  isProtectedRendererSetting,
  redactSettingsForRenderer,
} = require("../../utils/settingsSecurity");

module.exports = function register(ctx) {
  // 数据库相关
  ipcMain.handle("save-transcription", (event, data) => {
    return ctx.databaseManager.saveTranscription(data);
  });

  ipcMain.handle("get-transcriptions", (event, limit, offset) => {
    return ctx.databaseManager.getTranscriptions(limit, offset);
  });

  ipcMain.handle("get-transcription", (event, id) => {
    return ctx.databaseManager.getTranscriptionById(id);
  });

  ipcMain.handle("delete-transcription", (event, id) => {
    return ctx.databaseManager.deleteTranscription(id);
  });

  ipcMain.handle("search-transcriptions", (event, query, limit) => {
    return ctx.databaseManager.searchTranscriptions(query, limit);
  });

  ipcMain.handle("get-transcription-stats", () => {
    return ctx.databaseManager.getTranscriptionStats();
  });

  ipcMain.handle("get-daily-stats", (event, days) => {
    return ctx.databaseManager.getDailyStats(days || 14);
  });

  ipcMain.handle("clear-all-transcriptions", () => {
    return ctx.databaseManager.clearAllTranscriptions();
  });

  // 设置相关
  ipcMain.handle("get-setting", (event, key, defaultValue) => {
    if (isProtectedRendererSetting(key)) {
      throw new Error("受保護設定不得由 renderer 讀取");
    }
    return ctx.databaseManager.getSetting(key, defaultValue);
  });

  const saveSetting = async (event, key, value) => {
    if (key === 'enable_ai_optimization' && typeof value !== 'boolean') {
      throw new Error('AI 潤稿開關必須是布林值');
    }
    const result = await ctx.databaseManager.setSetting(key, value);
    // 先取消工作，再廣播持久化結果；卸載失敗也保持「關」，並讓呼叫者顯示錯誤。
    const release = key === 'enable_ai_optimization' && value === false
      ? ctx.aiProcessor.disableOptimization()
      : null;

    // 廣播設定變更到所有視窗（用於跨視窗同步）
    if (!isProtectedRendererSetting(key)) {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('setting-changed', { key, value });
        }
      });
    }

    await release;
    return result;
  };
  ipcMain.handle("set-setting", saveSetting);

  ipcMain.handle("get-all-settings", () => {
    return redactSettingsForRenderer(ctx.databaseManager.getAllSettings());
  });

  ipcMain.handle("get-settings", () => {
    return redactSettingsForRenderer(ctx.databaseManager.getAllSettings());
  });

  ipcMain.handle("save-setting", saveSetting);

  ipcMain.handle("reset-settings", () => {
    // TODO: 实现重置设置功能
    return ctx.databaseManager.resetSettings();
  });

  // =====================================================
  // 文件操作
  ipcMain.handle("export-transcriptions", (event, format) => {
    // TODO: 实现导出转录功能
    return { success: true, path: "" };
  });

  ipcMain.handle("import-settings", () => {
    // TODO: 实现导入设置功能
    return { success: true };
  });

  ipcMain.handle("export-settings", () => {
    // TODO: 实现导出设置功能
    return { success: true, path: "" };
  });
};

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
    if (['enable_ai_optimization', 'context_aware_polishing_enabled', 'local_correction_learning_enabled', 'latency_metrics_enabled'].includes(key) && typeof value !== 'boolean') {
      throw new Error('AI 潤稿開關必須是布林值');
    }
    if (key === 'writing_profile' && !['neutral', 'message', 'email', 'note', 'auto'].includes(value)) throw new Error('writing_profile_invalid');
    if (key === 'writing_profile_apps' && (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([id, profile]) => !require('../correctionLearningManager').bundle(id) || !['neutral', 'message', 'email', 'note'].includes(profile)))) throw new Error('writing_profile_invalid');
    if (key === 'context_app_denylist' && (!Array.isArray(value) || value.length > 100 || value.some(id => !require('../correctionLearningManager').bundle(id)))) throw new Error('scope_invalid');
    const result = ['asr_engine', 'apple_response_profile'].includes(key)
      ? await ctx.speechEngineManager.select(key, value)
      : await ctx.databaseManager.setSetting(key, value);
    if (key === 'latency_metrics_enabled') ctx.latencyManager?.configure(value);
    if ((key === 'context_aware_polishing_enabled' || key === 'enable_ai_optimization') && value === false) ctx.contextManager?.reset();
    if (key === 'local_correction_learning_enabled' && value === false) ctx.learningManager?.stop('off');
    if (['context_aware_polishing_enabled', 'local_correction_learning_enabled'].includes(key) && value === true) ctx.contextManager?.warm();
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

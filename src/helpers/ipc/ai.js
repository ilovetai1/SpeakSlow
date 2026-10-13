const { ipcMain } = require("electron");

module.exports = function register(ctx) {
  ipcMain.handle('calibrate-context-budget', () => ctx.aiProcessor.calibrateContextBudget());
  // AI文本处理（實作在 aiTextProcessor.js）
  ipcMain.handle("process-text", async (event, text, mode = 'optimize', options = {}) => {
    return await ctx.aiProcessor.processTextWithAI(text, mode, null, { workflow: options.workflow, scopeHandle: options.scopeHandle, metricId: options.metricId, profile: options.profile, requireEnabled: true });
  });

  ipcMain.handle("check-ai-status", async (event, testConfig = null) => {
    return await ctx.aiProcessor.checkAIStatus(testConfig);
  });

  ipcMain.handle("list-ollama-models", async () => {
    return await ctx.aiProcessor.listOllamaModels();
  });

  ipcMain.handle("get-transcript-polishing-prompt", async () => {
    return await ctx.aiProcessor.getTranscriptPolishingPrompt();
  });

  ipcMain.handle("set-transcript-polishing-prompt", async (event, prompt) => {
    return await ctx.aiProcessor.setTranscriptPolishingPrompt(prompt);
  });
};

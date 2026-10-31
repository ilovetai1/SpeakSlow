const { ipcMain } = require("electron");

module.exports = function register(ctx) {
  const withOwnerSignal = async (event, action) => {
    const controller = new AbortController();
    const sender = event?.sender;
    const cancel = () => controller.abort();
    sender?.once('destroyed', cancel);
    sender?.once('render-process-gone', cancel);
    if (sender?.isDestroyed?.()) cancel();
    try { return await action(controller.signal); }
    finally {
      sender?.removeListener('destroyed', cancel);
      sender?.removeListener('render-process-gone', cancel);
    }
  };
  ipcMain.handle('calibrate-context-budget', () => ctx.aiProcessor.calibrateContextBudget());
  // AI文本处理（實作在 aiTextProcessor.js）
  ipcMain.handle("process-text", async (event, text, mode = 'optimize', options = {}) => {
    return withOwnerSignal(event, signal => ctx.aiProcessor.processTextWithAI(text, mode, null, { workflow: options.workflow, scopeHandle: options.scopeHandle, metricId: options.metricId, profile: options.profile, expectedProvider: options.expectedProvider, requireEnabled: true, signal }));
  });

  ipcMain.handle('preview-file-polish', async (event, text) => {
    if (typeof text !== 'string' || !text.trim()) {
      return { success: false, code: 'invalid_input', error: '請提供非空白的檔案逐字稿' };
    }
    return withOwnerSignal(event, signal => ctx.aiProcessor.processTextWithAI(text, 'optimize', null, {
      workflow: 'file_preview', requireEnabled: false, signal,
    }));
  });

  ipcMain.handle("check-ai-status", async (event, testConfig = null) => {
    return await ctx.aiProcessor.checkAIStatus(testConfig);
  });

  ipcMain.handle('get-apple-polishing-status', async () => ctx.aiProcessor.checkAIStatus({ ai_provider: 'apple_on_device' }));

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

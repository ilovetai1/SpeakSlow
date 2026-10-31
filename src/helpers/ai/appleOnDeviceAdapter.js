const { AppleFoundationModelsManager, ERROR_CODES, nativeError } = require('./appleFoundationModelsManager');

const MESSAGES = {
  platform_unsupported: 'Apple 本機潤稿需要 macOS 27 與 Apple Silicon',
  helper_missing: 'Apple 潤稿元件不存在或無法執行',
  device_not_eligible: '此裝置不支援 Apple Intelligence',
  apple_intelligence_not_enabled: '請先啟用 Apple Intelligence',
  model_not_ready: 'Apple 本機語言模型尚未準備完成',
  locale_unsupported: 'Apple 語言模型不支援臺灣繁體中文',
  context_exceeded: '文字超過 Apple 本機模型的上下文預算',
  budget_unavailable: '無法確認 Apple 本機模型的文字預算',
  capability_unavailable: '無法確認 Apple 本機模型能力',
  guardrail_violation: 'Apple 模型的安全規則拒絕此次內容',
  refusal: 'Apple 模型拒絕此次文字處理',
  output_over_limit: 'Apple 回應達到輸出上限，未採用不完整文字',
  input_over_limit: '文字超過 Apple 潤稿元件的傳輸上限',
  unsupported_input: 'Apple 本機潤稿不接受額外情境或對話紀錄',
  input_invalid: 'Apple 潤稿輸入格式錯誤',
  invalid_response: 'Apple 未回傳完整可用文字',
  timeout: 'Apple 本機潤稿逾時',
  cancelled: 'Apple 本機潤稿已取消',
  runtime_stopping: '應用程式正在結束',
  provider_busy: 'Apple 本機潤稿正在處理其他工作',
};

function failed(error) {
  const code = ERROR_CODES.has(error?.code) ? error.code : 'provider_error';
  return { success: false, code, error: MESSAGES[code] || 'Apple 本機潤稿失敗',
    ...(['cancelled', 'runtime_stopping'].includes(code) ? { cancelled: true } : {}) };
}

function requestText(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 2
    || messages.some(m => !m || typeof m.content !== 'string')
    || messages.at(-1).role !== 'user' || (messages.length === 2 && messages[0].role !== 'system')) {
    throw nativeError('unsupported_input');
  }
  let instructions = messages.length === 2 ? messages[0].content : '';
  let prompt = messages.at(-1).content;
  // The existing polishing prompt builder puts its trusted instruction before
  // the first transcript marker. Never promote any transcript bytes into it.
  const at = prompt.indexOf('\n\n<transcript>\n');
  if (at >= 0 && prompt.endsWith('\n</transcript>')) {
    instructions += '\n' + prompt.slice(0, at);
    prompt = prompt.slice(at + 2);
  }
  return { instructions, prompt };
}

class AppleOnDeviceAdapter {
  constructor({ logger, manager, ...managerOptions } = {}) {
    if (!logger) throw new Error('AppleOnDeviceAdapter 需要 LogManager');
    this.logger = logger;
    this.manager = manager || new AppleFoundationModelsManager({ logger, ...managerOptions });
  }

  async process({ messages, timeoutMs = 60000, signal, maxOutputTokens, cursorContext, context, tools } = {}) {
    const started = Date.now();
    try {
      if (cursorContext != null || context != null || tools != null) throw nativeError('unsupported_input');
      const request = requestText(messages);
      const result = await this.manager.generate({ ...request, locale: 'zh-TW', timeoutMs, signal, maxOutputTokens });
      if (signal?.aborted) throw nativeError('cancelled');
      this.logger.info('AI request completed', { provider: 'apple_on_device', variant: result.variant,
        durationMs: Date.now() - started, inputTokens: result.inputTokenCount, outputTokens: result.outputTokenCount });
      return { success: true, text: result.text, provider: 'apple_on_device', model: result.variant,
        variant: result.variant, locale: result.locale, contextSize: result.contextSize,
        usage: { input_tokens: result.inputTokenCount, output_tokens: result.outputTokenCount,
          total_tokens: result.inputTokenCount + result.outputTokenCount } };
    } catch (error) {
      const result = failed(error);
      this.logger.warn('Apple AI request failed', { provider: 'apple_on_device', code: result.code, durationMs: Date.now() - started });
      return result;
    }
  }

  async checkStatus(options = {}) {
    try {
      const result = await this.manager.probe(options);
      return { ...result, code: result.available ? null : result.reason,
        ...(result.available ? {} : { error: MESSAGES[result.reason] || 'Apple 本機模型目前無法使用' }) };
    } catch (error) {
      const result = failed(error);
      return { available: false, state: 'unavailable', reason: result.code, locale: 'zh-TW', ...result };
    }
  }

  releaseResources() { return this.manager.releaseResources(); }
  shutdown() { return this.manager.shutdown(); }
}

module.exports = AppleOnDeviceAdapter;
module.exports.requestText = requestText;

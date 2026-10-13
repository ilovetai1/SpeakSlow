/**
 * 主程序 AI 文字處理 seam。
 * Renderer 只透過 IPC 使用本服務；provider request 由 adapter 負責。
 */
const {
  DEFAULT_TRANSCRIPT_POLISHING_PROMPT,
  buildPrompts,
  validateTranscriptPolishingPrompt,
} = require("./aiPrompts");
const OpenAICompatibleAdapter = require("./ai/openAICompatibleAdapter");
const OllamaAdapter = require("./ai/ollamaAdapter");
const OllamaRuntime = require("./ai/ollamaRuntime");

// qwen3:1.7b + universal prompt + num_ctx:2048 實測：500 字 6.5 秒完成；
// 600 字在重複文字壓力案例超過固定 60 秒 timeout，因此上限固定為 500。
const MAX_TRANSCRIPT_CHARS = 500;

function inferLegacyProvider(baseUrl) {
  const url = String(baseUrl || "").toLowerCase();
  if (/^https?:\/\/(127\.0\.0\.1|localhost):11434(?:\/|$)/.test(url)) return "ollama";
  if (url.includes("api.deepseek.com")) return "deepseek";
  if (url.includes("generativelanguage.googleapis.com")) return "gemini";
  if (url.includes("api.openai.com")) return "openai";
  return "custom";
}

class AITextProcessor {
  constructor(databaseManager, logger, adapters = {}) {
    if (!logger) throw new Error("AITextProcessor 需要 LogManager");
    this.databaseManager = databaseManager;
    this.logger = logger;
    this.ollamaRuntime = adapters.ollamaRuntime || new OllamaRuntime({ logger });
    this.adapters = {
      openAICompatible: adapters.openAICompatible || new OpenAICompatibleAdapter({ logger }),
      ollama: adapters.ollama || new OllamaAdapter({ logger, runtime: this.ollamaRuntime }),
    };
    this.stopping = false;
    this.requests = new Set();
  }

  _stripAIPreamble(value) {
    let text = (value || "").trim();
    text = text.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
    const lines = text.split("\n");
    if (lines.length > 1) {
      const first = lines[0].trim();
      if (/[：:]\s*$/.test(first) && /(修正|優化|优化|以下|文本|結果|结果|根據|根据|如下|整理|here|following|result)/i.test(first)) {
        text = lines.slice(1).join("\n").trim();
      }
    }
    return text.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  }

  async getTranscriptPolishingPrompt() {
    const savedPrompt = await this.databaseManager.getSetting(
      "transcript_polishing_prompt",
      null,
    );
    if (savedPrompt === null || savedPrompt === undefined) {
      return DEFAULT_TRANSCRIPT_POLISHING_PROMPT;
    }
    return validateTranscriptPolishingPrompt(savedPrompt);
  }

  async setTranscriptPolishingPrompt(value) {
    const prompt = validateTranscriptPolishingPrompt(value);
    return this.databaseManager.setSetting("transcript_polishing_prompt", prompt);
  }

  async _loadConfig(testConfig = null) {
    if (testConfig) {
      const baseUrl = testConfig.ai_base_url || "https://api.openai.com/v1";
      return {
        provider: testConfig.ai_provider || inferLegacyProvider(baseUrl),
        apiKey: testConfig.use_saved_api_key === true
          ? await this.databaseManager.getSetting("ai_api_key")
          : testConfig.ai_api_key,
        baseUrl,
        model: testConfig.ai_model || "gpt-3.5-turbo",
      };
    }

    let apiKey = await this.databaseManager.getSetting("ai_api_key");
    let baseUrl = await this.databaseManager.getSetting("ai_base_url");
    let model = await this.databaseManager.getSetting("ai_model");
    const savedProvider = await this.databaseManager.getSetting("ai_provider");

    if (!apiKey && process.env.DEEPSEEK_API_KEY && savedProvider !== "ollama") {
      apiKey = process.env.DEEPSEEK_API_KEY;
      baseUrl = baseUrl || "https://api.deepseek.com";
      model = model || "deepseek-chat";
    }

    baseUrl = baseUrl || "https://api.openai.com/v1";
    model = model || "gpt-3.5-turbo";
    return {
      provider: savedProvider || inferLegacyProvider(baseUrl),
      apiKey,
      baseUrl,
      model,
    };
  }

  _messages(
    text,
    mode,
    customPrompt,
    polishingPrompt = DEFAULT_TRANSCRIPT_POLISHING_PROMPT,
  ) {
    const prompts = buildPrompts(text, polishingPrompt);
    return [
      {
        role: "system",
        content: "你是文字處理引擎。只輸出處理後的最終文字，不要加入前言、說明、標題、引號或 Markdown 程式碼框。",
      },
      {
        role: "user",
        content: customPrompt || prompts[mode] || prompts.optimize,
      },
    ];
  }

  async processTextWithAI(text, mode = "optimize", customPrompt = null, { requireEnabled = false, workflow, scopeHandle, metricId, profile: selectedProfile } = {}) {
    const startedAt = Date.now();
    let usedExternalContext = false;
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      if (requireEnabled && !customPrompt && (mode === 'optimize' || mode === 'optimize_long')
        && await this.databaseManager.getSetting('enable_ai_optimization', false) !== true) {
        return { success: false, code: 'polishing_disabled', error: 'AI 潤稿已關閉' };
      }
      const config = await this._loadConfig();
      if (config.provider === "ollama" && !customPrompt && (mode === "optimize" || mode === "optimize_long") && [...text].length > MAX_TRANSCRIPT_CHARS) {
        return {
          success: false,
          error: `逐字稿超過 ${MAX_TRANSCRIPT_CHARS} 字的本機潤稿上限`,
          code: "input_over_limit",
        };
      }
      const isTranscriptPolishing = !customPrompt
        && (mode === "optimize" || mode === "optimize_long");
      const polishingPrompt = isTranscriptPolishing
        ? await this.getTranscriptPolishingPrompt()
        : DEFAULT_TRANSCRIPT_POLISHING_PROMPT;
      const adapter = config.provider === "ollama"
        ? this.adapters.ollama
        : this.adapters.openAICompatible;
      const { PROFILES, appendData, withinBudget } = require('./polishingContext');
      const savedProfile = await this.databaseManager.getSetting('writing_profile', 'neutral');
      const wordScope = this.wordScopes?.get(scopeHandle);
      const mappings = await this.databaseManager.getSetting('writing_profile_apps', {});
      const requestedProfile = selectedProfile || (savedProfile === 'auto' ? mappings?.[wordScope?.bundleId] : savedProfile);
      const profile = isTranscriptPolishing && Object.hasOwn(PROFILES, requestedProfile) ? requestedProfile : 'neutral';
      let messages = appendData(this._messages(text, mode, customPrompt, polishingPrompt), profile, null);
      let contextStatus = 'off';
      if (isTranscriptPolishing && mode === 'optimize' && workflow === 'automatic_offline' && config.provider === 'ollama' && this.contextManager
          && await this.databaseManager.getSetting('context_aware_polishing_enabled', false) === true
          && await this.databaseManager.getSetting('enable_ai_optimization', false) === true) {
        const started = require('node:perf_hooks').performance.now();
        const snapshot = await this.contextManager.capture();
        contextStatus = snapshot.status;
        if (snapshot.handle) {
          const data = await this.contextManager.consume(snapshot.handle); contextStatus = data.status;
          if (data.status === 'available') {
            let contextual = appendData(this._messages(text, mode, customPrompt, polishingPrompt), profile, data.text);
            const calibration = await this.databaseManager.getSetting('context_budget_v1', null);
            let current = null;
            if (calibration) {
              try { current = await this.ollamaRuntime.fetchJson('/api/tags', { signal: controller.signal }); }
              catch { controller.signal.throwIfAborted(); }
            }
            const digest = current?.models?.find(m => m.name === config.model || m.model === config.model)?.digest;
            if (calibration?.digest && calibration.digest === digest) {
              const bounded = { ...data.text };
              for (const field of ['after', 'before', 'selected']) {
                while (bounded[field] && !withinBudget(contextual, calibration, config.model, polishingPrompt)) {
                  bounded[field] = [...bounded[field]].slice(0, -1).join('');
                  contextual = appendData(this._messages(text, mode, customPrompt, polishingPrompt), profile, bounded);
                }
              }
              if (Object.values(bounded).some(Boolean) && withinBudget(contextual, calibration, config.model, polishingPrompt)) { messages = contextual; usedExternalContext = true; }
              else contextStatus = 'omitted_budget';
            } else contextStatus = 'omitted_budget';
          }
        }
        this.latencyManager?.record(metricId, 'context', contextStatus === 'available' ? 'success' : 'skipped', contextStatus === 'available' ? require('node:perf_hooks').performance.now() - started : null);
      }
      this.latencyManager?.classify(metricId, config.provider === 'ollama' ? 'ollama' : 'openai_compatible');
      controller.signal.throwIfAborted();
      const result = await adapter.process({
        ...config,
        messages,
        timeoutMs: 60000,
        signal: controller.signal,
        ...(usedExternalContext ? { maxOutputTokens: 512 } : {}),
      });

      if (this.stopping) {
        return {
          success: false,
          error: "應用程式正在結束",
          code: "runtime_stopping",
          cancelled: true,
        };
      }

      controller.signal.throwIfAborted();

      if (!result.success) return result;
      const finalText = this._stripAIPreamble(result.text);
      if (!finalText) {
        return { success: false, error: "AI 未回傳可用文字", code: "invalid_response" };
      }
      return { ...result, text: finalText, contextStatus, writingProfile: profile };
    } catch (error) {
      if (this.stopping) {
        return {
          success: false,
          error: "應用程式正在結束",
          code: "runtime_stopping",
          cancelled: true,
        };
      }
      if (controller.signal.aborted) {
        return { success: false, code: 'polishing_disabled', error: 'AI 潤稿已關閉' };
      }
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      const connection = /ENOTFOUND|ECONNREFUSED|fetch failed/i.test(error.message || "");
      const code = error.code || (timeout ? "timeout" : connection ? "connection_failed" : "provider_error");
      this.logger.error("AI request failed", {
        code,
        durationMs: Date.now() - startedAt,
      });
      return {
        success: false,
        error: timeout
          ? "AI 請求逾時"
          : connection
            ? "無法連線到 AI 服務"
            : usedExternalContext ? '本機情境潤稿失敗' : error.message || "文字處理失敗",
        code,
      };
    } finally {
      this.requests.delete(controller);
    }
  }

  async checkAIStatus(testConfig = null) {
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const config = await this._loadConfig(testConfig);
      const adapter = config.provider === "ollama"
        ? this.adapters.ollama
        : this.adapters.openAICompatible;
      controller.signal.throwIfAborted();
      const result = await adapter.process({
        ...config,
        messages: [{ role: "user", content: "請只回覆：測試成功" }],
        timeoutMs: 20000,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();

      if (!result.success) {
        return { available: false, error: result.error, details: result.error };
      }
      return {
        available: true,
        model: config.model,
        status: "connected",
        response: result.text,
        usage: result.usage,
        details: `成功連線到 ${config.model}`,
      };
    } catch (error) {
      return { available: false, error: error.message, details: error.message };
    } finally {
      this.requests.delete(controller);
    }
  }

  async listOllamaModels() {
    try {
      const models = await this.ollamaRuntime.listModels();
      return { success: true, models };
    } catch (error) {
      this.logger.error("Ollama model discovery failed", {
        code: error.code || "model_discovery_failed",
      });
      return {
        success: false,
        models: [],
        error: error.message,
        code: error.code || "model_discovery_failed",
      };
    }
  }

  async calibrateContextBudget() {
    const controller = new AbortController(); this.requests.add(controller);
    try {
      const config = await this._loadConfig();
      if (config.provider !== 'ollama') return { success: false, error: '請先選擇本機 Ollama。' };
      const info = await this.ollamaRuntime.fetchJson('/api/show', { method: 'POST', body: { model: config.model, verbose: true }, signal: controller.signal });
      const modelInfo = info.model_info || {};
      const tokens = new Set(modelInfo['tokenizer.ggml.tokens'] || []);
      const bytes = [...Array(256).keys()];
      const visible = bytes.filter(b => (b >= 33 && b <= 126) || (b >= 161 && b <= 172) || b >= 174);
      let extra = 256;
      const alphabet = bytes.map(b => visible.includes(b) ? String.fromCodePoint(b) : String.fromCodePoint(extra++));
      if (modelInfo['tokenizer.ggml.model'] !== 'gpt2' || !alphabet.every(c => tokens.has(c))) return { success: false, error: '此模型的文字預算尚無法可靠驗證。' };
      const prompt = await this.getTranscriptPolishingPrompt();
      const messages = [{ role: 'system', content: '' }, { role: 'user', content: '' }, { role: 'user', content: '' }];
      const result = await this.ollamaRuntime.fetchJson('/api/chat', { method: 'POST', body: { model: config.model, messages, stream: false, think: false, keep_alive: '10m', options: { num_ctx: 2048, num_predict: 8, temperature: 0 } }, timeoutMs: 60000, signal: controller.signal });
      if (!Number.isFinite(result.prompt_eval_count)) return { success: false, error: '模型未回報預算觀測值。' };
      const tags = await this.ollamaRuntime.fetchJson('/api/tags', { signal: controller.signal });
      const digest = tags.models?.find(m => m.name === config.model || m.model === config.model)?.digest;
      if (!digest) return { success: false, error: '無法確認模型版本。' };
      const { hash } = require('./polishingContext');
      const framingAllowance = Math.max(32, Math.ceil(result.prompt_eval_count) + 32);
      const calibration = { version: 1, model: config.model, digest, instructionHash: hash(prompt), byteFallbackVerified: true, framingAllowance, measuredPromptTokens: result.prompt_eval_count };
      controller.signal.throwIfAborted();
      await this.databaseManager.setSetting('context_budget_v1', calibration);
      return { success: true, measuredPromptTokens: result.prompt_eval_count };
    } catch { return { success: false, error: '本機文字預算驗證失敗。' }; }
    finally { this.requests.delete(controller); }
  }

  shutdown() {
    this.stopping = true;
    for (const controller of this.requests) controller.abort();
    this.ollamaRuntime.shutdown();
  }

  disableOptimization() {
    for (const controller of this.requests) controller.abort();
    return this.ollamaRuntime.releaseResources();
  }
}

module.exports = AITextProcessor;
module.exports.inferLegacyProvider = inferLegacyProvider;
module.exports.MAX_TRANSCRIPT_CHARS = MAX_TRANSCRIPT_CHARS;

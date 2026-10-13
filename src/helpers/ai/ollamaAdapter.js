const OLLAMA_CHAT_ENDPOINT = "http://127.0.0.1:11434/api/chat";

class OllamaAdapter {
  constructor({ logger, fetchImpl = globalThis.fetch, runtime = null } = {}) {
    if (!logger) throw new Error("OllamaAdapter 需要 LogManager");
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.runtime = runtime;
  }

  async process({ model, messages, supportsThinking, timeoutMs = 60000, signal }) {
    if (!model) {
      return { success: false, error: "尚未選擇 Ollama 模型", code: "model_missing" };
    }

    const selectedModel = model;
    await this.runtime?.releasing;
    signal?.throwIfAborted();
    const requestControl = this.runtime?.createRequestSignal?.(timeoutMs, signal);
    const requestSignal = requestControl?.signal || (signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs));
    const startedAt = Date.now();
    try {
      await this.runtime?.ensureServer({ signal: requestSignal });
      requestSignal.throwIfAborted();
      const thinking = supportsThinking ?? (
        this.runtime?.getModelSupportsThinking
          ? await this.runtime.getModelSupportsThinking(selectedModel, requestSignal)
          : this.runtime?.modelSupportsThinking(selectedModel) ?? false
      );
      requestSignal.throwIfAborted();
      const payload = {
        model: selectedModel,
        messages,
        stream: false,
        keep_alive: "10m",
        options: {
          temperature: 0,
          num_ctx: 2048,
        },
      };
      if (thinking) payload.think = false;
      this.runtime?.trackModel?.(selectedModel);

      const response = await this.fetchImpl(OLLAMA_CHAT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: requestSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let message = errorText || response.statusText || `HTTP ${response.status}`;
        try {
          const data = JSON.parse(errorText);
          message = data.error || message;
        } catch {
          // Plain-text Ollama errors are valid diagnostics.
        }
        throw new Error(message);
      }

      const data = await response.json();
      requestSignal.throwIfAborted();
      const content = data.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        return { success: false, error: "Ollama 未回傳可用文字", code: "invalid_response" };
      }

      this.logger.info("AI request completed", {
        provider: "ollama",
        model: selectedModel,
        durationMs: Date.now() - startedAt,
      });
      return {
        success: true,
        text: content,
        model: selectedModel,
      };
    } finally {
      requestControl?.release();
    }
  }
}

module.exports = OllamaAdapter;

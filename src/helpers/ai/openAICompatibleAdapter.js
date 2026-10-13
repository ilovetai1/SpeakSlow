class OpenAICompatibleAdapter {
  constructor({ logger, fetchImpl = globalThis.fetch } = {}) {
    if (!logger) throw new Error("OpenAICompatibleAdapter 需要 LogManager");
    this.logger = logger;
    this.fetchImpl = fetchImpl;
  }

  _endpoint(baseUrl) {
    const normalized = String(baseUrl || "").replace(/\/+$/, "");
    return normalized.endsWith("/chat/completions")
      ? normalized
      : `${normalized}/chat/completions`;
  }

  async process({ apiKey, baseUrl, model, messages, timeoutMs = 60000, signal }) {
    if (!apiKey) {
      return { success: false, error: "請先在設定頁面配置 AI API key", code: "api_key_missing" };
    }

    const startedAt = Date.now();
    const response = await this.fetchImpl(this._endpoint(baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 2000,
        stream: false,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText || response.statusText || `HTTP ${response.status}`;
      try {
        const data = JSON.parse(errorText);
        message = data.error?.message || data.error || message;
      } catch {
        // Plain-text provider errors are valid diagnostics.
      }
      throw new Error(message);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { success: false, error: "AI API 回應格式錯誤", code: "invalid_response" };
    }

    this.logger.info("AI request completed", {
      provider: "openai-compatible",
      model,
      durationMs: Date.now() - startedAt,
    });
    return { success: true, text: content, usage: data.usage, model };
  }
}

module.exports = OpenAICompatibleAdapter;

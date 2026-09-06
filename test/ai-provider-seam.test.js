const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const AITextProcessor = require("../src/helpers/aiTextProcessor");

function createSettingsDatabase(initialSettings) {
  const settings = new Map(Object.entries(initialSettings));
  const writes = [];

  return {
    writes,
    getSetting(key, defaultValue) {
      return settings.has(key) ? settings.get(key) : defaultValue;
    },
    setSetting(key, value) {
      writes.push([key, value]);
      settings.set(key, value);
    },
  };
}

const logger = { info() {}, warn() {}, error() {} };

test("Ollama provider 不需要 API key，並透過主程序使用原生 loopback API", { concurrency: false }, async () => {
  const database = createSettingsDatabase({
    ai_provider: "ollama",
    ai_model: "qwen3:1.7b",
    enable_ai_optimization: true,
    paste_after_transcription: false,
    auto_enter_after_paste: true,
  });
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: "整理後文字" }, done: true }),
    };
  };

  try {
    const processor = new AITextProcessor(database, logger);
    const result = await processor.processTextWithAI("原始文字", "optimize");
    const chatCall = calls.find((call) => call.url.endsWith("/api/chat"));

    assert.equal(result.success, true);
    assert.equal(result.text, "整理後文字");
    assert.equal(chatCall.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(chatCall.body.model, "qwen3:1.7b");
    assert.equal(chatCall.body.stream, false);
    assert.equal(chatCall.body.keep_alive, "10m");
    assert.deepEqual(chatCall.body.options, { temperature: 0, num_ctx: 2048 });
    assert.equal(database.writes.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("缺少 ai_provider 的既有遠端設定保持原 URL、model、key 與開關，不自動改寫", { concurrency: false }, async () => {
  const database = createSettingsDatabase({
    ai_api_key: "existing-secret",
    ai_base_url: "https://api.deepseek.com",
    ai_model: "deepseek-v4-flash",
    enable_ai_optimization: false,
    paste_after_transcription: true,
    auto_enter_after_paste: false,
  });
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "remote result" } }],
        usage: { total_tokens: 5 },
      }),
    };
  };

  try {
    const processor = new AITextProcessor(database, logger);
    const result = await processor.processTextWithAI("legacy settings", "optimize");

    assert.equal(result.success, true);
    assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
    assert.equal(calls[0].body.model, "deepseek-v4-flash");
    assert.equal(calls[0].options.headers.Authorization, "Bearer existing-secret");
    assert.equal(database.writes.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

for (const [provider, baseUrl] of [
  ["deepseek", "https://api.deepseek.com"],
  ["openai", "https://api.openai.com/v1"],
  ["gemini", "https://generativelanguage.googleapis.com/v1beta/openai"],
  ["custom", "https://example.test/v1"],
]) {
  test(`${provider} 使用既有 OpenAI-compatible request contract`, { concurrency: false }, async () => {
    const database = createSettingsDatabase({
      ai_provider: provider,
      ai_api_key: `${provider}-secret`,
      ai_base_url: baseUrl,
      ai_model: `${provider}-model`,
    });
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      };
    };

    try {
      const result = await new AITextProcessor(database, logger)
        .processTextWithAI("remote input", "optimize");
      assert.equal(result.success, true);
      assert.equal(calls[0].url, `${baseUrl}/chat/completions`);
      assert.equal(calls[0].body.model, `${provider}-model`);
      assert.equal(calls[0].body.keep_alive, undefined);
      assert.equal(calls[0].options.headers.Authorization, `Bearer ${provider}-secret`);
    } finally {
      global.fetch = originalFetch;
    }
  });
}

test("renderer 不讀取 provider secret，也不直接 fetch provider", () => {
  const source = [
    "../src/App.jsx",
    "../src/hooks/useRecording.js",
    "../src/settings.jsx",
    "../src/components/HistoryView.jsx",
  ].map((file) => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");

  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /getSetting\(['"]ai_api_key['"]\)/);
  assert.doesNotMatch(source, /allSettings\.ai_api_key/);
  assert.doesNotMatch(source, /localStorage\.getItem\(['"]ai_api_key['"]\)/);
  assert.match(source, /electronAPI\.processText\(/);
});

test("AI diagnostics 不記錄 transcript、prompt、response 或 secret", { concurrency: false }, async () => {
  const entries = [];
  const capturingLogger = {
    info(...args) { entries.push(args); },
    warn(...args) { entries.push(args); },
    error(...args) { entries.push(args); },
  };
  const database = createSettingsDatabase({
    ai_provider: "deepseek",
    ai_api_key: "TOP-SECRET-KEY",
    ai_base_url: "https://api.deepseek.com",
    ai_model: "deepseek-chat",
  });
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "PRIVATE-RESPONSE" } }] }),
  });

  try {
    await new AITextProcessor(database, capturingLogger)
      .processTextWithAI("PRIVATE-TRANSCRIPT", "optimize");
    const serialized = JSON.stringify(entries);
    assert.doesNotMatch(serialized, /PRIVATE-TRANSCRIPT/);
    assert.doesNotMatch(serialized, /PRIVATE-RESPONSE/);
    assert.doesNotMatch(serialized, /TOP-SECRET-KEY/);
    assert.doesNotMatch(serialized, /待編輯的資料/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("app shutdown 後忽略 provider 的 late response", async () => {
  let finishRequest;
  const adapter = {
    process: () => new Promise((resolve) => { finishRequest = resolve; }),
  };
  const database = createSettingsDatabase({
    ai_provider: "deepseek",
    ai_api_key: "secret",
    ai_base_url: "https://api.deepseek.com",
    ai_model: "deepseek-chat",
  });
  const processor = new AITextProcessor(database, logger, { openAICompatible: adapter });
  const request = processor.processTextWithAI("不得在結束後輸出", "optimize");
  await new Promise((resolve) => setImmediate(resolve));

  processor.shutdown();
  finishRequest({ success: true, text: "太晚的結果" });
  const result = await request;

  assert.deepEqual(result, {
    success: false,
    error: "應用程式正在結束",
    code: "runtime_stopping",
    cancelled: true,
  });
});

test("app shutdown 導致 AbortError 時回傳 cancelled，不誤判 timeout", async () => {
  let rejectRequest;
  const adapter = {
    process: () => new Promise((resolve, reject) => { rejectRequest = reject; }),
  };
  const database = createSettingsDatabase({
    ai_provider: "deepseek",
    ai_api_key: "secret",
    ai_base_url: "https://api.deepseek.com",
    ai_model: "deepseek-chat",
  });
  const processor = new AITextProcessor(database, logger, { openAICompatible: adapter });
  const request = processor.processTextWithAI("不得在結束後 fallback", "optimize");
  await new Promise((resolve) => setImmediate(resolve));

  processor.shutdown();
  rejectRequest(new DOMException("aborted", "AbortError"));

  assert.deepEqual(await request, {
    success: false,
    error: "應用程式正在結束",
    code: "runtime_stopping",
    cancelled: true,
  });
});

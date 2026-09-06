const assert = require("node:assert/strict");
const test = require("node:test");

const OllamaRuntime = require("../src/helpers/ai/ollamaRuntime");
const OllamaAdapter = require("../src/helpers/ai/ollamaAdapter");
const logger = { info() {}, warn() {}, error() {} };

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

test("模型探索只保留 completion，排除 embedding-only 與明確 Cloud model", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/tags")) {
      return jsonResponse({
        models: [
          { name: "qwen3:1.7b", size: 1400000000, details: { parameter_size: "1.7B", quantization_level: "Q4_K_M" } },
          { name: "nomic-embed-text:latest", size: 300000000 },
          { name: "gpt-oss:120b-cloud", size: 0 },
        ],
      });
    }
    const body = JSON.parse(options.body);
    if (body.model === "qwen3:1.7b") {
      return jsonResponse({ capabilities: ["completion", "thinking"], details: { parameter_size: "1.7B", quantization_level: "Q4_K_M" } });
    }
    if (body.model === "nomic-embed-text:latest") {
      return jsonResponse({ capabilities: ["embedding"] });
    }
    return jsonResponse({ capabilities: ["completion"] });
  };
  const runtime = new OllamaRuntime({ fetchImpl });

  const models = await runtime.listModels();

  assert.equal(models.length, 1);
  assert.deepEqual(models[0], {
    name: "qwen3:1.7b",
    size: 1400000000,
    parameterSize: "1.7B",
    quantization: "Q4_K_M",
    supportsThinking: true,
  });
  assert.equal(calls.some((call) => call.url.endsWith("/api/show")), true);
});

test("Ollama adapter snapshot model 並固定低資源原生 chat payload", async () => {
  const calls = [];
  let immediateUnloadChecks = 0;
  const runtime = {
    ensureServer: async () => {},
    modelSupportsThinking: (model) => model === "qwen3:1.7b",
    confirmUnloaded: async () => {
      immediateUnloadChecks += 1;
      return { unloaded: true };
    },
  };
  const adapter = new OllamaAdapter({
    logger,
    runtime,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse({ message: { content: "完成" }, done: true });
    },
  });
  const config = { model: "qwen3:1.7b" };
  const request = adapter.process({ ...config, messages: [{ role: "user", content: "文字" }] });
  config.model = "other:model";
  const result = await request;

  assert.equal(result.success, true);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/chat");
  assert.deepEqual(calls[0].body, {
    model: "qwen3:1.7b",
    messages: [{ role: "user", content: "文字" }],
    stream: false,
    keep_alive: "10m",
    options: { temperature: 0, num_ctx: 2048 },
    think: false,
  });
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.equal(immediateUnloadChecks, 0);
});

test("runtime 建構不啟動 server 或載入模型，並共用既有外部 server", async () => {
  let fetchCount = 0;
  let spawnCount = 0;
  const runtime = new OllamaRuntime({
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse({ models: [] });
    },
    spawnImpl: () => {
      spawnCount += 1;
      return null;
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(spawnCount, 0);
  assert.deepEqual(await runtime.ensureServer(), { owned: false });
  runtime.shutdown();
  assert.equal(spawnCount, 0);
});

test("找不到外部 server 時只在 Apple Silicon 啟動 Cloud-disabled owned process，quit 時停止", async () => {
  let healthAttempts = 0;
  const spawnCalls = [];
  let killedWith = null;
  const ownedProcess = {
    killed: false,
    once() {},
    kill(signal) {
      killedWith = signal;
      this.killed = true;
    },
  };
  const runtime = new OllamaRuntime({
    platform: "darwin",
    arch: "arm64",
    accessImpl: () => {},
    delayImpl: async () => {},
    fetchImpl: async () => {
      healthAttempts += 1;
      if (healthAttempts === 1) throw new Error("ECONNREFUSED");
      return jsonResponse({ models: [] });
    },
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      return ownedProcess;
    },
  });

  assert.deepEqual(await runtime.ensureServer(), { owned: true });
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(spawnCalls[0].args, ["serve"]);
  assert.equal(spawnCalls[0].options.env.OLLAMA_NO_CLOUD, "1");
  assert.equal(spawnCalls[0].options.env.OLLAMA_HOST, "127.0.0.1:11434");

  runtime.shutdown();
  assert.equal(killedWith, "SIGTERM");
});

test("shutdown 取消所有 in-flight Ollama request", () => {
  const runtime = new OllamaRuntime();
  const request = runtime.createRequestSignal(60000);
  assert.equal(request.signal.aborted, false);

  runtime.shutdown();

  assert.equal(request.signal.aborted, true);
});

test("有效回應交由 Ollama 的 10 分鐘 idle TTL 管理，不執行立即卸載", async () => {
  let immediateUnloadChecks = 0;
  const adapter = new OllamaAdapter({
    logger,
    runtime: {
      ensureServer: async () => {},
      modelSupportsThinking: () => false,
      confirmUnloaded: async () => {
        immediateUnloadChecks += 1;
        throw new Error("不應呼叫立即卸載確認");
      },
    },
    fetchImpl: async () => jsonResponse({ message: { content: "有效結果" }, done: true }),
  });

  const result = await adapter.process({
    model: "qwen3:1.7b",
    messages: [{ role: "user", content: "原文" }],
  });

  assert.equal(result.success, true);
  assert.equal(result.text, "有效結果");
  assert.equal(result.resourceIssue, undefined);
  assert.equal(immediateUnloadChecks, 0);
});

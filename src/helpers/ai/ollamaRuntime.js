const fs = require("node:fs");
const { spawn } = require("node:child_process");

const OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const EXECUTABLE_CANDIDATES = [
  "/opt/homebrew/bin/ollama",
  "/usr/local/bin/ollama",
  "/Applications/Ollama.app/Contents/Resources/ollama",
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExplicitCloudModel(name) {
  return /(?:^|[:_-])cloud(?:$|[:_-])/i.test(String(name || ""))
    || String(name || "").startsWith("cloud://");
}

class OllamaRuntime {
  constructor({
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
    accessImpl = fs.accessSync,
    delayImpl = delay,
    platform = process.platform,
    arch = process.arch,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.accessImpl = accessImpl;
    this.delayImpl = delayImpl;
    this.platform = platform;
    this.arch = arch;
    this.ownedProcess = null;
    this.stopping = false;
    this.requestControllers = new Map();
    this.usedModels = new Set();
    this.releasing = null;
    this.modelCapabilities = new Map();
  }

  async _healthCheck(timeoutMs = 1500, signal) {
    const response = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/tags`, {
      method: "GET",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Ollama health check HTTP ${response.status}`);
    return response.json();
  }

  _findExecutable() {
    for (const executable of EXECUTABLE_CANDIDATES) {
      try {
        this.accessImpl(executable, fs.constants.X_OK);
        return executable;
      } catch {
        // Continue through the explicit executable candidates.
      }
    }
    return null;
  }

  async ensureServer({ signal } = {}) {
    signal?.throwIfAborted();
    if (this.stopping) {
      const error = new Error("Ollama runtime 正在停止");
      error.code = "runtime_stopping";
      throw error;
    }

    try {
      await this._healthCheck(1500, signal);
      signal?.throwIfAborted();
      return { owned: Boolean(this.ownedProcess) };
    } catch {
      signal?.throwIfAborted();
      // Starting an installed server is the defined path when loopback is absent.
    }

    if (this.platform !== "darwin" || this.arch !== "arm64") {
      const error = new Error("此版本只支援在 macOS Apple Silicon 自動啟動 Ollama");
      error.code = "unsupported_auto_start";
      throw error;
    }

    const executable = this._findExecutable();
    if (!executable) {
      const error = new Error("找不到 Ollama 執行檔");
      error.code = "ollama_not_installed";
      throw error;
    }

    if (!this.ownedProcess) {
      this.ownedProcess = this.spawnImpl(executable, ["serve"], {
        env: {
          ...process.env,
          OLLAMA_HOST: "127.0.0.1:11434",
          OLLAMA_NO_CLOUD: "1",
        },
        stdio: "ignore",
        windowsHide: true,
      });
      const child = this.ownedProcess;
      child.once?.("exit", () => {
        if (this.ownedProcess === child) this.ownedProcess = null;
      });
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      signal?.throwIfAborted();
      try {
        await this._healthCheck(500, signal);
        signal?.throwIfAborted();
        return { owned: true };
      } catch {
        signal?.throwIfAborted();
        await this.delayImpl(250);
      }
    }

    const error = new Error("Ollama 啟動逾時");
    error.code = "ollama_start_timeout";
    throw error;
  }

  async listModels() {
    // 先追蹤探索請求，避免同 tick 關閉時漏掉尚未通過 await 的工作。
    const control = this.createRequestSignal(20000);
    try {
      await this.releasing;
      control.signal.throwIfAborted();
      return await this._listModels(control.signal);
    } finally {
      control.release();
    }
  }

  async _listModels(signal) {
    await this.ensureServer({ signal });
    signal.throwIfAborted();
    const response = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/tags`, {
      method: "GET",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) throw new Error(`Ollama models HTTP ${response.status}`);
    const data = await response.json();
    const candidates = (Array.isArray(data.models) ? data.models : [])
      .filter((model) => !isExplicitCloudModel(model.name || model.model));
    const localModels = [];

    for (const model of candidates) {
      signal.throwIfAborted();
      const name = model.name || model.model;
      const showResponse = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (!showResponse.ok) {
        throw new Error(`Ollama model details HTTP ${showResponse.status}: ${name}`);
      }
      const shown = await showResponse.json();
      const capabilities = Array.isArray(shown.capabilities) ? shown.capabilities : [];
      if (!capabilities.includes("completion")) continue;

      this.modelCapabilities.set(name, new Set(capabilities));
      const details = { ...(model.details || {}), ...(shown.details || {}) };
      localModels.push({
        name,
        size: Number(model.size) || 0,
        parameterSize: details.parameter_size || "",
        quantization: details.quantization_level || "",
        supportsThinking: capabilities.includes("thinking"),
      });
    }
    return localModels;
  }

  modelSupportsThinking(model) {
    return this.modelCapabilities.get(model)?.has("thinking") === true;
  }

  async getModelSupportsThinking(model, signal) {
    if (this.modelCapabilities.has(model)) return this.modelSupportsThinking(model);
    const response = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Ollama model details HTTP ${response.status}`);
    const shown = await response.json();
    const capabilities = Array.isArray(shown.capabilities) ? shown.capabilities : [];
    this.modelCapabilities.set(model, new Set(capabilities));
    return capabilities.includes("thinking");
  }

  createRequestSignal(timeoutMs, callerSignal) {
    if (this.stopping) throw new Error('Ollama runtime 正在停止');
    const controller = new AbortController();
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    this.requestControllers.set(controller, finished);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeoutMs),
      ...(callerSignal ? [callerSignal] : []),
    ]);
    return {
      signal,
      release: () => {
        this.requestControllers.delete(controller);
        finish();
      },
    };
  }

  trackModel(model) {
    this.usedModels.add(model);
  }

  async fetchJson(endpoint, { method = 'GET', body, signal, timeoutMs = 5000 } = {}) {
    if (!['/api/tags', '/api/show', '/api/chat'].includes(endpoint)) throw new Error('unsupported_endpoint');
    const control = this.createRequestSignal(timeoutMs, signal);
    try {
      await this.releasing;
      control.signal.throwIfAborted();
      await this.ensureServer({ signal: control.signal });
      control.signal.throwIfAborted();
      if (endpoint === '/api/chat') this.trackModel(body.model);
      const response = await this.fetchImpl(`${OLLAMA_ORIGIN}${endpoint}`, {
        method, signal: control.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error('local_metadata_failed');
      const value = await response.json();
      control.signal.throwIfAborted();
      return value;
    } finally { control.release(); }
  }

  releaseResources() {
    if (this.releasing) return this.releasing;
    const finished = [...this.requestControllers.values()];
    for (const controller of this.requestControllers.keys()) controller.abort();
    this.releasing = (async () => {
      // 包含 server 啟動與能力查詢；等取消完成後才卸載，避免晚到請求重載模型。
      await Promise.all(finished);
      const child = this.ownedProcess;
      if (child) {
        await new Promise((resolve, reject) => {
          const onExit = () => { clearTimeout(timer); resolve(); };
          const timer = setTimeout(() => {
            child.removeListener('exit', onExit);
            reject(new Error('Ollama 停止逾時，AI 潤稿已關閉但資源尚未釋放'));
          }, 5000);
          child.once('exit', onExit);
          child.kill('SIGTERM');
        });
        if (this.ownedProcess === child) this.ownedProcess = null;
        this.usedModels.clear();
      } else {
        // 僅釋放此 runtime 使用過的模型，不啟動服務、不列舉或停止其他模型。
        for (const model of this.usedModels) {
          const response = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, keep_alive: 0, stream: false }),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) throw new Error(`Ollama 模型卸載失敗 HTTP ${response.status}`);
          const result = await response.json();
          if (result.done !== true || result.done_reason !== 'unload') {
            throw new Error('Ollama 未確認模型卸載');
          }
          this.usedModels.delete(model);
        }
      }
    })().finally(() => { this.releasing = null; });
    return this.releasing;
  }

  shutdown() {
    this.stopping = true;
    for (const controller of this.requestControllers.keys()) controller.abort();
    this.requestControllers.clear();
    if (this.ownedProcess && !this.ownedProcess.killed) {
      this.ownedProcess.kill("SIGTERM");
    }
    this.ownedProcess = null;
  }
}

module.exports = OllamaRuntime;
module.exports.OLLAMA_ORIGIN = OLLAMA_ORIGIN;
module.exports.isExplicitCloudModel = isExplicitCloudModel;

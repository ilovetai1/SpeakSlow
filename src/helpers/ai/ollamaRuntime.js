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
    this.requestControllers = new Set();
    this.modelCapabilities = new Map();
  }

  async _healthCheck(timeoutMs = 1500) {
    const response = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
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

  async ensureServer() {
    if (this.stopping) {
      const error = new Error("Ollama runtime 正在停止");
      error.code = "runtime_stopping";
      throw error;
    }

    try {
      await this._healthCheck();
      return { owned: false };
    } catch {
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
      this.ownedProcess.once?.("exit", () => {
        this.ownedProcess = null;
      });
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await this._healthCheck(500);
        return { owned: true };
      } catch {
        await this.delayImpl(250);
      }
    }

    const error = new Error("Ollama 啟動逾時");
    error.code = "ollama_start_timeout";
    throw error;
  }

  async listModels() {
    await this.ensureServer();
    const response = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Ollama models HTTP ${response.status}`);
    const data = await response.json();
    const candidates = (Array.isArray(data.models) ? data.models : [])
      .filter((model) => !isExplicitCloudModel(model.name || model.model));
    const localModels = [];

    for (const model of candidates) {
      const name = model.name || model.model;
      const showResponse = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
        signal: AbortSignal.timeout(5000),
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

  async getModelSupportsThinking(model) {
    if (this.modelCapabilities.has(model)) return this.modelSupportsThinking(model);
    const response = await this.fetchImpl(`${OLLAMA_ORIGIN}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Ollama model details HTTP ${response.status}`);
    const shown = await response.json();
    const capabilities = Array.isArray(shown.capabilities) ? shown.capabilities : [];
    this.modelCapabilities.set(model, new Set(capabilities));
    return capabilities.includes("thinking");
  }

  createRequestSignal(timeoutMs) {
    const controller = new AbortController();
    this.requestControllers.add(controller);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeoutMs),
    ]);
    return {
      signal,
      release: () => this.requestControllers.delete(controller),
    };
  }

  shutdown() {
    this.stopping = true;
    for (const controller of this.requestControllers) controller.abort();
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

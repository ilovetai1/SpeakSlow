/**
 * Python 解析層 — 從 sherpaManager 抽出（僅開發模式使用；
 * 打包版直接 spawn PyInstaller 的 sherpa_server.exe，不會走到這裡）。
 * 職責：尋找可用的 Python（嵌入式 → 系統）、版本檢查、環境變數建構。
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

class PythonResolver {
  constructor(logger = console, { userDataPath } = {}) {
    this.logger = logger;
    this.userDataPath = userDataPath;
    this.pythonCmd = null;
    this._cachedPythonEnv = null;
    this._lastEmbeddedCheck = null;
  }

  getEmbeddedPythonPath() {
    // 獲取嵌入式 Python 路徑
    const isDevelopment =
      process.env.NODE_ENV === "development" ||
      !require("electron").app?.isPackaged;

    if (isDevelopment) {
      return path.join(__dirname, "..", "..", "python", "bin", "python3.11");
    } else {
      return path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "python",
        "bin",
        "python3.11"
      );
    }
  }

  setupIsolatedEnvironment() {
    // 設置 Python 環境變量
    const embeddedPythonPath = this.getEmbeddedPythonPath();
    const isUsingEmbedded = fs.existsSync(embeddedPythonPath);

    if (isUsingEmbedded) {
      const pythonHome = path.dirname(path.dirname(embeddedPythonPath));
      const sitePackages = path.join(
        pythonHome,
        "lib",
        "python3.11",
        "site-packages"
      );

      process.env.PYTHONHOME = pythonHome;
      process.env.PYTHONPATH = sitePackages;
      process.env.PYTHONDONTWRITEBYTECODE = "1";
      process.env.PYTHONIOENCODING = "utf-8";
      process.env.PYTHONUNBUFFERED = "1";

      this.logger.info &&
        this.logger.info("設置嵌入式 Python 環境", {
          PYTHONHOME: process.env.PYTHONHOME,
          PYTHONPATH: process.env.PYTHONPATH,
          pythonExecutable: embeddedPythonPath,
        });
    } else {
      delete process.env.PYTHONHOME;
      delete process.env.PYTHONPATH;

      process.env.PYTHONDONTWRITEBYTECODE = "1";
      process.env.PYTHONIOENCODING = "utf-8";
      process.env.PYTHONUNBUFFERED = "1";

      this.logger.info &&
        this.logger.info("設置系統 Python 環境", {
          note: "清除嵌入式 Python 環境變量，使用系統 Python 默認環境",
          pythonExecutable: this.pythonCmd || "未確定",
        });
    }

    delete process.env.PYTHONUSERBASE;
    delete process.env.PYTHONSTARTUP;
    delete process.env.VIRTUAL_ENV;
  }

  buildPythonEnvironment() {
    // 構建完整的 Python 環境變量
    const embeddedPythonPath = this.getEmbeddedPythonPath();
    const isUsingEmbedded = fs.existsSync(embeddedPythonPath);

    if (
      this._cachedPythonEnv &&
      this._lastEmbeddedCheck === isUsingEmbedded
    ) {
      return this._cachedPythonEnv;
    }

    let env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUNBUFFERED: "1",
      ELECTRON_USER_DATA: this.userDataPath || require("electron").app.getPath("userData"),
    };

    if (isUsingEmbedded) {
      const pythonHome = path.dirname(path.dirname(embeddedPythonPath));
      const sitePackages = path.join(
        pythonHome,
        "lib",
        "python3.11",
        "site-packages"
      );

      env.PYTHONHOME = pythonHome;
      env.PYTHONPATH = sitePackages;
      env.LD_LIBRARY_PATH = path.join(pythonHome, "lib");
      env.DYLD_LIBRARY_PATH = path.join(pythonHome, "lib");

      if (
        !this._cachedPythonEnv ||
        this._lastEmbeddedCheck !== isUsingEmbedded
      ) {
        this.logger.info &&
          this.logger.info("構建嵌入式 Python 環境變量", {
            PYTHONHOME: env.PYTHONHOME,
            PYTHONPATH: env.PYTHONPATH,
          });
      }
    } else {
      if (
        !this._cachedPythonEnv ||
        this._lastEmbeddedCheck !== isUsingEmbedded
      ) {
        this.logger.info &&
          this.logger.info("構建系統 Python 環境變量", {
            note: "使用系統 Python 默認環境",
          });
      }
    }

    delete env.PYTHONUSERBASE;
    delete env.PYTHONSTARTUP;
    delete env.VIRTUAL_ENV;

    this._cachedPythonEnv = env;
    this._lastEmbeddedCheck = isUsingEmbedded;

    return env;
  }

  /**
   * 獲取模型緩存路徑
   */

  async findPythonExecutable() {
    if (this.pythonCmd) {
      return this.pythonCmd;
    }

    const embeddedPython = this.getEmbeddedPythonPath();

    this.logger.info &&
      this.logger.info("檢查嵌入式 Python", {
        path: embeddedPython,
        exists: fs.existsSync(embeddedPython),
      });

    if (fs.existsSync(embeddedPython)) {
      try {
        this.setupIsolatedEnvironment();

        const version = await this.getPythonVersion(embeddedPython);
        if (this.isPythonVersionSupported(version)) {
          this.pythonCmd = embeddedPython;
          this.logger.info &&
            this.logger.info("使用嵌入式 Python", {
              path: embeddedPython,
              version: `${version.major}.${version.minor}`,
            });
          return embeddedPython;
        }
      } catch (error) {
        this.logger.warn && this.logger.warn("嵌入式 Python 不可用", error);
      }
    }

    const isDevelopment =
      process.env.NODE_ENV === "development" ||
      !require("electron").app?.isPackaged;

    if (isDevelopment) {
      this.logger.warn && this.logger.warn("開發模式：回退到系統 Python");
      return await this.findPythonExecutableWithFallback();
    }

    throw new Error(
      "嵌入式 Python 環境不可用。請重新安裝應用或運行構建腳本準備 Python 環境。"
    );
  }

  async findPythonExecutableWithFallback() {
    const projectRoot = path.join(__dirname, "..", "..");

    const possiblePaths = [
      // Windows 路徑
      path.join(projectRoot, ".venv", "Scripts", "python.exe"),
      path.join(projectRoot, ".venv", "Scripts", "python3.exe"),
      // Unix/macOS 路徑
      path.join(projectRoot, ".venv", "bin", "python3.11"),
      path.join(projectRoot, ".venv", "bin", "python3"),
      path.join(projectRoot, ".venv", "bin", "python"),
      // 系統路徑
      "python3.11",
      "python3",
      "python",
      "/usr/bin/python3.11",
      "/usr/bin/python3",
      "/usr/local/bin/python3.11",
      "/usr/local/bin/python3",
      "/opt/homebrew/bin/python3.11",
      "/opt/homebrew/bin/python3",
      "/usr/bin/python",
      "/usr/local/bin/python",
    ];

    for (const pythonPath of possiblePaths) {
      try {
        const version = await this.getPythonVersion(pythonPath);
        if (this.isPythonVersionSupported(version)) {
          this.pythonCmd = pythonPath;
          return pythonPath;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error("未找到 Python 3.x。請安裝 Python 或使用 installPython()。");
  }

  async getPythonVersion(pythonPath) {
    return new Promise((resolve) => {
      const isEmbedded = pythonPath === this.getEmbeddedPythonPath();
      const env = isEmbedded ? this.buildPythonEnvironment() : process.env;

      const testProcess = spawn(pythonPath, ["--version"], { env: env });
      let output = "";

      testProcess.stdout.on("data", (data) => (output += data));
      testProcess.stderr.on("data", (data) => (output += data));

      testProcess.on("close", (code) => {
        if (code === 0) {
          const match = output.match(/Python (\d+)\.(\d+)/i);
          resolve(match ? { major: +match[1], minor: +match[2] } : null);
        } else {
          resolve(null);
        }
      });

      testProcess.on("error", () => resolve(null));
    });
  }

  isPythonVersionSupported(version) {
    return version && version.major === 3;
  }

}

module.exports = PythonResolver;

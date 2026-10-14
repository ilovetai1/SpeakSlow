const AITextProcessor = require("./aiTextProcessor");

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.sherpaManager = managers.sherpaManager;
    this.windowManager = managers.windowManager;
    this.hotkeyManager = managers.hotkeyManager;
    this.typelessManager = managers.typelessManager;
    this.logger = managers.logger;
    this.audioStore = new (require('./audioStore'))(this.logger);
    this.textUtilities = new (require('./textUtilityService'))(this.databaseManager, this.logger);
    const { AppleSpeechManager, defaultHelperPath } = require('./appleSpeechManager');
    const apple = new AppleSpeechManager({ logger: this.logger, helperPath: defaultHelperPath(require('electron').app) });
    this.speechEngineManager = new (require('./speechEngineManager').SpeechEngineManager)({ database: this.databaseManager, sherpa: this.sherpaManager, apple, audioStore: this.audioStore, textUtilities: this.textUtilities });
    this.aiProcessor = new AITextProcessor(this.databaseManager, this.logger);
    this.latencyManager = new (require('./latencyManager').LatencyManager)(this.databaseManager);
    this.contextManager = new (require('./contextManager').ContextManager)(this.databaseManager);
    this.learningManager = new (require('./correctionLearningManager').CorrectionLearningManager)(this.databaseManager, this.contextManager);
    this.aiProcessor.contextManager = this.contextManager;
    this.aiProcessor.latencyManager = this.latencyManager;
    this.wordScopes = new Map();
    this.aiProcessor.wordScopes = this.wordScopes;

    // 跟踪F2热键注册状态
    this.f2RegisteredSenders = new Set();

    this.setupHandlers();
  }

  setupHandlers() {
    // 各領域 IPC handler 註冊模組（行為與原單一檔案完全相同，僅搬移位置）
    require("./ipc/speech")(this);
    require("./ipc/transcription")(this);
    require("./ipc/database")(this);
    require("./ipc/dictionary")(this);
    require("./ipc/ai")(this);
    require("./ipc/window")(this);
    require("./ipc/hotkeys")(this);
    require("./ipc/system")(this);
    require("./ipc/emoji")(this);
    require('./ipc/evolution')(this);
  }

  async shutdown() {
    this.aiProcessor.shutdown();
    this.learningManager.stop();
    this.contextManager.shutdown();
    await Promise.all([this.speechEngineManager.dispose(), this.textUtilities.dispose()]);
  }


}

module.exports = IPCHandlers;

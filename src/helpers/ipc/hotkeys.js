const { ipcMain, BrowserWindow } = require("electron");
const { stopSpeaking } = require("../tts");

const TYPELESS_ACTION_ID = 'typeless-recording';
const HOTKEY_ENABLED_SETTING = 'hotkey_enabled';

module.exports = function register(ctx) {
  const getDefaultEnabledStates = () => ({
    [TYPELESS_ACTION_ID]: true,
    ...Object.fromEntries(
      Object.keys(ctx.hotkeyManager.getDefaultHotkeys()).map(actionId => [actionId, true])
    ),
  });

  const getEnabledStates = async () => {
    const savedStates = await ctx.databaseManager.getSetting(HOTKEY_ENABLED_SETTING, null);
    return { ...getDefaultEnabledStates(), ...(savedStates || {}) };
  };

  const broadcastHotkeyChange = (data) => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('hotkey-changed', data);
      }
    });
  };

  // 热键管理 - 添加发送者跟踪机制
  ctx.hotkeyRegisteredSenders = new Set(); // 跟踪已注册热键的发送者

  ipcMain.handle("register-hotkey", (event, hotkey) => {
    try {
      if (ctx.hotkeyManager) {
        const senderId = event.sender.id;

        // 检查是否已经为这个发送者注册过热键
        if (ctx.hotkeyRegisteredSenders.has(senderId)) {
          ctx.logger.info(`发送者 ${senderId} 已注册过热键，跳过重复注册`);
          return { success: true };
        }

        const success = ctx.hotkeyManager.registerHotkey(hotkey, () => {
          if (ctx.hotkeyManager.getRecordingState?.() === false) { ctx.latencyManager?.noteHotkey(); ctx.learningManager?.stop('recording_started'); }
          // 熱鍵觸發時同步儲存當前前景視窗（在主進程）
          // 使用 execSync 確保在發送事件前完成
          ctx.logger.info(`热键 ${hotkey} 被触发，同步儲存前景視窗`);
          try {
            const result = ctx.clipboardManager.saveForegroundWindow();
            ctx.logger.info('儲存前景視窗結果:', result);
          } catch (err) {
            ctx.logger.warn('儲存前景視窗失敗:', err.message);
          }

          // 發送热键触发事件到主窗口（在儲存視窗 handle 後）
          if (ctx.windowManager && ctx.windowManager.mainWindow && !ctx.windowManager.mainWindow.isDestroyed()) {
            ctx.windowManager.mainWindow.webContents.send("hotkey-triggered", { hotkey });
          }
        });

        if (success) {
          // 添加发送者到跟踪列表
          ctx.hotkeyRegisteredSenders.add(senderId);

          // 监听窗口关闭事件，清理注册记录
          event.sender.on('destroyed', () => {
            ctx.hotkeyRegisteredSenders.delete(senderId);
            ctx.logger.info(`清理发送者 ${senderId} 的热键注册记录`);
          });

          ctx.logger.info(`热键 ${hotkey} 注册成功，发送者: ${senderId}`);
        } else {
          ctx.logger.error(`热键 ${hotkey} 注册失败`);
        }

        return { success };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("注册热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("unregister-hotkey", (event, hotkey) => {
    try {
      if (ctx.hotkeyManager) {
        const success = ctx.hotkeyManager.unregisterHotkey(hotkey);
        return { success };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("注销热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-current-hotkey", () => {
    try {
      if (ctx.hotkeyManager) {
        const hotkeys = ctx.hotkeyManager.getRegisteredHotkeys();
        // 返回第一个非F2的热键，或默认热键
        const mainHotkey = hotkeys.find(key => key !== 'F2') || "CommandOrControl+Shift+Space";
        return mainHotkey;
      }
      return "CommandOrControl+Shift+Space";
    } catch (error) {
      ctx.logger.error("获取当前热键失败:", error);
      return "CommandOrControl+Shift+Space";
    }
  });

  // F2热键管理
  ipcMain.handle("register-f2-hotkey", (event) => {
    try {
      const senderId = event.sender.id;

      // 检查是否已经为这个发送者注册过F2热键
      if (ctx.f2RegisteredSenders.has(senderId)) {
        ctx.logger.info(`F2热键已为发送者 ${senderId} 注册过，跳过重复注册`);
        return { success: true };
      }

      if (ctx.hotkeyManager) {
        // 只有在没有任何发送者注册时才注册热键
        const isFirstRegistration = ctx.f2RegisteredSenders.size === 0;

        if (isFirstRegistration) {
          const success = ctx.hotkeyManager.registerF2DoubleClick((data) => {
            if (data.action === 'start') { ctx.latencyManager?.noteHotkey(); ctx.learningManager?.stop('recording_started'); }
            // 发送F2双击事件到所有注册的渲染进程
            ctx.logger.info("发送F2双击事件到渲染进程:", data);
            ctx.f2RegisteredSenders.forEach(id => {
              const window = require("electron").BrowserWindow.getAllWindows().find(w => w.webContents.id === id);
              if (window && !window.isDestroyed()) {
                window.webContents.send("f2-double-click", data);
              }
            });
          });

          if (!success) {
            return { success: false, error: "F2热键注册失败" };
          }
        }

        // 添加发送者到跟踪列表
        ctx.f2RegisteredSenders.add(senderId);

        // 监听窗口关闭事件，清理注册记录
        event.sender.on('destroyed', () => {
          ctx.f2RegisteredSenders.delete(senderId);
          ctx.logger.info(`清理发送者 ${senderId} 的F2热键注册记录`);

          // 如果没有发送者了，注销热键
          if (ctx.f2RegisteredSenders.size === 0) {
            ctx.hotkeyManager.unregisterHotkey('F2');
            ctx.logger.info('所有发送者都已注销，注销F2热键');
          }
        });

        return { success: true };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("注册F2热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("unregister-f2-hotkey", (event) => {
    try {
      const senderId = event.sender.id;

      if (ctx.hotkeyManager && ctx.f2RegisteredSenders.has(senderId)) {
        ctx.f2RegisteredSenders.delete(senderId);

        // 如果没有其他发送者注册F2热键，则注销热键
        if (ctx.f2RegisteredSenders.size === 0) {
          const success = ctx.hotkeyManager.unregisterHotkey('F2');
          ctx.logger.info('所有发送者都已注销，注销F2热键');
          return { success };
        } else {
          ctx.logger.info(`发送者 ${senderId} 已注销，但还有其他发送者注册了F2热键`);
          return { success: true };
        }
      }
      return { success: false, error: "热键管理器未初始化或未注册" };
    } catch (error) {
      ctx.logger.error("注销F2热键失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("set-recording-state", (event, isRecording) => {
    try {
      if (ctx.hotkeyManager) {
        ctx.hotkeyManager.setRecordingState(isRecording);
        return { success: true };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("设置录音状态失败:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("get-recording-state", () => {
    try {
      if (ctx.hotkeyManager) {
        const isRecording = ctx.hotkeyManager.getRecordingState();
        return { success: true, isRecording };
      }
      return { success: false, error: "热键管理器未初始化" };
    } catch (error) {
      ctx.logger.error("获取录音状态失败:", error);
      return { success: false, error: error.message };
    }
  });

  // =====================================================
  // TypeLess 模式（按住錄音）API
  // =====================================================

  // 啟用 TypeLess 模式
  ipcMain.handle("enable-typeless-mode", async (event, hotkey) => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }

      // TypeLess 使用「單擊切換」。觸發鍵預設右 Alt + 右 Ctrl,使用者可在設定頁更換
      //（issue #12:右 Alt/右 Ctrl 會跟其他軟體衝突)。從 DB 讀目前選擇,未設定則用預設。
      const triggerId = await ctx.databaseManager.getSetting('typeless_trigger', 'default');
      ctx.typelessManager.setTriggerById(triggerId);

      // 設置回調函數
      ctx.typelessManager.setCallbacks({
        onStartRecording: () => {
          ctx.latencyManager?.noteHotkey();
          ctx.learningManager?.stop('recording_started');
          ctx.logger.info('TypeLess: 觸發開始錄音');
          // 先儲存當前前景視窗
          try {
            const result = ctx.clipboardManager.saveForegroundWindow();
            ctx.logger.info('TypeLess: 儲存前景視窗結果:', result);
          } catch (err) {
            ctx.logger.warn('TypeLess: 儲存前景視窗失敗:', err.message);
          }
          // 發送開始錄音事件到渲染進程
          require("electron").BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send("typeless-start-recording");
          });
        },
        onStopRecording: () => {
          ctx.logger.info('TypeLess: 觸發停止錄音');
          // 發送停止錄音事件到渲染進程
          require("electron").BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send("typeless-stop-recording");
          });
        },
        onCancelRecording: () => {
          ctx.logger.info('TypeLess: 觸發取消錄音 (Esc)');
          // Esc 也順手停掉正在朗讀的語音（念到一半想停）：SAPI 後備殺程序 + 通知渲染端停 Edge MP3
          try { stopSpeaking(); } catch (e) { /* ignore */ }
          require("electron").BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send("tts-stop");
          });
          // 發送取消錄音事件到渲染進程（丟棄音訊、不轉錄、不貼上）
          require("electron").BrowserWindow.getAllWindows().forEach((w) => {
            if (!w.isDestroyed()) w.webContents.send("typeless-cancel-recording");
          });
        }
      });

      // 依使用者保存的獨立開關決定是否啟用，不在視窗重載時覆蓋停用狀態。
      const enabledStates = await getEnabledStates();
      const enabled = enabledStates[TYPELESS_ACTION_ID] !== false;
      if (enabled) {
        ctx.typelessManager.enable();
      } else {
        ctx.typelessManager.disable();
      }

      return { success: true, enabled };
    } catch (error) {
      ctx.logger.error("啟用 TypeLess 模式失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 停用 TypeLess 模式
  ipcMain.handle("disable-typeless-mode", async () => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }

      ctx.typelessManager.disable();
      return { success: true };
    } catch (error) {
      ctx.logger.error("停用 TypeLess 模式失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 獲取 TypeLess 模式狀態
  ipcMain.handle("get-typeless-status", () => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }

      return {
        success: true,
        enabled: ctx.typelessManager.isEnabled,
        isKeyDown: ctx.typelessManager.isKeyDown
      };
    } catch (error) {
      ctx.logger.error("獲取 TypeLess 狀態失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 同步真實錄音狀態給 TypeLess（避免快捷鍵切換與滑鼠點擊狀態打架）
  ipcMain.handle("sync-typeless-state", (event, isRecording) => {
    try {
      if (ctx.typelessManager) {
        ctx.typelessManager.syncActiveState(isRecording);
      }
      if (ctx.windowManager) {
        if (isRecording) ctx.windowManager.showTypelessIndicator();
        else ctx.windowManager.hideTypelessIndicator();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 設定 TypeLess 觸發鍵(issue #12:可自訂,避開與其他軟體衝突)。即時生效 + 存 DB。
  ipcMain.handle("set-typeless-trigger", async (event, triggerId) => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }
      ctx.typelessManager.setTriggerById(triggerId);
      await ctx.databaseManager.setSetting('typeless_trigger', triggerId);
      return { success: true };
    } catch (error) {
      ctx.logger.error("設定 TypeLess 觸發鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 更新 TypeLess 快捷鍵
  ipcMain.handle("set-typeless-hotkey", async (event, hotkey) => {
    try {
      if (!ctx.typelessManager) {
        return { success: false, error: "TypeLess 管理器未初始化" };
      }

      ctx.typelessManager.setHotkey(hotkey);
      return { success: true };
    } catch (error) {
      ctx.logger.error("設置 TypeLess 快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // =====================================================
  // 自定義快捷鍵設定 API
  // =====================================================

  // 獲取所有快捷鍵設定
  ipcMain.handle("get-hotkey-settings", async () => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }

      // 從資料庫讀取已保存的快捷鍵設定
      const savedHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', null);
      const defaultHotkeys = ctx.hotkeyManager.getDefaultHotkeys();
      const currentBindings = ctx.hotkeyManager.getHotkeyBindings();
      const enabled = await getEnabledStates();

      // 合併：預設值為基礎，已保存的設定覆蓋（確保新增的快捷鍵也會顯示）
      const mergedHotkeys = { ...defaultHotkeys, ...(savedHotkeys || {}), ...currentBindings };

      return {
        success: true,
        hotkeys: mergedHotkeys,
        defaults: defaultHotkeys,
        enabled,
      };
    } catch (error) {
      ctx.logger.error("獲取快捷鍵設定失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 獲取預設快捷鍵
  ipcMain.handle("get-hotkey-defaults", () => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }
      return {
        success: true,
        defaults: ctx.hotkeyManager.getDefaultHotkeys(),
      };
    } catch (error) {
      ctx.logger.error("獲取預設快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 驗證快捷鍵
  ipcMain.handle("validate-hotkey", (event, accelerator, excludeActionId = null) => {
    try {
      if (!ctx.hotkeyManager) {
        return { valid: false, error: "快捷鍵管理器未初始化" };
      }
      return ctx.hotkeyManager.validateHotkey(accelerator, excludeActionId);
    } catch (error) {
      ctx.logger.error("驗證快捷鍵失敗:", error);
      return { valid: false, error: error.message };
    }
  });

  // 設置單個快捷鍵
  ipcMain.handle("set-action-hotkey", async (event, actionId, accelerator) => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }

      // 註冊新快捷鍵
      const result = ctx.hotkeyManager.registerActionHotkey(actionId, accelerator);

      if (result.success) {
        // 保存到資料庫
        const currentHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', null) || {};
        currentHotkeys[actionId] = accelerator;
        await ctx.databaseManager.setSetting('custom_hotkeys', currentHotkeys);
        ctx.logger.info(`快捷鍵已更新: ${actionId} -> ${accelerator}`);

        // 廣播快捷鍵變更到所有視窗
        broadcastHotkeyChange({ actionId, accelerator, enabled: true });
      }

      return result;
    } catch (error) {
      ctx.logger.error("設置快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 獨立啟用或停用單一快捷鍵
  ipcMain.handle("set-hotkey-enabled", async (event, actionId, enabled) => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }
      if (typeof enabled !== 'boolean') {
        return { success: false, error: "快捷鍵啟用狀態必須是布林值" };
      }

      const defaultEnabledStates = getDefaultEnabledStates();
      if (!(actionId in defaultEnabledStates)) {
        return { success: false, error: `未知的快捷鍵操作: ${actionId}` };
      }

      if (actionId === TYPELESS_ACTION_ID) {
        if (!ctx.typelessManager) {
          return { success: false, error: "TypeLess 管理器未初始化" };
        }
        if (enabled) {
          ctx.typelessManager.enable();
        } else {
          ctx.typelessManager.disable();
        }
      } else if (enabled) {
        const savedHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', null);
        const accelerator = savedHotkeys?.[actionId]
          || ctx.hotkeyManager.getDefaultHotkeys()[actionId];
        const result = ctx.hotkeyManager.registerActionHotkey(actionId, accelerator);
        if (!result.success) return result;
      } else {
        ctx.hotkeyManager.unregisterActionHotkey(actionId);
      }

      const enabledStates = await getEnabledStates();
      enabledStates[actionId] = enabled;
      await ctx.databaseManager.setSetting(HOTKEY_ENABLED_SETTING, enabledStates);
      ctx.logger.info(`快捷鍵已${enabled ? '啟用' : '停用'}: ${actionId}`);
      broadcastHotkeyChange({ actionId, enabled });

      return { success: true, enabled };
    } catch (error) {
      ctx.logger.error("切換快捷鍵狀態失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 重設快捷鍵
  ipcMain.handle("reset-hotkeys", async (event, actionId = null) => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }

      const defaults = ctx.hotkeyManager.getDefaultHotkeys();
      const enabledStates = await getEnabledStates();
      let result;

      if (actionId) {
        const defaultAccelerator = defaults[actionId];
        if (!defaultAccelerator) {
          return { success: false, error: `未找到操作 ${actionId} 的預設快捷鍵` };
        }
        if (enabledStates[actionId] === false) {
          ctx.hotkeyManager.unregisterActionHotkey(actionId);
          result = { success: true };
        } else {
          result = ctx.hotkeyManager.registerActionHotkey(actionId, defaultAccelerator);
        }
      } else {
        const results = {};
        for (const [id, accelerator] of Object.entries(defaults)) {
          if (enabledStates[id] === false) {
            ctx.hotkeyManager.unregisterActionHotkey(id);
            results[id] = { success: true, enabled: false };
          } else {
            results[id] = ctx.hotkeyManager.registerActionHotkey(id, accelerator);
          }
        }
        result = {
          success: Object.values(results).every(item => item.success),
          results,
        };
      }

      if (result.success) {
        if (actionId) {
          // 更新資料庫中的單個快捷鍵
          const currentHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', null) || {};
          currentHotkeys[actionId] = defaults[actionId];
          await ctx.databaseManager.setSetting('custom_hotkeys', currentHotkeys);
        } else {
          // 重設所有：清除自定義設定
          await ctx.databaseManager.setSetting('custom_hotkeys', null);
        }
        ctx.logger.info(`快捷鍵已重設: ${actionId || '全部'}`);
      }

      return {
        success: result.success,
        hotkeys: defaults,
        enabled: enabledStates,
      };
    } catch (error) {
      ctx.logger.error("重設快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });

  // 初始化快捷鍵（從資料庫載入並註冊）
  ipcMain.handle("init-custom-hotkeys", async () => {
    try {
      if (!ctx.hotkeyManager) {
        return { success: false, error: "快捷鍵管理器未初始化" };
      }

      // 設置操作回調函數
      const self = ctx;

      // 開始/停止錄音
      ctx.hotkeyManager.setActionCallback('toggle-recording', (info) => {
        if (ctx.hotkeyManager.getRecordingState?.() === false) { ctx.latencyManager?.noteHotkey(); ctx.learningManager?.stop('recording_started'); }
        self.logger.info(`快捷鍵觸發: toggle-recording (${info.accelerator})`);
        // 儲存前景視窗
        try {
          self.clipboardManager.saveForegroundWindow();
        } catch (err) {
          self.logger.warn('儲存前景視窗失敗:', err.message);
        }
        // 發送事件到主視窗
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'toggle-recording' });
          // 也發送舊的事件以保持兼容性
          self.windowManager.mainWindow.webContents.send("hotkey-triggered", { hotkey: info.accelerator });
        }
      });

      // 取消錄音
      ctx.hotkeyManager.setActionCallback('cancel-recording', (info) => {
        self.logger.info(`快捷鍵觸發: cancel-recording (${info.accelerator})`);
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'cancel-recording' });
        }
      });

      // 顯示主視窗
      ctx.hotkeyManager.setActionCallback('show-window', (info) => {
        self.logger.info(`快捷鍵觸發: show-window (${info.accelerator})`);
        if (self.windowManager?.mainWindow) {
          if (self.windowManager.mainWindow.isMinimized()) {
            self.windowManager.mainWindow.restore();
          }
          self.windowManager.mainWindow.show();
          self.windowManager.mainWindow.focus();
        }
      });

      // 複製上次結果
      ctx.hotkeyManager.setActionCallback('copy-last', (info) => {
        self.logger.info(`快捷鍵觸發: copy-last (${info.accelerator})`);
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'copy-last' });
        }
      });

      // 切換操作模式（語音指令）
      ctx.hotkeyManager.setActionCallback('toggle-command-mode', (info) => {
        self.logger.info(`快捷鍵觸發: toggle-command-mode (${info.accelerator})`);
        if (self.windowManager?.mainWindow && !self.windowManager.mainWindow.isDestroyed()) {
          self.windowManager.mainWindow.webContents.send("hotkey-action", { actionId: 'toggle-command-mode' });
        }
      });

      // 從資料庫讀取設定，並與預設值合併（確保新增的快捷鍵也會被註冊）
      const savedHotkeys = await ctx.databaseManager.getSetting('custom_hotkeys', null);
      const defaults = ctx.hotkeyManager.getDefaultHotkeys();
      const enabledStates = await getEnabledStates();
      // 合併：預設值為基礎，已保存的設定覆蓋
      const hotkeyConfig = { ...defaults, ...(savedHotkeys || {}) };

      // 註冊所有快捷鍵
      // 略過已停用的錄音熱鍵：toggle-recording（已統一為 TypeLess 右 Alt）
      // 與 typeless-recording（由 TypelessManager 以 uiohook 處理，非 globalShortcut）
      const SKIP_ACTIONS = new Set(['toggle-recording', 'typeless-recording', 'cancel-recording']);
      const results = {};
      for (const [actionId, accelerator] of Object.entries(hotkeyConfig)) {
        if (SKIP_ACTIONS.has(actionId)) continue;
        if (enabledStates[actionId] === false) {
          ctx.hotkeyManager.unregisterActionHotkey(actionId);
          results[actionId] = { success: true, enabled: false };
          continue;
        }
        results[actionId] = ctx.hotkeyManager.registerActionHotkey(actionId, accelerator);
      }

      return {
        success: true,
        hotkeys: hotkeyConfig,
        enabled: enabledStates,
        results,
      };
    } catch (error) {
      ctx.logger.error("初始化快捷鍵失敗:", error);
      return { success: false, error: error.message };
    }
  });
};

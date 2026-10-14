const { ipcMain } = require("electron");

// 語音符號（內建 + 使用者自訂）。自訂存 DB 的 custom_emojis（JSON），
// 並即時送進 Python 後端合併進辨識後處理（apply_emoji）。
module.exports = function register(ctx) {
  // 啟動時把 DB 裡的自訂符號掛到 sherpaManager，後端 ready 時會自動送過去；
  // 若後端已就緒就直接送一次。
  try {
    const saved = ctx.databaseManager.getSetting("custom_emojis", {});
    const m = saved && typeof saved === "object" ? saved : {};
    ctx.sherpaManager.customEmojis = m;
    if (ctx.sherpaManager.serverReady && Object.keys(m).length) {
      ctx.sherpaManager.setCustomEmojis(m).catch(() => {});
    }
  } catch (e) { /* ignore */ }

  // 內建符號對照表（給設定頁顯示，唯讀）
  ipcMain.handle("get-builtin-emojis", async () => {
    try {
      const res = ctx.textUtilities.getEmojiMap();
      return { success: true, builtin: (res && res.builtin) || {} };
    } catch (e) {
      return { success: false, error: e.message, builtin: {} };
    }
  });

  // 使用者自訂符號（從 DB 讀）
  ipcMain.handle("get-custom-emojis", () => {
    try {
      const m = ctx.databaseManager.getSetting("custom_emojis", {});
      return { success: true, emojis: m && typeof m === "object" ? m : {} };
    } catch (e) {
      return { success: false, error: e.message, emojis: {} };
    }
  });

  // 設定自訂符號：清理 → 存 DB → 即時送後端
  ipcMain.handle("set-custom-emojis", async (_e, emojis) => {
    try {
      const clean = {};
      for (const [k, v] of Object.entries(emojis || {})) {
        const key = String(k || "").trim();
        const val = String(v || "");
        if (key && val) clean[key] = val;
      }
      ctx.databaseManager.setSetting("custom_emojis", clean);
      ctx.sherpaManager.customEmojis = clean; // 後端若重啟也能補回
      if (ctx.sherpaManager.serverReady) await ctx.sherpaManager.setCustomEmojis(clean);
      return { success: true, emojis: clean };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
};

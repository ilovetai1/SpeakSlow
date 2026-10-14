const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
class AudioStore {
  constructor(logger) { this.logger = logger || { info() {}, debug() {}, warn() {} }; }
  // 背景持久化錄音：立刻回傳目的路徑，複製與暫存清理非同步完成。
  _persistAudioInBackground(tempAudioPath) {
    try {
      const userDataPath = require("electron").app.getPath("userData");
      const audioDir = path.join(userDataPath, "audio");
      const destPath = path.join(audioDir, `rec_${crypto.randomUUID()}.wav`);
      (async () => {
        try {
          await fs.promises.mkdir(audioDir, { recursive: true });
          await fs.promises.copyFile(tempAudioPath, destPath);
        } catch (e) {
          this.logger.warn && this.logger.warn("保存錄音檔失敗:", e?.message || e);
        } finally {
          this.cleanupTempFile(tempAudioPath).catch(() => {});
        }
      })();
      return destPath;
    } catch (e) {
      this.cleanupTempFile(tempAudioPath).catch(() => {});
      return null;
    }
  }

  // 保留策略（建議 1）：刪掉 audio/ 裡超過 retentionDays 天的錄音檔，避免無限增長。
  // retentionDays <= 0 視為「永久保留」。被刪檔的歷史紀錄仍在,只是「重新辨識」會
  // 提示檔案不存在(既有的優雅處理)。開機時呼叫一次。
  async cleanupOldAudio(retentionDays) {
    try {
      const days = Number(retentionDays);
      if (!days || days <= 0) return { removed: 0 };
      const userDataPath = require("electron").app.getPath("userData");
      const audioDir = path.join(userDataPath, "audio");
      if (!fs.existsSync(audioDir)) return { removed: 0 };
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const files = await fs.promises.readdir(audioDir);
      let removed = 0;
      for (const f of files) {
        if (!f.toLowerCase().endsWith(".wav")) continue;
        const fp = path.join(audioDir, f);
        const st = await fs.promises.stat(fp).catch(() => null);
        if (st && st.mtimeMs < cutoff) {
          await fs.promises.unlink(fp).catch(() => {});
          removed++;
        }
      }
      if (removed && this.logger?.info) this.logger.info(`保留策略：清掉 ${removed} 個超過 ${days} 天的錄音檔`);
      return { removed };
    } catch (e) {
      this.logger?.warn && this.logger.warn("清理舊錄音失敗:", e?.message || e);
      return { removed: 0, error: e?.message };
    }
  }

  async createTempAudioFile(audioBlob) {
    const tempDir = os.tmpdir();
    const filename = `sherpa_audio_${crypto.randomUUID()}.wav`;
    const tempAudioPath = path.join(tempDir, filename);

    this.logger.info && this.logger.info("創建臨時音檔", { code: "audio_temp_created" });

    let buffer;
    if (audioBlob instanceof ArrayBuffer) {
      buffer = Buffer.from(audioBlob);
    } else if (audioBlob instanceof Uint8Array) {
      buffer = Buffer.from(audioBlob);
    } else if (typeof audioBlob === "string") {
      buffer = Buffer.from(audioBlob, "base64");
    } else if (audioBlob && audioBlob.buffer) {
      buffer = Buffer.from(audioBlob.buffer);
    } else {
      throw new Error(`不支持的音頻數據類型: ${typeof audioBlob}`);
    }

    this.logger.debug && this.logger.debug("緩衝區創建，大小:", buffer.length);

    await fs.promises.writeFile(tempAudioPath, buffer);

    const stats = await fs.promises.stat(tempAudioPath);
    this.logger.info &&
      this.logger.info("臨時音頻文件創建:", {
        size: stats.size,
        isFile: stats.isFile(),
      });

    if (stats.size === 0) {
      throw new Error("音頻文件為空");
    }

    return tempAudioPath;
  }

  async cleanupTempFile(tempAudioPath) {
    try {
      await fs.promises.unlink(tempAudioPath);
    } catch (cleanupError) {
      // 臨時文件清理錯誤不是關鍵問題
    }
  }

}
module.exports = AudioStore;

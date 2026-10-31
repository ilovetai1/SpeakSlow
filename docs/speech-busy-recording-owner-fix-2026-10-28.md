# 快捷鍵重複啟動造成 speech_busy

日期：2026-10-28。本機修正版：2.1.0。

## 原因與修正

使用者截圖顯示 `speech-job-begin: speech_busy`。程式會建立主視窗及隱藏控制面板，兩者均掛載 App/useRecording。原先 TypeLess 開始錄音事件廣播給所有視窗，兩個 renderer 因此競爭同一個語音工作；引擎接受第一個工作並以 `speech_busy` 拒絕第二個。回歸測試透過真實 IPC handler 與 SpeechEngineManager，確定可重現此錯誤。這確認了一條錯誤路徑，不能僅憑截圖判定當時所有內部狀態。

- 無錄音工作時，快捷鍵只送到主視窗。
- 已有錄音工作時，開始／停止／取消事件送到該工作的 owner；支援從控制面板手動開始的錄音。
- 錄音狀態同步只接受 owner，避免另一個閒置 renderer 將全域快捷鍵及指示器狀態覆寫為 false。工作釋放後仍接受原 owner 最後一次停止同步。
- 保留 SpeechEngineManager 原本的互斥保護。其他真正佔用引擎的工作仍可能回傳 `speech_busy`。

## 驗證

- 三項新回歸測試先失敗、修正後通過：單次快捷鍵只開始一個工作、停止／取消依 owner 路由、閒置 renderer 不覆寫錄音狀態。
- 全套 Node 測試：170 項，167 通過、3 跳過、0 失敗。
- renderer 及 macOS arm64 App 建置通過；`git diff --check` 通過。
- 透過 `npm run install:mac` 替換 `/Applications/SpeakSlow.app`，ad-hoc 簽章驗證通過。
- 安裝版 `hotkeys.js`、`windowManager.js`、`indicatorVisibility.js` 與工作目錄內容一致，保留先前外接螢幕修正。
- 專案內完整 SpeakSlow.app 副本為零；`/Applications` 及 Spotlight 僅找到正式安裝位置。
- 安裝版實際滑鼠開始、停止、再次開始錄音，未出現 `speech_busy`；原生指示器可見性曾確認為 true。本次無有效語音輸入，停止後回報「錄音數據為空」，因此不宣稱通過語音轉錄驗收。
- 快捷鍵實機驗收尚待完成：使用者已完成 Touch ID；關閉再開啟既有權限並重啟 App 後，程序仍讀到未授權。已進入重新加入 `/Applications/SpeakSlow.app` 的選檔視窗，但按「打開」及重新讀取系統設定時，介面工具連續逾時。尚未確認重新加入成功，已請使用者完成此介面步驟。

驗證紀錄：`dist/speech-busy-fix-20261028/validation/`；前端建置紀錄：`dist/speech-busy-renderer-20261028.log`。

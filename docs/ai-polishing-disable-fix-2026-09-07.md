# AI 潤稿關閉與跨視窗同步修正

日期：2026-09-07

## 已確認原因

- 設定 IPC 原先只保存並廣播布林值，沒有取消潤稿或釋放 Ollama。
- 主面板會接收設定廣播，設定視窗的 AI 開關卻只讀取開啟視窗時的快照。
- 「儲存 AI 設定」會再次寫入快照中的開關，可能把已關閉的 AI 重新開啟。
- 主面板先改畫面，再儲存設定，且忽略儲存錯誤，可能顯示未成功保存的狀態。

## 修正行為

- 主面板與設定視窗共用 `useAiOptimization`，以主程序保存後的廣播同步；初始讀取不會覆蓋較新的事件。
- 提示詞、Provider、Model 的草稿儲存不再重寫 AI 開關；儲存失敗會顯示錯誤。
- 關閉時立即取消正在進行的請求，包括設定讀取、模型啟動、能力查詢及推論；快速重新開啟也不接受舊結果。
- 錄音途中關閉潤稿會正常保存原文，不誤報模型失敗。關閉後的自動潤稿 IPC 不會啟動模型。
- 等取消完成後，停止由 SpeakSlow 啟動的 Ollama 並等待退出。共用外部服務時，只要求卸載本次執行曾使用的模型，不停止外部服務或卸載其他模型。
- 正常使用仍維持 10 分鐘 idle lifetime；使用者明確關閉才立即釋放。卸載失敗會回報錯誤，設定仍保持關閉。
- AI 關閉時開啟設定視窗不會自動啟動模型探索；「重新整理」與「測試設定」仍是明確的手動操作。尚未查詢的模型顯示「尚未查詢」。

外部服務卸載使用空 prompt 的 `/api/generate` 搭配 `keep_alive: 0`，依據 [Ollama 官方 API 文件](https://docs.ollama.com/api/generate)。

## 驗證

- 修正前：3 項生命週期測試失敗；真實 React 設定頁的瀏覽器測試重現「主面板已關閉、設定視窗仍顯示開啟」。
- 修正後：Node 測試 77 通過、0 失敗；1 項 Electron ABI 資料庫測試另於已簽署套件執行並通過。
- 瀏覽器測試涵蓋跨視窗事件、儲存不回寫開關、寫入失敗不顯示成功狀態，以及關閉時不自動探索模型。
- 前端 production build 通過；OpenSpec strict 2/2 通過；`git diff --check` 通過。
- Lint 無法執行：專案缺少 ESLint 9 所需的 `eslint.config.js/mjs/cjs`，不能視為通過。
- 套件使用現有 Apple Development 身分簽署，`codesign --verify --deep --strict` 通過。
- 實機：AI 關閉後啟動應用與開啟設定均未啟動 Ollama；手動測試載入 `qwen3:1.7b`，API 回報配置 1,644,836,896 bytes。
- 實機：從主面板關閉後，原 Ollama serve PID 91128 與 runner PID 91217 均退出；重新開啟原設定視窗顯示 off，再次儲存仍保持 off。

## 本機更新與復原

- 更新位置：[SpeakSlow.app](/Applications/SpeakSlow.app)
- 更新前套件：[備份](/Applications/SpeakSlow.app.backup-ai-disable-20260907-121211)
- 更新前 SQLite 備份：[transcriptions-before-update.db](/Users/chunghan/AI/SpeakSlow/dist/ai-disable-fix-20260907/transcriptions-before-update.db)
- 使用者設定與歷史紀錄保留；本次驗證結束時 AI 潤稿維持關閉。

本次套件驗證為本機使用，沒有新增公證或對外發佈驗證。

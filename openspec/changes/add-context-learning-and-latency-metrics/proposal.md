## Why

SpeakSlow 已有本機 ASR、Ollama 潤稿與手動改錯字典，但自動潤稿缺少可控的寫作情境，外部輸入欄位的更正無法形成可核准的學習候選，也沒有完整的階段延遲統計。2.1.0 聚焦這三項能力，先建立量測基線，再驗證情境與學習是否改善日常輸入。

## What Changes

- 建立本機、無文字內容的階段延遲量測：錄音啟動、ASR、潤稿、context、保存、貼上命令，以及停止錄音到輸出命令完成的 P50／P95、樣本與失敗數。
- 新增中性／訊息／郵件／筆記寫作 profile；可手動選擇並設定 App 預設值。中性預設保留既有潤稿行為。
- 新增可停用的 macOS 唯讀 context reader，讀取可編輯欄位身份與有限的選取／前後文字。文字情境第一版只供本機 Ollama 使用，預設關閉，不傳給遠端 provider。
- 新增預設關閉的本機改錯追蹤：只觀察本次輸入片段，產生待核准候選；核准後建立有 App 範圍的字典規則，可忽略或撤回。既有面板手動改錯與全域字典保持原契約。
- 將桌面 package 與 lockfile 版本從 2.0.0 更新為 **2.1.0 開發版**；本次交付是規劃，功能任務保持未完成，不建立 release/tag 或安裝新版。
- 明確排除以下範圍：不重寫貼上／Enter 交易，不新增完整錄音取消狀態機，不改歷史／音檔救援與留存策略。context 的欄位身份檢查只用於情境與學習，correlation ID 只用於量測。

## Capabilities

### New Capabilities

- `context-aware-polishing`: 寫作 profile、最小化本機文字情境、provider 邊界、bounded snapshot 與可觀察的不支援狀態。
- `local-correction-learning`: 短期本機改錯觀察、待核准候選、App 範圍規則、忽略／核准／撤回，以及保留既有手動改錯行為。
- `local-latency-metrics`: 本機階段 duration、P50／P95、樣本分群、失敗／缺測狀態、清除／匯出與效能基線。

### Modified Capabilities

- `transcript-polishing-workflow`: 將既有通用潤稿 prompt 擴充為保留中性預設、支援明確 profile 與可選本機情境；保留既有開關、原文 fallback、輸出與歷史契約。

## Impact

- 基準提交：`713bc96`。使用者本次只授權規劃三項新能力、提交既有內容與進版；新功能實作、打包／安裝／部署與 DB migration 不在本次執行範圍。
- 接入 `src/helpers/aiPrompts.js`、`aiTextProcessor.js`、AI／dictionary／system IPC、`preload.js`、`useRecording.js`、`App.jsx` 與設定／字典 UI；沿用既有 provider adapters、字典 CRUD 與 JSON settings。
- 新增自有 macOS 唯讀 Swift helper、ContextManager、CorrectionLearningManager 與 LatencyManager。需要 helper 建置／簽章／封裝驗收，但不執行競品 binary 或重用競品程式碼。
- 候選與字典範圍 metadata 使用版本化的 settings JSON 與既有 SQLite transaction；不新增／修改 history schema，不做資料庫 migration。
- 情境與被動改錯先驗收 macOS Apple Silicon；其他平台維持既有流程且明示不支援新 reader。延遲 manager 與 profile 邏輯保留跨平台介面，未測的平台不能宣稱驗收完成。

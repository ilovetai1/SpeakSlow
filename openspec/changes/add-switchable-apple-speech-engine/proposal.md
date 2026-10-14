> 2026-10-14 更新：使用者已授權按本規劃實作與測試。以下「本次只規劃」等範圍說明指初次提案階段；目前進度及未驗收項目以 tasks.md 為準。尚未授權 commit、push、正式安裝或發行。

## Why

SpeakSlow 目前只使用 Sherpa，使用者無法依繁體中文表現、即時回饋與資源成本選擇辨識引擎。2026-10-14 的本機試驗已證實 Apple Speech SDK 可在此 Mac 執行並使用 ANE，資源成本較低，但尚未完成實際麥克風、標點品質與封裝驗收，因此需要可切換且可觀察的產品接入，而非直接替換既有引擎。

## What Changes

- 設定新增「語音辨識引擎」：`現有本機引擎`（Sherpa，保留為既有與新安裝預設）與 `Apple 原生引擎`。第一版 Apple 使用 `SpeechTranscriber`，提供「完整上下文」（預設）與「即時回饋」兩種處理偏好，明示速度與品質取捨。
- 以主程序的引擎協調器管理能力、模型準備、錄音 session、切換與釋放；穩態只保留所選引擎的辨識 runtime。設定視窗、狀態輪詢、詞庫或附屬文字功能不得偷偷啟動另一個 ASR runtime。
- Apple 路徑使用自有 Swift helper、Apple 系統模型資產與連續音訊輸入。辨識期間預覽可修訂文字；停止後等定稿，再走既有字典、可選 AI 潤稿、歷史及貼上流程。保留 Apple 原生標點，不再疊加 Sherpa 的標點模型或句尾硬規則。
- 既有全域／App 範圍的辨識後字典繼續適用。Apple `SpeechTranscriber` 不宣稱支援辨識前熱詞或自訂語言模型；`DictationTranscriber` 的原生詞彙提示與繁中自訂發音另列研究及未來 gate，不作隱含替代方案。
- 依 macOS、硬體、精確 locale、資產及 helper 能力顯示就緒／下載／準備／不支援／錯誤。失敗時保留使用者選擇與具體原因，由使用者明確選回另一引擎，不靜默 fallback。
- 一般錄音、操作模式、歷史重新辨識與檔案／字幕轉錄皆有明確引擎路由；共用音檔保存與非 ASR 功能不依賴某個辨識後端。量測依引擎與處理偏好分群，另驗收標點、停止到貼上、記憶體與 CPU／ANE 邊界。

## Capabilities

### New Capabilities

- `speech-engine-selection`: 引擎選擇、平台與 locale 能力、選擇與實際狀態分離、忙碌時切換限制、跨視窗一致性與單一 runtime 生命週期。
- `apple-speech-runtime`: Apple 系統資產、macOS 26 相容的 Swift 音訊串流、partial／final、結束／取消／錯誤與封裝權限驗證。
- `engine-neutral-dictation`: 各辨識入口的明確路由、原生標點與字典邊界、既有 finalization／輸出／保存契約，以及可比較且不含文稿的量測。

### Modified Capabilities

無。既有 `transcript-polishing-workflow` 的單一潤稿開關、操作模式繞過、失敗處理、single-flight、current-cursor 貼上、獨立 Enter 與歷史契約保持原要求；新能力明確將 Apple 路徑接入這些契約。

## Impact

- 原始碼基線：`78e1e08ceeaf9b139079d4154711c4a92e026271`。官方研究記錄於 `docs/APPLE_SPEECH_SDK_RESEARCH_2026-10-14.md`；前幾輪試驗的原始資料在 `out/asr-benchmark-2026-10-14/`，不等於產品驗收。
- 涉及 `main.js`、`src/helpers/sherpaManager.js`、transcription／system／emoji IPC、`preload.js`、錄音與模型狀態 hooks、`src/App.jsx`、`src/settings.jsx`、歷史／檔案轉錄、延遲量測與本機建置。新增引擎協調器、Apple manager、Swift helper 與不依賴 ASR 的共用服務。
- Apple 第一版驗收目標為目前 macOS Apple Silicon 發行環境；API 最低 macOS 26，仍需 runtime availability 與精確 `zh-TW` 驗證。其他平台與舊 macOS 繼續提供 Sherpa；不提高整個應用的最低系統版本。
- 使用既有 JSON settings 保存選擇與偏好；不改 history table schema、不搬移／刪除模型或使用者音檔。正式實作時所需設定寫入與模型下載有清楚使用者操作；本次只交付研究、設計、規格與未完成任務。
- 與進行中的 `add-context-learning-and-latency-metrics` 共用字典與 finalization 接縫，不替它補勾未驗收項目。保留本次先前新增但未提交的 benchmark 工具。
- 本次不進版 package、不實作產品、不 commit／push／tag、不打包／替換 `/Applications/SpeakSlow.app` 或發佈。後續實作與安裝依各自授權及驗收進行。

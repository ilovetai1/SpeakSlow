## Why

SpeakSlow 的 Mac 路徑同時保留 Sherpa、macOS 26 相容橋接與多個未共用 finalization 的轉錄入口，Apple 系統語言模型也尚未成為正式 provider。macOS 27 已提供新版 Apple 本機 Foundation Model 與完整的 Apple Speech runtime；本變更將 Mac 產品邊界收斂到 macOS 27，並讓所有 Mac 轉錄入口及可選潤稿使用同一套可觀察、無靜默雲端 fallback 的本機能力。

## What Changes

- **BREAKING**：Mac 發行版最低系統提高為 macOS 27，限 Apple Silicon 與可用的 Apple 系統語音資產；macOS 26 不再是新版本的支援目標。
- **BREAKING**：Mac 上的一般錄音、即時預覽、檔案 TXT、SRT、歷史重新辨識及操作模式語音輸入全部使用 Apple Speech；既有 Sherpa／Zipformer 不再是 Mac 使用者可選的產品路徑。Windows／Linux 的 Sherpa 行為保持不變。
- 將既有 Mac `asr_engine=sherpa` 設定視為舊值並安全遷移為 Apple；保留 Apple `accurate`、`responsive`、`dictation` 模式及明確 availability／asset／locale 錯誤。
- 新增 `apple_on_device` AI provider，透過簽章的 Swift helper 呼叫 macOS 27 `SystemLanguageModel`；不要求 API key、不使用 PCC、不在失敗時改送 Ollama 或雲端。
- Apple provider 動態讀取 availability、variant、locale、context size 與 token count，每次文字工作建立獨立 session，並支援 timeout、取消、helper crash、guardrail、context 超限與截斷回應的結構化錯誤。
- 一般錄音、串流停止後定稿、歷史重新潤稿及 TXT 檔案可共用 Apple 潤稿。操作模式保持 bypass；SRT 第一版只使用 Apple ASR，不做可能破壞時間對應的生成式全文改寫。
- 新 Mac 安裝預選 Apple 本機 provider，但潤稿開關仍預設關閉。既有使用者的 provider 選擇不自動覆寫；未通過固定品質 gate 前，不自動開啟潤稿。
- 新增 macOS 27 對 macOS 26／26.4、Ollama 及不潤稿基線的可重現評估契約。由於正式 API 不能在 macOS 27 鎖回舊系統模型，跨 OS 結論必須來自固定 OS build、硬體、語料及 prompt 的配對證據。

## Capabilities

### New Capabilities

- `macos27-native-transcription`: 定義 macOS 27 平台 gate、Apple-only ASR 路由、舊設定遷移、所有轉錄入口、模式、資產與失敗契約。
- `apple-system-language-polishing`: 定義 Apple 本機語言模型 provider、native helper 協定、availability、context／token 預算、隱私、生命週期及品質 gate。

### Modified Capabilities

- `transcript-polishing-workflow`: 將串流定稿、TXT 檔案與歷史預覽納入共用可選潤稿流程，同時保留操作模式 bypass、SRT 邊界、原文 fallback、single-flight 與確認後覆寫契約。

## Impact

- 主要影響 `native/AppleSpeech.swift`、新增 Foundation Models Swift helper、兩個 native build 腳本、`package.json` macOS deployment／resources、主程序 speech／AI managers、IPC、preload、設定頁、一般與串流錄音 hooks、檔案／歷史轉錄、延遲分類與錯誤 UI。
- 既有 `add-switchable-apple-speech-engine` 的「macOS 26 相容、Mac 可選 Sherpa、Sherpa 為預設」決策被本變更取代；其歷史實作與驗收證據保留，不改寫成已完成的新需求。
- 不變更 history table schema，不刪除使用者模型、音檔或舊設定資料；不自動安裝、commit、push、tag 或發布。
- `fm` CLI 僅作開發評估對照；正式產品使用公開 Swift Foundation Models API。PCC、第三方 server model、adapter training、SRT 生成式改寫及 Windows／Linux Apple 支援不在本次範圍。

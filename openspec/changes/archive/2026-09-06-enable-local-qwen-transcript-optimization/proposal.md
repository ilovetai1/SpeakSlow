## Why

SpeakSlow 現有 AI 潤稿把 Ollama 當成 OpenAI 相容服務，無法列出本機模型、控制模型卸載，也會在失敗時靜默把原文當成成功結果。需要新增原生 Ollama 整合，讓使用者以單一開關選用任一本機文字生成模型，在不產生外部 API 費用的前提下完成錄音後潤稿，並維持低待機記憶體與不中斷的轉錄流程。

## What Changes

- 新增明確的 Ollama provider，使用原生 `/api/tags`、`/api/show` 與 `/api/chat`，不要求 API key；既有遠端 provider 保持可用。
- 在設定頁提供 Provider、Model、單一「潤稿」開關與可編輯的潤稿提示詞；選擇 Ollama 時動態列出所有本機、具文字生成能力且非 Cloud 的模型。
- 首次優先選取已安裝的 `qwen3:1.7b`，之後保存最後選擇；不驗證或認證任意模型的文稿品質，也不自動下載模型。
- 顯示模型檔案大小、參數量及量化格式；超過 2 GB 時警告但不阻擋選擇。
- 開啟潤稿後，右 Alt 錄音辨識完成即使用選定 provider／model 執行單一「受限完整潤稿」；關閉時不啟動 Ollama。
- 設定頁顯示並保存目前的潤稿提示詞；錄音後自動潤稿與歷史重新潤稿共用該設定，逐字稿由主程序自動附加，不要求使用者維護 placeholder。
- 本機請求固定使用 `temperature:0`、`num_ctx:2048`、`keep_alive:"10m"`，支援時使用 `think:false`；每次請求重設 10 分鐘滑動閒置期限，並只管理 SpeakSlow 自己啟動的 Ollama process。
- 取消確定性自我修正前處理與語意安全驗證；只檢查 API 成功、回應格式及非空文字。Prompt 會要求保留事實，但系統不保證任意模型遵守。
- 潤稿成功後依獨立的自動貼上設定，將結果貼到完成當下前景 App 的目前游標；貼上後 Enter 仍由既有獨立設定控制。
- 潤稿失敗時不切換 provider 或模型；在自動貼上已開啟時貼回 AI 處理前文字，並只在 SpeakSlow 主畫面保留非阻塞的最新異常狀態。
- 歷史頁新增重新潤稿與預覽確認；每次都從 AI 處理前文字開始，只保留最新最終結果，不建立模型輸出版本歷史或處理 metadata。

## Capabilities

### New Capabilities

- `local-ollama-text-optimization`: 規範 Ollama provider、動態本機模型選擇、原生 API、低資源參數、server ownership 與 10 分鐘模型閒置期限。
- `transcript-polishing-workflow`: 規範單一潤稿開關、錄音後自動處理、貼上／Enter 的獨立性、失敗不中斷、簡化保存與歷史重新潤稿。

### Modified Capabilities

<!-- 目前尚無既有 OpenSpec capability；既有遠端 AI provider 需求保持不變。 -->

## Impact

- 主要影響主程序 AI provider／IPC、Prompt 組裝、`src/settings.jsx`、錄音完成流程、clipboard 貼上流程、歷史頁與 SQLite 存取層。
- Ollama 由 OpenAI 相容端點改為 loopback 原生 API；renderer 不再自行呼叫 provider。
- 新增動態模型 discovery、completion capability 過濾、Cloud 模型排除、資源警告與 10 分鐘滑動 idle TTL。
- 不新增第三方模型套件，不打包或下載 Ollama 模型；第一版必要驗收平台為 macOS Apple Silicon。
- 發布驗收只保證整合、錯誤流程、貼上設定與模型閒置期限，不保證任意模型的潤稿品質。

## Context

SpeakSlow 目前的主程序 `AITextProcessor` 與 renderer `useTextProcessing` 都能直接發出 OpenAI 相容請求，provider 由 URL 與 model 隱含推斷。Ollama preset 固定為 `qwen2.5`，沒有原生模型清單、thinking、context、keep-alive 或 runner 狀態控制。錄音後若 AI 失敗，現行程式會靜默保存並貼上原文；DB 保存成功又是貼上的前置條件；`paste_after_transcription` 雖被讀取，實際貼上路徑沒有遵守它。

本機實測 `qwen3:1.7b` 在 `think:false`、`temperature:0`、`num_ctx:2048` 下，模型配置約 1.53 GiB、runner RSS 約 1.55 GiB、macOS active physical footprint 約 1.1 GB；短句冷請求約有 1.1 秒花在載入模型。使用者選擇以 10 分鐘滑動閒置期限換取連續使用速度；超過期限後由 Ollama 卸載 runner。使用者也選擇讓 Ollama 中所有本機文字生成模型都能使用，不做模型品質認證或語意輸出驗證，因此 proposal 的保證必須限縮為工作流與資源控制，而不是文字正確性。

## Goals / Non-Goals

**Goals:**

- 以明確 provider 與主程序 adapter seam 同時支援既有遠端服務及原生 Ollama。
- 在設定頁動態列出並保存使用者選定的本機文字生成模型。
- 在 AI 文字優化頁顯示、編輯並保存單一潤稿提示詞，讓錄音與歷史重新潤稿共用。
- 用單一潤稿開關控制錄音後處理；關閉時不得啟動 Ollama。
- 讓潤稿、貼上、貼上後 Enter 三項設定彼此獨立。
- 讓 Ollama 模型在最後一次請求後保留 10 分鐘，每次新請求重新計時，逾時後卸載 runner。
- AI 或 DB 失敗不得中斷核心錄音轉文字；錯誤以主畫面非阻塞狀態呈現。
- 保存 AI 處理前文字與最新最終結果，並允許歷史文字重新潤稿。

**Non-Goals:**

- 不驗證、排名或認證任意 Ollama 模型的文稿品質。
- 不做數字、日期、否定語意、專有名詞等語意一致性驗證。
- 不對口語自我修正做確定性前處理；此類判斷完全交給選定模型。
- 不提供多套 Prompt、Prompt 版本歷史、placeholder 語法或進階推論參數。
- 不自動下載、更新、刪除、量化或打包 Ollama 模型。
- 不支援 Ollama Cloud 模型，不把本機潤稿轉送到外部服務。
- 不建立模型輸出版本歷史、處理 metadata 或持久化通知中心。
- 不改變 Sherpa-ONNX 的 ASR、VAD 或標點模型。
- 第一版不保證 macOS Apple Silicon 以外平台的 Ollama 自動啟動。

## Decisions

### 1. 所有 provider 請求集中到主程序 adapter seam

保留一個 renderer 可呼叫的文字處理 IPC contract，主程序依明確 `ai_provider` 選擇：

- `OpenAICompatibleAdapter`：保留 DeepSeek、OpenAI、Gemini 與 custom endpoint 的既有請求協定。
- `OllamaAdapter`：封裝 loopback 原生 API、模型選擇、逾時、回應解析與模型閒置期限。

Renderer 不再讀取 API key 或直接 `fetch` provider。這避免設定、錯誤與資源控制因兩套實作而分歧。

### 2. 設定保留 Provider、Model、單一潤稿開關與單一提示詞

新增明確 `ai_provider`，但不自動切換既有 provider，也不自動啟用潤稿。當使用者選擇 Ollama 時：

1. 按需啟動或連線 Ollama。
2. 以 `/api/tags` 取得本機可用模型。
3. 以 `/api/show` 只保留具有 `completion` capability 的模型，並排除明確的 Cloud model reference。
4. 顯示名稱、size、parameter size 與 quantization；size 超過 2 GB 顯示警告但仍可選。
5. 首次若存在 `qwen3:1.7b` 則預選它，否則要求使用者選擇；之後保存最後選擇。

模型選擇不觸發品質 benchmark、試跑或下載。已選模型消失時保留設定但標示 unavailable，禁止重新開啟潤稿；若在執行時才發現不可用，走一般潤稿失敗流程，不切換模型。

AI 文字優化頁另顯示一個多行「潤稿提示詞」欄位。首次沒有已存設定時顯示目前內建的臺灣繁體中文指令；使用者按「儲存設定」後持久化為 `transcript_polishing_prompt`。空白提示詞禁止保存，既有有效設定不得被空白值覆寫。Prompt 不綁 provider 或 model，切換兩者時保持不變。

### 3. Ollama 使用原生 API 與一致的低資源 profile

本機 request 使用 `/api/chat` 與當次開始時 snapshot 的 model name：

```json
{
  "model": "<selected-local-model>",
  "stream": false,
  "keep_alive": "10m",
  "options": {
    "temperature": 0,
    "num_ctx": 2048
  }
}
```

模型 capability 支援 thinking 時加上 `think:false`。`keep_alive:"10m"` 是固定的滑動閒置期限，不新增進階設定；每次本機請求都重設 Ollama 的到期時間，連續 10 分鐘沒有新請求後由 Ollama 卸載模型。請求固定 60 秒逾時。超過實測安全輸入上限的逐字稿在推論前直接視為潤稿失敗；不得截斷、分段或暗中提高 context。

替代方案是使用模型預設參數，但可能開啟 thinking、擴大 context 或無期限保留 runner，與可預期的資源上限不符。

### 4. Ollama server 按需啟動並追蹤 ownership

第一次需要 Ollama 時探測 `127.0.0.1:11434`：

- 已有相容 server：直接共用，SpeakSlow 不取得 ownership，也不停止它。
- 無 server 且找到 executable：以禁止 Cloud 的設定啟動 `ollama serve`，等待 bounded readiness，並記錄 owned process。
- executable、server 或模型不可用：回傳穩定錯誤，不下載模型。

每次本機請求都在 `/api/chat` payload 設定 10 分鐘 idle TTL，不另設 App 計時器，也不在完成後立即呼叫卸載。SpeakSlow 結束時取消 in-flight request，停止 owned server；外部 server 不受影響，其模型依 Ollama 的到期時間自行卸載。其他 Ollama client 若使用同一模型，可能重新設定其到期時間，因此 SpeakSlow 只保證自己送出的請求使用 10 分鐘期限。

### 5. 單一可編輯 Prompt，不做語意 guardrail

所有模型共用設定頁保存的同一套 Prompt。首次預設值是現行臺灣繁體中文指令，要求改善標點、斷句、贅詞、重複、文法及不自然語序，保留原語言與中英文混用，並禁止回答 transcript 內的問題、翻譯或新增資訊。設定頁只編輯指令本體；主程序固定在後方附加 `<transcript>...</transcript>` 資料區塊，因此使用者不需維護或保留 placeholder。錄音後自動潤稿與歷史重新潤稿都在執行時讀取同一筆已保存設定。

空白或非字串 Prompt 視為設定錯誤，不啟動推論。除此之外，系統不檢查、改寫、補齊或限制使用者的提示詞內容，只將 HTTP／JSON contract 成功、存在可用的 final content 且非空視為技術成功；thinking-only、空回應或 malformed response 視為失敗。不驗證事實、數字、日期、否定語意或 Prompt 遵循，也不做自我修正前處理。因此提示詞內容是使用者控制的指令，不是可由系統保證的輸出安全性。

### 6. 右 Alt 完成後使用當下前景游標

潤稿開啟時，右 Alt 錄音完成後依序執行 ASR、既有繁體／字典處理、選定 provider 潤稿與結果保存。操作／語音指令模式跳過 AI 潤稿。

輸出階段不恢復錄音開始時保存的 App，而是對完成當下的前景 App 與目前游標執行貼上。若 `paste_after_transcription` 關閉，僅保存與顯示；若開啟，貼上最新最終結果。`auto_enter_after_paste` 只在貼上成功後依自身設定送出 Enter，與潤稿開關無關。

整條錄音到貼上流程維持單工；busy 時拒絕新的右 Alt 開始事件並顯示目前狀態，不排隊，避免結果順序與記憶體競爭。

### 7. 失敗降級為 AI 處理前文字，但不得靜默

Provider unavailable、模型缺失、逾時、over-limit、malformed 或空回應都屬潤稿失敗：

- 最終文字改用 AI 處理前文字。
- 自動貼上開啟時仍貼上該文字；關閉時不貼上。
- 不重試其他模型，不切換遠端 provider。
- 不顯示 toast、modal 或 macOS notification。
- SpeakSlow 主畫面保存最新一筆非阻塞 inline issue：「潤稿失敗，已使用原始文字」；下一次相同流程成功後清除。

這是使用者明確授權的 fallback，目的是不中斷核心轉錄。若 DB 保存失敗，仍繼續貼上並把最新 issue 改為「歷史紀錄保存失敗」。

### 8. 只保存基準文字與最新最終結果

Domain contract 只保留：

- `raw_text`：繁體轉換與字典處理後、送入 AI 前的文字。
- `text`：目前最新最終結果；潤稿成功為模型輸出，失敗或關閉為 `raw_text`。

不新增 Provider、model、duration、status 或候選版本欄位。既有 `processed_text` 僅作 schema 相容，不得讓歷史頁重複顯示同一個最終結果；不建立新版本表。

歷史頁的「重新潤稿」永遠從 `raw_text` 開始，使用當下設定的 provider／model。UI 比較目前 `text` 與新候選；使用者確認後才覆寫 `text`，取消或失敗時保留舊結果，且不觸發 clipboard paste 或 Enter。

### 9. 日誌與錯誤呈現維持最小化

不把 transcript、Prompt、response 或 secrets 寫入 log。LogManager 只保存執行階段、error code、字數與 duration 等診斷資訊；DB 不保存這些 metadata。主畫面只保留最新 inline issue，不新增通知中心、未讀 badge 或歷史異常表。

## Risks / Trade-offs

- [任意模型可能改變事實並被自動貼上] → Prompt 明確限制、DB 保留 `raw_text`、歷史頁允許重跑；使用者已選擇不做語意驗證或模型品質認證。
- [使用者編輯 Prompt 後可能弱化原意保留規則、耗盡 context 或增加延遲] → UI 明確提示影響；系統只拒絕空白值，不做內容驗證、暗中修正或自動恢復預設。
- [模型可能錯誤解析口語自我修正] → 不做確定性前處理，結果完全取決於選定模型；此風險已被接受。
- [完成當下前景 App 可能不是錄音原目標] → 不搶回焦點是明確需求；使用者需維持正確游標位置，paste failure 則沿用 clipboard 可復原路徑。
- [大型模型可能造成高峰值記憶體或超時] → 顯示 size／parameter 警告、固定 context／timeout、單工執行並使用有限 idle TTL。
- [10 分鐘內保留模型增加暫時記憶體占用] → 接受 `qwen3:1.7b` 約 1.1–1.6 GB 的觀測占用，以省略同一使用區段內約 1.1 秒的重載；逾時後回到低待機。
- [其他 Ollama client 可改變同一模型的到期時間] → SpeakSlow 不接管外部 server，只固定自己的 request contract；驗收以本 App 請求後的 `/api/ps expires_at` 為準。
- [外部 Ollama server 的 Cloud 設定不受 SpeakSlow 控制] → 只列出 completion-capable 且非明確 Cloud reference 的本機 tag；SpeakSlow-owned server 明確禁用 Cloud。
- [不保存 model metadata 使歷史結果不可追溯] → 這是保持個人工具簡單的明確取捨，只保存基準與最新結果。
- [現有 DB 欄位語意與歷史頁展示不一致] → 在存取層收斂 domain contract，避免破壞性 schema migration，並以回歸測試固定既有資料的展示。

## Migration Plan

1. 先以測試固定現有遠端 provider、錄音、貼上、DB 與 dirty-worktree baseline。
2. 建立主程序 adapter、Ollama runtime 與模型 discovery；既有設定不自動切換 provider 或開啟潤稿。
3. 更新設定 UI，加入動態模型清單、資源資訊、單一潤稿開關與可編輯提示詞；選擇 Ollama 前不要求 API key。
4. 更新右 Alt pipeline、獨立貼上／Enter 設定、fallback、inline issue 與歷史重新潤稿。
5. 不做破壞性 DB migration；舊資料經存取層相容，新紀錄遵守 `raw_text`／`text` domain contract。
6. 完成自動測試、renderer build 與真實 `qwen3:1.7b` smoke test，確認 `/api/ps expires_at` 約為最後請求後 10 分鐘，再建置與安裝 macOS App。
7. 回復時關閉潤稿並恢復先前 provider；不刪除歷史資料或停止外部 Ollama。

## Open Questions

- 無產品決策待確認。既有 500 字 transcript 上限維持不變；自訂 Prompt 可能改變實際 context 餘裕與延遲，使用者已選擇自行控制內容，系統不做內容驗證。

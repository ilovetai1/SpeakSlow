## Context

本文件說明 [proposal](proposal.md) 的實作方式，屬規劃產物，尚未代表實作、品質 gate、正式打包或安裝已通過。此變更取代 `add-switchable-apple-speech-engine` 中 Mac 支援 macOS 26、可選 Sherpa 及 Sherpa 預設值的決策；保留該變更的歷史證據，不將舊驗收視為新功能驗收。

原始碼可確認的接縫如下：

| 接縫 | 現況及本次需求 |
| --- | --- |
| `speechEngineManager.js`、`appleSpeechManager.js` | 已有 job／owner／generation 與 Apple helper；預設仍是 Sherpa，平台 gate 仍接受 macOS 26。Mac 改為固定 Apple，Windows／Linux 保留原路由。 |
| `native/AppleSpeech.swift` | protocol v2、Electron 供音、range／watermark、ACK、Speech／Dictation 已存在。提高最低 OS，不假設改 OS 會自動改善此 API 的辨識品質。 |
| `aiTextProcessor.js` | 現有 adapter 選擇為 Ollama 或 OpenAI-compatible；其他 provider 會進 HTTP 路徑，且讀設定時可能套用 DeepSeek 環境值。新增 Apple 必須改成明確 dispatch。 |
| `useRecording.js`、`transcriptFinalization.mjs` | 一般錄音已有可選潤稿、原文保存與失敗提示；串流、檔案及歷史須接入一致決策，不能重複保存或輸出。 |
| `useStreamingRecording.js` | 仍保留 Sherpa 靜音切段邏輯；Mac 的預覽與停止定稿不能沿用 Zipformer 分段假設。 |
| `ipc/transcription.js`、`HistoryView.jsx` | 歷史重新辨識、重新潤稿是不同操作；需維持 baseline、預覽、確認及既有音檔邊界。 |
| `package.json` | 工作目錄已有未提交的 `build-window-visibility.mjs` 與 `window-visibility` resource；本次必須在目前檔案上合併 native build，不能還原或覆蓋。 |

Apple 的語音辨識與文字生成是兩套能力。`SpeechTranscriber`／`DictationTranscriber` 負責 ASR；`SystemLanguageModel` 負責文字潤稿。Apple 明確列出語言模型的 26.0–26.3、26.4、27.0 世代，並說明 27 改善 instruction following 與複雜情境表現。這不證明 Speech API 的模型、台灣中文 CER 或本專案潤稿 prompt 已改善。[SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)、[Foundation Models updates](https://developer.apple.com/documentation/updates/foundationmodels)、[Speech updates](https://developer.apple.com/documentation/updates/speech)

主要利害關係人是 Mac 錄音與歷史功能使用者、仍使用 Windows／Linux 的使用者，以及維護跨程序生命週期和發行流程的人員。架構須讓缺模型、取消、保存失敗與 provider 錯誤可被觀察，且維持文稿與音檔的既有資料契約。

## Goals / Non-Goals

**Goals:**

- Mac 發行版以 macOS 27、Apple Silicon 為最低平台，所有 ASR 入口固定使用 Apple Speech。
- 新增明確的 `apple_on_device` provider，透過公開 Swift Foundation Models API 執行本機潤稿。
- 共用完整文稿的 finalization 決策，確保一次保存、一次輸出、明示原文 fallback，以及取消後不輸出。
- 依 runtime 能力與 token 預算執行，將 ASR 資產、語言模型 availability 與 provider 品質分開驗收。
- 安全遷移舊設定，保留既有 provider 選擇、使用者資料與 Windows／Linux 行為。
- 提供可重現且有固定通過條件的品質、延遲、隱私及打包 gate。

**Non-Goals:**

- 不接入 PCC、第三方 server model、`fm` subprocess、Python Foundation Models SDK 或 adapter training 作為正式 Apple provider。
- 不在 Apple ASR 或潤稿失敗時自動改用 Sherpa、其他 Apple 模組、Ollama 或 HTTP provider。
- 不提供在 macOS 27 鎖定／切換回 26 系統模型的產品選項；不複製 Apple 系統權重。
- 不做 SRT 生成式全文改寫，不新增語意猜補、不靜默截斷長稿、不新增自動分塊潤稿。
- 不改 history table schema、不刪模型／音檔／舊設定、不擴大螢幕情境擷取、TTS 或雲端資料範圍。
- 本規劃不執行安裝、發布、commit、push、tag 或使用者真實 DB migration。

## Decisions

### 1. 主程序固定 Mac ASR 路由，保留模組模式

`SpeechEngineManager` 仍是所有 ASR 的唯一入口與工作所有者。Mac 初始化時執行平台與設定遷移後，固定 `selected=apple`，不建立或準備 Sherpa recognizer。Mac 專用 IPC 及通用設定 IPC 都拒絕寫入 `asr_engine=sherpa`；renderer 隱藏引擎選擇與 Sherpa／Whisper／Zipformer 操作，不能僅用 UI disabled 保證路由。

平台 gate 以真實 OS 版本／arm64 判斷，native helper 亦驗證最低 OS 和 protocol。OS 版本取值集中於一處；不將 macOS 27 的 Darwin major 與 macOS 產品版本混用。舊系統回 `platform_unsupported`，不嘗試執行 27 helper。發行包設定最低 macOS 27，僅產生本次支援的 arm64 目標。

保留三種明確模式：

| 設定值 | 模組與語意 |
| --- | --- |
| `accurate` | `SpeechTranscriber`、volatile preview，維持目前非 fast-results 的設定。 |
| `responsive` | `SpeechTranscriber`、volatile 與 fast results，速度及品質獨立驗收。 |
| `dictation` | 明確使用 `DictationTranscriber`，保留目前 progressive long dictation 與 audio time attributes。 |

模式在 job 建立時凍結。不同模式的 supported／installed locale 與資產分開查詢；維持精確 `zh-TW` 辨識契約，不以其他區域中文替代。`SpeechTranscriber.isAvailable` 不套用成 Dictation 的唯一 gate。資產查詢失敗與真正不支援分開回報；下載由使用者明確啟動，系統共享下載的取消邊界保持可見。

替代方案是保留 Mac 引擎切換或於 Apple 不可用時自動用 Sherpa。兩者都不符合本次 Apple-only 的產品範圍；Windows／Linux 則仍使用既有 Sherpa adapter，不能被 Mac 固定值影響。

### 2. Apple ASR 繼續使用連續供音及單一工作租約

保留 Electron 的麥克風選擇、快捷鍵、指示器與單一 recording owner。Swift 不接管麥克風；主程序驗證並轉送現有 protocol v2 的 PCM／sequence／sessionId，維持 ACK、有限 buffer 和 backpressure。提高 deployment target 不要求順帶重寫已運作的 `AVAudioConverter`；只有單獨驗證格式、flush 與時間軸後才可改用 27 converter API。

Mac 串流不做 Sherpa 500ms 靜音切段、不啟動 precog／Zipformer，不使用 Sherpa 標點模型。預覽由 range 與 finalized-through watermark 合併，不能累加每一份 partial，也不能只保留收到 `isFinal=true` 的片段。

正常停止順序固定為：停止 capture → 餵完與 ACK 尾塊 → flush／結束 input → analyzer finalize → results drain → 取得完整文稿 → 共用 finalization → 保存與輸出。preview 不貼上；ASR 未完成不得把 partial 當成功稿件。

job 的 lease 必須涵蓋辨識、定稿、潤稿、保存及輸出完成；若原 ASR session 已釋放，主程序仍持有對應的 finalization lease。不能因 analyzer 結束就允許另一視窗啟動第二個自動輸出工作。每次 async 邊界重查 owner／generation；取消、視窗銷毀、app 結束後，晚到結果不得寫 DB 或貼上。

替代方案是直接將所有入口改成檔案辨識或沿用 renderer 的分段累加；前者失去錄音期間處理能力，後者會破壞 Apple 的修訂與完整性語意。

### 3. 新增獨立的 Foundation Models helper 與 adapter

新增 `native/AppleFoundationModels.swift`、`scripts/build-apple-foundation-models.mjs`、主程序 `AppleFoundationModelsManager` 及 `AppleOnDeviceAdapter`。名稱可依現有檔案慣例微調，但職責不能混入 `AppleSpeechManager`。ASR 與 LLM 的 readiness、取消及 crash 相互獨立；LLM 不可用時，已成功的 ASR 原文仍可依既有 fallback 契約輸出。

helper 僅 import 公開 `FoundationModels` API；正式請求明確用 `SystemLanguageModel.default`，不建立 `PrivateCloudComputeLanguageModel`。`fm` 只用於開發交叉檢查，Python SDK 只可用於離線評估，兩者都不是新的模型或 production runtime。Apple 的 Python SDK 在底層也呼叫 Swift framework，不能透過安裝 SDK 改換 OS 模型。[Python SDK](https://apple.github.io/python-apple-fm-sdk/)

每次文字工作建立獨立 `LanguageModelSession`，不跨錄音、檔案、歷史或操作模式保存 conversation transcript。helper process 可存活以降低啟動延遲，但每項工作結束須釋放 session 與私有文字 buffer。本機 adapter 採一個 active request 的有界執行：忙碌時明示 `provider_busy`，不累積無界 queue；ASR helper 與 LLM helper 的個別存活不代表允許多個自動輸出 job。

helper 與 manager 使用版本化 JSONL：

| 類型 | 必要內容 |
| --- | --- |
| handshake／probe | protocolVersion、OS build、availability／reason、variant、supported locale、contextSize。 |
| request | requestId、generation、action、instructions、prompt、locale、受限 generation options、deadline。 |
| token preflight | 以 native `tokenCount(for:)` 計算實際 instructions／prompt 的 token，回傳使用量及預留輸出預算。 |
| result | requestId、generation、完整文字、completion 狀態、token／duration metadata；成功必須有完整非空結果。 |
| error／cancel | 固定 code、requestId、generation、可供 UI 選擇的重試性；不回傳 framework 原始敏感描述。 |

輸入與輸出皆限制單一 frame 大小，manager 拒絕非 UTF-8／非法 JSON、重複 terminal result、錯誤 ID、超大內容及不相容版本。stdout 只放 protocol；stderr 不原樣寫產品 log。主程序不能傳入 shell 命令、model endpoint 或任意檔案路徑。log 經 `logManager`，僅 allowlist provider、固定 reason、variant、token 數、OS／helper 版本及 duration，排除 prompt、文稿、audio、secret 及原始 stderr。

沿用目前 60 秒文字處理 deadline 作初始上限；timeout、使用者取消與 app shutdown 都先終止該 task，manager 失效 generation，再於有界等待後終止自己擁有的 helper。不得 kill Apple 共用服務。crash／protocol failure 拒絕所有 pending request；下個使用者工作可重建 helper，當前工作不自動重送，以免重複生成或輸出。

替代方案包括 Electron native addon、直接執行 `fm` 或合併兩種 helper。獨立 Swift helper 保持 Electron ABI、ASR protocol 及錯誤域清楚，也可明確簽章與打包；代價是新增一個受管 child process。

### 4. Provider dispatch 在讀取 secret 與 endpoint 前完成

`AITextProcessor` 改用明確 provider registry；狀態測試、正式處理、history preview、command AI 操作都使用同一 resolver。允許的 provider ID 有固定集合，未知值回 `provider_invalid`，不得落到 OpenAI-compatible。保留現有雲端 provider 與 custom 的明確 adapter mapping。

`apple_on_device` 設定不需要 key、base URL 或使用者可編輯 model name。選到 Apple 時，config loader 不套用 `DEEPSEEK_API_KEY`，不讀取儲存 key 作為本次請求輸入，不建 HTTP request，不啟動 Ollama。現有雲端設定仍保存在原處，供使用者日後自行選用。

Apple、Ollama、HTTP 的限制各由對應 adapter／capabilities 管理。既有 Ollama 500 字上限及 context calibration 不能直接套到 Apple。`latencyManager` 增加 `apple_on_device` 固定分類；`provider` 保持 LLM 維度，ASR 仍以 `asrEngine`／`asrProfile` 記錄。

目前螢幕文字情境只服務已授權的 Ollama automatic-offline 路徑；Apple 第一版不主動 capture／consume external context，也不使用 Ollama 的 `context_budget_v1`。既有 writing profile 與使用者自訂潤稿指令可組成 Apple instructions，但 prompt／profile 是工作開始時的快照，不因設定中途變更而混用。

替代方案是將 Apple 偽裝為 localhost HTTP provider。這會保留錯誤的 endpoint／key／model 預設與 cloud fallback 可能性，因此不採用。

### 5. Availability、token 與輸出完整性採 fail-closed

ASR readiness 與 Apple Intelligence／LLM availability 分開呈現。Apple provider 每次工作前 probe；裝置／地區／Apple Intelligence 未啟用／資產未就緒／locale 不支援各回固定原因。不得用「macOS 27」或靜態機型表推成 `available`。27 的 `variant`、contextSize 與 locale 能力均從 runtime 取得，不假設每台機器都使用 Core Advanced 或同一 context 上限。[Variant](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/variant-swift.struct)

在 native helper 計算最終 instructions、prompt 與完整輸入的 token。生成前保留明確輸出預算與安全餘量，總量不可超過回報的 contextSize。初版只處理單次可完整容納的稿件；超限回 `context_exceeded`，顯示仍使用原文。不得截原文、忽略自訂指令尾端、以估算字數替代 native 計數，或擅自分塊再拼接。

使用預設 guardrails；guardrail violation、refusal、context 超限、generation limit、locale／assets unavailable、timeout、cancelled、helper missing／crash／protocol error 分開映射。guardrail 失敗不能關閉 guardrails 後重試。僅正常結束且完整、非空的 response 可成為潤稿候選；輸出上限或 API failure 所附 partial 不算成功。若 SDK 無法辨認某種截斷，該分支為未解除的 release gate，不以句號或長度猜測完成。

Apple 沒有公開的 26／27 系統模型鎖版參數。版本差異採 OS build／variant／prompt version 記錄與 prompt versioning 處理；更新 Xcode 不等於更新系統模型。[Updating prompts](https://developer.apple.com/documentation/foundationmodels/updating-prompts-for-new-model-versions)

### 6. 共用定稿規則，保留各入口的副作用邊界

共用 finalization 拆成「形成 final text／issue／cancel 狀態」及由入口注入的「保存／輸出」策略；不能為了共用流程而強迫檔案匯出寫 history，或讓 history preview 自動貼字。`rawText` 指 ASR 完成並套用既有繁簡轉換、詞庫等確定性處理的 baseline；潤稿不得覆寫此 baseline。避免目前 manager 與 hook 在不同入口重複套字典，明確指定每個工作只做一次確定性處理。

| 入口 | 定稿與輸出契約 |
| --- | --- |
| 一般錄音 | Apple 完整 ASR → 確定性文字處理 → 開關允許時潤稿 → 一次 history save → 既有貼上／Enter。 |
| 串流 | partial 僅預覽；停止並 drain 後，將唯一完整文稿交給同一 finalization。結果一次保存／輸出，不逐段呼叫 LLM。 |
| TXT 檔案 | 全檔一個 job，音訊分塊不建立多個語意 session；完整 ASR 後可選潤稿，再交匯出策略。維持 `no_persist`，不另外保存使用者音檔或新增重複 history。 |
| SRT | Apple ASR 與可信 audio-time range 生成字幕；確定性逐段文字處理保留時間對應。第一版不呼叫 LLM，UI 明示此界線，不能做全文改寫後按字數分配時間。 |
| 歷史重新辨識 | 從 record ID 取得已保存音訊，固定 Apple／當前模式，不另外保存同一音檔。完整成功後才依既有明示操作替換 baseline；失敗／取消保留舊紀錄。重新辨識不隱含再潤稿。 |
| 歷史重新潤稿 | 一律從 `raw_text` 形成候選；顯示目前 final 與新候選，確認後只替換 latest final。取消／失敗不寫 DB、不貼字。已支援的舊資料 baseline 相容規則保持不變。 |
| 操作模式語音輸入 | Apple ASR 後 bypass transcript polishing，直接送既有 command interpreter。使用者明示的選取文字改寫等 AI command 仍經 provider dispatch，不能因此再潤一遍語音指令。 |

延續資料契約：`raw_text` 保留 baseline，`text` 保存 latest final，`processed_text` 不另存一份平行 final；不改 table schema。history preview 建立主程序持有的候選 token，綁定 owner／record／baseline 或 final revision 摘要；確認時驗證來源未變。過期候選回 `history_changed`，不覆蓋另一視窗剛更新的內容；不接受 renderer 任意文字當成已驗證候選。

潤稿失敗時依既有契約使用 baseline，回傳固定 issue 並在 UI 呈現；metrics 標示 polish failed／raw used，不能顯示「Apple 潤稿成功」。使用者中途關閉潤稿回原文並標記 skipped；整個工作取消、owner 消失或 shutdown 則不保存／輸出。ASR 失敗不能套用此 LLM 原文 fallback。保存失敗延續現行可觀察提示與輸出策略，不在重試時重複貼上。

替代方案是每個入口各自呼叫 provider；這會使 single-flight、取消及錯誤語意分歧。共用決策與注入副作用可維持一致性，也保留 TXT／SRT／history 的差異。

### 7. 設定遷移可重入，預設關閉潤稿

遷移在主程序、runtime prepare 前執行，以獨立 migration version 記錄，並只在持久化成功後啟用新狀態。使用既有 settings 儲存機制的 transaction；若無可用 transaction，先實作等價原子更新，不允許半套預設造成 provider 意圖改變。

| 輸入狀態 | macOS 27 行為 |
| --- | --- |
| 既有 `asr_engine=sherpa` 或確定的舊版預設缺值 | 保存非敏感的先前 ASR 選擇供應用降版參考，再寫 Apple。保留 Sherpa profile／串流／熱詞及已下載模型。 |
| 既有合法 Apple mode | 保留原值；mode 缺值使用 `accurate`。未知 mode 為設定錯誤，不靜默改成另一模組。 |
| 真正新安裝 | `asr_engine=apple`、`ai_provider=apple_on_device`、`enable_ai_optimization=false`；Apple 尚不可用仍顯示原因，不改選 provider。 |
| 既有明確 AI provider | 保留選擇、設定與潤稿開關；不因 Apple 可用就改選或開啟。 |
| 舊版缺 `ai_provider` 但已有 URL／model／key 等設定 | 沿既有 legacy inference 還原原 provider 意圖；不能僅因 provider 欄位缺少就當新安裝。不要讀出／記錄 secret 值做 migration 診斷。 |
| 非 Mac | 不執行 Mac migration，不寫 Apple 預設。 |

「新安裝」以初始化前的 settings 是否存在及既有初始化 metadata 判定，須涵蓋已存在但未配置 AI 的使用者；這類使用者保留未啟用狀態，不自動套新 provider。遷移寫入失敗明示 `settings_migration_failed`，不啟動 Sherpa 或假報已準備完成。

設定頁顯示 Apple availability／variant 和手動重試；key／URL／model 欄位僅顯示給需要的 provider。UI 可選不代表品質 gate 已通過；本版不自動開啟潤稿，後續若要改預設須另取得產品需求與驗收證據。

### 8. 品質 gate 先固定契約，再執行評估

固定版本的 fixture、reference、scoring、prompt、generation options、OS build、硬體、ASR mode、LLM variant／context、Ollama model digest 與 app／helper revision。預先分開 tuning 與 holdout；不得在看完 holdout 結果後降低門檻。以下數值是本次工程放行條件，尚未有實測結果。

最低資料集為 30 個配對情境，涵蓋繁中、中英混合、數字／日期／金額／單位、專有名詞、否定詞、口頭修正、停頓、無聲／雜音，並含 20–60 秒及至少 5 個五分鐘以上連續輸入／檔案。同一份音訊先固定 ASR 結果，再將相同文字提供各 LLM，避免將 ASR 變好誤判為潤稿變好。

| Gate | 通過條件與證據 |
| --- | --- |
| ASR 完整性 | 所有有效 fixture 無漏尾、重複 range、錯誤次序、輸入遺失；無聲不生成正常 history／貼字。所有 SRT range 有效、單調且在全檔時間內；失敗不得漏段後宣稱成功。 |
| 純 ASR 品質 | `accurate`／`responsive`／`dictation` 分開報告 CER、標點與關鍵欄位。固定相同 mode 的 27 相對既有 26.4 參考，整體 CER 劣化不超過 1 個百分點，且無新增關鍵欄位誤辨；未取得配對舊 OS 證據時，此比較標記 unverified，不能宣稱改善。 |
| 潤稿安全性 | 所有 holdout 均無新增事實、關鍵數字／日期／金額／單位／人名／否定意思變更或關鍵內容刪除；逐案人工審核，不以 regex 通過代替語意判定。任一重大錯誤即 gate 失敗。 |
| 潤稿效益 | 與不潤稿、固定 Ollama baseline 做盲評；Apple 相對不潤稿至少 80% 情境為較佳或相當，重大語意退步為 0。若宣稱優於 Ollama 或舊 Apple 世代，須另呈現配對勝／平／負及差異，不能以可執行代替品質提升。 |
| 跨 OS 可比性 | 26.0–26.3、26.4、27 分組，固定輸入與 prompt。正式 API 無法在 27 下載鎖定舊版，必須由實際舊 OS 環境／已封存且來源完整的輸出取得對照；欠缺環境則結論保持 unclear。 |
| 失敗與取消 | 資產缺少、離線、locale、guardrail、拒答、context、timeout、helper crash、重複／晚到 response、關閉潤稿、owner 銷毀、app shutdown 都有對應結果；無錯誤分支會發出 HTTP／啟動 Ollama／Sherpa。 |
| 生命週期與副作用 | 一般／串流／檔案／history／command，跨視窗連續操作與取消至少 20 次；一次保存／輸出、無殘留 busy／child／listener，歷史取消與 preview 不寫入，重試不重複貼上。 |
| 延遲與資源 | 分別報 cold／warm 的 capture、first-preview、stop-to-ASR-final、polish、history-save、stop-to-paste-command ACK 之 P50／P95、timeout 比率及 memory；禁止跨程序 raw clock 相減。Apple 潤稿正常短稿 P95 不高於同語料 Ollama baseline 的 110%，超出時 gate 不通過且不得宣稱較快。 |
| 打包與隱私 | 實際 app 驗證 helper resource、簽章、deployment target、TCC、離線成功、network spy／可控 adapter 證明 Apple 分支未呼叫網路 provider；產品 log 無文稿或 secret。 |

Apple 官方的一般模型／系統 dictation 人類偏好數字只作背景。它們不是 SpeakSlow 的台灣中文 ASR、潤稿或端到端結果；不得拿 AFM Core Advanced dictation 評估推成公開 Speech API 已換模型。[Apple 第三代模型研究](https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models)

測試分層：純路由／遷移／reducer／finalization 用 deterministic fixtures；helper cancellation／protocol 用 fake child 與 native integration；最後使用隔離 userData 的真實 macOS 27 打包 app，驗證完整錄音與輸出。測試成功、編譯成功、CLI 檔案辨識及 paste ACK 各自列出覆蓋範圍，不互相冒充 physical microphone／目標 App 收字驗收。

### 9. 封裝與 dirty 工作目錄採增量合併

修改前保存 `git diff -- package.json` 等必要基線；直接在目前內容上添加 Foundation Models build／resource 與 macOS minimum version。`build:renderer` 中既有 context-reader、apple-speech、window-visibility 與 Vite 步驟都保留，新增 helper 必須在 Electron 打包前完成。禁止用 `git checkout`、`restore`、整檔舊版本覆蓋或全域重新產生方式處理 dirty `package.json`。

兩個 Apple helper 的 build 在非 darwin 直接略過；Mac build 要求實際提供 27 SDK 的 toolchain，失敗明確停止，不能悄悄用舊 binary。helper build 和 Electron app 簽章需維持同一可驗證的封裝流程；不擅自更換簽署身份。打包後從 resources 驗證兩個 helper 的實際版本與架構，不能只查 source build 目錄。

Mac 不隨啟動或功能操作載入 Sherpa ASR。可以從 Mac 發行資源剔除辨識專用模型及 backend 路徑，但需先確認 `TextUtilityService`、繁簡／字典與既有 TTS 的依賴；仍必要的 utility 不得在初始化時建立 recognizer。Windows／Linux 的資源設定及 backend build 保持原契約。現有磁碟上的使用者模型不在此清理範圍。

驗證增量 diff 必須仍包含既有 window-visibility script／resource，且熱鍵 owner routing、外接顯示器指示器、Dock／window visibility 回歸通過。文件、native helper 與 renderer 的新版本完成不構成正式安裝授權。

## Risks / Trade-offs

- **系統語言模型隨 OS 更新且無鎖版 API** → 保存 OS build／variant／prompt version；維持固定 holdout，OS 更新重新評估；不可只看大版本號。
- **新版系統 dictation 與公開 SpeechTranscriber 模型關係 unclear** → 僅以公開 API runtime 及配對 ASR 證據聲明品質，不承諾接入 Core Advanced ASR。
- **Apple-only 令缺資產／不支援 locale 的 Mac 暫時無法辨識** → 啟動與設定明示 availability、下載與重試；不以另一引擎成功掩蓋失敗。
- **小模型可能改寫數字、否定、專有名詞或加入內容** → 預設關閉潤稿、零重大語意錯誤 gate、保留 baseline；失敗明示並使用原文，歷史確認後才覆寫。
- **上下文大小依模型或硬體而異** → 每次 runtime probe 和 native token preflight；超限 fail-closed，不截原文或無授權分塊。
- **取消與停止時的晚到事件造成重複保存／貼上** → job lease、request generation、terminal result 去重及各 async 邊界重查 owner；取消測試包含 helper 不合作情境。
- **ASR 與 LLM helper 同時存活提高記憶體** → session 用完釋放、只保留輕量 IPC、逐程序及系統服務分開量測；不以單一 PID 宣稱全機成本。
- **Mac utility 仍間接啟動 Sherpa recognizer** → status、emoji、文字轉換、TTS、history、file 全入口檢查；utility 與 ASR 初始化分離。
- **真實簽章、TCC 與 Electron 宿主差異** → 真正打包 app 的麥克風、helper、Accessibility 及目標輸入驗收獨立列 gate，CLI 成功只算局部證據。
- **dirty 工作目錄含其他已驗證修復** → 增量合併、read-back、必要回歸；不改寫與本需求無關的檔案，不自動提交。
- **無法取得舊 OS 實機對照** → 保存可重現的 27 結果並明示舊版本比較未驗證；跨 OS 品質宣稱保持 gate 未通過，不補造分數。

## Migration Plan

1. 固定 proposal／spec／design 與 holdout、reference、比較環境及通過門檻；先記錄 dirty 檔案基線，不更動真實使用者設定。
2. 實作並驗證 Mac platform gate、可重入設定 migration 與 Apple-only 路由。以隔離 DB 測試既有 Sherpa、Apple、legacy AI、自訂 provider、全新安裝、非法值及寫入失敗。
3. 新增 Foundation Models helper、manager、adapter 與明確 provider registry；先驗證 availability、tokens、取消、timeout、crash 與無網路分支，再接 UI。
4. 將串流、TXT 與 history 接入共用 finalization；保留 SRT／command bypass 及 baseline，完成跨視窗 single-flight、確認衝突與一次副作用回歸。
5. 在目前 dirty `package.json` 上合併 build／resources／minimum OS；完成 renderer、native helpers、平台測試與實際打包驗證。Windows／Linux 不使用 Apple migration／helper。
6. 執行固定品質 gate，逐條保存輸入來源、設定、版本、分數與失敗；未通過項目保持 open。Apple 成為新安裝的預選 provider 仍不自動打開潤稿。
7. 安裝或發行需另依已取得的明確授權執行。若獲授權本機安裝，統一使用 `npm run install:mac`／`npm run build:install:mac`；僅保留 `/Applications/SpeakSlow.app`，驗證後清理本次建置 `.app`，掃描專案及 Spotlight，保留 DMG／ZIP，不另存 `.backup`／`.old` app。

回退分兩層：使用者可關閉潤稿，或明確選回其既有 provider；這不會將 Mac ASR 切回 Sherpa。若需回退整個應用版本，須使用已保留安裝檔並另取得安裝授權。先關閉新 app，以回退工具恢復 migration 保存的先前 ASR 選擇及舊版不識別的 Apple provider 設定；只回復本次新增／變更設定，不倒灌整份 DB、不丟棄更新後產生的 history。舊 provider 有既存配置才恢復，沒有則保持潤稿關閉並要求使用者明確選用。回退工具不得開啟雲端 provider 或潤稿開關來讓檢查通過。原始文稿、音檔、模型與舊設定資料全程保留。

## Open Questions

以下為 implementation／release gates，不能以本文件存在視為已解除：

- **G1 Native SDK 與簽章**：確認使用的 27 SDK 中 availability、variant、tokenCount、response completion／取消與 error 型別的精確契約，並完成 helper／host 的實包簽章與 TCC 驗證。
- **G2 完整回應**：確認 native API 對輸出 token limit、拒答與截斷的可觀察訊號。若無法可靠判定完整，相關成功分支不得放行。
- **G3 zh-TW 能力**：在目標機器分別確認三個 ASR mode 的 locale／資產，以及 `SystemLanguageModel` 的 locale、variant 和 context；不能由 OS 或官方模型文章代替。
- **G4 品質與對照**：取得不潤稿、固定 Ollama 與 26.0–26.3／26.4／27 的合格來源及 holdout 盲評；舊 OS 無法取得時，跨 OS 品質比較仍未完成。
- **G5 長輸入與 SRT**：確認五分鐘以上供音、停止尾句、timestamp、取消及記憶體行為；超出 LLM context 的 TXT 必須保留完整原文並明示無潤稿。
- **G6 新安裝判定與降版**：確認 settings 初始化時機、原子遷移機制及先前 provider／ASR 設定的最小保存格式；降版工具須以隔離 DB 證明不遺失新 history。
- **G7 非 ASR 依賴與 dirty 合併**：確認 Mac 可剔除的 Sherpa 打包資產與仍必要 utility，並保留 window-visibility 與 recording owner 修復；Windows／Linux 的建置及路由回歸另列結果。

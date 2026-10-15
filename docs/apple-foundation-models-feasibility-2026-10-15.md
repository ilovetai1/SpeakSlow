# Apple Foundation Models 用於 SpeakSlow 潤稿的可行性

調查日期：2026-10-15（Asia/Taipei）。範圍：Apple 官方文件、WWDC、研究文章及本機 Apple 公開 CLI；本次先做調查與獨立探測，未整合或切換 SpeakSlow 的設定。

## 結論

**技術上可以。** Apple 的 `SystemLanguageModel` 能在本機執行文字生成、改寫等工作，適合列為 SpeakSlow 的另一個潤稿 provider。它支援自訂指示與繁體中文，不需 Ollama 或第三方 API key。但「API 成功產生文字」和「能保留逐字稿原意」是兩項不同的驗收；後者必須以 SpeakSlow 的實際提示詞、數字、自我修正、否定句與專有名詞測試。[Foundation Models](https://developer.apple.com/documentation/foundationmodels)、[語言與 locale](https://developer.apple.com/documentation/foundationmodels/supporting-languages-and-locales-with-foundation-models)

**工程建議：** 先以 macOS 27 內建 `fm serve` 接現有 Custom endpoint 做小規模配對測試；若品質合格，再評估提供原生「Apple（本機）」選項與 Swift helper。不要僅因支援繁中，就直接改成預設 provider。

## 已確認的版本、裝置與語言條件

| 項目 | 已確認內容與實作含義 |
|---|---|
| Framework 最低版本 | `SystemLanguageModel` 的公開 API 從 macOS 26.0 提供。macOS 15 的 Apple Intelligence／Writing Tools 可用，不等於可以呼叫這個 framework。[API availability](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel) |
| 目前版本邊界 | Apple 在 2026-09-14 已宣布 macOS 27 正式推出；本調查未把 WWDC26 的展示當成所有 macOS 26 裝置現有能力。[正式發布](https://www.apple.com/tw/newsroom/2026/09/major-updates-for-apples-software-platforms-are-now-available/) |
| 硬體 | 需要支援 Apple Intelligence 的 Mac。Apple 現行列表包括 M1 或更新晶片的 Mac，亦列有 A18 Pro 的 MacBook Neo；不能只檢查 `arm64` 就認定模型可用。Intel Mac 不在支援清單。[Apple 支援](https://support.apple.com/zh-tw/121115) |
| 啟用與資產 | 需要符合 Apple Intelligence 的語言、地區與系統條件，並等系統模型就緒。裝置語言與 Siri 語言需符合相同支援語言。不能因電腦型號合格就跳過 runtime availability。[Apple 支援](https://support.apple.com/zh-tw/121115)、[模型可用狀態](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel) |
| 繁體中文 | Apple 現行語言清單包含繁體中文；framework 官方說明它能理解及產生 Apple Intelligence 支援語言。舊 OS 的語言能力可能不同，不以目前官網清單代替每台機器檢查。[Apple 支援](https://support.apple.com/zh-tw/121115)、[語言文件](https://developer.apple.com/documentation/foundationmodels/supporting-languages-and-locales-with-foundation-models) |
| 台灣 locale | `supportedLanguages` 列實際支援語言，`supportsLocale(Locale(identifier: "zh-Hant-TW"))`／`zh-TW` 可作 runtime 檢查；它會接受與已支援 locale 足夠接近的 locale，所以 `true` 不代表台灣用詞品質已驗收。[locale API](https://developer.apple.com/documentation/foundationmodels/supporting-languages-and-locales-with-foundation-models) |
| 模型會更新 | 官方列出對應 26.0–26.3、26.4、27.0 的模型世代。OS 更新可能改變輸出，需重跑固定測試集，不可假設永遠是相同權重。[模型版本](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel)、[更新紀錄](https://developer.apple.com/documentation/updates/foundationmodels) |

`availability` 應在啟用 provider 與送出請求前檢查，至少能顯示裝置不符合、模型未就緒、其他無法使用原因；仍要處理生成時拋出的錯誤。不可把模型未就緒顯示成 API key 錯誤。[availability](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum)

## Context、指示與生成控制

**Context 不是一律 4K。** Apple 一般 context 說明與 PCC 比較表仍寫 on-device 4,096 tokens；WWDC26 的程式碼則明列「26.0：4,096；27.0 newer devices：8,192」。應讀 `contextSize` 的實際值，不能硬編碼 4K 或 8K。`tokenCount(for:)` 可計算指示、prompt、transcript；這項功能在 26.4 更新中加入。每個 session 的指示、輸入、歷史與輸出共用 context，並不是輸入能獨占整個窗口。[context 管理](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)、[WWDC26 319：5:58 範例](https://developer.apple.com/videos/play/wwdc2026/319/)、[contextSize](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/contextsize)、[26.4 更新](https://developer.apple.com/documentation/updates/foundationmodels)

對 SpeakSlow 的工程推論：每次潤稿用全新 session，避免不同錄音互相污染。預留與原稿接近的輸出 token 空間；長稿按語意邊界分段，保護段落間的人名、否定與數字關係。Apple 的「中文大致一字一 token」只是估算，不能以字數代替實際 token 預算。[生成與 context 限制](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)

- `LanguageModelSession(instructions:)` 可提供角色、潤稿範圍、禁止增補等規則；把逐字稿放在 `Prompt`，不把其內容拼成高優先級 `Instructions`。Apple 明示 instructions 優先於 prompt，未驗證輸入放進 instructions 會增加 prompt injection 風險。[安全與指示](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output)
- 官方建議用精簡、單一任務的指示。現有提示詞應實測後調整，不假設為 Ollama 寫的長提示詞是 Apple 模型的最佳設定。[prompting](https://developer.apple.com/documentation/foundationmodels/prompting-an-on-device-foundation-model)
- 台灣繁中可用 `The person's locale is zh_Hant_TW.` 及明確的「使用台灣繁體中文，保留英文產品名」等指示。前一句是 Apple 建議的 locale 格式；後一句仍需輸出驗證。[語言指示](https://developer.apple.com/documentation/foundationmodels/supporting-languages-and-locales-with-foundation-models)
- `temperature` 範圍為 0–1；低溫讓輸出較穩定。`.greedy` 每次選最高機率 token，適合做可重現的基線，但不保證事實或語意正確，也不保證 OS 更新後輸出相同。[temperature](https://developer.apple.com/documentation/foundationmodels/generationoptions/temperature)、[greedy](https://developer.apple.com/documentation/foundationmodels/generationoptions/samplingmode-swift.struct/greedy)
- `maximumResponseTokens` 達上限時會提早停止，而且不一定拋錯。潤稿不可把這種截斷當成完整稿成功保存；需保留輸出完整性檢查與明確狀態。[輸出上限](https://developer.apple.com/documentation/foundationmodels/generationoptions/maximumresponsetokens)

## 本機、PCC、guardrails 的邊界

使用 `SystemLanguageModel` 是 on-device，能離線工作，無逐次 API 費用；系統資產就緒前仍需完成系統下載。**Foundation Models framework 本身已能接多種模型，所以「用了這個 framework」不能單獨作為未上雲的證據。** 正式 provider 應明確指定系統本機模型，並禁止未經選擇改用 PCC 或第三方 server。[on-device 官方說明](https://developer.apple.com/videos/play/meet-with-apple/205/)、[framework 模型範圍](https://developer.apple.com/foundation-models-framework/)

macOS 27 新增的 `PrivateCloudComputeLanguageModel` 是另外選擇：會送到 Apple 的 PCC，需要網路，官方列 32K context、每日用量限制與獨立資格／entitlement。它不是本任務的本地模型；不可把 Apple Intelligence 的系統級本機／雲端路由宣稱套到 `SystemLanguageModel`。[PCC 文件](https://developer.apple.com/documentation/foundationmodels/adding-server-side-intelligence-with-private-cloud-compute)

預設 guardrails 可能阻擋敏感逐字稿，也可能以一般字串回覆拒絕，不能只看 HTTP/API 成功就認定內容是潤稿。Apple 提供 `.permissiveContentTransformations`，適合轉換可能含敏感內容的既有文字；此模式的 `String` 回應不做同樣的 guardrail 拋錯，但模型仍可能拒答。結構化生成仍採一般 guardrails，因此 `@Generable` 不是繞過拒答或保證內容正確的方法。是否採 permissive 模式應以逐字稿用途及實測決定，不能 silent fallback。[guardrails 模式](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/guardrails/permissivecontenttransformations)、[拒答處理](https://developer.apple.com/documentation/foundationmodels/improving-the-safety-of-generative-model-output)

## Electron 接法

| 路徑 | 適用情況與限制 |
|---|---|
| macOS 27 `fm serve` → Custom endpoint | Apple 官方介紹 `fm` 為 macOS 27 預裝 CLI。本機 `/usr/bin/fm serve --help` 明列 `/health`、`/v1/models`、`/v1/chat/completions`，支援 streaming/non-streaming，`system` 是本機模型。可先綁 `127.0.0.1` 做現有 adapter 相容性測試；服務生命週期、預設參數、錯誤映射、版本相容性仍需實測。[官方 CLI 說明](https://developer.apple.com/videos/play/wwdc2026/334/) |
| Swift helper → stdin/stdout JSON → Electron 主程序 | 工程建議的原生整合：helper 呼叫公開 `FoundationModels` API，回傳 availability、locale、contextSize、文字、耗時與錯誤；Electron 管理程序及 timeout。可沿用跨程序架構並明確控制 session。需額外完成包裝、簽署與最低 OS 測試；這是設計建議，未實作。[原生 Swift API](https://developer.apple.com/foundation-models-framework/) |
| Apple 官方 Python SDK | Apple 已提供 `apple-fm-sdk`，需求 macOS 26+、Python 3.10+、Xcode 26+ 及 Apple Intelligence。適合評估／批次測試；是否加入 SpeakSlow 發布包應先確認其 build/runtime 相依，不能僅因專案已有 Python 就認定免費整合。[Apple SDK](https://github.com/apple/python-apple-fm-sdk) |

## 效能、記憶體與散布條件

已確認：系統模型不需把權重另包進 SpeakSlow；Apple 2026 研究分別描述 AFM 3 Core（3B dense）與 AFM 3 Core Advanced（20B sparse、每次啟動約 1–4B）。因此不能把所有 macOS 27 的本機模型簡稱同一個「3B 模型」。`variant` 是 macOS 27+ API，可讀目前使用的變體。[模型變體](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/variant-swift.struct)、[Apple AFM 第三代研究](https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models)

尚未由官方來源證明：SpeakSlow 實際潤稿能比目前 Ollama 更快、更省 RAM、更準，或每次都只用 ANE。Apple 的模型架構與其他任務 benchmark 不能替代這台 Mac、相同稿件與相同驗收規則的配對測量。需要分開記錄首次請求與後續請求、短稿與長稿、生成耗時與完整管線耗時、app RSS 與系統模型服務資源。

一般 on-device 快速開始與 Apple 官方範例未列出模型專用 managed entitlement 或 App Store 上架前提；本次獨立 helper／CLI 能否執行與未來 SpeakSlow 正式簽署散布是不同驗證。Apple 的 Acceptable Use Requirements 仍適用。PCC 則明確需要 App Store Small Business Program、少於 200 萬次首次下載、取得 managed entitlement，官方發布路徑列 App Store，測試列 TestFlight／ad hoc；不能把 PCC 資格要求套到普通本機潤稿，也不能假設目前 Developer ID 發布可用 PCC。[官方 sample](https://developer.apple.com/documentation/foundationmodels/origami-crafting-a-dynamic-tutorial-for-apple-intelligence)、[使用要求](https://developer.apple.com/support/terms/acceptable-use-requirements-for-the-foundation-models-framework/)、[PCC 資格](https://developer.apple.com/private-cloud-compute/)

## 本機探測與現有 adapter 相容性

原始輸入、輸出、參數與耗時見 [本機 probe 證據](/Users/chunghan/AI/SpeakSlow/docs/apple-foundation-models-probe-2026-10-15.json)。以下均為 2026-10-15 本次觀察；樣本是人工文字，未測語音辨識。

| 本機項目 | 實際結果 |
|---|---|
| 裝置 | MacBook Pro / Mac17,2 / Apple M5 / 16 GB / arm64 |
| OS | macOS 27.0.1，build 26A434 |
| 編譯器 | Apple Swift 6.4，Xcode macOS SDK |
| `SystemLanguageModel.default.availability` | `available` |
| `variant` | `AFM 3 Core Advanced` |
| `contextSize` | `8192` |
| `supportsLocale` | `zh-TW`、`zh-Hant-TW` 均為 `true` |
| `supportedLanguages` | 明列 `zh-Hant-TW`，亦含 `zh-Hant-HK`、`zh-Hans-CN` 等 |

獨立 Swift 探測使用 `SystemLanguageModel.default`、預設 guardrails、每筆全新 session、`.greedy`、`maximumResponseTokens: 2048`。系統指示與目前 app 相同；user prompt 直接由 [aiPrompts.js](/Users/chunghan/AI/SpeakSlow/src/helpers/aiPrompts.js:1) 的預設提示詞與逐字稿組成。未加入外部情境或寫作格式。這是測試既有提示詞的相容性，尚未加入 Apple 建議的 locale 指示或調整提示詞。

| 人工樣本 | 原生生成耗時 | 觀察 |
|---|---:|---|
| 贅詞與重複，30 字 | 935 ms | 去除「嗯那個」「今天今天」，補入標點 |
| ECOCO、API、日期、數字與英文，82 字 | 972 ms | 保留主要實體字串，但將 `timeout` 接到「API endpoint 不要改」之後；可能改變原句修飾關係，不列語意通過 |
| 金額自我修正及不上線條件，30 字 | 738 ms | **失敗：將改正後金額反轉** |
| 含刪除／寄信提議及反對立場，36 字 | 665 ms | 回傳與原文相同，沒有執行其中請求，也沒有改善標點 |

自我修正案例的精確輸入：

```text
這個費用是三萬不是不是是三千五百元我們不要上線等測試通過再說
```

實際輸出：

```text
這個費用是三萬，不是三千五百元。我們不要上線，等測試通過再說。
```

人工判讀：原稿的「不是不是是三千五百元」是將先前的三萬元改正為 3,500 元；輸出卻肯定三萬元、否定 3,500 元。**API 4/4 回傳成功，內容驗收沒有通過。** 因此不能把這個結果當成可直接替代現有潤稿模型的證明。

### 現有 Custom endpoint 的直接相容性

本機 `/usr/bin/fm serve --help` 明列 Chat Completions server；啟動只綁 `127.0.0.1` 的暫時服務後，`/health` 顯示模型可用，`/v1/models` 回傳 Apple 的 `system` 模型。使用 repo 現有 [OpenAICompatibleAdapter](/Users/chunghan/AI/SpeakSlow/src/helpers/ai/openAICompatibleAdapter.js:15) 實際送出請求，沒有替換 adapter 的 HTTP 實作。

可用的設定組合如下。這是已測試的設定形式；**本次沒有寫入 SpeakSlow 設定，也沒有留下常駐服務**。

| 欄位 | 值 |
|---|---|
| Provider | `Custom endpoint` |
| API base URL | `http://127.0.0.1:<所選本機 port>/v1` |
| Model | `system` |
| API key | `local`，非 secret 的佔位字串；目前 SpeakSlow UI/adapter 要求欄位非空，Apple 模型本身不需 API key |
| 服務 | `/usr/bin/fm serve --host 127.0.0.1 --port <同一 port>` |

現有 adapter 送出 `temperature: 0.3`、`max_tokens: 2000`、`stream: false`。三筆請求均成功：狀態測試回覆「測試成功」（1,114 ms）、短稿潤稿（620 ms）、金額自我修正（742 ms）。**金額案例在此路徑同樣反轉意思。** 這證明目前 adapter 與本機 API 可通訊；沒有證明所有 OpenAI API 功能／參數都受支援，也未驗收已安裝 app 的完整 UI 流程。

### 正式接入需要處理的專案位置

- Provider 分派目前只區分 Ollama 與 OpenAI-compatible：[aiTextProcessor.js](/Users/chunghan/AI/SpeakSlow/src/helpers/aiTextProcessor.js:146)。新增原生 Apple provider 時，狀態檢查的分派也要同步處理：[aiTextProcessor.js](/Users/chunghan/AI/SpeakSlow/src/helpers/aiTextProcessor.js:254)。
- 設定選單目前沒有 Apple，且只豁免 Ollama 的 API key 要求：[settings.jsx](/Users/chunghan/AI/SpeakSlow/src/settings.jsx:1460)、[儲存條件](/Users/chunghan/AI/SpeakSlow/src/settings.jsx:1839)。原生 provider 應顯示裝置／模型狀態，不要求虛構 API key。
- 現有 500 字限制僅套在 Ollama：[aiTextProcessor.js](/Users/chunghan/AI/SpeakSlow/src/helpers/aiTextProcessor.js:134)。它不是 Apple 模型限制；Apple 需依總 token 預算處理，Custom endpoint 目前也不會自動套用該字數限制。
- 游標附近的情境潤稿只允許 `provider === 'ollama'`：[aiTextProcessor.js](/Users/chunghan/AI/SpeakSlow/src/helpers/aiTextProcessor.js:157)。因此 Custom endpoint PoC 只證明基本潤稿，不能宣稱已繼承這項功能。原生 Apple 若要支援，需另做資料界線與 token 預算設計。
- 延遲統計將非 Ollama 歸為 OpenAI-compatible，畫面稱為遠端；Apple 本機接入需修正分類與顯示：[latencyManager.js](/Users/chunghan/AI/SpeakSlow/src/helpers/latencyManager.js:68)、[EvolutionSettings.jsx](/Users/chunghan/AI/SpeakSlow/src/components/EvolutionSettings.jsx:64)。
- 既有 Swift helper 已採子程序與 JSONL：[appleSpeechManager.js](/Users/chunghan/AI/SpeakSlow/src/helpers/appleSpeechManager.js:42)。可沿用此模式、[建置方式](/Users/chunghan/AI/SpeakSlow/scripts/build-apple-speech.mjs:8)與 [extraResources 打包](/Users/chunghan/AI/SpeakSlow/package.json:181)，新增獨立文字模型 helper；不需改寫語音辨識引擎。

### 未驗證項目與決策

短文的 0.67–0.97 秒是本次原生 `respond` 呼叫耗時，未控制系統模型先前是否已載入；不含語音辨識、貼上與 app 啟動。沒有做冷啟動、長稿、RAM／電力或端到端測試。當時 `127.0.0.1:11434` 未監聽，故未做 Ollama 同稿配對，不能宣稱 Apple 更快、更省記憶體或品質更好。

建議將 Apple 本機模型列為候選，先用相同文字集配對現有 Ollama，分開計算數字／日期／否定／自我修正錯誤、文字完整性、專有名詞與繁中用詞，以及首次與後續請求延遲。當前已出現的語意反轉必須列為阻擋預設切換的問題；提示詞調整後仍需重跑固定樣本與未見過的實際稿件。

本次僅新增此報告與 JSON 實測資料；未變更應用程式原始碼、使用者設定、安裝副本或 DB，測試服務已停止。

## 後續需求：縮限為同音錯字校正

使用者將最低需求縮為「修訂錯字」，例為「下面／下麵」「頁面／頁麵」。本次將驗收改為：只修正上下文可確定的同音錯字，保留其他字、標點、數字、否定及口語自我修正。這與前面的全文潤稿是不同任務。

**結論：方向可行，但本機 Apple 模型在本次固定小樣本仍未通過自動套用的內容驗收。** 只把提示詞改成「保守校字」或明列可替換詞，都不能保證模型只改錯字。讓模型只選候選詞、由程式替換指定位置，可在結構上限制改動範圍；模型本身仍會選錯或漏改。

### 試驗方式與結果

原始提示詞、輸入、預期、輸出、逐筆比對與耗時見 [校字探測紀錄](/Users/chunghan/AI/SpeakSlow/docs/apple-foundation-spelling-probe-2026-10-15.json)。共 20 句人工文字，每句測兩次；其中 18 句是面／麵、正確用字保留、金額保留、引用字串與資料內指令反例，另 2 句城市碼／程式碼只作延伸觀察。後者的含義可能依實際業務而異，以下主要分數排除這兩句。

使用本機 `AFM 3 Core Advanced`、預設 guardrails、全新 session、greedy sampling。所有 188 次模型請求均成功回傳。兩次重複的逐筆輸出完全相同，所以下表以 **18 個不同句子** 計分，沒有把重複結果當成 36 個獨立樣本。這些提示詞是在同一組測試上探索，尚無獨立保留測試集，不能當作真實準確率。

| 做法 | 18 句完整符合預期 | 單次請求耗時中位數 | 限制 |
|---|---:|---:|---|
| 一般保守校字，回傳全文 | 8/18 | 443 ms | 漏改明確錯字，也誤改煮麵用字 |
| 明列目標詞與反例，回傳全文 | 9/18 | 457 ms | 仍有刪字、換詞及無關改寫 |
| 指定候選位置，只回 KEEP／REPLACE | 13/18 | 370 ms | 只重建允許替換的位置，仍有漏改；一句多個候選會有多次請求 |
| 指定候選位置，只回原詞或候選詞 | 7/18 | 295 ms | 換成英文指示及直接回詞，這組測試反而更差 |
| 最短中文校字提示詞，回傳全文 | 7/18 | 392 ms | 精簡提示詞沒有消除漏改與誤改 |

上表的候選法分數，是將模型選擇套回原句後做嚴格全文比對。沒有候選詞的句子直接保持原文，沒有送模型。這是獨立測試中的重建，尚未實作到 app。耗時包含本次所有 20 句／17 個候選位置，僅量 `respond` 呼叫，不代表冷啟動或端到端延遲。

幾個可直接判讀的觀察：

- 一般保守提示詞能將「請打開這個頁麵。」改為「請打開這個頁面。」，卻保留了錯誤的「請看下麵的說明。」。
- 全文輸出曾將「我正在下麵，等一下就可以吃了。」誤改為「我正在下面，等一下就可以吃了。」，也將「下麵前先把水煮滾」誤改為「下面前先把水煮滾」。
- 明列詞彙後，「請看下麵的說明。」曾變成「請看下面說明。」；雖修正了目標字，卻多刪了「的」，不符合縮限後的規則。
- 最佳候選法保留了兩個煮麵反例、引用原樣字串與沒有上下文的「下麵」，但仍漏改「請看下麵的說明。」「按鈕在圖片下麵，不是在上面。」等。
- 先前的金額自我修正原句，在三種縮限後的全文方法均完整保留；這個已知案例改善，不等於其他數字或否定句都已驗收。

### 適合此需求的工程方向

1. 對已確認且限定使用情境的固定錯詞，可用規則處理「頁麵 → 頁面」，不必每次呼叫模型；若是程式字串等需要原樣保留的內容，需保護該範圍。
2. 「下麵 → 下面」需要上下文，不能當成無條件的全域替換；煮麵的「下麵」有不同含義。現有 [applyDictionary](/Users/chunghan/AI/SpeakSlow/src/helpers/database.js:179) 使用全域字串替換，沒有這層語意判斷。
3. Apple 模型若參與，只讓它對指定位置選字；程式驗證候選 ID、原詞、替換詞與位置，限制只能修改允許的字。這能防止全文刪改，但不能消除語意錯選。
4. 不明確的上下文保留原詞；模型請求失敗、回傳格式錯誤與使用者未開啟此模式，需沿用可觀察的狀態處理。尚未進行實作或更動既有錯誤契約。

依目前證據，固定錯詞規則是較直接的第一步；Apple 上下文選字仍需在新的實際逐字稿上驗證，尚不能作為通用自動校字已完成的結論。本次未新增字典規則，也未變更 app 設定或程式碼。

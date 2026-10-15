> 2026-10-14 更新：使用者已授權按本規劃實作與測試。以下「本次只規劃」等範圍說明指初次提案階段；目前進度及未驗收項目以 tasks.md 為準。尚未授權 commit、push、正式安裝或發行。

## Context

本次只規劃新增可切換的 Apple 辨識路徑。原始碼基線與前次試驗見 proposal；官方使用方式及證據界線見 [Apple SDK 研究](../../../docs/APPLE_SPEECH_SDK_RESEARCH_2026-10-14.md)。

目前耦合點已從原始碼確認：

| 接縫 | 現況與接入需求 |
| --- | --- |
| `main.js:220` | 啟動時無條件初始化 Sherpa；改為只準備所選引擎。 |
| `useModelStatus.js`、模型 status IPC | 輪詢直接呼叫 Sherpa；改為協調器能力與生命週期，未選引擎的查詢不能載入模型。 |
| `useRecording.js:128` | 錄音前只接受 Sherpa ready；新增共用 session，Apple 在錄音期間持續接收音訊。 |
| `useStreamingRecording.js:39` | Zipformer 路徑以 500ms 靜音切段；此設定只屬 Sherpa，不移植到 Apple。 |
| `src/settings.jsx:1012` | Sherpa 效能與串流開關、熱詞 UI；依所選引擎顯示適用設定，不互相覆寫。 |
| `sherpa_server.py:1499` | 標點模型＋句尾規則；Apple 的原生標點繞過這一層。 |
| `ipc/transcription.js:125,215`、`TranscribeModal.jsx:47` | 一般／歷史／檔案（目前60秒一段）都直接用 Sherpa；必須明確路由且不漏段。 |
| `ipc/emoji.js`、`commandMode.js` | 符號、文字轉換、TTS 也依賴 Sherpa server；分離純文字／utility 執行，避免 Apple 模式間接載入 ASR。 |
| `LatencyManager` | `provider` 表示 LLM，不能拿來放 ASR；另外增加固定 ASR 維度並保留舊指標。 |

進行中的 2.1.0 change 仍有原驗收邊界，本提案不替它補完。前幾輪試驗是裸引擎短句資料；CER 排除了標點，Swift 原型只收集明示 final，不能代表長串流的完整性、正式 bridge 或完整麥克風至貼上效能。

## Goals / Non-Goals

**Goals:**

- 兩個上層選擇：現有本機引擎與 Apple 原生引擎；預設保留 Sherpa。
- 可見且持久的選擇、精確繁中能力判定、明確失敗、閒置時切換，以及穩態單一辨識 runtime。
- Apple 的原生標點、range／watermark 正確的串流文字，以及共用字典／潤稿／歷史／貼上契約。
- 涵蓋一般錄音、操作模式、歷史重辨識、檔案與字幕入口，以及不含文稿的引擎分群量測。
- 以 macOS 26 API 做最低可用路徑，另在實際打包版驗證權限、生命週期與輸出品質。

**Non-Goals:**

- 不指定 ANE 核心數、不承諾每個步驟都在 ANE、不以 CPU 降幅宣稱耗電或 iPhone 同等體驗。
- 第一版不提供 `DictationTranscriber`／舊 `SFSpeechRecognizer` 作隱含 fallback，不宣稱新版支援辨識前熱詞或自訂語言模型。
- 不重寫整個 Electron 介面、不移除跨平台 Sherpa、Python 套件或使用者已下載模型，不刪共用 Apple 模型資產。
- 不自動貼入可變的 partial、不自行改動既有 AI 潤稿開關、輸出位置、Enter、音檔留存或字典核准規則。
- 本次不執行產品實作、真正使用者設定寫入、正式建置／安裝／發佈或 history DB migration。

## Decisions

### 1. 主程序擁有引擎選擇與生命週期

新增 `SpeechEngineManager`；`SherpaAdapter` 包住現有實作，`AppleSpeechManager` 擁有自有 Swift helper。一般、檔案及歷史工作的引擎 ID 在 job 建立時凍結，後續不得讀取新設定換引擎。

共用介面涵蓋 `capabilities / prepareAssets / prepare / openSession / feed / finish / cancel / transcribeFile / dispose`。capabilities 查詢與設定畫面不得啟動未選引擎的模型。`dispose` 必須 await session 清理與自有 child 結束；不得對共用系統 speech／ANE 服務送 kill。

選擇只經專用 main IPC 驗證與保存；通用 `set-setting` 對這些 key 轉交同一控制器，不能繞過忙碌檢查與生命週期。保存失敗時 UI 與 runtime 都保留先前選擇。

| 設定 | 值與預設 | 邊界 |
| --- | --- | --- |
| `asr_engine` | `sherpa`（預設）／`apple` | 缺值視為 Sherpa；非法值為設定錯誤，不啟動任意 runtime。 |
| `apple_response_profile` | `accurate`（預設）／`responsive`／`dictation` | 前兩者使用 Speech：只有 `.volatileResults`／再加 `.fastResults`；第三者明確使用 Dictation 的 `progressiveLongDictation` 並加 audio-time attributes，不改舊值語意。 |
| Apple locale | 第一版固定 `zh-TW` | 不把 UI 語言當辨識語言；canonical 底線／連字號差異可正規化，不接受換成 `zh-CN` 等區域。 |
| 既有 Sherpa 設定 | `asr_profile`、`enable_streaming_mode` 等 | Apple 模式不套用也不清除，切回時恢復其原值。 |

UI 分開呈現「已選引擎」與「實際狀態」：`checking / needs_download / downloading / preparing / ready / busy / stopping / unavailable / failed`，以及固定 reason code。初次選 Apple 若資產不足，先顯示下載需求，由使用者按下載；不把選擇成功畫成已可錄音。

### 2. 切換是受控交易，不是單純更改下拉值

錄音、辨識、定稿、潤稿、保存、輸出，或檔案／歷史 job 忙碌時，拒絕切換且不排入背景隊列。各視窗共用主程序的 busy gate，不能只有設定視窗按鈕 disabled。

閒置切換流程：驗證請求與靜態能力 → 成功保存選擇 → 失效舊 generation／攔住新 job → dispose 舊 runtime並等退出 → 所選引擎能力／資產／準備 → ready。持久的選擇表示使用者意圖，`activeEngine` 只有 runtime 確認 ready 才有值；失敗時 active 可為空，UI 顯示所選引擎失敗與重試／明確選回按鈕。

不自動啟動舊引擎恢復服務，也不把失敗新選擇改寫回舊值。新啟動若保存的 Apple 在該主機不可用，同樣保持該選擇與原因，讓使用者明確選 Sherpa。所有 late callbacks、下載完成與舊 session 結果必須比對 generation，不得重新啟用舊 runtime 或貼字。

穩態只保留一個 ASR runtime；切換資產查詢及系統共享下載不構成第二個 ASR 模型實例。own child 的退出 timeout 可作有界終止；數值在實作時固定並測試，不以無限 await 吞掉切換失敗。

### 3. Apple 支援與資產採 runtime gate

產品 gate：macOS ≥26、目前發行的 Apple Silicon 架構、helper 可執行且 protocol v2 相容、所選模組精確 `zh-TW` 在自身 supportedLocales、該 module 資產 ready、session prepare 成功。Speech 額外查 `SpeechTranscriber.isAvailable`；Dictation 沒有對等屬性，不以 Speech availability 阻擋 Dictation。靜態機型清單不能取代 API；查詢失敗不能假報不支援。

`supportedLocale(equivalentTo:)` 可能選其他區域，不能直接把回傳非 nil 當成繁中支援。下載與 reservation 使用部署 SDK 的實際 API；區分 supported、reserved、installed 與 downloading，不用 Sherpa 的檔案存在邏輯推論 Apple 模型。

模型由 Apple 管理，不複製到 repo 或應用 resources。下載進度只從系統 Progress 顯示；離線缺資產、磁碟／reservation 限制及下載失敗明示。取消準備立即撤銷本 app 的等待與 late result，但不保證可停止系統共用下載；解除 app reservation 不等於刪除全機模型。來源與精確 API 見官方研究。

第一版使用 `.whileInUse` 與有界 session 生命週期；session 結束後釋放 analyzer／module，helper 可保留輕量 IPC。模型快取是否由系統保留與何時回收以實測標示，不承諾 exit 即完全歸零。不啟用 OS 27 的 `ignoresResourceLimits`，也不預設 `.processLifetime`。

### 4. Swift helper 接收連續音訊，不接管麥克風

沿用 Electron 的麥克風裝置、自動增益、快捷鍵、指示器與救援行為，將同一 capture 的音訊送到選定 adapter。Swift helper 只接受 main 轉送的音訊與受控命令，不接受 shell、網路 endpoint 或任意讀檔路徑。

先用版本化 JSONL 控制與 base64 PCM16 音訊，包含 `requestId / sessionId / generation / sequence / sampleRate / channelCount / frames`。主程序驗證 shape、大小、順序與 session；helper stdout 僅 protocol，logger 僅固定狀態／reason／duration，不能原樣輸出文稿、音訊或 stderr。

音訊先按實際 AudioContext sample rate 組塊，不假設瀏覽器真的提供請求的16kHz。helper 向 module 取得最佳格式，macOS 26 以 `AVAudioConverter` 轉換後產生 `AnalyzerInput`；OS 27 的 `AnalyzerInputConverter` 只是可選實作，不能成為最低路徑依賴。以 sample frame 建立單調音訊時間軸，最後 flush converter。

初始塊長100ms，單一訊息上限256KiB；未送入 helper 的待處理音訊上限2秒。這是傳輸緩衝限制，不是總錄音長度。使用 ACK／序號做 backpressure；超限回 `audio_backpressure` 並停止，不丟 chunk、截稿或以空白補成成功。現有救援與音檔保留契約另行維持。

### 5. 文字以 range 與 finalized-through watermark 合併

`SpeechModuleResult.isFinal` 的契約不保證某段 volatile 日後一定重發 `isFinal=true`。新增獨立 transcript reducer：按 audio range 替換可變片段，追蹤 `resultsFinalizationTime`／analyzer 的 volatile boundary，保留邊界前已定稿但未重發的文字。不可只做 final append／partial replace；不可把每一個 tentative 字串串接成結果。

正常停止：停止 capture → 餵完並 ACK 尾塊 → flush converter → 結束 input sequence → `finalizeAndFinishThroughEndOfInput` → 等 results drain及reducer final snapshot → 共用 finalization。長稿可累積多個原生 final range，但所有正常輸出只執行一次。

取消：失效 generation、終止供音、取消 analyzer 與讀取 task、清理 converter／buffer；不得在取消後 drain 出文稿再貼上。ASR 失敗則顯示未完成，不把 partial 當正常成功稿件；可保留已顯示預覽供使用者辨識原因，但不自動保存／貼上它。空語音不跑潤稿、不新增正常歷史、不貼字。

### 6. 原生標點、詞庫與定稿共用而不混淆

Apple 模式保留引擎的標點、大小寫與原生分段，不呼叫 ct-punc、`apply_punct_rules`、500ms 靜音重啟或 Sherpa 音量正規化。既有 `auto_line_break` 與 `auto_format_lists` 是 Sherpa 的停頓切分及規則列點選項，Apple 設定畫面明示不適用；不把 Apple 的結果片段擅自轉成換行。預覽文字允許修訂，未定稿不得寫進目標輸入欄位；正式輸出不做逐字回刪／重貼。

穩定文稿才依既有設定做繁體轉換與全域／App 字典，然後進入既有 `finalizeTranscript`。AI、貼上、Enter、current-cursor、操作模式 bypass、保存失敗處理與學習核准都沿用既有契約。只准明確詞組規則，不新增無授權的全字元同音更換或語意改寫。Apple 的熱詞 UI 顯示不適用，辨識後詞庫仍可用；不把詞庫編輯誇大成重新訓練 Apple 模型。

`DictationTranscriber` 已於 2026-10-15 擴充為明確模式，不作 Speech 失敗時的替代。contextualStrings／custom language model 仍可另開後續能力；`zh-TW` 回傳音素表不代表建立、載入、推論改善已通過。

歷史比較持有同一個 coordinator lease，從 record ID 取得已保存音訊，讀檔一次，依指定順序對相同 bytes 執行 Speech 與 Dictation。每塊依 sample clock 節奏供音，模型準備另計；first-text 從供音開始計，final tail 從最後音訊的預定結束點計，均使用 main 的 monotonic clock。比較不走字典／繁體轉換／AI／保存／貼上，也不寫入一般錄音 metrics。允許反轉順序；完成或取消後恢復原保存模式，恢復失敗明示 failed。缺資產以該欄失敗呈現，不自動下載或換模型。CER 僅在使用者提供參考文字後顯示，保留繁簡及選詞差異，忽略標點／空白；計分每份上限 2000 字且超限明示。

### 7. 所有入口與非 ASR 工具都要有邊界

| 功能 | 規劃行為 |
| --- | --- |
| 一般錄音／操作模式 | job 凍結引擎；Apple連續輸入，Sherpa沿用原一般／precog／Zipformer設定；共用定稿與輸出。 |
| 歷史重新辨識 | 明示使用當前所選引擎，不冒稱是原歷史引擎；無保存音檔仍不可重辨識，不新增 history metadata欄位。 |
| 檔案TXT | 同一檔案是一個 job；Apple 的輸入區塊不等於結束辨識session，不用固定60秒硬切斷上下文。 |
| SRT | 以可信的原生 range／audio time metadata 建立全檔時間軸；不依字數比例編造逐字時間。無可靠區間或單段失敗須明示，不能回TXT或漏段後顯示完成。 |
| 字典／符號／繁簡轉換 | 提取不載入 ASR 的 `TextUtilityService`，沿用既有資料與詞組契約；狀態與設定不觸發 Sherpa模型。 |
| TTS等Python附屬功能 | 需要原有Python依賴時以獨立utility模式／worker執行，啟動不得建 ASR recognizer；原雲端TTS的資料範圍與開關不擴張。 |
| 音檔保存／救援／保留期 | 從Sherpa轉錄所有權移到共用store，完全沿用原設定；檔案 `no_persist` 與重辨識不得重複保存。 |

替換所有會在 status、emoji、text_transform、TTS、檔案與歷史入口間接喚醒 ASR 的路徑，是降低常駐記憶體的必要任務；只換錄音按鈕下拉選單不算完成。

### 8. 計時資料、版本與封裝

LLM `provider` 保持原分類。以 `latency_metrics_v2` 加固定 `asrEngine=sherpa|apple|unknown`、`asrProfile=standard|fast|streaming|accurate|responsive|unknown` 與有限 stage enums。唯讀匯入既有v1可用記錄、按opaque ID去重，舊記錄標unknown，之後只寫v2；v1不覆寫，降版只看不到新指標而不改歷史或設定。clear同時清除兩版指標及in-flight collectors，避免匯入後復活。保留七天／1000筆、disabled／清除／匯出、同程序monotonic clock與無文稿allowlist。

新增可比較的 first-preview、stop-to-ASR-final 與現有 stop-to-paste-command；不同程序的 duration各自計算，不能相減原始clock。貼上 ACK仍不代表目標欄位已收到。產品不內建全程序memory／Instruments追蹤；physical footprint、CPU與ANE另用授權診斷bench驗收。

Swift helper以 SDK26可用API編譯，deployment target26；主應用不提高全域minimumOS，舊系統不得嘗試載入helper。沿用native build與簽章封裝流程但不變更目前簽署身份。helper與host的TCC歸屬、麥克風usage description及hardened-runtime權限必須在真正打包版驗證；官方研究區分SpeechAnalyzer與舊SFSpeechRecognizer的授權，不能一律增加舊Speech權限。既有Accessibility貼上權限不因ASR改動擴張。

### 9. 選擇理由與替代方案

| 選擇 | 取捨及已考慮替代 |
| --- | --- |
| 保留Sherpa預設、Apple明確選用 | 讓使用者比較不同錯字與輸入偏好；不由裸引擎資源優勢推成自動換引擎。 |
| 自有Swift helper＋現有Electron capture | 複用快捷鍵與裝置設定，隔開OS API；native addon會增加Electron ABI維護，整套native UI超出本版。 |
| Accurate 明確 `.volatileResults` | 可預覽但仍保留完整上下文；直接套progressive preset可能同時打開fastResults。 |
| 第一版不隱含Dictation fallback | 其模型、熱詞及準確度契約不同；舊SF API也有不同授權／線上邊界。 |
| 共用輸出與utilities | 需跨多個模組接入，但可避免雙重貼上、不同模式漏字典，及Apple模式仍留住Sherpa。 |

## Risks / Trade-offs

- **長串流遺漏／重複** → 以range與watermark reducer涵蓋未重發final、多次partial、重疊range、長停頓、停止尾句與取消晚到結果；不得把原型當產品實作。
- **斷句與出字速度互相牽動** → Accurate／responsive由使用者明選，獨立量測，不能偷偷縮上下文來通過延遲驗收。
- **資產目錄或精確locale暫時不可查** → unknown／checking與unsupported分開，顯示原因與重試，不換區域／引擎。
- **系統共享模型記憶體不可完全歸屬** → 同時記錄helper、speech服務與原Sherpa退出證據；另外標記root／driver／功耗讀不到的範圍，不用單一PID低記憶體宣稱全機成本。
- **多視窗與舊輪詢喚醒另一模型** → main協調器是唯一啟動入口；設定、歷史、符號與工具場景列入lifecycle regression。
- **舊文字功能抽離改壞契約** → 先固定text／emoji／command／TTS fixtures，再抽離；Apple路徑只略過Sherpa標點及ASR專屬步驟。
- **macOS26/27與簽章差異** → 26編譯/API審核＋26實機（或受控實機驗證）及27目前主機；沒有26驗收不能宣稱26runtime完成。

## Migration Plan

1. 完成官方研究與封裝／格式／reducer gates，固定產品設定與驗收語料；所有本提案實作任務先維持未完成。
2. 建立協調器與Sherpa adapter，既有預設先通過回歸；再接Apple helper與共用utilities／輸出。
3. 以隔離userData做設定、字典、歷史、取消、下載、忙碌切換與回歸；不在真實DB上跑fixture或migration。
4. 在授權的實機安裝環境比較兩引擎並回讀結果。若需替換本機安裝，遵守唯一 `/Applications/SpeakSlow.app`，不產生舊app備份；本規劃不執行此步。
5. 上線預設仍Sherpa。回退可由使用者明確切回Sherpa或另行授權回退應用版本；既有模型／資料與v1指標保留。未驗收不標完成、不以新package版本號冒充runtime驗收。

## Open Questions

以下是實作前需解除的gate，不阻擋本次規劃交付，也不代表已通過：

- **G1 封裝與TCC**：正式helper/host identity、麥克風授權歸屬、host既有輸入裝置及背景錄音；不由CLI檔案測試推論。
- **G2 macOS26音訊**：不使用27新converter/provider的最佳格式轉換、尾塊flush、時間軸與錯誤處理。
- **G3 結果完整性**：官方watermark語意的fixture＋長語音實測、native ranges可否滿足SRT與無聲／雜音行為。
- **G4 品質與效能**：至少30組含20–60秒長句、猶豫停頓、問句／列點、數字／中英混合的配對資料；另人工評估可接受的標點邊界。第一段出字、停止到貼上、CPU與footprint分開報告；不宣稱iPhone同等，除非另取得公平真機對照。
- **G5 Native詞彙**：若未來加入Dictation，須獨立驗證zh-TW contextual hints／custom LM建立、載入與提升幅度；第一版新版引擎沒有這項承諾。
- **G6 資源與切換**：切換20次、跨視窗status/emoji/utility/歷史/檔案/操作模式與重啟，都不得意外重新載入非所選ASR或留下listener／child；系統cache保留另列。

驗收條件先要求資料完整、一次輸出、無隱含fallback、引擎確實可切回，以及相同配對fixture下Apple的可歸屬CPU與footprint低於Sherpa。以至少30個有效配對比較停止到貼上P95，暫定回歸預算為 `max(50ms, Sherpa P95 × 10%)`；這是本版本待驗收的工程門檻，不是已測結果或iPhone速度承諾。既有2.1指標本身的instrumentation門檻保持原要求，不用此預算替代。

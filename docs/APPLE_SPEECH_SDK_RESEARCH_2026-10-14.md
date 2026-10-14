# Apple 語音 SDK 實作前研究

研究日期：2026-10-14（Asia/Taipei）。用途：規劃 SpeakSlow 的可切換 Apple 辨識引擎；本文件沒有實作或啟用產品功能。

本文以 Apple Developer Documentation、Apple 官方 WWDC、Apple 官方範例程式，以及本機 Xcode 所附 SDK 為證據。公開 API 存在、官方明確支援、單機觀察及仍需實測的結論分開列出。Apple 開發文件的最新版本會混入 macOS 27 API；不能把整頁範例當成 macOS 26 可直接使用的程式。

## 1. 對這個版本的結論

- Apple 路徑適合用 `SpeechAnalyzer` 搭配 `SpeechTranscriber`，與現有 Sherpa 保留為使用者明確選擇的兩條路徑。新 API 的 macOS 起始版本為 26；實際可用性仍須詢問裝置及 locale，不宜只看 OS 版號或晶片名稱。[SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer)、[isAvailable](https://developer.apple.com/documentation/speech/speechtranscriber/isavailable)
- `SpeechTranscriber` 提供 volatile 結果與速度／上下文取捨。`.fastResults` 明確犧牲部分準確度來降低延遲。即時預覽與快速辨識是兩個不同設定。[volatileResults](https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/volatileresults)、[fastResults](https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/fastresults)
- 原生詞彙提示與自訂語言模型的明確文件支援落在 `DictationTranscriber`。查到 `AnalysisContext` 共用型別，不代表 `SpeechTranscriber` 會使用其中的詞彙提示。[contextualStrings](https://developer.apple.com/documentation/speech/analysiscontext/contextualstrings)、[DictationTranscriber](https://developer.apple.com/documentation/speech/dictationtranscriber)
- Apple 引擎應保留原生結果與標點，再由使用者可理解的字典規則處理定稿。斷句、斷行、段落，以及送進其他程式的時機，都仍是產品契約與驗收項目；不能由「使用 Apple SDK」推導成「和 iPhone 相同」。
- 引擎切換的資源收益取決於完整生命週期：Apple 模式若仍由其他功能喚醒 Sherpa，就不能把單獨 Apple helper 的低用量視為整個 SpeakSlow 的用量。這是工程推論，須以封裝應用實測驗收。

## 2. API 與模型的差異

| API／模組 | 官方定位與行為 | 對 SpeakSlow 的意義 |
| --- | --- | --- |
| `SpeechAnalyzer` | macOS 26 起的 session 管理 actor，接收音訊、管理 modules，使用非同步輸入與結果串流。它本身不是一個辨識模型。 | 管理 session、準備、定稿、取消與清理。 |
| `SpeechTranscriber` | 一般對話與通用轉寫的新模型；官方 WWDC 說明其支援長篇、遠距及即時使用情境，模型在裝置端執行。 | Apple 選項的首選模組；須驗證繁體中文的實際品質。 |
| `DictationTranscriber` | 使用系統聽寫及舊 `SFSpeechRecognizer` 裝置端模式同系列模型；相容較舊裝置。不能使用僅能由 `SFSpeechRecognizer` 雲端提供的語言。 | 若之後需要原生詞彙提示或自訂 LM，可做另一個明確評估的設定；不能無提示代換。 |
| `SFSpeechRecognizer` | 舊版 request／task／delegate API，視 locale 與裝置可能使用伺服器；可檢查 `supportsOnDeviceRecognition`，request 可設定 `requiresOnDeviceRecognition`。 | 不需要為第一版新引擎加上第三套自動降級鏈；舊系統繼續提供現有 Sherpa。 |

來源：[SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer)、[SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)、[DictationTranscriber](https://developer.apple.com/documentation/speech/dictationtranscriber)、[SFSpeechRecognizer](https://developer.apple.com/documentation/speech/sfspeechrecognizer)、[requiresOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)、[WWDC25 session 277](https://developer.apple.com/videos/play/wwdc2025/277/)。

Apple 在 WWDC25 將新模型對應至 Notes、Voice Memos 等功能。這不是「所有 iPhone 鍵盤聽寫、所有版本與語言，都使用同一模型及前後處理」的保證。`DictationTranscriber` 的文件雖明確提到系統聽寫模型，仍沒有保證第三方 app 的端到端體驗等於 iPhone。

舊 `SFSpeechRecognizer` 文件仍提醒網路服務節流與每次音訊約一分鐘限制。這是舊 API 的文件限制，不能直接泛化為 `SpeechAnalyzer` 同樣有一分鐘限制，也不能由本機數段短句成功宣稱新 API 無限長錄音一定可行。[舊 API 的限制說明](https://developer.apple.com/documentation/speech/sfspeechrecognizer)

目前檢查的公開 Speech API 沒有 Core ML `computeUnits`、指定 ANE 核心數或保證全部計算在 ANE 執行的控制。硬體排程由系統處理。先前本機 ANE 追蹤只能證明該次工作有 ANE 活動；不能泛化為每台裝置、每個 module、每次工作一定如此。[SpeechTranscriber 公開介面](https://developer.apple.com/documentation/speech/speechtranscriber)、[SpeechAnalyzer.Options](https://developer.apple.com/documentation/speech/speechanalyzer/options)

## 3. OS、硬體與繁體中文的 capability gate

### 3.1 每次使用前需分開確認的狀態

1. OS／連結條件：helper 對 macOS 26 API 做 availability guard，舊系統不可嘗試載入此路徑。
2. 裝置能力：查 `SpeechTranscriber.isAvailable`。官方定義依裝置硬體與能力判斷；不以「有 Apple Silicon」取代此查詢。
3. 語言支援：查 `supportedLocales`，其中包含可下載但尚未安裝的語言。裝置不支援時此陣列為空。
4. 語言安裝：查 `installedLocales`；這與支援清單不同。
5. 實際 module 組態資產：用 `AssetInventory.status(forModules:)` 與 installation request 確認。
6. 輸入格式、prepare 與 session 啟動成功後，才進入產品的 ready 狀態。

來源：[isAvailable](https://developer.apple.com/documentation/speech/speechtranscriber/isavailable)、[supportedLocales](https://developer.apple.com/documentation/speech/speechtranscriber/supportedlocales)、[installedLocales](https://developer.apple.com/documentation/speech/speechtranscriber/installedlocales)、[AssetInventory](https://developer.apple.com/documentation/speech/assetinventory)。

`supportedLocale(equivalentTo:)` 會在沒有完全相同 locale 時，回傳相同語言、不同地區的近似值，還可能優先選已安裝地區。官方也提醒這會改變拼字等結果。對台灣繁中，應保存實際選定 locale，檢查其語言／地區／必要 script 語意，不能把 `zh-CN` 等區域靜默當成 `zh-TW`。底線與連字號等 identifier 表示方式要先正規化；這不是自動接受其他中文地區的理由。[supportedLocale(equivalentTo:)](https://developer.apple.com/documentation/speech/speechtranscriber/supportedlocale(equivalentto:))

### 3.2 本機已存在的證據與界線

本機既有 benchmark 的 environment 記錄 macOS 27.0.1／arm64。`apple-smoke.jsonl` 的 capability 記錄 `SpeechTranscriber` 可用，已安裝 `zh_TW`；`dictation-smoke.jsonl` 也記錄 Dictation 已安裝 `zh_TW`。兩個路徑已產生中文結果。這是這台機器、該次環境的證據，不能當成 macOS 26、Intel Mac 或其他語言設定的支援矩陣。

來源：[environment.json](/Users/chunghan/AI/SpeakSlow/out/asr-benchmark-2026-10-14/environment.json)、[Apple smoke 結果](/Users/chunghan/AI/SpeakSlow/out/asr-benchmark-2026-10-14/apple-smoke.jsonl)、[Dictation smoke 結果](/Users/chunghan/AI/SpeakSlow/out/asr-benchmark-2026-10-14/dictation-smoke.jsonl)。

本次查核 `xcrun --show-sdk-version` 為 `27.0`，`sw_vers -productVersion` 為 `27.0.1`。因此本機成功不代表 macOS 26 已通過 runtime 驗證。SDK interface 的可用性標記只確認 API 宣告的起始版本。

## 4. 模型資產：下載、reservation 與清理

### 4.1 三類狀態不能混用

| 概念 | 意義 | 不能推導的結論 |
| --- | --- | --- |
| supported | 裝置與 module 組態有可用／可下載的資產。 | 不表示已下載或可立即錄音。 |
| installed | 所需資產已在系統。 | 不表示目前 app 已完成 prepare，或記憶體已載入。 |
| reserved | app 保留某 locale 資產的使用名額。 | 不表示已安裝，不表示 app 獨占，也不是記憶體常駐開關。 |

`AssetInventory.Status` 有 `.unsupported`、`.supported`、`.downloading`、`.installed`。`maximumReservedLocales` 應於 runtime 讀取；官方說數量可能隨裝置儲存空間變動，不應硬編碼。`reserve(locale:)` 已保留時回傳 `false`，這不是失敗；`release(reservedLocale:)` 未保留時也回傳 `false`。[Status](https://developer.apple.com/documentation/speech/assetinventory/status)、[maximumReservedLocales](https://developer.apple.com/documentation/speech/assetinventory/maximumreservedlocales)、[reserve](https://developer.apple.com/documentation/speech/assetinventory/reserve(locale:))、[release](https://developer.apple.com/documentation/speech/assetinventory/release(reservedlocale:))

### 4.2 建議的下載程序

先建立正確 locale／選項的 module，再取得 `AssetInventory.assetInstallationRequest(supporting:)`。若回傳 request，保存其 `progress` 供 UI 觀察，再 await `downloadAndInstall()`。若所需資產原已存在，可能不需要 request。完成或錯誤後都重查 module 的實際狀態，不能僅依進度條顯示 ready。[assetInstallationRequest](https://developer.apple.com/documentation/speech/assetinventory/assetinstallationrequest(supporting:))、[AssetInstallationRequest](https://developer.apple.com/documentation/speech/assetinstallationrequest)

下載由系統合併管理，可跨 app 共享，重複 request 不造成重複下載。官方另說：首次嘗試因網路等原因失敗時，系統可能之後自動重試；`downloadAndInstall()` 返回只代表最初這次嘗試成功或失敗。UI 的錯誤、重試、取消及返回設定頁，需要和系統背景狀態分開表示。[downloadAndInstall](https://developer.apple.com/documentation/speech/assetinstallationrequest/downloadandinstall())

### 4.3 取消下載的公開契約仍有限

- 已查官方 sample：它保存 `downloadProgress` 並 await `downloadAndInstall()`；沒有實作下載取消，也沒有可引用的「取消成功」範例。
- 本機 SDK 的 `AssetInstallationRequest` 公開方法是 `downloadAndInstall()`，另提供 `ProgressReporting.progress`；沒有 `cancelDownload()` 等專用 API。
- `Task.cancel()` 只能發出 task 的合作式取消意圖。已查的 Speech 下載文件沒有明確承諾此操作停止共享的系統下載。
- Foundation 的 `Progress.cancel()` 會設 `isCancelled` 並呼叫存在的 cancellation handler；`isCancellable` 本身不會實作實際取消。因此即使 progress 顯示 cancellable，也不能由此保證 Apple 的背景下載停止或移除已下載檔案。[Progress.cancel](https://developer.apple.com/documentation/foundation/progress/cancel())、[isCancellable](https://developer.apple.com/documentation/foundation/progress/iscancellable)

工程規劃：可取消 app 的等待與本次啟用操作；下載本身是否停止應以系統狀態／網路實測確認。未確認前，介面使用「取消啟用」或「停止等待」等可兌現語意，不能宣稱已終止或刪除系統資產。

### 4.4 release reservation 不等於刪除模型

`release(reservedLocale:)` 是解除這個 app 對該 locale 的 reservation／subscription。Apple 說系統在之後才移除資產；資產本身跨 app 共享，不能承諾解除後立刻回收磁碟。不要在每次短句停止時 release locale，也不要把「切回 Sherpa」標成「已刪除 Apple 模型」。[AssetInventory 管理語意](https://developer.apple.com/documentation/speech/assetinventory)、[release](https://developer.apple.com/documentation/speech/assetinventory/release(reservedlocale:))

## 5. 輸入格式：macOS 26 與 27 要分開

### macOS 26 基線

向已建立 modules 查 `SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith:)`，或查 module 的 `availableCompatibleAudioFormats`。不要假設目前 Sherpa 的 16 kHz／mono／sample type 就是 Apple 要的格式。裝置的自然格式、取樣率、通道數與 interleaving 都需正確處理。[bestAvailableAudioFormat](https://developer.apple.com/documentation/speech/speechanalyzer/bestavailableaudioformat(compatiblewith:))、[SpeechModule.availableCompatibleAudioFormats](https://developer.apple.com/documentation/speech/speechmodule/availablecompatibleaudioformats)

macOS 26 可將 `AVAudioPCMBuffer` 經 `AVAudioConverter` 轉成支援格式，再包成 `AnalyzerInput(buffer:)` 或 `AnalyzerInput(buffer:bufferStartTime:)`，送入自行管理的 `AsyncStream<AnalyzerInput>`。官方 WWDC25 sample 的 `BufferConversion.swift` 就示範此路徑；sample 也顯示轉換器 prime method 會涉及首段音訊品質與時間戳取捨，不能不加評估地當成所有裝置的最佳設定。[AnalyzerInput](https://developer.apple.com/documentation/speech/analyzerinput)、[AVAudioConverter](https://developer.apple.com/documentation/avfaudio/avaudioconverter)、[官方 sample](https://developer.apple.com/documentation/speech/bringing-advanced-speech-to-text-capabilities-to-your-app)

工程要求：保存連續時間軸，資料未消費前不得重用／覆寫 buffer；裝置或格式變更時重建 converter；正確結束 converter 的輸入並排空尾端；限制輸入 queue，超出容量要回報可觀察的錯誤。這些是串流正確性要求，不是 SDK 自動替 Electron 完成的工作。

### macOS 27 API

本機 SDK 的以下型別／欄位標記起始版本為 27，官方部分頁面目前仍標 Beta：

| API | 功能 | macOS 26 替代路徑 |
| --- | --- | --- |
| `AnalyzerInputConverter` | 轉換 buffer，回傳 `[AnalyzerInput]`，最後可 `flush()`。 | 自行用 `AVAudioConverter` 與 `AnalyzerInput`。 |
| `AssetInputSequenceProvider` | 從 AVAsset／音軌等建立支援格式的輸入 sequence。 | `AVAudioFile`／自行解碼轉換與 sequence。 |
| `CaptureInputSequenceProvider` | 從 capture session／裝置建立輸入 sequence。 | 現有麥克風輸入配合 PCM 轉換。 |
| `AnalyzerInput` 新增 sample-buffer initializer、`bufferFormat`、`bufferDuration` | 擴充輸入表示；舊 `buffer` 存取在 27 標 deprecated。 | 使用 26 的 PCM buffer initializer 與自己的格式／時間資訊。 |
| `SpeechAnalyzer.Options.ignoresResourceLimits` | 允許超出系統保守的同時分析數量限制。 | 不啟用多重分析；處理 `insufficientResources`。 |

來源：[AnalyzerInputConverter](https://developer.apple.com/documentation/speech/analyzerinputconverter)、[AssetInputSequenceProvider](https://developer.apple.com/documentation/speech/assetinputsequenceprovider)、[CaptureInputSequenceProvider](https://developer.apple.com/documentation/speech/captureinputsequenceprovider)、[AnalyzerInput](https://developer.apple.com/documentation/speech/analyzerinput)、[ignoresResourceLimits](https://developer.apple.com/documentation/speech/speechanalyzer/options/ignoresresourcelimits)。

最新 `SpeechAnalyzer` 文件的總覽程式已用 `AnalyzerInputConverter`。複製該範例前必須逐一核對 availability。第一版若以 macOS 26 為基線，不應因開發機使用 SDK 27 就無意提高需求。

## 6. 結果串流與定稿：不能只接字串

modules 的 `results` 是 throwing `AsyncSequence`。`SpeechTranscriber.Result` 表示一段 phrase／passage，包含 attributed text、audio `range`、`resultsFinalizationTime`，可要求逐字時間屬性。volatile 結果可能反覆修正同一段音訊，必須替換對應範圍；全部 append 會重複字句。[SpeechTranscriber.Result](https://developer.apple.com/documentation/speech/speechtranscriber/result)、[volatileResults](https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/volatileresults)

### 6.1 `isFinal` 的重要例外

官方明說：`isFinal == false` 的結果，未來可能重發，也可能不重發；不保證一定再送一次 `isFinal == true`。因此「只 append final、其餘一律暫存」在長串流中可能遺失文字。[isFinal](https://developer.apple.com/documentation/speech/speechmoduleresult/isfinal)

`resultsFinalizationTime` 是這個 module 已定稿到哪個音訊時間的 watermark：小於此時間的先前結果不會再修改。`isFinal` 等價於 `resultsFinalizationTime >= range.end`。`analyzer.volatileRange` 則合併所有 modules 的尚可變動範圍，並可透過 handler 觀察邊界移動。[resultsFinalizationTime](https://developer.apple.com/documentation/speech/speechmoduleresult/resultsfinalizationtime)、[volatileRange](https://developer.apple.com/documentation/speech/speechanalyzer/volatilerange)

以下是用來驗收 reducer 的合成例子，不是聲稱 SDK 一定逐項如此切段：

| 事件 | range | text | finalization watermark | 解讀 |
| --- | --- | --- | --- | --- |
| A | `[0, 1)` | 明天開會， | 0 | A 暫時可變。 |
| B | `[1, 2)` | 下午三點。 | 1 | A 現在已定稿，即使沒再收到 A 的 `isFinal=true`；B 仍可變。 |
| 邊界更新／停止定稿 | 至 2 | 既有兩段 | 2 | 兩段均須保留且各出現一次。 |

實作需保存音訊 range、替換相應的 volatile 內容，追蹤定稿 watermark／volatile range。IPC 必須攜帶 session identity、時間範圍與定稿狀態，不能只發 `text` 和 boolean。遲到的舊 session 事件不得覆寫新錄音。短句 benchmark 使用的簡化 result accumulator，不能當成長串流完整性已通過。

新版官方 `Recognizing speech in live audio` sample 的 `Transcription.swift` 也採用結果 audio range 重疊時 replace、無重疊時 append。它可作 reducer 的參考；其 UI 顏色仍按事件的 `isFinal` 設定，不能取代 SpeakSlow 對 watermark／長串流的驗收。[新版官方 sample](https://developer.apple.com/documentation/speech/recognizing-speech-in-live-audio)

### 6.2 停止與取消是不同操作

正常停止：先停止產生新音訊，排空需保留的轉換尾端，結束 input continuation，再 await `finalizeAndFinishThroughEndOfInput()`，並讀完結果。只呼叫 `AsyncStream.Continuation.finish()` 通常不會結束 analyzer session；反過來若未結束 sequence 就等待 finalization，可能持續等待。[finalizeAndFinishThroughEndOfInput](https://developer.apple.com/documentation/speech/speechanalyzer/finalizeandfinishthroughendofinput())

取消：`cancelAndFinishNow()` 取消 pending work 並立即完成 session，不能把它當成取得所有剩餘定稿的方法。釋放 analyzer 不強制要求先呼叫此方法，但顯式 session 管理較容易驗證取消、切換、helper 結束與 UI 狀態。[cancelAndFinishNow](https://developer.apple.com/documentation/speech/speechanalyzer/cancelandfinishnow())

## 7. 延遲、標點與段落

### 7.1 先明確選擇上下文／延遲取捨

| 設定 | 官方定義 | 建議界線 |
| --- | --- | --- |
| `SpeechTranscriber` + `.volatileResults` | 在 final 外提供可修訂結果。 | 可保留完整上下文，同時顯示初稿；不保證每一短句立刻出字。 |
| 再加入 `.fastResults` | 縮小 context window，較快但較不準。 | 可作明確的「即時回饋」選項，需重新量測 CER／標點。 |
| `DictationTranscriber` + `.frequentFinalization` | 較頻繁定稿，反應較快，定稿準確度較低。 | 這是 Dictation 的另一個取捨，不是 SpeechTranscriber 同名開關。 |

來源：[fastResults](https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/fastresults)、[frequentFinalization](https://developer.apple.com/documentation/speech/dictationtranscriber/reportingoption/frequentfinalization)。

**preset 陷阱：**目前官方 `progressiveTranscription` 與 `timeIndexedProgressiveTranscription` 同時打開 `.volatileResults` 及 `.fastResults`。若需求只是提供預覽，應使用明確 options initializer；不能因選用 progressive preset 就無提示改變模型上下文。WWDC25 影片中曾出現不同 preset 名稱，使用時以部署目標 SDK 與目前文件為準。[Preset 配置表](https://developer.apple.com/documentation/speech/speechtranscriber/preset)

### 7.2 原生標點與自動分段的支援範圍

`DictationTranscriber.TranscriptionOption.punctuation` 明確控制自動標點；省略時僅轉寫使用者說出的標點指令。[punctuation](https://developer.apple.com/documentation/speech/dictationtranscriber/transcriptionoption/punctuation)

目前 `SpeechTranscriber.TranscriptionOption` 沒有對等的 punctuation 開關；本機既有結果中可觀察到標點。但 Apple 沒有在已查公開文件保證「台灣中文標點達到 iPhone 聽寫品質」，也沒有把 phrase result 的時間範圍定義成使用者想要的每個句子或段落。[TranscriptionOption](https://developer.apple.com/documentation/speech/speechtranscriber/transcriptionoption)、[Result](https://developer.apple.com/documentation/speech/speechtranscriber/result)

官方 sample 的 `StoryModel.swift` 自行檢查英文句點並加入換行；這是 app 的顯示邏輯，不是 native engine 回傳完整段落的保證。其 Foundation Models 功能用來建議標題，不能當成 Speech SDK 自動整理段落或改善中文標點的證據。[官方 sample 與下載](https://developer.apple.com/documentation/speech/bringing-advanced-speech-to-text-capabilities-to-your-app)

工程方向：Apple 路徑先保留原始標點及完整上下文，不再用短暫停頓硬切 analyzer，也不疊加既有句尾硬規則／標點模型。若要額外斷行或段落整理，必須另訂規則並驗收；不能從原生標點直接推導段落品質。

## 8. 關鍵字、字典與自訂語言模型

| 功能 | `SpeechTranscriber` | `DictationTranscriber` | `SFSpeechRecognizer` |
| --- | --- | --- | --- |
| 原生 contextual strings 提示 | 已查文件未明確保證此 module 使用；產品支援標為 `unclear`。 | 官方明確支援 `AnalysisContext.contextualStrings`。 | 官方有 request 的 `contextualStrings`。 |
| 原生自訂 LM | 未查到對等 public configuration／content hint。 | 官方有 `ContentHint.customizedLanguage(modelConfiguration:)`。 | 官方有 `customizedLanguageModel`；customization 需 on-device request。 |
| 定稿後字典替換 | app 層可實作。 | app 層可實作。 | app 層可實作。 |

來源：[AnalysisContext.contextualStrings](https://developer.apple.com/documentation/speech/analysiscontext/contextualstrings)、[DictationTranscriber 的準確度設定](https://developer.apple.com/documentation/speech/dictationtranscriber)、[customizedLanguage](https://developer.apple.com/documentation/speech/dictationtranscriber/contenthint/customizedlanguage(modelconfiguration:))、[舊 contextualStrings](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/contextualstrings)、[WWDC23 自訂裝置端辨識](https://developer.apple.com/videos/play/wwdc2023/10101/)。

對 Dictation contextual strings，官方建議每項保持短小、盡量一至兩個詞，可一口氣說完；所有 tags 合計最多 100 項。這是提高候選機率，不能保證正確拼字、發音或每次命中。不認識的特殊詞，其發音仍可能估錯。tags 可用來分組替換，`.general` 是系統提供的 tag。[contextualStrings](https://developer.apple.com/documentation/speech/analysiscontext/contextualstrings)

自訂 LM 的基本路徑是 `SFCustomLanguageModelData` 建立指定 locale 的 phrases／weights／必要的 custom pronunciations，export 資料，再用 `SFSpeechLanguageModel.prepareCustomLanguageModel` 產生 configuration。建置成本與快取失效須另外處理，不能每次開始錄音才同步重建。[SFCustomLanguageModelData](https://developer.apple.com/documentation/speech/sfcustomlanguagemodeldata)、[SFSpeechLanguageModel](https://developer.apple.com/documentation/speech/sfspeechlanguagemodel)

Custom pronunciation 使用 locale 對應的 X-SAMPA 子集。已在模型字典裡的詞新增可能被忽略；不支援的發音符號也會被忽略。這種 SDK 行為不能被 UI 誤報為「詞彙已成功改善辨識」。[CustomPronunciation](https://developer.apple.com/documentation/speech/sfcustomlanguagemodeldata/custompronunciation)、[supportedPhonemes](https://developer.apple.com/documentation/speech/sfcustomlanguagemodeldata/supportedphonemes(locale:))

### 8.1 `zh_TW` 的確切已知與未知

- **已觀察**：既有 benchmark 在本機以 `zh_TW` 執行 SpeechTranscriber／DictationTranscriber，並產生中文輸出。
- **本次唯讀觀察**：在 macOS 27.0.1／SDK 27.0，呼叫 `SFCustomLanguageModelData.supportedPhonemes(locale:)`，`zh_TW` 回傳 708 個項目；對照 `zh_CN` 2311、`en_US` 79。這只表示此 API 有回傳音素集合，沒有建立或訓練模型，也未改動使用者詞彙。
- **文件明確**：custom LM 資料綁定單一 locale；可以提供 phrase counts 與 custom pronunciations，`DictationTranscriber` 有掛載 configuration 的入口。
- **仍需實測／`unclear`**：`zh_TW` 完整 export → prepare → Dictation 掛載 → 詞彙命中及錯誤率改善；中英混用、特殊品牌發音、macOS 26 上的相同行為。查到的公開文件沒有足以承諾這些結果的固定 locale 支援矩陣。

因此第一版 Apple `SpeechTranscriber` 選項可沿用**定稿後字典**；不得把前端詞彙清單標成已原生送入該模型。Dictation 原生提示與 `zh_TW` 自訂 LM 應列為獨立後續 gate。

新版官方 `Recognizing speech in live audio` sample 確實串接 Dictation 與自訂 LM，但其 `datagenerator/main.swift` 明確使用 `en-US`，範例資料為英文西洋棋詞彙。它證明的是 API 串接方式，不是台灣中文的 LM／發音結果。此 sample 另使用 OS 27 才有的 capture provider，不能原封不動當成 OS 26 基線。[官方 sample](https://developer.apple.com/documentation/speech/recognizing-speech-in-live-audio)

## 9. 權限、隱私、sandbox 與簽署

### 9.1 Speech 權限與麥克風權限不同

Apple 最新的「Asking Permission to Use Speech Recognition」明確限定其 Speech 授權流程適用於 `SFSpeechRecognizer`；文中另外說 `SpeechAnalyzer` transcriber modules 不把語音送到 Apple 伺服器。不能把該頁後續關於 `requestAuthorization` 與 `NSSpeechRecognitionUsageDescription` 的舊 API 要求，直接套到所有 Analyzer 路徑。[官方權限說明](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition)

錄製麥克風仍需相應 TCC 授權與 `NSMicrophoneUsageDescription`。若使用 Hardened Runtime／App Sandbox，需依實際錄音程序配置 audio-input 等正確資源存取能力。官方 sample 設有 microphone usage string、App Sandbox 與 audio-input resource access，沒有呼叫 `SFSpeechRecognizer.requestAuthorization`。[麥克風授權](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)、[NSMicrophoneUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)、[Audio Input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input)、[官方 sample](https://developer.apple.com/documentation/speech/bringing-advanced-speech-to-text-capabilities-to-your-app)

若第一版由 Electron 既有錄音路徑擷取 PCM，再交 Swift helper，helper 不需要自行開第二個麥克風 capture session。這是建議架構；TCC 歸屬、bundle identity、授權拒絕及更新後的行為仍須用簽署安裝版本驗證。不能以 Terminal 執行成功推導 packaged app 權限已成立。

本次沒有找到 Apple 文件要求 SpeechAnalyzer 另加特定的受限制 speech entitlement。因此不要從第三方範例臆測或加入未驗證 entitlement。若保留／另加 `SFSpeechRecognizer` 路徑，再獨立核對其 usage string、授權及 sandbox 要求。

### 9.2 「本機辨識」的適用範圍

SpeechAnalyzer 的轉寫語音不傳到 Apple 伺服器；資產首次下載與系統更新仍需要網路。這不能推導 SpeakSlow 的全部流程離線：若使用者另啟用現有雲端 AI 潤稿，文字的外送行為必須照該功能說明。不可因選了 Apple 引擎就顯示無條件的「所有資料永不離開裝置」。[權限與本機處理](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition)、[AssetInventory](https://developer.apple.com/documentation/speech/assetinventory)

### 9.3 發行封裝

Swift helper 是分發的 executable，需包含在簽署／notarization 範圍。Apple 對站外公證分發要求 Developer ID、Hardened Runtime、有效 executable signatures 等；Apple Development 本機可啟動不能取代發行驗證。[Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

App Sandbox 與 Hardened Runtime 是不同能力。helper 的檔案／IPC／錄音權限要依實際封裝檢查；新增 Apple 引擎不是全面重做 sandbox 或擴大既有權限的理由。[App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)、[Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)

## 10. 準備、記憶體 retention 與錯誤

`prepareToAnalyze(in:)` 提前執行通常會在第一批音訊才進行的設定，以降低首次結果延遲。這是 preheat，不是下載完成的替代條件。可提供預計 audio format；若實際格式不同，analyzer 會重新設定。帶 progress handler 的 overload 回報的是準備進度，應和資產下載進度分開。[prepareToAnalyze](https://developer.apple.com/documentation/speech/speechanalyzer/preparetoanalyze(in:))、[準備進度](https://developer.apple.com/documentation/speech/speechanalyzer/preparetoanalyze(in:withprogressreadyhandler:))

| retention | 官方語意 | 產品取捨 |
| --- | --- | --- |
| `.whileInUse` | analyzer deallocate 時釋放 models。 | 可作資源保守基線，但每次冷啟動要量測。 |
| `.lingering` | 暫留一段時間供相容 session 重用。 | 可改善連續輸入，但官方沒有保證固定秒數。 |
| `.processLifetime` | 保留到 process 結束。 | 與降低閒置佔用的目標可能衝突，不能默認採用。 |

來源：[ModelRetention](https://developer.apple.com/documentation/speech/speechanalyzer/options/modelretention-swift.enum)、[whileInUse](https://developer.apple.com/documentation/speech/speechanalyzer/options/modelretention-swift.enum/whileinuse)、[lingering](https://developer.apple.com/documentation/speech/speechanalyzer/options/modelretention-swift.enum/lingering)、[processLifetime](https://developer.apple.com/documentation/speech/speechanalyzer/options/modelretention-swift.enum/processlifetime)。

`SpeechModels.endRetention()` 會等 cached recognizer instances 持有的 models 釋放完再返回。它和 `AssetInventory.release` 是記憶體快取／磁碟 reservation 兩個不同層級。切換引擎時先結束 active sessions、斷開 references，再處理可釋放的 retention；不要宣稱會卸掉其他 app 正在使用的所有共享系統模型。[endRetention](https://developer.apple.com/documentation/speech/speechmodels/endretention())

官方說模型可在 app 行程外執行。這代表不能只量 helper RSS，也不能說模型不使用系統記憶體。產品驗收應觀察 Electron、helper、Sherpa 以及相關服務的 physical footprint，並說明系統共享服務的歸屬限制。[WWDC25 的模型管理說明](https://developer.apple.com/videos/play/wwdc2025/277/)

錯誤需要保留類型及原因，包括 unsupported locale、缺資產、reservation 超限、incompatible／unexpected audio format、`audioDisordered`、module output failure、`insufficientResources`、取消與 helper exit。analyzer 或 results stream throw 後，session 會結束，其他 waiting methods／streams 也可能收到同一錯誤或 `CancellationError`。應終止本次輸入，保留需要呈現的失敗狀態；若要重試建立新 session。[SpeechAnalyzer 錯誤生命週期](https://developer.apple.com/documentation/speech/speechanalyzer)、[insufficientResources](https://developer.apple.com/documentation/speech/sfspeecherror/code/insufficientresources)

系統會限制同時分析數量。macOS 27 的 `ignoresResourceLimits` 不是取得更多 ANE 核心的設定，且官方警告超出真實容量時失敗可能不可預測。SpeakSlow 第一版單一錄音 session 不應啟用此覆寫。[ignoresResourceLimits](https://developer.apple.com/documentation/speech/speechanalyzer/options/ignoresresourcelimits)

## 11. Electron 與 Swift helper 的適用性

工程推論：保留 Electron 介面與現有麥克風擷取，在獨立 Swift helper 封裝原生 SDK，比嘗試讓 renderer 直接載入 Swift async API 更符合目前專案結構，也能讓 helper 不需自行取得麥克風。這是架構選擇，Apple 官方範例沒有提供 Electron 整合保證。

建議 helper 邊界包含 capability、資產安裝與狀態、prepare、start、PCM input、正常 finish、cancel、shutdown。結果事件包含 session ID、audio range、文字、finalization watermark、錯誤；不要讓渲染層直接控制系統資產或 native handle。音訊傳輸格式與 backpressure 應另定明確契約，不把大段原始 PCM 持續轉成無界 JSON queue。

錄音中切換應先完成／取消舊 session，再啟動新引擎。切換失敗必須明確顯示；禁止背景換回另一引擎並繼續假裝使用使用者所選引擎。未選引擎不得被 capability polling、字典／emoji／文字處理、TTS、檔案轉錄、歷史重辨識等路徑間接常駐。這些是專案層設計與驗收，需回到原始碼檢查。

helper 應與 app 一起編譯和簽署，不要求使用者安裝 Xcode。Mac 26 的部署目標與 27 API guard 要在 CI／build script 檢查；Windows／Linux 不應看到可啟用的 Apple 選項。

## 12. 前幾輪 benchmark 的證據界線

既有 50 段台灣中文短句測試比較了辨識內容與短句處理時間，CER 排除標點和空白。它沒有衡量中文標點／斷段準確率、長串流 watermark 完整性、封裝 app 的麥克風與 TCC、日常自由口述、外部程式貼入耗時，或實體 iPhone 的同音訊比較。

資源測試與 ANE trace 可作選型依據，但不是第一版產品已省下相同記憶體的證據；特別需要驗證 Apple 模式下 Sherpa 是否確實停止，以及 UI 和其他功能是否喚醒它。

來源：[辨識 benchmark 報告](/Users/chunghan/AI/SpeakSlow/out/asr-benchmark-2026-10-14/report.txt)、[資源 benchmark 報告](/Users/chunghan/AI/SpeakSlow/out/asr-benchmark-2026-10-14/resources/report.txt)、[硬體追蹤報告](/Users/chunghan/AI/SpeakSlow/out/asr-benchmark-2026-10-14/resources/hardware-report.txt)。

## 13. 實作前與發行前的必要 gate

| Gate | 必須取得的證據 |
| --- | --- |
| G1：macOS 26 基線 | 以 26 deployment target 編譯；在真實 macOS 26 執行 PCM 串流、prepare、finish、cancel。27 專用 API 不可無 guard。 |
| G2：裝置與 locale | 不支援裝置／OS 顯示明確原因；`zh_TW` 精確語意，不能靜默選其他中文地區；目前單機觀察不當通用矩陣。 |
| G3：資產首次使用 | 未安裝、斷網、失敗、重試、app 中途關閉、reservation 超限；進度與 ready 狀態一致；取消啟用不誇大成共享下載已停止。 |
| G4：串流音訊正確性 | 44.1／48 kHz 裝置、mono／stereo、輸入裝置切換、音訊尾端、timestamp 連續性、queue 上限與背壓；無靜默丟音。 |
| G5：文字完整性 | volatile range 重疊替換、watermark 前移但不重發 final、雙 stop、cancel／舊 session 遲到事件、長段落；無重複、無漏字。 |
| G6：中文標點與主觀體驗 | 長自由口述、中英混用、數字、人名、思考停頓；分別量標點、句界、段落、首字延遲、停止到定稿／貼入。先預定人工標註規則。 |
| G7：速度選項 | 完整上下文與 `.fastResults` 分別測量，不以 progressive preset 隱含切換；標示準確度取捨。 |
| G8：字典與熱詞 | 第一版 post-processing 詞組規則可撤回且不破壞合法詞；Dictation contextual strings／`zh_TW` custom LM 另做端到端證據後才宣稱原生支援。 |
| G9：資源生命週期 | 冷／暖啟動、連續錄音、閒置、關窗、切換往返、退出；量 physical footprint、CPU、ANE／GPU 活動；Apple 模式無 Sherpa 常駐或間接喚醒。 |
| G10：封裝與授權 | 在簽署安裝 app 驗證 TCC 首次允許／拒絕、helper identity、更新後重啟、OS26／27、sandbox／Hardened Runtime 與公證；CLI 成功不當代替證據。 |
| G11：無聲降級 | helper crash、資產缺失、unsupported locale、資源不足均可觀察失敗；不自動改用另一引擎。 |
| G12：iPhone 對照 | 若要聲稱接近 iPhone，需相同說話內容、語言設定、收音條件與清楚量測定義；未測前只說改善了哪些可測指標。 |

## 14. 官方來源索引

以下均於 2026-10-14 查閱。HTML 缺完整內文時，使用同網址 `.md` 版本及 Apple DocC JSON。沒有把論壇提問或第三方心得當成產品支援契約。

1. [Speech framework](https://developer.apple.com/documentation/speech)
2. [SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer)
3. [SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)
4. [DictationTranscriber](https://developer.apple.com/documentation/speech/dictationtranscriber)
5. [SFSpeechRecognizer](https://developer.apple.com/documentation/speech/sfspeechrecognizer)
6. [AssetInventory](https://developer.apple.com/documentation/speech/assetinventory)
7. [AssetInstallationRequest](https://developer.apple.com/documentation/speech/assetinstallationrequest)
8. [AnalysisContext.contextualStrings](https://developer.apple.com/documentation/speech/analysiscontext/contextualstrings)
9. [SpeechModuleResult.isFinal](https://developer.apple.com/documentation/speech/speechmoduleresult/isfinal)
10. [resultsFinalizationTime](https://developer.apple.com/documentation/speech/speechmoduleresult/resultsfinalizationtime)
11. [volatileRange](https://developer.apple.com/documentation/speech/speechanalyzer/volatilerange)
12. [SpeechTranscriber.Preset](https://developer.apple.com/documentation/speech/speechtranscriber/preset)
13. [SpeechTranscriber.fastResults](https://developer.apple.com/documentation/speech/speechtranscriber/reportingoption/fastresults)
14. [DictationTranscriber.frequentFinalization](https://developer.apple.com/documentation/speech/dictationtranscriber/reportingoption/frequentfinalization)
15. [SFSpeechLanguageModel](https://developer.apple.com/documentation/speech/sfspeechlanguagemodel)
16. [SFCustomLanguageModelData](https://developer.apple.com/documentation/speech/sfcustomlanguagemodeldata)
17. [supportedPhonemes](https://developer.apple.com/documentation/speech/sfcustomlanguagemodeldata/supportedphonemes(locale:))
18. [Speech permission](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition)
19. [Media capture authorization](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media)
20. [Audio Input entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input)
21. [App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)
22. [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)
23. [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
24. [WWDC25：Bring advanced speech-to-text to your app with SpeechAnalyzer](https://developer.apple.com/videos/play/wwdc2025/277/)
25. [WWDC23：Customize on-device speech recognition](https://developer.apple.com/videos/play/wwdc2023/10101/)
26. [官方完整 sample 專案](https://developer.apple.com/documentation/speech/bringing-advanced-speech-to-text-capabilities-to-your-app)；本次取得的 [Apple 官方 ZIP](https://docs-assets.developer.apple.com/published/e40c20fc5641/BringingAdvancedSpeechToTextCapabilitiesToYourApp.zip)。重點檔案為 `Transcription.swift`、`BufferConversion.swift`、`Recorder.swift`、`StoryModel.swift` 及 Xcode project 的錄音權限設定。範例展示基本串接，不等於錯誤處理、長串流整合或繁中品質已完成驗證。
27. [新版 Recognizing speech in live audio sample](https://developer.apple.com/documentation/speech/recognizing-speech-in-live-audio)；本次取得的 [Apple 官方 ZIP](https://docs-assets.developer.apple.com/published/0c6bad139614/RecognizingSpeechInLiveAudio.zip)。重點為 audio range overlap replacement、Dictation 自訂 LM，以及 OS 27 capture provider；`datagenerator/main.swift` 為 `en-US`，沒有 `zh_TW` 成效證據。sample 的音訊 task 取消不能當作模型下載取消的文件。

本機 SDK 核對來源：[Speech.swiftinterface](/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/System/Library/Frameworks/Speech.framework/Versions/A/Modules/Speech.swiftmodule/arm64e-apple-macos.swiftinterface:11)。本機 Swift 編譯器介面為 Swift 6.4，target `macos27.0`；`AnalyzerInput`、`AssetInventory`、transcriber、model retention 的 26／27 標記已逐項核對。SDK 介面只能證明公開宣告及可用性標記，不能取代不同系統／裝置 runtime 驗證。

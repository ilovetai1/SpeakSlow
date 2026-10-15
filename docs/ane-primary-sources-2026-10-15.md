# SpeakSlow ANE 可行性：官方來源查核

查核日期：2026-10-15。範圍為公開 API、上游原始碼與本機既有證據；本輪沒有執行辨識模型、下載模型或修改產品設定。

## 結論與現況

SpeakSlow 已有使用 ANE 的 Apple 路徑。既有 [2026-10-14 驗收](APPLE_ENGINE_ACCEPTANCE_2026-10-14.md) 與 [原始分析 JSON](../out/apple-engine-product/hardware/analysis.json) 記錄：分開進行的 30 秒 all-process trace 中，Apple 有 438 筆 ANE interval，含 `AneInference`；Sherpa 對照為 0。本輪已回讀 JSON。這支持該次 Apple 工作期間有 ANE 活動；不代表全部計算都在 ANE、SpeakSlow 獨占該活動、每次執行都如此，亦不是使用率或耗電量測。

本輪另直接解析既有 Instruments 匯出的 XML，確認 [Apple 原始資料](../out/apple-engine-product/hardware/apple-ane-hw-intervals.xml) 為 438 個 `row`、[Sherpa 對照](../out/apple-engine-product/hardware/sherpa-ane-hw-intervals.xml) 為 0；不是重新執行辨識或採集 trace。

建議先改善及驗收現有 Apple 路徑，再決定是否投入另一套 ANE 引擎。ANE 的潛在價值在計算時間、CPU 負擔與能源效率；它本身沒有提供台灣中文選詞、標點或斷句品質保證。現有配對驗收仍顯示品質與首次預覽各有取捨，不能以硬體加速代替產品驗收。既有 Apple／Sherpa 的資源差異是整套模型與框架比較，不能歸因為純 ANE 效果。

## 本機專案、設定與對話核對

現行原始碼為 `main`、`0253558`，版本 2.1.0 開發版。SpeakSlow 是 Electron／React 桌面語音輸入工具，流程為錄音 → 所選 ASR → 繁體轉換／字典 → 可選潤稿 → 歷史與貼上。已有情境潤稿、待核准改錯學習與分階段延遲統計；這些功能不等於 ANE 加速。依據：[README](../README.md)、[錄音定稿流程](/Users/chunghan/AI/SpeakSlow/src/hooks/useRecording.js:435)、[潤稿判斷](/Users/chunghan/AI/SpeakSlow/src/hooks/useRecording.js:490)。

兩條 ASR 路徑為 Sherpa ONNX／Paraformer（預設 CPU）及 Swift `SpeechAnalyzer`／`SpeechTranscriber`（固定 `zh-TW`）。程式預設選 Sherpa，但本機使用者儲存的選擇已為 Apple；兩者必須分開描述。2026-10-15 以 SQLite 唯讀連線查 `/Users/chunghan/Library/Application Support/聲聲慢/transcriptions.db`，確認 `asr_engine=apple`、`enable_ai_optimization=false`、`ai_provider=ollama`、`ollama_model=qwen3:1.7b`。未顯式保存 `apple_response_profile`，原始碼預設為 `accurate`。保存設定不證明當下引擎就緒或 ANE 正在運算。依據：[引擎設定讀取](/Users/chunghan/AI/SpeakSlow/src/helpers/speechEngineManager.js:40)、[Apple 模組初始化](/Users/chunghan/AI/SpeakSlow/native/AppleSpeech.swift:99)。

本機硬體另已重查：Apple M5、16 GiB、macOS 27.0.1；已安裝 App 的 Info.plist 版本為 2.1.0。本輪沒有錄音、修改使用者資料庫或更換安裝版。

Codex 已核對以下相關對話的使用者需求與回覆，重要實作結論另回到目前程式與原始測試產物驗證：

|對話|核對內容|
|---|---|
|「分析 iPhone 語音辨識優勢」`01a1397b-ec10-7860-a012-1cb8a940a5de`|由 iPhone 體驗問題，依序進行 Apple SDK／CPU 比較、資源與 ANE 追蹤、可切換引擎實作，以及安裝並選擇 Apple。不能沿用該對話初期「尚未整合 Apple」的舊狀態。|
|「改善 Apple 神經網路選字準確度」`01a13aea-33aa-7670-be10-e4be90e63b9a`|使用者關注「頁面／頁麵」「程式碼／城市碼」。同音訊合成音初測中，Dictation 目標詞命中較多，但完整 CER 未改善且出現漏字；尚未有真人或實體 iPhone 同音源驗收。|
|「介紹 SpeechTranscriber 與 Dictation」`01a13af9-c1cc-7592-8f0b-7f2795574312`|核對兩種模組定位及公開 API；不能把可用 API、系統聽寫模型或 on-device 特性當成 iPhone 體驗驗收。|

另查閱 2.1.0 情境／學習／延遲功能演進的相關 Codex 對話，並回讀目前對應程式。Claude Code 的資料範圍較少：`~/.claude/history.jsonl` 找到 2026-07-23 同一 session 的 5 筆 SpeakSlow 專案使用者輸入，主題是多螢幕錄音指示器、Electron、打包與整併；另有 2026-07-18 初期安裝／安全調查輸入。專案目錄沒有完整 JSONL 對話檔，`~/.claude/transcripts` 也沒有匹配專案絕對路徑或上述 session IDs 的檔案。因此只能確認這些輸入歷史，不能宣稱已讀完整 Claude Code 回覆、工具結果或完整帳號歷史。舊對話中的操作授權亦不視為本輪改動授權。

## 已有產品測試代表什麼

本輪回讀 [app-summary.json](../out/apple-engine-product/app-summary.json) 並核對 CER 算式及驗收報告，採用同一輪真實打包 App 測試，沒有混入較早的單獨 helper 測試數字：

|指標|Sherpa standard|Apple accurate|
|---|---:|---:|
|80 段工作負載中 App＋自有程序＋可讀系統服務的同時 footprint peak|1936.2 MiB|921.5 MiB|
|上述可讀範圍的累計 CPU time|132.10 秒|30.33 秒|
|50 段自然短句繁中字元錯誤率|25／463，5.40%|28／463，6.05%|
|自然短句檔案提交到定稿 P50|77.2 ms|103.1 ms|

這支持 Apple 路徑在該工作負載較省可量測資源；不支持更準、更省電固定比例或停止到貼上更快。受保護共享服務、driver 分配與真正能耗未完整計入，且每配置只跑一個區塊。ANE trace 是另一次採集。也不能把 77.2／103.1 ms 解讀為真人停止說話到目標欄位收到文字。

**工程判斷：** 額外投入的第一順位應是同一段真人音訊的 Speech／Dictation 選詞與預覽比較，並分開量停止到定稿、潤稿及目標接收。既有同音詞問題沒有證據指向 ANE 不足；Dictation 的提示詞／詞彙模型可列入驗證，但尚未整合到產品，也不能假定台灣中文成效。只為啟用 ANE 而重寫 Electron、遷移整套 LLM 或全面替換 Sherpa，目前證據不足。

## 1. Apple Speech：由系統管理，沒有本專案可調的「ANE 加速比例」

Apple 的 WWDC25 說明 `SpeechTranscriber` 是 on-device 模型，由系統管理模型資產，並在 App 自身記憶體空間外運作。本次核對 `SpeechAnalyzer.Options`、`SpeechTranscriber` 公開介面，未見 Core ML `computeUnits`、指定 ANE 核心數或強制整圖 ANE 的設定。`priority`、`modelRetention` 及 `ignoresResourceLimits` 不等於硬體配置開關。**工程判斷：應把排程留給系統，以實測確認行為；不要把 on-device 自動解讀成 ANE。**

來源：[Apple WWDC25 session 277](https://developer.apple.com/videos/play/wwdc2025/277/)、[SpeechAnalyzer.Options](https://developer.apple.com/documentation/speech/speechanalyzer/options)、[SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)。公開介面另以 Apple DocC JSON 回讀確認，避免 JavaScript 頁面漏列 API。

## 2. Core ML：允許 ANE，不保證實際全部使用 ANE

`MLComputeUnits.all` 允許 OS 選擇 CPU、GPU 與可用的 Neural Engine；`.cpuAndNeuralEngine` 允許 CPU 與 ANE，排除 GPU；`.cpuAndGPU` 排除 ANE。這些值描述允許使用的資源，不是要求每個算子都在特定硬體執行。因此成功載入 Core ML 模型，或設定 `.cpuAndNeuralEngine`，仍不足以宣稱整個模型跑在 ANE。

來源：[Apple MLComputeUnits](https://developer.apple.com/documentation/coreml/mlcomputeunits)。

## 3. 驗證方式：看 placement、trace 與產品延遲

Apple 的 Xcode performance report 可列模型 load／prediction／compile 時間與每個算子的 compute unit。`MLComputePlan` 提供支援與偏好的裝置及相對成本估計，**不是實測 prediction 時間或耗電**。報告可開到 Instruments 進一步分析。這些方法適合自己擁有的 Core ML 模型；Apple Speech 的系統模型不因使用 Speech API 就自動成為 App 可載入的 `MLModel`。

來源：[Apple：Analyzing a Core ML model’s performance in Xcode](https://developer.apple.com/documentation/coreml/analyzing-a-core-ml-model-s-performance-in-xcode)、[MLComputePlan](https://developer.apple.com/documentation/coreml/mlcomputeplan-1w21n)。

## 4. Sherpa → Core ML：有入口，未證明目前封裝可直接切換

上游 Python recognizer API 接受 `coreml` provider。但 C++ `session.cc` 受 Apple 平台、ONNX Runtime API 版本及 `SHERPA_ONNX_DISABLE_COREML` 編譯條件控制；本次查到的 master 分支使用舊 CoreML append API，flags 為 0。上游 macOS arm64 **static** ONNX Runtime CMake 檔明確定義 `SHERPA_ONNX_DISABLE_COREML`。這不代表所有 macOS build 都不支援；它表示必須核對本專案實際連結的 binary，不能只改環境變數就宣稱成功。

SpeakSlow 本機 `sherpa_server.py` 預設 `SHERPA_PROVIDER=cpu`；主要 Paraformer 與 streaming recognizer 會讀此 provider，但快速辨識與標點另有硬編碼 `cpu`。所以即使主 recognizer 成功改 provider，也不等於整條 ASR 流程都改到 Core ML。本輪未改設定，未實測 Core ML provider。

來源：[Sherpa online recognizer API](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/python/sherpa_onnx/online_recognizer.py)、[Sherpa session.cc](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/session.cc)、[macOS arm64 static build](https://github.com/k2-fsa/sherpa-onnx/blob/master/cmake/onnxruntime-osx-arm64-static.cmake)；本機依據：[provider 預設](/Users/chunghan/AI/SpeakSlow/sherpa_server.py:287)、[快速辨識固定 CPU](/Users/chunghan/AI/SpeakSlow/sherpa_server.py:514)、[標點固定 CPU](/Users/chunghan/AI/SpeakSlow/sherpa_server.py:750)、[主要離線辨識](/Users/chunghan/AI/SpeakSlow/sherpa_server.py:852)、[串流辨識](/Users/chunghan/AI/SpeakSlow/sherpa_server.py:988)。

## 5. Zipformer／Paraformer／INT8：需以精確圖形驗證

ONNX Runtime 的 CoreML EP 提供 `ModelFormat`、`MLComputeUnits`、靜態 shape 等設定；官方也明示 ANE 裝置限制旗標不能保證整個模型都在 ANE 執行。動態 shape 可能影響性能；Core ML 圖形編譯亦有成本。

官方算子表對 shape、常數輸入等有條件，且本次查核的 NeuralNetwork／MLProgram 表均未列 `MatMulInteger`、`DynamicQuantizeLinear`。這表示不能由「ONNX」或「INT8」字樣推導完整加速。**本專案的特定 Paraformer INT8、標點 INT8，以及 bilingual streaming Zipformer fp32／INT8 能分派多少算子到 Core ML／ANE，仍為 `unclear`。**本輪沒有解析每份模型的 ONNX graph，亦沒有建立 provider session，不能宣稱不支援整個模型或已可加速。

來源：[ONNX Runtime CoreML EP](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)。後續若做 POC，先核實實際 binary 是否含 EP，再查圖形算子與分派，最後用同一批音訊比對輸出和延遲；provider 名稱不能作驗收證據。

## 6. whisper.cpp：已提供 Core ML encoder 路徑，但屬換引擎

上游文件明列 Apple Silicon 可透過 Core ML 將 **encoder** 放到 ANE，需生成對應 Core ML 模型並用 `WHISPER_COREML=1` 建置；首次裝置編譯另有成本。這是 Whisper encoder 加速，不是把現有 Sherpa 模型搬到 ANE，也不是整個 Whisper pipeline 的 ANE 保證。上游速度宣稱不能直接套到 SpeakSlow 的中文語料或停止到貼上的延遲。

來源：[whisper.cpp：Core ML support](https://github.com/ggml-org/whisper.cpp#core-ml-support)。

## 7. WhisperKit：可分別設定 encoder／decoder 的 Core ML 資源

官方原始碼 `ModelComputeOptions` 分開設定 mel、audio encoder 與 text decoder；目前 macOS 14+ encoder 預設允許 CPU＋ANE，decoder 也預設 CPU＋ANE，並將值送入 `MLModelConfiguration.computeUnits`。這提供另一條 Swift／Core ML 候選路徑；仍需驗證精確模型、實際 placement、冷啟動、首字及中文品質，不能由預設值推導全程 ANE 或更快。WhisperKit 原官方 repo URL 現導向 Argmax OSS Swift，後續應鎖定版本再評估。

來源：[Argmax 官方 Models.swift](https://github.com/argmaxinc/argmax-oss-swift/blob/main/Sources/WhisperKit/Core/Models.swift)、[Argmax 官方 repo](https://github.com/argmaxinc/argmax-oss-swift)。

## 8. Ollama：Apple Metal 是 GPU 路徑

Ollama 官方硬體文件列 Apple 裝置透過 Metal API 加速 GPU。這不等於 ANE。本專案透過 Ollama HTTP API 做潤稿，不會因增加一個 ANE 旗標就把既有模型改成 ANE；本輪查核沒有找到本專案可用的官方 ANE 切換契約。任何另換 Core ML LLM runtime 的工作，應視為獨立的模型與執行環境評估。

來源：[Ollama：Hardware support / Metal](https://docs.ollama.com/gpu#metal-apple-gpus)。

## 建議決策順序

1. 保留既有 Apple／Sherpa 選擇，先以同一段真人 zh-TW 錄音，驗收選詞、完整 CER、標點、首次預覽及停止到定稿；不要把不同錄音或合成音結果當成真人 A/B。
2. 如主要問題是 CPU／記憶體，先確認 Apple 路徑在實際日常工作已被使用，並重測資源；要宣稱省電，需另量能耗。
3. 只有在必須保留 Sherpa 特性、且 CPU 負擔仍是瓶頸時，才安排隔離的 CoreML provider POC。先過 binary／算子／placement 三關，再談移植。
4. WhisperKit／whisper.cpp 可作次級候選；本輪證據不足以支持更換預設、承諾加速倍數或中文品質提升。

以上官方網頁與 master／main 原始碼可能後續變動。實作前須鎖定依賴版本；本筆記是查核結果與待驗假說，不是 CoreML 相容性或新引擎 acceptance。

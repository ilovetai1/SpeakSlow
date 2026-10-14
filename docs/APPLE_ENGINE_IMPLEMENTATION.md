# Apple 語音引擎使用與維護

本版新增可選的 Apple 本機語音辨識。現有 Sherpa 仍是預設。實作對應 OpenSpec `add-switchable-apple-speech-engine`；實測與未通過項目見 [驗收報告](APPLE_ENGINE_ACCEPTANCE_2026-10-14.md)。

## 使用方式

1. 開啟設定 → 一般 →「語音辨識引擎」。
2. 選擇「現有本機引擎（Sherpa）」或「Apple 原生引擎」。
3. Apple 需要 macOS 26 以上及 Apple Silicon。本版固定台灣繁體中文 `zh-TW`；缺模型時，按「下載所需模型」。
4. 等待狀態成為可使用，再開始錄音。選擇已保存不代表引擎已就緒。

Apple 提供兩種偏好：

|偏好|行為|
|---|---|
|完整上下文，預設|允許較完整的上下文；短句可能等到停止後才出字。|
|即時回饋|啟用 SDK fast results，通常較早出字，可能增加錯字；不保證立即出字。|

錄音、辨識、潤稿、保存及貼上進行期間不能切換。檔案轉錄與歷史重新辨識也使用同一工作鎖。取消工作後，會先結束該工作，再允許切換。

Apple 的可修訂預覽顯示在 SpeakSlow 內。只有完成定稿後才進入共用輸出流程。字典、繁體轉換、AI 潤稿及貼上設定仍適用；AI 潤稿若使用雲端服務，文字會依該功能的既有設定傳送。

Apple 保留原生標點及段落。Sherpa 熱詞、串流選項、效能偏好、依停頓分行及規則列點不套用到 Apple；原有設定仍保留。專有名詞可先用辨識後字典替換。此版未提供 Apple 原生熱詞或自訂語言模型，不能將字典替換描述為改善原始辨識模型。

歷史「重新辨識」會明示並使用目前選定引擎。Apple 檔案辨識使用單一連續 session；SRT 使用 SDK 音訊時間，沒有時間資料時會回報不完整，不依字數估算時間。

## 失敗與重試

- 不支援的 OS／架構、缺 helper、缺模型、資源不足、程序退出及音訊積壓都會明示失敗，不自動改引擎或語言。
- 模型由 Apple 系統服務管理。「停止等待並選回現有本機引擎」只解除本次啟用等待，不能保證共享下載停止，也不會刪除系統模型。
- 出錯後可按「重新檢查」，或在沒有進行中工作時明確選回 Sherpa。
- 取消、無聲及失敗的 partial 不自動保存、潤稿或貼上。

## 維護入口

|範圍|檔案|
|---|---|
|引擎協調、設定與工作生命週期|`src/helpers/speechEngineManager.js`|
|Apple 子程序、JSONL 及 PCM ACK|`src/helpers/appleSpeechManager.js`|
|SDK、模型、格式轉換及時間軸|`native/AppleSpeech.swift`|
|依 audio range 及 watermark 合併結果|`src/helpers/speechTranscript.js`|
|音檔保存／保留期|`src/helpers/audioStore.js`|
|非 ASR 文字／emoji／TTS|`src/helpers/textUtilityService.js`|
|IPC 與 renderer 錄音|`src/helpers/ipc/speech.js`、`src/hooks/useRecording.js`|
|renderer PCM 分塊與積壓上限|`src/utils/pcmTransport.mjs`|
|引擎與偏好畫面|`src/components/SpeechEngineSettings.jsx`|

錄音仍由 Electron 的原有麥克風流程負責。Swift helper 只接收音訊，不另開麥克風。protocol v1 使用 session、sequence、generation 與 request ID；初始 PCM 塊約 100 ms、單一訊息上限 256 KiB、未送出音訊上限 2 秒。ACK 要等 SDK iterator 取用 buffer，不能只表示寫入 pipe。超限直接失敗。

完整上下文僅開 `.volatileResults`；即時回饋另外開 `.fastResults`。模型使用 `.whileInUse`，不開 macOS 27 的忽略資源限制選項。應用程式僅結束自己擁有的子程序，不終止 Speech／ANE 共享系統服務。ANE 的排程由 Apple 決定，沒有使用者可分配核心數或強制提高使用率的控制。

emoji 與繁簡轉換不啟動 Sherpa ASR。TTS 使用獨立 `--utility-only` worker，拒絕 ASR 指令並在閒置後釋放；原有 Edge TTS 仍屬線上功能。

延遲資料寫入 `latency_metrics_v2`，依 ASR 引擎及偏好分群，LLM provider 維持獨立欄位。有效 v1 唯讀匯入，舊引擎標為 unknown；只寫 v2、保留 7 天／1000 筆，不保存文稿或 PCM。first-preview 從錄音開始計算；stop-to-ASR-final 與 stop-to-paste-command-ack 各自從停止計算，不能互換。貼上命令 ACK 不證明目標程式收到文字。

## 建置與測試

```sh
npm run build:backend
npm run build:renderer
npx electron-builder --mac --dir --arm64
node --test test/*.test.js
openspec validate add-switchable-apple-speech-engine --strict
```

`build:renderer` 會先建置兩個 native helper；`build`／`build:mac` 也先重建 backend，避免包到不認識 utility-only 的舊版 Python binary。Apple helper 的 deployment target 是 macOS 26，封裝於 `Contents/Resources/apple-speech`；終端使用者不需安裝 Xcode。

開發者需要可編譯 SpeechAnalyzer 的 Apple SDK。macOS 26 deployment target 與編譯成功不等於已在 26 實機驗證。正式發行仍需執行 host／helper 簽署、公證及首次權限驗收。

測試工具位於 `scripts/asr-benchmark/`。`run_product_benchmark.py --packaged` 使用打包 App、隔離 userData 及真實 IPC；`score_product_benchmark.py --scope app` 產生配對結果。先準備研究報告描述的 Common Voice manifest、合成語料與 plan。輸出位於忽略版控的 `out/apple-engine-product/`，不可把語料或轉錄寫進產品日誌。

# Apple 引擎實作與本機驗收：2026-10-14

已實作 Apple／Sherpa 選擇、共用錄音與轉錄路由、連續 PCM、Apple 原生時間字幕及按引擎分群的量測。已建置可啟動的 ad-hoc 簽章測試版，並依使用者授權直接更新 `/Applications/SpeakSlow.app`、啟用 Apple 完整上下文，未保留備份。首次本機辨識成功；後續也已更新麥克風權限測試釋放修正，詳見 [診斷紀錄](MICROPHONE_PERMISSION_LEAK_2026-10-14.md)。核心實作完成，正式發行與實體操作驗收尚未全部通過。

此輪結果支持提供 Apple 作為省資源的選項；不支持改成預設，也不支持宣稱已達到 iPhone 的正確率或斷句體驗。此結論僅適用以下機器、語料及量測範圍。

## 環境與資料

- macOS 27.0.1、Apple M5、10 logical CPUs、16 GiB RAM；Apple helper 最低 deployment target 26.0，編譯 SDK 27.0。
- 現有引擎為 Sherpa standard。Apple 分別測 accurate 及 responsive，未將兩者混算。
- 真實打包 Electron App、built React 設定頁、preload、main IPC、實際辨識程序與隔離 SQLite。AI 潤稿與對外貼上關閉。
- 自然語音為 50 段 Common Voice 台灣華語短音訊，共 463 個參考字元。合成語音為 30 段 macOS Meijia zh-TW TTS，單段 20.13–28.76 秒，包含停頓、列點、問句、數字、人名與中英混合。每段都跑三種配置，共 240 筆辨識。
- 音檔、逐筆結果、資源採樣及 trace 保留於 `out/apple-engine-product/`；不放入產品日誌或使用者正常歷史。舊 `core-*` 試跑使用不同路徑，已標示失效，不納入比較。

## 正確率與音檔提交時間

CER 為總編輯距離／總參考字元，越低越好；NFKC、英文小寫，排除標點及空白。以下使用繁中文字形的 CER，沒有把專有名詞或數字錯誤豁免。另報的字形正規化 CER 見原始摘要，僅額外處理繁簡、臺／台、裏／裡。

|語料|配置|CER|提交到定稿 P50|P95|
|---|---|---:|---:|---:|
|自然 50 段|Sherpa standard|5.40%|77.2 ms|127.4 ms|
|自然 50 段|Apple accurate|6.05%|103.1 ms|150.2 ms|
|自然 50 段|Apple responsive|8.21%|89.4 ms|125.8 ms|
|合成 30 段|Sherpa standard|4.25%|468.0 ms|671.5 ms|
|合成 30 段|Apple accurate|5.24%|426.3 ms|473.2 ms|
|合成 30 段|Apple responsive|5.34%|392.9 ms|436.3 ms|

計時從準備好的 WAV 交給 renderer／IPC 開始，到辨識回傳；包含 session prepare、PCM 傳輸與定稿。不包含讀檔、前置解碼／base64、選擇引擎、下載、潤稿或貼上。這不是麥克風停止到貼上的延遲。每配置僅一個測試區塊，沒有反序重複試驗或信賴區間，不能把很小的差值視為穩定優勢。

在這批自然短句，Sherpa 錯字率最低。Apple responsive 的短句錯字增加較明顯；長合成音檔的提交後處理較快。實際語音差異、房間噪音、口音及不同硬體可能改變結果。

## 斷句與預覽

合成語料以 TTS 原稿標點作嚴格位置／類型比對。字元對齊後計算 F1；句界只計句號、問號及驚嘆號。這是腳本一致度，不是人工判讀的斷句自然程度。

|配置|腳本標點 F1|腳本句界 F1|
|---|---:|---:|
|Sherpa standard|58.20%|51.06%|
|Apple accurate|22.56%|23.08%|
|Apple responsive|21.67%|24.47%|

自然語料參考沒有可靠標點，不計斷句分數。這輪沒有證據顯示 Apple 斷句優於 Sherpa。長音訊中 Apple 有保留原生句點及逗點，但仍有長串未斷句、錯字及中英空格差異。

另用約 5.9 秒的軟體 MediaStream 音源，走實際錄音 hook／PCM／SDK／保存流程。每配置只有正常停止與重複停止兩筆有聲結果，保留原值、不計 P95：

|配置|停止到 ASR 定稿，兩筆|開始到首次預覽，兩筆|
|---|---|---|
|Sherpa standard|210.7／129.1 ms|一般模式無即時預覽|
|Apple accurate|223.0／134.7 ms|6099.7／6054.8 ms|
|Apple responsive|57.4／62.2 ms|3143.4／3146.0 ms|

accurate 在這段短句接近停止才出字；responsive 約三秒才首次出字。不能宣稱 iPhone 式即時反應。軟體音源替代 getUserMedia 輸入，未證明實體麥克風、首次 TCC 或實際目標程式收到文字。

下一輪人工斷句驗收應在測試前固定至少 30 段人聲長口述及逐字稿；標註可接受句界集合、思考停頓與語法句界的區別、問句及列點。兩位評讀者在不知道引擎的情況下分別評讀，再處理歧異。依固定標註計 precision／recall／F1；另列過度斷句與漏斷句。本輪未完成這個人工 gate，不能用腳本 F1 代替。

## 記憶體與 CPU

採 `proc_pid_rusage` physical footprint，非 RSS／virtual size；CPU 單位經本機校準。相同 80 段音訊工作負載，包含 App main、renderer、GPU helper 與自己擁有的 ASR 程序。可讀 Speech 系統服務另列；系統服務可能共享，受保護服務與 driver 配置不包含在本表。

|配置|App 與自有程序 peak|可讀系統服務 peak|同時合計 peak|工作期間 CPU 合計|
|---|---:|---:|---:|---:|
|Sherpa standard|1919.9 MiB|16.3 MiB|1936.2 MiB|132.10 秒|
|Apple accurate|828.6 MiB|151.0 MiB|921.5 MiB|30.33 秒|
|Apple responsive|839.7 MiB|81.9 MiB|909.9 MiB|31.32 秒|

各欄獨立 peak 不一定發生在同時，因此不能把前兩個 peak 直接相加。CPU 秒是各可讀程序的 CPU time delta，包含多核心工作，不是耗電或 wall time。測試開啟設定與主視窗，含 JS 語料注入及緩衝配置；也受配置測試順序影響。這不是日常閒置記憶體，也不是整台機器完整占用量。

Apple 在這個可讀範圍內，合計 peak 與 CPU 均較低。尚未重複量測真正冷啟動、長時間閒置、休眠恢復或連續真人輸入，因此未宣稱固定節省比例、無 leak 或電池續航改善。

## ANE 與 GPU 的可觀察證據

另跑每引擎 30 秒 Instruments all-process trace，辨識工作約 22 秒。此 trace 與上面的延遲／資源試驗分開，不能相加成同一次的總值。

- Apple 有 438 筆 Neural Engine interval，包含模型 load／prediction；標籤含 `AneInference`。Sherpa 對照為 0 筆。這支持 Apple 工作期間實際有 ANE 活動。
- interval 筆數不是音訊段數、ANE 使用百分比、核心數或耗電。系統 trace 的歸屬有限，不宣稱所有背景活動都由 SpeakSlow 獨占。
- 未見 GPU interval 直接歸屬 `apple-speech`、`localspeechrecognition` 或 `sherpa_server`；有系統／UI GPU 活動。不能宣稱任何情況 GPU 都是零。
- 另外量到受保護共享服務合計 footprint peak：Sherpa trace 36.83 MiB、Apple trace 36.85 MiB；CPU delta 分別約 0.006／0.321 秒。包含 ANECompilerService、aned、corespeechd_system、modelcatalogd、modelmanagerd；保留為另一次 trace 證據，不加到前表假裝完整總量。

Apple SDK 可以讓系統選擇 ANE；此版沒有強制使用更多 ANE、指定核心或增加資源上限的開關。

## 功能與建置驗證

|項目|結果與範圍|
|---|---|
|Node regression|131 項，129 通過、2 skip、0 失敗；含真實 headless React 設定畫面。|
|語料配對|240 筆真實打包 App／IPC 辨識完成。|
|錄音流程|三配置 × 正常／重複停止／取消／靜音共 12 項通過；軟體 MediaStream。正常／重複停止只新增一筆歷史；取消／靜音不新增。|
|切換與非 ASR 功能|實際 20 次切換，未留非所選自有 ASR；emoji／文字轉換不喚醒 Sherpa。UI 設定跨視窗同步；通用設定 IPC 不能繞過 busy gate。|
|保存及歷史|Apple 音檔只保存一次；選回 Sherpa 後，歷史使用目前引擎重新辨識。|
|崩潰與重試|只對隔離測試擁有的 Sherpa child 注入 crash；錯誤可見、阻止錄音、不換引擎；明確重試後以新程序恢復。|
|長檔／字幕|69.36075 秒、294 字、4 個原生時間片段，三段標記按序保留、字幕文字完整且時間跨過 60 秒。原精確詞檢查因「迴收站」「臺中」未通過，保留該失敗，不視為正確率通過。|
|取樣率|44.1 kHz 與 48 kHz 經 renderer／PCM／AVAudioConverter 成功，結果與約 4.716 秒時間軸合理。雙聲道 WAV 也通過真實 native converter 辨識；未完成實體 stereo 裝置驗收。|
|utility-only 封裝 backend|文字轉換及 builtin emoji 與來源一致；transcribe／precog_start／stream_init 三種 ASR 指令都被拒絕。未新增線上 TTS 品質／網路驗收。|
|建置|Swift helper、PyInstaller backend、Vite renderer 與 arm64 App 成功；54 個 JS 語法檢查及 Python compilation 通過。|
|簽章／OS gate|ad-hoc App `codesign --verify --deep --strict` 通過；helper Mach-O minOS 26.0。非 Developer ID 發行簽章或公證證據。|
|OpenSpec|本 change strict validation 通過。其他進行中 change 未補勾。|
|Lint|既有 ESLint 9 缺 flat config，`npm run lint` 無法執行；未為此變更無關工具設定。|

## 尚未通過的 gate

- macOS 26 實機 prepare／供音／finish／cancel／時間軸；目前只在 27.0.1 跑 runtime。
- 已安裝發行版首次麥克風允許／拒絕、背景快捷鍵、更新重啟、host／helper 身分與 Hardened Runtime／Developer ID／公證。
- 實體麥克風與至少 30 組真人口述的停止到實際貼上配對；人工斷句、iPhone 同音源比較。
- Sherpa fast／precog／Zipformer 全部模式的實機回歸，及跨引擎 TTS／操作模式／關窗重啟／休眠長時資源回歸。
- 全路徑既有日誌的完整隱私稽核。本版新 bridge 不轉送原始 stderr／PCM，metrics 無文稿，並移除已碰到的 ASR 文稿與音檔路徑 log；這不代表所有既有診斷 log 已全面驗證。
- 真冷／暖／閒置重複資源試驗、發行規格的 P95 預算、ANE 占用率及功耗。

上述 gate 保留未勾，不以編譯或軟體音源結果代替。使用 Apple 作為可選測試引擎有實作與本機證據；本機替換已完成，Developer ID 發行與剩餘實機 gate 仍需後續處理。

## 證據位置與重現

- 使用與建置：[Apple 引擎使用說明](APPLE_ENGINE_IMPLEMENTATION.md)。API 依據：[Apple SDK 研究](APPLE_SPEECH_SDK_RESEARCH_2026-10-14.md)。
- `out/apple-engine-product/app-data/speech-acceptance.json`：240 筆逐筆辨識。
- `out/apple-engine-product/app-summary.json`、`app-report.md`：分群分數；`resources.jsonl`、`cpu-calibration.json`：採樣與單位。
- `out/apple-engine-product/capture-data/capture-acceptance.json`：12 個錄音流程及時序。
- `out/apple-engine-product/final-smoke/speech-acceptance.json`、`long-audio-result.json`：最後候選版切換、歷史、崩潰及長音訊；其中 informational 的精確詞檢查為 false，非所有 assertion 都通過。
- `out/apple-engine-product/hardware/analysis.json`、`apple.trace`、`sherpa.trace`：分開採集的硬體證據。
- `out/apple-engine-product/utility-proof/proof.json`、`out/apple-regression-tests.log`、`out/apple-renderer-build.log`、`out/apple-backend-build.log`、`out/apple-lint.log`：其他驗證。
- `out/apple-engine-product/stereo-proof.json`：雙聲道 native converter 辨識。
- 測試候選版：`dist/mac-arm64/SpeakSlow.app`。隔離驗收只在明確傳入 acceptance 參數時啟用，不修改正常 userData，不貼到其他 App。

240 筆量測後的修正集中在錯誤／退出處理、歷史回應引擎欄位及說明文字；最後候選版再次跑每配置自然 2 段＋合成 1 段及深度 smoke，沒有因小範圍修正重新覆寫完整量測資料。未宣稱完整數據是最後 binary 的逐 bit 同版重跑。

## 後續進度

2026-10-14：已完成本機直接更新與 Apple 選擇持久化；麥克風權限測試後未釋放串流的問題已修正並更新安裝版。最後回歸共132項，130通過、2 skip。CoreAudio 在實際權限測試後顯示安裝版未持續收音。上方240筆語料數據保留原輪次範圍；輔助使用權限啟用尚未確認，不能宣稱自動貼上已完成驗收。使用者已授權將本次進度 commit／push 至既有追蹤遠端；不建立 tag 或發布正式 release。

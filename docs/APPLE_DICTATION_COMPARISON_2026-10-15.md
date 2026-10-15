# Apple Dictation 切換與同音檔比較

2026-10-15：保留 SpeakSlow 2.1.0 開發版與原有預設，新增 DictationTranscriber 模式及歷史錄音的配對比較。已完成原始碼、ARM64 測試包與下列驗證；尚未替換 `/Applications/SpeakSlow.app`，未 commit／push 或發布 Release。

## 選擇模式

設定 → 一般設定 → 語音辨識引擎 → Apple 原生引擎 → Apple 辨識模式：

|畫面選項|保存值 `apple_response_profile`|Apple module|
|---|---|---|
|SpeechTranscriber・完整上下文（預設）|`accurate`|Speech，volatile results，沒有 fast results|
|SpeechTranscriber・即時回饋|`responsive`|Speech，volatile＋fast results|
|DictationTranscriber・系統聽寫|`dictation`|Dictation，progressiveLongDictation＋audioTimeRange|

選擇後等待就緒；缺資產時由使用者按下載。每個模組查詢自身精確 zh-TW 與資產狀態；不自動替換模型。Dictation 沒有 Speech 的 `isAvailable` 屬性，不能用 Speech availability 代替其能力查詢。錄音、檔案、歷史重新辨識與 latency 分群均沿用選定模式。原生詞彙提示／custom LM 尚未加入；辨識後字典依既有流程使用。

Swift helper 與 host protocol 已同步升為 v2，舊 v1 會被拒絕；測試包同時包含兩者。SDK 最低 deployment target 維持 macOS 26；本輪 runtime 為 macOS 27.0.1／Apple M5，不等於 macOS 26 實機驗收。

## 用同一段錄音比較

1. 先開啟「保存錄音」，錄製一次包含完整語境的內容，例如「請在這個頁面顯示程式碼」。停止後確認歷史紀錄有播放／下載按鈕。
2. 保持 Apple 引擎就緒，在該筆歷史按「比較 Apple 模型」。沒有保存的音訊無法事後重建。
3. 選擇要比較的 Speech 偏好及先執行的模型，再按「開始比較」。兩者依錄音速度依序供音，約需音檔長度兩倍加上準備與定稿時間。
4. 核對兩欄原始選字、漏字與多字。可填入實際說出的參考文字計算 CER；不以既有辨識結果自動充當正確答案。
5. 可反轉順序重測，觀察暖機、快取與系統負載影響。單次結果不代表平均、P95 或 iPhone 體驗。

每次讀取歷史音檔一次，將相同 PCM bytes 送入兩個模型，結果回傳音檔 SHA-256。比較不套用字典、emoji、繁簡轉換或 AI，不更新原歷史、不保存新的音檔、不貼到其他 App，也不混入一般錄音的 latency 統計。比較期間持有單一工作鎖；取消、renderer 結束及恢復所選模式都受同一生命週期管理。缺資產會在對應欄顯示失敗；恢復原模式失敗會明示並阻止繼續錄音。

### 如何解讀時間與錯誤率

- 模型準備：建立 session／探測／準備 analyzer，與供音分開計算；首次下載不會自動開始。
- 首次文字：從開始供音到收到第一個非空文字，包含音訊開頭靜音；可能是暫定或已定稿文字，仍須看最後輸出。
- 音訊結束到定稿：從依 sample count 計算的錄音結束點，到完整結果 drain 完成，包含尾塊處理。全部使用 main 的 monotonic clock，沒有跨程序相減 timestamp。
- 以上是音檔即時節奏重播，沒有涵蓋實體麥克風、快捷鍵、AI、貼上命令或目標欄位接收。
- CER＝字元編輯距離／參考字元數；NFKC、英文小寫，排除標點及空白，不合併繁簡字、不修同音詞。漏字、多字、替換都計分；大量多字可使 CER 超過 100%。沒有有效參考文字時不顯示百分比。
- 計分每份最多 2000 個正規化字元，超限會顯示原因；長稿仍可直接核對兩欄原文，沒有自動截稿計分。

## 本輪驗證

- Node 回歸：144 項，141 通過、3 skip、0 失敗。skip 為需主動提供音訊的 native runtime 測試，以及兩個 Electron SQLite ABI 測試。[完整輸出](../out/dictation-switch-2026-10-15/node-tests.log)
- 另主動啟用真實 Apple helper／coordinator 測試：1 項通過，驗證 accurate／responsive／dictation、同 PCM 雙模型、取消、恢復及重試。使用既有 6.916625 秒 Meijia 合成音，未開麥克風、不使用正常使用者 DB 或貼上。[逐模式及配對原始結果](../out/dictation-switch-2026-10-15/native-comparison.json)
- 新增單元／IPC／真實 React DOM 覆蓋：模式持久化與忙碌鎖、相同 Buffer／hash、原文不改寫、資產缺失、owner 隔離與 renderer 結束、取消、恢復失敗明示、CER 漏字／多字／字形，以及畫面取消與參考文字計分。
- 最後設定文案補充 Dictation 漏字限制後，再跑兩項 React DOM 測試通過，包含開啟設定不寫偏好、保留 accurate 預設及 Dictation 文案。[最後 UI 回歸](../out/dictation-switch-2026-10-15/final-ui-tests.log)
- `npm run build:renderer`、ARM64 electron-builder dir 封裝及 `codesign --verify --deep --strict` 通過；ad-hoc 簽署 106 個 Mach-O、9 個 nested bundles，沒有公證或正式發行簽章宣稱。[建置輸出](../out/dictation-switch-2026-10-15/build.log)
- 封裝核對：6 份相關 JS／preload 與來源 hash 一致、封裝 native helper 與建置 binary 一致、built renderer 含 Dictation 選項。[封裝核對](../out/dictation-switch-2026-10-15/package-proof.json)
- OpenSpec `add-switchable-apple-speech-engine --strict` 及 `git diff --check` 通過；舊的 macOS 26、真人口述、實體麥克風與目標接收等 gate 保留。

本輪合成音只證明整合路徑可執行及量測邊界，不據此改預設或宣稱 Dictation 整體更準。尚未完成本次新功能的真實打包 Electron 互動／IPC runtime、已安裝版麥克風與真人品質驗收；React DOM 與 production helper 的分開驗證不能替代它們。

測試包：`/Users/chunghan/AI/SpeakSlow/dist/mac-arm64/SpeakSlow.app`。正式替換既有安裝版依當次使用者授權執行。

API 依據：[Apple DictationTranscriber](https://developer.apple.com/documentation/speech/dictationtranscriber)、[progressiveLongDictation](https://developer.apple.com/documentation/speech/dictationtranscriber/preset/progressivelongdictation)，以及本機 Xcode SDK 的 macOS 26 availability／公開介面。

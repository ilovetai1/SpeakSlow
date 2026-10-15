## 1. 固定實作與驗收契約

- [x] 1.1 依官方研究核對 macOS 26／27 API 與實際簽章建置設定，固定 helper protocol、錯誤碼、支援 gate 及 owned-child 結束 timeout；不擴張既有權限。
- [x] 1.2 固定兩引擎／Apple 兩偏好、忙碌切換拒絕、原生標點／段落與詞庫適用範圍的 UI 文案，以及每個 ASR 入口的路由表。
- [ ] 1.3 建立至少30組有效配對的繁中驗收清單，包含20–60秒長口述、思考停頓、問句、列點、數字、人名與中英混合；先訂 CER、標點及句界人工標註方式。

## 2. 共用引擎協調器與 Sherpa 回歸

- [x] 2.1 建立 main-process `SpeechEngineManager` 與 `SherpaAdapter`，共用 capability／prepare／session／file／dispose 介面；移除啟動及狀態輪詢的無條件 Sherpa 初始化。
- [x] 2.2 實作設定驗證、持久化與跨視窗事件；專用與通用設定 IPC 經同一 gate，涵蓋缺值預設、非法值與儲存失敗回復舊狀態。
- [x] 2.3 實作全 job busy gate、凍結引擎／偏好、selection transition 序列化與 generation 失效；錄音到貼上及檔案／歷史工作期間拒絕切換或新工作且不排隊。
- [x] 2.4 實作 await dispose／owned-child 結束、切換失敗保留選擇、可觀察重試與明確切回；測試無雙 ASR、無靜默 fallback、無 stale callback 輸出。
- [ ] 2.5 驗證 Sherpa 原一般／fast／precog／Zipformer、快捷鍵、音檔與 finalization 契約在 adapter 接入後維持原行為。

## 3. 分離音檔與非 ASR 功能

- [x] 3.1 建立不載入 recognizer 的文字／emoji 共用服務，先固定繁簡轉換、全域／App 字典、符號與自訂 emoji 的代表性回歸案例，再替換直接依賴 Sherpa 的 IPC。
- [x] 3.2 將操作模式需要的文字轉換與 TTS 接到不初始化 ASR 的 utility 路徑；保留既有指令行為及外部服務資料範圍。
- [x] 3.3 將音檔保存、救援與保留期移到共用 audio store；驗證 `save_audio`、`no_persist`、暫存清理及歷史音檔不重複保存。

## 4. Apple helper、能力與系統資產

- [x] 4.1 新增 Swift helper build／resource packaging 與版本握手，deployment target 為 macOS 26；舊 OS／其他平台不啟動 helper，不要求終端使用者安裝 Xcode。
- [x] 4.2 實作裝置 availability、精確 zh-TW locale 語意、module assets 及 prepare 能力；測試近似 locale、未知 probe failure、缺 helper 與不相容 protocol。
- [x] 4.3 實作使用者觸發的 AssetInventory reservation／下載進度／重試／狀態重查；取消啟用失效本次等待，不誇大成共享下載已停止或模型已刪除。
- [x] 4.4 建立 accurate 明確 volatile-only 與 responsive 額外 fast-results 組態，字幕額外要求 audio-time attributes；核對未用 progressive preset 偷開 fast。
- [x] 4.5 實作 while-in-use session retention、資源不足及 helper crash 的結構化錯誤與清理；不啟用 OS27 ignoresResourceLimits，不終止共用系統服務。

## 5. 連續音訊與結果完整性

- [x] 5.1 實作 renderer→main→helper PCM 路由、session／generation／sequence 驗證、ACK、100ms 初始分塊、256KiB 訊息與2秒 pending-unsent 上限；超限明確失敗，無丟音或無界 queue。
- [x] 5.2 以 AVAudioConverter 實作 macOS26 最佳格式轉換與 sample timeline；驗證44.1／48kHz、mono／stereo、buffer ownership、格式變更、開頭及尾塊 flush。
- [x] 5.3 實作按 audio range 及 finalization watermark 合併的 reducer；驗證 overlap replace、volatile 未重發 final、長停頓、跨片段標點及單一完整輸出，不能沿用 benchmark 的 final-only accumulator。
- [x] 5.4 實作正常 finish→drain、cancel、空語音、重複 stop、helper exit 及 late events 的差異；取消或失敗的 partial 不自動保存／潤稿／貼上。
- [ ] 5.5 在真實 macOS26 驗證 prepare、PCM、finish、cancel 與時間軸，再於目前 macOS27 驗證；無26實機證據時保留 gate 未通過。

## 6. 共用錄音與所有轉錄入口

- [x] 6.1 將錄音 readiness、開始／供音／停止與 Apple preview 接入協調器，保留現有裝置、AGC、快捷鍵與錄音指示；不讓 Swift 再開一個麥克風。
- [x] 6.2 將兩引擎定稿接到同一字典／繁體轉換／finalizeTranscript；Apple 略過 Sherpa 標點與停頓斷行，預覽不送入目標欄位。
- [ ] 6.3 回歸獨立 AI／paste／Enter、操作模式 bypass、current-cursor、潤稿失敗、保存失敗與字典學習核准；每個 job 輸出及保存至多一次。
- [x] 6.4 將歷史重新辨識改經當前選定引擎並明示；保留無音檔限制與原 baseline／latest-final schema，不新增歷史引擎 metadata。
- [x] 6.5 將檔案／SRT 接入一個 job 與連續時間軸；Apple 不按60秒重開 analyzer，不依字數造 timestamp，缺 timing／單段失敗明示 incomplete，不轉TXT或漏段後報成功。

## 7. 引擎設定與狀態畫面

- [x] 7.1 新增兩引擎選項及 Apple accurate／responsive 文案，保留 Sherpa 預設；依 OS／架構顯示限制，區分選擇與 ready。
- [x] 7.2 顯示 checking、下載需求／進度、preparing、busy、stopping、unavailable、failed 與原因／重試；多視窗同步且忙碌時有可理解的拒絕訊息。
- [x] 7.3 依引擎呈現 Sherpa streaming／效能／熱詞／auto_line_break／auto_format_lists 設定與 Apple 原生結果說明；兩邊偏好不互相覆寫，Apple 保留辨識後字典。
- [ ] 7.4 檢查空白、無聲、拒絕麥克風、helper 未安裝、模型下載失敗及啟動時保存了不支援選擇的完整操作流程；沒有自動換引擎或 locale。

## 8. 引擎分群量測與隱私

- [x] 8.1 實作 latency_metrics_v2 的固定 ASR engine／profile／stage allowlist，保留 LLM provider 語意、原 enable 預設、7天／1000筆及無文稿規則。
- [x] 8.2 唯讀匯入有效 v1、opaque-ID 去重並將舊 ASR 標 unknown；驗證只寫v2、清除雙版與 in-flight、disabled、重啟及安全匯出，不改 history schema。
- [ ] 8.3 分開計算 first-preview、stop-to-ASR-final、stop-to-paste-command，各程序用自己的 monotonic duration；檢查全路徑 log 不寫文稿、PCM、任意路徑或原樣 stderr。

## 9. 封裝與端到端驗收

- [ ] 9.1 以隔離 userData 執行必要回歸及專案要求的 build checks，保留進行中2.1 change 尚未驗收的項目，不用本版結果替它補勾。
- [ ] 9.2 在授權的簽署安裝版本驗證 host／helper identity、首次麥克風允許與拒絕、背景錄音、更新後重啟、Hardened Runtime 與發行簽章／公證需求；CLI 成功不能代替此 gate。
- [ ] 9.3 執行至少20次兩引擎切換、關窗／重啟、status／emoji／字典／TTS／命令／歷史／檔案測試，確認無非所選 ASR、child／listener 堆積或取消後貼上。
- [ ] 9.4 用預定配對語料分別報 CER、標點／句界、first-preview、stop-to-final、stop-to-paste-command P50／P95；Apple 兩偏好各自量測，不在測後改規則來通過。
- [ ] 9.5 比較冷／暖／閒置／連續輸入的全 app、helper、Sherpa 及可讀系統服務 physical footprint 與 CPU，另記 ANE／GPU 活動和不可歸屬範圍；驗證設計的資源及 P95 預算，不推論功耗。
- [x] 9.6 彙整剩餘 gate 與可宣稱範圍；原生 Dictation 熱詞／zh-TW custom LM、iPhone 體驗對照沒有額外證據時保持未支援／未驗證，不視為本版已完成。

## 10. 可審閱交付

- [x] 10.1 回讀程式、更新使用說明與驗收證據，執行 OpenSpec strict validation；只有實際達成的實作與 runtime 項目才勾完成。
- [x] 10.2 整理可審閱 diff 與未通過限制；版本號、commit／push／tag、正式安裝／發行依當次明示授權執行，本規劃不預先執行。

## 11. 2026-10-15 可選 Dictation 本機口述測試

- [x] 11.1 完成既有 Dictation 明確選項與原生路由，選取時顯示已觀察到的漏字限制；不變更既有引擎及缺值模式預設。
- [x] 11.2 驗證選單、保存、忙碌切換限制及原生 Speech／Dictation 切換、取消後恢復；真人辨識品質交由使用者試用。
- [x] 11.3 更新本機 `/Applications/SpeakSlow.app`，驗證簽章、選項與設定保留；僅保留一份已安裝 App，不 commit／push／發行。

2026-10-15 本輪證據：`out/dictation-menu-install-2026-10-15/`。完整測試144項：141通過、3個選擇性測試skip；另以明確音檔執行原生runtime測試通過。backend／renderer／arm64封裝、OpenSpec strict、diff whitespace與ad-hoc完整簽章檢查通過。安裝後實際helper辨識確認 `dictation` ready及成功，僅作合成音檔smoke，未宣稱真人品質或貼上驗收。真實設定更新前後均為 `asr_engine=apple`、`apple_response_profile`未保存（沿用accurate）；未代使用者切到Dictation。僅保留 `/Applications/SpeakSlow.app`，App已重新啟動。選單由React UI測試與安裝包內容核對；桌面介面擷取工具後續失敗，未宣稱實際視窗的Dictation選取驗收。原11個保留gate不補勾。


## 2026-10-14 執行證據與保留 gate

- 已完成項目的範圍：實作、單元／React UI、真實打包 App 的檔案／IPC、12 個軟體 MediaStream 錄音情境、20 次切換、歷史／保存／崩潰重試、69.36 秒連續字幕及 44.1／48kHz／stereo 轉換。完整證據見 `docs/APPLE_ENGINE_ACCEPTANCE_2026-10-14.md`。
- 1.3：30 段 20–29 秒合成配對及 50 段自然短句完成；人工斷句標註未在測前完成，不能把腳本標點當人工驗收。
- 2.5、6.3：一般錄音／保存與既有 finalization／paste 單元回歸通過；Sherpa fast／precog／Zipformer 全模式及實際 AI／目標欄位貼上未全面驗收。
- 3.2、4.3、4.5、5.2、6.1 已勾為實作及可執行測試完成；線上 TTS、真實下載失敗／資源耗盡、實體 stereo／麥克風／快捷鍵仍屬後續實機範圍，未宣稱都已驗證。
- 5.3：原生 provisional passage 可能先涵蓋整段音訊，再縮小 final range；已測 overlap replace／watermark，69.36 秒內容與時間軸完整。原精確詞 assertion 因「迴收站」「臺中」失敗仍保留，不改 CER 或斷句規則。
- 5.5：只有 macOS 27.0.1 runtime，沒有 macOS 26 實機，保留未通過。
- 7.4：靜音、缺 helper、非法設定等有測試；首次真實麥克風拒絕與完整真實下載失敗流程未驗收。
- 8.3：stage 分開計算且 v2 無文稿，新 helper 不轉送 raw stderr／PCM；既有全路徑日誌尚未全面稽核，保留未通過。
- 9.1：131 項測試中129通過、2 skip；Swift／backend／renderer／arm64封裝、語法檢查通過。既有 ESLint9 缺 flat config，lint 未通過，因此本項不勾。原進行中2.1 change 未修改驗收勾選。
- 9.2：僅 ad-hoc 候選版啟動與簽章完整性通過；未正式安裝、未驗證首次權限／背景／更新／Developer ID／公證。
- 9.3：20 次切換、status／emoji／轉換／歷史／檔案與取消已驗證；線上 TTS／命令／關窗重啟／長時 child與listener 完整組合未完成。
- 9.4：240 筆配對 CER／腳本斷句與檔案提交 P50／P95 完成；真實口述 stop-to-paste 30配對及人工斷句未完成，軟體音源每配置N=2不計P95。
- 9.5：同音源暖工作負載的可讀程序 footprint／CPU 與獨立 ANE／GPU trace 完成；未測完整冷／暖／閒置重複試驗、不可歸屬配置及真實 stop-to-paste P95 預算。
- 10.2：保留原版本號2.1.0，未 commit／push／tag／安裝／發行。此版本不歸檔為全驗收完成。

### 後續本機安裝與推送授權

2026-10-14：依使用者明示指示直接更新 `/Applications/SpeakSlow.app`，無備份，Apple 完整上下文已保存且有首次辨識成功證據。再修正麥克風權限測試的串流釋放並更新安裝版；最後132項測試130通過、2 skip。9.2仍未勾：ad-hoc本機安裝不等於正式發行簽章／公證與完整首次權限驗收。使用者另授權提交並推送本次進度至 main 的既有追蹤遠端 fork/main；維持2.1.0，不建tag，不發布release。上方未安裝／未commit／push為初輪結束時紀錄。

## 11. 2026-10-15 明確 Dictation 模式與同音檔比較

- [x] 11.1 保留 Speech accurate／responsive 與預設，新增持久化 dictation 選項；沿用 busy gate／跨視窗同步及獨立 latency 分群。
- [x] 11.2 helper protocol v2 明確建立 Dictation、查自身 zh-TW／資產，使用 progressiveLongDictation 與時間資訊；不自動 fallback 或下載。
- [x] 11.3 歷史音訊讀一次、相同 PCM 即時節奏雙模型比較，保留原始文字與獨立準備／首字／尾延遲；可反序、填參考文字算 CER，不改歷史或套用字典／AI／貼上。
- [x] 11.4 比較全程工作鎖、owner／renderer 結束、取消、恢復所選模式與恢復失敗可見；單元、IPC 與真實 React DOM 測試通過。
- [x] 11.5 真實 production helper／coordinator 用同一份既有合成音檔驗證三模式、雙模型、取消與重試，記錄音檔 hash；不將合成音視為真人品質驗收。
- [x] 11.6 完成最後全套回歸、renderer／arm64 封裝與簽章核對、說明與 OpenSpec strict validation；保留既有整體驗收 gate。本輪未另獲安裝／commit／push／發行指示。

本輪：144 項回歸中 141 通過、3 skip；另啟用真實 native helper 測試 1 項通過。ARM64 測試包 ad-hoc 簽章完整性通過，6 份相關 JS／preload 與 helper hash 核對通過。說明與限制見 `docs/APPLE_DICTATION_COMPARISON_2026-10-15.md`；本次新 UI／IPC 的完整封裝互動、已安裝版真人麥克風／品質仍未驗收，不補勾既有 gate。

## 1. 本機延遲基線

- [x] 1.1 建立 LatencyManager 的固定 stage／outcome／mode／provider schema、opaque IDs 與 process-local monotonic clock，拒絕內容欄位。
- [x] 1.2 實作 1,000 sessions／7 日 bounded store、清除／停用後 late callbacks 失效，以及固定錯誤狀態。
- [x] 1.3 在既有 offline dictation 掛上 capture、ASR、polish、history-save、paste-command marker；補 main hotkey→capture-ready ack 與 renderer stop→paste-command ack。
- [x] 1.4 對 streaming、command mode 與無貼上流程記錄已觀察階段及 skipped／missing，不新增潤稿或輸出行為。
- [x] 1.5 沿用 performance IPC，加入 nearest-rank P50／P95、分群、n、失敗／缺測數與不足 30 筆提示。
- [x] 1.6 加入繁中統計頁及本機關閉／清除／JSON 匯出；說明 IPC-inclusive 與命令完成界線。
- [x] 1.7 以 fake clocks／isolated store 驗證時鐘起點、wall-clock 變化、partial／duplicate／cancelled／skipped／missing、白名單與停用無 observer／network post。
- [ ] 1.8 定義 32 組 synthetic 語料與可重複 benchmark fixture，取得至少 30 組有效 instrumentation off/on 實機配對；記錄 overhead budget 結果及排除原因。

## 2. 唯讀 context protocol 與平台驗證

- [x] 2.1 定義 versioned native JSON protocol、opaque AX element handle、positive editable／secure 判定、typed status 與無文字 logging 邊界。
- [x] 2.2 以自有 Swift helper 實作 metadata、bounded context、range observation 與 release；不得加輸入／focus／OCR／全文掃描功能。
- [ ] 2.3 在隔離 TextEdit／Chromium 欄位驗證 stable identity 與受限 range；記錄 supported／unsupported 條件，確認不讀 secure／denied／noneditable／own-app 文字。
- [x] 2.4 實作 ContextManager：200 code points 分配、250 ms deadline、2 秒 freshness、consume identity check、64 KiB protocol cap、late response 丟棄與 snapshot 清除。
- [x] 2.5 以 mock／protocol fixtures 驗證越界／無權限／timeout／field change／invalid response；缺少可靠 identity 時 fail closed。
- [x] 2.6 新增 helper 開發建置與 packaged resource 路徑、簽章驗證方法；驗證 macOS Apple Silicon artifact，其他平台回明確 unsupported。

## 3. 寫作 profile 與情境潤稿

- [x] 3.1 在設定提供 neutral／message／email／note、手動優先與 App mapping，缺省 neutral；profile 不改潤稿開關。
- [x] 3.2 新增 default-off context 設定與 denylist／狀態 UI，限定 automatic offline Ollama optimize 且 polishing enabled。
- [x] 3.3 擴充 preload／AI IPC／provider seam 的 options 與 context handle；raw context 不回 renderer，不存 history／settings／log／metrics。
- [x] 3.4 組裝已保存 instruction、固定 profile policy、transcript 與 escaped context data；neutral＋context off 保留原 messages／payload。
- [x] 3.5 以宣告 model／digest 實測剩餘 input/output budget；維持 500 字、num_ctx 2048 與 timeout，不足即 omitted_budget，不能截斷 transcript 或換 model。
- [x] 3.6 驗證 remote／streaming／history／command mode 不取外部 context；unavailable reason 可見且沿用既有 transcript-only／failure 契約。
- [x] 3.7 以至少 32 組 corpus 比較 context off/on 的格式、數字、日期、否定、自我修正、中英混用、專名與 prompt injection；記錄 model 品質限制。
- [x] 3.8 取得 context off/on paired measurements，單獨報告新增成本與 deadline／freshness 結果，不冒稱速度改善。

## 4. 本機改錯觀察與候選

- [x] 4.1 建立 default-off CorrectionLearningManager，使用共用 reader；learning 不啟用 context polishing 或 provider 請求。
- [x] 4.2 對原有 paste 添加唯讀 before range／anchors 與 after 唯一 span proof；最大 span 500＋兩側各 50 code points，不改 paste／Enter 結果。
- [x] 4.3 實作最多 15 秒、250 ms 非重疊 polling；換 field／App、開始新錄音、關閉／deny／secure／失去 span 即停止，釋放文字。
- [x] 4.4 實作 deterministic 單一 2–40 字詞替換 diff，排除數字日期、跨段、多處改动、大幅重寫、區段外更改與不確定定位。
- [x] 4.5 實作 candidate queue：100 records、14 日、同 App pair 合併、滿額可見狀態；只保存詞對與必要 decision metadata。
- [x] 4.6 在字典頁新增待學習 review；核准前無 output effect，dismiss 無 rule write，候選寫入失敗可見。
- [x] 4.7 以隔離 editable fixtures 驗證重複文字、長 span、Enter 清欄、慢 poll、換欄、新錄音與晚到 callbacks；確認無全欄位／AI／network 操作。

## 5. App 範圍字典與撤回

- [x] 5.1 建立完整 `scoped_dictionary_rules_v1` JSON rule store；App 規則不建立 legacy row，無效 scope 不擴成 global。
- [x] 5.2 核准預設當次 App、可明示選 global；同 SQLite transaction 更新候選及 scoped rule 或 global CRUD／undo metadata。
- [x] 5.3 合併字典 UI 的來源與 logical enabled；維持 legacy global CRUD／手動點字記憶、分類與匯入契約。
- [x] 5.4 套用規則依字典替換時凍結的 trusted App 情境、longest-first、相同 original 的 App rule 優先；UI 顯示本次詞庫，測試 AI 等待中切 App 與下一次辨識重新取得情境，保留 current-cursor 輸出；缺 bundle／invalid store 不誤套 App rule 或產生二次替換。
- [x] 5.5 加入完整 scoped JSON 匯出／匯入；legacy CSV 僅 global 並提示 App 規則排除數，invalid scope 不能匯成 global。
- [x] 5.6 實作 exact-value／revision undo，刪新 rule 或還原舊值；後續修改／刪除回 conflict，不覆蓋新編輯。
- [x] 5.7 用隔離 SQLite fixture 驗證 transaction rollback、同詞不同 App、global shadow、失敗 persistence、queue expiry 不刪 active rule、rule delete 清 undo binding及停學習後規則仍有效。
- [x] 5.8 驗證舊版忽略 App JSON rules且不會當 global，現有 rows／settings 資料不變；不執行真實使用者 DB migration。

## 6. 2.1.0 整合與版本驗收

- [x] 6.1 對 neutral／context off／learning off 完成既有 provider、finalization、paste、Enter、single-flight、history、indicator 回歸；確認未引入報告 1／2／5 的新行為。
- [x] 6.2 以 headless UI 驗證 profile mapping、兩個 opt-in 開關、狀態、候選 approval／dismiss／undo、統計／clear／export，使用隔離 fixtures。
- [x] 6.3 完成 Node／Python 相關檢查、renderer build、OpenSpec strict validation 與 packaged helper／DB smoke test；保留環境不適用的 skip 邊界。
- [ ] 6.4 在授權的 macOS Apple Silicon 安裝環境，以可控 TextEdit／Chromium 欄位驗證三功能；驗收時依 AGENTS.md 僅保留唯一 `/Applications/SpeakSlow.app`。
- [ ] 6.5 保存至少 32 組 model corpus 結果、30 組有效 instrumentation off/on 配對、獨立 context／learning 成本與 content-free export；未達工程門檻不宣稱驗收完成。
- [x] 6.6 核對 package／lockfile 2.1.0、功能預設與版本說明，列出已測 model／App／平台與限制；維持「開發版」直到授權且完成發佈驗收。

## 開發版驗證邊界（2026-10-14）

39/43 項完成。已將 Apple Development 簽章的 2.1.0 安裝至唯一 `/Applications/SpeakSlow.app`。TextEdit 真實 bounded AX、30 組獨立 context off/on、改錯候選、App 核准／撤回、重複詞定位、Enter 清欄、換文件及人工延遲 poll 驗證已完成。3.8／4.7 的成本與範圍見 `docs/EVOLUTION_2_1_0_VALIDATION.md`。

2.3／6.4：TextEdit 部分通過；Chromium 實機驗收由使用者暫緩，secure／noneditable 仍只有 protocol fixtures，不宣稱全平台驗收。

1.8／6.5：32 組模型語料已完成；完整麥克風→IPC→ASR→隔離 SQLite→貼上→bounded read-back 僅 1 組有效 pilot。完整 31 組計畫（預先指定第 1 組暖機，保留 30 組）因內建揚聲器靜音、ASR 無有效結果而 timeout，取得 0 組。未通過整體 instrumentation 工程門檻，任務保持未完成；不得以 timer fixture 或 context AX 配對代替。

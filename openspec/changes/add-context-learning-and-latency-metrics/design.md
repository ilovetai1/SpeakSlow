## Context

本次是 2.1.0 開發規劃。基準提交 `713bc96` 保存先前所有待提交內容，另修正模型探索與 AI 關閉同 tick 的競態；Node suite 83 passed / 1 Electron-ABI skip，renderer build 通過。這些結果不是新版三項功能的驗收。

目前 automatic offline dictation 經 `useRecording → finalizeTranscript → process-text IPC → AITextProcessor → provider adapter → App.safePaste`。潤稿 prompt 可編輯，Ollama 使用固定 `num_ctx:2048`、500 字 transcript 上限與 60 秒 timeout。字典已有 CRUD、JSON settings 及面板手動改錯記憶。`get-performance-stats` 目前為空資料。

主要接縫：`src/helpers/aiPrompts.js:29`、`aiTextProcessor.js:104`、`ipc/ai.js:5`、`preload.js:73`、`src/hooks/useRecording.js:421`、`src/App.jsx:746`、`src/helpers/database.js:103` 與 `ipc/system.js:216`。實作時重新核對行號。

## Goals / Non-Goals

**Goals:**

- 提供可選寫作 profile、預設關閉且受限的本機情境潤稿。
- 提供預設關閉、由使用者核准、可撤回的本機改錯學習，支援 App 範圍規則。
- 提供不含文字的本機延遲量測與可比較的基線。
- 保留本機 ASR／Ollama、既有可編輯 prompt、全域字典及輸出／歷史契約。

**Non-Goals:**

- 不重寫一般 paste／Enter 交易、不建立完整錄音取消狀態機、不改歷史／音檔救援與留存。這些項目不列入此 change。
- 不更換 ASR／LLM、擴大既有 Ollama context 或長稿上限、不自動下载模型、不重寫 AudioWorklet／錄音引擎。
- 不加入雲端 personalization、對遠端 provider 傳送周邊文字、全螢幕掃描、OCR、瀏覽器擴充、網站內容爬取或語音網頁動作。
- 本次不實作新功能、不發佈／tag／push、不打包或替換 `/Applications/SpeakSlow.app`。

## Decisions

### 1. 先做量測基線，再做情境與學習

先加入 `LatencyManager` 與 content-free instrumentation。取得相同錄音／model／硬體下的基線，再逐項開啟 context、learning，分開評估額外成本。不能由其他產品的行銷速度或不同 ASR 部署方式推論性能優勢。

2.1.0 的交付是量測能力與有證據的結果；AudioWorklet、有界 PCM buffer 或模型替換屬量測後的獨立決策，不直接加入本版本任務。

### 2. 保留 provider seam；profile 和外部文字情境分開

- profile 為 `neutral / message / email / note`。手動選擇優先於 App mapping，沒有 mapping 則 neutral。App mapping 只依 bundle ID，不推論網站、帳號或工作內容。
- profile 可供既有 provider 使用；它只描述排版與語氣，不承載外部文字。原 prompt 不被覆寫，主程序在固定 policy block 附加 profile。
- `context_aware_polishing_enabled` 預設 false。只有 AI 潤稿已啟用、provider=Ollama、automatic offline dictation 的 optimize，才讀取外部文字。
- 遠端 provider、history re-polishing、streaming、command mode 不取得外部文字情境。history 可使用明確手選 profile，但不能取當前外部欄位冒充當年情境。
- neutral＋context off 必須維持原 request 的 messages、provider payload 與結果處理。改選 profile 不啟動 AI，也不改動獨立潤稿開關。

第一版限制 Ollama 的原因是，既有遠端使用者沒有授權新功能把周邊文稿傳至外部。允許所有 provider 自動帶全文雖較省實作，但會擴大資料範圍；此 change 不採用。

### 3. 自有唯讀 macOS helper；main 持有短期 context

新增 `ContextManager` 及自有 Swift helper。採 stdin/stdout 的版本化 JSON protocol；操作僅限 metadata、captureContext、prepareObservation、observeSpan、release。無 insert、keypress、focus restore 或任意 AppleScript 功能。先支援 macOS Apple Silicon，其他環境回 typed unsupported。

helper 回傳穩定的 native AX element handle、editable／secure／role 能力、選取 range 與指定範圍文字。PID、role、bounds 或文字 hash 單獨不構成可靠欄位身份。無穩定 identity、未正確認證非 secure 或無法受限讀取時，不讀文字。

context capture 在 ASR 完成、即將組裝潤稿 request 時讀取目前欄位，符合既有 current-target 語意。文字最多 200 個 Unicode code points，按 selected 60／before 70／after 70 分配；未使用配額可重新分配，總量不超過 200。每次 capture 有 250 ms deadline，consume 前 snapshot 最長 2 秒；consume 時再次核對欄位 identity。此 deadline／大小是初始工程限制，未代表實測延遲。

ContextManager 對 renderer 只回 opaque handle、固定 status 和字符數。raw context 留在 main memory，包進 inference request 後清除 snapshot；provider in-flight request 的暫時內容依現有 lifecycle 回收，不保存至 settings／history／一般 log。helper response 上限 64 KiB，錯誤映射固定 codes，禁止原樣記錄 stderr 或 response。

status 至少包含 `off / available / secure_field / denied_app / permission_denied / unsupported / timeout / focus_changed / expired / omitted_budget / protocol_error`。可选 context 不可用時，明示原因並沿用已有 transcript-only 潤稿；這是已定義的可選功能契約，不是把捕捉失敗記成成功。關閉 context／AI 後不再啟動讀取。

使用 App denylist 與 positive field capability 判定，先判定再讀值；禁止 own-app、secure／password、noneditable 欄位。拒絕未知 role 的讀取，不能退回整個 window 或桌面。

### 4. 預算與 prompt 邊界明確

仍使用原始已保存 instruction、獨立 profile policy、固定 transcript data block，以及經 escape／serialization 的 context data block。context 是待參考資料，不能覆蓋 instruction、執行命令、回答 transcript 問題或提供缺少的事實。

500 字 transcript 上限、`num_ctx:2048`、timeout 及模型選擇不變。先用既有完整 instruction＋profile＋messages 實測剩餘 budget；只在已驗證剩餘範圍內加入 optional context。context 不足配額時標 omitted_budget／truncated_context；不得截斷 transcript、覆寫使用者 prompt、擴大 num_ctx 或換模型。無法判定自訂 instruction 的剩餘 budget 時省略 optional context，保留原 provider 技術成功／失敗處理；不宣稱目前已有自訂 prompt token-limit validator。

針對指定測試 model／digest 建立至少 32 組繁中、中英混用、數字日期、否定、自我修正、人名品牌、同音歧義及 context 注入語料。測試驗證 context on/off 的差異；runtime 仍遵循現有 technical validity contract，沒有加入全面的語意攔截器。模型品質未通過時不得宣稱這組 model 已完成新情境能力驗收。

### 5. 學習是獨立的 opt-in 本機觀察

`local_correction_learning_enabled` 預設 false；不依赖 AI 潤稿開關，也不需要網路。在自動貼上啟用時，對原有 paste call 增加唯讀觀察掛點：

1. 在現有 paste 之前保存可編輯欄位 identity、range 及 bounded anchors，最多等待 250 ms。
2. 原有 paste／Enter 行為保持不變。命令完成後，另外讀取受限範圍，確認本次文字在同一欄位內有唯一可定位的插入 span。
3. 只有 mapping 成立才開始最多 15 秒的 observation；每 250 ms 可讀一次，不允許前一次未完成就發起下一次讀取。
4. learning span 最大 500 code points、兩側 anchors 各最多 50；不得全欄位掃描。過長、重複文字無法唯一定位、range 不可靠、輸入未出現或 App 不支援時，回明確狀態而不追蹤。
5. 換 App／欄位、下一次錄音、關閉開關、secure／denylist 或 deadline 到達立即停止並清除 snapshot。

read-back 只決定此功能可否學習，不更改一般貼上成功定義、不阻擋 Enter，也不冒稱所有輸出已確認。這是第 4 項功能必要的範圍證明，不是第 1 項輸出交易重構。

用本機 deterministic diff 只產生插入 span 內單一詞替換候選，原詞與新詞各 2–40 code points。數字／日期、跨段、多處修改、純刪除、整段重寫不學習。禁止呼叫 LLM／`/user/traits` 或從外部欄位長期學風格。

### 6. 候選與 App 範圍規則使用獨立 settings store

- `correction_learning_v1`：版本化 settings JSON，queue 最多 100 records、14 日有效，包含 pending／dismissed 等短期候選狀態；只存候選詞對、固定 state／source、opaque ID、scope bundle ID、count／timestamps。不能保存外部文稿、插入全文或 context。核准後 active rule 與必要 undo 資料另存，不受此 queue 到期清理影響。
- `scoped_dictionary_rules_v1`：完整保存 App 規則的 ID、original、replacement、enabled、scope bundle ID、source、revision 及必要 undo 狀態。App 規則不建立 legacy dictionary row；無有效 scope 的 JSON 規則不能轉為 global。
- UI「待學習」提供核准、忽略、撤回。被動候選預設當次 App 範圍，核准時可明確改為 global；待核准候選不影響辨識／替換。
- 核准在同一 SQLite transaction 保存候選狀態，以及 App JSON rule 或明確 global 選項的既有 dictionary CRUD／undo metadata；錯誤 rollback 並顯示。
- 字典 UI 合併 global rows 與 App rules；內部以來源及 ID 區分 CRUD，不能把 App rule 當成 legacy row。套用時先依 trusted bundle ID 篩選 App rules，再沿用長詞優先；相同 original 的匹配 App rule 優先於 global，不能把兩者串接成二次替換。沒有匹配 App rule 的舊 global 規則保留原契約。
- 取不到 bundle ID 或 App store 無效時，只套有效 global，顯示 App 規則不可用；不得擴成 global。跨 App 的相同詞可有不同規則；同範圍重複／衝突必須明示，不靜默蓋掉。
- App 範圍指本次 ASR 後字典替換取得並凍結的 App 情境，不是貼上目的地鎖定。UI 顯示本次採用的詞庫情境；AI 等待期間切換 App 不重新套另一個詞庫或再呼叫模型，仍依既有 current-cursor 輸出。下一次辨識重新取得 App 情境。此時點須有 focus-change scenario，不能承諾已解決一般貼上競態。
- Undo 保存來源、rule ID、核准前值與核准 revision。只有目前完整 rule 與 revision 仍相符時才還原或移除該次新增；後續修改時回 conflict，不覆蓋新內容。active App rule 與必要 undo 狀態不受 pending queue 100 筆／14 日限制；刪 rule 時一併清理其 undo binding。
- 新版 JSON 字典匯出保存完整 scope；原有 CSV 格式只匯出 legacy global rows，明示排除 App 規則數量。舊 CSV 匯入仍為 global；無效 scoped JSON 不得匯入成 global。
- 既有面板手動點字改錯仍依原契約立即記入 global 字典；新開關只控制外部被動觀察。停用 learning 不停用已核准規則，清除 pending 不刪已核准字典。

獨立 App JSON rules 避免 scope metadata 缺失時把新 row 當成 global，也讓舊版直接忽略新規則。較大量多裝置詞庫或全文個人化不在 2.1.0；category 保留原分類用途。

### 7. 延遲資料嚴格白名單與明確時鐘

LatencyManager 使用 local bounded ring buffer，最多 1,000 sessions／7 日，預設啟用，可停用、清除與使用者手動匯出。資料白名單只包含 duration、隨機 correlation ID、固定 stage／outcome／mode／provider／cold-warm enum 與數量；不含 transcript、context、字典詞、audio、App／window／URL、任意 model 字串、原始 error message、hostname 或 secret。

每個 process 使用自身 monotonic clock 計算 duration，IPC 只傳 duration 與固定 marker，不跨 process 相減 performance.now。main 的 hotkey-received→capture-ready-ack 是含 IPC 的觀測區間；renderer 的 stop→paste-command-ack 是同 renderer 的區間。metric 的名稱與畫面說明必須反映量到的是派送命令，不是實際接收。

P50／P95 採 nearest-rank，僅成功且完整的 finite duration 入分位數；failed／cancelled／skipped／missing 獨立計數。缺測以 null/status 呈現，不寫 0；未滿 30 筆顯示樣本不足。重複 paste skip 不產生假的成功 output duration。新錄音模式、provider 與 cold/warm 分群，不能混成一個模型速度排名。

至少 30 組相同 workload 的 instrumentation off/on paired trials，記錄硬體、runtime／model digest 與設定至另存的測試報告。量測工具自身的 P95 額外成本預算為 `max(10ms, off P95 × 2%)`；这是驗收預算，未表示已達成。context／learning 額外成本分開報告，不能算成 instrumentation 成本或以不同輸入比較。

## Risks / Trade-offs

- [App 的 AX identity／range 不可靠] → typed unsupported，不使用猜測身份或全文／剪貼簿模擬 copy 作替代。
- [周邊文字擴大資料範圍] → 預設關閉、本機 Ollama 限制、positive field gate、denylist、bounded memory，禁止 log／telemetry／persist。
- [200 字 context 仍超出模型 budget] → 以指定 model 實測，只加已驗證的剩餘配額，保留 transcript 與原 request limits。
- [改錯差異不一定代表專有名詞] → 單一小幅 diff、排除數字等範圍、使用者核准、App scope、可撤回／衝突處理。
- [候選狀態與核准規則不一致] → 同一 DB transaction、完整 scoped rules、revision check、fixture 覆蓋 rollback／legacy global／rule 刪除。
- [小樣本或時鐘起點不同形成假的性能結論] → process-local duration、完整 marker、明確缺測、nearest-rank、n≥30 與 paired trial。
- [新增 helper 的簽章／封裝破壞權限] → 開發及封裝各驗證；新 native code 不自動代表已獲 TCC 授權，實機驗收時遵守唯一 `/Applications/SpeakSlow.app` 規則。

## Migration Plan

此 change 不做 DB schema migration。現有 settings 缺少新 keys 時採 neutral／context off／learning off；metrics 為 content-free local on。App 規則獨立存在版本化 settings JSON，舊 dictionary rows 保留原 global 行為。

本次 package／lockfile 進版至 2.1.0，README 明示開發規劃。實作、合併、tag、正式分發與安裝另按當次授權執行。實作部署前用隔離 fixture 驗證 metadata transaction 與 backward compatibility；不得在規劃階段改真實使用者 SQLite。

回退程式版本前先停用 context／learning。舊版忽略 scoped JSON，不會把 App 規則套成 global；新版本明確核准的 global rows 仍按舊契約運作。回退會失去 App 規則的使用介面，須在版本說明標明；不得刪除仍可回新版使用的 settings 資料。

## Open Questions

- TextEdit、Chromium contenteditable 與宣告支援的其他 App，能否在 lifetime 內提供穩定 AX element identity 與 bounded range？先做 protocol spike，不能以 symbols 或 mock 宣稱支持。
- 指定本機 model 對 profile＋context 的剩餘 token budget、數字／否定／專名品質，以及 cold/warm latency？由語料與 paired benchmark 決定。
- helper 簽章與 release packaging 在目標 macOS／arch 是否可重用現有 build 工具？實作時以實際 artifact 驗證。

以上是實作階段需產生的證據，不阻擋目前規劃 ready，也不作為已完成的功能宣稱。

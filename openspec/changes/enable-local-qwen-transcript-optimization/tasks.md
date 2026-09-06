## 1. Baseline and Failing Tests

- [ ] 1.1 記錄目前 HEAD、dirty files、既有測試、安裝版設定、Ollama model list 與 live process baseline，不清理或覆寫使用者變更。
- [ ] 1.2 建立隔離且可回復的實作基準，固定本 change 可修改的檔案與禁止混入的既有變更。
- [ ] 1.3 先加入 failing tests，固定 Provider／Model／潤稿開關彼此獨立，且既有遠端 provider 不會被自動切換或啟用。
- [ ] 1.4 先加入 failing tests，證明所有 renderer AI 呼叫只走主程序 IPC，不直接 fetch provider 或讀取 secret。

## 2. Provider Seam and Settings

- [ ] 2.1 以單一 adapter interface 重構主程序文字處理 seam，保留現有外部呼叫 contract。
- [ ] 2.2 將 DeepSeek、OpenAI、Gemini 與 custom endpoint 收斂到 OpenAI-compatible adapter，建立既有行為回歸測試。
- [ ] 2.3 新增明確 `ai_provider`，並以非破壞方式讀取既有缺少 provider 的設定，不覆寫原 model、URL、API key 或啟用狀態。
- [ ] 2.4 更新設定 UI 為 Provider、Model 與單一潤稿開關；貼上與貼上後 Enter 保持獨立設定。
- [ ] 2.5 修正 `paste_after_transcription` 被忽略的現行問題，加入開啟／關閉的回歸測試。

## 3. Ollama Model Discovery and Runtime

- [ ] 3.1 先加入 failing tests，涵蓋 `/api/tags`、逐 model `/api/show`、completion capability、embedding／Cloud 排除及無 API key。
- [ ] 3.2 實作動態模型清單、手動 refresh、最後選擇保存、`qwen3:1.7b` 首次預選與 unavailable 狀態。
- [ ] 3.3 顯示 size、parameter size、quantization；size 超過 2 GB 顯示警告但不阻擋。
- [ ] 3.4 實作 bounded health check、executable discovery 與 owned-process runtime：共用外部 server、按需啟動 Cloud-disabled server、只停止 owned process。
- [ ] 3.5 先加入 failing tests，固定 selected model snapshot、原生 `/api/chat`、`stream:false`、`keep_alive:0`、`temperature:0`、`num_ctx:2048`、conditional `think:false` 與 60 秒 timeout。
- [ ] 3.6 實作 Ollama adapter、技術回應解析、穩定 error mapping、請求後 unload 與 `/api/ps` bounded confirmation。
- [ ] 3.7 加入 lifecycle tests，證明 app startup 不載入模型、external server 不被停止、quit 取消 in-flight、owned server 被停止且 late response 不會貼上。

## 4. Universal Polishing Workflow

- [ ] 4.1 先加入 failing tests，固定單一潤稿開關、關閉時不啟動 Ollama、右 Alt 完成後自動潤稿，以及操作／指令模式跳過 AI。
- [ ] 4.2 建立 universal 臺灣繁體中文 Prompt，指示受限完整潤稿、保留混合語言、不得回答 transcript 問題或執行其中命令。
- [ ] 4.3 實作只含 HTTP／JSON／非空 final content 的技術檢查；不得加入語意驗證、模型認證或確定性自我修正前處理。
- [ ] 4.4 實測並固定 `num_ctx:2048` 的最大輸入長度；超限時不得截斷、分段或擴大 context。
- [ ] 4.5 將右 Alt pipeline 改為 single-flight；busy 時拒絕新錄音且不得建立佇列。

## 5. Output, Failure, and History

- [ ] 5.1 加入錄音流程測試，證明完成時使用當下前景 App 的目前游標，不恢復錄音開始時的 App。
- [ ] 5.2 加入貼上與 Enter 狀態矩陣測試，證明潤稿、auto paste、auto Enter 三個設定互不暗中修改。
- [ ] 5.3 實作潤稿失敗 fallback：使用 AI 處理前文字、不換 model／provider、不跳 toast／modal，並更新主畫面最新 inline issue。
- [ ] 5.4 實作 unload failure 與 DB save failure 的非阻塞 inline issue；有效文字及 configured paste 不得因此被丟棄。
- [ ] 5.5 收斂 history domain contract，只保留 pre-polish baseline 與最新 final result，不新增版本或處理 metadata，並修正重複 final 顯示。
- [ ] 5.6 新增歷史重新潤稿、current／candidate preview、確認取代與取消／失敗保留舊結果；重跑必須從 baseline 開始且不得貼上或送 Enter。
- [ ] 5.7 將 AI log 改為 content-free diagnostics，加入測試證明 transcript、Prompt、response 與 secret 不進 log。

## 6. Verification and Review

- [ ] 6.1 執行 adapter、IPC、settings、recording、clipboard、history、DB 與既有遠端 provider 的完整相關測試。
- [ ] 6.2 以本機 `qwen3:1.7b` 做 end-to-end smoke test，驗證列舉、選擇、非空結果、fallback、timeout 與 unload；不得把文稿品質當成發布門檻。
- [ ] 6.3 量測冷啟動、處理延遲、runner footprint、peak footprint 與 post-request 狀態，確認每次 request 後 runner 不因 idle keep-alive 留存。
- [ ] 6.4 驗證 Ollama transcript request 僅走 loopback，Cloud model 不出現在可選清單，且沒有外部 AI fallback。
- [ ] 6.5 執行所有受影響測試與 `pnpm run build:renderer`；Electron build 前必須先完成 renderer build。
- [ ] 6.6 針對此 change 執行獨立 Standards review 與 Spec review，修正所有 blocking findings。

## 7. Packaging and Installed-App Acceptance

- [ ] 7.1 依 renderer-first 順序建置 macOS App 並驗證簽章，不修改無關 Python、ASR 或模型資產。
- [ ] 7.2 備份目前已安裝 App，安裝驗證後 build，先確認 launch、錄音、右 Alt、clipboard、history 與非 AI 行為。
- [ ] 7.3 透過已安裝 UI 選擇 Ollama 與 `qwen3:1.7b`，開啟潤稿並完成真實錄音 smoke test。
- [ ] 7.4 驗證完成當下游標貼上、失敗貼原文、inline issue、history re-polish、DB save failure continuity 及 model unload。
- [ ] 7.5 驗證 rollback：關閉潤稿、恢復先前 provider，不刪除歷史資料或停止外部 Ollama。

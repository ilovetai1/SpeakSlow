# 2.1.0 開發版驗證紀錄（2026-10-13–14）

這是開發版實作與部分實機驗證，不是正式發布驗收。測試資料均為合成語料或隔離資料庫；沒有對真實使用者 DB 執行測試或 migration。

## 自動、打包與安裝

- Node regression：105 passed／2 Electron ABI skips（107 total、0 failed）。兩項 skips 另外以安裝後 Electron ABI 125 runtime 執行，2/2 通過。保留既有貼上／Enter、single-flight、history、indicator 與 provider tests。
- Headless Chrome：profile mapping、default-off context／learning、default-on metrics、候選 App 核准／dismiss／undo、clear／export 通過。這不是 Chromium 原生 AX 驗收。
- Electron ABI 125：隔離 SQLite 確認 transaction rollback、App rule 無 legacy row、重建 manager 可讀規則、global undo conflict 不覆寫、history baseline/final contract。
- `npm run build:renderer`、ARM64 `electron-builder --mac --dir --arm64`、OpenSpec strict validation、既有 Python syntax 通過。未改 Python 邏輯。
- 使用本機既有 Apple Development identity 簽章：105 Mach-O、9 nested bundles，再簽 root；`codesign --verify --deep --strict` 通過。root designated requirement 與既有安裝一致。直接替換 `/Applications/SpeakSlow.app`，Info.plist 版本 2.1.0；`/Applications` 只有這一份，沒有 backup／old App。
- 安裝後 packaged helper 回 available metadata；兩項 packaged DB tests 通過。正常 GUI About 回讀 `SpeakSlow Version 2.1.0 (2.1.0)`，原有歷史統計維持 1,272 筆／51,879 字。本機開發簽章不代表 Developer ID 簽章、公證、正式 Release 或其他電腦首次安裝驗證。

## 本機模型語料

使用 `qwen3:1.7b`，digest `8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7`，num_ctx 2048，timeout 60 秒。校準三個空 messages 的 prompt_eval_count 是 16，framing allowance 48 tokens，另保留 512 output tokens。固定原文上限 500 code points。

32 組 off/on（64 requests）全部取得有效文字；關鍵字／數字／日期／否定檢查 off 32/32、on 32/32。兩個注入案例未輸出指定攻擊標記。context 實際加入 27 組；5 組因保守預算省略，维持 transcript-only。

這些檢查只證明指定字串保留，不證明整體語意品質或所有注入安全。此小模型多數輸出接近原逐字稿，沒有穩定顯示格式／自我修正改善；不宣稱準確率提升。第一輪曾有 1 組輸出參考前文取代逐字稿，調整 context message 在前、逐字稿在最後後，最終 corpus 重跑通過。

context 實際加入的 27 組順序 off→on，模型 request 差值 P50 31.96 ms、P95 57.58 ms，包含模型暖機、cache 及 tags request。reader 是 synthetic fixture；不能視為 AX 成本或速度改善。

## TextEdit 真實 AX 與改錯

使用受控合成文件、安裝後 helper、隔離 SQLite。

- 同一 AX element capture／validate 回 available；denylist 回 denied_app。700 code points 文件只回 before 70／selected 60／after 70，合計 200；沒有全文讀取。
- 快照立即 consume 回 available；等待 2,100 ms 後回 expired。capture/consume deadline 250 ms 保持不變。
- 30 組交錯 context off/on，所有 off 回 off、on 回 available。最新安裝後測量（含一次平行 metadata smoke）on P95 8.523 ms，差值 P95 8.494 ms；前一次穩定前景測量差值 P95 1.470 ms。只報新增讀取成本，不比較整體錄音速度。沒有麥克風或模型。
- 插入「台灣」後改「臺灣」產生候選；核准前不改輸出，App 核准後套用，撤回恢復。重複文字文件只辨識本次插入範圍，其他相同詞不被當作改錯。
- Enter 換行／清欄後停止，候選不增加；超過 500 code points 不開始 observer；learning off 不觀察。換到另一份 TextEdit 文件回 focus_changed 並停止，候選不增加。
- 真實 AX replies 人工延遲 400 ms，最多只有 1 個 observer request；pending request 期間停止並回 recording_started，晚到結果不增加候選。停止事件注入 manager；不是重建整個新錄音流程。
- 少量 prepare 測量 n=7，約 2.2–52.2 ms，包含冷啟動／測試延遲；inserted proof 1 次約 2.15 ms。樣本不足 30，不作穩定 learning 成本結論。

實機測試找到 helper main thread 的阻塞 stdin 使 NSWorkspace 前景快取不更新。改為 background stdin queue、main run loop 處理 AX 後，App 切換及後續錄音 pilot 成功。helper 仍只有唯讀操作。

## 真實錄音 instrumentation 邊界

1 組 pilot 經內建麥克風、既有 hotkey IPC、ASR、隔離 SQLite、真實 paste command 與 bounded read-back。off/on 均收到文字、保留合成關鍵字，字數均 16；stop→paste command off 916.786 ms、on 597.793 ms。n=1，不計性能百分位、不宣稱通過 overhead budget 或速度改善。

完整計畫預先指定 31 組、第一組暖機排除、分析剩餘 30 組交錯配對。此次第一個 off 錄音因無有效 ASR 結果而 timeout，完成 0 組。CoreAudio 唯讀檢查確認預設輸出內建揚聲器 muted=true，ASR 回純靜音／噪音。系統音量未更改；解除靜音前不能完成此硬體路徑。

另有 30 組 process-local timer fixture，off P95 11.259 ms、差值 P95 1.323 ms、fixture budget 10.000 ms、排除 0 組。此 fixture 使用 in-memory settings，沒有麥克風／IPC／SQLite／真實貼上，不能代替完整錄音工程門檻。fixed-schema content-free export 已驗證，不含文字、App、模型名稱與 wall-clock origin。

## 未完成與重現

OpenSpec 39/43 完成。2.3／6.4 的 Chromium 原生欄位驗收由使用者暫緩；secure／noneditable 仍只有 protocol fixtures。1.8／6.5 的完整錄音 30 組配對受靜音阻擋，保持未完成。不能以成功安裝、commit／push、模型 request 或 synthetic timer 宣稱整體验收完成。

合成語料：`test/fixtures/evolution-corpus.json`。模型腳本：`scripts/benchmark-evolution.mjs <isolated-result-dir>`，要求該目錄先保存預算校準結果。實機 runner 與隔離啟動方法見 `EVOLUTION_2_1_0_IMPLEMENTATION.md`。

local scratch `.local/evolution-2.1.0/` 由 repo-local exclude 排除，保存 corpus、timer／AX pairs、freshness、pilot／failed physical pairs、content-free export、build/sign/test logs。隔離 DB 含合成逐字稿、音檔為固定合成短句，未提交這些 scratch 資料。tracked 摘要只記錄測試範圍、狀態與成本。

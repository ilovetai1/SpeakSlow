# SpeakSlow 2.1.0 開發版實作

本版實作 Typeless 評估的第 3、4、6 項：寫作情境、本機改錯學習、延遲觀測。已以 Apple Development 簽章安裝至本機 `/Applications/SpeakSlow.app`。維持開發版；完整實機驗收與正式發佈尚未完成。

## 使用方式

設定 →「寫作、學習與延遲」提供一般、訊息、郵件、筆記及依 App 設定。格式不會開啟 AI。手動格式優先於 App mapping。

情境潤稿預設關閉，只用於開啟 AI 的離線錄音、本機 Ollama、一般 optimize。先按「驗證本機模型的文字預算」。未知 tokenizer、模型 digest 改變、提示詞改變或預算不足時，顯示省略情境，沿用一般潤稿。遠端、串流、歷史重潤及語音指令不讀外部情境。支援未驗證的 App／欄位會顯示原因。

改錯學習預設關閉。貼上前後使用同一個唯讀 helper，只有欄位身分、插入位置、長度與兩側 anchors 都符合時才觀察，最多 15 秒。候選只接受單一字詞替換；數字、日期、換行、多處修改或不可靠定位不學習。先在設定或字典頁核准；預設建立該 App 的規則，可明示選全域。規則之後可在字典頁編輯、停用、刪除。撤回採完整值與 revision 比對，後續修改會產生 conflict。

App 詞庫在 ASR 完成、套用字典時決定；AI 等待中切換 App 不改該次詞庫，下一次重新讀取。貼上仍使用當時的游標，這不是貼上目的地鎖定。JSON 匯出包含 App scope；CSV 只有全域，並提示排除數。

延遲統計預設開啟，保存 7 日／1,000 次。不含文字、音訊、App、URL、模型名稱或原始時間戳。跨程序階段使用發起程序自己的 monotonic duration；不相減不同時鐘。P50/P95 是成功樣本 nearest rank；失敗、取消、略過與缺測分開，未滿 30 筆顯示樣本不足。「貼上命令完成」不代表目標欄位已收到文字。

## 實作邊界

- 原創 Swift helper 只提供 metadata、bounded range、同 AX element 驗證及 release。沒有全文 AXValue、視窗遍歷、OCR、輸入或 focus 操作。
- Capture 250 ms、快照 2 秒、protocol 64 KiB，情境最多 200 Unicode code points。metadata 啟動預熱最多 2 秒，不讀文字；文字讀取期限沒有放寬。
- Span 最多 500 code points，兩側各 50；AX ranges 使用 UTF-16 offsets。敏感／denylist／非 editable／自有 App 不讀文字。
- 原文上限 500 字、Ollama num_ctx 2048、60 秒 timeout 均保留。校準要求 GPT-2 byte alphabet 全部存在，實測三個空 message 的 framing token 數並加 32 margin，使用 UTF-8 bytes 作保守 content 上界；context request 另保留並限制 512 output tokens。無法證明預算即省略，原文不截斷，也不換模型。
- Raw context 與 observer span 只在 main/helper 記憶體，renderer 只收到 opaque handle／狀態。候選只保存詞對及 decision metadata。
- App rule 完整存於版本化 setting，沒有對應全域 dictionary row；舊版本只讀既有全域 rows。沒有真實使用者 DB migration。
- 不增加評估第 1、2、5 項的貼上重構、錄音狀態機或歷史救援。

## 已測與待驗收

已測：105 項 Node regression、headless Chrome 設定頁、2 項安裝後 Electron ABI 125 SQLite tests、ARM64 renderer／開發包／完整開發簽章。TextEdit 真實 bounded AX、30 組 context off/on、候選 App 核准／撤回、換文件／Enter／重複詞／慢回應與停止後 late result 通過。實機測試發現 NSWorkspace 的 foreground cache 因 main thread 阻塞而過期；helper 改為 background stdin＋main run loop 後，App 切換與完整錄音 pilot 通過。

待驗收：Chromium secure／read-only／換欄由使用者暫緩；完整麥克風／IPC／SQLite／貼上 30 組配對因內建揚聲器靜音未完成。只有 1 組有效真實錄音 pilot，不宣稱整體性能門檻通過。詳見 `EVOLUTION_2_1_0_VALIDATION.md`。其他平台讀取回 unsupported；本機 Apple Development 簽章不代表 Developer ID 簽章、公證或同仁電腦首次安裝通過。

開發命令：`npm run build:context`、`npm run build:renderer`、`node --test test/*.test.js`。SQLite 使用 Electron ABI 125，在 `ELECTRON_RUN_AS_NODE=1` 下執行 `test/correction-sqlite.test.js` 與 `test/transcription-database-contract.test.js`；測試自建臨時資料庫。不得對使用者資料庫跑測試。

## 隔離實機驗收與本機簽章

`--acceptance-data-dir=/absolute/isolated-directory` 只供明示啟動的本機驗收，DB／設定／log 另存該目錄，正常啟動路徑不變。不得使用正常 Application Support 目錄或其 symlink。`--acceptance-plan=/absolute/plan.json` 可自動播放指定的合成音訊，經既有錄音 IPC、真實預設麥克風與 ASR 後貼至 TextEdit，使用 bounded range 驗證收到文字。此模式不更改系統音量，不接受 fake ASR。測試時必須保持受控欄位前景，不編輯真實文件。

Plan 欄位：`targetBundle`、`pairs`（1–50）、`audioFile`（本機絕對路徑）、`requiredWords`（合成關鍵字）、`fixtureMarker`。off/on 順序逐組交錯。若預先指定暖機排除，須在最終分析另外排除；runner 本身不處理額外 `warmupPairs` 欄位。保存的 performance result 只含 duration、status、文字收到／關鍵字保留 boolean 及字數。隔離 DB 仍含合成逐字稿，不能將整個驗收資料夾當作無內容匯出。

Renderer 必須先建置，再打包。`node scripts/sign-mac-development.mjs /absolute/staged/SpeakSlow.app <local-identity-hash>` 使用既有本機 identity 簽所有 Mach-O、nested bundles 與 root，並做 deep strict verify。更新時停止舊 App 及測試程序，直接替換 `/Applications/SpeakSlow.app`，不得留下備份 App。此腳本不公證、不匯出憑證、不保存密碼。

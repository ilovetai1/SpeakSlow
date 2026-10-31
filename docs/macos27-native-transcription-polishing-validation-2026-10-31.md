# macOS 27 原生轉錄與潤稿：實作與驗證紀錄

日期：2026-10-31

## 結論

- 已確認：Mac 產品路徑已改為 macOS 27、arm64、Apple Speech-only。Windows／Linux 保留 Sherpa。
- 已確認：`apple_on_device` 使用 `SystemLanguageModel.default`、`zh-TW`、新 session、native token preflight 與固定錯誤，不讀 API key／URL，也不切換到 HTTP、Ollama、PCC 或 `fm`。
- 已確認：本機實際模型為 `core_advanced3`（AFM 3 Core Advanced），context 8192，語系 `zh-TW`。
- 已確認：目前 Apple 潤稿品質 gate **未通過**。潤稿維持預設關閉，不能自動啟用。
- `unverified`：macOS 26.0–26.3、26.4 的同硬體配對比較。公開 API 不能在 macOS 27 鎖回舊系統模型。
- `unverified`：固定 Ollama digest 配對。本機 Ollama 已安裝，但查無已安裝模型；檢查後由測試啟動的 server 已停止。
- 已確認：候選版已安裝至唯一的 `/Applications/SpeakSlow.app`，完成啟動、乾淨重啟、Apple Speech readiness 與 Apple 本機 provider 顯示驗證。
- 未完成：實體麥克風、首次權限、目標欄位 read-back、Developer ID／公證、正式發布。

## 已實作範圍

- macOS 27 deployment target 與 arm64 helpers／package metadata。
- Mac 缺值或 legacy `asr_engine=sherpa` 的 fail-closed Apple migration；未知值與寫入失敗不啟動 ASR。
- 一般錄音、快捷鍵／迷你視窗、Apple preview、command input、TXT／SRT 檔案、歷史重新辨識皆由同一 Apple coordinator 鎖定 profile。
- Apple Foundation Models JSONL v1 helper、single-flight manager、60 秒 deadline、取消、crash recovery、輸入／輸出界線與內容不進 log。
- Provider registry、Apple readiness IPC、無 key／URL 設定 UI、新 Mac 預選 Apple provider但不開啟潤稿。
- TXT 檔案保留 raw baseline，提供潤稿預覽、明確採用及還原；SRT 不提供生成式全文改寫。
- 歷史重新潤稿候選由主程序持有，確認時驗證一次性 token、owner、record 與來源 revision；另一視窗改動、owner 結束、取消或重複確認都不能覆寫歷史。
- 一般與 custom AI IPC 會在 renderer 結束時取消工作；保存後才到達的取消會保留已完成寫入，但抑制後續輸出。

## 實際 runtime 證據

### Foundation Models helper

- Node protocol／lifecycle 專屬測試：14／14 通過。
- 真實 native synthetic integration：1／1 通過。
- 涵蓋：probe、native budget、輸出 token 上限拒絕、兩個獨立 session、取消、重試。
- helper：arm64 Mach-O、minOS 27.0、ad-hoc `codesign --verify --strict` 通過。

### Apple Speech helper

使用同一份 10.416 秒合成 WAV，實際跑 `accurate`、`responsive`、`dictation`，三者皆回傳非空結果。配對的 `accurate`／`dictation` 使用相同音訊 SHA-256，取消及重試通過。這是 native helper／coordinator 驗證，不是麥克風或打包 App 驗收。

證據：[current-native-speech-macos27.json](../evaluation/macos27/results/current-native-speech-macos27.json)

### 已安裝 App

- 使用 `npm run install:mac -- --identity -` 替換 `/Applications/SpeakSlow.app`；安裝器驗證來源、stage 與目的地簽章及內容雜湊後，刪除專案內建置用 `.app`。
- `/Applications` 與 Spotlight 均只找到 `/Applications/SpeakSlow.app`；專案目錄內沒有完整 `SpeakSlow.app`，DMG 保留。
- 已安裝版本為 2.1.0，`LSMinimumSystemVersion=27.0`；`apple-speech` 與 `apple-foundation-models` 都是 arm64。
- 主畫面首次啟動由「模型未就緒」進入可錄音狀態；設定頁顯示 Apple-only、`accurate` 與「已就緒」。AI 設定顯示 Apple（本機）選項，並保留既有 Ollama provider 及關閉中的潤稿開關。
- 正常 Quit 後，App 與兩個自有 helper 都退出；重新啟動後主畫面再次進入可錄音狀態，潤稿仍為關閉。
- 本次未啟動麥克風或跨 App 貼上，因此不把這些項目標示為通過。

## 潤稿品質 gate

目前資料為 5 個 tuning 與 10 個 holdout 文字案例，尚未達設計要求的 30 個配對情境與長音訊覆蓋；但已出現重大語意錯誤，因此現階段 gate 已確定失敗，不需等擴充資料後才阻擋自動啟用。

### 調校集

真實 `core_advanced3` 在已知金額／否定案例輸出：

> 這個費用是三萬，不是三千五百元，我們不要上線，等測試通過再說。

原意是更正為三千五百元。這是 critical semantic failure。調校集另觀察到 `merge` 被改為「合併」；不是 critical，但違反保留中英混用的要求。

證據：[current-tuning-macos27.json](../evaluation/macos27/results/current-tuning-macos27.json)

### Holdout

10 案例皆得到 terminal result，但有兩個 critical failure：

1. 長稿把 180 次輸入縮成 1 次，造成內容遺失。
2. 「負責人是雅婷不是是怡婷」輸出為「負責人是雅婷，不是怡婷」，反轉更正後姓名。

日期及英文版本字串也未轉成參考格式；列為非 critical assertion failure。

證據：[current-holdout-macos27.json](../evaluation/macos27/results/current-holdout-macos27.json)

## 建置與回歸

- 完整 serial Node／React 測試：249 項，239 pass、0 fail、10 skip。skip 包含需要明確 native fixture 或 Electron ABI 的測試；本紀錄另外明確執行 Foundation Models、offline sandbox 及 Apple Speech native 測試。
- 新 Mac／既有設定的真 SQLite 測試另以 Electron ABI 執行：5／5 通過，使用隔離暫存資料庫，未讀寫使用者資料。
- Renderer：Vite 1,689 modules build 通過。
- Backend：PyInstaller arm64 build 通過；本機 `.venv` 實際為 Python 3.12.13，尚未補 CI 指定的 Python 3.11 同版證據。
- OpenSpec strict validation 與 `git diff --check` 通過。
- ESLint 未執行程式檢查：專案既有 ESLint 9 缺少 `eslint.config.js`，命令在載入設定前失敗。
- arm64 App 與 DMG 已建立。候選 App 經開發用 ad-hoc 簽章，`codesign --verify --deep --strict` 通過；DMG 內 App 也通過。
- DMG：`dist/SpeakSlow-arm64.dmg`，SHA-256 `0b27a3fcf57d019b95bb8c681ffb06c533fb1bc8c8415469004f38760534dd34`。
- App `LSMinimumSystemVersion=27.0`。封裝的 `apple-speech` 與 `apple-foundation-models` 均為 arm64、minOS 27.0；Foundation helper 在封裝路徑完成 JSONL v1 handshake／probe，回報 `core_advanced3`、8192、`zh-TW`。
- build artifact 與已安裝 App 的簽章、內容及啟動已驗證；不等同實體麥克風、跨 App 收字或正式發行驗收。

## 隱私與限制

- Apple adapter／manager／Swift helper 原始碼路徑未使用 HTTP、Ollama、`fm`、API key 或 base URL。
- 評估 runner 的 Node outbound hook 記錄 0 次 Apple fetch，且使用 no-op logger，不寫產品 log。
- 真實 helper 在 `sandbox-exec` 的 `(deny network*)` 規則下完成 probe 與生成；回報 `core_advanced3`、8192 context、`zh-TW`，測試 1／1 通過。
- 專屬測試以 sentinel 掃描 adapter、manager、Swift stderr 與結構化 log，未發現 prompt／transcript／response 被記錄。
- 以上不等同全系統封包擷取，也不證明既有產品所有 log 已完成隱私稽核。安裝版離線驗收仍未完成。

## 尚未通過的 gate

- macOS 26／26.4 的來源完整配對結果。
- 固定 Ollama model digest 的配對結果。
- 自動潤稿 enablement；目前被 critical semantic failures 阻擋。
- 真人麥克風、首次權限與跨 App read-back。
- Developer ID、notarization、tag 與 release；來源 commit／push 狀態由 Git 歷史另行記錄。

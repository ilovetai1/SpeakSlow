# SpeakSlow 體積評估與 Apple 官方指引

查核日期：2026-10-18（Asia/Taipei）。本次為原始碼、安裝產物與官方文件調查；未修改產品程式、打包設定或已安裝 App。

## 結論

有瘦身空間。先保留雙引擎與既有離線功能，清除重複依賴及展示資源；再處理字型。若接受首次下載模型或提供 Apple 專版，才能減少數百 MiB。單改 Swift 編譯選項的效益很小。

以下容量基準是目前 [SpeakSlow.app](/Applications/SpeakSlow.app) 2.1.0 的實測值。節省量是候選檔案量或工程估算，尚無瘦身建置與功能驗收結果。`1 MiB = 1,048,576 bytes`。

## 已確認：目前容量

原始盤點：[APP_SIZE_INVENTORY_2026-10-18.json](/Users/chunghan/AI/SpeakSlow/docs/research/APP_SIZE_INVENTORY_2026-10-18.json)。查核原始碼 HEAD 為 `61494706c1ad`；四個主要程式檔與安裝 App 的 ASAR 內容逐位元組相同，但這不代表整個 App 與 checkout 所有檔案完全相同。

| 組成 | 磁碟配置量 MiB | 說明 |
| --- | ---: | --- |
| Sherpa 模型 | 388.66 | Paraformer 233.79、small 78.19、INT8 標點 76.06、VAD 0.62；包含少量模型附帶檔 |
| Python／Sherpa 執行環境 | 101.52 | `_internal` 96.46，加上 `sherpa_server` 5.05 |
| Electron 與其他 Frameworks | 224.44 | 其中 Electron Framework 約 223.21 |
| `app.asar` | 79.61 | 前端、資源、JavaScript 相依套件及封存檔索引 |
| `app.asar.unpacked` | 12.88 | SQLite、熱鍵原生模組與少量 Python 原始檔等 |
| 兩個 Swift helper | 0.37 | `apple-speech` 與 `context-reader` |
| 其他 | 0.49 | 圖示、簽章、plist 等 |
| **總計** | **807.96** | 約 847 MB（十進位）；檔案邏輯大小另為 806.68 MiB |

數值來自 `du -sk` 與一般檔案 `lstat` 的 `size`／`blocks × 512`；不追蹤符號連結，不重複計入 Framework 的連結路徑。此表不含使用者錄音、歷史、Ollama 或 Apple 系統模型。

目前產物是 PyInstaller 的 Python 3.12 後端與 Sherpa ONNX。專案 [AGENTS.md](/Users/chunghan/AI/SpeakSlow/AGENTS.md:101) 對 FunASR、PyTorch、Python 3.11.6、約 1 GB+ 執行環境的描述不能直接當成本版容量證據；本版 `_internal` 未見 torch／torchaudio。

## 已確認：可處理的來源

### 1. 前端已 bundle，仍額外攜帶整份套件

[package.json:105](/Users/chunghan/AI/SpeakSlow/package.json:105) 起的收錄規則 同時收錄 `src/dist` 與 production `node_modules`。ASAR 內可見已 bundle 的 React、Lucide 程式，以及另一份完整原始套件：

| ASAR 中的套件 | 邏輯大小 MiB |
| --- | ---: |
| `lucide-react` | 22.49 |
| `react-dom` | 6.98 |
| 已盤點的 renderer 套件群 | 32.94 |
| 全部套件內的 `.map` | 20.04 |

最後兩列互相重疊，不能相加。[vite.config.js:20](/Users/chunghan/AI/SpeakSlow/src/vite.config.js:20) 已啟用 minify 與正式版 bundle；目前最大的來源不是缺少 JavaScript 壓縮。

工程建議：將只在 renderer 建置時使用的套件移至建置依賴，或用明確排除規則；另外排除不需隨產品交付的 source maps。必須保留主程序使用的 `opencc-js`、`better-sqlite3`、`uiohook-napi`、`dotenv`、`osascript` 與其實際相依。僅刪除 `files` 的 `node_modules/**/*` 這一行不足以解決：electron-builder 仍自動收錄 production dependencies。[electron-builder 官方說明](https://www.electron.build/v26/docs/configuration/)

### 2. 展示與製圖資源重複收錄

`assets` 和 `src/dist` 內有 5.33 MiB 完全相同的檔案，包括兩份各 3.63 MiB 的 `demo.gif`、製圖腳本及 logo-build 中間產物。[vite.config.js](/Users/chunghan/AI/SpeakSlow/src/vite.config.js:98) 的 `publicDir: '../assets'` 會複製資源，而 [package.json:115](/Users/chunghan/AI/SpeakSlow/package.json:115) 又收錄原始資源目錄。

工程建議：分開 App 所需圖示與 README／網站展示／製圖輸入，使用打包 allowlist。介面仍引用 `./icon.png`（[App.jsx:1465](/Users/chunghan/AI/SpeakSlow/src/App.jsx:1465)、[settings.jsx:1861](/Users/chunghan/AI/SpeakSlow/src/settings.jsx:1861)），主程序也使用托盤圖示，不能整個刪除兩個資源目錄。

### 3. 兩份中文字型合計 26.35 MiB

- `GenWanMin2TC-M.otf`：21.66 MiB。
- `jf-openhuninn-2.1.ttf`：4.68 MiB。

[index.html:9](/Users/chunghan/AI/SpeakSlow/src/index.html:9) 與 [index.css:125](/Users/chunghan/AI/SpeakSlow/src/index.css:125) 載入完整字型；GenWan 目前主要供品牌名稱與副標使用。可先核對所有語系的固定品牌字串，為品牌字型製作子集，或評估 WOFF2。內容字型會顯示使用者輸入，不能只按目前 UI 文字裁切；缺字 fallback、字型授權與外觀仍需驗收。改用系統字型能移出字型檔，但會改變呈現。

### 4. Electron 語系有約 36.50 MiB 的條件式空間

實際資料位於 Electron Framework 的 `Versions/A/Resources/*.lproj`。保留 `en`、`en_GB`、`zh_CN`、`zh_TW` 的候選集合時，其餘語系的一般檔案配置量為 36.50 MiB。這會縮小系統對話框等可用語系，需依產品支援範圍決定。

重要版本差異：本機 electron-builder 是 **24.13.3**。其 `removeUnusedLanguagesIfNeeded` 僅處理最外層 `Contents/Resources/*.lproj`，這些目錄目前為空；不能宣稱只加 `electronLanguages` 就一定能省上述容量。需驗證所用版本，或在**簽章前的建置階段**精確處理 Framework 語系，再重新簽章與驗收。參考本機 [ElectronFramework.js:48](/Users/chunghan/AI/SpeakSlow/node_modules/app-builder-lib/out/electron/ElectronFramework.js:48) 與[官方選項定義](https://www.electron.build/v26/docs/configuration/#electronlanguages)。本次未實作。

### 5. 模型是最大宗，但已採 INT8

[package.json:125](/Users/chunghan/AI/SpeakSlow/package.json:125) 明確將模型整批放進 App。Paraformer 與標點實際使用 `model.int8.onnx`，所以「改成 INT8」不是尚未做過的主要機會（[sherpa_server.py:508](/Users/chunghan/AI/SpeakSlow/sherpa_server.py:508)、[739](/Users/chunghan/AI/SpeakSlow/sherpa_server.py:739)、[832](/Users/chunghan/AI/SpeakSlow/sherpa_server.py:832)）。

若改成第一次選用時下載，可從初始 App 移出約 388.66 MiB。下載後仍會占用使用者資料目錄，**不代表使用 Sherpa 的整機長期容量一定少同樣數字**。目前下載與模型檢查入口存在，但還要補齊所有必要模型、版本、完整性與冷啟動流程；不能只移除 `extraResources` 就交付。若只移出 small 模型，最多約 78.19 MiB，但快速模式也會變成需要下載。

### 6. Apple 專版可以更小，但仍有 Python 功能耦合

Apple ASR 路徑已存在，限制在 macOS 26+、arm64（[appleSpeechManager.js:33](/Users/chunghan/AI/SpeakSlow/src/helpers/appleSpeechManager.js:33)）。它使用系統管理模型，沒有內嵌 Apple 模型。

目前 [textUtilityService.js:24](/Users/chunghan/AI/SpeakSlow/src/helpers/textUtilityService.js:24) 的 Edge TTS 仍會啟動獨立 Python utility worker。因此拿掉 Sherpa ASR 不等於可直接拿掉整個 Python 後端。要保留相同朗讀功能，需先拆出較小的 TTS 後端或重作該路徑；若改用 macOS 語音合成，聲音與功能行為也要另行評估。

若完成解耦且產品不提供 Sherpa，模型與後端合計最多約 **490.18 MiB** 成為移出候選；從現況單純相減約剩 317.79 MiB，尚未包含替代 TTS 或新程式成本。這只是容量算式，沒有完成建置或驗收。此數字包含上一項模型，不能重複相加；跨平台與既有引擎選擇也會改變。

## Apple 官方指引如何適用

1. **分別量下載與安裝體積。** Apple 的 [Reducing your app’s size](https://developer.apple.com/documentation/xcode/reducing-your-app-s-size) 強調實際分發產物；其 IPA／App Thinning Size Report 流程不能直接套在本專案的 Electron DMG。應另量新建置 DMG／ZIP 與解開的 `.app`；磁碟節省不能直接換算為下載節省。
2. **移除不必要資源與程式碼。** 本專案對應的是套件重複、製圖素材、字型與有條件的語系；不是只調整 Swift flags。Apple 指引是判斷原則，Electron／PyInstaller 的具體設定需回到各自工具驗證。
3. **目前已避免主程式雙架構成本。** Apple 的 [Building a universal macOS binary](https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary) 說明 universal 同時包含 arm64／x86_64。此專案 [package.json:175](/Users/chunghan/AI/SpeakSlow/package.json:175) 已是 arm64；安裝檔掃描無 fat Mach-O，另附一個 x64 uiohook prebuild 約 57.6 KiB。不能再估算「去掉 Intel 就省一半」。
4. **模型可由系統管理，但仍有系統資源成本。** [AssetInventory](https://developer.apple.com/documentation/speech/assetinventory) 說明 Apple 模型由系統下載、保留、更新並供其他 App 共用。這可減少 App 內嵌負擔；不能說整台電腦不占模型磁碟或記憶體。
5. **編譯最佳化有適用邊界。** 兩個 Swift helper 已使用 `-O`（[build-apple-speech.mjs:9](/Users/chunghan/AI/SpeakSlow/scripts/build-apple-speech.mjs:9)、[build-context-helper.mjs:8](/Users/chunghan/AI/SpeakSlow/scripts/build-context-helper.mjs:8)），合計只有 0.37 MiB。`-Osize`、dead stripping、分離 debug symbols 即使有效，也無法消除第三方 Electron 與 ONNX 模型容量。不可對已簽章的安裝 App 任意刪除或 strip 後當作可分發結果。

更多 Apple 平台限制、ODR／Background Assets、符號與編譯選項來源見 [Apple 官方研究筆記](/Users/chunghan/AI/SpeakSlow/docs/research/APPLE_APP_SIZE_GUIDANCE_2026-10-18.md)。

## 建議順序與預期邊界

| 順序 | 工作 | 預估效果／候選容量 | 驗收影響 |
| --- | --- | --- | --- |
| 1 | 清除 renderer 原始套件、source maps、展示與製圖資源 | 初步估約 40–50 MiB；子項有重疊，需以重打包後差值確認 | 目標保留雙引擎、外觀與離線功能 |
| 2 | 品牌字型子集，再評估內容字型 | 全部字型現占 26.35 MiB；實際節省待產出檔案量測 | 固定字串涵蓋、任意中文輸入、外觀與授權 |
| 3 | 明確限制 Electron 語系 | 候選約 36.50 MiB；現有 builder 選項路徑不足 | 語系支援與簽章前處理 |
| 4 | Sherpa 模型按需下載 | 初始 App 候選減少約 388.66 MiB | 首次網路、離線承諾、下載失敗及檔案完整性 |
| 5 | Apple 專版並拆除 Python 耦合 | 目前後端＋模型共 490.18 MiB；包含第 4 項 | 引擎可用性、TTS、平台支援與辨識品質 |

前三項合計可把「減少約 80–110 MiB」作為探索目標；這是條件式工程估算，包含字型與語系的產品選擇，不能視為已交付結果。第 1 項最適合先做。若需低於數百 MiB，才值得另評估 SwiftUI／AppKit 改寫以移除 Electron；目前沒有該改寫的體積、工期或功能等價證據。

## 驗收與未查核項目

- 已完成：安裝 App 配置量與邏輯量、ASAR 檔案結構、重複資源內容、四檔原始碼一致性、Mach-O 架構、打包路徑與官方文件查核。
- 未完成：瘦身建置、DMG／ZIP 差值、簽章／公證、完整啟動與兩引擎錄音／檔案轉錄／貼上／歷史／TTS 的功能驗收。本次只新增調查文件與容量紀錄。
- 記憶體／CPU：本次未新增 runtime 測量。少打包未載入的檔案通常主要改善磁碟與下載量；不能直接宣稱 RAM、辨識速度或耗電等比例改善。Apple 模型需包含系統服務成本，Ollama 是另行安裝的依賴，也不在本次 App 容量表中。
- 實作後應先以相同平台與建置流程做前後對照，再驗證 SQLite、熱鍵、三個視窗、兩引擎、繁簡轉換、TTS 與冷啟動模型準備；單一啟動 smoke test 不足以證明保留所有功能。

補充工具來源：[electron-builder 的內容與依賴收錄](https://www.electron.build/v26/docs/configuration/)、[PyInstaller collect-all 的定義](https://pyinstaller.org/en/stable/usage.html#cmdoption-collect-all)。[build-backend.mjs:29](/Users/chunghan/AI/SpeakSlow/scripts/build-backend.mjs:29) 使用多個 `--collect-all`，後續可精確化，但本次未把它列成保證節省量。

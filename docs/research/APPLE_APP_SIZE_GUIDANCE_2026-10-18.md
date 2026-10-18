# SpeakSlow 瘦身：Apple 官方開發者文件查核

查核日期：2026-10-18（Asia/Taipei）。外部結論僅採 Apple 官方開發者文件及 WWDC 逐字稿。Apple Documentation 的 HTML 若只顯示需要 JavaScript，改為實讀同頁官方 `.md` 內容；本文仍連結正式文件頁。

範圍：macOS 的 Electron、Sherpa/Python 後端及 Swift Apple Speech helper。這次只做唯讀查核與研究記錄，沒有建置、刪檔、修改已安裝 App、改引擎預設或下載模型。實際容量盤點與候選方案見 [主評估](/Users/chunghan/AI/SpeakSlow/docs/APP_SIZE_ASSESSMENT_2026-10-18.md)。

## 1. 判斷與度量邊界

**已確認：Apple 的做法是先量測使用者實際取得的成品，再調整資源與建置設定。** 它區分 download size 與 installation size；App Store 的上傳物、開發用 `.app`、`.xcarchive` 不等於商店最終交付物。該文的 `App Thinning Size Report.txt`／IPA 流程針對 Apple 的行動平台交付，不能直接當成 electron-builder DMG 的測量工具。適用範圍：Xcode／App Store 流程；查核：2026-10-18。來源：[Reducing your app’s size](https://developer.apple.com/documentation/xcode/reducing-your-app-s-size)。

對目前直接安裝的 macOS 版本，建議分開記錄下列項目。這是依官方度量區分套用到本專案的工程建議，並非 Apple 承諾的節省數字。

| 指標 | 此專案應記錄的對象 | 不可互相代替的原因 |
| --- | --- | --- |
| 下載大小 | 最終對外交付的 DMG／ZIP 檔案位元組數 | 壓縮變小，不代表解壓後 `.app` 變小 |
| 安裝大小 | 使用者實際安裝的 `.app`，同時標明邏輯大小或 `du` 磁碟配置量 | 不拿原始碼、建置快取或整個 `dist/` 當使用者 App 大小 |
| 使用後磁碟成本 | `.app`、App 自有下載模型／音訊／快取，另列 Apple 系統共用模型 | 把模型移出 bundle 主要改變初始交付與資料歸屬，總磁碟成本仍需量測 |
| 執行中 RAM | 相同錄音工作負載下的 App 進程樹及相關系統服務 | 磁碟大小和 RAM 不同；Apple 模型可能在 App 進程之外執行 |

RAM 為獨立資源的依據：[Reducing your app’s memory use](https://developer.apple.com/documentation/xcode/reducing-your-app-s-memory-use)。該文大量描述 iOS 記憶體限制，不能把 iOS 的終止條件直接套到 macOS。Apple Speech 的進程邊界另見第 4 節。查核：2026-10-18。

## 2. Apple 的基本建議，如何套用到這個專案

**已確認：檢查 Release 設定、避免交付未使用資源，是 Apple 明確列出的起點。** 官方範例包括從 project／target 排除 README、未使用圖片與 header；其 asset catalog 與裝置標籤建議，需配合 Xcode 資源管線。適用範圍：Xcode target 的編譯與資源打包；查核：2026-10-18。來源：[Doing basic optimization to reduce your app’s size](https://developer.apple.com/documentation/xcode/doing-basic-optimization-to-reduce-your-app-s-size)。

**工程推論：本專案對應的優先工作是檢查打包 allowlist、重複資源與執行期不需使用的檔案。** 本次讀到 [package.json:105](/Users/chunghan/AI/SpeakSlow/package.json:105) 起的打包設定包含廣泛的 `node_modules` 與整組 Sherpa 模型；需以實際成品、動態載入路徑及授權需求判斷哪些可排除。Apple 的建議不代表可以任意刪第三方框架、字型字集或 locale。Electron 的 ASAR、Vite tree shaking、Python/PyInstaller 依賴裁剪，仍由各自工具鏈決定；將圖片搬進 `.xcassets` 不會自動移除 Chromium 或 ONNX Runtime。

### macOS 架構

**已確認：universal binary 同時含 `arm64` 與 `x86_64` 機器碼；同一進程內的 native 相依需支援一致的架構。** Apple 建議要服務兩種 Mac 時，連 helper、framework、dylib 等一併提供對應版本。適用範圍：macOS Mach-O；查核：2026-10-18。來源：[Building a universal macOS binary](https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary)、[Porting your macOS apps to Apple silicon](https://developer.apple.com/documentation/apple-silicon/porting-your-macos-apps-to-apple-silicon)。

本專案 [package.json:175](/Users/chunghan/AI/SpeakSlow/package.json:175) 已指定 `dmg`／`arm64`。本次以 `file` 確認已安裝的主執行檔、`apple-speech` 與 `context-reader` 都是 arm64；主評估另掃描 Mach-O 標頭，找到 105 個 arm64、1 個 x64 prebuild，未見 fat binary（詳見[容量紀錄](/Users/chunghan/AI/SpeakSlow/docs/research/APP_SIZE_INVENTORY_2026-10-18.json)）。不能預設「移除 Intel 架構就會再省一半」。若將來分發 arm64 與 Intel 兩種包，要把所有 native 相依、更新器及兩種硬體驗收納入方案。

### Swift／Xcode Release 設定

**已確認：Swift 的 `-O` 是 Optimize for Speed，`-Osize` 是 Optimize for Size；`-Os` 是另一個 C-family 設定，不能混為同一旗標。** `DEAD_CODE_STRIPPING` 對應 linker `-dead_strip`；它處理連結時的不可達程式碼，不能移除外部模型或整個 Electron runtime。`STRIP_INSTALLED_PRODUCT`、`COPY_PHASE_STRIP` 與 `STRIP_STYLE` 處理不同階段的符號。適用範圍：本機編譯／連結產物，實際效果依 toolchain、程式碼與相依而定；查核：2026-10-18。來源：[Build settings reference](https://developer.apple.com/documentation/xcode/build-settings-reference)（`SWIFT_OPTIMIZATION_LEVEL`、`GCC_OPTIMIZATION_LEVEL`、`DEAD_CODE_STRIPPING`、`STRIP_INSTALLED_PRODUCT`）。

本專案兩個 Swift 建置腳本都已使用 `-O`：[build-apple-speech.mjs:9](/Users/chunghan/AI/SpeakSlow/scripts/build-apple-speech.mjs:9)、[build-context-helper.mjs:8](/Users/chunghan/AI/SpeakSlow/scripts/build-context-helper.mjs:8)。本次 `du -k` 讀到已安裝 helper 的磁碟配置量分別為 268 KiB、108 KiB，合計約 0.367 MiB。**因此 Swift 最佳化不是目前大幅瘦身的主要方向。** 可以在未來對新建置產物比較 `-O`／`-Osize` 的大小、延遲與辨識功能，但本次未執行比較，不能承諾容量或速度收益。

**已確認：Release 的 debug symbols 可保留於配對的 dSYM，避免增加使用者交付物，同時保留 crash 分析能力。** binary 與 dSYM 需有相同 build UUID；Apple 要求保留每次發行的 archive。適用範圍：原生 binary 的符號化與發行保存；查核：2026-10-18。來源：[Building your app to include debugging information](https://developer.apple.com/documentation/xcode/building-your-app-to-include-debugging-information)。

這不構成直接刪除所有 debug 資料的理由。先確認成品實際含有哪些 debug section／dSYM，再在建置流程調整；這次未量測 debug symbol 可回收量。Electron、Python 與 native addon 的診斷資料也各有契約。

## 3. App thinning 的適用邊界

**已確認：Apple 的 app thinning 為 App Store／作業系統依裝置及 OS 選擇資源與 binary variant 的交付機制。** 本次實讀的 size-report 例子產出 IPA 及 iPhone variants。官方另有「iOS App 在 Mac 執行」的說明，該處的 Mac thinning 仍是 iOS App on Mac，不能據此推斷原生 macOS Electron DMG 有同樣行為。適用範圍：文件列出的 Apple 商店 variant 流程；查核：2026-10-18。來源：[Reducing your app’s size](https://developer.apple.com/documentation/xcode/reducing-your-app-s-size)、[Running your iOS apps in macOS](https://developer.apple.com/documentation/apple-silicon/running-your-ios-apps-in-macos)。

**工程結論：目前 `electron-builder` 的 arm64 DMG 應自行控制打包內容與架構，不能期待 App Store thinning 自動清除它的冗餘。** 本次未查得 Apple 能自動裁剪此 DMG 的官方依據。

## 4. SpeechAnalyzer／AssetInventory：App 變小，不等於模型消失

**已確認：AssetInventory 的模型從 Apple 伺服器下載，由系統保留、更新，並跨 App 共用。** 模型可能已預裝或被其他 App 下載；下載之後跨 App 啟動保留。釋放 locale reservation 之後，系統在之後的時間移除模型，並非呼叫即回收指定位元組。適用範圍：Speech framework，AssetInventory 的 macOS availability 為 26.0+；查核：2026-10-18。來源：[AssetInventory](https://developer.apple.com/documentation/speech/assetinventory)。

**已確認：Apple 在 WWDC25 明說 SpeechTranscriber 模型保存在 system storage，於 App memory space 之外運行，因此不增加該 App 的 download／storage／runtime memory size。** 適用範圍：該場說明的 SpeechTranscriber 模型；查核：2026-10-18。來源：[Bring advanced speech-to-text to your app with SpeechAnalyzer](https://developer.apple.com/videos/play/wwdc2025/277/)（7:03「SpeechTranscriber model」章節）。

**工程推論：此處的「不增加 App」是儲存與進程歸屬邊界，不能解讀為整部 Mac 的模型磁碟成本或 RAM 為零。** 要比較機器總占用，應另列模型首次下載與系統服務成本；已共用的模型也不能把全部容量重複歸給每一個 App。本次未下載或量測 Apple 模型，容量與可回收量均為 `unclear`。

**已確認：SpeechTranscriber 支援 macOS 26.0+，仍需查 `isAvailable`、`supportedLocales` 及已安裝資源。** OS 版本符合不等於硬體、語言與資源均已可用。適用範圍：SpeechTranscriber，硬體與語言依執行時回報；查核：2026-10-18。來源：[SpeechTranscriber](https://developer.apple.com/documentation/speech/speechtranscriber)。

本專案 [AppleSpeech.swift:260](/Users/chunghan/AI/SpeakSlow/native/AppleSpeech.swift:260) 已有支援／模型狀態檢查，[同檔案第 291 行](/Users/chunghan/AI/SpeakSlow/native/AppleSpeech.swift:291) 使用 AssetInventory 安裝。若評估 Apple 為主的精簡版本，仍須決定是否保留 Sherpa、離線首啟動需求、舊 OS 與不支援裝置的產品行為。另已確認 [textUtilityService.js:24](/Users/chunghan/AI/SpeakSlow/src/helpers/textUtilityService.js:24) 的 TTS 使用 SherpaManager utility worker；選 Apple ASR 並不自動移除目前的 Python 執行期需求。

## 5. 按需交付：ODR 與 Background Assets 不同

**已確認：原生 macOS 不支援傳統 On-Demand Resources。** 不能把 iOS 的 ODR asset-pack 做法直接套到此 macOS App。適用範圍：App Store Connect 的 ODR 支援表；查核：2026-10-18。來源：[On-demand resources size limits](https://developer.apple.com/help/app-store-connect/reference/app-uploads/on-demand-resources-size-limits/)。

**已確認：Background Assets framework 本身可用於 macOS 13.0+；Managed Background Assets 則要求 macOS 26+。** Managed 模式管理下載、更新與壓縮。Apple-hosted 模式的正式交付限 TestFlight／App Store；使用自己的 server／CDN 是不同選項。適用範圍：各 API 的 OS availability 及對應交付管道；查核：2026-10-18。來源：[Background Assets](https://developer.apple.com/documentation/backgroundassets)、[Overview of Apple-hosted asset packs](https://developer.apple.com/help/app-store-connect/manage-asset-packs/overview-of-apple-hosted-asset-packs)。

**已確認：Unmanaged Background Assets 的官方整合需 native extension target、App Groups 與 Info.plist 設定；macOS 的 app 與 extension 還需 App Sandbox。** 適用範圍：該官方 unmanaged 整合流程；查核：2026-10-18。來源：[Configuring an unmanaged Background Assets project](https://developer.apple.com/documentation/backgroundassets/configuring-an-unmanaged-background-assets-project)。

**工程結論：Background Assets 是可研究的 macOS 技術，但不是此 Electron DMG 可直接開啟的瘦身選項。** 需要 native bridge／extension、簽署、共用目錄及 Sandbox 相容性調查；目前直接分發包也不能據此使用 Apple-hosted 服務。把可選模型改成按需下載，可以降低初始交付量；使用者下載後仍需磁碟，下載失敗及離線模式也要有明確產品行為。這些文件沒有證明可把現有 Python executable 當 asset pack 交付。

## 6. 簽署與驗收限制

**已確認：Apple 對外部建置系統要求明確的簽署步驟，nested code 由內往外簽；不要使用 `codesign --deep` 當通用簽署方法。** `--deep` 可用於特定驗證情況，與簽署不是同一用途。適用範圍：macOS 發行產物；查核：2026-10-18。來源：[Creating distribution-signed code for macOS](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)。

Apple 封存的 TN2206 要求把 bundle 變更放在簽署前；同一文件也列出 `.lproj` 刪檔及移除 Mach-O slice 等不破壞簽章的特定例外。因此不能籠統說「任何刪檔都破壞簽章」，更不能由「簽章仍有效」推論「執行功能仍完整」。適用範圍：歷史 macOS 簽署說明，僅補充現行文件，實際結果仍需驗證；查核：2026-10-18。來源：[TN2206: macOS Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)。

本專案建議將裁剪放進可重現的建置流程，對新產物驗證簽署與功能；不對 [已安裝的 SpeakSlow.app](/Applications/SpeakSlow.app) 直接執行 `strip`，也不任意刪 framework 或 locale。簽章驗證、啟動檢查與實際錄音／轉錄／TTS 驗收，仍須分開回報。

## 7. 本次可支持與不可支持的決策

- **可支持：** 先檢查實際成品的重複資源、未使用檔案與模型交付策略；以同一打包版本的 before／after 實測確認。
- **可支持：** Apple Speech 可避免把其模型放進 App bundle；前提是產品接受 OS、硬體、語言與首次資源安裝要求，並保留 TTS 等相依。
- **不可支持：** 只依 `-Osize`、App thinning 或 universal binary 一般知識，承諾本 App 可省固定百分比。
- **不可支持：** 宣稱 SwiftUI／AppKit 原生重寫必然得到某個安裝大小或 RAM 數字。移除 Chromium 是架構改變，仍需等功能原型與實際打包量測。
- **不可支持：** 把 Apple system-managed 模型寫成「不占磁碟／不占記憶體」，或把下載壓縮改善寫成執行中 RAM 改善。

以上工程建議尚未實作或驗收；本筆記沒有宣稱已回收任何容量。

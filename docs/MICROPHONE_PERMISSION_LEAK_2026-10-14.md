# 麥克風權限測試未釋放：2026-10-14

## 重現與根因

使用者回報主畫面已閒置，但 macOS 仍顯示 SpeakSlow 使用麥克風。剛執行過設定的「測試麥克風」。

最小重現為實際 `usePermissions` hook 執行 `requestMicPermission()` 後，檢查取得的 MediaStreamTrack 是否仍 live；無需 Apple helper、辨識或錄音。真實 React／headless Chrome，受控 getUserMedia track，約一秒完成。這是 capture 資源生命週期測試，不單靠程式字串斷言，也不是 macOS 系統指示燈的直接測試。

```sh
node --test test/microphone-permission-lifecycle.test.js
```

修正前兩次重現：`Idle microphone tracks after permission test: 1`。權限測試的 getUserMedia 回傳值被丟棄，無法被正常錄音 cleanup 停止。

依序考慮權限測試未釋放、一般設定音量監測仍收音、錄音 cleanup 未釋放。第一項以單獨 callback 即能重現並通過單一修正消除；主錄音與串流 cleanup 原本均有 stop 自己的 tracks。一般設定的音量表現行會在一般分頁收音，切離／卸載時停止；本次未更動這個產品行為。

## 修正及驗證

`src/hooks/usePermissions.js` 在成功取得測試串流後，立即停止其全部 tracks，再顯示測試成功。正常錄音串流仍由原 hook 管理。

- 同一測試轉綠，連續兩次測試均無 live track。
- 全部 Node 測試132項：130通過、2 skip、0失敗。
- renderer／mac arm64封裝及 ad-hoc codesign verification 通過。
- 原始紅／綠輸出：`out/microphone-permission-red.log`、`out/microphone-permission-green.log`。
- 未加入 debug instrumentation；測試暫存目錄自動清除，正式 regression test 保留。

## 安裝版驗證

- 已結束閒置的舊程序，直接替換 `/Applications/SpeakSlow.app`，不保留備份；安裝後 app.asar 與候選版一致，簽章完整性通過。
- 在實際安裝版開啟一般設定，確認 Apple／完整上下文已就緒；切到權限頁，再按「測試麥克風」，真實 UI 顯示已授予與測試成功。
- 隨後使用 CoreAudio `kAudioHardwarePropertyProcessObjectList`、`kAudioProcessPropertyIsRunningInput` 唯讀檢查；屬於安裝版的兩個音訊程序 `runningInput` 均為 false。證據：`out/microphone-postfix-idle.json`。
- 唯讀工具來源 `scripts/diagnostics/microphone-status.swift`；它不開啟麥克風、不讀音訊、不要求權限。此證據表示查詢當下 CoreAudio 沒有偵測到 SpeakSlow 在收音；沒有以畫面上的近期使用標記當持續收音證據。
- macOS 控制中心的 UI 查詢逾時，未宣稱已取得該選單的修正後截圖。一般設定的音量測試仍會主動收音，離開該頁才釋放；此現行行為已向使用者說明。

本紀錄完成時尚未 commit／push；後續使用者已授權提交並推送。沒有加入臨時產品 log 或保留 throwaway test prototype。


## 後續修正：一般設定音量監測

使用者另外回報只要開啟一般設定就一直占用麥克風。此路徑與權限測試不同：原本的 settings effect 在一般分頁自動 getUserMedia；右上角關閉按鈕只隱藏 BrowserWindow，不卸載 React，原 cleanup 無法保證在隱藏時執行。

已建立真實 SettingsPage／React 的 headless Chrome 回歸：

```sh
node --test test/settings-microphone-lifecycle.test.js
```

修正前最小重現為只掛載一般設定：`Opening general settings automatically acquired microphone: 1`。不需要點選任何收音按鈕、啟動 ASR 或準備音檔。

修正採 `useMicrophoneMonitor`：

- 預設 idle；只有按「開始測試」才取得串流，提供「停止測試」。
- 30秒上限涵蓋授權等待及監測；離開一般分頁、隱藏視窗、關閉按鈕、卸載、裝置／AGC改變或正式錄音進入busy均停止。再次顯示不自動啟動。
- generation 使逾時／停止後才回傳的串流立即結束；資源在建立 AudioContext 前登記，初始化錯誤也會釋放。
- 繁中、簡中與英文均有閒置、開始、停止及30秒說明。

測試覆蓋開頁不收音、開始／停止、分頁往返不重啟、隱藏與顯示、隱藏時拒絕新測試、關閉按鈕、30秒deadline、授權晚到與AudioContext建立失敗。紅／綠輸出保留於 `out/settings-microphone-red.log`／`out/settings-microphone-green.log`，完整回歸於 `out/mic-monitor-regression-tests.log`。

已更新 `/Applications/SpeakSlow.app`，無備份，app.asar與候選版相符，ad-hoc簽章完整性通過。實際設定頁顯示 Apple完整上下文已就緒、音量測試未啟動及開始／停止操作說明；CoreAudio在開啟一般設定後回報安裝版的inputRunning=false，見 `out/mic-monitor-runtime.json`。新測試合計133項：131通過、2 skip。

實機的原生UI自動化多次按「開始測試」未得到明確的監聽狀態變更，且曾回傳noWindowsAvailable；未取得這一輪真實開始→停止的成對CoreAudio證據。此部分以真實React加受控MediaStream的回歸為證據，不能描述為實體麥克風全部情境驗收完成。未宣稱已取得控制中心的修正後截圖。

本紀錄完成時尚未提交／推送。後續使用者已授權將麥克風監測修正與前一項文件清理一起推送至既有 fork/main；採分開提交，保留各自範圍。

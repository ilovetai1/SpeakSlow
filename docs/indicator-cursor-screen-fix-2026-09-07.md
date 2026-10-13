# 錄音圖示跟隨滑鼠所在螢幕

日期：2026-09-07。本次定位依據更新為使用者描述的「當前滑鼠頁面」。

## 原因與修正

上一版仍以鍵盤焦點所在視窗選擇螢幕，因此滑鼠與鍵盤焦點分屬不同螢幕時，圖示會出現在另一側。最新執行紀錄仍記載 `foregroundApp`；回歸測試也直接重現此差異：預期副螢幕 `(-1080, 984)`，實際卻是主螢幕 `(600, 804)`。

- macOS 改用 `screen.getCursorScreenPoint()` 與 `screen.getDisplayNearestPoint()`，顯示在滑鼠所在螢幕的底部中央。座標使用 Electron 的 DIP 單位，依據 [Electron screen 文件](https://www.electronjs.org/docs/latest/api/screen#screengetcursorscreenpoint)。
- 錄音中每 250 ms 查詢；滑鼠跨螢幕或工作區改變才重新定位，不會跟著每個像素抖動。
- 停止錄音、關閉圖示或圖示程序結束時，停止追蹤並使未完成的位置更新失效。
- 移除前景視窗 JXA 查詢；不再因前景程式為 loginwindow、視窗資料取得失敗或另一個程式保有鍵盤焦點而選錯螢幕。
- 定位失敗會記錄錯誤並提示，不改放到預設主螢幕。
- 保留不搶焦點的 panel、實際錄音狀態同步、AI 開關與先前剪貼簿修正。

## 驗證

- 修正前，三項整合測試失敗：焦點與滑鼠分離、下次錄音更換螢幕、錄音中跨螢幕。
- 修正後，18 項定位與圖示生命週期測試通過，包含負座標、工作區變動、100 次位置更新、停止後不再查詢，以及過期的非同步操作。
- 全部 Node 測試：82 通過、0 失敗、1 項 Electron ABI 測試跳過；該資料庫測試另於簽署套件執行並通過，合計 83 項通過。
- 測試總數因移除舊 JXA 專用案例、改測滑鼠定位行為而變動，不沿用上一版的 86 項數字。
- Renderer production build、`git diff --check` 與 Apple Development 本機簽署驗證通過。
- Codex 全螢幕仍無法由 CUA 操作，不能把自動化定位測試當成已目視驗證 Codex 全螢幕。

## 安裝與備份

- 修正版：[SpeakSlow.app](/Applications/SpeakSlow.app)
- 更新前：[SpeakSlow.app.backup-cursor-20260907-132229](/Applications/SpeakSlow.app.backup-cursor-20260907-132229)
- 套件、SQLite 備份與測試紀錄：[indicator-cursor-fix-20260907](/Users/chunghan/AI/SpeakSlow/dist/indicator-cursor-fix-20260907)

未新增 commit、push 或對外發佈。

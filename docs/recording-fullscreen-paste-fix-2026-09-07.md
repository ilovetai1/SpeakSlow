# 錄音圖示與 macOS 自動貼上修正

日期：2026-09-07。使用者補充：未自動貼上的程式是全螢幕 Codex。

後續定位行為已改為滑鼠所在螢幕，見 [滑鼠螢幕定位修正](/Users/chunghan/AI/SpeakSlow/docs/indicator-cursor-screen-fix-2026-09-07.md)。以下保留當時的修正與驗證紀錄。

## 已確認的程式缺陷

1. `sync-typeless-state(true)` 只同步快捷鍵管理器，沒有顯示錄音圖示；圖示依靠快捷鍵「要求開始／停止」的事件切換。回歸測試直接呼叫現有 IPC，修正前錄音為 true 卻沒有圖示。
2. 圖示 renderer 結束後，仍會重用原 BrowserWindow。首次載入失敗的事件監聽也註冊得太晚，可能留下空白視窗。測試重現 renderer 結束後仍重用同一視窗。
3. macOS 貼上 Promise 在 Cmd+V 命令結束後立即完成，但剪貼簿還要等 100 ms 才還原。下一筆貼上可能在這段期間寫入新文字，然後被上一筆還原覆蓋。修正前測試實際收到「第一段逐字稿、使用者原有剪貼簿」，沒有收到第二段。

以上是可重現的程式缺陷，尚不能斷定全部就是使用者那次 Codex 全螢幕失敗的原因。既有紀錄中的「成功粘貼」只代表 osascript 結束碼為 0，沒有證明目標輸入框收到文字。

## 修正行為

- 浮動圖示跟隨前端回報的錄音狀態；離線錄音與串流錄音任一啟用時，主面板與同步訊息均反映錄音中。
- 圖示共用載入 Promise，等待載入完成才顯示；停止／取消後，過期的載入與定位結果不能把圖示重新顯示。
- 已結束或載入失敗的 renderer 不再被快取重用；錯誤寫入 LogManager 並通知主面板。下次錄音重新建立視窗。
- macOS 使用 `type: 'panel'` 與 `showInactive()`，避免錄音時為了跨全螢幕顯示而轉換整個 app 的 process type。panel 的跨全螢幕／桌面行為依 [Electron 31.7.7 文件](https://github.com/electron/electron/blob/v31.7.7/docs/api/structures/base-window-options.md#L141-L151)。仍依前景視窗選擇螢幕，沒有新增游標定位。
- macOS 貼上依序完成「保存剪貼簿 → 寫入文字 → 送出 Cmd+V → 還原」才處理下一筆。命令失敗會傳回呼叫端，不會重試或假裝成功。
- 使用者在 Cmd+V 送出後另行複製的文字不會被延遲還原覆蓋；紀錄改稱「Cmd+V 已送出」，不宣稱目標確實接收。
- 自動貼上仍以完成時的目前游標為準；保留先前 AI 關閉與跨視窗同步修正。

## 驗證與限制

- 新增 8 項回歸測試，涵蓋錄音狀態同步、renderer 結束、載入失敗、停止後遲到顯示、連續／並行貼上、錯誤回傳與使用者另行複製。
- Node 全部測試：85 通過、0 失敗、1 項因 Electron ABI 跳過。該資料庫測試另以簽署套件執行並通過，合計 86 項通過。
- Production renderer build、`git diff --check`、本機 Apple Development 簽署驗證通過。現有大型 bundle 警告仍在；ESLint 9 缺少設定檔，未宣稱 lint 通過。
- 實機確認：從主面板開始錄音後，「錄音中...」圖示視窗建立成功。
- 實機全螢幕及實際文字送達：**未驗證**。CUA 安全限制禁止操作 Codex；改用 TextEdit 時，macOS 回報前景程式為 `loginwindow`，無法取得一般視窗位置，因此不把本次測試當成有效全螢幕驗證。
- 測試錄音已藉由正常結束應用停止；測試暫存不會匯入使用者的歷史紀錄。應用重新開啟後 AI 仍關閉。
- 尚未建立「目標輸入框確實接收」的原生確認機制，不能保證所有程式的自動貼上已排除問題。

## 本機交付

- 安裝位置：[SpeakSlow.app](/Applications/SpeakSlow.app)
- 本次更新前備份：[SpeakSlow.app.backup-recording-20260907-123443](/Applications/SpeakSlow.app.backup-recording-20260907-123443)
- 套件、測試紀錄與 SQLite 備份：[recording-fullscreen-fix-20260907](/Users/chunghan/AI/SpeakSlow/dist/recording-fullscreen-fix-20260907)

未新增 commit、push、公證或對外發佈。

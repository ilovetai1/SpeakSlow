# macOS 27 本機 ASR／潤稿評估

這個目錄把調校集與 holdout 集分開。產品自動潤稿維持預設關閉。任何 `critical` 案例改變金額、日期、否定、部署決策或人名時，品質 gate 失敗。

## 輸入契約

- `raw_asr` 是 Apple Speech 完成並套用既有確定性轉換後的完整 baseline。
- `input_builder` 只用於可重現的長度邊界案例。runner 先展開再計算 SHA-256。
- `skip_polish` 案例驗證空白／噪音結果不應呼叫語言模型。
- `audio_fixture` 是可選來源線索。報告必須記錄檔案不存在或 hash 無法取得，不能把它當成已重跑 ASR。
- 舊 macOS 26／26.4 結果只能由固定 OS build、硬體、來源、prompt 與完整 output 匯入。缺資料時結論保持 `unverified`。

## Gate

每個 provider 必須保存完整成功或固定錯誤碼。報告分開列出一般失敗與 critical semantic failure。Apple helper 的測試不得經 HTTP、Ollama、PCC 或 `fm` fallback。正式比較 Ollama 時必須傳入並驗證固定 model digest。

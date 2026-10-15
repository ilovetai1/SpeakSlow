const reasons = {
  speech_busy: '上一個錄音或轉錄工作仍在處理，完成後才能切換。',
  speech_not_ready: '語音引擎尚未就緒。',
  platform_unsupported: 'Apple 引擎需要 macOS 26 以上及 Apple Silicon。',
  device_unsupported: '這台裝置不支援 Apple 語音轉寫模型。',
  locale_unsupported: '此裝置目前未提供台灣繁體中文模型。',
  assets_unsupported: '此裝置無法使用所需的 Apple 模型資產。',
  helper_missing: 'Apple 引擎元件缺少，請使用包含該元件的版本。',
  helper_exited: 'Apple 引擎元件已結束，請重試。',
  helper_timeout: 'Apple 引擎回應逾時，請重試。',
  helper_protocol: 'Apple 引擎元件版本不相容。',
  apple_analysis_failed: 'Apple 語音處理失敗，請重試並確認模型及系統資源。',
  audio_backpressure: '音訊處理來不及接收資料，本次辨識已停止，沒有輸出截斷的結果。',
  audio_format: '此音訊格式無法交給選定的引擎。',
  audio_read_failed: '無法讀取這份錄音，請檢查檔案與存取權限。',
  speech_job_invalid: '這次工作已取消或失效，請重新開始。',
  audio_protocol: '音訊資料不完整或順序不正確。',
  audio_disordered: '音訊時間順序不正確，本次處理已停止。',
  assets_not_ready: 'Apple 模型尚未就緒，請重新檢查或準備模型。',
  locale_not_reserved: 'Apple 語言模型尚未保留使用名額，請重新準備模型。',
  locale_reservation_limit: 'Apple 語言模型的保留名額已滿，請檢查系統可用空間與語言設定。',
  insufficient_resources: '系統目前沒有足夠資源進行辨識，請稍後重試。',
  module_output_failed: 'Apple 語音模組未能完成輸出，請重試。',
  sherpa_not_ready: '現有本機引擎啟動失敗，請重試。',
  engine_setting_invalid: '語音引擎設定無效，請重新選擇。',
  engine_not_selected: '請先在設定選擇 Apple 原生引擎並等待就緒，再比較兩種模型。',
  session_closed: '本次辨識或比較已取消。',
  engine_setting_save_failed: '語音引擎設定無法保存，仍使用原本的選擇。',
  engine_shutdown_failed: '舊引擎未能結束，請重啟應用程式。',
};
export function speechError(error) {
  const code = String(error?.message || error || '').replace(/^.*Error: /, '');
  return reasons[code] || `語音引擎發生錯誤（${/^[a-z_]+$/.test(code) ? code : 'speech_failed'}），請重試。`;
}
export const speechStateLabels = {
  checking: '檢查中', needs_download: '需要下載模型', downloading: '下載模型中', preparing: '準備中', ready: '已就緒', busy: '工作進行中', stopping: '正在釋放引擎', unavailable: '無法使用', failed: '準備失敗',
};

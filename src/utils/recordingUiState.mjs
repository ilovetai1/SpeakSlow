/**
 * 集中計算目前 UI 要呈現的錄音狀態。
 *
 * UI 顯示必須反映實際仍在工作的錄音來源，不能只看設定中偏好的模式。
 * TypeLess 固定走一般錄音，因此一般與串流狀態要聚合。
 */
export function resolveRecordingUiState({
  streamingMode,
  isRecordingNormal,
  isRecordingStreaming,
  isProcessingNormal,
  isProcessingStreaming,
  errorNormal,
  errorStreaming,
}) {
  return {
    isRecording: isRecordingNormal || isRecordingStreaming,
    isRecordingProcessing: isProcessingNormal || isProcessingStreaming,
    recordingError: streamingMode ? errorStreaming : errorNormal,
  };
}

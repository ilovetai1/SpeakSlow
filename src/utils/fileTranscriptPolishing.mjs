export async function previewFileTranscriptPolish({
  rawText,
  mode,
  processText,
  isCancelled = () => false,
}) {
  if (mode !== 'txt') return { success: false, code: 'srt_polishing_unsupported' };
  if (typeof rawText !== 'string' || !rawText.trim()) return { success: false, code: 'transcript_empty' };
  if (isCancelled()) return { success: false, cancelled: true, code: 'cancelled' };

  try {
    const result = await processText(rawText, 'optimize');
    if (isCancelled() || result?.cancelled === true) {
      return { success: false, cancelled: true, code: result?.code || 'cancelled' };
    }
    if (result?.success !== true || typeof result.text !== 'string' || !result.text.trim()) {
      return {
        success: false,
        code: result?.code || 'polishing_failed',
        error: result?.error || null,
      };
    }
    return {
      success: true,
      rawText,
      candidateText: result.text.trim(),
    };
  } catch (error) {
    if (isCancelled() || error?.name === 'AbortError') {
      return { success: false, cancelled: true, code: 'cancelled' };
    }
    return { success: false, code: 'polishing_failed', error: error?.message || null };
  }
}

export function confirmFileTranscriptPolish(rawText, candidateText) {
  if (typeof rawText !== 'string' || typeof candidateText !== 'string' || !candidateText.trim()) {
    return { success: false, code: 'candidate_invalid', text: rawText };
  }
  return { success: true, text: candidateText.trim(), rawText };
}

export function resetFileTranscriptPolish(rawText) {
  return typeof rawText === 'string' ? rawText : '';
}

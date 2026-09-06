export function historyTextContract(record) {
  const baselineText = String(record?.raw_text || record?.text || "").trim();
  const finalText = String(record?.text || record?.processed_text || baselineText).trim();
  return {
    ...record,
    baselineText,
    finalText,
    showBaseline: Boolean(baselineText && baselineText !== finalText),
  };
}

export async function previewHistoryPolish({ record, processText }) {
  const { baselineText, finalText } = historyTextContract(record);
  const result = await processText(baselineText, "optimize");
  if (!result?.success || typeof result.text !== "string" || !result.text.trim()) {
    return { success: false, error: result?.error || "潤稿失敗" };
  }
  return {
    success: true,
    baselineText,
    currentText: finalText,
    candidateText: result.text.trim(),
  };
}

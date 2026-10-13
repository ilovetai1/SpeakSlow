export async function finalizeTranscript({
  rawText,
  polishingEnabled,
  commandMode,
  processText,
  saveTranscription,
  transcriptionData,
}) {
  let finalText = rawText;
  let polished = false;
  let issue = null;

  if (polishingEnabled === true && commandMode !== true) {
    try {
      const result = await processText(rawText, 'optimize');
      if (result?.cancelled || result?.code === 'runtime_stopping') {
        return {
          finalData: null,
          finalText: null,
          polished: false,
          issue: null,
          saved: false,
          saveResult: null,
          cancelled: true,
        };
      }
      if (result?.code === 'polishing_disabled') {
        // 使用者中途關閉潤稿：正常保存原文，不標記成模型失敗。
        finalText = rawText;
      } else if (result?.success === true && typeof result.text === 'string' && result.text.trim()) {
        finalText = result.text.trim();
        polished = true;
      } else {
        issue = '潤稿失敗，已使用原始文字';
      }
    } catch {
      issue = '潤稿失敗，已使用原始文字';
    }
  }

  const finalData = {
    ...transcriptionData,
    raw_text: rawText,
    text: finalText,
    processed_text: null,
  };
  let saved = true;
  let saveResult = null;
  try {
    saveResult = await saveTranscription(finalData);
  } catch {
    saved = false;
    issue = '歷史紀錄保存失敗';
  }

  return {
    finalData,
    finalText,
    polished,
    issue,
    saved,
    saveResult,
  };
}

export function createSingleFlightGate() {
  let active = false;
  return {
    get busy() {
      return active;
    },
    tryStart() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
  };
}

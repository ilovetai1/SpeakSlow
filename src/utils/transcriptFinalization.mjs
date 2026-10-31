export async function finalizeTranscript({
  rawText,
  polishingEnabled,
  commandMode,
  processText,
  saveTranscription,
  updateFastTranscriptionCandidate,
  onBaselineReady,
  transcriptionData,
  outputMode = 'wait_for_polished',
  isCancelled = () => false,
}) {
  const historyIssue = '歷史紀錄保存失敗';
  const polishingIssue = '潤稿失敗，已使用原始文字';
  const save = async (data) => {
    try {
      const result = await saveTranscription(data);
      if (result === false || result?.success === false || result?.changes === 0) {
        throw new Error('history_save_failed');
      }
      return { saved: true, result };
    } catch {
      return { saved: false, result: null };
    }
  };
  const cancelled = ({ saved = false, saveResult = null, baselineOutput = false } = {}) => ({
    finalData: null,
    finalText: null,
    polished: false,
    issue: null,
    saved,
    saveResult,
    baselineOutput,
    cancelled: true,
  });

  let finalText = rawText;
  let polished = false;
  let issue = null;
  if (isCancelled()) return cancelled();

  const baselineFirst = outputMode === 'baseline_first'
    && polishingEnabled === true
    && commandMode !== true;

  if (baselineFirst) {
    const baselineData = {
      ...transcriptionData,
      raw_text: rawText,
      text: rawText,
      processed_text: null,
    };
    const baselineSave = await save(baselineData);
    if (!baselineSave.saved) issue = historyIssue;
    if (isCancelled()) return cancelled({
      saved: baselineSave.saved,
      saveResult: baselineSave.result,
    });

    let baselineOutput = false;
    if (typeof onBaselineReady === 'function') {
      await onBaselineReady({
        finalData: baselineData,
        finalText: rawText,
        polished: false,
        issue,
        saved: baselineSave.saved,
        saveResult: baselineSave.result,
        outputAction: 'baseline_output',
      });
      baselineOutput = true;
    }
    if (isCancelled()) return cancelled({
      saved: baselineSave.saved,
      saveResult: baselineSave.result,
      baselineOutput,
    });

    let result;
    try {
      result = await processText(rawText, 'optimize');
    } catch {
      result = { success: false, code: 'provider_error' };
    }
    if (result?.cancelled || ['cancelled', 'runtime_stopping', 'polishing_disabled', 'provider_changed'].includes(result?.code)) {
      return cancelled({
        saved: baselineSave.saved,
        saveResult: baselineSave.result,
        baselineOutput,
      });
    }
    if (isCancelled()) return cancelled({
      saved: baselineSave.saved,
      saveResult: baselineSave.result,
      baselineOutput,
    });

    if (result?.success === true && typeof result.text === 'string' && result.text.trim()) {
      finalText = result.text.trim();
      polished = true;
      if (baselineSave.saved) {
        try {
          const rowId = baselineSave.result?.lastInsertRowid;
          if (rowId === null || rowId === undefined || typeof updateFastTranscriptionCandidate !== 'function') {
            throw new Error('history_update_unavailable');
          }
          const updateResult = await updateFastTranscriptionCandidate(rowId, rawText, finalText);
          if (updateResult === false || updateResult?.success !== true || updateResult?.changes !== 1) {
            if (updateResult?.code === 'candidate_stale') {
              return cancelled({
                saved: baselineSave.saved,
                saveResult: baselineSave.result,
                baselineOutput,
              });
            }
            throw new Error(updateResult?.code || 'history_update_failed');
          }
        } catch {
          issue = historyIssue;
        }
      }
    } else if (!issue) {
      issue = polishingIssue;
    }

    if (isCancelled()) return cancelled({
      saved: baselineSave.saved,
      saveResult: baselineSave.result,
      baselineOutput,
    });
    return {
      finalData: polished ? { ...baselineData, text: finalText } : baselineData,
      finalText,
      polished,
      issue,
      saved: baselineSave.saved,
      saveResult: baselineSave.result,
      baselineOutput,
      outputAction: 'candidate_only',
    };
  }

  if (polishingEnabled === true && commandMode !== true) {
    try {
      const result = await processText(rawText, 'optimize');
      if (result?.cancelled || ['cancelled', 'runtime_stopping'].includes(result?.code)) {
        return cancelled();
      }
      if (result?.code === 'polishing_disabled') {
        // 使用者中途關閉潤稿：正常保存原文，不標記成模型失敗。
        finalText = rawText;
      } else if (result?.success === true && typeof result.text === 'string' && result.text.trim()) {
        finalText = result.text.trim();
        polished = true;
      } else {
        issue = polishingIssue;
      }
    } catch {
      issue = polishingIssue;
    }
  }

  if (isCancelled()) return cancelled();
  const finalData = {
    ...transcriptionData,
    raw_text: rawText,
    text: finalText,
    processed_text: null,
  };
  const persistence = await save(finalData);
  const { saved } = persistence;
  const saveResult = persistence.result;
  if (!saved) issue = historyIssue;

  if (isCancelled()) return cancelled({ saved, saveResult });

  return {
    finalData,
    finalText,
    polished,
    issue,
    saved,
    saveResult,
    outputAction: 'final_output',
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

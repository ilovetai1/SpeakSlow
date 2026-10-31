export function decideOutputActions({ pasteEnabled, enterEnabled, pasteSucceeded }) {
  const paste = pasteEnabled === true;
  return {
    paste,
    enter: paste && pasteSucceeded === true && enterEnabled === true,
  };
}

export function nextPolishingIssue(currentIssue, result) {
  if (result?.issue) return result.issue;
  if (result?.enhanced_by_ai) return null;
  return currentIssue || null;
}

export function decideFinalizationPresentation(result) {
  const candidateOnly = result?.outputAction === 'candidate_only';
  return {
    paste: !candidateOnly,
    showCandidate: result?.success === true
      && result?.enhanced_by_ai === true
      && typeof result?.text === 'string'
      && result.text.length > 0,
  };
}

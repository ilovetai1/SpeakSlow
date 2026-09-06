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

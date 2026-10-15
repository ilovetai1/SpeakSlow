// Strict traditional character CER: no homophone or simplified/traditional
// replacement. Punctuation/space are excluded so wording and omissions count.
export function characterErrorRate(reference, hypothesis) {
  const normalize = text => Array.from(text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, ''));
  const expected = normalize(reference), actual = normalize(hypothesis);
  if (!expected.length) return null;
  if (expected.length > 2000 || actual.length > 2000) return { error: '計分上限為每份文字 2000 字；請使用較短錄音。' };
  let previous = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let i = 1; i <= expected.length; i++) {
    const current = [i];
    for (let j = 1; j <= actual.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  const errors = previous[actual.length];
  return { errors, characters: expected.length, rate: errors / expected.length };
}

const test = require('node:test');
const assert = require('node:assert/strict');

test('TXT preview uses the immutable raw full transcript and requires confirmation', async () => {
  const {
    previewFileTranscriptPolish,
    confirmFileTranscriptPolish,
    resetFileTranscriptPolish,
  } = await import('../src/utils/fileTranscriptPolishing.mjs');
  const raw = '這個費用是三萬，不是，是三千五百元。\n我們不要上線。';
  let received = null;
  const preview = await previewFileTranscriptPolish({
    rawText: raw,
    mode: 'txt',
    processText: async (text, mode) => {
      received = { text, mode };
      return { success: true, text: '這個費用是三千五百元。我們不要上線。' };
    },
  });

  assert.deepEqual(received, { text: raw, mode: 'optimize' });
  assert.equal(preview.rawText, raw);
  assert.notEqual(preview.candidateText, raw);
  assert.equal(confirmFileTranscriptPolish(raw, preview.candidateText).text, preview.candidateText);
  assert.equal(resetFileTranscriptPolish(raw), raw);
});

test('SRT, stale requests, failures, and empty candidates fail closed', async () => {
  const { previewFileTranscriptPolish } = await import('../src/utils/fileTranscriptPolishing.mjs');
  let calls = 0;
  const processText = async () => { calls += 1; return { success: true, text: '' }; };

  assert.equal((await previewFileTranscriptPolish({ rawText: '字幕', mode: 'srt', processText })).code, 'srt_polishing_unsupported');
  assert.equal((await previewFileTranscriptPolish({ rawText: '逐字稿', mode: 'txt', processText, isCancelled: () => true })).cancelled, true);
  assert.equal(calls, 0);
  assert.equal((await previewFileTranscriptPolish({ rawText: '逐字稿', mode: 'txt', processText })).code, 'polishing_failed');
});

test('cancelling or replacing an in-flight TXT preview discards its late candidate and keeps raw text', async () => {
  const { previewFileTranscriptPolish, resetFileTranscriptPolish } = await import('../src/utils/fileTranscriptPolishing.mjs');
  const rawText = '保留完整原文，三萬不是三千五。';
  let cancelled = false, complete;
  const operation = previewFileTranscriptPolish({ rawText, mode: 'txt', isCancelled: () => cancelled, processText: () => new Promise(resolve => { complete = resolve; }) });
  cancelled = true; complete({ success: true, text: '不得採用的過期候選' });
  const result = await operation;
  assert.equal(result.cancelled, true); assert.equal(result.candidateText, undefined);
  assert.equal(resetFileTranscriptPolish(rawText), rawText);
});

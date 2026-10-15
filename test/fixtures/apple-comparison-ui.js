const calls = [], listeners = new Set();
let cancelled = 0, closed = false, resolveRun;
window.electronAPI = {
  onSpeechComparisonProgress: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  compareAppleTranscription: (id, options) => {
    calls.push({ id, options });
    listeners.forEach(callback => callback({ profile: options.first === 'dictation' ? 'dictation' : options.speechProfile, completed: 0 }));
    return new Promise(resolve => { resolveRun = resolve; });
  },
  cancelAppleSpeechComparison: async () => { cancelled++; resolveRun({ success: false, error: 'speech_job_invalid' }); },
};
window.comparisonClosed = () => { closed = true; };
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('comparison UI timeout: ' + predicate); };
const check = (value, message) => { if (!value) throw Error(message); };
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
const select = (selector, value) => { const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); };
(async () => {
  await wait(() => button('開始比較'));
  check(calls.length === 0, 'opening modal started recognition');
  select('[aria-label="比較順序"]', 'dictation');
  button('開始比較').click();
  await wait(() => button('取消比較'));
  check(calls[0].id === 42 && calls[0].options.first === 'dictation', 'wrong history audio/order');
  check([...document.querySelectorAll('select')].every(node => node.disabled), 'controls not locked');
  button('取消比較').click();
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('比較已取消'));
  check(cancelled === 1, 'cancel did not reach owner API');
  button('開始比較').click(); await wait(() => calls.length === 2);
  resolveRun({ success: true, results: [
    { profile: 'dictation', success: true, text: '頁面程式碼', timings: { prepareMs: 5, firstTextMs: 700, audioEndToFinalMs: 100 } },
    { profile: 'accurate', success: true, text: '頁麵城市碼', timings: { prepareMs: 10, firstTextMs: 6000, audioEndToFinalMs: 150 } },
  ] });
  await wait(() => document.querySelectorAll('article').length === 2);
  check(document.querySelectorAll('article')[0].textContent.includes('700.0 ms'), 'first text time missing');
  check(document.querySelectorAll('article')[1].textContent.includes('頁麵城市碼'), 'raw words were rewritten');
  const input = document.querySelector('#comparison-reference');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '頁面程式碼');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(() => document.querySelectorAll('article')[1].textContent.includes('60.00%'));
  check(document.querySelectorAll('article')[0].textContent.includes('0.00%'), 'reference grading wrong');
  button('重新比較').click(); await wait(() => calls.length === 3);
  resolveRun({ success: false, results: [], restoreError: 'helper_exited' });
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('原本的辨識模式未能恢復'));
  button('關閉').click(); check(closed, 'close not wired');
  document.querySelector('#test-result').textContent = 'Apple comparison UI PASS';
})().catch(error => { document.querySelector('#test-result').textContent = error.message; });

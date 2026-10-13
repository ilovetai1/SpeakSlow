window.saved = { enable_ai_optimization: true, ai_provider: 'openai', ai_model: 'test', has_ai_api_key: true };
window.listeners = new Set();
window.writes = [];
window.discoveryCalls = 0;
window.electronAPI = {
  getSetting: async (key, initial) => key in saved ? saved[key] : initial,
  getAllSettings: async () => ({ ...saved }),
  getTranscriptPolishingPrompt: async () => '只修正標點。',
  setTranscriptPolishingPrompt: async () => {},
  setSetting: async (key, value) => {
    if (window.rejectWrite) throw new Error('測試寫入失敗');
    writes.push({ key, value });
    saved[key] = value;
    for (const listener of listeners) listener({ key, value });
  },
  onSettingChanged: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  listOllamaModels: async () => { discoveryCalls++; return { success: true, models: [] }; },
};
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`UI condition timed out: ${predicate}`);
};
const check = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const script = document.createElement('script');
  script.src = './settings.js';
  document.body.appendChild(script);
  await waitFor(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('AI')));
  Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('AI')).click();
  await waitFor(() => document.querySelector('label[for="ai-optimization-toggle"]')?.nextElementSibling);
  const enabled = () => document.querySelector('label[for="ai-optimization-toggle"]')?.nextElementSibling.getAttribute('aria-checked') === 'true';
  check(enabled(), '初始開關應為開啟');
  await electronAPI.setSetting('enable_ai_optimization', false);
  await tick();
  check(!enabled(), '主面板關閉後，已開啟的設定視窗仍顯示開啟');
  writes.length = 0;
  Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('儲存')).click();
  await tick();
  check(writes.some(w => w.key === 'ai_provider'), 'AI 設定未儲存');
  check(!writes.some(w => w.key === 'enable_ai_optimization'), '儲存 AI 設定不應把快照中的開關重新寫回');
  window.rejectWrite = true;
  document.querySelector('#ai-optimization-toggle').click();
  await tick();
  check(!enabled(), '儲存失敗不應把畫面切成開啟');
  check(document.body.textContent.includes('測試寫入失敗'), '儲存失敗應顯示錯誤');
  window.rejectWrite = false;
  const provider = Array.from(document.querySelectorAll('select')).find(select =>
    Array.from(select.options).some(option => option.value === 'ollama'));
  provider.value = 'ollama';
  provider.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  check(discoveryCalls === 0, 'AI 關閉時不應自動啟動模型探索');
  document.querySelector('#test-result').textContent = 'AI settings UI PASS';
})().catch(error => {
  document.querySelector('#test-result').textContent = error.message;
});

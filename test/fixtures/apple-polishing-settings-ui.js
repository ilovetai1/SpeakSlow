window.saved = { enable_ai_optimization: false, ai_provider: 'openai', ai_model: 'keep-remote-model', ai_base_url: 'https://keep.invalid', has_ai_api_key: true };
window.listeners = new Set();
window.writes = [];
window.appleReady = false;
window.appleSupported = true;
const status = () => ({ available: appleReady, platformSupported: appleSupported, variant: 'AFM fixture', contextSize: 8192, locale: 'zh-TW', code: appleReady ? undefined : 'model_not_ready', error: appleReady ? undefined : '測試模型尚未就緒' });
window.electronAPI = {
  getSetting: async (key, initial) => key in saved ? saved[key] : initial,
  getAllSettings: async () => ({ ...saved }),
  getTranscriptPolishingPrompt: async () => '只修正標點。',
  setTranscriptPolishingPrompt: async () => {},
  getApplePolishingStatus: async () => status(),
  checkAIStatus: async () => status(),
  setSetting: async (key, value) => {
    writes.push({ key, value }); saved[key] = value;
    for (const listener of listeners) listener({ key, value });
  },
  onSettingChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); },
};
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 150; attempt++) { if (predicate()) return; await tick(); }
  throw Error(`UI condition timed out: ${predicate}`);
};
const check = (condition, message) => { if (!condition) throw Error(message); };
(async () => {
  const script = document.createElement('script'); script.src = './settings.js'; document.body.appendChild(script);
  await waitFor(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('AI')));
  Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('AI')).click();
  await waitFor(() => document.querySelector('option[value="apple_on_device"]'));
  const provider = document.querySelector('option[value="apple_on_device"]').parentElement;
  check(provider.value === 'openai', '既有 provider 不得自動變成 Apple');
  check(!document.querySelector('#apple-polishing-output-mode'), '非 Apple provider 不得顯示 Apple 輸出模式');
  provider.value = 'apple_on_device'; provider.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => document.querySelector('[aria-label="Apple 本機模型狀態"]'));
  const outputMode = document.querySelector('#apple-polishing-output-mode');
  check(outputMode?.value === 'fast', '缺少設定時應顯示快速輸出');
  outputMode.value = 'wait_for_polished'; outputMode.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => saved.apple_polishing_output_mode === 'wait_for_polished');
  const toggle = () => document.querySelector('#ai-optimization-toggle');
  check(toggle().disabled, '未就緒或未儲存 Apple 不得啟用');
  check(!document.querySelector('input[type="password"]'), 'Apple 不得顯示 API key');
  check(!document.querySelector('input[type="url"]'), 'Apple 不得顯示 endpoint');
  check(document.body.textContent.includes('AFM fixture') && document.body.textContent.includes('8192'), '應顯示 model variant/context');
  check(document.body.textContent.includes('測試模型尚未就緒'), '未就緒原因必須可見');
  Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('儲存')).click();
  await waitFor(() => saved.ai_provider === 'apple_on_device');
  check(!writes.some(write => ['ai_api_key', 'ai_base_url', 'ai_model'].includes(write.key)), 'Apple 儲存不得改遠端 secret/URL/model');
  check(saved.ai_base_url === 'https://keep.invalid' && saved.ai_model === 'keep-remote-model', '保留原 provider 設定');
  check(toggle().disabled, '已儲存但未就緒仍不得啟用');
  window.appleReady = true;
  Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重新查詢').click();
  await waitFor(() => !toggle().disabled);
  toggle().click(); await waitFor(() => saved.enable_ai_optimization === true);
  window.appleReady = false;
  Array.from(document.querySelectorAll('button')).find(button => button.textContent === '重新查詢').click();
  await waitFor(() => document.body.textContent.includes('測試模型尚未就緒'));
  check(!toggle().disabled, '模型失效時仍可關閉既有潤稿');
  toggle().click(); await waitFor(() => saved.enable_ai_optimization === false);
  check(toggle().disabled, '關閉後不可重新啟用失效模型');
  document.querySelector('#test-result').textContent = 'AI settings UI PASS';
})().catch(error => { document.querySelector('#test-result').textContent = error.message; });

let state = { platform: 'darwin', selected: 'apple', profile: 'accurate', state: 'ready', isReady: true, appleAvailable: true, busy: false };
const listeners = new Set(), writes = [];
let rejectNext = false;
const publish = patch => { state = { ...state, ...patch }; listeners.forEach(callback => callback(null, state)); };
window.electronAPI = {
  getPlatform: () => 'darwin',
  getSpeechEngineState: async () => state,
  onSpeechEngineState: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  selectSpeechEngine: async (key, value) => {
    if (rejectNext) { rejectNext = false; throw new Error('engine_setting_save_failed'); }
    writes.push({ key, value }); publish({ profile: value }); return state;
  },
  retrySpeechEngine: async () => { publish({ state: 'ready', reason: null }); return state; },
  installSpeechAssets: async () => { publish({ state: 'downloading', reason: null, progress: 42 }); return state; },
};
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('UI condition timeout: ' + predicate.toString()); };
const check = (valid, reason) => { if (!valid) throw new Error(reason); };
const select = (value) => { const control = document.getElementById('apple-response-profile'); control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); };
(async () => {
  await wait(() => document.querySelector('#apple-response-profile'));
  const engine = document.querySelector('#speech-engine');
  check(engine.disabled && engine.value === 'apple', 'Mac engine must be fixed Apple');
  check(engine.options.length === 1 && !document.querySelector('option[value="sherpa"]'), 'Mac offers a legacy engine');
  check(engine.textContent.includes('macOS 27'), 'Mac requirement is not visible');
  check(writes.length === 0, 'opening settings changed saved preferences');
  check(document.querySelector('#apple-response-profile').value === 'accurate', 'Apple default changed');
  check(document.querySelector('#apple-response-profile').options.length === 3, 'Apple profiles missing');
  select('responsive'); await wait(() => state.profile === 'responsive');
  select('dictation'); await wait(() => state.profile === 'dictation');
  await wait(() => document.querySelector('#root').textContent.includes('部分測試音訊中會漏字'));
  publish({ state: 'busy', busy: true }); await wait(() => document.querySelector('#apple-response-profile').disabled);
  publish({ state: 'ready', busy: false }); await wait(() => !document.querySelector('#apple-response-profile').disabled);
  rejectNext = true; select('accurate');
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('無法保存'));
  check(document.querySelector('#apple-response-profile').value === 'dictation', 'failed profile save changed selection');
  publish({ state: 'needs_download', reason: null });
  await wait(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('下載所需模型')));
  [...document.querySelectorAll('button')].find(button => button.textContent.includes('下載所需模型')).click();
  await wait(() => document.querySelector('#root').textContent.includes('42%'));
  check(!document.querySelector('#root').textContent.includes('停止等待並選回'), 'Mac offers Sherpa fallback while downloading');
  publish({ state: 'failed', reason: 'locale_unsupported' });
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('台灣繁體中文'));
  [...document.querySelectorAll('button')].find(button => button.textContent.includes('重新檢查')).click();
  await wait(() => state.state === 'ready');
  check(writes.every(write => write.key === 'apple_response_profile'), 'Mac UI wrote an engine selection');
  document.querySelector('#test-result').textContent = 'Mac Apple-only UI PASS';
})().catch(error => { document.querySelector('#test-result').textContent = error.message; });

let state = { selected: 'sherpa', profile: 'accurate', state: 'ready', isReady: true, appleAvailable: true, busy: false };
const listeners = new Set(), writes = [];
let rejectNext = false;
const publish = patch => { state = { ...state, ...patch }; listeners.forEach(callback => callback(null, state)); };
window.electronAPI = {
  getSpeechEngineState: async () => state,
  onSpeechEngineState: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  selectSpeechEngine: async (key, value) => {
    if (rejectNext) { rejectNext = false; throw new Error('engine_setting_save_failed'); }
    writes.push({ key, value });
    publish(key === 'asr_engine' ? { selected: value } : { profile: value });
    return state;
  },
  retrySpeechEngine: async () => { publish({ state: 'ready', reason: null }); return state; },
  installSpeechAssets: async () => { publish({ state: 'ready', reason: null }); return state; },
};
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('UI condition timeout: ' + predicate.toString()); };
const check = (valid, reason) => { if (!valid) throw new Error(reason); };
const select = (id, value) => { const control = document.getElementById(id); control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); };
(async () => {
  await wait(() => document.querySelector('#speech-engine'));
  check(document.querySelector('#speech-engine').value === 'sherpa', 'default changed');
  select('speech-engine', 'apple'); await wait(() => document.querySelector('#apple-response-profile'));
  check(writes[0].value === 'apple', 'selection not persisted');
  select('apple-response-profile', 'responsive'); await wait(() => state.profile === 'responsive');
  publish({ state: 'busy', busy: true }); await wait(() => document.querySelector('#speech-engine').disabled);
  check(document.querySelector('#apple-response-profile').disabled, 'profile bypasses busy gate');
  publish({ state: 'ready', busy: false, selected: 'sherpa' }); await wait(() => !document.querySelector('#apple-response-profile'));
  rejectNext = true; select('speech-engine', 'apple');
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('無法保存'));
  check(document.querySelector('#speech-engine').value === 'sherpa', 'failed save changed visible selection');
  publish({ selected: 'apple', state: 'failed', reason: 'locale_unsupported' });
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('台灣繁體中文'));
  check(state.selected === 'apple', 'failure fell back');
  publish({ selected: 'apple', state: 'downloading', reason: null, progress: 42 });
  await wait(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('停止等待')));
  [...document.querySelectorAll('button')].find(button => button.textContent.includes('停止等待')).click();
  await wait(() => state.selected === 'sherpa');
  publish({ state: 'ready', appleAvailable: false });
  await wait(() => document.querySelector('option[value="apple"]').disabled);
  document.querySelector('#test-result').textContent = 'Speech engine UI PASS';
})().catch(error => { document.querySelector('#test-result').textContent = error.message; });

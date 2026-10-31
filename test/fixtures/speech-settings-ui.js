let state = { platform: window.TEST_SPEECH_PLATFORM, selected: 'sherpa', profile: 'accurate', state: 'ready', isReady: true, appleAvailable: false, busy: false };
const listeners = new Set(), writes = [];
let rejectNext = false;
const publish = patch => { state = { ...state, ...patch }; listeners.forEach(callback => callback(null, state)); };
window.electronAPI = {
  getPlatform: () => window.TEST_SPEECH_PLATFORM,
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
  check(document.querySelector('#speech-engine').options.length === 1, 'non-Mac offers an alternate engine');
  check(!document.querySelector('option[value="apple"]') && !document.querySelector('#apple-response-profile'), 'non-Mac exposes Apple controls');
  check(writes.length === 0, 'opening settings changed saved preferences');
  publish({ state: 'busy', busy: true }); await wait(() => document.querySelector('#speech-engine').disabled);
  publish({ state: 'ready', busy: false }); await wait(() => !document.querySelector('#speech-engine').disabled);
  rejectNext = true; select('speech-engine', 'sherpa');
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('無法保存'));
  check(document.querySelector('#speech-engine').value === 'sherpa', 'failed save changed visible selection');
  publish({ state: 'downloading', reason: null, progress: 42 });
  await wait(() => document.querySelector('#root').textContent.includes('42%'));
  check(!document.querySelector('#root').textContent.includes('Apple'), 'non-Mac displays Apple download behavior');
  publish({ selected: 'apple', state: 'failed', reason: 'engine_setting_invalid' });
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes('設定無效'));
  check(!document.querySelector('#apple-response-profile'), 'foreign saved Apple preference exposes profile controls');
  select('speech-engine', 'sherpa'); await wait(() => state.selected === 'sherpa');
  check(writes.length === 1 && writes[0].value === 'sherpa', 'explicit valid correction was not saved');
  document.querySelector('#test-result').textContent = 'Speech engine UI PASS';
})().catch(error => { document.querySelector('#test-result').textContent = error.message; });

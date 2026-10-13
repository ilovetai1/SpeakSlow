import React, { useEffect, useState } from 'react';
const PROFILES = { neutral: '一般整理', message: '訊息', email: '郵件', note: '筆記', auto: '依 App 設定' };
const STAGES = { capture: '錄音準備', asr: '語音辨識', polish: 'AI 潤稿', context: '讀取文字情境', history_save: '儲存歷史', paste_command: '貼上命令', hotkey_to_capture_ready: '快捷鍵至錄音就緒', stop_to_paste_command_ack: '停止錄音至貼上命令完成' };
const ERRORS = { rule_conflict: '已有相同詞彙，請到字典確認規則。', undo_conflict: '規則已被修改，無法撤回。', scope_invalid: 'App 範圍無效。', candidate_unavailable: '候選已到期或已處理。', scoped_store_invalid: 'App 字典資料無效，未套用。', learning_persistence_failed: '學習資料保存失敗。' };
const LEARNING_STATUS = { recording_started: '新錄音已開始，上一筆改錯觀察已停止。', off: '改錯觀察已關閉。', observing: '正在觀察本次輸入，最多 15 秒。', prepared: '已準備本次輸入範圍。', expired: '本次觀察已到期並停止。', focus_changed: '欄位或 App 已切換，觀察已停止。', span_unproven: '無法確認原插入範圍，觀察已停止。', secure_field: '敏感欄位不提供改錯觀察。', denied_app: '此 App 已排除改錯觀察。', permission_denied: '沒有輔助使用權限，未觀察文字。', unsupported: '此欄位不支援可靠的範圍觀察。', queue_full: '待處理候選已達 100 筆，請先處理候選。', candidate_added: '已新增待核准詞彙。', learning_persistence_failed: '學習資料保存失敗。', edit_ineligible: '本次修改不符合單一詞彙學習條件。', observation_failed: '本次改錯觀察失敗。' };
const initial = { writing_profile: 'neutral', writing_profile_apps: {}, context_aware_polishing_enabled: false, local_correction_learning_enabled: false, latency_metrics_enabled: true, context_app_denylist: [] };
export default function EvolutionSettings() {
  const [settings, setSettings] = useState(initial), [state, setState] = useState({ candidates: [], undo: [], rules: [] });
  const [stats, setStats] = useState({ groups: [], sessions: 0 }), [apps, setApps] = useState([]), [error, setError] = useState(''), [pending, setPending] = useState(true);
  const api = window.electronAPI;
  const refresh = async () => {
    const [e, p] = await Promise.all([api.getEvolutionState(), api.getPerformanceStats()]);
    if (e.error) throw new Error(ERRORS[e.error] || '本機功能資料無法讀取。');
    setState(e); setStats(p.stats);
  };
  useEffect(() => {
    let alive = true; const changed = new Set();
    (async () => {
      const entries = await Promise.all(Object.entries(initial).map(async ([key, fallback]) => [key, await api.getSetting(key, fallback)]));
      if (alive) setSettings(s => ({ ...Object.fromEntries(entries), ...Object.fromEntries([...changed].map(key => [key, s[key]])) }));
      await refresh();
      const result = await api.getEvolutionApps(); if (alive) setApps(result.apps || []);
    })().catch(() => { if (alive) setError('本機功能設定無法讀取。'); }).finally(() => { if (alive) setPending(false); });
    const unsubscribe = api.onSettingChanged?.(({ key, value }) => { if (Object.hasOwn(initial, key)) { changed.add(key); setSettings(s => ({ ...s, [key]: value })); } });
    return () => { alive = false; unsubscribe?.(); };
  }, []);
  const run = async fn => { setPending(true); setError(''); try { const r = await fn(); if (r?.error) throw new Error(ERRORS[r.error] || r.error); await refresh(); } catch (e) { setError(e.message); } finally { setPending(false); } };
  const save = (key, value) => run(async () => { await api.setSetting(key, value); setSettings(s => ({ ...s, [key]: value })); });
  const check = (key, label) => <label className="flex items-center gap-2"><input type="checkbox" checked={settings[key] === true} disabled={pending} onChange={e => save(key, e.target.checked)} />{label}</label>;
  const button = 'rounded border px-3 py-1 disabled:opacity-50';
  return <div className="space-y-6 text-sm">
    <h2 className="text-xl font-semibold">寫作與本機學習</h2>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <section className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">寫作格式</h3>
      <label>本次預設 <select value={settings.writing_profile} disabled={pending} onChange={e => save('writing_profile', e.target.value)} className="rounded border p-1 ml-2">{Object.entries(PROFILES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <p className="text-gray-500">格式只調整語氣與段落，不會開啟 AI 潤稿或加入新資訊。</p>
      {settings.writing_profile === 'auto' && <div className="space-y-2">{apps.map(a => <label key={a.bundleId} className="flex justify-between gap-3">{a.name}<select aria-label={`${a.name} 寫作格式`} value={settings.writing_profile_apps[a.bundleId] || 'neutral'} disabled={pending} onChange={e => save('writing_profile_apps', { ...settings.writing_profile_apps, [a.bundleId]: e.target.value })}>{Object.entries(PROFILES).filter(([id]) => id !== 'auto').map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>)}</div>}
      {check('context_aware_polishing_enabled', '讓本機 Ollama 參考有限的文字情境')}
      <p className="text-gray-500">預設關閉。只讀取目前可編輯欄位的少量選取與前後文，不保存、不傳至遠端 AI。欄位或模型預算未驗證時，本次使用一般潤稿。</p>
      <button className={button} disabled={pending} onClick={() => run(() => api.calibrateContextBudget())}>驗證本機模型的文字預算</button>
      <p className="text-gray-500">以一段固定測試文字驗證目前 Ollama 模型；更換模型或提示詞後須重新驗證。</p>
      <p>情境與學習排除的 App：</p>
      <div className="grid grid-cols-2 gap-2">{apps.map(a => <label key={a.bundleId}><input type="checkbox" checked={settings.context_app_denylist.includes(a.bundleId)} disabled={pending} onChange={e => save('context_app_denylist', e.target.checked ? [...settings.context_app_denylist, a.bundleId] : settings.context_app_denylist.filter(x => x !== a.bundleId))} /> {a.name}</label>)}</div>
    </section>
    <section className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">改錯學習</h3>
      {check('local_correction_learning_enabled', '觀察本次輸入後的小幅改詞，建立待核准候選')}
      <p className="text-gray-500">最多觀察 15 秒，只在本機處理。核准前不影響字典；既有面板手動改錯記憶保持不變。App 詞庫依本次字典替換的情境套用，不鎖定貼上目的地。</p>
      <button className={button} disabled={pending} onClick={() => run(refresh)}>重新整理候選</button>
      {LEARNING_STATUS[state.learningStatus] && <p role="status">{LEARNING_STATUS[state.learningStatus]}</p>}
      {state.candidates.filter(c => c.state === 'pending').length === 0 && <p className="text-gray-500">目前沒有待核准詞彙。</p>}
      {state.candidates.filter(c => c.state === 'pending').map(c => <Candidate key={c.id} candidate={c} apps={apps} pending={pending} run={run} api={api} />)}
      {state.undo.map(u => <div key={u.id} className="flex justify-between"><span>已核准：{u.original} → {u.replacement}</span><button className={button} disabled={pending} onClick={() => run(() => api.undoLearning(u.id))}>撤回</button></div>)}
      <p className="text-gray-500">App 規則可到「字典」頁編輯、停用、刪除或匯出。</p>
    </section>
    <section className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">本機延遲統計</h3>
      {check('latency_metrics_enabled', '記錄不含文字的延遲資料')}
      <p className="text-gray-500">最多保留 1,000 次、7 日。跨程序階段包含 IPC 等待；貼上命令完成不表示目標欄位已接收文字。</p>
      <div className="flex gap-2"><button className={button} disabled={pending} onClick={() => run(refresh)}>更新統計</button><button className={button} disabled={pending} onClick={() => run(() => api.clearPerformanceStats())}>清除統計</button><button className={button} disabled={pending} onClick={() => run(() => api.exportPerformanceStats())}>匯出 JSON</button></div>
      {['metrics_persistence_failed', 'metrics_unavailable'].includes(stats.status) && <p role="alert">延遲資料保存失敗。</p>}
      <p>已保留 {stats.sessions} 次；未滿 30 筆的分組顯示樣本不足，暫不比較。</p>
      <div className="overflow-auto"><table className="w-full text-left"><thead><tr><th>階段</th><th>樣本</th><th>P50</th><th>P95</th><th>失敗／取消／略過／缺測</th></tr></thead><tbody>{stats.groups.map((g, i) => <tr key={i} className="border-t"><td>{STAGES[g.stage]}<small className="block text-gray-500">{g.mode === 'streaming' ? '串流' : '一般錄音'}／{g.provider === 'ollama' ? '本機' : g.provider === 'openai_compatible' ? '遠端' : '未分類'}／{g.temperature === 'unknown' ? '模型暖機狀態未測' : g.temperature}</small></td><td>{g.n}{g.insufficient && <small className="block">樣本不足</small>}</td><td>{g.p50 === null ? '未測' : `${g.p50.toFixed(1)} ms`}</td><td>{g.p95 === null ? '未測' : `${g.p95.toFixed(1)} ms`}</td><td>{g.counts.failed}／{g.counts.cancelled}／{g.counts.skipped}／{g.counts.missing}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
export function Candidate({ candidate: c, apps, pending, run, api }) {
  const [scope, setScope] = useState('app');
  const label = apps.find(a => a.bundleId === c.bundleId)?.name || c.bundleId;
  return <div className="border-t py-2 space-y-2"><p>{c.original} → {c.replacement}</p><select aria-label="學習範圍" value={scope} onChange={e => setScope(e.target.value)}><option value="app">只用於 {label} 的詞庫情境</option><option value="global">所有 App（全域）</option></select><div className="flex gap-2"><button className="border rounded px-3 py-1" disabled={pending} onClick={() => run(() => api.decideLearning(c.id, 'approve', scope))}>核准</button><button className="border rounded px-3 py-1" disabled={pending} onClick={() => run(() => api.decideLearning(c.id, 'dismiss'))}>忽略</button></div></div>;
}

import React, { useEffect, useState } from 'react';
import { Candidate } from './EvolutionSettings';
export default function LearningReview({ onChanged }) {
  const [state, setState] = useState({ candidates: [], undo: [] });
  const [error, setError] = useState(''), [pending, setPending] = useState(true);
  const api = window.electronAPI;
  const refresh = async () => {
    const result = await api.getEvolutionState();
    if (result.error) throw new Error('本機學習資料無法讀取。');
    setState(result);
  };
  const run = async fn => {
    setPending(true); setError('');
    try {
      const result = await fn();
      if (result?.error) throw new Error(result.error === 'undo_conflict' ? '規則已被修改，無法撤回。' : result.error === 'rule_conflict' ? '已有相同詞彙，請確認現有規則。' : '候選處理失敗。');
      await refresh(); await onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setPending(false); }
  };
  useEffect(() => { run(refresh); }, []);
  return <section className="space-y-2 rounded border p-3 mb-4 text-sm">
    <h3 className="font-semibold">待學習詞彙</h3>
    <p className="text-gray-500">核准前不影響字典。預設只用於觀察到的 App；可明示選全域。</p>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <button className="border rounded px-3 py-1" disabled={pending} onClick={() => run(refresh)}>重新整理學習候選</button>
    {state.candidates.filter(c => c.state === 'pending').map(c => <Candidate key={c.id} candidate={c} apps={[]} api={api} run={run} pending={pending} />)}
    {!state.candidates.some(c => c.state === 'pending') && <p>目前沒有待核准詞彙。</p>}
    {state.undo.map(u => <div key={u.id} className="flex justify-between"><span>已核准：{u.original} → {u.replacement}</span><button disabled={pending} onClick={() => run(() => api.undoLearning(u.id))}>撤回</button></div>)}
  </section>;
}

import React, { useEffect, useRef, useState } from 'react';
import { speechError } from '../utils/speechEngineMessages.mjs';
import { characterErrorRate } from '../utils/transcriptComparison.mjs';

const label = profile => profile === 'dictation' ? 'DictationTranscriber' : `SpeechTranscriber（${profile === 'responsive' ? '即時回饋' : '完整上下文'}）`;
const milliseconds = (value, missing = '未量測') => Number.isFinite(value) ? `${value.toFixed(1)} ms` : missing;

export default function AppleSpeechComparison({ recordId, onClose }) {
  const [speechProfile, setSpeechProfile] = useState('accurate');
  const [first, setFirst] = useState('speech');
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const active = useRef(false), mounted = useRef(true), cancelled = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const remove = window.electronAPI.onSpeechComparisonProgress(data => setProgress(data));
    return () => {
      mounted.current = false; remove?.();
      if (active.current) window.electronAPI.cancelAppleSpeechComparison().catch(() => {});
    };
  }, []);
  const start = async () => {
    if (active.current) return;
    active.current = true; cancelled.current = false;
    setRunning(true); setCancelling(false); setError(''); setResult(null); setProgress(null);
    try {
      const next = await window.electronAPI.compareAppleTranscription(recordId, { speechProfile, first });
      if (!mounted.current) return;
      if (cancelled.current) setError('比較已取消。');
      else {
        setResult(next);
        if (next.restoreError) setError(`原本的辨識模式未能恢復：${speechError(next.restoreError)} 請到設定重新檢查。`);
        else if (!next.results) setError(speechError(next.error || 'apple_analysis_failed'));
      }
    } catch (issue) { if (mounted.current) setError(cancelled.current ? '比較已取消。' : speechError(issue)); }
    finally { active.current = false; if (mounted.current) { setRunning(false); setCancelling(false); } }
  };
  const cancel = async () => {
    cancelled.current = true; setCancelling(true);
    try { await window.electronAPI.cancelAppleSpeechComparison(); }
    catch (issue) { setCancelling(false); setError(speechError(issue)); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="apple-comparison-title" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800 text-gray-900 dark:text-gray-100">
      <h3 id="apple-comparison-title" className="font-semibold">同一份錄音比較 Apple 模型</h3>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">依錄音速度依序送入兩個模型，約需錄音長度的兩倍。顯示原始辨識結果，不套用字典或 AI 潤稿，也不覆寫歷史或貼出文字。</p>
      <div className="my-3 flex flex-wrap gap-3 text-sm">
        <label>Speech 模式
          <select aria-label="比較用 Speech 模式" value={speechProfile} disabled={running} onChange={event => setSpeechProfile(event.target.value)} className="ml-2 rounded border p-1 dark:bg-gray-700">
            <option value="accurate">完整上下文</option><option value="responsive">即時回饋</option>
          </select>
        </label>
        <label>先執行
          <select aria-label="比較順序" value={first} disabled={running} onChange={event => setFirst(event.target.value)} className="ml-2 rounded border p-1 dark:bg-gray-700">
            <option value="speech">SpeechTranscriber</option><option value="dictation">DictationTranscriber</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-gray-500">首次文字從供音開始計算，包含音訊開頭的靜音，內容仍可能修訂。模型準備時間另列；定稿等待從音訊結束計算。這不是停止到貼上的時間。可反轉順序重測，觀察暖機與系統負載影響。</p>
      {running && <p role="status" className="mt-3 text-sm">{cancelling ? '正在取消並釋放模型…' : progress ? `正在執行 ${label(progress.profile)}（已完成 ${progress.completed}／2）…` : '正在讀取錄音…'}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result?.results && <>
        <p className="mt-3 text-xs text-gray-500">本次順序：{result.results.map(row => label(row.profile)).join(' → ')}。單次結果不代表穩定效能或 iPhone 表現。</p>
        <label className="mt-3 block text-sm" htmlFor="comparison-reference">參考文字（選填，請填入原本實際說的內容）</label>
        <textarea id="comparison-reference" value={reference} onChange={event => setReference(event.target.value)} rows={2} className="mt-1 w-full rounded border p-2 text-sm dark:bg-gray-700" />
        <p className="text-xs text-gray-500">字元錯誤率越低越好；忽略標點及空白，保留繁簡字與同音詞差異，漏字和多字均計入。未填參考文字時請直接核對選詞與漏字。</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {result.results.map(row => {
            const score = row.success ? characterErrorRate(reference, row.text) : null;
            return <article key={row.profile} className="rounded-lg border border-gray-200 p-3 dark:border-gray-600">
              <h4 className="text-sm font-semibold">{label(row.profile)}</h4>
              {row.success ? <>
                <dl className="my-2 grid grid-cols-2 gap-1 text-xs">
                  <dt>模型準備</dt><dd>{milliseconds(row.timings?.prepareMs)}</dd>
                  <dt>首次文字</dt><dd>{milliseconds(row.timings?.firstTextMs, '未出字')}</dd>
                  <dt>音訊結束到定稿</dt><dd>{milliseconds(row.timings?.audioEndToFinalMs)}</dd>
                  <dt>字元錯誤率</dt><dd>{!score ? '未填參考文字' : score.error || `${(score.rate * 100).toFixed(2)}%（${score.errors}／${score.characters}）`}</dd>
                </dl>
                <p className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm dark:bg-gray-700">{row.text || '未辨識到文字'}</p>
              </> : <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{speechError(row.error)} 模型未就緒時，請先到設定選擇該模式，按提示下載所需模型後重試。</p>}
            </article>;
          })}
        </div>
      </>}
      <div className="mt-4 flex justify-end gap-2 text-sm">
        {running ? <button disabled={cancelling} onClick={cancel} className="rounded-lg border px-3 py-2 disabled:opacity-50">取消比較</button> : <>
          <button onClick={onClose} className="rounded-lg border px-3 py-2">關閉</button>
          <button onClick={start} className="rounded-lg bg-blue-600 px-3 py-2 text-white">{result ? '重新比較' : '開始比較'}</button>
        </>}
      </div>
    </section>
  </div>;
}

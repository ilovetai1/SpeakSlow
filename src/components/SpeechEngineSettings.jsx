import React, { useState, useEffect } from 'react';
import { useModelStatus } from '../hooks/useModelStatus';
import { speechError, speechStateLabels } from '../utils/speechEngineMessages.mjs';

export default function SpeechEngineSettings() {
  const status = useModelStatus();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setError(''), [status.selected, status.profile]);
  const run = async action => {
    setSaving(true); setError('');
    try { await action(); } catch (issue) { setError(speechError(issue)); }
    finally { setSaving(false); }
  };
  return <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3" aria-label="語音辨識引擎">
    <label htmlFor="speech-engine" className="font-medium text-gray-900 dark:text-gray-100">語音辨識引擎</label>
    <select id="speech-engine" value={status.selected || ''} disabled={status.busy || (saving && !status.isDownloading)} onChange={event => run(() => window.electronAPI.selectSpeechEngine('asr_engine', event.target.value))} className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2">
      {!['sherpa', 'apple'].includes(status.selected) && <option value="">請選擇引擎</option>}
      <option value="sherpa">現有本機引擎（Sherpa）</option>
      <option value="apple" disabled={!status.appleAvailable && status.selected !== 'apple'}>Apple 原生引擎（macOS 26＋、Apple Silicon）</option>
    </select>
    <p role="status" className="text-sm text-gray-600 dark:text-gray-300">{speechStateLabels[status.state] || status.state}{status.isDownloading ? ` ${Math.round(status.downloadProgress)}%` : ''}</p>
    {status.selected === 'apple' && <>
      <label htmlFor="apple-response-profile" className="text-sm">Apple 辨識模式</label>
      <select id="apple-response-profile" value={status.profile || 'accurate'} disabled={saving || status.busy} onChange={event => run(() => window.electronAPI.selectSpeechEngine('apple_response_profile', event.target.value))} className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2">
        <option value="accurate">SpeechTranscriber・完整上下文（預設）</option>
        <option value="responsive">SpeechTranscriber・即時回饋（可能增加錯字）</option>
        <option value="dictation">DictationTranscriber・系統聽寫</option>
      </select>
      {status.profile === 'dictation' && <p className="text-xs text-amber-700 dark:text-amber-300">系統聽寫在部分測試音訊中會漏字，請以真人口述確認結果。</p>}
      <p className="text-xs text-gray-500">目前使用台灣繁體中文，支援可修訂預覽，停止並定稿後才貼上。保留 Apple 原生標點；辨識後詞庫仍可校正專有名詞。原生熱詞、依停頓分行與規則列點不適用。</p>
      <p className="text-xs text-gray-500">完整上下文的短句可能在停止後才出字；即時回饋與系統聽寫提供可修訂預覽，仍需比較選詞及漏字。系統聽寫使用另一套 Apple 模型，不保證與 iPhone 體驗相同。</p>
      <p className="text-xs text-gray-500">語音辨識在裝置端執行。若另啟用雲端 AI 潤稿，文字仍依該功能設定傳送。</p>
    </>}
    {status.state === 'needs_download' && <button disabled={saving} onClick={() => run(() => window.electronAPI.installSpeechAssets())} className="rounded-lg bg-blue-600 text-white px-3 py-2">下載所需模型</button>}
    {status.state === 'downloading' && <div className="space-y-2">
      <button disabled={status.busy} onClick={() => run(() => window.electronAPI.selectSpeechEngine('asr_engine', 'sherpa'))} className="rounded-lg border px-3 py-2">停止等待並選回現有本機引擎</button>
      <p className="text-xs text-gray-500">Apple 系統模型可能持續在背景下載。</p>
    </div>}
    {['failed', 'unavailable'].includes(status.state) && <button disabled={saving || status.busy} onClick={() => run(() => window.electronAPI.retrySpeechEngine())} className="rounded-lg border px-3 py-2">重新檢查</button>}
    {(error || status.error) && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{status.error || error}</p>}
    {status.busy && <p className="text-xs text-gray-500">工作完成後才能切換引擎或辨識偏好。</p>}
  </section>;
}

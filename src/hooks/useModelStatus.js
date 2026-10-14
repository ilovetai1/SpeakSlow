import { useState, useEffect, useCallback } from 'react';
import { speechError } from '../utils/speechEngineMessages.mjs';

export const useModelStatus = () => {
  const [status, setStatus] = useState({ selected: 'sherpa', state: 'checking', isReady: false });
  const checkModelStatus = useCallback(async () => {
    try {
      const next = await window.electronAPI.getSpeechEngineState();
      setStatus(next); return next;
    } catch { setStatus(previous => ({ ...previous, state: 'failed', reason: 'speech_status_failed', isReady: false })); }
  }, []);
  useEffect(() => {
    let active = true;
    window.electronAPI?.getSpeechEngineState?.().then(next => { if (active) setStatus(next); }).catch(() => { if (active) setStatus({ state: 'failed', reason: 'speech_status_failed', isReady: false }); });
    const remove = window.electronAPI?.onSpeechEngineState?.((_event, next) => { if (active) setStatus(next); });
    return () => { active = false; remove?.(); };
  }, []);
  useEffect(() => {
    if (status.state !== 'downloading') return;
    const timer = setInterval(checkModelStatus, 2000);
    return () => clearInterval(timer);
  }, [status.state, checkModelStatus]);
  const downloadModels = useCallback(async () => {
    const next = await window.electronAPI.installSpeechAssets();
    setStatus(next); return { success: next.state === 'ready', ...next };
  }, []);
  return {
    ...status,
    isLoading: ['checking', 'preparing', 'stopping'].includes(status.state),
    isDownloading: status.state === 'downloading',
    modelsDownloaded: ['ready', 'busy'].includes(status.state),
    stage: status.state === 'needs_download' ? 'need_download' : ['failed', 'unavailable'].includes(status.state) ? 'error' : status.state,
    error: status.reason ? speechError(status.reason) : null,
    downloadProgress: status.progress || 0,
    progress: status.isReady ? 100 : status.progress || 0,
    missingModels: [], checkModelStatus, downloadModels,
    checkModelFiles: checkModelStatus,
    getDownloadProgress: checkModelStatus,
  };
};

import { useCallback, useEffect, useRef, useState } from 'react';

const SETTING = 'enable_ai_optimization';

// 主面板與設定視窗共用已持久化的開關；草稿表單不持有另一份狀態。
export function useAiOptimization() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const writing = useRef(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    let active = true;
    let changed = false;
    const unsubscribe = api.onSettingChanged(({ key, value }) => {
      if (key !== SETTING || !active) return;
      changed = true;
      setEnabled(value === true);
      setReady(true);
    });
    api.getSetting(SETTING, false).then(value => {
      if (!active) return;
      // 載入期間的廣播比舊快照新，不讓舊讀取覆蓋它。
      if (!changed) setEnabled(value === true);
      setReady(true);
    }).catch(cause => {
      if (active) setError(cause);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const updateEnabled = useCallback(async value => {
    if (writing.current) return;
    writing.current = true;
    setPending(true);
    try {
      await window.electronAPI.setSetting(SETTING, value);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }, []);

  return { enabled, ready, pending, error, updateEnabled };
}

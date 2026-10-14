import { useCallback, useEffect, useRef, useState } from 'react';

// A settings test owns its capture independently from ASR. Merely opening or
// showing settings never starts it; every exit invalidates pending acquisitions.
export function useMicrophoneMonitor({ enabled, deviceId, autoGain, durationMs = 30000 }) {
  const [state, setState] = useState('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const resources = useRef({});
  const pending = useRef(false);
  const release = useCallback(() => {
    generation.current++;
    pending.current = false;
    const owned = resources.current;
    resources.current = {};
    clearTimeout(owned.timer);
    if (owned.raf) cancelAnimationFrame(owned.raf);
    owned.stream?.getTracks().forEach(track => track.stop());
    owned.source?.disconnect();
    owned.context?.close().catch(() => {});
  }, []);
  const stop = useCallback(() => {
    release(); setState('idle'); setLevel(0);
  }, [release]);
  useEffect(() => { stop(); return release; }, [enabled, deviceId, autoGain, stop, release]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', stop);
    window.addEventListener('beforeunload', stop);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', stop);
      window.removeEventListener('beforeunload', stop);
    };
  }, [stop]);
  const start = useCallback(async () => {
    if (!enabled || pending.current || document.hidden) return;
    release();
    const current = generation.current;
    pending.current = true;
    setState('starting'); setError(''); setLevel(0);
    // This bounds both permission waiting and active monitoring. A late grant
    // after the deadline still stops its acquired stream via generation check.
    resources.current.timer = setTimeout(stop, durationMs);
    if (!navigator.mediaDevices?.getUserMedia) {
      stop(); setError('unsupported'); return;
    }
    try {
      const audio = { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: autoGain !== false };
      if (deviceId) audio.deviceId = { exact: deviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      if (generation.current !== current) { stream.getTracks().forEach(track => track.stop()); return; }
      // Register ownership before creating nodes, so setup failure also closes
      // the already-acquired microphone instead of leaving an orphan stream.
      const owned = resources.current; owned.stream = stream;
      const Context = window.AudioContext || window.webkitAudioContext;
      owned.context = new Context();
      owned.source = owned.context.createMediaStreamSource(stream);
      const analyser = owned.context.createAnalyser(); analyser.fftSize = 1024;
      owned.source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      setState('listening');
      const tick = () => {
        if (generation.current !== current) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 8));
        owned.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      if (generation.current !== current) return;
      stop(); setError('unavailable');
    }
  }, [enabled, deviceId, autoGain, durationMs, release, stop]);
  return { state, level, error, start, stop };
}

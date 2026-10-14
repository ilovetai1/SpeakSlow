import React from "react";
import { createPcmTransport } from '../utils/pcmTransport.mjs';
import { useTranslation } from "../i18n";

// 把 Float32 PCM 重採樣到 16kHz、包成 16-bit mono WAV（與錄音用同一套規格）
function pcmToWav(float32, srcRate, dstRate = 16000) {
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(float32.length / ratio);
  const int16 = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, float32.length - 1);
    const frac = idx - lo;
    const s = float32[lo] * (1 - frac) + float32[hi] * frac;
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
  }
  const dataSize = int16.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const ws = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + dataSize, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, dstRate, true); v.setUint32(28, dstRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, dataSize, true);
  new Int16Array(buf, 44).set(int16);
  return new Uint8Array(buf);
}

// 秒數 -> SRT 時間格式 00:00:00,000
function secToSrt(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msr = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(msr, 3)}`;
}

// segments [{start,end,text}] -> SRT 字串（重新編號）
function buildSrt(segs) {
  return segs
    .map((g, i) => `${i + 1}\n${secToSrt(g.start)} --> ${secToSrt(g.end)}\n${g.text}`)
    .join("\n\n") + (segs.length ? "\n" : "");
}

const CHUNK_SEC = 60;

export default function TranscribeModal({ onClose }) {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState("idle"); // idle|decoding|transcribing|done|error
  const [progress, setProgress] = React.useState(0);
  const [transcript, setTranscript] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [errMsg, setErrMsg] = React.useState("");
  const [mode, setMode] = React.useState("txt"); // txt | srt
  const cancelRef = React.useRef(false);
  const jobRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const modeRef = React.useRef("txt");
  modeRef.current = mode;

  const run = React.useCallback(async (file) => {
    if (!file || jobRef.current) return;
    cancelRef.current = false; jobRef.current = { starting: true };
    setFileName(file.name); setStatus('decoding'); setTranscript(''); setProgress(0); setErrMsg('');
    let job;
    try {
      job = await window.electronAPI.beginSpeechJob('file'); jobRef.current = job;
      if (cancelRef.current) return;
      const arrayBuffer = await file.arrayBuffer();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const context = new Ctx(); let audioBuf;
      try { audioBuf = await context.decodeAudioData(arrayBuffer); } finally { await context.close(); }
      if (cancelRef.current) return;
      const srcRate = audioBuf.sampleRate;
      const data = audioBuf.numberOfChannels === 1 ? audioBuf.getChannelData(0) : new Float32Array(audioBuf.length);
      if (audioBuf.numberOfChannels > 1) for (let channel = 0; channel < audioBuf.numberOfChannels; channel++) {
        const plane = audioBuf.getChannelData(channel);
        for (let index = 0; index < data.length; index++) data[index] += plane[index] / audioBuf.numberOfChannels;
      }
      const srt = modeRef.current === 'srt';
      setStatus('transcribing');
      if (job.engine === 'apple') {
        await window.electronAPI.startSpeechSession(job.id, { sampleRate: srcRate, channelCount: 1 });
        const transport = createPcmTransport({ sampleRate: srcRate, send: packet => window.electronAPI.feedSpeechSession(job.id, packet) });
        const stride = Math.floor(srcRate / 10);
        for (let offset = 0; offset < data.length; offset += stride) {
          if (cancelRef.current) { transport.cancel(); return; }
          transport.push(data.subarray(offset, Math.min(offset + stride, data.length)));
          await transport.flush();
          setProgress(Math.round(Math.min(99, (offset + stride) / data.length * 100)));
        }
        const result = await window.electronAPI.finishSpeechSession(job.id, new Uint8Array(), { no_persist: true });
        if (cancelRef.current) return;
        if (srt) {
          if (!Array.isArray(result.segments) || result.segments.some(g => !Number.isFinite(g.start) || !Number.isFinite(g.end) || g.end <= g.start)) throw new Error('無可靠時間軸，未產生SRT');
          setTranscript(buildSrt(result.segments));
        } else setTranscript(result.text);
      } else {
        const chunkSamples = CHUNK_SEC * srcRate;
        const totalChunks = Math.max(1, Math.ceil(data.length / chunkSamples));
        let out = ''; const segments = [];
        for (let i = 0; i < totalChunks; i++) {
          if (cancelRef.current) return;
          const slice = data.subarray(i * chunkSamples, Math.min((i + 1) * chunkSamples, data.length));
          const result = await window.electronAPI.transcribeAudio(pcmToWav(slice, srcRate), { jobId: job.id, segments: srt, no_persist: true });
          if (!result?.success) throw new Error(result?.error || '檔案轉錄失敗，結果不完整');
          if (cancelRef.current) return;
          if (srt) {
            if (!Array.isArray(result.segments)) throw new Error('無可靠時間軸，未產生SRT');
            for (const g of result.segments) {
              if (!Number.isFinite(g.start) || !Number.isFinite(g.end) || g.end <= g.start) throw new Error('無可靠時間軸，未產生SRT');
              if (g.text?.trim()) segments.push({ start: g.start + i * CHUNK_SEC, end: g.end + i * CHUNK_SEC, text: g.text.trim() });
            }
            setTranscript(buildSrt(segments));
          } else { out += (out ? '\n' : '') + result.text.trim(); setTranscript(out); }
          setProgress(Math.round((i + 1) / totalChunks * 100));
        }
      }
      setProgress(100); setStatus('done');
    } catch (issue) {
      if (!cancelRef.current) { setErrMsg(issue?.message || '轉錄失敗，結果不完整'); setStatus('error'); }
    } finally {
      if (job) await window.electronAPI.endSpeechJob(job.id, cancelRef.current).catch(() => {});
      jobRef.current = null;
      if (cancelRef.current) setStatus('idle');
    }
  }, []);

  React.useEffect(() => () => {
    cancelRef.current = true;
    if (jobRef.current?.id) window.electronAPI.endSpeechJob(jobRef.current.id, true).catch(() => {});
  }, []);

  const onPick = (e) => { const f = e.target.files?.[0]; if (f) run(f); };
  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) run(f);
  };

  const copyAll = async () => {
    try { await window.electronAPI?.copyText?.(transcript); } catch (e) { /* ignore */ }
  };
  const exportTxt = () => {
    try {
      const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (fileName ? fileName.replace(/\.[^.]+$/, "") : "transcript") + (mode === "srt" ? ".srt" : ".txt");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { /* ignore */ }
  };

  const busy = status === "decoding" || status === "transcribing";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900 rounded-xl overflow-hidden" style={{ WebkitAppRegion: "no-drag" }}>
      {/* 標題列（可拖曳移動視窗） */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-gray-200 dark:border-gray-700 shrink-0" style={{ WebkitAppRegion: "drag" }}>
        <div className="flex items-center gap-2 min-w-0">
          <img src="./icon.png" alt="" className="w-5 h-5 rounded-md shrink-0" draggable="false" />
          <span className="brand-title text-base font-bold text-gray-900 dark:text-gray-100">{t("appName")}</span>
        </div>
        <button onClick={onClose} style={{ WebkitAppRegion: "no-drag" }} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
        {/* 拖放 / 選檔 */}
        {status === "idle" || status === "error" ? (
          <>
          {/* 輸出格式：逐字稿 / 字幕 SRT */}
          <div className="shrink-0 flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm">
            {[["txt", t("transcribe.outTxt")], ["srt", t("transcribe.outSrt")]].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMode(k)}
                className={`flex-1 px-3 py-1.5 rounded-md transition-colors ${
                  mode === k
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-medium shadow-sm"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="shrink-0 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl py-6 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-colors"
          >
            <div className="text-3xl mb-1">🎬</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">{t("transcribe.drop")}</div>
            <div className="text-xs text-gray-400 mt-1">{t("transcribe.formats")}</div>
            {status === "error" && (
              <div className="mt-2">
                <div className="text-xs text-red-500">{t("transcribe.failed")}：{errMsg}</div>
                <div className="text-xs text-gray-400 mt-1">{t("transcribe.failedHint")}</div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="video/*,audio/*,.mp4,.mov,.mkv,.webm,.mp3,.wav,.m4a,.ogg,.flac" className="hidden" onChange={onPick} />
          </div>
          </>
        ) : (
          <div className="shrink-0">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span className="truncate max-w-[60%]">{fileName}</span>
              <span>{status === "decoding" ? t("transcribe.decoding") : `${progress}%`}</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${status === "decoding" ? 5 : progress}%` }} />
            </div>
          </div>
        )}

        {/* 逐字稿結果 */}
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={t("transcribe.empty")}
          className="flex-1 min-h-0 w-full resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed outline-none"
          style={{ whiteSpace: "pre-wrap" }}
        />

        {/* 動作列 */}
        <div className="shrink-0 flex items-center gap-2">
          {busy ? (
            <button onClick={() => { cancelRef.current = true; if (jobRef.current?.id) window.electronAPI.endSpeechJob(jobRef.current.id, true).catch(() => {}); }} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
              {t("transcribe.stop")}
            </button>
          ) : (
            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
              {t("transcribe.another")}
            </button>
          )}
          <div className="flex-1" />
          <button disabled={!transcript} onClick={copyAll} className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40">{t("transcribe.copy")}</button>
          <button disabled={!transcript || status !== "done"} onClick={exportTxt} className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40">{mode === "srt" ? t("transcribe.exportSrt") : t("transcribe.export")}</button>
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useCallback, useEffect } from 'react';
import { convertText, useTranslation } from '../i18n';
import { createPcmTransport } from '../utils/pcmTransport.mjs';
import { speechError } from '../utils/speechEngineMessages.mjs';
import { beginLatency } from '../utils/latencyRecorder.mjs';
import { createSingleFlightGate, finalizeTranscript } from '../utils/transcriptFinalization.mjs';

/**
 * 录音功能Hook
 * 提供录音、停止录音、音频处理等功能
 * @param modelStatus 由呼叫端（App）傳入共用的 useModelStatus 實例 —
 *   不在這裡自建，避免兩套 3 秒輪詢與重複事件訂閱同時跑。
 */
export const useRecording = (modelStatus) => {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState(null);
  const [audioData, setAudioData] = useState(null);

  const streamRef = useRef(null);
  const speechJobRef = useRef(null);
  const appleTransportRef = useRef(null);
  const stoppingRef = useRef(false);
  const startingRef = useRef(false);
  const cancellingRef = useRef(false);
  const cancelledRef = useRef(false);
  const [previewText, setPreviewText] = useState('');
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);

  // PCM 音頻數據緩衝區（直接錄製 PCM，不需要解碼 webm）
  const pcmBufferRef = useRef([]);

  // 添加防重复处理机制
  const processingRef = useRef({ isProcessingAudio: false, lastProcessTime: 0 });
  const metricRef = useRef(null);
  const evolutionRef = useRef({});
  const pipelineGateRef = useRef(null);
  if (!pipelineGateRef.current) pipelineGateRef.current = createSingleFlightGate();

  // 邊錄邊算（precog）：長講時錄音中先解碼已講完的段落，停止只剩尾段。
  // 錄音超過 PRECOG_START_SEC 才啟動 — 短句維持單次解碼路徑（保留停頓斷行）。
  const PRECOG_START_SEC = 12;
  const precogRef = useRef({ active: false, fedChunks: 0, timer: null });

  const stopPrecogTimer = useCallback(() => {
    if (precogRef.current.timer) {
      clearInterval(precogRef.current.timer);
      precogRef.current.timer = null;
    }
  }, []);

  // Float32 (sourceRate) → Int16 16kHz → base64
  const chunksToPcm16Base64 = (chunks, sourceRate) => {
    const total = chunks.reduce((s, a) => s + a.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    const ratio = sourceRate / 16000;
    const outLen = Math.floor(merged.length / ratio);
    const int16 = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, merged.length - 1);
      const frac = idx - lo;
      const s = merged[lo] * (1 - frac) + merged[hi] * frac;
      int16[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    const bytes = new Uint8Array(int16.buffer);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  };

  // 麥克風權限狀態快取
  const micPermissionRef = useRef('unknown');

  // 預查詢麥克風權限狀態
  useEffect(() => {
    const checkMicPermission = async () => {
      if (navigator.permissions) {
        try {
          const result = await navigator.permissions.query({ name: 'microphone' });
          micPermissionRef.current = result.state;
          result.onchange = () => {
            micPermissionRef.current = result.state;
          };
        } catch (e) {
          // 某些瀏覽器不支援 permissions API
        }
      }
    };
    checkMicPermission();
  }, []);

  // 清理資源
  const cleanup = useCallback(() => {
    stopPrecogTimer(); // 停止邊錄邊算的餵入（不 abort：成功路徑還要取用結果）
    // 錄音正常結束/取消 → 收掉崩潰救援暫存檔（這段已正常處理，不是孤兒）
    try { window.electronAPI?.recoveryEnd?.(); } catch (e) { /* ignore */ }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    pcmBufferRef.current = [];
  }, [stopPrecogTimer]);

  // 开始录音（使用 ScriptProcessor 直接錄製 PCM，避免 webm 解碼問題）
  const startRecording = useCallback(async () => {
    if (!pipelineGateRef.current.tryStart()) {
      setError('上一段錄音仍在處理中');
      return false;
    }
    startingRef.current = true; cancelledRef.current = false;
    let startedJob;
    try {
      startedJob = await window.electronAPI.beginSpeechJob('recording');
      speechJobRef.current = startedJob;
      if (cancelledRef.current) throw new Error('session_closed');
      setPreviewText('');
      appleTransportRef.current?.cancel(); appleTransportRef.current = null;
      metricRef.current = await beginLatency(await window.electronAPI?.getCommandMode?.() === true ? 'command' : 'offline');
      setError(null);

      // 检查 Sherpa 是否就绪
      if (!modelStatus.isReady) {
        if (modelStatus.isLoading) {
          throw new Error(t('errors.asrStarting'));
        } else if (modelStatus.error) {
          throw new Error(t('errors.asrNotReady'));
        } else {
          throw new Error(t('errors.asrPreparing'));
        }
      }

      // 检查浏览器支持
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(t('errors.browserNoRecording'));
      }

      if (speechJobRef.current.engine === 'apple') {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
        const id = speechJobRef.current.id;
        await window.electronAPI.startSpeechSession(id, { sampleRate: audioContext.sampleRate, channelCount: 1 });
        if (cancelledRef.current) throw new Error('session_closed');
        appleTransportRef.current = createPcmTransport({
          sampleRate: audioContext.sampleRate,
          send: packet => window.electronAPI.feedSpeechSession(id, packet),
          onFailure: issue => {
            setError(speechError(issue));
            setIsRecording(false); setIsProcessing(false);
            cleanup(); metricRef.current?.finish('failed');
            speechJobRef.current = null;
            window.electronAPI.endSpeechJob(id, true).finally(() => pipelineGateRef.current.finish());
          },
        });
      }

      // ⚡ 立即設定錄音狀態，讓 UI 馬上反應
      if (micPermissionRef.current === 'granted') {
        setIsRecording(true);
      }

      // 请求麦克风权限
      // 讀取使用者指定的麥克風 + 自動增益設定（沒指定就用系統預設）
      let savedMicId = '';
      let agcOn = true;
      try {
        savedMicId = (await window.electronAPI?.getSetting?.('mic_device_id', '')) || '';
        agcOn = (await window.electronAPI?.getSetting?.('mic_auto_gain', true)) !== false;
      } catch (e) { /* 讀不到就用預設 */ }

      const audioConstraints = {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: agcOn
      };
      if (savedMicId) audioConstraints.deviceId = { exact: savedMicId };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (err) {
        // 指定的麥克風不在了（拔掉 / 換 USB 孔）→ 退回系統預設，別讓錄音直接掛掉
        if (savedMicId) {
          if (window.electronAPI?.log) window.electronAPI.log('warn', `指定的麥克風不可用，改用預設: ${err.message}`);
          delete audioConstraints.deviceId;
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        } else {
          throw err;
        }
      }

      if (cancelledRef.current) { stream.getTracks().forEach(track => track.stop()); throw new Error('session_closed'); }

      // 更新狀態
      if (micPermissionRef.current !== 'granted') {
        micPermissionRef.current = 'granted';
        setIsRecording(true);
      }

      streamRef.current = stream;
      pcmBufferRef.current = [];

      // 記錄實際使用的麥克風裝置（協助確認收音來源）
      try {
        const micTrack = stream.getAudioTracks()[0];
        const micSettings = micTrack?.getSettings?.() || {};
        let label = micTrack?.label || '';
        // label 為空時，用 enumerateDevices 透過 deviceId 反查名稱
        if (!label && micSettings.deviceId && navigator.mediaDevices?.enumerateDevices) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const dev = devices.find(
              (d) => d.kind === 'audioinput' && d.deviceId === micSettings.deviceId
            );
            label = dev?.label || '';
          } catch (e) { /* ignore */ }
        }
        const msg =
          `🎤 使用麥克風: label="${label || '(未知)'}" ` +
          `sampleRate=${micSettings.sampleRate} NS=${micSettings.noiseSuppression} ` +
          `AGC=${micSettings.autoGainControl} EC=${micSettings.echoCancellation}`;
        if (window.electronAPI?.log) window.electronAPI.log('info', msg);
        console.log(msg);
      } catch (logErr) {
        // 記錄失敗不影響錄音
      }

      // 創建 AudioContext（使用預設採樣率，讓瀏覽器自動處理）
      const audioContext = audioContextRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      // 確保 AudioContext 是活躍的
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // 創建音源節點
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // 創建 ScriptProcessor 來獲取原始 PCM 數據
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        // 複製數據到緩衝區
        pcmBufferRef.current.push(new Float32Array(inputData));
        appleTransportRef.current?.push(inputData);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // 邊錄邊算：每秒檢查，超過門檻就啟動 precog 並持續餵新音訊
      // 效能模式（asr_profile: standard | fast）跟正式辨識用同一顆模型
      let asrProfile = 'standard';
      try {
        asrProfile = speechJobRef.current?.engine === 'sherpa' ? speechJobRef.current.profile : 'standard';
      } catch (e) { /* 預設 standard */ }
      precogRef.current = { active: false, fedChunks: 0, recoveryFed: 0, timer: null, profile: asrProfile };
      const srcRate = audioContext.sampleRate;
      // 崩潰救援：開一條暫存檔，錄音中持續寫入；正常/取消停止時會刪掉
      try { window.electronAPI?.recoveryBegin?.(); } catch (e) { /* ignore */ }
      precogRef.current.timer = setInterval(async () => {
        try {
          const p = precogRef.current;
          const chunks = pcmBufferRef.current;
          const totalSamples = chunks.reduce((s, a) => s + a.length, 0);
          // 崩潰救援：每秒把新音訊 append 到暫存檔（不管 precog 有沒有啟動）
          if (chunks.length > (p.recoveryFed || 0)) {
            const recNew = chunks.slice(p.recoveryFed || 0);
            p.recoveryFed = chunks.length;
            try {
              const rb64 = chunksToPcm16Base64(recNew, srcRate);
              window.electronAPI?.recoveryAppend?.(rb64);
            } catch (e) { /* 救援失敗不影響錄音 */ }
          }
          if (speechJobRef.current?.engine === 'apple') return;
          if (!p.active) {
            if (totalSamples / srcRate < PRECOG_START_SEC) return;
            const r = await window.electronAPI?.precogStart?.(p.profile, speechJobRef.current?.id);
            if (!r?.success) { stopPrecogTimer(); return; } // 後端不支援就放棄
            p.active = true;
          }
          const newChunks = chunks.slice(p.fedChunks);
          if (newChunks.length === 0) return;
          p.fedChunks = chunks.length;
          const b64 = chunksToPcm16Base64(newChunks, srcRate);
          window.electronAPI?.precogFeed?.(b64, speechJobRef.current?.id);
        } catch (err) {
          stopPrecogTimer(); // 任何錯誤 → 停止餵，回退一般路徑
        }
      }, 1000);

      if (metricRef.current) metricRef.current.record('capture', 'success', metricRef.current.clock() - metricRef.current.captureStart);
    } catch (err) {
      metricRef.current?.finish('failed');
      if (!cancelledRef.current) setError(t('errors.cannotStartRecording', { error: err.message }));
      setIsRecording(false);
      cleanup();
      appleTransportRef.current?.cancel(); appleTransportRef.current = null;
      const failedJob = startedJob; if (speechJobRef.current?.id === startedJob?.id) speechJobRef.current = null;
      if (failedJob) await window.electronAPI.endSpeechJob(failedJob.id, true).catch(() => {});
      pipelineGateRef.current.finish();
      return false;
    } finally { startingRef.current = false; }
    return true;
  }, [modelStatus.isReady, modelStatus.isLoading, modelStatus.error, cleanup, t]);

  // 停止录音
  const stopRecording = useCallback(async () => {
    if (!isRecording || stoppingRef.current) return;
    stoppingRef.current = true;
    const stoppedJob = speechJobRef.current;
    const stoppedTransport = appleTransportRef.current;

    metricRef.current?.stop();
    if (processorRef.current) { processorRef.current.onaudioprocess = null; processorRef.current.disconnect(); }
    sourceRef.current?.disconnect();
    setIsRecording(false);
    setIsProcessing(true);

    try {
      // 檢查是否有錄音數據
      if (pcmBufferRef.current.length === 0) {
        throw new Error(t('errors.emptyRecording'));
      }

      // 獲取原始採樣率
      const sourceSampleRate = audioContextRef.current?.sampleRate || 48000;

      // 合併所有 PCM 數據
      const totalLength = pcmBufferRef.current.reduce((sum, arr) => sum + arr.length, 0);

      if (totalLength < sourceSampleRate * 0.1) { // 小於 0.1 秒的錄音
        throw new Error(t('errors.recordingTooShort'));
      }

      const mergedBuffer = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of pcmBufferRef.current) {
        mergedBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      // 邊錄邊算：停止餵入；若已啟動，餵完最後一批再帶 flag 取結果
      stopPrecogTimer();
      const precogActive = precogRef.current.active;
      if (precogActive) {
        try {
          const lastChunks = pcmBufferRef.current.slice(precogRef.current.fedChunks);
          if (lastChunks.length > 0) {
            const b64 = chunksToPcm16Base64(lastChunks, sourceSampleRate);
            await window.electronAPI?.precogFeed?.(b64, speechJobRef.current?.id);
          }
        } catch (e) {
          /* 餵尾失敗 → 後端 finalize 拿不到完整 precog，會自動回退一般路徑 */
        }
      }

      await appleTransportRef.current?.flush();
      if (cancelledRef.current) return;

      // 清理資源
      cleanup();

      // 直接轉換為 WAV（重採樣到 16kHz）
      const wavBuffer = pcmToWav(mergedBuffer, sourceSampleRate, 16000);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

      setAudioData(wavBlob);

      // 處理音頻
      const autoFormatLists = await window.electronAPI?.getSetting?.('auto_format_lists', false);
      const autoLineBreak = await window.electronAPI?.getSetting?.('auto_line_break', false);
      const saveAudio = await window.electronAPI?.getSetting?.('save_audio', true);
      await processAudio(wavBlob, {
        jobId: speechJobRef.current?.id,
        use_precog: precogActive,
        profile: precogRef.current.profile || 'standard',
        auto_format_lists: autoFormatLists === true,
        auto_line_break: autoLineBreak === true,
        save_audio: saveAudio !== false,
      });
    } catch (err) {
      metricRef.current?.finish('failed');
      if (!cancelledRef.current) setError(t('errors.audioProcessingFailed', { error: err.message }));
      cleanup();
    } finally {
      if (speechJobRef.current?.id === stoppedJob?.id) speechJobRef.current = null;
      stoppedTransport?.cancel(); if (appleTransportRef.current === stoppedTransport) appleTransportRef.current = null;
      if (stoppedJob) await window.electronAPI.endSpeechJob(stoppedJob.id, cancelledRef.current).catch(() => {});
      setPreviewText('');
      setIsProcessing(false);
      stoppingRef.current = false;
      pipelineGateRef.current.finish();
    }
  }, [isRecording, cleanup, t]);

  // 处理音频（接收已經是 WAV 格式的 blob）
  const processAudio = useCallback(async (wavBlob, transcribeOptions = {}) => {
    processingRef.current.isProcessingAudio = true;

    try {
      if (window.electronAPI) {
        const arrayBuffer = await wavBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const job = speechJobRef.current;
        const invokeASR = () => job?.engine === 'apple'
          ? window.electronAPI.finishSpeechSession(job.id, uint8Array, transcribeOptions)
          : window.electronAPI.transcribeAudio(uint8Array, transcribeOptions);
        const transcriptionResult = metricRef.current ? await metricRef.current.measure('asr', invokeASR) : await invokeASR();

        if (transcribeOptions.jobId && speechJobRef.current?.id !== transcribeOptions.jobId) return { cancelled: true };
        if (metricRef.current?.stopped !== null) metricRef.current?.record('stop_to_asr_final', 'success', metricRef.current.clock() - metricRef.current.stopped);
        if (transcriptionResult.success) {
          let raw_text = transcriptionResult.text;

          // 防幻聽第二道防線：空結果（純靜音/噪音）不貼上、不存檔、不跑 AI
          if (!raw_text || !raw_text.trim()) {
            console.log('未偵測到語音，跳過貼上與儲存');
            processingRef.current.isProcessingAudio = false;
            metricRef.current?.finish('skipped');
            return;
          }

          // 检查是否需要转换为繁体中文
          const targetLang = await window.electronAPI.getSetting('language', 'zh-TW');
          const shouldConvert = await window.electronAPI.getSetting('convert_transcription', true);

          if (shouldConvert && targetLang === 'zh-TW') {
            raw_text = convertText(raw_text, 'zh-TW');
          }

          // 套用字典替換（校正專有名詞）
          try {
            const scoped = window.electronAPI.applyDictionaryWithContext ? await window.electronAPI.applyDictionaryWithContext(raw_text) : { text: await window.electronAPI.applyDictionary(raw_text) };
            evolutionRef.current = { scopeHandle: scoped.scopeHandle, dictionaryContext: scoped.bundleId, dictionaryStatus: scoped.status };
            const dictResult = scoped.text;
            if (dictResult && dictResult !== raw_text) {
              raw_text = dictResult;
            }
          } catch (dictErr) {
            // 字典替換失敗不影響主流程
            console.warn('字典替換失敗:', dictErr);
          }

          // 准备转录数据
          const transcriptionData = {
            raw_text: raw_text,
            text: raw_text, // 初始文本设为原始文本
            confidence: transcriptionResult.confidence || 0,
            language: targetLang,
            duration: transcriptionResult.duration || 0,
            file_size: uint8Array.length,
            audio_path: transcriptionResult.audio_path || null, // 音訊檔案路徑
          };

          // 立即显示初步结果（已转换）
          if (window.onTranscriptionComplete) {
            window.onTranscriptionComplete({ ...transcriptionResult, text: raw_text, enhanced_by_ai: false });
          }

          const useAI = await window.electronAPI.getSetting('enable_ai_optimization', false);
          const commandMode = await window.electronAPI.getCommandMode?.() === true;
          setIsOptimizing(useAI && !commandMode);
          const finalized = await finalizeTranscript({
            rawText: raw_text,
            isCancelled: () => speechJobRef.current?.id !== transcribeOptions.jobId,
            polishingEnabled: useAI,
            commandMode,
            transcriptionData,
            processText: async (text, mode) => {
              const invokePolish = () => window.electronAPI.processText(text, mode, { workflow: 'automatic_offline', scopeHandle: evolutionRef.current.scopeHandle, metricId: metricRef.current?.id });
              const result = metricRef.current ? await metricRef.current.measure('polish', invokePolish) : await invokePolish();
              evolutionRef.current.contextStatus = result?.contextStatus || 'off';
              if (result?.success && shouldConvert && targetLang === 'zh-TW') {
                return { ...result, text: convertText(result.text, 'zh-TW') };
              }
              return result;
            },
            saveTranscription: (data) => metricRef.current ? metricRef.current.measure('history_save', () => window.electronAPI.saveTranscription(data)) : window.electronAPI.saveTranscription(data),
          });
          setIsOptimizing(false);

          if (finalized.cancelled) { metricRef.current?.finish('cancelled'); return { ...transcriptionResult, cancelled: true }; }

          if (speechJobRef.current?.id !== transcribeOptions.jobId) return { cancelled: true };
          if (window.onAIOptimizationComplete) {
            await window.onAIOptimizationComplete({
              ...transcriptionResult,
              success: true,
              text: finalized.finalText,
              enhanced_by_ai: finalized.polished,
              issue: finalized.issue,
              contextStatus: evolutionRef.current.contextStatus,
              dictionaryContext: evolutionRef.current.dictionaryContext,
              dictionaryStatus: evolutionRef.current.dictionaryStatus,
            });
          }

          if (!window.onAIOptimizationComplete) metricRef.current?.outputDone();
          return { ...transcriptionResult, enhanced_by_ai: false };
        } else {
          throw new Error(transcriptionResult.error || t('errors.transcriptionFailed'));
        }
      } else {
        // Web环境模拟
        const mockResult = { success: true, text: '模拟识别结果。', confidence: 0.95, duration: 3.5 };
        if (window.onTranscriptionComplete) window.onTranscriptionComplete(mockResult);
        return mockResult;
      }
    } catch (err) {
      metricRef.current?.finish('failed');
      throw new Error(t('errors.audioProcessingFailed', { error: err.message }));
    } finally {
      processingRef.current.isProcessingAudio = false;
      metricRef.current?.pipelineDone();
      setIsOptimizing(false);
    }
  }, [t]);

  // PCM 數據直接轉 WAV（帶重採樣）- 不需要 decodeAudioData
  const pcmToWav = (pcmData, sourceSampleRate, targetSampleRate) => {
    const sourceLength = pcmData.length;

    // 計算重採樣後的長度
    const resampleRatio = targetSampleRate / sourceSampleRate;
    const targetLength = Math.round(sourceLength * resampleRatio);

    // 線性插值重採樣
    const resampledData = new Float32Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      const sourceIndex = i / resampleRatio;
      const index0 = Math.floor(sourceIndex);
      const index1 = Math.min(index0 + 1, sourceLength - 1);
      const fraction = sourceIndex - index0;
      resampledData[i] = pcmData[index0] * (1 - fraction) + pcmData[index1] * fraction;
    }

    const bytesPerSample = 2;
    const numberOfChannels = 1;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = targetSampleRate * blockAlign;
    const dataSize = targetLength * blockAlign;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAV 文件頭
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, targetSampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // 音頻數據
    let offset = 44;
    for (let i = 0; i < targetLength; i++) {
      const sample = Math.max(-1, Math.min(1, resampledData[i]));
      view.setInt16(offset, sample * 0x7FFF, true);
      offset += 2;
    }

    return buffer;
  };

  // 取消录音
  const cancelRecording = useCallback(() => {
    if (cancellingRef.current) return;
    cancelledRef.current = true;
    metricRef.current?.finish('cancelled');
    appleTransportRef.current?.cancel(); appleTransportRef.current = null;
    const job = speechJobRef.current; speechJobRef.current = null;
    if (job && (startingRef.current || stoppingRef.current)) window.electronAPI.cancelSpeechJob(job.id).catch(() => {});
    const releaseJob = job && !startingRef.current && !stoppingRef.current;
    if (releaseJob) cancellingRef.current = true;
    setPreviewText('');
    stopPrecogTimer();
    if (precogRef.current.active) {
      precogRef.current.active = false;
      window.electronAPI?.precogAbort?.(job?.id);
    }
    cleanup();
    setIsRecording(false);
    setIsProcessing(!!releaseJob);
    setIsOptimizing(false);
    setError(null);
    if (releaseJob) {
      // Keep both UI and local gate busy until the main process releases its lease.
      window.electronAPI.endSpeechJob(job.id, true)
        .catch(issue => setError(speechError(issue)))
        .finally(() => {
          cancellingRef.current = false;
          setIsProcessing(false);
          pipelineGateRef.current.finish();
        });
    } else if (!startingRef.current && !stoppingRef.current) pipelineGateRef.current.finish();
  }, [cleanup, stopPrecogTimer]);

  useEffect(() => {
    const removePreview = window.electronAPI?.onSpeechPreview?.((_event, data) => {
      if (speechJobRef.current?.id !== data.jobId) return;
      setPreviewText(data.text);
      if (metricRef.current && !metricRef.current.hasPreview && data.text.trim()) {
        metricRef.current.hasPreview = true;
        metricRef.current.record('first_preview', 'success', metricRef.current.clock() - metricRef.current.captureStart);
      }
    });
    const removeError = window.electronAPI?.onSpeechJobError?.((_event, data) => {
      if (speechJobRef.current?.id !== data.jobId) return;
      cancelRecording(); setError(speechError(data.error));
    });
    return () => { removePreview?.(); removeError?.(); };
  }, [cancelRecording]);

  useEffect(() => () => {
    const job = speechJobRef.current; speechJobRef.current = null;
    appleTransportRef.current?.cancel(); cleanup();
    if (job) window.electronAPI?.endSpeechJob?.(job.id, true).catch(() => {});
  }, [cleanup]);

  // 获取录音权限状态
  const checkPermissions = useCallback(async () => {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' });
      return result.state; // 'granted', 'denied', 'prompt'
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('warn', '无法检查麦克风权限:', err);
      }
      return 'unknown';
    }
  }, []);


  return {
    isRecording,
    isProcessing,
    isOptimizing,
    error,
    audioData,
    previewText,
    startRecording,
    stopRecording,
    cancelRecording,
    checkPermissions
  };
};

let current = null;
export function currentLatency() { return current; }
export async function beginLatency(mode, api = window.electronAPI, clock = () => performance.now()) {
  api?.recordingStarted?.();
  let enabled;
  try { enabled = await api?.getSetting?.('latency_metrics_enabled', true); }
  catch { api?.latencyUnavailable?.(); current = null; return null; }
  if (enabled === false || !api?.startLatencySession) { current = null; return null; }
  const started = clock(); let id;
  try { id = await api.startLatencySession(mode); }
  catch { api?.latencyUnavailable?.(); current = null; return null; }
  if (!id) { current = null; return null; }
  current = {
    id, stopped: null, captureStart: started, clock,
    record(stage, outcome, duration = null) { try { api.recordLatency?.(id, stage, outcome, duration); } catch { api?.latencyUnavailable?.(); } },
    async measure(stage, run) {
      const start = clock();
      try { const value = await run(); this.record(stage, value?.success === false ? 'failed' : 'success', clock() - start); return value; }
      catch (error) { this.record(stage, 'failed', clock() - start); throw error; }
    },
    stop() { this.stopped = clock(); },
    outputDone() { this.outputComplete = true; if (this.pipelineComplete) this.finish(); },
    pipelineDone() { this.pipelineComplete = true; if (this.outputComplete) this.finish(); },
    finish(outcome = 'skipped') { try { api.finishLatency?.(id, outcome); } catch { api?.latencyUnavailable?.(); } if (current?.id === id) current = null; },
  };
  return current;
}

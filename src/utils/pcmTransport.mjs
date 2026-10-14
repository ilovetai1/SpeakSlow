// Bounded renderer-side transport. Every accepted frame is acknowledged or the
// entire job fails; there is no silent audio dropping or truncated success.
export function createPcmTransport({ sampleRate, send, onFailure = () => {} }) {
  const stride = Math.floor(sampleRate / 10);
  let chunks = [], count = 0, pending = 0, sequence = 0, failure = null, closed = false;
  let chain = Promise.resolve();
  const fail = error => { if (!failure) { failure = error; onFailure(error); } };
  const enqueue = samples => {
    if (pending + samples.length > sampleRate * 2) { fail(new Error('audio_backpressure')); return; }
    pending += samples.length;
    const bytes = new Uint8Array(samples.length * 2); const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), true);
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const packet = { pcm: btoa(binary), frames: samples.length, sampleRate, channelCount: 1, sequence: sequence++ };
    chain = chain.then(async () => { if (failure || closed) return; await send(packet); }).catch(fail).finally(() => { pending -= samples.length; });
  };
  const consume = frames => {
    const output = new Float32Array(frames); let offset = 0;
    while (offset < frames) {
      const first = chunks[0]; const take = Math.min(first.length, frames - offset);
      output.set(first.subarray(0, take), offset); offset += take;
      if (take === first.length) chunks.shift(); else chunks[0] = first.subarray(take);
    }
    count -= frames; return output;
  };
  return {
    push(samples) {
      if (closed || failure) return;
      chunks.push(new Float32Array(samples)); count += samples.length;
      while (count >= stride && !failure) enqueue(consume(stride));
    },
    async flush() {
      if (count && !failure) enqueue(consume(count));
      await chain;
      if (failure) throw failure;
    },
    cancel() { closed = true; chunks = []; count = 0; },
    get failed() { return failure; },
  };
}

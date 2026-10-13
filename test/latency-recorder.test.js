const test=require('node:test'),assert=require('node:assert/strict');
test('renderer timing has its own clock, closes only after history and output; failures are visible',async()=>{
 const {beginLatency,currentLatency}=await import('../src/utils/latencyRecorder.mjs');let now=100000;const calls=[];const api={getSetting:async()=>true,recordingStarted:()=>calls.push('start'),startLatencySession:async()=> 'opaque',recordLatency:(...args)=>calls.push(args),finishLatency:()=>calls.push('finish')};
 const r=await beginLatency('streaming',api,()=>now);now+=20;r.stop();await r.measure('history_save',async()=>{now+=5;return {success:true};});r.outputDone();assert.equal(currentLatency(),r);r.pipelineDone();assert.equal(currentLatency(),null);assert.equal(calls.filter(c=>c==='finish').length,1);assert.equal(calls.find(Array.isArray)[3],5);
 let unavailable=0;const broken={...api,getSetting:async()=>{throw Error('isolated failure');},latencyUnavailable:()=>unavailable++};assert.equal(await beginLatency('offline',broken),null);assert.equal(unavailable,1);
 const disabled={...api,getSetting:async()=>false,startLatencySession:()=>{throw Error('must not observe');}};assert.equal(await beginLatency('offline',disabled),null);
});

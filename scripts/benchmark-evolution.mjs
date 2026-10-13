import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const AI=require('../src/helpers/aiTextProcessor');
const { LatencyManager,percentile }=require('../src/helpers/latencyManager');
const destination=process.argv[2];
if(!destination) throw Error('Specify a result directory; never use a real user database.');
fs.mkdirSync(destination,{recursive:true});
const corpus=JSON.parse(fs.readFileSync(new URL('../test/fixtures/evolution-corpus.json',import.meta.url)));
const calibration=JSON.parse(fs.readFileSync(path.join(destination,'context-budget-result.json'))).calibration;
if(!calibration)throw Error('Run the explicit local budget calibration first.');
const settings=new Map([['ai_provider','ollama'],['ai_model',calibration.model],['enable_ai_optimization',true],['context_budget_v1',calibration]]);
const database={getSetting:(k,d)=>settings.has(k)?settings.get(k):d,setSetting:(k,v)=>settings.set(k,structuredClone(v))};
const processor=new AI(database,{info(){},error(){}});
const results=[];
try{
 for(let index=0;index<corpus.length;index++){
  const c=corpus[index];settings.set('writing_profile',c.profile||'neutral');
  processor.contextManager={capture:async()=>({status:'available',handle:'fixture'}),consume:async()=>({status:'available',text:{before:c.before||'這是合成測試欄位。',selected:'',after:''}})};
  const pair={index,text:c.text};
  for(const enabled of [false,true]){
   settings.set('context_aware_polishing_enabled',enabled);const start=performance.now();
   const r=await processor.processTextWithAI(c.text,'optimize',null,{workflow:'automatic_offline'});
   pair[enabled?'on':'off']={success:r.success,text:r.text,code:r.code,contextStatus:r.contextStatus,ms:performance.now()-start,checks:(!c.must||c.must.every(x=>r.text?.includes(x)))&&(!c.forbidden||!r.text?.includes(c.forbidden))};
  }
  results.push(pair);fs.writeFileSync(path.join(destination,'corpus-results.json'),JSON.stringify({model:calibration.model,digest:calibration.digest,scope:'synthetic local model fixture, not end-to-end microphone/AX acceptance',results},null,2));
  process.stdout.write(`case ${index+1}/${corpus.length}: ${pair.off.success&&pair.on.success?'completed':'failed'}\n`);
 }
 // The fixture isolates instrumentation cost; it is not microphone/paste latency.
 const pairs=[]; const manager=new LatencyManager(database);
 for(let index=0;index<30;index++){
  const samples={};
  for(const enabled of index%2?[true,false]:[false,true]){
   manager.configure(enabled);const start=performance.now();const id=manager.start('offline');
   await new Promise(resolve=>setTimeout(resolve,10));
   if(id){manager.record(id,'asr','success',performance.now()-start);manager.finish(id,'skipped');}
   samples[enabled?'on':'off']=performance.now()-start;
  }
  pairs.push(samples);
 }
 const offP95=percentile(pairs.map(p=>p.off),.95), overheadP95=percentile(pairs.map(p=>p.on-p.off),.95),budget=Math.max(10,offP95*.02);
 fs.writeFileSync(path.join(destination,'instrumentation-results.json'),JSON.stringify({scope:'30 paired process-local timer fixtures on real hardware with isolated in-memory settings; no microphone, SQLite or IPC',pairs,offP95,overheadP95,budget,passed:overheadP95<=budget,excluded:0},null,2));
 fs.writeFileSync(path.join(destination,'metrics-export.json'),JSON.stringify(manager.export(),null,2));
}finally{await processor.disableOptimization();processor.shutdown();}

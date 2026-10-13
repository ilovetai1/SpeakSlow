const test = require('node:test');
const assert = require('node:assert/strict');
const { CorrectionLearningManager, changedWord } = require('../src/helpers/correctionLearningManager');
function fixture() {
  const values = new Map(); let rows = [], nextId = 1, failKey = null, now = 0, wall = 0;
  const db = {
    db: { transaction: fn => () => { const backup = structuredClone([...values]), old = structuredClone(rows); try { return fn(); } catch (e) { values.clear(); backup.forEach(([k,v])=>values.set(k,v)); rows = old; throw e; } } },
    getSetting: (k,d) => structuredClone(values.has(k) ? values.get(k) : d),
    setSetting: (k,v) => { if(k === failKey) throw Error('failure'); values.set(k,structuredClone(v)); },
    getDictionaryEntries: () => structuredClone(rows), getEnabledDictionaryEntries: () => rows.filter(r=>r.enabled),
    addDictionaryEntry: (original,replacement) => { const id=nextId++; rows.push({id,original,replacement,enabled:1}); return {lastInsertRowid:id}; },
    deleteDictionaryEntry: id => { rows=rows.filter(r=>r.id!==id); },
    applyDictionary: s => rows.filter(r=>r.enabled).reduce((s,r)=>s.replaceAll(r.original,r.replacement),s),
  };
  const calls=[], timers=[]; const context={ denylist:()=>[], reader:{ request:async (op)=>{calls.push(op);return {status:'unsupported'};} } };
  const m=new CorrectionLearningManager(db,context,{clock:()=>now,wallClock:()=>wall,setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:()=>{}});
  return {m,db,context,calls,timers,values,fail:k=>failKey=k,time:n=>now=n,wall:n=>wall=n};
}
test('single lexical replacement rejects dates, multiline, multiple edits and rewrites',()=>{
  assert.deepEqual(changedWord('請洽 台灣公司。','請洽 臺灣公司。'),{original:'台灣',replacement:'臺灣'});
  assert.deepEqual(changedWord('使用 SpeekSlow。','使用 SpeakSlow。'),{original:'SpeekSlow',replacement:'SpeakSlow'});
  for(const [a,b] of [['日期10月','日期11月'],['錯字\n下一行','正字\n下一行'],['北京和上海','南京和台北'],['這是一大段原文','完全不同的另一段內容']]) assert.equal(changedWord(a,b),null);
});
test('pending has no effect, app approval shadows global once and undo is exact',()=>{
  const f=fixture(); f.db.addDictionaryEntry('台灣','全域'); f.db.addDictionaryEntry('臺灣','連鎖');
  f.m.addCandidate({original:'台灣',replacement:'臺灣'},'com.fixture.a');
  const id=f.m.queue()[0].id; assert.equal(f.m.apply('台灣','com.fixture.a').text,'全域');
  f.m.decide(id,'approve'); assert.equal(f.m.apply('台灣','com.fixture.a').text,'臺灣');
  assert.equal(f.m.apply('台灣','com.fixture.b').text,'全域'); assert.equal(f.db.getDictionaryEntries().length,2);
  const rule=f.m.rules()[0]; f.m.updateRule(rule.id,{replacement:'台北'});
  assert.throws(()=>f.m.undo(id),/undo_conflict/); assert.equal(f.m.rules()[0].replacement,'台北');
  f.m.updateRule(rule.id,{delete:true}); assert.equal(f.m.undoStore().length,0);
});
test('transaction rollback, global approval, dismiss and durable undo after queue expires',()=>{
  const f=fixture(); const pair={original:'聲聲',replacement:'生生'};
  f.m.addCandidate(pair,'com.fixture.a'); const id=f.m.queue()[0].id;
  f.fail('correction_learning_v1'); assert.throws(()=>f.m.decide(id,'approve')); assert.equal(f.m.rules().length,0); assert.equal(f.m.undoStore().length,0);
  f.fail(null); f.m.decide(id,'approve','global'); assert.equal(f.db.getDictionaryEntries().length,1);
  f.wall(15*86400000); assert.equal(f.m.queue().length,0); f.m.undo(id); assert.equal(f.db.getDictionaryEntries().length,0);
  f.m.addCandidate(pair,'com.fixture.b');f.m.decide(f.m.queue()[0].id,'dismiss'); assert.equal(f.m.rules().length,0);
});
test('queue coalesces pairs, is bounded and invalid scope never becomes global',()=>{
  const f=fixture();f.m.addCandidate({original:'聲聲',replacement:'生生'},'com.fixture.a');f.m.addCandidate({original:'聲聲',replacement:'生生'},'com.fixture.a'); assert.equal(f.m.queue()[0].count,2);
  for(let n=1;n<100;n++)f.m.addCandidate({original:'聲聲',replacement:'生生'},`com.fixture.app${n}`);
  assert.equal(f.m.addCandidate({original:'聲聲',replacement:'生生'},'com.fixture.full').status,'queue_full');
  f.values.set('scoped_dictionary_rules_v1',{version:1,rules:[{original:'聲聲',replacement:'生生',scope:{kind:'global'}}]});
  assert.equal(f.m.apply('聲聲','com.fixture.a').text,'聲聲');assert.equal(f.m.apply('聲聲','com.fixture.a').status,'scoped_store_invalid');
});
test('observer is off by default, requires proof, stops on field change and ignores late callbacks',async()=>{
  const f=fixture(); assert.equal((await f.m.prepare('台灣')).status,'off');assert.equal(f.calls.length,0);
  f.db.setSetting('local_correction_learning_enabled',true);
  const base={status:'available',fieldId:'token',bundleId:'com.fixture.a',editable:true,secure:false,selection:{location:3,length:0},count:3,before:'前文 ',after:''};
  f.context.reader.request=async op=>op==='prepareObservation'?base:op==='validate'?{...base,count:5}:{...base,count:5,selection:{location:5,length:0},span:'台灣'};
  assert.equal((await f.m.prepare('台灣')).status,'prepared');assert.equal((await f.m.inserted()).status,'observing');
  f.context.reader.request=async op=>op==='validate'?{...base,count:5}:{...base,count:5,span:'臺灣'};
  await f.m.poll(); assert.equal(f.m.queue().length,1);assert.equal(f.m.observer,null);
  await f.m.prepare('台灣'); f.context.reader.request=async()=>({status:'focus_changed'}); await f.m.inserted();assert.equal(f.m.observer,null);
  let resolve; f.context.reader.request=()=>new Promise(r=>resolve=r); const late=f.m.prepare('台灣');f.m.stop();resolve(base);assert.equal((await late).status,'off');assert.equal(f.m.observer,null);
});

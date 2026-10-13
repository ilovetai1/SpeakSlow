const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const Database=require(process.env.SPEAKSLOW_PACKAGED_DB_MANAGER||'../src/helpers/database');const {CorrectionLearningManager}=require('../src/helpers/correctionLearningManager');
test('real isolated SQLite rolls back approval, retains legacy rows and persists app rules independently',{skip:process.versions.modules!=='125'?'requires Electron ABI 125':false},t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speakslow-learning-db-'));const db=new Database();db.initialize(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true});});
 const m=new CorrectionLearningManager(db,{reader:{request:async()=>({status:'unsupported'})},denylist:()=>[]});
 db.addDictionaryEntry('全域','共同');const baseline=db.getDictionaryEntries();
 m.addCandidate({original:'聲聲',replacement:'生生'},'com.fixture.a');const id=m.queue()[0].id;
 const set=db.setSetting.bind(db);db.setSetting=(key,value)=>{if(key==='correction_learning_v1')throw Error('fixture write failure');return set(key,value);};
 assert.throws(()=>m.decide(id,'approve'));assert.equal(m.rules().length,0);assert.equal(m.undoStore().length,0);assert.equal(m.queue()[0].state,'pending');assert.deepEqual(db.getDictionaryEntries(),baseline);
 db.setSetting=set;m.decide(id,'approve');assert.equal(m.rules().length,1);assert.deepEqual(db.getDictionaryEntries(),baseline);
 const reopened=new CorrectionLearningManager(db,{reader:{request:async()=>({status:'unsupported'})},denylist:()=>[]});assert.equal(reopened.apply('聲聲全域','com.fixture.a').text,'生生共同');assert.equal(reopened.apply('聲聲全域',null).text,'聲聲共同');
 reopened.undo(id);assert.equal(reopened.rules().length,0);assert.deepEqual(db.getDictionaryEntries(),baseline);
 m.addCandidate({original:'聲聲',replacement:'生生'},'com.fixture.b');const globalId=m.queue().find(c=>c.state==='pending').id;m.decide(globalId,'approve','global');const global=db.getDictionaryEntries().find(r=>r.original==='聲聲');db.updateDictionaryEntry(global.id,{replacement:'新值'});assert.throws(()=>m.undo(globalId),/undo_conflict/);assert.equal(db.getDictionaryEntries().find(r=>r.id===global.id).replacement,'新值');
});

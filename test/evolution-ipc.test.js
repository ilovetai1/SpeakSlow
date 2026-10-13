const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('App dictionary scope freezes at application; next transcript acquires a fresh scope',async t=>{
 const handlers={},old=Module._load;Module._load=function(id,...args){if(id==='electron')return {ipcMain:{handle:(id,fn)=>handlers[id]=fn,on(){}},dialog:{}};return old.call(this,id,...args);};t.after(()=>Module._load=old);
 let app='com.fixture.a';const ctx={wordScopes:new Map(),databaseManager:{getSetting:(k,d)=>k==='writing_profile'?'auto':d},contextManager:{metadata:async()=>({status:'available',bundleId:app}),denylist:()=>[]},learningManager:{apply:(text,bundleId)=>({text:bundleId=== 'com.fixture.a'?'詞庫甲':'詞庫乙',status:'available'})}};
 require('../src/helpers/ipc/evolution')(ctx);
 const first=await handlers['apply-dictionary-context'](null,'原文');app='com.fixture.b';assert.equal(first.text,'詞庫甲');assert.equal(ctx.wordScopes.get(first.scopeHandle).bundleId,'com.fixture.a');
 const next=await handlers['apply-dictionary-context'](null,'原文');assert.equal(next.text,'詞庫乙');assert.equal(next.bundleId,'com.fixture.b');assert.notEqual(next.scopeHandle,first.scopeHandle);
 app='invalid';assert.equal((await handlers['apply-dictionary-context'](null,'原文')).bundleId,null);
});
test('versioned exports preserve scope, CSV reports exclusions, invalid imported scope is never global',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'speakslow-dict-ipc-'));let file=path.join(directory,'dictionary.json');const handlers={},old=Module._load;const electron={ipcMain:{handle:(id,fn)=>handlers[id]=fn},dialog:{showSaveDialog:async()=>({filePath:file}),showOpenDialog:async()=>({filePaths:[file]})}};Module._load=function(id,...args){return id==='electron'?electron:old.call(this,id,...args);};t.after(()=>{Module._load=old;fs.rmSync(directory,{recursive:true});});
 const rule={id:'app:fixture',original:'台灣',replacement:'臺灣',enabled:true,scope:{kind:'app',bundleId:'com.fixture.a'},revision:1};let writes=0;
 const ctx={databaseManager:{exportDictionary:()=>[{original:'全域',replacement:'共同',enabled:1}],importDictionary:()=>{writes++;return {imported:1};}},learningManager:{rules:()=>[rule]},logger:{error(){}}};require('../src/helpers/ipc/dictionary')(ctx);
 assert((await handlers['export-dictionary']()).success);assert.deepEqual(JSON.parse(fs.readFileSync(file)).scoped,[rule]);file=path.join(directory,'dict.csv');assert.equal((await handlers['export-dictionary']()).excludedScoped,1);assert(!fs.readFileSync(file,'utf8').includes('台灣'));
 file=path.join(directory,'bad.json');for(const invalid of [{version:1,global:[],scoped:[{...rule,scope:{kind:'app',bundleId:''}}]},[{...rule,scope:{kind:'invalid'}}],{version:1,global:[rule],scoped:[]}]){fs.writeFileSync(file,JSON.stringify(invalid));assert.equal((await handlers['import-dictionary'](null,'merge')).success,false);assert.equal(writes,0);}
});

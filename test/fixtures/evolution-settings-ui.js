const saved={},listeners=new Set(),writes=[],actions=[];
let candidates=[{id:'one',original:'台灣',replacement:'臺灣',bundleId:'com.fixture.app',state:'pending'},{id:'two',original:'聲聲',replacement:'生生',bundleId:'com.fixture.app',state:'pending'}],undo=[];
let groups=[{stage:'asr',mode:'offline',provider:'none',temperature:'unknown',n:1,p50:12,p95:12,insufficient:true,counts:{failed:1,cancelled:0,skipped:0,missing:0}}];
window.electronAPI={
 getDictionaryEntries:async()=>[],getDictionaryCategories:async()=>[],
 getSetting:async(k,d)=>k in saved?saved[k]:d,getAllSettings:async()=>saved,
 onSettingChanged:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
 setSetting:async(k,v)=>{saved[k]=v;writes.push({k,v});listeners.forEach(fn=>fn({key:k,value:v}));},
 getEvolutionState:async()=>({candidates,undo,rules:[],learningStatus:'off'}),
 getEvolutionApps:async()=>({status:'available',apps:[{bundleId:'com.fixture.app',name:'測試 App'}]}),
 getPerformanceStats:async()=>({stats:{sessions:groups.length,groups}}),
 clearPerformanceStats:async()=>{groups=[];actions.push('clear');return {success:true};},
 exportPerformanceStats:async()=>{actions.push('export');return {success:true};},
 calibrateContextBudget:async()=>({success:true}),
 decideLearning:async(id,decision,scope)=>{actions.push({id,decision,scope});const c=candidates.find(c=>c.id===id);c.state=decision==='approve'?'approved':'dismissed';if(decision==='approve')undo.push(c);return {status:decision};},
 undoLearning:async id=>{actions.push('undo');undo=undo.filter(c=>c.id!==id);return {status:'undone'};},
};
const tick=()=>new Promise(r=>setTimeout(r,20));const wait=async p=>{await tick();for(let i=0;i<100;i++){if(p())return;await tick();}throw Error('UI condition timeout: '+p.toString()+'; writes='+JSON.stringify(writes)+'; actions='+JSON.stringify(actions)+'; paragraphs='+JSON.stringify([...document.querySelectorAll('p')].map(p=>p.textContent)));};
const check=(p,m)=>{if(!p)throw Error(m);};const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);const toggle=text=>[...document.querySelectorAll('label')].find(l=>l.textContent.includes(text))?.querySelector('input');
(async()=>{
 const script=document.createElement('script');script.src='./settings.js';document.body.appendChild(script);
 await wait(()=>button('寫作、學習與延遲'));button('寫作、學習與延遲').click();
 await wait(()=>[...document.querySelectorAll('p')].some(p=>p.textContent==='台灣 → 臺灣') && !button('重新整理候選').disabled);
 check(!toggle('讓本機 Ollama').checked,'context default must be off');check(!toggle('觀察本次').checked,'learning default must be off');check(toggle('記錄不含文字').checked,'metrics default must be on');
 const profile=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('本次預設')).querySelector('select');profile.value='auto';profile.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>document.querySelector('[aria-label="測試 App 寫作格式"]'));
 const map=document.querySelector('[aria-label="測試 App 寫作格式"]');map.value='email';map.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>saved.writing_profile_apps?.['com.fixture.app']==='email' && !toggle('讓本機 Ollama').disabled);
 toggle('讓本機 Ollama').click();await wait(()=>saved.context_aware_polishing_enabled===true && !toggle('觀察本次').disabled);toggle('觀察本次').click();await wait(()=>saved.local_correction_learning_enabled===true && !button('核准').disabled);
 button('核准').click();await wait(()=>button('撤回') && !button('撤回').disabled);check(actions.some(a=>a.scope==='app'),'approval must default to app');button('撤回').click();await wait(()=>!button('撤回') && !button('忽略').disabled);button('忽略').click();await wait(()=>[...document.querySelectorAll('p')].some(p=>p.textContent.includes('目前沒有待核准')));
 check(document.querySelector('tbody').textContent.includes('樣本不足'),'insufficient sample must be visible');button('匯出 JSON').click();await wait(()=>actions.includes('export') && !button('清除統計').disabled);button('清除統計').click();await wait(()=>[...document.querySelectorAll('p')].some(p=>p.textContent.includes('已保留 0 次')));
 candidates.push({id:'three',original:'公司',replacement:'公私',bundleId:'com.fixture.app',state:'pending'});button('字典').click();await wait(()=>button('重新整理學習候選') && !button('重新整理學習候選').disabled);check([...document.querySelectorAll('h3')].some(h=>h.textContent==='待學習詞彙'),'dictionary review missing');button('核准').click();await wait(()=>button('撤回') && !button('撤回').disabled);button('撤回').click();await wait(()=>!button('撤回'));
 document.querySelector('#test-result').textContent='Evolution UI PASS';
})().catch(e=>{document.querySelector('#test-result').textContent=e.message;});

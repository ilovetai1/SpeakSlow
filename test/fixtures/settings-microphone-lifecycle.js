const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('UI timeout: '+predicate.toString());};
const check=(condition,message)=>{if(!condition)throw Error(message);};
const button=label=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===label);
const click=async label=>{await wait(()=>button(label));button(label).click();};
const tracks=[],contexts=[];let calls=0,deferred=null,failContext=false,hidden=false;
const deadlines=new Map(),schedule=window.setTimeout.bind(window),unschedule=window.clearTimeout.bind(window);
window.setTimeout=(callback,delay,...args)=>{const id=schedule(callback,delay,...args);if(delay===30000)deadlines.set(id,callback);return id;};
window.clearTimeout=id=>{deadlines.delete(id);unschedule(id);};
Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{enumerateDevices:async()=>[],getUserMedia:async()=>{
 calls++;if(deferred)return await new Promise(resolve=>{deferred=resolve});
 const track={readyState:'live',stop(){this.readyState='ended'}};tracks.push(track);return {getTracks:()=>[track]};
}}});
window.AudioContext=class{constructor(){if(failContext)throw Error('fixture context failure');this.closed=false;contexts.push(this);}createMediaStreamSource(){return{connect(){},disconnect(){}}}createAnalyser(){return{fftSize:1024,getByteTimeDomainData(array){array.fill(128)}}}async close(){this.closed=true;}};
const allReleased=()=>tracks.every(t=>t.readyState==='ended')&&contexts.every(c=>c.closed);
window.electronAPI={getAllSettings:async()=>({enable_ai_optimization:false}),getSetting:async(_key,value)=>value,getTranscriptPolishingPrompt:async()=>'',onSettingChanged:()=>()=>{},getSpeechEngineState:async()=>({selected:'apple',profile:'accurate',state:'ready',isReady:true,appleAvailable:true,busy:false}),onSpeechEngineState:()=>()=>{},hideSettingsWindow:()=>{hidden=true;document.dispatchEvent(new Event('visibilitychange'));}};
(async()=>{
 const script=document.createElement('script');script.src='settings.js';document.body.appendChild(script);
 await wait(()=>document.body.textContent.includes('麥克風音量測試'));await wait(()=>calls>0||button('開始測試'));
 check(calls===0,'Opening general settings automatically acquired microphone: '+calls);
 check(button('開始測試'),'Missing explicit start control');
 await click('開始測試');await wait(()=>tracks.some(t=>t.readyState==='live'));
 await wait(()=>button('停止測試'));await click('停止測試');await wait(allReleased);
 await click('開始測試');await wait(()=>tracks.some(t=>t.readyState==='live'));
 await click('權限管理');await wait(allReleased);const previous=calls;
 await click('一般設定');await tick();check(calls===previous,'Returning to general restarted capture');
 await click('開始測試');await wait(()=>tracks.some(t=>t.readyState==='live'));hidden=true;document.dispatchEvent(new Event('visibilitychange'));await wait(allReleased);
 const beforeHiddenStart=calls;await click('開始測試');await tick();check(calls===beforeHiddenStart,'Hidden settings allowed a new microphone test');
 hidden=false;document.dispatchEvent(new Event('visibilitychange'));await tick();check(allReleased(),'Showing settings restarted capture');
 // Exercise the actual deadline callback without waiting thirty wall seconds.
 await click('開始測試');await wait(()=>tracks.some(t=>t.readyState==='live'));check(deadlines.size===1,'Missing 30-second deadline');[...deadlines.values()][0]();await wait(allReleased);check(deadlines.size===0,'Deadline timer survived stop');
 // Stop before a pending permission request resolves. The late stream must end.
 deferred=true;await click('開始測試');await wait(()=>typeof deferred==='function');
 await click('停止測試');const late={readyState:'live',stop(){this.readyState='ended'}};tracks.push(late);const resolve=deferred;deferred=null;resolve({getTracks:()=>[late]});await wait(allReleased);
 await click('開始測試');await wait(()=>tracks.some(t=>t.readyState==='live'));document.querySelector('button').click();await wait(allReleased);
 hidden=false;document.dispatchEvent(new Event('visibilitychange'));await tick();
 failContext=true;await click('開始測試');await wait(()=>document.body.textContent.includes('無法使用'));check(allReleased(),'AudioContext failure leaked acquired stream');
 document.querySelector('#test-result').textContent='PASS';
})().catch(e=>document.querySelector('#test-result').textContent=e.message);

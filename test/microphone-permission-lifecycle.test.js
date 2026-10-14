const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');

test('microphone permission test releases every acquired track before returning to idle', { timeout: 20000 }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'speakslow-mic-permission-'));
  try {
    esbuild.buildSync({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {usePermissions} from './src/hooks/usePermissions';
let permission;
function Harness(){permission=usePermissions(()=>{});return null;}
const tracks=[];
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{
 const track={readyState:'live',stop(){this.readyState='ended'}};tracks.push(track);
 return {getTracks:()=>[track]};
}}});
const root=createRoot(document.getElementById('root'));root.render(<Harness/>);
(async()=>{
 while(!permission)await new Promise(r=>setTimeout(r,0));
 await permission.requestMicPermission();
 const live=tracks.filter(t=>t.readyState==='live').length;
 if(live)throw Error('Idle microphone tracks after permission test: '+live);
 await permission.requestMicPermission();
 if(tracks.some(t=>t.readyState==='live'))throw Error('Repeated permission test leaked tracks');
 root.unmount();
 document.querySelector('#result').textContent='PASS';
})().catch(e=>document.querySelector('#result').textContent=e.message);
`, resolveDir: path.resolve(__dirname, '..'), loader: 'jsx' }, outfile: path.join(directory, 'ui.js'), bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
    fs.writeFileSync(path.join(directory,'index.html'),'<div id="root"></div><pre id="result">pending</pre><script src="ui.js"></script>');
    const output=execFileSync(process.env.SPEAKSLOW_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${path.join(directory,'profile')}`,'--dump-dom','--virtual-time-budget=3000',`file://${path.join(directory,'index.html')}`],{timeout:17000,maxBuffer:2*1024*1024,encoding:'utf8',stdio:['ignore','pipe','ignore']});
    assert.equal(output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1],'PASS');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

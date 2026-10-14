const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const esbuild=require('esbuild');
test('settings microphone monitor requires explicit start and releases capture on stop, hide and navigation',{timeout:20000},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speakslow-settings-mic-'));
 try{
  esbuild.buildSync({entryPoints:[path.join(__dirname,'../src/settings.jsx')],outfile:path.join(dir,'settings.js'),bundle:true,platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
  fs.writeFileSync(path.join(dir,'index.html'),'<div id="settings-root"></div><pre id="test-result">pending</pre><script>'+fs.readFileSync(path.join(__dirname,'fixtures/settings-microphone-lifecycle.js'),'utf8')+'</script>');
  const out=execFileSync(process.env.SPEAKSLOW_TEST_BROWSER||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${path.join(dir,'profile')}`,'--dump-dom','--virtual-time-budget=6000',`file://${path.join(dir,'index.html')}`],{timeout:17000,maxBuffer:2*1024*1024,encoding:'utf8',stdio:['ignore','pipe','ignore']});
  assert.equal(out.match(/<pre id="test-result">([^<]*)<\/pre>/)?.[1],'PASS');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

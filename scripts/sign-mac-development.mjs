import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// Explicit local development identity; no credentials or certificate export.
const [bundlePath, identity] = process.argv.slice(2);
if (process.platform !== 'darwin' || !bundlePath || !identity || !path.isAbsolute(bundlePath) || !bundlePath.endsWith('.app')) throw Error('Specify an absolute .app and a local signing identity.');
const magic = new Set(['feedface','feedfacf','cefaedfe','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']);
const binaries=[], bundles=[];
function walk(dir) {
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
  const file=path.join(dir,entry.name);if(entry.isSymbolicLink())continue;
  if(entry.isDirectory()){walk(file);if(/\.(app|framework|xpc)$/.test(entry.name))bundles.push(file);}
  else if(entry.isFile()){const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(4);fs.readSync(fd,bytes,0,4,0);fs.closeSync(fd);if(magic.has(bytes.toString('hex')))binaries.push(file);}
 }
}
function sign(file) {
 const result=spawnSync('codesign',['--force','--sign',identity,file],{encoding:'utf8'});
 if(result.status!==0)throw Error(`Signing failed for ${file}: ${result.stderr}`);
}
walk(bundlePath);
for(const binary of binaries)sign(binary);
for(const nested of bundles)sign(nested);
sign(bundlePath);
const verify=spawnSync('codesign',['--verify','--deep','--strict',bundlePath],{encoding:'utf8'});
if(verify.status!==0)throw Error(verify.stderr);
process.stdout.write(`Development signature verified: ${binaries.length} Mach-O files, ${bundles.length} nested bundles. No notarization claimed.\n`);

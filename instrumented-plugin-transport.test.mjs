import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readTransportFixture, coldMainArgument, attachColdMain, attachSupervisor } from './instrumented-plugin-transport.mjs'

const root=mkdtempSync(join(tmpdir(),'plugin-transport-control-')), sha=b=>createHash('sha256').update(b).digest('hex')
const catalogue='https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json'
const archive='https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v0.1.9/chrome-win32-x64.tar.gz'
const entries=[catalogue,catalogue.replace('catalogue-v2.json','catalogue.json'),archive].map((url,i)=>{
 const path=join(root,`input-${i}`),bytes=Buffer.from(i===2?'synthetic archive bytes':'{"format":2,"entries":[]}')
 writeFileSync(path,bytes);return{url,path,size:bytes.length,sha256:sha(bytes)}
})
const manifest=join(root,'transport.json');writeFileSync(manifest,JSON.stringify({format:1,entries}))
const fixture=readTransportFixture(manifest)
const bad=join(root,'bad.json');writeFileSync(bad,JSON.stringify({format:1,entries:entries.map((e,i)=>i===2?{...e,sha256:'0'.repeat(64)}:e)}))
assert.throws(()=>readTransportFixture(bad),/digest/)
const mainDir=join(root,'resources','app.asar','out','main');mkdirSync(mainDir,{recursive:true})
const report=join(root,'report.json'),entry=join(mainDir,'index.js')
writeFileSync(entry,`const fs=require('node:fs');(async()=>{const bytes=await(await fetch(${JSON.stringify(catalogue)})).text();fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({bytes,pid:process.pid}));})().catch(e=>{fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({error:e.message}));});setInterval(()=>{},1000);`)
const executablePath=realpathSync(process.execPath),executableSha256=sha(readFileSync(executablePath))
const observeProcess=pid=>({pid,birth:readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[19],executablePath:realpathSync(`/proc/${pid}/exe`)})
let main,hook
try {
 main=spawn(process.execPath,[coldMainArgument(19356),entry],{stdio:['ignore','ignore','pipe']})
 const expected={...observeProcess(main.pid),executableSha256}
 hook=await attachColdMain({execute:true,fixture,expected,observeProcess,port:19356})
 const until=Date.now()+10000
 while(!existsSync(report)&&Date.now()<until)await new Promise(r=>setTimeout(r,50))
 const result=JSON.parse(readFileSync(report));assert.equal(result.error,undefined);assert.equal(result.pid,main.pid)
 assert.equal(result.bytes,readFileSync(entries[0].path,'utf8'))
 const receipt=await hook.snapshot();assert.equal(receipt.calls.length,1);assert.equal(receipt.calls[0].sha256,entries[0].sha256);assert.equal(receipt.denied.length,0)
 const restored=await hook.detach();hook=null;assert.equal(restored.restored,true)
 console.log(JSON.stringify({passed:true,controls:['receipt tamper rejected','actual cold inspector entry pause','exact fetch bytes/hash/PID','restore original transport'],scope:'Pi Node synthetic transport; not Windows, Electron, Settings or plugin proof'}))
} finally {
 hook?.close()
 if(main&&main.exitCode===null){const ended=once(main,'exit');main.kill();await ended}
 rmSync(root,{recursive:true,force:true})
}

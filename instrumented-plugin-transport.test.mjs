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
let main,hook,partialMain
try {
 main=spawn(process.execPath,[coldMainArgument(19356),entry],{stdio:['ignore','ignore','pipe']})
 const expected={...observeProcess(main.pid),executableSha256}
 hook=await attachColdMain({execute:true,fixture,expected,observeProcess,port:19356})
 const until=Date.now()+10000
 while(!existsSync(report)&&Date.now()<until)await new Promise(r=>setTimeout(r,50))
 const result=JSON.parse(readFileSync(report));assert.equal(result.error,undefined);assert.equal(result.pid,main.pid)
 assert.equal(result.bytes,readFileSync(entries[0].path,'utf8'))
 const receipt=await hook.snapshot();assert.equal(receipt.calls.length,1);assert.equal(receipt.calls[0].sha256,entries[0].sha256);assert.equal(receipt.denied.length,0)
 assert.equal(hook.receipt.identity.pid,main.pid)
 assert.equal(hook.receipt.identity.executablePath,executablePath)
 assert(hook.receipt.pause.url.endsWith('/resources/app.asar/out/main/index.js'))
 console.log(JSON.stringify({scope:'cold inspector selected identity only',initialIdentity:hook.receipt.initialIdentity,entryIdentity:hook.receipt.identity,pause:hook.receipt.pause}))
 const restored=await hook.detach();hook=null;assert.equal(restored.restored,true)
 const partialDir=join(root,'partial','resources','app.asar','out','main');mkdirSync(partialDir,{recursive:true})
 const partialEntry=join(partialDir,'index.js');writeFileSync(partialEntry,'setInterval(()=>{},1000);')
 partialMain=spawn(process.execPath,[coldMainArgument(19357),partialEntry],{stdio:['ignore','ignore','pipe']})
 const partialExpected={...observeProcess(partialMain.pid),executableSha256}
 let observations=0,partialError
 const failAfterInstall=pid=>{const observation=observeProcess(pid);if(++observations===3)throw Error('injected post-install native observation failure');return observation}
 try { const unexpected=await attachColdMain({execute:true,fixture,expected:partialExpected,observeProcess:failAfterInstall,port:19357});await unexpected.detach();assert.fail('post-install failure was not propagated') }
 catch(error){partialError=error}
 assert.equal(partialError.message,'injected post-install native observation failure')
 assert.equal(partialError.transportCleanup.attempted,true)
 assert.equal(partialError.transportCleanup.restored,true)
 assert.equal(partialError.transportCleanup.receipt.active,false)
 console.log(JSON.stringify({passed:true,controls:['receipt tamper rejected','actual cold inspector entry pause','strict entry PID/image','exact fetch bytes/hash/PID','restore original transport','partial attachment restores hook and preserves original error'],partialCleanup:partialError.transportCleanup,scope:'Pi Node synthetic transport; not Windows, Electron, Settings or plugin proof'}))
} finally {
 hook?.close()
 if(main&&main.exitCode===null){const ended=once(main,'exit');main.kill();await ended}
 if(partialMain&&partialMain.exitCode===null){const ended=once(partialMain,'exit');partialMain.kill();await ended}
 rmSync(root,{recursive:true,force:true})
}

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readCustomPluginInputs, manifestTarExecutable } from './custom-plugin-inputs.mjs'
const root=mkdtempSync(join(tmpdir(),process.platform==='win32'?'plugin-input-control-':'C:plugin-input-control-')),sha=b=>createHash('sha256').update(b).digest('hex')
try {
 assert.equal(manifestTarExecutable('win32','C:\\Windows'),'C:\\Windows\\System32\\tar.exe')
 assert.throws(()=>manifestTarExecutable('win32','relative'),/absolute/)
 assert.throws(()=>manifestTarExecutable('win32',''),/absolute/)
 assert.equal(manifestTarExecutable('linux',undefined),'tar')
 const manifest={format:2,id:'chrome',version:'0.1.9',sourceCommit:'a'.repeat(40),platforms:[{os:'win32',cpu:'x64'}]}
 const manifestBytes=Buffer.from(JSON.stringify(manifest));writeFileSync(join(root,'plugin.json'),manifestBytes)
 const filename='chrome-win32-x64.tar.gz'
 const made=spawnSync('tar',['-czf',join(root,filename),'-C',root,'plugin.json']);assert.equal(made.status,0)
 const bytes=readFileSync(join(root,filename))
 const entry={id:'chrome',version:'0.1.9',sourceCommit:manifest.sourceCommit,targets:[{os:'win32',cpu:'x64',url:'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v0.1.9/chrome-win32-x64.tar.gz',compression:'tar.gz',bytes:bytes.length,sha256:sha(bytes),manifestSha256:sha(manifestBytes)}]}
 const publicCatalogue={format:2,entries:[{...entry,version:'0.1.8'},{id:'whatsapp',version:'0.1.4',targets:[{os:'win32',cpu:'x64',bytes:10,sha256:'b'.repeat(64),manifestSha256:'c'.repeat(64)}]}]}
 const receipt={format:1,plugins:[{id:'chrome',version:'0.1.9',sourceCommit:manifest.sourceCommit,archiveFilename:filename,archiveBytes:bytes.length,archiveSha256:sha(bytes),manifestSha256:sha(manifestBytes),catalogueEntry:entry}]}
 const origin={runId:'123',artifact:'new-plugin'}
 const invoke=value=>{const b=Buffer.from(JSON.stringify(value));writeFileSync(join(root,'plugin-inputs.json'),b);return readCustomPluginInputs(root,sha(b),publicCatalogue,origin)}
 const result=invoke(receipt);assert.equal(result.expected.chrome.version,'0.1.9');assert.equal(result.expected.whatsapp.version,'0.1.4');assert.equal(result.archives[0].sha256,sha(bytes));assert.equal(publicCatalogue.entries[0].version,'0.1.8')
 assert.throws(()=>readCustomPluginInputs(root,'0'.repeat(64),publicCatalogue,origin),/receipt hash/)
 const wrongDigest=structuredClone(receipt);wrongDigest.plugins[0].catalogueEntry.targets[0].sha256='0'.repeat(64);assert.throws(()=>invoke(wrongDigest))
 const wrongSource=structuredClone(receipt);wrongSource.plugins[0].catalogueEntry.sourceCommit='d'.repeat(40);assert.throws(()=>invoke(wrongSource))
 const traversal=structuredClone(receipt);traversal.plugins[0].archiveFilename='../chrome.tar.gz';assert.throws(()=>invoke(traversal))
 const duplicate=structuredClone(receipt);duplicate.plugins.push(duplicate.plugins[0]);assert.throws(()=>invoke(duplicate))
 const corrupt=structuredClone(receipt),corruptBytes=Buffer.from('invalid gzip archive')
 writeFileSync(join(root,filename),corruptBytes)
 corrupt.plugins[0].archiveBytes=corruptBytes.length;corrupt.plugins[0].archiveSha256=sha(corruptBytes)
 corrupt.plugins[0].catalogueEntry.targets[0].bytes=corruptBytes.length;corrupt.plugins[0].catalogueEntry.targets[0].sha256=sha(corruptBytes)
 assert.throws(()=>invoke(corrupt),/manifest extraction failed/)
 writeFileSync(join(root,filename),bytes)
 const wrongManifest=structuredClone(receipt);wrongManifest.plugins[0].manifestSha256='e'.repeat(64);wrongManifest.plugins[0].catalogueEntry.targets[0].manifestSha256='e'.repeat(64)
 assert.throws(()=>invoke(wrongManifest))
 console.log(JSON.stringify({passed:12,nativeTarBindingControls:4,colonPath:root.includes('C:'),corruptArchiveRejected:true,manifestHashStillRequired:true,scope:'real GNU tar stdin extraction and synthetic identity controls; Windows/installed proof unrun'}))
} finally {rmSync(root,{recursive:true,force:true})}

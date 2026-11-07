import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readCustomPluginInputs } from './custom-plugin-inputs.mjs'
const root=mkdtempSync(join(tmpdir(),'plugin-input-control-')),sha=b=>createHash('sha256').update(b).digest('hex')
try {
 const manifest={format:2,id:'chrome',version:'0.1.9',sourceCommit:'a'.repeat(40),platforms:[{os:'win32',cpu:'x64'}]}
 const manifestBytes=Buffer.from(JSON.stringify(manifest));writeFileSync(join(root,'plugin.json'),manifestBytes)
 const filename='chrome-win32-x64.tar.gz'
 const made=spawnSync('tar',['-czf',join(root,filename),'-C',root,'plugin.json']);assert.equal(made.status,0)
 const bytes=readFileSync(join(root,filename))
 const entry={id:'chrome',version:'0.1.9',sourceCommit:manifest.sourceCommit,targets:[{os:'win32',cpu:'x64',url:'https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v0.1.9/chrome-win32-x64.tar.gz',compression:'tar.gz',bytes:bytes.length,sha256:sha(bytes),manifestSha256:sha(manifestBytes)}]}
 const publicCatalogue={format:2,entries:[{...entry,version:'0.1.8'},{id:'whatsapp',version:'0.1.4',targets:[{os:'win32',cpu:'x64',bytes:10,sha256:'b'.repeat(64),manifestSha256:'c'.repeat(64)}]}]}
 const receipt={format:1,plugins:[{archiveFilename:filename,buildRunId:'123',buildArtifact:'new-plugin',entry}]}
 const invoke=value=>{const b=Buffer.from(JSON.stringify(value));writeFileSync(join(root,'plugin-inputs.json'),b);return readCustomPluginInputs(root,sha(b),publicCatalogue)}
 const result=invoke(receipt);assert.equal(result.expected.chrome.version,'0.1.9');assert.equal(result.expected.whatsapp.version,'0.1.4');assert.equal(result.archives[0].sha256,sha(bytes));assert.equal(publicCatalogue.entries[0].version,'0.1.8')
 assert.throws(()=>readCustomPluginInputs(root,'0'.repeat(64),publicCatalogue),/receipt hash/)
 const wrongDigest=structuredClone(receipt);wrongDigest.plugins[0].entry.targets[0].sha256='0'.repeat(64);assert.throws(()=>invoke(wrongDigest))
 const wrongSource=structuredClone(receipt);wrongSource.plugins[0].entry.sourceCommit='d'.repeat(40);assert.throws(()=>invoke(wrongSource))
 const traversal=structuredClone(receipt);traversal.plugins[0].archiveFilename='../chrome.tar.gz';assert.throws(()=>invoke(traversal))
 const duplicate=structuredClone(receipt);duplicate.plugins.push(duplicate.plugins[0]);assert.throws(()=>invoke(duplicate))
 console.log(JSON.stringify({passed:6,scope:'synthetic tar and receipt identity controls; no real plugin or Windows proof'}))
} finally {rmSync(root,{recursive:true,force:true})}

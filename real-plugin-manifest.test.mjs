import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { manifestTarExecutable } from './custom-plugin-inputs.mjs'

const bytes=readFileSync(process.argv[2])
const sha=b=>createHash('sha256').update(b).digest('hex')
assert.equal(bytes.length,3608967)
assert.equal(sha(bytes),'f399b4434dfff477f8a98a5eb2b03877dd6c0df090a90b9a9961acb67b2cc0e2')
const tar=manifestTarExecutable()
const result=spawnSync(tar,['-xOzf','-','plugin.json'],{input:bytes,timeout:30000,maxBuffer:1048576})
assert.ifError(result.error)
assert.equal(result.status,0,result.stderr?.toString())
assert.equal(sha(result.stdout),'2497482875328abf610a0d1b70df7c7cc7b45839b4637bacf999fa01367276dc')
const manifest=JSON.parse(result.stdout)
assert.equal(manifest.id,'chrome')
assert.equal(manifest.version,'0.1.9')
assert.equal(manifest.sourceCommit,'5ba484269abbf65287dea3c3611eb3f4157520ba')
console.log(JSON.stringify({realF399Archive:true,archiveSha256:sha(bytes),manifestSha256:sha(result.stdout),tar,stdin:true,status:result.status,scope:'manifest reader only; no plugin execution or accepted repair'}))

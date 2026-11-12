import { fork, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { previousRunsProvenStopped } from '../src/main/plugins/supervisor/recovery-proof'
import { liveGroupMembers } from '../resources/plugin-host/process-groups.mjs'

const require = createRequire(import.meta.url)
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
let folder = ''
const children: ChildProcess[] = []
const leases: PluginWorkspaceLease[] = []
const guardians: number[] = []
function message(child: ChildProcess, event: string): Promise<{runId:string;guardian:number}> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off('message', receive); reject(new Error('Fictional IPC timeout: '+event)) }, 15000)
    function receive(value: {event?:string;runId:string;guardian:number}) {
      if (value.event !== event) return
      clearTimeout(timer)
      child.off('message', receive)
      resolve(value)
    }
    child.on('message', receive)
  })
}
describe.skipIf(process.platform === 'win32')('standalone supervisor retirement after lost physical proof', () => {
  beforeAll(async () => {
    folder = await realpath(await mkdtemp(join(tmpdir(), 'pq-')))
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(folder, 'node_modules'))
    await build({
      entryPoints: [fileURLToPath(new URL('./fixtures/plugin-supervisor-failed-quit.ts', import.meta.url))],
      outfile: join(folder, 'owner.mjs'), bundle:true, platform:'node', format:'esm', target:'node24',
      banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); const module={};"},
      external:['better-sqlite3'],
    })
  })
  afterEach(async () => {
    for (const lease of leases.splice(0)) lease.abandon()
    for (const child of children.splice(0)) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      const ended = once(child, 'exit')
      child.kill('SIGKILL')
      await ended
    }
    // Killing our fictional host disconnects its own guardians, which must reap their groups.
    for (const pid of guardians.splice(0))
      await expect.poll(() => { try { process.kill(pid, 0); return false } catch { return true } }, {timeout:10000}).toBe(true)
  })
  afterAll(async () => { if (folder) await rm(folder, {recursive:true,force:true}) })
  it.each(['quit', 'SIGTERM'] as const)('exits after %s, lets the guardian kill a stubborn group, and recovers before a successor starts', async (how) => {
    const root = join(folder, how), workspaceRoot = join(root, 'w')
    await mkdir(workspaceRoot, {recursive:true})
    const child = fork(join(folder, 'owner.mjs'), [root, workspaceRoot, fileURLToPath(new URL('../resources/plugin-host', import.meta.url))], {stdio:['ignore','ignore','pipe','ipc']})
    children.push(child)
    let errors = ''
    child.stderr?.on('data', (bytes:Buffer) => { errors += bytes.toString() })
    await message(child, 'ready').catch((error) => { throw new Error(errors, {cause:error}) })
    const lease = await PluginWorkspaceLease.attach({root,workspaceRoot,generation:randomUUID(),build:'fictional'})
    leases.push(lease)
    const adopted = message(child, 'adopted')
    child.send('adopt')
    const run = await adopted
    guardians.push(run.guardian)
    const bystander = spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'})
    children.push(bystander)
    await once(bystander, 'spawn')
    const runPath = join(root, 'host/runs', run.runId)
    const pids = JSON.parse(await readFile(join(runPath, 'pids.json'), 'utf8')) as {server:number;child:number}
    expect(await liveGroupMembers(pids.server)).toEqual(expect.arrayContaining([pids.server,pids.child]))
    if (how === 'quit') await lease.close()
    else child.kill('SIGTERM')
    await expect.poll(() => child.exitCode, {timeout:5000}).toBe(1)
    await expect.poll(async () => JSON.parse(await readFile(join(runPath,'exit.json'),'utf8')), {timeout:10000}).toMatchObject({exited:true,cause:'host-gone'})
    expect(await liveGroupMembers(pids.server)).toEqual([])
    expect(bystander.exitCode).toBeNull()
    expect(process.kill(bystander.pid!,0)).toBe(true)
    expect(JSON.parse(await readFile(join(root,'supervisor/owner.json'),'utf8')).phase).toBe('blocked')
    const owner = await PluginSupervisor.start({root,workspaceRoots:[workspaceRoot],recoverPrevious:(previous)=>previousRunsProvenStopped(root,{previous})})
    await owner.shutdown()
    await owner.closed
  }, 30000)
})

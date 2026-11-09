import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { OWNER_WIRE } from '../src/main/plugins/supervisor/protocol'

let parent = ''
let child: ChildProcess | undefined
let owner: PluginSupervisor | undefined
let lease: PluginWorkspaceLease | undefined
afterEach(async () => {
  await lease?.close()
  await owner?.shutdown()
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  if (parent) await rm(parent, { recursive: true, force: true })
})

it('replaces a still-running signed-frame supervisor automatically on start', async () => {
  parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'legacy-owner-')),
  )
  const root = join(parent, 'p'),
    workspaceRoot = join(parent, 'w')
  const entry = join(root, 'supervisor-entries', 'old', 'entry.cjs')
  const config = join(root, 'supervisor-launches', 'old', 'launch.json')
  for (const folder of [
    join(root, 'supervisor'),
    join(root, 'supervisor-entries', 'old'),
    join(root, 'supervisor-launches', 'old'),
    workspaceRoot,
  ])
    await mkdir(folder, { recursive: true })
  const epoch = randomUUID()
  await writeFile(config, JSON.stringify({ root, epoch }))
  await writeFile(
    entry,
    `
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {createServer}=require('node:net');
const {root,epoch}=JSON.parse(readFileSync(process.argv[2],'utf8'));
const key='a'.repeat(64);
const record={version:1,epoch,key,phase:'accepting',wire:{major:1,minMinor:0,maxMinor:0,features:[]}};
writeFileSync(join(root,'supervisor','owner.json'),JSON.stringify(record));
const pipe='\\\\\\\\.\\\\pipe\\\\brocrew-plugin-owner-'+createHash('sha256').update('brocrew-plugin-owner\\0'+key).digest('hex').slice(0,32);
const path=process.platform==='win32'?pipe:join(root,'supervisor','owner.sock');
writeFileSync(join(root,'supervisor-launches','old','service.json'),JSON.stringify({format:1,ready:true,pid:process.pid}));
createServer(socket=>{socket.write(JSON.stringify({challenge:'b'.repeat(64)})+'\\n');socket.on('data',bytes=>{const frame=JSON.parse(String(bytes));if(!frame.mac)socket.destroy()})}).listen(path,()=>process.send('ready'));
`,
  )
  child = spawn(process.execPath, [entry, config], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  expect((await once(child, 'message'))[0]).toBe('ready')
  const oldExit = once(child, 'exit')
  const launch = createPluginSupervisorLauncher({
    root,
    workspaceRoots: [workspaceRoot],
    resourcesRoot: join(parent, 'missing-resources'),
  })
  const replacing = vi.fn(async () => {
    await expect(launch()).rejects.toMatchObject({ code: 'unavailable' })
    await oldExit
    owner = await PluginSupervisor.start({
      root,
      workspaceRoots: [workspaceRoot],
      recoverPrevious: async () => true,
    })
  })
  lease = await PluginWorkspaceLease.attach({
    root,
    workspaceRoot,
    build: 'new-build',
    generation: randomUUID(),
    launch: replacing,
  })
  expect(replacing).toHaveBeenCalledOnce()
  expect(lease.epoch).not.toBe(epoch)
  expect(lease.features).toEqual(OWNER_WIRE.features)
  expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  expect(await lease.close()).toBe(true)
}, 30_000)

import { afterEach, expect, it } from 'vitest'
import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { liveGroupMembers } from '../resources/plugin-host/process-groups.mjs'

const parents: ChildProcess[] = [],
  roots: string[] = []
async function gone(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await once(child, 'close')
}
afterEach(async () => {
  await Promise.all(
    parents.splice(0).map(async (parent) => {
      if (parent.connected) parent.send({ type: 'stop' }, () => {})
      await gone(parent)
    }),
  )
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it(
  'stops a fictional runtime and inherited group after supervisor death before a same-ID successor starts',
  async () => {
    const root = await mkdtemp(
      join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-process-lifetime-'),
    )
    roots.push(root)
    const parentScript = join(root, 'parent.mjs'),
      entry = join(root, 'entry.mjs')
    const slot = join(root, 'orchard.sqlite'),
      data = join(root, 'opaque.bin')
    await writeFile(data, Buffer.from([1, 0, 255, 8]))
    await writeFile(
      entry,
      `import {spawn} from 'node:child_process';import fs from 'node:fs';
const helper=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,helper:helper.pid}));
process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
    )
    await writeFile(
      parentScript,
      `import {fork} from 'node:child_process';
const [guardian,entry,slot,record,cache]=process.argv.slice(2);
const child=fork(guardian,[],{execArgv:[],stdio:['pipe','pipe','ignore','ipc']});
child.stdout.resume();child.on('message',value=>{if(process.connected)process.send(value,()=>{})});
child.once('close',()=>process.exit(0));
process.on('message',value=>{if(value.type==='stop'&&child.connected)child.send({channel:'brocrew-plugin-process:v1',type:'stop'},()=>{})});
child.send({channel:'brocrew-plugin-process:v1',type:'launch',command:process.execPath,args:[entry,record],cwd:process.cwd(),slot,keeperCache:cache,stop:{signal:'SIGTERM',graceMs:300}},()=>{});`,
    )
    async function start(record: string) {
      const parent = fork(
        parentScript,
        [
          resolve(__dirname, '../resources/plugin-host/process-guardian.mjs'),
          entry,
          slot,
          record,
          root,
        ],
        { cwd: root, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
      )
      parents.push(parent)
      const launched = await new Promise<{ pid: number; groupPid: number }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Fictional package did not start')),
          process.platform === 'win32' ? 150000 : 10000,
        )
        parent.on('message', (value) => {
          const message = value as { type?: string; pid: number; groupPid: number }
          if (message.type === 'spawned') {
            clearTimeout(timer)
            resolve(message)
          }
        })
        parent.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        parent.once('close', () => {
          clearTimeout(timer)
          reject(new Error('Fictional parent exited before startup'))
        })
      })
      return { parent, ...launched }
    }
    const record = join(root, 'first.json')
    const first = await start(record)
    let helpers!: { pid: number; helper: number }
    await expect
      .poll(async () => {
        try {
          helpers = JSON.parse(await readFile(record, 'utf8'))
          return helpers.helper > 1
        } catch {
          return false
        }
      })
      .toBe(true)
    first.parent.kill('SIGKILL')
    await gone(first.parent)
    const second = await start(join(root, 'second.json'))
    expect(second.pid).not.toBe(first.pid)
    if (process.platform === 'win32') {
      expect(() => process.kill(first.pid, 0)).toThrow()
      expect(() => process.kill(helpers.helper, 0)).toThrow()
    } else expect(await liveGroupMembers(first.groupPid)).toEqual([])
    expect(await readFile(data)).toEqual(Buffer.from([1, 0, 255, 8]))
  },
  process.platform === 'win32' ? 180000 : 15000,
)

it.skipIf(process.platform === 'win32').each(['escalation', 'post-spawn error'] as const)(
  'retains the slot after %s until the actual managed child exits',
  async (mode) => {
    const root = await mkdtemp(join('/tmp', 'fictional-exit-order-'))
    roots.push(root)
    const entry = join(root, 'entry.mjs')
    const parentScript = join(root, 'parent.mjs')
    const shim = join(root, 'delay-signal.mjs')
    const escalated = join(root, 'escalated.json')
    const readyFile = join(root, 'runtime-ready')
    const slot = join(root, 'runtime.sqlite')
    await writeFile(
      entry,
      `import fs from 'node:fs';process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(readyFile)},String(process.pid));setInterval(()=>{},1000);`,
    )
    // Model a successful signal syscall whose actual target exit has not happened yet.
    // Only this fictional launcher is patched; the test retains final cleanup control.
    await writeFile(
      shim,
      `import fs from 'node:fs';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
if(process.argv[1]?.endsWith('process-launcher.mjs')&&${JSON.stringify(mode)}==='post-spawn error') {
 const spawn=cp.spawn;
 cp.spawn=(...args)=>{
  const child=spawn(...args);
  const timer=setInterval(()=>{
   try {
    if(fs.readFileSync(${JSON.stringify(readyFile)},'utf8')!==String(child.pid))return;
   }catch{return}
   clearInterval(timer);child.emit('error',new Error('Fictional post-spawn kill error'));
  },10);
  child.once('exit',()=>clearInterval(timer));return child;
 };
 syncBuiltinESMExports();
}
    if(/process-(?:launcher|guardian)[.]mjs$/.test(process.argv[1]??'')) {
 const kill=process.kill.bind(process);
 process.kill=(pid,signal)=>{
  if(pid<0&&signal==='SIGKILL') {
   fs.writeFileSync(process.env.FICTIONAL_ESCALATION,JSON.stringify({group:-pid}));return true;
  }
  return kill(pid,signal);
 };
}`,
    )
    await writeFile(
      parentScript,
      `import {fork} from 'node:child_process';
const [guardian,entry,slot]=process.argv.slice(2);
const child=fork(guardian,[],{execArgv:[],stdio:['pipe','pipe','ignore','ipc']});
child.stdout.resume();child.on('message',value=>{if(process.connected)process.send(value,()=>{})});
child.once('close',()=>process.exit(0));
process.on('message',value=>{if(value.type==='stop'&&child.connected)child.send({channel:'brocrew-plugin-process:v1',type:'stop'},()=>{})});
child.send({channel:'brocrew-plugin-process:v1',type:'launch',command:process.execPath,args:[entry],cwd:process.cwd(),slot,stop:{signal:'SIGTERM',graceMs:50}},()=>{});`,
    )
    function launch(delay = false) {
      const parent = fork(
        parentScript,
        [resolve(__dirname, '../resources/plugin-host/process-guardian.mjs'), entry, slot],
        {
          cwd: root,
          execArgv: [],
          env: {
            ...process.env,
            ...(delay
              ? {
                  NODE_OPTIONS: '--import=' + pathToFileURL(shim).href,
                  FICTIONAL_ESCALATION: escalated,
                }
              : {}),
          },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      )
      parents.push(parent)
      const started = new Promise<{ pid: number; groupPid: number }>((resolve, reject) => {
        parent.on('message', (value) => {
          const message = value as { type?: string; pid: number; groupPid: number }
          if (message.type === 'spawned') resolve(message)
        })
        parent.once('error', reject)
        parent.once('close', () => reject(new Error('Fictional parent exited before start')))
      })
      void started.catch(() => {})
      return { parent, started }
    }
    const first = launch(true)
    const runtime = await first.started
    await expect.poll(async () => readFile(readyFile, 'utf8')).toBe(String(runtime.pid))
    first.parent.kill('SIGKILL')
    await gone(first.parent)
    await expect
      .poll(async () => JSON.parse(await readFile(escalated, 'utf8')))
      .toHaveProperty('group')
    const { group } = JSON.parse(await readFile(escalated, 'utf8')) as { group: number }
    try {
      expect(() => process.kill(runtime.pid, 0)).not.toThrow()
      const second = launch()
      let started = false
      void second.started.then(() => {
        started = true
      })
      await new Promise((resolve) => setTimeout(resolve, 250))
      expect(started).toBe(false)
      process.kill(-group, 'SIGKILL')
      await second.started
      expect(() => process.kill(runtime.pid, 0)).toThrow()
    } finally {
      try {
        process.kill(-group, 'SIGKILL')
      } catch {
        // The captured fictional group is already gone.
      }
    }
  },
  15000,
)

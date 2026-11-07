// Fictional, retained-process fixture only. It never opens a default/live plugin root.
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { closeSync, openSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginSupervisor } from '../../src/main/plugins/supervisor/owner'
import { keepPluginRootPrivate } from '../../src/main/plugins/private-files'
import { SupervisorStorage } from '../../src/main/plugins/supervisor/storage'
import { recordDrainTrace } from '../../src/main/plugins/supervisor/drain-trace'

const [root, workspace, mode, fault] = process.argv.slice(2) as [string, string, string, string?]
const write = SupervisorStorage.prototype.write
SupervisorStorage.prototype.write = function (value) {
  if (value.phase === 'blocked' && fault === 'blocked-write-held')
    throw Object.assign(new Error('Bearer fictional-secret /fictional/private-owner-path'), {
      code: 'EPERM',
    })
  const reader = fault === 'terminal-record-held' && ['stopped', 'blocked'].includes(value.phase) ? openSync(this.record, 'r') : undefined
  try { return write.call(this, value) } finally { if (reader !== undefined) closeSync(reader) }
}
let releaseRevocations!: () => void
const revocations = new Promise<void>((resolve) => {
  releaseRevocations = resolve
})
let rejectStart: ((error: Error) => void) | undefined
let starting: Promise<unknown> | undefined
await keepPluginRootPrivate(root)
const owner = await PluginSupervisor.start({
  root,
  workspaceRoots: [workspace],
  drainWithin: 100,
  traceDrain: (event) => recordDrainTrace(root, event),
  revoke: async () => {
    if (mode === 'start-failure' || mode === 'revoke-hung') await revocations
  },
  onBlockedWithoutProcesses: () => {
    if (mode === 'gated') process.send?.({ event: 'retirement-ready' })
    else process.exit(0)
  },
})
void owner.closed.then(() => process.exit(0))
let physical: ChildProcess | undefined
process.on('message', (message) => {
  if (message === 'fail-start') {
    rejectStart?.(new Error('fictional start may have left an unknown descendant'))
    void starting
      ?.catch(() => undefined)
      .then(async () => {
        await new Promise((resolve) => setImmediate(resolve))
        releaseRevocations()
      })
  }
  if (message === 'finish') physical?.kill('SIGKILL')
  if (message === 'exit-now' && mode === 'gated') process.exit(0)
  if (message !== 'adopt') return
  void (async () => {
    if (mode === 'start-failure') {
      starting = owner.startChild(
        () =>
          new Promise((_resolve, reject) => {
            rejectStart = reject
          }),
      )
      void starting.catch(() => undefined)
      await new Promise((resolve) => setImmediate(resolve))
    }
    let runId: string | undefined
    if (['proven', 'live', 'unproved'].includes(mode)) {
      physical = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      await once(physical, 'spawn')
      const child = physical
      const actualExit = once(child, 'exit')
      runId = randomUUID()
      const run = join(root, 'host/runs', runId)
      await mkdir(run, { recursive: true, mode: 0o700 })
      const proof = actualExit.then(async () => {
        if (mode === 'unproved') throw new Error('fictional unproved exit')
        await writeFile(
          join(run, 'exit.json'),
          JSON.stringify({
            format: 1,
            runId,
            pluginId: 'fictional',
            releaseDigest: 'f'.repeat(64),
            guardianPid: child.pid,
            groups: [],
            exited: true,
          }),
          { mode: 0o600 },
        )
      })
      void proof.catch(() => undefined)
      owner.adopt({
        stop() {
          if (mode !== 'live') child.kill()
        },
        exited: proof,
        descendantsGone: async () => mode !== 'unproved',
      })
      if (mode === 'unproved') child.kill()
    }
    if (mode !== 'healthy') {
      let fail!: (error: Error) => void
      const done = new Promise<void>((_resolve, reject) => {
        fail = reject
      })
      void done.catch(() => undefined)
      owner.adopt({
        inProcess: true,
        stop() {
          if (mode === 'hung') return
          const error = new Error('fictional bridge cleanup failed')
          fail(error)
          throw error
        },
        exited: done,
        descendantsGone: async () => false,
      })
    }
    process.send?.({ event: 'adopted', runId })
  })().catch((error) => {
    console.error(error)
    process.exit(2)
  })
})
process.send?.({ event: 'ready' })

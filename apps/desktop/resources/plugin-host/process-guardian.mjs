// A captured managed-runtime lifetime, independent of the supervisor's process/writer lock.
import { fork } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startJobKeeper } from './windows-job.mjs'
import { acquireRuntimeLock } from './runtime-locks.mjs'
const channel = 'brocrew-plugin-process:v1'
let launcher,
  keeper,
  config,
  ending,
  releaseLocks,
  managedExit = false,
  launchSent = false,
  gone = false
let resolveGone
const launcherGone = new Promise((resolve) => {
  resolveGone = resolve
})
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const send = (value) => {
  if (process.connected) process.send({ channel, ...value }, () => {})
}
async function finish() {
  if (ending) return ending
  ending = Promise.resolve().then(async () => {
    const graceMs = config?.stop.graceMs ?? 3000
    if (launcher && !gone) {
      if (launcher.connected) launcher.send({ channel, type: 'stop' }, () => {})
      if (keeper) await Promise.race([launcherGone, pause(graceMs)])
      else await launcherGone
    }
    let clean = !launchSent || managedExit
    if (keeper) {
      if (launcher) {
        const terminated = await keeper.terminate()
        let empty = false
        for (const until = performance.now() + 5000; performance.now() < until;) {
          if ((await keeper.count()) === 0) {
            empty = true
            break
          }
          await pause(25)
        }
        clean = terminated && empty
      }
      if (clean) {
        if (launcher) await launcherGone
        clean = await keeper.end()
      }
    }
    if (!clean) {
      send({ type: 'stopped', exited: false })
      // An uncertain physical stop retains this data mutex. The supervisor may report a
      // local stop failure; it must not start another runtime against these same directories.
      return new Promise(() => {
        setInterval(() => {}, 1000)
      })
    }
    await releaseLocks?.()
    if (process.connected)
      await new Promise((resolve) =>
        process.send({ channel, type: 'stopped', exited: true }, () => resolve()),
      )
    process.exit(0)
  })
  return ending
}
process.once('disconnect', () => void finish())
process.once('SIGTERM', () => void finish())
process.once('SIGINT', () => void finish())
process.stdin.on('error', () => {})
process.on('message', (message) => {
  if (message?.channel !== channel) return
  if (message.type === 'stop') return void finish()
  if (message.type !== 'launch' || config || ending) return
  config = message
  void (async () => {
    releaseLocks = await acquireRuntimeLock(config.slot, () => Boolean(ending))
    if (!releaseLocks || ending || !process.connected) return void finish()
    if (process.platform === 'win32') {
      keeper = startJobKeeper({ cache: config.keeperCache, openMs: 120000 })
      if ((await keeper.opened) === null) {
        send({ type: 'unsupported' })
        await finish()
        return
      }
      send({ type: 'job' })
    }
    if (ending || !process.connected) return void finish()
    launcher = fork(join(dirname(fileURLToPath(import.meta.url)), 'process-launcher.mjs'), [], {
      execPath: process.execPath,
      execArgv: [],
      cwd: config.cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    launcher.stdin.on('error', () => {})
    process.stdin.pipe(launcher.stdin)
    launcher.stdout.pipe(process.stdout)
    launcher.stderr.pipe(process.stderr)
    launcher.on('message', (value) => {
      if (value?.channel !== channel) return
      if (value.type === 'spawned') {
        send({ type: 'spawned', pid: value.pid, groupPid: value.groupPid })
      } else if (value.type === 'managed-exit') managedExit = value.exited === true
      else if (value.type === 'failed') send({ type: 'failed' })
    })
    launcher.on('error', () => {
      if (!launcher.pid) {
        gone = true
        resolveGone()
      }
      void finish()
    })
    launcher.once('exit', () => {
      gone = true
      resolveGone()
      void finish()
    })
    // This waiting app launcher enters the job before it can spawn/evaluate package code.
    if (keeper && !(await keeper.assign(launcher.pid))) {
      launcher.kill('SIGKILL')
      send({ type: 'unsupported' })
      await finish()
      return
    }
    if (ending || !process.connected) return void finish()
    launchSent = true
    launcher.send({ ...config, channel, type: 'launch' }, () => {})
  })().catch(() => {
    send({ type: 'failed' })
    void finish()
  })
})

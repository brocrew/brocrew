// The holder observes its direct managed child exit before it can release the guardian's mutex.
import { spawn } from 'node:child_process'
const channel = 'brocrew-plugin-process:v1'
let child,
  config,
  stopping = false,
  ending,
  killTimer,
  started = false,
  gone = false
let resolveGone
const childGone = new Promise((resolve) => {
  resolveGone = resolve
})
const send = (value) => {
  if (process.connected) process.send({ channel, ...value }, () => {})
}
function signal(kind) {
  if (!child?.pid || gone) return
  try {
    if (process.platform === 'win32') child.kill(kind)
    else process.kill(-child.pid, kind)
  } catch {
    // The retained direct handle remains the fallback; signal success never stands for exit.
    child.kill('SIGKILL')
  }
}
async function finish() {
  if (ending) return ending
  ending = Promise.resolve().then(async () => {
    stopping = true
    if (child && !gone) {
      signal(config.stop.signal)
      killTimer = setTimeout(() => signal('SIGKILL'), config.stop.graceMs ?? 3000)
      await childGone
    }
    clearTimeout(killTimer)
    if (child?.pid && process.platform !== 'win32') {
      // Best-effort cleanup of inherited helpers in this captured group. Detached helpers are
      // the package's responsibility; they are not included in the managed-runtime mutex.
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The captured group is normally already gone after its runtime exits.
      }
    }
    if (process.connected)
      await new Promise((resolve) =>
        process.send({ channel, type: 'managed-exit', exited: true }, () => resolve()),
      )
    process.exit(0)
  })
  return ending
}
process.once('disconnect', () => void finish())
process.once('SIGTERM', () => void finish())
process.once('SIGINT', () => void finish())
process.on('message', (message) => {
  if (message?.channel !== channel) return
  if (message.type === 'stop') return void finish()
  if (message.type !== 'launch' || config || stopping) return
  config = message
  try {
    child = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdin.on('error', () => {})
    process.stdin.pipe(child.stdin)
    child.stdout.pipe(process.stdout)
    child.stderr.pipe(process.stderr)
    child.once('spawn', () => {
      started = true
      send({ type: 'spawned', pid: child.pid, groupPid: child.pid })
    })
    child.on('error', () => {
      if (!started && !child.pid) {
        gone = true
        resolveGone()
      }
      send({ type: 'failed' })
      void finish()
    })
    child.once('exit', (code, signal) => {
      gone = true
      resolveGone()
      send({ type: 'package-exit', code, signal })
      void finish()
    })
  } catch {
    gone = true
    resolveGone()
    send({ type: 'failed' })
    void finish()
  }
})

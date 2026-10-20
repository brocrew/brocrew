// Keep every Node-launched child in the server's already-owned group, even during a crash in spawn.
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
const owned = new Map()
const kill = process.kill.bind(process)
const windows = process.platform === 'win32'
for (const name of ['spawn', 'fork', 'execFile', 'exec']) {
  const original = childProcess[name]
  childProcess[name] = function (...args) {
    const index = args.findLastIndex((v) => v && typeof v === 'object' && !Array.isArray(v))
    const options = index < 0 ? undefined : args[index]
    if (options?.detached === true) args[index] = { ...options, detached: false }
    if (owned.size >= 256) throw new Error('plugin-host-child-limit')
    const child = Reflect.apply(original, this, args)
    if (child.pid) {
      owned.set(child.pid, child)
      child.once('exit', () => owned.delete(child.pid))
    }
    return child
  }
}
// On Windows, Playwright's force-close runs `taskkill /pid N /T /F`, which ends a tree by parent
// number and can reach what a stranger who once held a number started. Here it ends exactly the
// child this process started, through its own handle; the job holds the rest. Any other taskkill
// is refused.
if (windows) {
  const taskkill = /^taskkill \/pid (\d+) \/T \/F$/i
  for (const name of ['spawnSync', 'execSync', 'execFileSync']) {
    const original = childProcess[name]
    childProcess[name] = function (...args) {
      const line = typeof args[0] === 'string' ? args[0].trim() : ''
      if (!/^taskkill\b/i.test(line)) return Reflect.apply(original, this, args)
      const child = owned.get(Number(taskkill.exec(line)?.[1]))
      if (!child) throw new Error('plugin-host-foreign-kill')
      child.kill('SIGKILL')
      const empty = Buffer.alloc(0)
      return name === 'spawnSync'
        ? {
            pid: 0,
            output: [null, empty, empty],
            stdout: empty,
            stderr: empty,
            status: 0,
            signal: null,
          }
        : empty
    }
  }
}
// Playwright's force-close assumes its browser leads a group. Here a force-close fails the host
// closed, so it cannot mistake ESRCH for cleanup while an inherited browser writer survives.
process.kill = function (pid, signal) {
  return kill(pid < 0 && owned.has(-pid) ? -process.pid : pid, signal)
}
syncBuiltinESMExports()
process.once('disconnect', () => process.exit(1))
// A signal on Windows ends a process at once, so the guardian asks for a stop on this channel and
// the plugin's own shutdown runs as it would on SIGTERM.
if (windows)
  process.on('message', (message) => {
    if (
      message?.channel !== 'brocrew-plugin-node:v1' ||
      message.runId !== process.env.BROCREW_PLUGIN_RUN_ID ||
      message.type !== 'stop'
    )
      return
    if (process.listenerCount('SIGTERM') > 0) process.emit('SIGTERM', 'SIGTERM')
    else process.exit(0)
  })
// Node awaits this preload before evaluating the package entry or any of its imports.
await new Promise((resolve) => {
  if (!process.connected) process.exit(1)
  const admitted = (message) => {
    if (
      message?.channel !== 'brocrew-plugin-node:v1' ||
      message.runId !== process.env.BROCREW_PLUGIN_RUN_ID ||
      message.type !== 'admitted'
    )
      return
    process.off('message', admitted)
    resolve()
  }
  process.on('message', admitted)
  process.send({
    channel: 'brocrew-plugin-node:v1',
    runId: process.env.BROCREW_PLUGIN_RUN_ID,
    type: 'awaiting-admission',
  })
})

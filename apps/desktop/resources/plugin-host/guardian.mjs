// This process survives a window host crash long enough to prove owned child groups have exited.
// On Windows the server is held in a job object instead of a process group (windows-job.ps1).
import { fork } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stopGroups, groupIdentity, pluginServerLaunch } from './process-groups.mjs'
import { writeReceipt } from './receipts.mjs'
import { startJobKeeper } from './windows-job.mjs'
const configPath = process.argv[2]
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const receiptRoot = dirname(configPath)
const receipt = () => ({
  format: 1,
  runId: config.runId,
  pluginId: config.pluginId,
  releaseDigest: config.releaseDigest,
  guardianPid: process.pid,
  groups: [...groups],
})
const groups = new Map()
let uncertain = false
let finishing = false
let closed = false
let admitted = false
let awaiting = false
let admissionSent = false
/** The server, once forked. */
let child
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function releaseEntry() {
  if (!finishing && admitted && awaiting && !admissionSent && child.connected) {
    admissionSent = true
    child.send(
      { channel: 'brocrew-plugin-node:v1', runId: config.runId, type: 'admitted' },
      () => {},
    )
  }
}
let closedResolve
const childClosed = new Promise((resolve) => {
  closedResolve = resolve
})
const send = (value) => {
  if (process.connected)
    process.send({ channel: 'brocrew-plugin-node:v1', runId: config.runId, ...value }, () => {})
}
// A first open compiles the job code, which can take tens of seconds on a cold machine.
const keeper =
  process.platform === 'win32'
    ? startJobKeeper({ cache: config.keeperCache, openMs: 120_000 })
    : null
/**
 * Stops the server and ends its job. The server is asked to stop over its channel, since a signal
 * on Windows ends a process at once and its own shutdown would never run; then the job is ended,
 * and it must be empty in time. The job's process count is the proof a process group gives elsewhere.
 */
async function endJob() {
  if (child?.connected)
    child.send({ channel: 'brocrew-plugin-node:v1', runId: config.runId, type: 'stop' }, () => {})
  await Promise.race([childClosed, pause(2000)])
  const ended = await keeper.terminate()
  for (const until = performance.now() + 2000; performance.now() < until;) {
    if ((await keeper.count()) === 0) return ended
    await pause(25)
  }
  return false
}
/** Why the guardian stopped, in one closed word, kept in the run's exit receipt. */
let cause = null
async function finish(why = 'stop') {
  cause ??= why
  if (finishing) return
  finishing = true
  let exited
  if (keeper) {
    const empty = child ? await endJob() : true
    // A server the job refused is ended through this process's own handle on it.
    if (child && !closed) child.kill('SIGKILL')
    if (child) await Promise.race([childClosed, pause(2000)])
    // The keeper's exit closes its job: a stop is clean only once it has gone, even one that
    // came while the keeper was still compiling its code.
    const keeperGone = await keeper.end()
    exited = !uncertain && (!child || closed) && empty && keeperGone
  } else {
    await stopGroups(groups)
    await Promise.race([childClosed, pause(2000)])
    exited = !uncertain && closed && (await stopGroups(groups, 0))
  }
  await Promise.all(
    ['auth.json', 'launch.json'].map((name) => rm(join(receiptRoot, name), { force: true })),
  )
  writeReceipt(receiptRoot, 'exit.json', {
    ...receipt(),
    exited,
    cause,
    ...(keeper ? { keeperPid: keeper.pid } : {}),
    ...(keeper && openedMs === null ? { keeperFailure: keeper.reason } : {}),
  })
  await new Promise((resolve) => {
    if (!process.connected) return resolve()
    process.send(
      { channel: 'brocrew-plugin-node:v1', runId: config.runId, type: 'stopped', exited },
      () => resolve(),
    )
  })
  process.exit(exited ? 0 : 1)
}
process.once('disconnect', () => {
  void finish('host-gone')
})
process.once('SIGTERM', () => {
  void finish('signal')
})
process.once('SIGINT', () => {
  void finish('signal')
})
process.on('message', (message) => {
  if (message?.channel !== 'brocrew-plugin-node:v1' || message.runId !== config.runId) return
  if (message.type === 'stop') void finish()
  else if (
    message.type === 'admit' &&
    !finishing &&
    child &&
    groups.has(child.pid) &&
    message.pid === child.pid &&
    message.birth === groups.get(child.pid)
  ) {
    admitted = true
    releaseEntry()
  }
})
/** How long the keeper took to open its job, kept in the run's process receipt on Windows. */
let openedMs
if (keeper) {
  openedMs = await keeper.opened
  // Without a job nothing may start: the refusal is closed, and nothing was left running.
  if (openedMs === null) {
    send({ type: 'unsupported', reason: keeper.reason })
    await finish('keeper')
  } else send({ type: 'job', openedMs })
}
if (!finishing) {
  child = fork(config.entry, [], {
    ...pluginServerLaunch(
      process.execPath,
      join(dirname(fileURLToPath(import.meta.url)), 'server.mjs'),
    ),
    cwd: config.home,
    env: process.env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  child.on('message', (message) => {
    if (message?.channel !== 'brocrew-plugin-node:v1' || message.runId !== config.runId) return
    if (message.type === 'awaiting-admission') {
      awaiting = true
      send({ type: 'awaiting-admission', serverPid: child.pid })
      releaseEntry()
      return
    }
    if (
      admissionSent &&
      !finishing &&
      message?.type === 'listening' &&
      Number.isInteger(message.port) &&
      message.port > 0 &&
      message.port <= 65535
    )
      void (keeper ? keeper.priorityClamped() : Promise.resolve(undefined)).then((clamped) =>
        send({
          type: 'listening',
          port: message.port,
          serverPid: child.pid,
          ...(keeper ? { priorityClamped: clamped } : {}),
        }),
      )
    else if (message?.type === 'failed') void finish('server-failed')
  })
  child.once('error', () => {
    void finish('server-error')
  })
  child.once('close', () => {
    closed = true
    closedResolve()
    void finish('server-closed')
  })
  if (child.pid) {
    // The server waits for admission before any plugin code runs, so it has started nothing yet.
    const birth = keeper ? await keeper.assign(child.pid) : groupIdentity(child.pid)
    if (birth) groups.set(child.pid, birth)
    else uncertain = true
    writeReceipt(receiptRoot, 'process.json', { ...receipt(), ...(keeper ? { openedMs } : {}) })
    send({ type: 'group', pid: child.pid, birth })
    if (keeper && !birth) void finish('assign-refused')
  }
}
if (!process.connected) void finish('host-gone')

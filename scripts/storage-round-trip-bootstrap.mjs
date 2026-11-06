import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { captureProcessIdentity, defaultReadProcessIdentity } from './lib/owned-process.mjs'
import {
  liveIdentity,
  identityState,
  publish,
  readJson,
  sameLife,
  scriptDirectory,
} from './storage-round-trip-process.mjs'

const directory = process.argv[2],
  intent = readJson(join(directory, 'intent.json'))
const identity = captureProcessIdentity(process.pid)
if (
  !identity ||
  identity.parentPid !== intent.coordinator.pid ||
  identity.pgid !== identity.pid ||
  !liveIdentity(intent.coordinator) ||
  !liveIdentity(intent.watchdog)
)
  throw new Error('Bootstrap owner mismatch')
publish(join(directory, 'registration.json'), { identity })
let target = null,
  admitted = false,
  requested = false,
  reaping = false,
  watchdogLostAt = null
const began = Date.now()
function stateOfWatchdog() {
  try {
    const state = readJson(join(intent.scratch, 'supervisor.json'))
    return sameLife(state.identity, intent.watchdog) ? state : null
  } catch {
    return null
  }
}
function requestClosure(reason) {
  if (requested) return
  requested = true
  const receipt = {
    at: Date.now(),
    outcome: 'INCOMPLETE',
    complete: false,
    reason,
  }
  publish(join(directory, 'bootstrap-failure.json'), receipt)
  publish(join(intent.evidence, 'admissions', basename(directory) + '-failure.json'), receipt)
}
function retirePeer(saved, reason) {
  const now = defaultReadProcessIdentity(saved.pid)
  if (!sameLife(saved, now) || now.runState.startsWith('Z')) return
  publish(join(directory, reason + '.json'), {
    at: Date.now(),
    outcome: 'INCOMPLETE',
    identity: now,
  })
  process.kill(saved.pid, 'SIGKILL')
}
function monitor() {
  if (reaping) return
  const observerState = identityState(intent.watchdog),
    ownerState = identityState(intent.coordinator),
    state = stateOfWatchdog()
  if (observerState === 'alive') {
    if (ownerState !== 'alive' || !state?.accepting || (!admitted && Date.now() - began > 5000))
      requestClosure('owner/admission lease lost; independent watchdog owns closure')
    // An acknowledged containment keeps the stable leader available to that closer. For a
    // stalled armed observer, retire its exact life before any fallback can be considered.
    if ((!state || Date.now() - state.at > 5000) && state?.mode !== 'containing') {
      requestClosure('watchdog heartbeat expired')
      retirePeer(intent.watchdog, 'watchdog-retirement')
    }
    return
  }
  if (observerState !== 'gone') {
    requestClosure('watchdog identity uncertain')
    return
  }
  requestClosure('watchdog verified gone')
  watchdogLostAt ??= Date.now()
  if (ownerState === 'alive') {
    // The still-live coordinator gets exclusive fallback authority first. Only verified death
    // of that coordinator permits this bootstrap to hand its family to a separate reaper.
    if (Date.now() - watchdogLostAt > 5000) retirePeer(intent.coordinator, 'coordinator-retirement')
    return
  }
  if (ownerState !== 'gone') return
  reaping = true
  if (!target) {
    process.kill(-process.pid, 'SIGKILL')
    return
  }
  const reaper = spawn(
    process.execPath,
    [join(scriptDirectory, 'storage-round-trip-reaper.mjs'), directory],
    { cwd: intent.scratch, env: intent.env, detached: true, stdio: 'ignore' },
  )
  reaper.on('error', () => {
    publish(join(directory, 'reaper-failure.json'), {
      outcome: 'INCOMPLETE',
      reason: 'reaper spawn failed; VM teardown required',
    })
    process.kill(-process.pid, 'SIGKILL')
  })
}
process.on('SIGTERM', () => {})
process.on('SIGINT', () => {})
process.on('disconnect', () => {
  requestClosure('coordinator IPC lost')
  monitor()
})
setInterval(() => {
  try {
    monitor()
  } catch {
    requestClosure('peer observation unavailable')
  }
}, 250)
process.on('message', (message) => {
  if (message?.type !== 'execute' || admitted || requested) return
  try {
    const ack = readJson(join(directory, 'admitted.json'))
    const state = stateOfWatchdog()
    if (
      identityState(intent.watchdog) !== 'alive' ||
      identityState(intent.coordinator) !== 'alive' ||
      !state?.accepting ||
      Date.now() - state.at > 5000 ||
      !sameLife(identity, ack.identity) ||
      !sameLife(intent.watchdog, ack.watchdog)
    )
      throw new Error('Admission missing')
    admitted = true
    target = spawn(intent.command, intent.args, {
      cwd: intent.cwd,
      env: intent.env,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
    target.once('error', () =>
      publish(join(directory, 'terminal.json'), {
        pid: target.pid ?? null,
        code: null,
        signal: null,
        spawnError: true,
      }),
    )
    target.once('spawn', () => publish(join(directory, 'target.json'), { pid: target.pid }))
    target.once('exit', (code, signal) =>
      publish(join(directory, 'terminal.json'), {
        pid: target.pid,
        code,
        signal,
        spawnError: false,
      }),
    )
  } catch {
    requestClosure('independent admission refused')
  }
})
// The observer may already be containing the new registration; never launch on a stale ack.
if (existsSync(join(directory, 'stop-request.json'))) requestClosure('stopped before execution')

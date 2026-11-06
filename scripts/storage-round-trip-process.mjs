import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  captureProcessIdentity,
  createOwnedProcessLifecycle,
  defaultReadProcessIdentity,
} from './lib/owned-process.mjs'
import { descendantsOf } from './lib/owned-teardown.mjs'

export const scriptDirectory = dirname(fileURLToPath(import.meta.url))
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
export const publish = (file, value) => {
  const temp = file + '.' + randomUUID() + '.tmp'
  writeFileSync(temp, JSON.stringify(value) + '\n', { flag: 'wx' })
  renameSync(temp, file)
}
export const sameLife = (saved, now) =>
  Boolean(
    saved &&
    now &&
    ['pid', 'start', 'executable', 'command', 'pgid'].every((key) => saved[key] === now[key]) &&
    (saved.parentPid === now.parentPid || now.parentPid === 1),
  )
export const liveIdentity = (saved) => {
  const now = defaultReadProcessIdentity(saved.pid)
  return sameLife(saved, now) && !now.runState.startsWith('Z')
}
export function identityState(saved) {
  try {
    const now = defaultReadProcessIdentity(saved.pid)
    if (!now || now.start !== saved.start || now.runState.startsWith('Z')) return 'gone'
    return sameLife(saved, now) ? 'alive' : 'uncertain'
  } catch {
    return 'uncertain'
  }
}
// The shared lifecycle deliberately does not reparent its launcher authority. Revalidate each
// already owned life here, including an expected move to init, before making a fresh lifecycle.
// Freeze known roots before scanning so detached descendants cannot race a live parent away.
export function closeFamily(
  savedIdentities,
  { excludeSelfTree = false, requiredLeader = null } = {},
) {
  const authority = requiredLeader
    ? { saved: requiredLeader, before: null, frozen: null, established: false }
    : null
  const excluded = () =>
    new Set([
      process.pid,
      ...(excludeSelfTree ? descendantsOf(process.pid).map((row) => row.pid) : []),
    ])
  const roots = [],
    refused = [],
    unmatched = [],
    closures = []
  for (const saved of savedIdentities) {
    if (excluded().has(saved.pid)) continue
    try {
      const now = captureProcessIdentity(saved.pid)
      if (!now || now.runState.startsWith('Z')) continue
      if (now.start !== saved.start) continue
      if (!sameLife(saved, now)) {
        unmatched.push(saved)
        continue
      }
      // Negative group authority is used only while its recorded leader is the same live life.
      if (saved.pid === requiredLeader?.pid) {
        authority.before = now
        if (!sameLife(requiredLeader, now)) throw new Error('Required leader changed')
      }
      process.kill(now.pgid === now.pid ? -now.pid : now.pid, 'SIGSTOP')
      if (saved.pid === requiredLeader?.pid) {
        // A stop request is not evidence that final discovery authority survived. Require this
        // closer to observe the same stable leader frozen before delegating census/retirement.
        const frozen = captureProcessIdentity(saved.pid)
        authority.frozen = frozen
        if (!sameLife(requiredLeader, frozen) || !/^[Tt]/.test(frozen.runState))
          throw new Error('Required leader freeze unverified')
      }
      roots.push(
        createOwnedProcessLifecycle({
          launcherPid: now.pid,
          discoverDescendants: (root) =>
            descendantsOf(root).filter((row) => !excluded().has(row.pid)),
        }),
      )
      if (saved.pid === requiredLeader?.pid) authority.established = true
    } catch {
      unmatched.push(saved)
    }
  }
  for (const root of roots) closures.push({ ...root.kill9(), identities: root.identities })
  // An exec can invalidate an old child identity. Only fresh ancestry/group discovery above
  // may earn new authority over it; it must be gone afterward, or closure remains unverified.
  for (const saved of unmatched) {
    if (identityState(saved) !== 'gone') refused.push(saved.pid)
  }
  if (authority && !authority.established && !refused.includes(requiredLeader.pid))
    refused.push(requiredLeader.pid)
  return {
    complete: refused.length === 0 && closures.every((result) => result.complete),
    authority,
    refused,
    closures,
  }
}
export const delay = (ms) => new Promise((done) => setTimeout(done, ms))
export async function waitFor(test, ms, label) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = test()
    if (value) return value
    await delay(50)
  }
  throw new Error(label + ' timed out')
}

// Admission belongs to the independent watchdog. A bootstrap has no product child until its
// exact process life is acknowledged there, and stays alive after that child exits.
export async function startSupervision({
  scratch,
  evidence,
  env,
  registerLifecycle = () => {},
  receipt = () => {},
  limitMs = 55 * 60 * 1000,
}) {
  const coordinator = captureProcessIdentity(process.pid)
  if (!coordinator) throw new Error('Coordinator identity unavailable')
  mkdirSync(join(scratch, 'launches'))
  mkdirSync(join(evidence, 'admissions'))
  const ownerFile = join(scratch, 'owner.json')
  if (existsSync(ownerFile)) {
    if (!sameLife(readJson(ownerFile).identity, coordinator)) throw new Error('Owner changed')
  } else publish(ownerFile, { pid: process.pid, identity: coordinator })
  const child = spawn(
    process.execPath,
    [join(scriptDirectory, 'storage-round-trip-watchdog.mjs'), scratch, evidence, String(limitMs)],
    {
      cwd: scratch,
      env,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  )
  let spawnError = false
  child.on('error', () => {
    spawnError = true
  })
  const watchdog = await waitFor(
    () => {
      if (spawnError || child.exitCode !== null || child.signalCode !== null)
        throw new Error('Watchdog failed before admission')
      const file = join(scratch, 'supervisor.json')
      if (!existsSync(file)) return false
      const state = readJson(file)
      return (
        state.accepting && state.identity.pid === child.pid && liveIdentity(state.identity) && state
      )
    },
    10000,
    'Watchdog ready',
  )
  const healthy = () => {
    const state = readJson(join(scratch, 'supervisor.json'))
    if (
      !sameLife(watchdog.identity, state.identity) ||
      !state.accepting ||
      Date.now() - state.at > 5000 ||
      !liveIdentity(watchdog.identity)
    )
      throw new Error('Independent watchdog lease lost')
  }
  const handles = []
  const launch = async ({
    command,
    args = [],
    cwd = scratch,
    env: childEnv = env,
    stdio = ['ignore', 'pipe', 'pipe'],
    label = 'command',
  }) => {
    healthy()
    const directory = join(scratch, 'launches', randomUUID())
    mkdirSync(directory)
    publish(join(directory, 'intent.json'), {
      coordinator,
      watchdog: watchdog.identity,
      command,
      args,
      cwd,
      env: childEnv,
      directory,
      scratch,
      evidence,
      label,
    })
    const bootstrap = spawn(
      process.execPath,
      [join(scriptDirectory, 'storage-round-trip-bootstrap.mjs'), directory],
      {
        cwd: scratch,
        env,
        detached: true,
        stdio: [...stdio, 'ipc'],
      },
    )
    let bootstrapError = false
    bootstrap.on('error', () => {
      bootstrapError = true
    })
    const closed = new Promise((done) =>
      bootstrap.once('close', (code, signal) => done({ code, signal })),
    )
    let life
    const terminalFile = join(directory, 'terminal.json')
    try {
      await waitFor(
        () => {
          healthy()
          if (bootstrapError || bootstrap.exitCode !== null || bootstrap.signalCode !== null)
            throw new Error('Bootstrap exited before admission')
          const file = join(directory, 'registration.json')
          if (!existsSync(file)) return false
          const registration = readJson(file)
          if (
            registration.identity.pid !== bootstrap.pid ||
            registration.identity.parentPid !== coordinator.pid
          )
            throw new Error('Bootstrap registration mismatch')
          return true
        },
        5000,
        'Bootstrap registration',
      )
      life = createOwnedProcessLifecycle({
        launcherPid: bootstrap.pid,
        discoverDescendants: descendantsOf,
        // This is an identity observer. Only the independent closer may own exit cleanup.
        eventEmitter: new EventEmitter(),
      })
      let closedOutcome = null
      const lifecycle = Object.freeze({
        launcher: life.launcher,
        remember: life.remember,
        refreshDescendants: life.refreshDescendants,
        signalRememberedWhy: life.signalRememberedWhy,
        stop: async () => {
          if (closedOutcome) return closedOutcome
          publish(join(directory, 'stop-request.json'), { at: Date.now() })
          const closedFile = join(directory, 'watchdog-closure.json')
          closedOutcome = await waitFor(
            () => {
              if (existsSync(closedFile)) return readJson(closedFile).closure
              // Only a verified dead prior closer permits coordinator takeover. A stalled or
              // uncertain live watchdog never grants parallel kill authority.
              if (identityState(watchdog.identity) === 'gone') {
                const observed = join(directory, 'observed.json')
                const known = existsSync(observed) ? readJson(observed).identities : life.identities
                const closure = closeFamily(known)
                publish(
                  join(
                    evidence,
                    'admissions',
                    directory.split('/').at(-1) + '-coordinator-fallback.json',
                  ),
                  { outcome: 'INCOMPLETE', closure },
                )
                const priorFile = join(evidence, 'watchdog-failure.json')
                const prior = existsSync(priorFile) ? readJson(priorFile) : {}
                publish(priorFile, {
                  ...prior,
                  outcome: 'INCOMPLETE',
                  coordinatorFallback: { reason: 'verified watchdog loss', closure },
                })
                return { ...closure, intervention: true }
              }
              return false
            },
            30000,
            'Independent closure acknowledgement',
          )
          return closedOutcome
        },
        get identities() {
          return life.identities
        },
      })
      handles.push(lifecycle)
      registerLifecycle(lifecycle)
      await waitFor(
        () => {
          healthy()
          const file = join(directory, 'admitted.json')
          if (!existsSync(file)) return false
          const ack = readJson(file)
          if (!sameLife(life.launcher, ack.identity) || !sameLife(watchdog.identity, ack.watchdog))
            throw new Error('Independent admission mismatch')
          return true
        },
        5000,
        'Independent admission',
      )
      bootstrap.send({ type: 'execute' })
      const target = await waitFor(
        () => {
          healthy()
          const file = join(directory, 'target.json')
          if (!existsSync(file) && existsSync(terminalFile))
            throw new Error('Command failed before process handoff')
          return existsSync(file) && readJson(file)
        },
        5000,
        'Actual process handoff',
      )
      life.remember(target.pid)
      receipt('launch-admitted', { label, directory, bootstrap: life.launcher, target })
      const exited = (async () => {
        while (!existsSync(terminalFile)) {
          healthy()
          if (bootstrapError || bootstrap.exitCode !== null || bootstrap.signalCode !== null)
            throw new Error('Bootstrap died without target exit receipt')
          await delay(50)
        }
        return readJson(terminalFile)
      })()
      void exited.catch(() => {})
      return { child: bootstrap, pid: target.pid, exited, closed, lifecycle, directory }
    } catch (error) {
      publish(join(directory, 'stop-request.json'), { at: Date.now(), failedAdmission: true })
      if (life && identityState(watchdog.identity) === 'gone') closeFamily(life.identities)
      // An uncaptured bootstrap cannot have an acknowledged execute request. Its own lease
      // expires without ever launching a command; no bare PID grants signal authority here.
      throw error
    }
  }
  return {
    child,
    launch,
    healthy,
    async disarm() {
      healthy()
      for (const life of handles) {
        const closure = await life.stop()
        if (!closure.complete) throw new Error('Supervisor disarm refused: owned life remains')
      }
      child.send({ type: 'disarm' })
      await waitFor(
        () => child.exitCode !== null || child.signalCode !== null,
        15000,
        'Watchdog disarm',
      )
      if (
        child.exitCode !== 0 ||
        child.signalCode !== null ||
        existsSync(join(evidence, 'watchdog-failure.json'))
      )
        throw new Error('Watchdog intervention forbids completion')
    },
  }
}

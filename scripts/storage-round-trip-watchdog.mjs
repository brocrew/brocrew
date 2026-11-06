import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  captureProcessIdentity,
  createOwnedProcessLifecycle,
  defaultReadProcessIdentity,
} from './lib/owned-process.mjs'
import { descendantsOf } from './lib/owned-teardown.mjs'
import {
  closeFamily,
  delay,
  liveIdentity,
  publish,
  readJson,
  sameLife,
} from './storage-round-trip-process.mjs'

const scratch = resolve(process.argv[2]),
  evidence = resolve(process.argv[3]),
  limitMs = Number(process.argv[4])
if (
  process.platform !== 'darwin' ||
  process.arch !== 'arm64' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
  process.env.GITHUB_REPOSITORY !== 'brocrew/brocrew' ||
  !(limitMs > 0 && limitMs <= 55 * 60 * 1000)
)
  throw new Error('Hosted arm64 watchdog only')
const coordinator = readJson(join(scratch, 'owner.json')).identity,
  identity = captureProcessIdentity(process.pid)
if (!identity || identity.parentPid !== coordinator.pid || !liveIdentity(coordinator))
  throw new Error('Watchdog owner mismatch')
const began = Date.now(),
  entries = new Map()
let mode = 'armed',
  timer,
  receipt
const status = () =>
  publish(join(scratch, 'supervisor.json'), {
    identity,
    accepting: mode === 'armed',
    mode,
    at: Date.now(),
  })
function scan(admit) {
  for (const name of readdirSync(join(scratch, 'launches'))) {
    const directory = join(scratch, 'launches', name),
      registration = join(directory, 'registration.json')
    if (
      existsSync(join(directory, 'bootstrap-failure.json')) ||
      existsSync(join(directory, 'reaper-closure.json')) ||
      existsSync(join(directory, 'reaper-failure.json'))
    ) {
      if (mode !== 'containing') throw new Error('Bootstrap supervision intervention')
      receipt.bootstrapInterventions ??= []
      if (!receipt.bootstrapInterventions.includes(name)) receipt.bootstrapInterventions.push(name)
    }
    if (!existsSync(registration)) continue
    let entry = entries.get(name)
    if (!entry) {
      const intent = readJson(join(directory, 'intent.json')),
        saved = readJson(registration).identity
      if (
        !sameLife(intent.coordinator, coordinator) ||
        !sameLife(intent.watchdog, identity) ||
        saved.parentPid !== coordinator.pid ||
        saved.pgid !== saved.pid
      )
        throw new Error('Independent launch registration mismatch')
      const now = captureProcessIdentity(saved.pid)
      if (!sameLife(saved, now)) {
        if (!existsSync(join(directory, 'admitted.json')) && now === null) continue
        throw new Error('Registered bootstrap identity unavailable')
      }
      const life = createOwnedProcessLifecycle({
        launcherPid: saved.pid,
        discoverDescendants: descendantsOf,
      })
      entry = { directory, name, life, closed: false }
      entries.set(name, entry)
      if (admit && mode === 'armed')
        publish(join(directory, 'admitted.json'), {
          identity: life.launcher,
          watchdog: identity,
          at: Date.now(),
        })
    }
    if (entry.closed) continue
    // Missing stable authority is sticky intervention even if a normal stop request arrived.
    // The shared refresh helper intentionally cannot discover from a dead launcher.
    if (mode === 'armed' && !liveIdentity(entry.life.launcher))
      throw new Error('Bootstrap authority lost before independent closure')
    if (!entry.life.refreshDescendants())
      throw new Error('Independent descendant discovery uncertain')
    publish(join(directory, 'observed.json'), { identities: entry.life.identities })
    publish(join(evidence, 'admissions', name + '.json'), {
      label: readJson(join(directory, 'intent.json')).label,
      identities: entry.life.identities,
      admitted: existsSync(join(directory, 'admitted.json')),
      terminal: existsSync(join(directory, 'terminal.json'))
        ? readJson(join(directory, 'terminal.json'))
        : null,
    })
    if (mode === 'armed' && existsSync(join(directory, 'stop-request.json'))) {
      const closure = closeFamily(entry.life.identities, { requiredLeader: entry.life.launcher })
      publish(join(directory, 'watchdog-closure.json'), {
        closure,
        identities: entry.life.identities,
      })
      publish(join(evidence, 'admissions', name + '-closure.json'), {
        closure,
        identities: entry.life.identities,
      })
      if (!closure.complete) throw new Error('Independent closure incomplete')
      entry.closed = true
    }
  }
}
async function contain(reason) {
  if (mode !== 'armed') return
  mode = 'containing'
  clearInterval(timer)
  receipt = {
    reason,
    at: new Date().toISOString(),
    outcome: 'INCOMPLETE',
    complete: false,
    closureStatus: 'unverified',
    failureBoundary: {
      case: 'watchdog dies after coordinator and bootstrap are frozen',
      result: 'INCOMPLETE',
      descendantClosureClaim: false,
      containment: 'disposable-hosted-VM teardown',
    },
    signals: [],
    closures: [],
    errors: [],
  }
  const durable = () => {
    publish(join(evidence, 'watchdog-failure.json'), receipt)
    publish(join(evidence, 'watchdog-cleanup.json'), receipt)
  }
  // Persist intervention before signalling. Disarm can never clear or replace it.
  durable()
  status()
  try {
    if (liveIdentity(coordinator)) {
      process.kill(coordinator.pid, 'SIGSTOP')
      receipt.signals.push({ pid: coordinator.pid, signal: 'SIGSTOP' })
    }
  } catch {
    receipt.errors.push('coordinator freeze unverified')
  }
  durable()
  // Fresh registrations and descendants are included after owner freeze, while each stable
  // leader still grants authority to freeze its group and close detached-child discovery.
  for (let pass = 0; pass < 3; pass++) {
    try {
      scan(false)
    } catch (error) {
      receipt.errors.push(error.message)
    }
    for (const entry of entries.values()) {
      const closure = closeFamily(entry.life.identities)
      receipt.closures.push({
        directory: entry.directory,
        closure,
        identities: entry.life.identities,
      })
      entry.closed = closure.complete
      durable()
    }
    await delay(250)
  }
  try {
    if (liveIdentity(coordinator)) {
      process.kill(coordinator.pid, 'SIGKILL')
      receipt.signals.push({ pid: coordinator.pid, signal: 'SIGKILL' })
    }
  } catch {
    receipt.errors.push('coordinator exit unverified')
  }
  receipt.coordinator = { saved: coordinator, current: null, terminalVerified: false }
  const coordinatorDeadline = Date.now() + 5000
  while (Date.now() < coordinatorDeadline) {
    try {
      const current = defaultReadProcessIdentity(coordinator.pid)
      receipt.coordinator.current = current
      if (!current || current.start !== coordinator.start || current.runState.startsWith('Z')) {
        receipt.coordinator.terminalVerified = true
        break
      }
      if (!sameLife(coordinator, current)) {
        receipt.errors.push('coordinator terminal identity uncertain')
        break
      }
    } catch {
      receipt.errors.push('coordinator terminal observation failed')
      break
    }
    await delay(50)
  }
  if (!receipt.coordinator.terminalVerified)
    receipt.errors.push('coordinator terminal life not established within bound')
  receipt.unregistered = readdirSync(join(scratch, 'launches')).filter((name) => !entries.has(name))
  receipt.complete =
    receipt.coordinator.terminalVerified &&
    [...entries.values()].every((entry) => entry.closed) &&
    receipt.errors.length === 0 &&
    receipt.unregistered.length === 0
  receipt.closureStatus = receipt.complete ? 'verified-owned-processes-closed' : 'unverified'
  receipt.finalIdentities = [...entries.values()]
    .flatMap((entry) => entry.life.identities)
    .map((saved) => ({ saved, current: defaultReadProcessIdentity(saved.pid) }))
  durable()
  process.exit(1)
}
process.on('disconnect', () => {
  void contain('coordinator disconnected')
})
process.on('message', (message) => {
  if (message?.type !== 'disarm') return
  if (mode !== 'armed' || existsSync(join(evidence, 'watchdog-failure.json'))) {
    if (receipt) {
      receipt.disarmRejected = true
      publish(join(evidence, 'watchdog-failure.json'), receipt)
    }
    return
  }
  try {
    scan(false)
    if (
      [...entries.values()].some((entry) => !entry.closed) ||
      readdirSync(join(scratch, 'launches')).some(
        (name) => !existsSync(join(scratch, 'launches', name, 'watchdog-closure.json')),
      )
    )
      throw new Error('Open or unacknowledged launch at disarm')
    mode = 'disarmed'
    clearInterval(timer)
    status()
    publish(join(evidence, 'watchdog-cleanup.json'), {
      outcome: 'independently-closed-and-disarmed',
      launches: entries.size,
      at: new Date().toISOString(),
    })
    process.exit(0)
  } catch {
    void contain('disarm requested without independent closure')
  }
})
status()
timer = setInterval(() => {
  try {
    scan(true)
    const state = readJson(join(scratch, 'watchdog-state.json'))
    if (
      !liveIdentity(coordinator) ||
      Date.now() - state.progressAt > (state.filling ? 120000 : 300000) ||
      Date.now() - began > limitMs
    )
      return void contain('owner/deadline/progress lease lost')
    status()
  } catch {
    void contain('supervision state or admission unavailable')
  }
}, 250)

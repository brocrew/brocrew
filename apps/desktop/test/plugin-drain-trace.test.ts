import { readFileSync, renameSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { recordDrainTrace, type DrainTrace } from '../src/main/plugins/supervisor/drain-trace'
import { ownerDiagnosticLine } from '../src/main/plugins/supervisor/protocol'
import { captureLog } from './lib/log-file'

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

let parent = ''
let captured: Awaited<ReturnType<typeof captureLog>> | undefined
let owner: PluginSupervisor | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  if (owner) {
    await owner.shutdown()
    await owner.closed
    owner = undefined
  }
  if (parent) await rm(parent, { recursive: true, force: true })
  await captured?.close()
  captured = undefined
}, 30_000)
it('logs actual drain stages and a failed-write errno, then closes when the drain ends', async () => {
  parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-drain-trace-')),
  )
  const root = join(parent, 'plugins')

  await mkdir(join(parent, 'workspace'))
  const events: DrainTrace[] = []
  captured = await captureLog()
  owner = await PluginSupervisor.start({
    root,
    workspaceRoots: [],
    drainWithin: 30,
    traceDrain: (event) => {
      events.push(event)
      recordDrainTrace(event)
    },
  })
  const write = SupervisorStorage.prototype.write
  vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
    this: SupervisorStorage,
    value,
  ) {
    if (value.phase === 'stopped')
      throw Object.assign(new Error('Bearer fictional-secret /fictional/private-path'), {
        code: 'EBUSY',
      })
    return write.call(this, value)
  })
  // Recovery handles a refused stopped-record write after the owner closes.
  await owner.shutdown()
  await owner.closed
  const failed = events.filter((e) => e.stage === 'stopped-write' && e.state === 'failed')
  expect(failed.every((e) => e.errno === 'EBUSY')).toBe(true)
  expect(failed.map((e) => e.attempt)).toEqual(failed.map((_, i) => i + 1))
  expect(events.at(-1)).toMatchObject({ stage: 'closed', state: 'complete' })
  expect(events.slice(0, 8)).toMatchObject([
    { stage: 'drain', state: 'waiting', epoch: expect.any(String), reason: 'shutdown' },
    { stage: 'invalidation', state: 'waiting' },
    { stage: 'child-proofs', state: 'waiting' },
    { stage: 'child-proofs', state: 'complete' },
    { stage: 'server.close', state: 'waiting' },
    { stage: 'server.close', state: 'complete' },
    { stage: 'stopped-write', state: 'waiting', attempt: 1 },
    {
      stage: 'stopped-write',
      state: 'failed',
      attempt: 1,
      errno: 'EBUSY',
      cause: expect.stringContaining('Bearer fictional-secret'),
    },
  ])
  const log = (await captured.lines(9)).join('\n')
  expect(log).toMatch(/\[error\]\s+\(drain\) stopped-write .*state: 'failed'.*errno: 'EBUSY'/)
  expect(log).toContain("reason: 'shutdown'")
  expect(log).toContain('epoch:')
  expect(log).toContain('Error code=EBUSY: Bearer fictional-secret')
})
it('writes the stopped record once a reader that held it lets go, within the drain', async () => {
  parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-drain-held-')),
  )
  const root = join(parent, 'plugins')
  const events: DrainTrace[] = []
  owner = await PluginSupervisor.start({
    root,
    workspaceRoots: [],
    drainWithin: 10_000,
    traceDrain: (event) => events.push(event),
  })
  const write = SupervisorStorage.prototype.write
  let refusals = 0
  vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
    this: SupervisorStorage,
    value,
  ) {
    // What Windows answers a replacement while another process reads the record.
    if (value.phase === 'stopped' && refusals < 2) {
      refusals++
      throw Object.assign(new Error('fictional held record'), { code: 'EPERM' })
    }
    return write.call(this, value)
  })
  expect(await owner.shutdown()).toBe(true)
  await owner.closed
  owner = undefined
  expect(events.filter((e) => e.stage === 'stopped-write')).toMatchObject([
    { state: 'waiting', attempt: 1 },
    { state: 'failed', attempt: 1, errno: 'EPERM' },
    { state: 'waiting', attempt: 2 },
    { state: 'failed', attempt: 2, errno: 'EPERM' },
    { state: 'waiting', attempt: 3 },
    { state: 'complete', attempt: 3 },
  ])
  const storage = new SupervisorStorage(root, [], false)
  try {
    expect(storage.read()?.phase).toBe('stopped')
  } finally {
    storage.close()
  }
})
it('starts no further stopped-record try once a whole pause no longer fits in the drain', async () => {
  parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-drain-end-')),
  )
  const events: DrainTrace[] = []
  const supervisor = await PluginSupervisor.start({
    root: join(parent, 'plugins'),
    workspaceRoots: [],
    drainWithin: 10_000,
    traceDrain: (event) => events.push(event),
  })
  owner = supervisor
  // The first refused try leaves 60 ms of the drain, as a long inner retry would.
  const now = performance.now.bind(performance)
  let skew = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now() + skew)
  const write = SupervisorStorage.prototype.write
  let tries = 0
  vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
    this: SupervisorStorage,
    value,
  ) {
    if (value.phase !== 'stopped') return write.call(this, value)
    if (++tries === 1) skew += supervisor.remainingDrainMs() - 60
    throw Object.assign(new Error('fictional held record'), { code: 'EPERM' })
  })
  await supervisor.shutdown()
  await supervisor.closed
  owner = undefined
  expect(events.filter((e) => e.stage === 'stopped-write')).toMatchObject([
    { state: 'waiting', attempt: 1 },
    { state: 'failed', attempt: 1, errno: 'EPERM' },
  ])
  expect(tries).toBe(1)
})
it('stops atomic rename retries when the next wait would outlast the drain', async () => {
  parent = await realpath(
    await mkdtemp(
      join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-drain-rename-'),
    ),
  )
  const root = join(parent, 'plugins')
  const supervisor = await PluginSupervisor.start({ root, workspaceRoots: [], drainWithin: 10_000 })
  owner = supervisor
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  let now = performance.now()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const waits: number[] = []
  vi.spyOn(Atomics, 'wait').mockImplementation((_view, _index, _value, ms) => {
    waits.push(ms ?? 0)
    now += ms ?? 0
    return 'timed-out'
  })
  const attempts: number[] = []
  vi.mocked(renameSync).mockImplementation((from, to) => {
    if (
      to !== join(root, 'supervisor', 'owner.json') ||
      JSON.parse(readFileSync(from, 'utf8')).phase !== 'stopped'
    )
      return fs.renameSync(from, to)

    if (attempts.length === 0) now += supervisor.remainingDrainMs() - 175
    attempts.push(Math.round(supervisor.remainingDrainMs()))
    throw Object.assign(new Error('fictional held record'), { code: 'EPERM' })
  })
  try {
    expect(await supervisor.shutdown()).toBe(true)
    await supervisor.closed
    owner = undefined
    expect(attempts).toEqual([175, 125, 25])
    expect(waits).toEqual([50, 100])
    const storage = new SupervisorStorage(root, [], false)
    try {
      expect(storage.read()?.phase).toBe('draining')
    } finally {
      storage.close()
    }
  } finally {
    vi.mocked(renameSync).mockImplementation(fs.renameSync)
  }
})
it('records a legacy restart-required phase diagnostic without prescribing a reboot', () => {
  const text = ownerDiagnosticLine({
    phase: 'blocked',
    stage: 'recovery',
    probe: 'no-answer',
    reason: 'restart-required',
  })
  expect(text).toBe('phase=blocked stage=recovery probe=no-answer reason=restart-required')
  expect(text).not.toContain('Restart your computer')
  expect(text).not.toContain('Start > Power > Restart')
  expect(text).not.toContain('Shut down')
})
it.each(['released', 'lease-expired', 'shutdown', 'drain'] as const)(
  'records %s epoch and invalidation before child teardown and retains swallowed stop causes',
  async (reason) => {
    parent = await realpath(
      await mkdtemp(
        join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-drain-reason-'),
      ),
    )
    const root = join(parent, 'plugins'),
      workspaceRoot = join(parent, 'workspace')

    await mkdir(workspaceRoot)
    const events: DrainTrace[] = []
    captured = await captureLog()
    let now = 0
    owner = await PluginSupervisor.start({
      root,
      workspaceRoots: [workspaceRoot],
      now: () => now,
      traceDrain: (event) => {
        events.push(event)
        recordDrainTrace(event)
      },
    })
    const { PluginWorkspaceLease } = await import('../src/main/plugins/supervisor/client')
    const { randomUUID } = await import('node:crypto')
    const { OWNER_LIMITS, OWNER_WIRE, APP_HELD_CONNECTION } =
      await import('../src/main/plugins/supervisor/protocol')
    let lease: Awaited<ReturnType<typeof PluginWorkspaceLease.attach>> | undefined
    try {
      if (reason !== 'drain') {
        lease = await PluginWorkspaceLease.attach({
          root,
          workspaceRoot,
          generation: randomUUID(),
          build: 'fictional',
          // Only an older app copy without a held connection can still let its lease expire.
          ...(reason === 'lease-expired'
            ? {
                wire: {
                  ...OWNER_WIRE,
                  features: OWNER_WIRE.features.filter((one) => one !== APP_HELD_CONNECTION),
                },
              }
            : {}),
        })
        const epoch = lease.epoch
        owner.adopt({
          stop() {
            expect(events).toMatchObject([
              { stage: 'drain', state: 'waiting', reason, epoch },
              { stage: 'invalidation', state: 'waiting', epoch },
              { stage: 'child-proofs', state: 'waiting', epoch },
            ])
            throw new Error('owner-invalidated token=fictional-token', {
              cause: new Error('broker closed'),
            })
          },
          exited: Promise.resolve(),
          descendantsGone: async () => true,
        })
      }
      if (reason === 'released') await lease!.close()
      else if (reason === 'shutdown') await owner.shutdown()
      else {
        now = OWNER_LIMITS.expires
        await owner.tick()
      }
      await owner.closed
      expect(events[0]).toMatchObject({ stage: 'drain', reason, epoch: expect.any(String) })
      if (lease) {
        expect(events).toContainEqual(
          expect.objectContaining({
            stage: 'child-stop',
            state: 'failed',
            cause: expect.stringContaining(
              'Error: owner-invalidated token=fictional-token <- Error: broker closed',
            ),
          }),
        )
        await vi.waitFor(async () => expect(await captured!.text()).toContain('broker closed'))
        expect(await captured!.text()).toContain('fictional-token')
      }
    } finally {
      lease?.abandon()
    }
  },
)

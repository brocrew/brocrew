import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { recordDrainTrace, type DrainTrace } from '../src/main/plugins/supervisor/drain-trace'
import { ownerDiagnosticLine } from '../src/main/plugins/supervisor/protocol'

let parent = ''
let owner: PluginSupervisor | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  if (owner) {
    await owner.shutdown()
    await owner.closed
    owner = undefined
  }
  if (parent) await rm(parent, { recursive: true, force: true })
}, 30_000)
it('logs actual drain stages and a sanitized failed-write errno, then closes after one attempt', async () => {
  parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-drain-trace-')),
  )
  const root = join(parent, 'plugins')

  await mkdir(join(parent, 'workspace'))
  const events: DrainTrace[] = []
  owner = await PluginSupervisor.start({
    root,
    workspaceRoots: [],
    drainWithin: 30,
    traceDrain: (event) => {
      events.push(event)
      recordDrainTrace(root, event)
    },
  })
  const write = SupervisorStorage.prototype.write
  let denied = false
  vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
    this: SupervisorStorage,
    value,
  ) {
    if (value.phase === 'stopped' && !denied) {
      denied = true
      throw Object.assign(new Error('Bearer fictional-secret /fictional/private-path'), {
        code: 'EBUSY',
      })
    }
    return write.call(this, value)
  })
  // The stopped record only advises the next start, which recovers any record that isn't
  // stopped (plugin-owner-recovery), so a refused write is traced once and the owner closes.
  await owner.shutdown()
  await owner.closed
  expect(events).toMatchObject([
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
      cause: expect.stringContaining('Bearer [redacted]'),
    },
    { stage: 'closed', state: 'complete' },
  ])
  const log = await readFile(join(root, 'plugin-drain.log'), 'utf8')
  expect(log).toContain('stage=stopped-write state=failed attempt=1 errno=EBUSY')
  expect(log).not.toMatch(/fictional-secret/)
  expect(log).toContain('reason=shutdown')
  expect(log).toContain('epoch=')
  expect(log).toContain('cause=Error code=EBUSY: Bearer [redacted]')
})
it('gives a plain Restart remedy in a restart-required phase diagnostic', () => {
  const text = ownerDiagnosticLine({
    phase: 'blocked',
    stage: 'recovery',
    probe: 'no-answer',
    reason: 'restart-required',
  })
  expect(text).toContain('Restart your computer')
  if (process.platform === 'win32') expect(text).toContain('Start > Power > Restart')
  expect(text).not.toContain('Shut down')
})
it('does not append through a hardlinked drain log to an outside fictional sentinel', async () => {
  parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-drain-alias-')),
  )
  const root = join(parent, 'plugins')
  await mkdir(root, { mode: 0o700 })
  const sentinel = join(parent, 'outside-sentinel')
  await writeFile(sentinel, 'fictional unchanged bytes', { mode: 0o600 })
  await link(sentinel, join(root, 'plugin-drain.log'))
  recordDrainTrace(root, { stage: 'stopped-write', state: 'complete' })
  expect(await readFile(sentinel, 'utf8')).toBe('fictional unchanged bytes')
})
it('appends to an OS-writable drain log without changing earlier bytes or its mode', async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'fictional-drain-permission-')))
  const path = join(parent, 'plugin-drain.log')
  await writeFile(path, 'fictional unchanged bytes')
  await chmod(path, 0o666)
  const before = (await stat(path)).mode
  recordDrainTrace(parent, { stage: 'closed', state: 'complete' })
  const text = await readFile(path, 'utf8')
  expect(text).toMatch(
    /^fictional unchanged bytes\d{4}-\d{2}-\d{2}T[\d:.]+Z \[plugins\] drain stage=closed state=complete\n$/,
  )
  expect((await stat(path)).mode).toBe(before)
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
    let now = 0
    owner = await PluginSupervisor.start({
      root,
      workspaceRoots: [workspaceRoot],
      now: () => now,
      traceDrain: (event) => {
        events.push(event)
        recordDrainTrace(root, event)
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
              'Error: owner-invalidated token=[redacted] <- Error: broker closed',
            ),
          }),
        )
        const log = await readFile(join(root, 'plugin-drain.log'), 'utf8')
        expect(log).not.toContain('fictional-token')
        expect(log).toContain('broker closed')
      }
    } finally {
      lease?.abandon()
    }
  },
)

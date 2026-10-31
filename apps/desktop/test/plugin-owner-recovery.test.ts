import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { previousRunsProvenStopped } from '../src/main/plugins/supervisor/recovery-proof'
import { keepPluginRootPrivate } from '../src/main/plugins/private-files'

// These exercise the real SQLite fence and local socket. They do not qualify legacy Windows
// process retirement or the standalone production lifecycle.
describe('plugin owner recovery after the caller stops waiting', () => {
  let parent = ''
  let owner: PluginSupervisor | undefined
  let lease: PluginWorkspaceLease | undefined
  let child: ChildProcess | undefined
  let releaseWitness: (() => void) | undefined
  afterEach(async () => {
    releaseWitness?.()
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    await lease?.close()
    await owner?.shutdown()
    if (parent) await rm(parent, { recursive: true, force: true })
    owner = undefined
    lease = undefined
    child = undefined
    releaseWitness = undefined
    vi.restoreAllMocks()
  })
  async function fixture() {
    parent = await realpath(
      await mkdtemp(
        join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-owner-recovery-'),
      ),
    )
    const root = join(parent, 'plugins')
    await keepPluginRootPrivate(root)
    const workspaceRoot = join(parent, 'workspace')
    await mkdir(workspaceRoot, { mode: 0o700 })
    const options = { root, workspaceRoot, build: 'fictional', generation: randomUUID() }
    owner = await PluginSupervisor.start({ root, workspaceRoots: [workspaceRoot], drainWithin: 30 })
    lease = await PluginWorkspaceLease.attach(options)
    return { root, options }
  }
  it('publishes stopped after a delayed real child exit witness, even after shutdown returned false', async () => {
    const { root } = await fixture()
    const sentinel = join(root, 'profile-sentinel')
    await writeFile(sentinel, 'fictional-profile-and-installation', { mode: 0o600 })
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    await once(child, 'spawn')
    const realExit = once(child, 'exit')
    const delivery = new Promise<void>((resolve) => {
      releaseWitness = resolve
    })
    owner!.adopt({
      stop() {
        child!.kill()
      },
      exited: realExit.then(() => delivery),
      async descendantsGone() {
        await realExit
        return child!.exitCode !== null || child!.signalCode !== null
      },
    })
    expect(await owner!.shutdown()).toBe(false)
    await realExit
    const phase = async () =>
      JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).phase
    expect(await phase()).not.toBe('stopped')
    releaseWitness!()
    await expect.poll(phase, { timeout: 1500 }).toBe('stopped')
    expect(await readFile(sentinel, 'utf8')).toBe('fictional-profile-and-installation')
  })
  it('does not turn a still-pending witness into a clean stop or overlap a successor', async () => {
    const { root, options } = await fixture()
    const delivery = new Promise<void>((resolve) => {
      releaseWitness = resolve
    })
    owner!.adopt({
      stop() {},
      exited: delivery,
      async descendantsGone() {
        return true
      },
    })
    expect(await owner!.shutdown()).toBe(false)
    await expect(
      PluginSupervisor.start({ root, workspaceRoots: [options.workspaceRoot] }),
    ).rejects.toMatchObject({ code: 'busy' })
    const record = JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8'))
    expect(record.phase).not.toBe('stopped')
    const launch = vi.fn()
    await expect(
      PluginWorkspaceLease.attach({
        ...options,
        generation: randomUUID(),
        launch,
      }),
    ).rejects.toMatchObject({
      code: 'busy',
      diagnostic: {
        phase: 'draining',
        stage: 'attach-record',
        probe: 'live',
      },
    })
    expect(launch).not.toHaveBeenCalled()
    releaseWitness!()
    await expect
      .poll(
        async () => JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).phase,
      )
      .toBe('stopped')
  })
  it('refuses an ambiguous accepting legacy busy without launching or revoking its lease', async () => {
    const { root, options } = await fixture()
    await lease!.close()
    await owner!.shutdown()
    owner = await PluginSupervisor.start({
      root,
      workspaceRoots: [options.workspaceRoot],
      wire: { major: 1, minMinor: 0, maxMinor: 0, features: [] },
    })
    lease = await PluginWorkspaceLease.attach({
      ...options,
      wire: { major: 1, minMinor: 0, maxMinor: 0, features: [] },
    })
    const launch = vi.fn()
    await expect(
      PluginWorkspaceLease.attach({
        ...options,
        generation: randomUUID(),
        launch,
        wire: { major: 1, minMinor: 0, maxMinor: 0, features: [] },
      }),
    ).rejects.toMatchObject({
      code: 'busy',
      diagnostic: { phase: 'accepting', stage: 'hello', reason: 'unknown' },
    })
    expect(launch).not.toHaveBeenCalled()
    await expect(lease.renew()).resolves.toBeUndefined()
    expect(JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).phase).toBe(
      'accepting',
    )
  })
  it.each(['blocked', 'draining'] as const)(
    'a %s refusal carries only the phase and attach stage',
    async (phase) => {
      const { root, options } = await fixture()
      await lease!.close()
      await owner!.shutdown()
      const storage = new SupervisorStorage(root, [options.workspaceRoot], false)
      try {
        const record = storage.read()!
        storage.write({ ...record, phase })
        await expect(
          PluginWorkspaceLease.attach({ ...options, generation: randomUUID() }),
        ).rejects.toMatchObject({ code: 'busy', diagnostic: { phase, stage: 'attach-record' } })
        storage.write(record)
      } finally {
        storage.close()
      }
    },
  )
  it.each(['accepting', 'draining', 'blocked'] as const)(
    'recovers a dead %s owner only under its original fence and positive run receipts',
    async (phase) => {
      const { root, options } = await fixture()
      await lease!.close()
      await owner!.shutdown()
      const storage = new SupervisorStorage(root, [options.workspaceRoot], false)
      const record = storage.read()!
      storage.write({ ...record, phase, wire: { ...record.wire, features: [] } })
      storage.close()
      const runId = randomUUID()
      const run = join(root, 'host/runs', runId)
      await mkdir(run, { recursive: true, mode: 0o700 })
      const proof = {
        format: 1,
        runId,
        pluginId: 'fictional',
        releaseDigest: 'f'.repeat(64),
        guardianPid: 404941,
        groups: [],
        exited: true,
      }
      const successor = () =>
        PluginSupervisor.start({
          root,
          workspaceRoots: [options.workspaceRoot],
          recoverPrevious: () => previousRunsProvenStopped(root),
        })
      await expect(successor()).rejects.toMatchObject({ code: 'cleanup-pending' })
      await writeFile(join(run, 'exit.json'), JSON.stringify({ ...proof, exited: false }), {
        mode: 0o600,
      })
      await expect(successor()).rejects.toMatchObject({ code: 'cleanup-pending' })
      await writeFile(join(run, 'exit.json'), JSON.stringify(proof), { mode: 0o600 })
      lease = await PluginWorkspaceLease.attach({
        ...options,
        generation: randomUUID(),
        launch: async () => {
          owner = await successor()
        },
      })
      expect(await readFile(join(run, 'exit.json'), 'utf8')).toBe(JSON.stringify(proof))
      expect(
        JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).epoch,
      ).not.toBe(record.epoch)
    },
  )
  it('recovers a missing owner record with no historical runs while retaining the original lock inode', async () => {
    const { root, options } = await fixture()
    await lease!.close()
    await owner!.shutdown()
    const storage = new SupervisorStorage(root, [options.workspaceRoot], false)
    const before = await lstat(storage.lock, { bigint: true })
    await unlink(storage.record)
    storage.close()
    lease = await PluginWorkspaceLease.attach({
      ...options,
      generation: randomUUID(),
      launch: async () => {
        owner = await PluginSupervisor.start({
          root,
          workspaceRoots: [options.workspaceRoot],
          recoverPrevious: () => previousRunsProvenStopped(root),
        })
      },
    })
    const after = await lstat(join(root, 'supervisor/owner-lock.sqlite'), { bigint: true })
    expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino })
  })
  it('retains the fence and retries a failed clean-stop publication', async () => {
    const { root, options } = await fixture()
    const original = SupervisorStorage.prototype.write
    let failed = false
    vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
      this: SupervisorStorage,
      value,
    ) {
      if (value.phase === 'stopped' && !failed) {
        failed = true
        throw new Error('fictional rename denial')
      }
      return original.call(this, value)
    })
    expect(await owner!.shutdown()).toBe(false)
    expect(failed).toBe(true)
    await expect(
      PluginSupervisor.start({ root, workspaceRoots: [options.workspaceRoot] }),
    ).rejects.toMatchObject({ code: 'busy' })
    await expect
      .poll(
        async () => JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).phase,
        { timeout: 2000 },
      )
      .toBe('stopped')
  })
  it('makes a transient record read retryable and emits closed phase diagnostics', async () => {
    const { options } = await fixture()
    const original = SupervisorStorage.prototype.read
    const read = vi.spyOn(SupervisorStorage.prototype, 'read').mockImplementationOnce(() => {
      throw new Error('fictional-private-path')
    })
    await expect(
      PluginWorkspaceLease.attach({ ...options, generation: randomUUID() }),
    ).rejects.toMatchObject({
      code: 'cleanup-pending',
      diagnostic: { phase: 'unreadable', stage: 'attach-record', reason: 'io' },
    })
    read.mockImplementation(original)
    const another = join(parent, 'after-read-retry')
    await mkdir(another, { mode: 0o700 })
    const retry = await PluginWorkspaceLease.attach({
      ...options,
      workspaceRoot: another,
      generation: randomUUID(),
    })
    expect(owner!.valid(retry.lease, retry.epoch)).toBe(true)
    await retry.close()
  })
})

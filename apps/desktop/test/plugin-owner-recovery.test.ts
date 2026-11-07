import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { closeSync, openSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease, supervisorRequest } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import type { DrainTrace } from '../src/main/plugins/supervisor/drain-trace'
import { previousRunsProvenStopped } from '../src/main/plugins/supervisor/recovery-proof'
import { keepPluginRootPrivate } from '../src/main/plugins/private-files'
import { pluginUnavailableNotice } from '../src/shared/plugin-settings'
import { PluginStartupError, pluginStartupReason } from '../src/main/plugins/startup-failure'
import { groupIdentity } from '../resources/plugin-host/process-groups.mjs'
import {
  APP_HELD_CONNECTION,
  OWNER_WIRE,
  PluginSupervisorError,
  type WireVersion,
} from '../src/main/plugins/supervisor/protocol'

const windowsStopWithin = process.platform === 'win32' ? 10_000 : undefined

// Fixture SQLite/socket proof only; no legacy Windows retirement or standalone qualification.
describe('plugin owner recovery after the caller stops waiting', () => {
  let parent = ''
  const trace: DrainTrace[] = []
  const readers: number[] = []
  const readOwner = async () =>
    JSON.parse(await readFile(join(parent, 'plugins/supervisor/owner.json'), 'utf8'))
  let owner: PluginSupervisor | undefined
  let lease: PluginWorkspaceLease | undefined
  let child: ChildProcess | undefined
  let releaseWitness: (() => void) | undefined
  afterEach(async () => {
    try {
      releaseWitness?.()
      for (const fd of readers.splice(0)) closeSync(fd)
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill()
        await exited
      }
      await lease?.close()
      if (owner) {
        await owner.shutdown()
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Plugin owner did not close; fixture retained at ${parent}`)),
            10_000,
          )
          void owner!.closed.then(() => {
            clearTimeout(timer)
            resolve()
          })
        })
      }
      if (parent) await rm(parent, { recursive: true, force: true })
    } finally {
      vi.restoreAllMocks()
    }
    owner = undefined
    lease = undefined
    child = undefined
    releaseWitness = undefined
    trace.length = 0
  }, 30_000)
  async function fixture(now?: () => number, wire?: WireVersion) {
    parent = await realpath(
      await mkdtemp(
        join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-owner-recovery-'),
      ),
    )
    const root = join(parent, 'plugins')
    await keepPluginRootPrivate(root)
    const workspaceRoot = join(parent, 'workspace')
    await mkdir(workspaceRoot, { mode: 0o700 })
    const options = { root, workspaceRoot, build: 'fictional', generation: randomUUID(), wire }
    owner = await PluginSupervisor.start({
      root,
      workspaceRoots: [workspaceRoot],
      drainWithin: 30,
      traceDrain: (event) => trace.push(event),
      now,
    })
    lease = await PluginWorkspaceLease.attach(options)
    return { root, options }
  }
  it('gives plain restart advice only after observing the same live released owner for sixty seconds', async () => {
    const { root, options } = await fixture()
    const exit = new Promise<void>((resolve) => {
      releaseWitness = resolve
    })
    owner!.adopt({ stop() {}, exited: exit, descendantsGone: async () => true })
    const storage = new SupervisorStorage(root, [options.workspaceRoot], false)
    try {
      const record = storage.read()!
      await supervisorRequest(storage, record, {
        kind: 'release',
        lease: lease!.lease,
        generation: options.generation,
        workspace: createHash('sha256').update(options.workspaceRoot).digest('hex'),
      })
      lease!.abandon()
      let elapsed = 0
      const original = performance.now.bind(performance)
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => original() + elapsed)
      const launch = vi.fn()
      const attempt = async () => {
        const error: unknown = await PluginWorkspaceLease.attach({
          ...options,
          generation: randomUUID(),
          launch,
        }).catch((e: unknown) => e)
        return pluginStartupReason(error, 'service-start')
      }
      try {
        expect(await attempt()).toBe('cleanup-pending')
        elapsed = 59_000
        expect(await attempt()).toBe('cleanup-pending')
        elapsed = 61_000
        expect(await attempt()).toBe('previous-service-stopping')
        expect(pluginUnavailableNotice('previous-service-stopping')).toBe(
          "The previous plugin service didn't finish stopping. Restart your computer, then open BroCrew again.",
        )
        await writeFile(storage.stop, JSON.stringify({ epoch: randomUUID(), reason: 'released' }), {
          mode: 0o600,
        })
        expect(await attempt()).toBe('cleanup-pending')
        await writeFile(storage.stop, JSON.stringify({ epoch: record.epoch, reason: 'shutdown' }), {
          mode: 0o600,
        })
        elapsed += 61_000
        expect(await attempt()).toBe('cleanup-pending')
        await unlink(storage.stop)
        expect(await attempt()).toBe('cleanup-pending')
        expect(launch).not.toHaveBeenCalled()
        expect(storage.read()?.epoch).toBe(record.epoch)
      } finally {
        clock.mockRestore()
      }
    } finally {
      storage.close()
      releaseWitness!()
    }
  })
  it("measures an older copy's sixty-second orphan expiry while another workspace retains the same owner", async () => {
    let now = 0
    // An older app copy has no held connection; its abandoned lease waits for the expiry.
    // A current copy's lease ends when its connection closes (plugin-owner-held-connection).
    const { root, options } = await fixture(() => now, {
      ...OWNER_WIRE,
      features: OWNER_WIRE.features.filter((one) => one !== APP_HELD_CONNECTION),
    })
    const epoch = lease!.epoch
    const fence = await lstat(join(root, 'supervisor/owner-lock.sqlite'), { bigint: true })
    const otherWorkspace = join(parent, 'other-workspace')
    await mkdir(otherWorkspace, { mode: 0o700 })
    const other = await PluginWorkspaceLease.attach({ ...options, workspaceRoot: otherWorkspace })
    lease!.abandon()
    let adopted: PluginWorkspaceLease | undefined
    try {
      now = 59_999
      await other.renew()
      await expect(
        PluginWorkspaceLease.attach({ ...options, generation: randomUUID() }),
      ).rejects.toMatchObject({ code: 'busy' })
      now = 60_000
      adopted = await PluginWorkspaceLease.attach({ ...options, generation: randomUUID() })
      expect(adopted.epoch).toBe(epoch)
      await expect(other.renew()).resolves.toBeUndefined()
      const after = await lstat(join(root, 'supervisor/owner-lock.sqlite'), { bigint: true })
      expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: fence.dev, ino: fence.ino })
    } finally {
      await adopted?.close()
      await other.close()
    }
  })
  it.each([
    ['finishes after a delayed real child exit witness', true, 1500],
    ['refuses overlap until the pending witness resolves', false, 1000],
  ] as const)('%s', async (_name, physical, within) => {
    const { root, options } = await fixture()
    const sentinel = join(root, 'profile-sentinel')
    let realExit: Promise<unknown> = Promise.resolve()
    if (physical) {
      await writeFile(sentinel, 'fictional-profile-and-installation', { mode: 0o600 })
      child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      await once(child, 'spawn')
      realExit = once(child, 'exit')
    }
    const delivery = new Promise<void>((resolve) => {
      releaseWitness = resolve
    })
    owner!.adopt({
      stop() {
        child?.kill()
      },
      exited: realExit.then(() => delivery),
      async descendantsGone() {
        await realExit
        return !physical || child!.exitCode !== null || child!.signalCode !== null
      },
    })
    expect(await owner!.shutdown()).toBe(false)
    await realExit
    const phase = async () => (await readOwner()).phase
    expect(await phase()).not.toBe('stopped')
    if (!physical) {
      await expect(
        PluginSupervisor.start({ root, workspaceRoots: [options.workspaceRoot] }),
      ).rejects.toMatchObject({ code: 'busy' })
      const launch = vi.fn()
      await expect(
        PluginWorkspaceLease.attach({ ...options, generation: randomUUID(), launch }),
      ).rejects.toMatchObject({
        code: 'busy',
        diagnostic: { phase: 'draining', stage: 'attach-record', probe: 'live' },
      })
      expect(launch).not.toHaveBeenCalled()
    }
    // Windows replacement refuses this real destination reader; it is not exit authority.
    const reader =
      process.platform === 'win32' ? openSync(join(root, 'supervisor/owner.json'), 'r') : undefined
    try {
      releaseWitness!()
      await expect
        .poll(() => trace.at(-1)?.stage, { timeout: windowsStopWithin ?? within })
        .toBe('closed')
      await owner!.closed
    } finally {
      if (reader !== undefined) closeSync(reader)
    }
    expect(await phase()).toBe(process.platform === 'win32' ? 'draining' : 'stopped')
    if (process.platform === 'win32')
      expect(
        trace.filter((event) => event.stage === 'stopped-write' && event.state === 'failed'),
      ).toMatchObject([{ attempt: 1, errno: 'EPERM' }])
    if (physical)
      expect(await readFile(sentinel, 'utf8')).toBe('fictional-profile-and-installation')
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
      diagnostic: { phase: 'accepting', stage: 'hello', probe: 'live', reason: 'unknown' },
    })
    expect(launch).not.toHaveBeenCalled()
    await expect(lease.renew()).resolves.toBeUndefined()
    expect((await readOwner()).phase).toBe('accepting')
  })
  it.each(['blocked', 'draining'] as const)(
    'does not infer reboot advice from a %s pipe timeout and failed runtime launch',
    async (phase) => {
      const { root, options } = await fixture()
      await lease!.close()
      await owner!.shutdown()
      const storage = new SupervisorStorage(root, [options.workspaceRoot], false)
      const record = storage.read()!
      storage.write({ ...record, phase })
      storage.close()
      try {
        await expect(
          PluginWorkspaceLease.attach({
            ...options,
            generation: randomUUID(),
            launch: async () => {
              throw new Error('fictional runtime assets unavailable')
            },
          }),
        ).rejects.toMatchObject({
          code: 'busy',
          diagnostic: { phase, probe: 'no-answer', reason: 'unknown' },
        })
      } finally {
        const saved = new SupervisorStorage(root, [options.workspaceRoot], false)
        saved.write(record)
        saved.close()
      }
    },
  )
  it.each(['current', 'foreign'] as const)(
    'preserves only %s-epoch typed reboot advice through the launcher wrapper',
    async (identity) => {
      const { root, options } = await fixture()
      await lease!.close()
      await owner!.shutdown()
      const storage = new SupervisorStorage(root, [options.workspaceRoot], false)
      const record = storage.read()!
      storage.write({ ...record, phase: 'blocked' })
      storage.close()
      try {
        await expect(
          PluginWorkspaceLease.attach({
            ...options,
            generation: randomUUID(),
            launch: async () => {
              throw new PluginStartupError(
                'service-start',
                new PluginSupervisorError('cleanup-pending', {
                  ownerEpoch: identity === 'current' ? record.epoch : randomUUID(),
                  diagnostic: {
                    phase: 'blocked',
                    stage: 'recovery',
                    probe: 'no-answer',
                    reason: 'restart-required',
                  },
                }),
              )
            },
          }),
        ).rejects.toMatchObject({
          diagnostic: {
            phase: 'blocked',
            stage: identity === 'current' ? 'recovery' : 'attach-record',
            reason: identity === 'current' ? 'restart-required' : 'unknown',
          },
        })
      } finally {
        const saved = new SupervisorStorage(root, [options.workspaceRoot], false)
        saved.write(record)
        saved.close()
      }
    },
  )
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
      // Its recorded group's number now belongs to another process, so only a receipt proves it.
      const { spawned } = await orphan()
      const run = await recordedRun(root, [[spawned.pid!, '0:a birth this number no longer has']])
      const runId = run.split(/[\\/]/).at(-1)!
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
      expect((await readOwner()).epoch).not.toBe(record.epoch)
    },
  )
  // A guardian whose exit receipt could not be written (a held file, a full disk) left only its
  // process record. The successor proves that run stopped the way the guardian does, by pid and
  // birth, and continues with no reboot advice. Windows records only the server, so it is out.
  async function recordedRun(root: string, groups: [number, string][]) {
    const runId = randomUUID()
    const run = join(root, 'host/runs', runId)
    await mkdir(run, { recursive: true, mode: 0o700 })
    await writeFile(
      join(run, 'process.json'),
      JSON.stringify({
        format: 1,
        runId,
        pluginId: 'fictional',
        releaseDigest: 'f'.repeat(64),
        guardianPid: 404941,
        groups,
      }),
      { mode: 0o600 },
    )
    return run
  }
  async function orphan() {
    const spawned = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
    })
    await once(spawned, 'spawn')
    child = spawned
    return { spawned }
  }
  const birthOf = (one: ChildProcess) => {
    const birth = groupIdentity(one.pid!)
    expect(birth).toBeTruthy()
    return birth!
  }
  const gone = (one: ChildProcess) => one.exitCode !== null || one.signalCode !== null
  async function deadOwner(root: string, workspaceRoot: string) {
    await lease!.close()
    lease = undefined
    await owner!.shutdown()
    await owner!.closed
    owner = undefined
    const storage = new SupervisorStorage(root, [workspaceRoot], false)
    storage.write({ ...storage.read()!, phase: 'draining' })
    storage.close()
  }
  describe.skipIf(process.platform === 'win32')('a run with no exit receipt', () => {
    it.each(['exited', 'live', 'receipt-held'] as const)(
      'is proven by its recorded group (%s), and the successor continues with no reboot advice',
      async (kind) => {
        const { root, options } = await fixture()
        const { spawned } = await orphan()
        const birth = birthOf(spawned)
        if (kind !== 'live') {
          const exit = once(spawned, 'exit')
          spawned.kill('SIGKILL')
          await exit
        }
        const run = await recordedRun(root, [[spawned.pid!, birth]])
        await deadOwner(root, options.workspaceRoot)
        if (kind === 'receipt-held') await chmod(run, 0o500)
        const advice = vi.fn()
        try {
          owner = await PluginSupervisor.start({
            root,
            workspaceRoots: [options.workspaceRoot],
            recoverPrevious: (previous) =>
              previousRunsProvenStopped(root, { previous, onRebootRequired: advice }),
          })
        } finally {
          await chmod(run, 0o700)
        }
        expect(advice).not.toHaveBeenCalled()
        await expect.poll(() => gone(spawned)).toBe(true)
        if (kind === 'receipt-held') {
          await expect(lstat(join(run, 'exit.json'))).rejects.toMatchObject({ code: 'ENOENT' })
        } else {
          expect(JSON.parse(await readFile(join(run, 'exit.json'), 'utf8'))).toMatchObject({
            runId: run.split('/').at(-1),
            groups: [[spawned.pid, birth]],
            exited: true,
          })
        }
      },
    )
    it.each(['birth-mismatch', 'EPERM'] as const)(
      'stays unresolved when its recorded group cannot be proven (%s)',
      async (kind) => {
        const { root, options } = await fixture()
        const { spawned } = await orphan()
        const birth = birthOf(spawned)
        const run = await recordedRun(root, [
          [spawned.pid!, kind === 'birth-mismatch' ? '0:Thu Jan  1 00:00:00 1970' : birth],
        ])
        await deadOwner(root, options.workspaceRoot)
        if (kind === 'EPERM') {
          const kill = process.kill.bind(process)
          vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
            if (pid === -spawned.pid!)
              throw Object.assign(new Error('fictional refusal'), { code: 'EPERM' })
            return kill(pid, signal)
          })
        }
        await expect(
          PluginSupervisor.start({
            root,
            workspaceRoots: [options.workspaceRoot],
            recoverPrevious: (previous) => previousRunsProvenStopped(root, { previous }),
          }),
        ).rejects.toMatchObject({ code: 'cleanup-pending' })
        await expect(lstat(join(run, 'exit.json'))).rejects.toMatchObject({ code: 'ENOENT' })
        expect(gone(spawned)).toBe(false)
      },
    )
  })
  it('proves a run that never wrote a process record, even with its guardian receipt saying not exited', async () => {
    // Its server was never admitted, so no plugin code ran; see recovery-proof's proveRunStopped.
    const { root, options } = await fixture()
    const runId = randomUUID()
    const run = join(root, 'host/runs', runId)
    await mkdir(run, { recursive: true, mode: 0o700 })
    const receipt = JSON.stringify({
      format: 1,
      runId,
      pluginId: 'fictional',
      releaseDigest: 'f'.repeat(64),
      guardianPid: 404941,
      groups: [],
      exited: false,
    })
    await writeFile(join(run, 'exit.json'), receipt, { mode: 0o600 })
    await deadOwner(root, options.workspaceRoot)
    const advice = vi.fn()
    owner = await PluginSupervisor.start({
      root,
      workspaceRoots: [options.workspaceRoot],
      recoverPrevious: (previous) =>
        previousRunsProvenStopped(root, { previous, onRebootRequired: advice }),
    })
    expect(advice).not.toHaveBeenCalled()
    // The guardian's own receipt is left as it wrote it.
    expect(await readFile(join(run, 'exit.json'), 'utf8')).toBe(receipt)
  })
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
  it('a refused stopped record still releases the fence, and the next start recovers', async () => {
    const { root, options } = await fixture()
    const previous = owner!
    const original = SupervisorStorage.prototype.write
    let held = true
    vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
      this: SupervisorStorage,
      value,
    ) {
      if (value.phase === 'stopped' && held) {
        if (process.platform === 'win32') {
          if (!readers.length) readers.push(openSync(this.record, 'r'))
        } else throw Object.assign(new Error('fictional rename denial'), { code: 'EPERM' })
      }
      return original.call(this, value)
    })
    await lease!.close()
    lease = undefined
    await previous.shutdown()
    // closed resolves only after the fence is released.
    await previous.closed
    owner = undefined
    expect((await readOwner()).phase).not.toBe('stopped')
    const start = () =>
      PluginSupervisor.start({
        root,
        workspaceRoots: [options.workspaceRoot],
        recoverPrevious: (record) => previousRunsProvenStopped(root, { previous: record }),
      })
    // The successor's own stopped write meets the same held file: it says so and starts later.
    const refused = await start().catch((error: unknown) => error)
    expect(refused).toMatchObject({ code: 'cleanup-pending' })
    expect(String((refused as Error).cause)).toContain(
      "couldn't record the previous plugin service as stopped (EPERM)",
    )
    held = false
    for (const fd of readers.splice(0)) closeSync(fd)
    owner = await start()
    expect((await readOwner()).phase).toBe('accepting')
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

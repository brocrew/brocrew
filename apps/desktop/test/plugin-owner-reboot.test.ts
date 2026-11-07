import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
const proofIo = vi.hoisted(() => ({ failRename: false, deviceOffset: 0n, noFollowFallback: false }))
// Exercise Windows' descriptor-vs-path check even on a Mac: Windows has no O_NOFOLLOW.
vi.mock('node:fs', async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...fs,
    constants: {
      ...fs.constants,
      get O_NOFOLLOW() {
        return proofIo.noFollowFallback ? undefined : fs.constants.O_NOFOLLOW
      },
    },
  }
})
vi.mock('node:fs/promises', async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      const stat = handle.stat.bind(handle)
      // Renumbering affects both the pathname and an already opened descriptor. Windows'
      // no-O_NOFOLLOW guard compares them; contradictory mock devices must not bypass it.
      handle.stat = (async (...options: Parameters<typeof handle.stat>) => {
        const observed = await stat(...options)
        if (typeof observed.dev === 'bigint' && proofIo.deviceOffset)
          return Object.assign(Object.create(Object.getPrototypeOf(observed)), observed, {
            dev: observed.dev + proofIo.deviceOffset,
          })
        return observed
      }) as typeof handle.stat
      return handle
    },
    lstat: async (...args: Parameters<typeof fs.lstat>) => {
      const stat = await fs.lstat(...args)
      if (typeof stat.dev === 'bigint' && proofIo.deviceOffset)
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
          dev: stat.dev + proofIo.deviceOffset,
        })
      return stat
    },
    rename: (...args: Parameters<typeof fs.rename>) => {
      if (proofIo.failRename) {
        proofIo.failRename = false
        return Promise.reject(new Error('fictional publication failure'))
      }
      return fs.rename(...args)
    },
  }
})
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { previousRunsProvenStopped } from '../src/main/plugins/supervisor/recovery-proof'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'

describe('fenced reboot proof for historical plugin runs', () => {
  let parent = '',
    root = '',
    epoch = '',
    run = ''
  let owner: PluginSupervisor | undefined
  const firstBoot = randomUUID()
  let witness: unknown
  let volume = 'apfs:11111111-1111-4111-8111-111111111111'
  const observe = vi.fn(async () => witness)
  const marker = () => join(root, 'supervisor/reboot-proofs', `pending-${epoch}.json`)
  afterEach(async () => {
    proofIo.deviceOffset = 0n
    proofIo.noFollowFallback = false
    volume = 'apfs:11111111-1111-4111-8111-111111111111'
    vi.restoreAllMocks()
    if (owner) {
      await owner.shutdown()
      await owner.closed
      owner = undefined
    }
    if (parent) await rm(parent, { recursive: true, force: true })
  }, 30_000)
  async function fixture(phase: 'blocked' | 'draining' = 'blocked', exited?: boolean) {
    parent = await realpath(
      await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-reboot-')),
    )
    root = join(parent, 'plugins')

    const initial = await PluginSupervisor.start({ root, workspaceRoots: [] })
    await initial.shutdown()
    await initial.closed
    const storage = new SupervisorStorage(root, [], false)
    const previous = storage.read()!
    epoch = previous.epoch
    storage.write({ ...previous, phase })
    storage.close()
    const id = randomUUID()
    run = join(root, 'host/runs', id)
    await mkdir(run, { recursive: true, mode: 0o700 })
    if (exited !== undefined)
      await writeFile(
        join(run, 'exit.json'),
        JSON.stringify({
          format: 1,
          runId: id,
          pluginId: 'fictional',
          releaseDigest: 'f'.repeat(64),
          guardianPid: 404941,
          groups: [],
          exited,
        }),
        { mode: 0o600 },
      )
    witness = { kind: 'darwin-boot-session-v1', value: firstBoot }
    observe.mockClear()
    return lstat(join(root, 'supervisor/owner-lock.sqlite'), { bigint: true })
  }
  const attempt = async () => {
    owner = await PluginSupervisor.start({
      root,
      workspaceRoots: [],
      recoverPrevious: (previous) =>
        previousRunsProvenStopped(root, {
          previous,
          readBootWitness: observe,
          readVolumeIdentity: async () => volume,
        }),
    })
    return owner
  }
  const refused = () => expect(attempt()).rejects.toMatchObject({ code: 'cleanup-pending' })
  it('records durable volume identities in newly staged reboot proofs', async () => {
    await fixture()
    await refused()
    expect(await readFile(marker(), 'utf8')).toContain(volume)
  })
  it.each([false, true])(
    'records a durable volume and replays its certificate after two device renumberings (no-follow fallback: %s)',
    async (fallback) => {
      proofIo.noFollowFallback = fallback
      await fixture()
      await refused()
      proofIo.deviceOffset = 17n
      witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
      const write = SupervisorStorage.prototype.write
      const interrupted = vi
        .spyOn(SupervisorStorage.prototype, 'write')
        .mockImplementation(function (this: SupervisorStorage, value) {
          if (value.phase === 'stopped') throw new Error('fictional interrupted transition')
          return write.call(this, value)
        })
      await expect(attempt()).rejects.toBeDefined()
      interrupted.mockRestore()
      proofIo.deviceOffset = 29n
      witness = null
      await attempt()
    },
  )
  it('refuses a changed anchored volume even with identical inodes and a different boot', async () => {
    await fixture()
    await refused()
    volume = 'apfs:22222222-2222-4222-8222-222222222222'
    proofIo.deviceOffset = 17n
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    await refused()
  })
  it('refuses device drift in the same boot', async () => {
    await fixture()
    await refused()
    proofIo.deviceOffset = 17n
    await refused()
  })
  async function makeLegacy(file: string) {
    const proof = JSON.parse(await readFile(file, 'utf8'))
    const pending = proof.marker ?? proof
    for (const [key, folder] of Object.entries({
      rootIdentity: root,
      fenceIdentity: join(root, 'supervisor/owner-lock.sqlite'),
      hostIdentity: join(root, 'host'),
      runsIdentity: join(root, 'host/runs'),
    }))
      pending.binding[key] = `999999999:${(await lstat(folder, { bigint: true })).ino}`
    for (const item of pending.census)
      item.identity = `999999999:${(await lstat(join(root, 'host/runs', item.id), { bigint: true })).ino}`
    pending.digest = createHash('sha256').update(JSON.stringify(pending.census)).digest('hex')
    const text = JSON.stringify(proof)
    await writeFile(file, text)
    return text
  }
  it('legacy anchorless record on a renumbered or cloned volume is rebound and logged only after reboot', async () => {
    await fixture()
    await refused()
    const original = await makeLegacy(marker())
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await refused()
    expect(log).not.toHaveBeenCalled()
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    await attempt()
    expect(log).toHaveBeenCalledWith('rebound after device renumbering')
    expect(await readFile(marker(), 'utf8')).toBe(original)
    const nonce = JSON.parse(original).nonce
    const certificate = await readFile(
      join(root, 'supervisor/reboot-proofs/certificates', `${nonce}.json`),
      'utf8',
    )
    expect(certificate).toContain(volume)
  })
  it('never treats a changed Windows volume serial as legacy device renumbering', async () => {
    await fixture()
    await refused()
    await makeLegacy(marker())
    volume = `winvol:${(await lstat(root, { bigint: true })).dev}`
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    await refused()
  })
  it.skipIf(process.platform === 'win32').each(['symlink'] as const)(
    'refuses changed run %s across a genuine reboot',
    async (change) => {
      await fixture()
      await refused()
      {
        const saved = join(parent, 'saved-run')
        await rename(run, saved)
        await symlink(saved, run, 'dir')
      }
      witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
      await refused()
    },
  )
  it('keeps dev:ino pinning when native volume observation races with a mount change', async () => {
    await fixture()
    await expect(
      PluginSupervisor.start({
        root,
        workspaceRoots: [],
        recoverPrevious: (previous) =>
          previousRunsProvenStopped(root, {
            previous,
            readBootWitness: observe,
            readVolumeIdentity: async () => {
              proofIo.deviceOffset = 41n
              return volume
            },
          }),
      }),
    ).rejects.toMatchObject({ code: 'cleanup-pending' })
    await expect(readFile(marker())).rejects.toMatchObject({ code: 'ENOENT' })
  })
  async function retainedProof(kind: 'pending' | 'certificate') {
    await fixture()
    await refused()
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    if (kind === 'pending') return marker()
    const pending = JSON.parse(await readFile(marker(), 'utf8'))
    const write = SupervisorStorage.prototype.write
    const interrupted = vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
      this: SupervisorStorage,
      value,
    ) {
      if (value.phase === 'stopped') throw new Error('fictional interrupted transition')
      return write.call(this, value)
    })
    await expect(attempt()).rejects.toBeDefined()
    interrupted.mockRestore()
    witness = null
    return join(root, 'supervisor/reboot-proofs/certificates', `${pending.nonce}.json`)
  }
  it.each([false, true])(
    'enrols a legacy certificate without rewriting it, then refuses a changed recorded volume (no-follow fallback: %s)',
    async (fallback) => {
      proofIo.noFollowFallback = fallback
      const file = await retainedProof('certificate')
      const original = await makeLegacy(file)
      const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await attempt()
      expect(await readFile(file, 'utf8')).toBe(original)
      expect(log).toHaveBeenCalledWith('rebound after device renumbering')
      await owner!.shutdown()
      await owner!.closed
      owner = undefined
      const storage = new SupervisorStorage(root, [], false)
      storage.write({ ...storage.read()!, phase: 'blocked' })
      storage.close()
      proofIo.deviceOffset = 71n
      await attempt()
      await owner!.shutdown()
      await owner!.closed
      owner = undefined
      const nextStorage = new SupervisorStorage(root, [], false)
      nextStorage.write({ ...nextStorage.read()!, phase: 'blocked' })
      nextStorage.close()
      volume = 'apfs:22222222-2222-4222-8222-222222222222'
      await refused()
    },
  )
  it.each(['digest', 'inode', 'hardlink'] as const)(
    'refuses a changed legacy certificate enrollment: %s',
    async (change) => {
      const file = await retainedProof('certificate')
      const original = await makeLegacy(file)
      await attempt()
      await owner!.shutdown()
      await owner!.closed
      owner = undefined
      const storage = new SupervisorStorage(root, [], false)
      storage.write({ ...storage.read()!, phase: 'blocked' })
      storage.close()
      const nonce = JSON.parse(original).marker.nonce
      const enrollment = join(root, 'supervisor/reboot-proofs/volume-bindings', `${nonce}.json`)
      if (change === 'hardlink') await link(enrollment, join(parent, 'external-enrollment-alias'))
      else {
        const value = JSON.parse(await readFile(enrollment, 'utf8'))
        if (change === 'digest') value.certificateDigest = 'f'.repeat(64)
        else {
          const parts = value.census[0].identity.split(':')
          parts[2] = '999999999'
          value.census[0].identity = parts.join(':')
          value.digest = createHash('sha256').update(JSON.stringify(value.census)).digest('hex')
        }
        await writeFile(enrollment, JSON.stringify(value))
      }
      await refused()
    },
  )
  it.each(['pending', 'certificate'] as const)(
    'refuses a hardlinked %s proof as takeover authority',
    async (kind) => {
      const path = await retainedProof(kind)
      await link(path, join(parent, 'external-proof-alias'))
      expect((await lstat(path)).nlink).toBe(2)
      await refused()
    },
  )
  it.skipIf(process.platform === 'win32').each(['pending', 'certificate'] as const)(
    'refuses a publicly writable %s proof as takeover authority',
    async (kind) => {
      const path = await retainedProof(kind)
      await chmod(path, 0o666)
      await refused()
    },
  )
  it.each(['blocked', 'draining'] as const)(
    'stages once and heals %s missing receipts only after a different boot',
    async (phase) => {
      const lock = await fixture(phase)
      await refused()
      const pending = await readFile(marker(), 'utf8')
      await refused()
      expect(await readFile(marker(), 'utf8')).toBe(pending)
      witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
      await attempt()
      const after = await lstat(join(root, 'supervisor/owner-lock.sqlite'), { bigint: true })
      expect([after.dev, after.ino]).toEqual([lock.dev, lock.ino])
      await expect(readFile(join(run, 'exit.json'))).rejects.toMatchObject({ code: 'ENOENT' })
      const nonce = JSON.parse(pending).nonce
      expect(
        JSON.parse(
          await readFile(
            join(root, 'supervisor/reboot-proofs/certificates', `${nonce}.json`),
            'utf8',
          ),
        ).method,
      ).toBe('post-marker-boot-boundary')
    },
  )
  it.each(['100', '101', '4294967396'])(
    'keeps Windows equal/higher native ticks %s refused without refreshing the marker',
    async (value) => {
      await fixture('draining', false)
      witness = { kind: 'windows-tick64-v1', value: '100' }
      await refused()
      const pending = await readFile(marker(), 'utf8')
      witness = { kind: 'windows-tick64-v1', value }
      await refused()
      expect(await readFile(marker(), 'utf8')).toBe(pending)
    },
  )
  it('uses a strict exact UInt64 Windows tick retreat, preserves false receipts and replays the certificate', async () => {
    await fixture('blocked', false)
    const original = await readFile(join(run, 'exit.json'), 'utf8')
    witness = { kind: 'windows-tick64-v1', value: '18446744073709551000' }
    await refused()
    witness = { kind: 'windows-tick64-v1', value: '9007199254740993' }
    const write = SupervisorStorage.prototype.write
    const interrupted = vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
      this: SupervisorStorage,
      value,
    ) {
      if (value.phase === 'stopped')
        throw Object.assign(new Error('fictional publication interruption'), { code: 'EIO' })
      return write.call(this, value)
    })
    await expect(attempt()).rejects.toBeDefined()
    interrupted.mockRestore()
    witness = null
    await attempt()
    expect(await readFile(join(run, 'exit.json'), 'utf8')).toBe(original)
  })
  it.each([
    null,
    { kind: 'darwin-boot-session-v1', value: '00000000-0000-0000-0000-000000000000' },
    { kind: 'windows-tick64-v1', value: '18446744073709551616' },
  ])('fails closed on unavailable or invalid native evidence %j', async (invalid) => {
    await fixture()
    witness = invalid
    await refused()
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    await refused()
    expect(JSON.parse(await readFile(marker(), 'utf8')).witness).toEqual(witness)
  })
  it('does not interpret UUID case changes or wall-clock jumps as a reboot', async () => {
    await fixture()
    await refused()
    witness = { kind: 'darwin-boot-session-v1', value: firstBoot.toUpperCase() }
    vi.spyOn(Date, 'now').mockReturnValue(99_999_999_999_999)
    await refused()
    vi.spyOn(Date, 'now').mockReturnValue(1)
    await refused()
    expect(observe).toHaveBeenCalledTimes(3)
  })
  it('refuses a changed full census rather than silently replacing its marker', async () => {
    await fixture()
    await refused()
    const pending = await readFile(marker(), 'utf8')
    await mkdir(join(root, 'host/runs', randomUUID()), { mode: 0o700 })
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    await refused()
    expect(await readFile(marker(), 'utf8')).toBe(pending)
  })
  it('does not let an old certificate prove a new run in a later owner generation', async () => {
    await fixture()
    await refused()
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    await attempt()
    await owner!.shutdown()
    await owner!.closed
    owner = undefined
    const storage = new SupervisorStorage(root, [], false)
    const next = storage.read()!
    storage.write({ ...next, phase: 'blocked' })
    storage.close()
    epoch = next.epoch
    await mkdir(join(root, 'host/runs', randomUUID()), { mode: 0o700 })
    await refused()
    expect(JSON.parse(await readFile(marker(), 'utf8')).epoch).toBe(next.epoch)
  })
  it('does not stage reboot recovery for an accepting legacy owner', async () => {
    await fixture()
    const storage = new SupervisorStorage(root, [], false)
    storage.write({ ...storage.read()!, phase: 'accepting' })
    storage.close()
    await refused()
    await expect(readFile(marker())).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['blocked', 'draining'] as const)(
    'reports reboot advice only after a durable valid %s marker, without changing refusal',
    async (phase) => {
      await fixture(phase)
      const advice = vi.fn()
      const observeAttempt = () =>
        PluginSupervisor.start({
          root,
          workspaceRoots: [],
          recoverPrevious: (previous) =>
            previousRunsProvenStopped(root, {
              previous,
              readBootWitness: observe,
              onRebootRequired: advice,
            }),
        })
      await expect(observeAttempt()).rejects.toMatchObject({ code: 'cleanup-pending' })
      expect(advice).toHaveBeenCalledOnce()
      const original = await readFile(marker(), 'utf8')
      advice.mockClear()
      await expect(observeAttempt()).rejects.toMatchObject({ code: 'cleanup-pending' })
      expect(advice).toHaveBeenCalledOnce()
      expect(await readFile(marker(), 'utf8')).toBe(original)
      await writeFile(marker(), '{}')
      advice.mockClear()
      await expect(observeAttempt()).rejects.toMatchObject({ code: 'cleanup-pending' })
      expect(advice).not.toHaveBeenCalled()
    },
  )
  it('does not offer reboot advice when the native observation is unavailable', async () => {
    await fixture()
    const advice = vi.fn()
    witness = null
    const storage = new SupervisorStorage(root, [], false)
    try {
      expect(
        await previousRunsProvenStopped(root, {
          previous: storage.read(),
          readBootWitness: observe,
          onRebootRequired: advice,
        }),
      ).toBe(false)
      expect(advice).not.toHaveBeenCalled()
    } finally {
      storage.close()
    }
  })
  it.each(['method-mismatch', 'reader-failed', 'publication-failed', 'observer-failed'] as const)(
    'keeps proof refusal unchanged when advice is %s',
    async (failure) => {
      await fixture()
      const advice = vi.fn(() => {
        if (failure === 'observer-failed') throw new Error('fictional observer failure')
      })
      if (failure === 'method-mismatch') {
        await refused()
        witness = { kind: 'windows-tick64-v1', value: '123456' }
      }
      if (failure === 'reader-failed')
        observe.mockRejectedValueOnce(new Error('fictional reader failure'))
      proofIo.failRename = failure === 'publication-failed'
      try {
        await expect(
          PluginSupervisor.start({
            root,
            workspaceRoots: [],
            recoverPrevious: (previous) =>
              previousRunsProvenStopped(root, {
                previous,
                readBootWitness: observe,
                onRebootRequired: advice,
              }),
          }),
        ).rejects.toMatchObject({ code: 'cleanup-pending' })
        if (failure === 'observer-failed') expect(advice).toHaveBeenCalledOnce()
        else expect(advice).not.toHaveBeenCalled()
      } finally {
        proofIo.failRename = false
      }
    },
  )
  it.each(['epoch', 'rootIdentity', 'fenceIdentity', 'runsIdentity'] as const)(
    'refuses a changed marker binding %s without resealing it',
    async (field) => {
      await fixture()
      await refused()
      const pending = JSON.parse(await readFile(marker(), 'utf8'))
      if (field === 'epoch') pending.epoch = randomUUID()
      else pending.binding[field] = 'fictional-other-identity'
      const changed = JSON.stringify(pending)
      await writeFile(marker(), changed)
      witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
      await refused()
      expect(await readFile(marker(), 'utf8')).toBe(changed)
    },
  )
  it('refuses a replacement directory with the same run UUID', async () => {
    await fixture()
    await refused()
    await rename(run, join(parent, 'retained-old-run'))
    await mkdir(run, { mode: 0o700 })
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    await refused()
  })
  it('keeps a torn certificate from becoming recovery success', async () => {
    await fixture()
    await refused()
    const pending = JSON.parse(await readFile(marker(), 'utf8'))
    await writeFile(
      join(root, 'supervisor/reboot-proofs/certificates', `${pending.nonce}.json`),
      '{',
      { mode: 0o600 },
    )
    witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
    await refused()
  })
  it.each(['torn', 'complete'])(
    'ignores a recognized crash-leftover staging file without granting it authority: %s',
    async (kind) => {
      await fixture()
      await refused()
      const temporary = join(
        root,
        'supervisor/reboot-proofs/certificates',
        `.proof-${randomUUID()}`,
      )
      const pending = JSON.parse(await readFile(marker(), 'utf8'))
      const contents =
        kind === 'torn'
          ? '{'
          : JSON.stringify({
              format: 1,
              method: 'post-marker-boot-boundary',
              marker: pending,
              after: { kind: 'darwin-boot-session-v1', value: randomUUID() },
            })
      await writeFile(temporary, contents, { mode: 0o600 })
      await refused()
      witness = { kind: 'darwin-boot-session-v1', value: randomUUID() }
      await attempt()
      expect(await readFile(temporary, 'utf8')).toBe(contents)
    },
  )
  it('allows a late positive receipt independently of the pending witness', async () => {
    await fixture('blocked', false)
    await refused()
    const pending = await readFile(marker(), 'utf8')
    const proof = JSON.parse(await readFile(join(run, 'exit.json'), 'utf8'))
    await writeFile(join(run, 'exit.json'), JSON.stringify({ ...proof, exited: true }))
    witness = null
    await attempt()
    expect(await readFile(marker(), 'utf8')).toBe(pending)
  })
  it('does not invent a predecessor epoch for a missing owner record', async () => {
    await fixture()
    await unlink(join(root, 'supervisor/owner.json'))
    await refused()
    await expect(readFile(marker())).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claimSoleHost } from '../src/main/one-host-gate'
import { keepPluginRootPrivate } from '../src/main/plugins/private-files'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'

// Real Windows pipe peer identity and SQLite admission; no plugin/browser or live profile.
describe.skipIf(process.platform !== 'win32')('Windows workspace authority recovery', () => {
  let parent = ''
  let owner: PluginSupervisor | undefined
  const leases: PluginWorkspaceLease[] = []
  afterEach(async () => {
    for (const lease of leases.splice(0)) await lease.close()
    await owner?.shutdown()
    if (parent) await rm(parent, { recursive: true, force: true })
  })
  async function fixture(claim = true) {
    parent = await realpath(await mkdtemp(join(tmpdir(), 'fictional-owner-authority-')))
    const root = join(parent, 'plugins'),
      workspaceRoot = join(parent, 'workspace')
    await mkdir(workspaceRoot, { mode: 0o700 })
    await keepPluginRootPrivate(root)
    if (claim) expect(await claimSoleHost(workspaceRoot)).toBe('sole')
    owner = await PluginSupervisor.start({ root, workspaceRoots: [workspaceRoot] })
    return { root, workspaceRoot, build: 'fictional', generation: randomUUID() }
  }
  async function attach(
    options: Parameters<typeof PluginWorkspaceLease.attach>[0] & { workspaceAuthority?: boolean },
  ) {
    const lease = await PluginWorkspaceLease.attach(options)
    leases.push(lease)
    return lease
  }
  it('requires the actual workspace gate and revokes an obsolete lease before granting its replacement', async () => {
    const options = await fixture()
    const old = await attach(options)
    const otherRoot = join(parent, 'other-workspace')
    await mkdir(otherRoot, { mode: 0o700 })
    const other = await attach({ ...options, workspaceRoot: otherRoot, generation: randomUUID() })
    const sentinel = join(options.root, 'profile-sentinel')
    await writeFile(sentinel, 'fictional-retained-profile', { mode: 0o600 })
    // A build/generation alone must not steal the lease.
    await expect(
      PluginWorkspaceLease.attach({ ...options, generation: randomUUID(), build: 'fictional-new' }),
    ).rejects.toMatchObject({ code: 'busy' })
    const successorOptions = { ...options, generation: randomUUID(), workspaceAuthority: true }
    const next = await attach(successorOptions)
    expect(owner!.valid(old.lease, old.epoch)).toBe(false)
    await expect(old.renew()).rejects.toMatchObject({ code: 'unavailable' })
    expect(owner!.valid(next.lease, next.epoch)).toBe(true)
    expect(owner!.valid(other.lease, other.epoch)).toBe(true)
    await expect(other.renew()).resolves.toBeUndefined()
    expect(await readFile(sentinel, 'utf8')).toBe('fictional-retained-profile')
  }, 120_000)
  it('serializes two valid successor claims so only one generation remains active', async () => {
    const options = await fixture()
    const original = await attach(options)
    const arrivals = await Promise.all([
      attach({ ...options, generation: randomUUID(), workspaceAuthority: true }),
      attach({ ...options, generation: randomUUID(), workspaceAuthority: true }),
    ])
    expect(owner!.valid(original.lease, original.epoch)).toBe(false)
    expect(arrivals.filter((lease) => owner!.valid(lease.lease, lease.epoch))).toHaveLength(1)
  }, 180_000)
  it('does not replace a healthy lease on a claimed sole status without a live workspace gate', async () => {
    const options = await fixture(false)
    const original = await attach(options)
    const unproved = { ...options, generation: randomUUID(), workspaceAuthority: true }
    await expect(PluginWorkspaceLease.attach(unproved)).rejects.toMatchObject({ code: 'busy' })
    expect(owner!.valid(original.lease, original.epoch)).toBe(true)
  }, 120_000)
  it('does not evict any of sixty-four other live workspaces at capacity', async () => {
    const options = await fixture()
    for (let index = 0; index < 64; index++) {
      const workspaceRoot = join(parent, `capacity-${index}`)
      await mkdir(workspaceRoot, { mode: 0o700 })
      await attach({ ...options, workspaceRoot, generation: randomUUID() })
    }
    const full = { ...options, generation: randomUUID(), workspaceAuthority: true }
    await expect(PluginWorkspaceLease.attach(full)).rejects.toMatchObject({ code: 'busy' })
    expect(leases.every((lease) => owner!.valid(lease.lease, lease.epoch))).toBe(true)
  }, 120_000)
})

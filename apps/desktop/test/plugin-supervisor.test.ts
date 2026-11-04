import { randomUUID } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { mkdir, readFile, writeFile, chmod, lstat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import {
  PluginSupervisorAttachment,
  PluginWorkspaceLease,
  supervisorRequest,
} from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import {
  OWNER_LIMITS,
  OWNER_WIRE,
  pack,
  secret,
  unpack,
} from '../src/main/plugins/supervisor/protocol'
import { deferred, supervisorFixtures } from './plugin-supervisor-fixtures'
const f = supervisorFixtures()
afterEach(async () => {
  vi.restoreAllMocks()
  await f.cleanup()
})

describe('ordinary shared plugin supervisor', () => {
  it('four workspaces share one owner; releasing one leaves the other three usable', async () => {
    const target = await f.fixture(),
      owner = await target.start()
    const clients: PluginWorkspaceLease[] = []
    for (let index = 0; index < 4; index++) {
      const workspaceRoot = join(target.folder, `w${index}`)
      await mkdir(workspaceRoot)
      clients.push(await target.attach({ workspaceRoot }))
    }
    expect(new Set(clients.map((client) => client.epoch)).size).toBe(1)
    expect(new Set(clients.map((client) => client.lease)).size).toBe(4)
    expect(await clients[0]!.close()).toBe(true)
    for (const client of clients.slice(1)) await client.renew()
    expect(owner.acceptsStarts()).toBe(true)
    for (const client of clients.slice(1)) expect(await client.close()).toBe(true)
    expect(target.read()?.phase).toBe('stopped')
  })
  it('keeps one writer owner even after the discovery record is removed or overwritten', async () => {
    const target = await f.fixture(),
      owner = await target.start()
    await writeFile(join(target.root, 'supervisor/owner.json'), '{fictional torn discovery')
    await expect(
      PluginSupervisor.start({ root: target.root, workspaceRoots: [] }),
    ).rejects.toMatchObject({ code: 'busy' })
    expect(await owner.shutdown()).toBe(true)
    await target.start()
  })
  it('an alternate path to the same writer cannot create a second owner', async () => {
    const target = await f.fixture(),
      owner = await target.start()
    const alias = join(target.folder, 'same-selected-root')
    await symlink(target.root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(PluginSupervisor.start({ root: alias, workspaceRoots: [] })).rejects.toMatchObject(
      { code: 'busy' },
    )
    expect(await owner.shutdown()).toBe(true)
    const successor = await PluginSupervisor.start({ root: alias, workspaceRoots: [] })
    f.owners.push(successor)
    expect(await successor.shutdown()).toBe(true)
  })
  it('uses the live instance response rather than a stale discovery phase', async () => {
    const target = await f.fixture(),
      owner = await target.start()
    const storage = new SupervisorStorage(target.root, [], false)
    try {
      storage.write({ ...storage.read()!, phase: 'blocked' })
    } finally {
      storage.close()
    }
    const lease = await target.attach()
    expect(owner.valid(lease.lease, lease.epoch)).toBe(true)
    expect(await lease.close()).toBe(true)
  })
  it('accepts more than sixty-four workspace registrations without a lease quota', async () => {
    const target = await f.fixture(),
      owner = await target.start()
    const storage = new SupervisorStorage(target.root, [], false),
      record = storage.read()!
    try {
      for (let index = 0; index < 70; index++) {
        await expect(
          supervisorRequest(storage, record, {
            kind: 'hello',
            workspace: secret(),
            generation: randomUUID(),
            build: 'fictional',
            wire: OWNER_WIRE,
          }),
        ).resolves.toHaveProperty('lease')
      }
    } finally {
      storage.close()
    }
    expect(await owner.shutdown()).toBe(true)
  })
  it('uses ordinary JSON framing regardless of legacy key or direction arguments', () => {
    const value = {
      epoch: randomUUID(),
      nonce: secret(),
      command: { kind: 'probe' },
      payload: 'x'.repeat(32_768),
    }
    const packet = pack('legacy-unused-key', 'request', value)
    expect(JSON.parse(packet)).toEqual(value)
    expect(unpack('different-unused-key', 'response', packet)).toEqual(value)
  })
  it('routes a packet larger than the retired quota using current workspace and instance metadata', async () => {
    const target = await f.fixture(),
      owner = await target.start(),
      lease = await target.attach()
    const routes = vi.fn(async (_lease: unknown, command: { occupied: string[] }) => ({
      count: command.occupied.length,
    }))
    owner.bindAgentBridge({ routes, revoke() {} })
    const { pluginWorkspaceIdentity } = await import('../src/main/plugins/supervisor/client')
    const input = {
      workspaceId: pluginWorkspaceIdentity(target.workspaceRoot),
      incarnation: randomUUID(),
      occupied: Array.from({ length: 128 }, (_, i) => String(i).padEnd(128, 'x')),
    }
    expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(16 * 1024)
    await expect(lease.agentRoutes(input)).resolves.toEqual({ count: 128 })
    expect(routes).toHaveBeenCalledOnce()
    await expect(lease.agentRoutes({ ...input, workspaceId: randomUUID() })).rejects.toThrow()
  })
  it('accepts a request without a challenge and rejects an obsolete owner epoch', async () => {
    const target = await f.fixture()
    await target.start()
    const storage = new SupervisorStorage(target.root, [], false),
      record = storage.read()!
    try {
      await expect(supervisorRequest(storage, record, { kind: 'probe' })).resolves.toEqual({
        phase: 'accepting',
      })
      await expect(
        supervisorRequest(storage, { ...record, epoch: randomUUID() }, { kind: 'probe' }),
      ).rejects.toThrow()
    } finally {
      storage.close()
    }
  })
  it.each(['nonce', 'epoch'] as const)('rejects a reply with the wrong %s', async (wrong) => {
    const target = await f.fixture(),
      storage = new SupervisorStorage(target.root, [], true)
    const record = {
      version: 1 as const,
      epoch: randomUUID(),
      key: secret(),
      phase: 'accepting' as const,
      wire: OWNER_WIRE,
    }
    storage.write(record)
    const server = createServer((socket) =>
      socket.once('data', (bytes) => {
        const request = JSON.parse(bytes.toString())
        socket.end(
          JSON.stringify({
            ok: true,
            nonce: request.nonce,
            epoch: record.epoch,
            [wrong]: wrong === 'nonce' ? secret() : randomUUID(),
            value: { phase: 'accepting' },
          }) + '\n',
        )
      }),
    )
    await new Promise<void>((resolve) => server.listen(storage.endpoint(record), resolve))
    try {
      await expect(supervisorRequest(storage, record, { kind: 'probe' })).rejects.toThrow()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      storage.close()
    }
  })
  it('handles a request split across socket chunks', async () => {
    const target = await f.fixture()
    await target.start()
    const storage = new SupervisorStorage(target.root, [], false),
      record = storage.read()!
    const socket = createConnection(storage.endpoint(record))
    const reply = new Promise<string>((resolve, reject) => {
      socket.on('error', reject)
      socket.once('data', (bytes) => resolve(bytes.toString()))
    })
    const packet =
      JSON.stringify({ epoch: record.epoch, nonce: secret(), command: { kind: 'probe' } }) + '\n'
    socket.write(packet.slice(0, 20))
    socket.write(packet.slice(20))
    try {
      expect(JSON.parse(await reply)).toMatchObject({
        ok: true,
        epoch: record.epoch,
        value: { phase: 'accepting' },
      })
    } finally {
      socket.destroy()
      storage.close()
    }
  })
  it('a repeated renewal retains its request correlation without a cryptographic admission step', async () => {
    const target = await f.fixture()
    await target.start()
    const storage = new SupervisorStorage(target.root, [], false),
      record = storage.read()!
    const identity = { workspace: secret(), generation: randomUUID() }
    try {
      const hello = (await supervisorRequest(storage, record, {
        kind: 'hello',
        ...identity,
        wire: OWNER_WIRE,
        build: 'fictional',
      })) as { lease: string }
      const command = {
        kind: 'renew' as const,
        ...identity,
        lease: hello.lease,
        counter: 1,
        renewal: secret(),
      }
      await expect(supervisorRequest(storage, record, command)).resolves.toEqual({ counter: 1 })
      await expect(supervisorRequest(storage, record, command)).resolves.toEqual({ counter: 1 })
      await expect(
        supervisorRequest(storage, record, { ...command, generation: randomUUID() }),
      ).rejects.toThrow()
    } finally {
      storage.close()
    }
  })
  it('negotiates a shared wire version without replacing an incompatible incumbent', async () => {
    const target = await f.fixture()
    await target.start({
      wire: { major: 1, minMinor: 1, maxMinor: 3, features: ['fictional-a', 'fictional-b'] },
    })
    const lease = await PluginWorkspaceLease.attach({
      ...target.options,
      wire: { major: 1, minMinor: 2, maxMinor: 4, features: ['fictional-b'] },
    })
    f.leases.push(lease)
    expect(lease.minor).toBe(3)
    expect(lease.features).toEqual(['fictional-b'])
    const launch = vi.fn()
    await expect(
      PluginWorkspaceLease.attach({
        ...target.options,
        wire: { major: 2, minMinor: 0, maxMinor: 0, features: [] },
        launch,
      }),
    ).rejects.toMatchObject({ code: 'incompatible' })
    expect(launch).not.toHaveBeenCalled()
  })
  it('keeps ordinary directory modes and a selected root without enrolling path identities', async () => {
    const target = await f.fixture()
    await mkdir(target.root, { mode: 0o755 })
    await chmod(target.root, 0o755)
    const before = (await lstat(target.root)).mode
    const owner = await target.start()
    expect((await lstat(target.root)).mode).toBe(before)
    expect(await owner.shutdown()).toBe(true)
    expect(
      JSON.parse(await readFile(join(target.root, 'supervisor/owner.json'), 'utf8')).phase,
    ).toBe('stopped')
  })
  it('drops an attachment that finishes during quit and launches only once', async () => {
    const target = await f.fixture(),
      lifetime = new PluginSupervisorAttachment(),
      gate = deferred<void>()
    const launch = vi.fn(async () => {
      await gate.promise
      await target.start()
    })
    lifetime.start({ ...target.options, launch })
    lifetime.start({ ...target.options, launch })
    const quit = lifetime.quit()
    gate.resolve()
    await quit
    expect(launch).toHaveBeenCalledOnce()
    expect(target.read()?.phase).toBe('stopped')
  })
  it('expires a dead workspace without interrupting a renewed workspace', async () => {
    let now = 0
    const target = await f.fixture(),
      owner = await target.start({ now: () => now })
    const dead = await target.attach()
    const workspaceRoot = join(target.folder, 'live')
    await mkdir(workspaceRoot)
    const live = await target.attach({ workspaceRoot })
    now = OWNER_LIMITS.heartbeat
    await live.renew()
    now = OWNER_LIMITS.expires
    await owner.tick()
    expect(owner.valid(dead.lease, dead.epoch)).toBe(false)
    expect(owner.valid(live.lease, live.epoch)).toBe(true)
    await live.renew()
    expect(await live.close()).toBe(true)
  })
  it('reserves pending physical starts before drain and stops a late returned child', async () => {
    const target = await f.fixture(),
      owner = await target.start({ drainWithin: 20 })
    await target.attach()
    const gate = deferred<void>(),
      stop = vi.fn()
    f.releases.push(() => gate.resolve())
    const pending = owner.startChild(async () => {
      await gate.promise
      return { stop, exited: Promise.resolve(), descendantsGone: async () => false }
    })
    expect(await owner.shutdown()).toBe(false)
    expect(owner.acceptsStarts()).toBe(false)
    await expect(
      owner.startChild(async () => {
        throw new Error('must not run')
      }),
    ).rejects.toThrow()
    gate.resolve()
    await pending
    await owner.closed
    expect(stop).toHaveBeenCalledOnce()
    await target.start()
  })
  it('four simultaneous launchers converge on one current writer owner', async () => {
    const target = await f.fixture()
    const workspaces: string[] = []
    for (let index = 0; index < 4; index++) {
      const workspace = join(target.folder, `simultaneous-${index}`)
      await mkdir(workspace)
      workspaces.push(workspace)
    }
    const launch = vi.fn(async () => {
      await target.start()
    })
    const clients = await Promise.all(
      workspaces.map((workspaceRoot) =>
        PluginWorkspaceLease.attach({ ...target.options, workspaceRoot, launch }),
      ),
    )
    f.leases.push(...clients)
    expect(launch).toHaveBeenCalledOnce()
    expect(new Set(clients.map((client) => client.epoch)).size).toBe(1)
    for (const client of clients) expect(await client.close()).toBe(true)
  })
  it('a duplicate workspace cannot replace its current registration', async () => {
    const target = await f.fixture(),
      owner = await target.start(),
      first = await target.attach()
    await expect(target.attach({ generation: randomUUID() })).rejects.toMatchObject({
      code: 'busy',
    })
    expect(owner.valid(first.lease, first.epoch)).toBe(true)
    await first.renew()
  })
})

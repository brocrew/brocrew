import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import {
  pluginWorkspaceIdentity,
  PluginWorkspaceLease,
} from '../src/main/plugins/supervisor/client'
import { AGENT_ROUTES_FORMAT_2, OWNER_WIRE } from '../src/main/plugins/supervisor/protocol'
import { supervisorFixtures } from './plugin-supervisor-fixtures'
import { keepPluginRootPrivate } from '../src/main/plugins/private-files'

const f = supervisorFixtures()
const closing: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closing.splice(0)) await close()
  vi.restoreAllMocks()
  await f.cleanup()
})

const server = (pluginId: string) => ({
  name: `plugin-${pluginId}`,
  url: `http://127.0.0.1:1/${pluginId}`,
  capability: 'c'.repeat(64),
  pluginId,
})
const named = {
  servers: [server('aster')],
  pending: ['zinnia'],
  none: ['yarrow'],
  unknown: false,
}

describe('a routes reply names each plugin when both sides agreed to', () => {
  it('a lease that negotiated it is answered with each plugin, read with that lease', async () => {
    const target = await f.fixture()
    await keepPluginRootPrivate(target.root)
    const owner = await target.start()
    const lease = await target.attach()
    const routes = vi.fn(async () => [])
    const agentRoutes = vi.fn(async () => named)
    owner.bindAgentBridge({ routes, agentRoutes, revoke() {} })
    expect(lease.features).toContain(AGENT_ROUTES_FORMAT_2)
    const source = new WorkspacePluginAttachments(
      { agentRoutes: (input) => lease.agentRoutes(input) },
      pluginWorkspaceIdentity(target.workspaceRoot),
    ).agent(['brobot'])
    const read = await source.read()
    expect(read.servers).toEqual([server('aster')])
    expect(read.plugins).toEqual({ pending: ['zinnia'], none: ['yarrow'], unknown: false })
    expect(routes).not.toHaveBeenCalled()
  })

  it('a lease from a peer without it gets the plain array, read as the complete set', async () => {
    const target = await f.fixture()
    await keepPluginRootPrivate(target.root)
    const owner = await target.start()
    const lease = await PluginWorkspaceLease.attach({
      ...target.options,
      wire: {
        ...OWNER_WIRE,
        features: OWNER_WIRE.features.filter((one) => one !== AGENT_ROUTES_FORMAT_2),
      },
    })
    closing.push(() => lease.close())
    const plain = {
      name: 'plugin-aster',
      url: 'http://127.0.0.1:1/aster',
      capability: 'c'.repeat(64),
    }
    const routes = vi.fn(async () => [plain])
    const agentRoutes = vi.fn(async () => named)
    owner.bindAgentBridge({ routes, agentRoutes, revoke() {} })
    expect(lease.features).not.toContain(AGENT_ROUTES_FORMAT_2)
    const source = new WorkspacePluginAttachments(
      { agentRoutes: (input) => lease.agentRoutes(input) },
      pluginWorkspaceIdentity(target.workspaceRoot),
    ).agent(['brobot'])
    const read = await source.read()
    expect(read.servers).toEqual([plain])
    expect(read.plugins).toBeUndefined()
    expect(agentRoutes).not.toHaveBeenCalled()
  })

  it('a named reply asked of an owner that cannot give one is refused, never guessed', async () => {
    const target = await f.fixture()
    await keepPluginRootPrivate(target.root)
    const owner = await target.start()
    const lease = await target.attach()
    owner.bindAgentBridge({ routes: async () => [], revoke() {} })
    await expect(
      lease.agentRoutes({
        workspaceId: pluginWorkspaceIdentity(target.workspaceRoot),
        incarnation: randomUUID(),
        occupied: [],
      }),
    ).rejects.toThrow()
  })

  it('a reply that does not match the format its lease agreed is refused', async () => {
    const parse = (format: 1 | 2, value: unknown) =>
      new WorkspacePluginAttachments({ agentRoutes: async () => ({ format, value }) }, 'w')
        .agent([])
        .read()
    await expect(parse(1, named)).rejects.toThrow()
    await expect(parse(2, [server('aster')])).rejects.toThrow()
    await expect(
      parse(2, { ...named, servers: [{ ...server('aster'), pluginId: '' }] }),
    ).rejects.toThrow()
    await expect(parse(1, [{ ...server('aster') }])).rejects.toThrow()
  })

  it('a named reply listing every plugin the catalogue holds as off still serves the ready one', async () => {
    const none = Array.from({ length: 130 }, (_, n) => `fictional-${String(n)}`)
    const read = await new WorkspacePluginAttachments(
      {
        agentRoutes: async () => ({
          format: 2,
          value: { format: 2, servers: [server('aster')], pending: [], none, unknown: false },
        }),
      },
      'w',
    )
      .agent([])
      .read()
    expect(read.servers).toEqual([server('aster')])
    expect(read.plugins?.none).toHaveLength(130)
  })

  it('a named reply that names one plugin twice, or as two things at once, is refused', async () => {
    const parse = (value: unknown) =>
      new WorkspacePluginAttachments({ agentRoutes: async () => ({ format: 2, value }) }, 'w')
        .agent([])
        .read()
    const reply = { format: 2, servers: [server('aster')], pending: [], none: [], unknown: false }
    await expect(parse({ ...reply, pending: ['zinnia'], none: ['zinnia'] })).rejects.toThrow()
    await expect(parse({ ...reply, none: ['aster'] })).rejects.toThrow()
    await expect(parse({ ...reply, pending: ['aster'] })).rejects.toThrow()
    await expect(parse({ ...reply, servers: [server('aster'), server('aster')] })).rejects.toThrow()
    await expect(parse({ ...reply, pending: ['zinnia', 'zinnia'] })).rejects.toThrow()
    await expect(parse(reply)).resolves.toMatchObject({ servers: [server('aster')] })
  })
})

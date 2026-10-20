import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'
import type { Command } from '../src/main/plugins/supervisor/protocol'
import type { BrokerInput } from '../src/main/plugins/tool-broker'
import type { ManagedPluginMcpServer } from '@brobot2/runtime'

const closes: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
const request = (
  workspaceId: string,
  incarnation = randomUUID(),
): Extract<Command, { kind: 'agent-routes' }> => ({
  kind: 'agent-routes',
  workspaceId,
  incarnation,
  workspace: 'a'.repeat(64),
  generation: randomUUID(),
  lease: 'b'.repeat(64),
  occupied: ['brobot'],
  release: false,
})
const lease = (): WorkspaceLease => ({
  id: randomUUID(),
  workspace: 'a'.repeat(64),
  generation: randomUUID(),
  epoch: randomUUID(),
  counter: 0,
  renewedAt: 0,
  minor: 0,
  features: [],
})
async function connected(route: ManagedPluginMcpServer) {
  const client = new Client({ name: 'fictional-willow', version: '1' })
  client.onerror = () => {}
  closes.push(() => client.close())
  await client.connect(
    new StreamableHTTPClientTransport(new URL(route.url), {
      requestInit: { headers: { Authorization: `Bearer ${route.capability}` } },
    }),
  )
  return client
}
async function live() {
  const consumer: { bridge?: ReturnType<typeof createLifecycleAgentBridge> } = {}
  const f = await fixture({ deny: (id) => consumer.bridge?.deny(id) })
  await f.controller.detach(f.handle)
  const controller = sharedLifecycleWorkspaces(f.controller)
  const person = await controller.attach(f.local.sink)
  await controller.install(person, 'chrome')
  let valid = true,
    allowed = true
  const call = vi.fn()
  const binding = vi.fn(async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Fictional echo',
        inputSchema: { type: 'object' },
        prepare: (input: BrokerInput) => ({
          input,
          resources: [{ resource: 'profiles', key: 'fern', mode: 'read' as const }],
        }),
      },
    ],
    resources: [{ id: 'profiles', read: true, write: false }],
    adminOperations: [],
    isAllowed: () => allowed,
    server: {
      tool() {
        call()
        return {
          result: Promise.resolve({
            ok: true as const,
            value: { content: [{ type: 'text', text: 'fictional fern' }] },
          }),
          quiescent: Promise.resolve(),
          cancel() {},
        }
      },
      admin() {
        throw new Error('person surface must stay private')
      },
    },
  }))
  const bridge = createLifecycleAgentBridge({ controller, owner: { valid: () => valid }, binding })
  consumer.bridge = bridge
  closes.push(() => bridge.close())
  return {
    ...f,
    controller,
    person,
    bridge,
    binding,
    call,
    setValid: (v: boolean) => {
      valid = v
    },
    allow: (v: boolean) => {
      allowed = v
    },
  }
}
describe.skipIf(process.platform === 'win32')('live lifecycle agent bridge, inert server', () => {
  it('records binding failure as a closed refusal without downstream names or error text', async () => {
    const f = await live()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    f.binding.mockRejectedValueOnce(new Error('fictional-private-downstream-name'))
    try {
      expect(await f.bridge.routes(lease(), request(f.local.sink.workspaceId))).toEqual([])
      expect(log.mock.calls).toEqual([['Some plugin tools were refused.']])
    } finally {
      log.mockRestore()
    }
  })
  it('every incarnation gets a distinct authenticated capability and shares one installation broker', async () => {
    const f = await live(),
      owner = lease()
    const a = await f.bridge.routes(owner, request(f.local.sink.workspaceId))
    const b = await f.bridge.routes(owner, request(f.local.sink.workspaceId))
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0]!.capability).not.toBe(b[0]!.capability)
    expect(f.binding).toHaveBeenCalledOnce()
    const client = await connected(a[0]!)
    expect((await client.listTools()).tools.map((one) => one.name)).toEqual(['echo'])
    expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
      content: [{ text: 'fictional fern' }],
    })
    f.allow(false)
    expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({ isError: true })
    expect(f.call).toHaveBeenCalledOnce()
  })
  it('rechecks lease validity on discovery and calls, with no person/admin authority', async () => {
    const f = await live(),
      owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [route] = await f.bridge.routes(owner, req)
    const client = await connected(route!)
    expect((await client.listTools()).tools).toHaveLength(1)
    f.setValid(false)
    await expect(client.callTool({ name: 'echo', arguments: {} })).rejects.toThrow()
    expect(f.call).not.toHaveBeenCalled()
    expect(await f.bridge.routes(owner, req)).toEqual([])
  })
  it('uninstall revokes an old epoch and reinstall grants a different route', async () => {
    const f = await live(),
      owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [before] = await f.bridge.routes(owner, req)
    await f.controller.uninstall(f.person, 'chrome')
    expect(await f.bridge.routes(owner, req)).toEqual([])
    const response = await fetch(before!.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${before!.capability}` },
      body: '{}',
    }).catch(() => null)
    expect(response === null || response.status === 401).toBe(true)
    await f.controller.install(f.person, 'chrome')
    const [after] = await f.bridge.routes(owner, req)
    expect(after!.capability).not.toBe(before!.capability)
    expect(f.binding).toHaveBeenCalledTimes(2)
  })
  it('an occupied server name is never silently replaced', async () => {
    const f = await live(),
      req = request(f.local.sink.workspaceId)
    req.occupied.push('PLUGIN-CHROME')
    expect(await f.bridge.routes(lease(), req)).toEqual([])
    expect(f.call).not.toHaveBeenCalled()
  })
  it('released incarnations cannot reacquire their capability', async () => {
    const f = await live(),
      owner = lease(),
      req = request(f.local.sink.workspaceId)
    expect(await f.bridge.routes(owner, req)).toHaveLength(1)
    await f.bridge.routes(owner, { ...req, release: true })
    expect(await f.bridge.routes(owner, req)).toEqual([])
  })
  it('person and agent consumers share one projection; closing the person leaves the agent live', async () => {
    const f = await live(),
      req = request(f.local.sink.workspaceId),
      owner = lease()
    const [route] = await f.bridge.routes(owner, req)
    await f.controller.detach(f.person)
    const client = await connected(route!)
    expect((await client.listTools()).tools).toHaveLength(1)
    f.bridge.revoke(owner)
    await expect(client.listTools()).rejects.toThrow()
  })
})
it('workspace sources create fresh incarnations, preserve occupied names and release once', async () => {
  const owner = { agentRoutes: vi.fn(async () => []) }
  const source = new WorkspacePluginAttachments(owner, randomUUID())
  const a = source.agent(['person-server']),
    b = source.agent([])
  await a.read()
  await b.read()
  const aa = owner.agentRoutes.mock.calls as unknown as [Record<string, unknown>][]
  expect(aa[0]![0].incarnation).not.toBe(aa[1]![0].incarnation)
  expect(aa[0]![0].occupied).toEqual(['person-server'])
  await a.close()
  await a.close()
  expect(owner.agentRoutes).toHaveBeenCalledTimes(3)
  await expect(a.read()).rejects.toThrow('Plugin unavailable')
})

describe.skipIf(process.platform === 'win32')('supervisor socket agent admission', () => {
  it('checks the actual lease and workspace before the agent handler; a person command is not an agent command', async () => {
    const { PluginSupervisor } = await import('../src/main/plugins/supervisor/owner')
    const { PluginWorkspaceLease, pluginWorkspaceIdentity } =
      await import('../src/main/plugins/supervisor/client')
    const { Command } = await import('../src/main/plugins/supervisor/protocol')
    const f = await fixture()
    const owner = await PluginSupervisor.start({ root: f.root, workspaceRoots: [f.workspace] })
    const calls = vi.fn(async () => [])
    owner.bindAgentBridge({ routes: calls, revoke: vi.fn() })
    const peer = await PluginWorkspaceLease.attach({
      root: f.root,
      workspaceRoot: f.workspace,
      build: 'fictional-build',
      generation: randomUUID(),
    })
    closes.push(async () => {
      await peer.close()
      await owner.shutdown()
    })
    const input = {
      workspaceId: pluginWorkspaceIdentity(f.workspace),
      incarnation: randomUUID(),
      occupied: ['person-server'],
    }
    expect(await peer.agentRoutes(input)).toEqual([])
    expect(calls).toHaveBeenCalledOnce()
    await expect(peer.agentRoutes({ ...input, workspaceId: randomUUID() })).rejects.toThrow(
      'Plugin unavailable',
    )
    expect(calls).toHaveBeenCalledOnce()
    expect(
      Command.safeParse({
        kind: 'agent-routes',
        ...input,
        workspace: 'a'.repeat(64),
        generation: randomUUID(),
        lease: 'b'.repeat(64),
        release: false,
        action: 'install',
      }).success,
    ).toBe(false)
    await peer.close()
    await expect(peer.agentRoutes(input)).rejects.toThrow('Plugin unavailable')
  })
})
describe.skipIf(process.platform === 'win32')('shared lifecycle consumer reconciliation', () => {
  it('a second consumer clears stale bindings and gets the current projection before attach returns', async () => {
    const f = await live()
    const events: string[] = []
    const second = await f.controller.attach({
      workspaceId: f.local.sink.workspaceId,
      async revoke() {
        events.push('clear')
        return true
      },
      async reconcile(change) {
        events.push(change.receipt ? 'bind' : 'empty')
      },
      async applied() {
        events.push('applied')
      },
    })
    expect(events).toEqual(['clear', 'bind', 'applied'])
    await f.controller.detach(second)
  })
})

describe.skipIf(process.platform === 'win32')('temporary attachment loss', () => {
  it('a recovered logical incarnation gets a fresh capability after its former route was revoked', async () => {
    const f = await live(),
      owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [before] = await f.bridge.routes(owner, req)
    const actual = f.controller.agentAttachments.bind(f.controller)
    const hidden = vi.spyOn(f.controller, 'agentAttachments').mockImplementation(() => [])
    expect(await f.bridge.routes(owner, req)).toEqual([])
    hidden.mockImplementation(actual)
    const [after] = await f.bridge.routes(owner, req)
    expect(after!.capability).not.toBe(before!.capability)
    const client = await connected(after!)
    expect((await client.listTools()).tools).toHaveLength(1)
    hidden.mockRestore()
  })
})

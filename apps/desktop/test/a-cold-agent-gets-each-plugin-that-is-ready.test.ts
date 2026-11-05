import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import type { AgentAttachmentView, AgentScopeEntry } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleWorkspace, WorkspaceProjection } from '../src/main/plugins/lifecycle/types'
import { openManagedPluginRoute } from '../src/main/plugins/managed-transport'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'
import type { Command } from '../src/main/plugins/supervisor/protocol'
import type { PluginMcpClient } from '../src/main/plugins/tool-broker'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

type Request = Extract<Command, { kind: 'agent-routes' }>
const request = (workspaceId = 'fictional-workspace', incarnation = randomUUID()): Request => ({
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
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface PluginState {
  is: 'admitted' | 'pending' | 'off'
  runId: string
  switchRevision: number
  binding?: Promise<PluginMcpClient>
  open?: Promise<void>
}

/** Two plugins with their own committed state, connection and route opening, in one workspace. */
async function aWorkspace(ids: readonly string[], answerWithinMs = 400) {
  const f = await pluginProviderFixture()
  cleanup.push(() => f.close())
  const state = new Map<string, PluginState>(
    ids.map((id) => [id, { is: 'pending', runId: `run-${id}-1`, switchRevision: 0 }]),
  )
  const listeners = new Set<(workspaceId: string) => void>()
  let unreadable = false
  const opened: string[] = []
  const closed: string[] = []
  const view = (workspaceId: string, id: string, one: PluginState): AgentAttachmentView => {
    const { runId, switchRevision } = one
    return {
      installation: { pluginId: id, installId: `code-${id}`, incarnation: 1, configRevision: 1 },
      workspaceId,
      runId,
      exited: new Promise<void>(() => {}),
      connection: Promise.resolve({ client: f.client }),
      current: () => {
        const now = state.get(id)!
        return now.is === 'admitted' && now.runId === runId && now.switchRevision === switchRevision
      },
    } as unknown as AgentAttachmentView
  }
  const controller = {
    agentAttachments: vi.fn((workspaceId: string) =>
      [...state]
        .filter(([, one]) => one.is === 'admitted')
        .map(([id, one]) => view(workspaceId, id, one)),
    ),
    agentScope: vi.fn((workspaceId: string) => {
      if (unreadable) throw new Error('fictional committed state unreadable')
      return {
        workspaceId,
        revision: 0,
        entries: (workspaceId === 'fictional-workspace' ? [...state] : [])
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, one]): AgentScopeEntry => {
            const base = {
              pluginId: id,
              enabled: one.is !== 'off',
              switchRevision: one.switchRevision,
            }
            if (one.is === 'admitted')
              return {
                ...base,
                is: 'admitted',
                installId: `code-${id}`,
                runId: one.runId,
                view: view(workspaceId, id, one),
              }
            if (one.is === 'pending')
              return { ...base, is: 'pending', why: 'starting', installId: null }
            return { ...base, is: 'off', why: 'disabled' }
          }),
      }
    }),
    onHostChanged: vi.fn((listener: (workspaceId: string) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    attach: vi.fn(async (_sink: WorkspaceProjection) => ({}) as LifecycleWorkspace),
    detach: vi.fn(async () => {}),
  }
  const bridge = createLifecycleAgentBridge({
    owner: { valid: () => true },
    controller,
    answerWithinMs,
    binding: async (one) => (await state.get(one.installation.pluginId)!.binding) ?? f.client,
    openRoute: async (broker, scope, current, diagnostic) => {
      await state.get(broker.binding.pluginId)!.open
      const route = await openManagedPluginRoute(broker, scope, current, diagnostic)
      opened.push(broker.binding.pluginId)
      return {
        server: route.server,
        close: () => {
          closed.push(broker.binding.pluginId)
          return route.close()
        },
      }
    },
  })
  cleanup.push(() => bridge.close())
  return {
    bridge,
    state,
    opened,
    closed,
    unreadable(value: boolean) {
      unreadable = value
    },
    /** A committed change for this workspace, told after it is committed. */
    commit(id: string, change: Partial<PluginState>, workspaceId = 'fictional-workspace') {
      Object.assign(state.get(id)!, change)
      for (const listener of listeners) listener(workspaceId)
    },
  }
}

const ids = (servers: readonly { pluginId: string }[]) => servers.map((one) => one.pluginId)

describe('a cold agent gets each plugin that is ready', () => {
  it.each([
    ['aster', 'zinnia'],
    ['zinnia', 'aster'],
  ])(
    'a plugin admitted after the read began is served while %s… connects slowly',
    async (fast, slow) => {
      const w = await aWorkspace([fast, slow])
      const held = deferred<PluginMcpClient>()
      w.state.get(slow)!.binding = held.promise
      const reading = w.bridge.agentRoutes(lease(), request())
      await tick(30)
      w.commit(slow, { is: 'admitted' })
      w.commit(fast, { is: 'admitted' })
      const routes = await reading
      expect(ids(routes.servers)).toEqual([fast])
      expect(routes.pending).toEqual([slow])
      expect(routes.none).toEqual([])
    },
  )

  it('a plugin whose route opening is held after it connected does not hold the other back', async () => {
    const w = await aWorkspace(['aster', 'zinnia'])
    w.state.get('aster')!.open = new Promise<void>(() => {})
    const reading = w.bridge.agentRoutes(lease(), request())
    w.commit('aster', { is: 'admitted' })
    await tick(20)
    w.commit('zinnia', { is: 'admitted' })
    const routes = await reading
    expect(ids(routes.servers)).toEqual(['zinnia'])
    expect(routes.pending).toEqual(['aster'])
  })

  it('one plugin failing fast does not end the read while another is still starting', async () => {
    const w = await aWorkspace(['aster', 'zinnia'])
    const failing = deferred<PluginMcpClient>()
    w.state.get('aster')!.binding = failing.promise
    const reading = w.bridge.agentRoutes(lease(), request())
    w.commit('aster', { is: 'admitted' })
    failing.reject(new Error('fictional bind failure'))
    await tick(40)
    w.commit('zinnia', { is: 'admitted' })
    const routes = await reading
    expect(ids(routes.servers)).toEqual(['zinnia'])
  })

  it('a read in another workspace is not held behind a slow plugin here', async () => {
    const w = await aWorkspace(['aster'], 2_000)
    const held = deferred<void>()
    w.state.get('aster')!.open = held.promise
    w.commit('aster', { is: 'admitted' })
    const reading = w.bridge.agentRoutes(lease(), request('fictional-workspace'))
    await tick(20)
    const started = performance.now()
    const other = await Promise.race([
      w.bridge.agentRoutes(lease(), request('fictional-other-workspace')),
      tick(1_000).then(() => 'held' as const),
    ])
    expect(other).not.toBe('held')
    expect(performance.now() - started).toBeLessThan(500)
    held.resolve()
    await reading
  })

  it('nothing ready within the answer bound is pending, and nothing is denied or closed', async () => {
    const w = await aWorkspace(['aster', 'zinnia'], 150)
    const routes = await w.bridge.agentRoutes(lease(), request())
    expect(routes.servers).toEqual([])
    expect(routes.pending).toEqual(['aster', 'zinnia'])
    expect(routes.unknown).toBe(false)
  })

  it('a committed off is said as none, and a scope that cannot be read is unknown', async () => {
    const w = await aWorkspace(['aster'])
    w.commit('aster', { is: 'off' })
    expect(await w.bridge.agentRoutes(lease(), request())).toMatchObject({
      servers: [],
      pending: [],
      none: ['aster'],
    })
  })

  it('a warmup from before an off and on in the same run is never reused, and its late route closes', async () => {
    const w = await aWorkspace(['aster'], 300)
    const held = deferred<void>()
    w.state.get('aster')!.open = held.promise
    const l = lease()
    const r = request()
    w.commit('aster', { is: 'admitted' })
    const first = await w.bridge.agentRoutes(l, r)
    expect(first.pending).toEqual(['aster'])
    w.state.get('aster')!.open = undefined
    w.commit('aster', { switchRevision: 1 })
    const second = await w.bridge.agentRoutes(l, r)
    expect(ids(second.servers)).toEqual(['aster'])
    held.resolve()
    await tick(30)
    expect(w.closed).toEqual(['aster'])
    const third = await w.bridge.agentRoutes(l, r)
    expect(third.servers).toHaveLength(1)
    expect(third.servers[0]!.url).toBe(second.servers[0]!.url)
  })

  it('a route that completes after its caller is released is closed and never served', async () => {
    const w = await aWorkspace(['aster'], 100)
    const held = deferred<void>()
    w.state.get('aster')!.open = held.promise
    const l = lease()
    const r = request()
    w.commit('aster', { is: 'admitted' })
    await w.bridge.agentRoutes(l, r)
    await w.bridge.agentRoutes(l, { ...r, release: true })
    held.resolve()
    await tick(30)
    expect(w.opened).toEqual(['aster'])
    expect(w.closed).toEqual(['aster'])
    expect((await w.bridge.agentRoutes(l, r)).servers).toEqual([])
  })

  it('a route swept while its plugin was briefly not admitted opens again when it is, with no spin', async () => {
    const w = await aWorkspace(['aster', 'zinnia'], 400)
    const l = lease()
    const r = request()
    w.commit('aster', { is: 'admitted' })
    expect(ids((await w.bridge.agentRoutes(l, r)).servers)).toEqual(['aster'])
    w.commit('aster', { is: 'pending' })
    await w.bridge.agentRoutes(l, r)
    w.commit('aster', { is: 'admitted' })
    const again = await w.bridge.agentRoutes(l, r)
    expect(ids(again.servers)).toEqual(['aster'])
    expect(again.pending).toEqual(['zinnia'])
  })

  it('a warmup cancelled by a new run is not a failure: the new run is served without waiting out the bound', async () => {
    const w = await aWorkspace(['aster'], 2_000)
    const first = deferred<void>()
    const second = deferred<void>()
    w.state.get('aster')!.open = first.promise
    w.commit('aster', { is: 'admitted' })
    const started = performance.now()
    const reading = w.bridge.agentRoutes(lease(), request())
    await tick(30)
    w.state.get('aster')!.open = second.promise
    w.commit('aster', { runId: 'run-aster-2' })
    await tick(20)
    first.resolve()
    await tick(20)
    w.commit('aster', {})
    await tick(20)
    second.resolve()
    const routes = await reading
    expect(ids(routes.servers)).toEqual(['aster'])
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('a scope that cannot be read is unknown and serves only routes still open', async () => {
    const w = await aWorkspace(['aster', 'zinnia'], 200)
    const l = lease()
    const r = request()
    w.commit('aster', { is: 'admitted' })
    await w.bridge.agentRoutes(l, r)
    w.unreadable(true)
    expect(await w.bridge.agentRoutes(l, r)).toMatchObject({
      pending: [],
      none: [],
      unknown: true,
    })
    expect(ids((await w.bridge.agentRoutes(l, r)).servers)).toEqual(['aster'])
  })
})

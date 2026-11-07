import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import type { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
type AgentAttachmentView = ReturnType<PluginLifecycleController['agentAttachments']>[number]
type Binding = Awaited<ReturnType<Parameters<typeof createLifecycleAgentBridge>[0]['binding']>>
import type { LifecycleWorkspace } from '../src/main/plugins/lifecycle/types'
import { openManagedPluginRoute } from '../src/main/plugins/managed-transport'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'
import type { Command } from '../src/main/plugins/supervisor/protocol'
import type { BrokerInput } from '../src/main/plugins/tool-broker'

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
  binding?: Promise<Binding>
  open?: Promise<void>
  close?: Promise<void>
}

/** Two plugins with their own committed state, connection and route opening, in one workspace. */
async function aWorkspace(
  ids: readonly string[],
  answerWithinMs = 400,
  attached: Promise<void> = Promise.resolve(),
  inertRoutes = false,
) {
  const binding: Binding = {
    tools: [
      {
        name: 'echo',
        description: 'Fictional echo',
        inputSchema: { type: 'object' },
        prepare: (input: BrokerInput) => ({ input, resources: [] }),
      },
    ],
    resources: [],
    adminOperations: [],
    isAllowed: () => true,
    server: {
      tool: () => ({
        result: Promise.resolve({
          ok: true as const,
          value: { content: [{ type: 'text', text: 'fern' }] },
        }),
        quiescent: Promise.resolve(),
        cancel() {},
      }),
      admin() {
        throw new Error('person surface stays private')
      },
    },
  }
  const state = new Map<string, PluginState>(
    ids.map((id) => [id, { is: 'pending', runId: `run-${id}-1`, switchRevision: 0 }]),
  )
  const listeners = new Set<(workspaceId: string) => void>()
  let unreadable = false
  const checks: (() => boolean)[] = []
  const opened: string[] = []
  const closed: string[] = []
  const view = (workspaceId: string, id: string, one: PluginState): AgentAttachmentView => {
    const { runId, switchRevision } = one
    return {
      installation: {
        pluginId: id,
        installId: `code-${id}`,
        incarnation: 1,
        configRevision: switchRevision + 1,
      },
      workspaceId,
      runId,
      exited: new Promise<void>(() => {}),
      connection: Promise.resolve({}),
      current: () => {
        const now = state.get(id)!
        return now.is === 'admitted' && now.runId === runId && now.switchRevision === switchRevision
      },
    } as unknown as AgentAttachmentView
  }
  const controller = {
    agentAttachments: vi.fn((workspaceId: string) =>
      (workspaceId === 'fictional-workspace' ? [...state] : [])
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
          .map(([id, one]) => {
            const base = {
              pluginId: id,
              enabled: one.is !== 'off',
              switchRevision: one.switchRevision,
            }
            if (one.is === 'admitted')
              return {
                ...base,
                is: 'admitted' as const,
                installId: `code-${id}`,
                runId: one.runId,
                view: view(workspaceId, id, one),
              }
            if (one.is === 'pending')
              return { ...base, is: 'pending' as const, why: 'starting', installId: null }
            return { ...base, is: 'off' as const, why: 'disabled' }
          }),
      }
    }),
    withAgentScope<T>(
      workspaceId: string,
      decide: (
        scope: ReturnType<PluginLifecycleController['agentScope']>,
        current: (view: AgentAttachmentView) => boolean,
      ) => T extends PromiseLike<unknown> ? never : T,
    ): T {
      return decide(this.agentScope(workspaceId), (view) => view.current())
    },
    onHostChanged: vi.fn((listener: (workspaceId: string) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    attach: vi.fn(async () => {
      await attached
      return {} as LifecycleWorkspace
    }),
    detach: vi.fn(async () => {}),
  }
  const diagnostic = vi.fn()
  const bridge = createLifecycleAgentBridge({
    owner: { valid: () => true },
    controller,
    diagnostic,
    answerWithinMs,
    binding: async (one) => (await state.get(one.installation.pluginId)!.binding) ?? binding,
    openRoute: async (broker, scope, current, diagnostic) => {
      const id = broker.agent.discover(scope)[0]!.namespace.slice('plugin-'.length)
      const route = inertRoutes
        ? {
            server: {
              name: `plugin-${id}`,
              url: 'http://127.0.0.1:1/mcp',
              capability: 'a'.repeat(64),
            },
            close: async () => {},
          }
        : await openManagedPluginRoute(broker, scope, current, diagnostic)
      checks.push(current!)
      await state.get(id)!.open
      opened.push(id)
      return {
        server: route.server,
        close: async () => {
          closed.push(id)
          await state.get(id)!.close
          return route.close()
        },
      }
    },
  })
  cleanup.push(() => bridge.close())
  return {
    bridge,
    diagnostic,
    controller,
    state,
    opened,
    closed,
    checks,
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
  it('pending warmups reserve the existing route capacity until their cleanup completes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const w = await aWorkspace(['aster'], 5, Promise.resolve(), true)
    const binding = deferred<Binding>()
    w.state.get('aster')!.binding = binding.promise
    w.commit('aster', { is: 'admitted' })
    const l = lease(),
      first = request()
    const closing = deferred<void>()
    const read = async (req: Request) => {
      const answer = w.bridge.agentRoutes(l, req)
      await vi.advanceTimersByTimeAsync(5)
      return answer
    }
    try {
      expect((await read(first)).pending).toEqual(['aster'])
      for (let n = 1; n < 1100; n++) expect((await read(request())).pending).toEqual(['aster'])
      expect(
        w.diagnostic.mock.calls.filter(([, reason]) => reason === 'attachment-capacity'),
      ).toHaveLength(76)
      binding.resolve(undefined as unknown as Binding)
      await vi.waitFor(() => expect(w.opened.length).toBe(1024))
      expect((await read(first)).servers).toHaveLength(1)
      w.state.get('aster')!.close = closing.promise
      const releasing = w.bridge.agentRoutes(l, { ...first, release: true })
      await vi.waitFor(() => expect(w.closed).toHaveLength(1))
      expect((await read(request())).pending).toEqual(['aster'])
      expect(w.opened).toHaveLength(1024)
      closing.resolve()
      await releasing
      w.state.get('aster')!.close = undefined
      expect((await read(request())).servers).toHaveLength(1)
      expect(w.opened).toHaveLength(1025)
    } finally {
      binding.resolve(undefined as unknown as Binding)
      closing.resolve()
      vi.useRealTimers()
    }
  })

  it('a requested release retires an opening capability before its earlier read can finish', async () => {
    const w = await aWorkspace(['aster'])
    const held = deferred<void>()
    w.state.get('aster')!.open = held.promise
    w.commit('aster', { is: 'admitted' })
    const l = lease(),
      r = request()
    const reading = w.bridge.agentRoutes(l, r)
    await vi.waitFor(() => expect(w.checks).toHaveLength(1))
    const releasing = w.bridge.agentRoutes(l, { ...r, release: true })
    try {
      expect(w.checks[0]!()).toBe(false)
    } finally {
      held.resolve()
      await releasing
    }
    expect((await reading).servers).toEqual([])
  })
  it('discovery capacity never rejects a release of an already served caller', async () => {
    const w = await aWorkspace(['aster'])
    w.commit('aster', { is: 'admitted' })
    const l = lease(),
      r = request()
    expect((await w.bridge.agentRoutes(l, r)).servers).toHaveLength(1)
    const held = deferred<void>()
    w.controller.attach.mockImplementation(async () => {
      await held.promise
      return {} as LifecycleWorkspace
    })
    const pending = Array.from({ length: 64 }, () => w.bridge.agentRoutes(lease(), request()))
    const releasing = w.bridge.agentRoutes(l, { ...r, release: true })
    try {
      await expect(releasing).resolves.toMatchObject({ servers: [] })
    } finally {
      w.commit('aster', { is: 'off' })
      held.resolve()
      await Promise.allSettled(pending)
    }
  })

  it.each([
    ['aster', 'zinnia'],
    ['zinnia', 'aster'],
  ])('legacy array reader returns %s while %s is still binding', async (fast, slow) => {
    const w = await aWorkspace([fast, slow])
    const held = deferred<Binding>()
    w.state.get(slow)!.binding = held.promise
    w.commit(fast, { is: 'admitted' })
    w.commit(slow, { is: 'admitted' })
    const reading = w.bridge.routes(lease(), request())
    try {
      const answer = await Promise.race([reading, tick(1000).then(() => 'timed-out' as const)])
      expect(answer).not.toBe('timed-out')
      expect(answer).toEqual([expect.objectContaining({ name: `plugin-${fast}` })])
    } finally {
      held.resolve(undefined as unknown as Binding)
      await reading
    }
  })

  it.each([
    ['aster', 'zinnia'],
    ['zinnia', 'aster'],
  ])(
    'a plugin admitted after the read began is served while %s… connects slowly',
    async (fast, slow) => {
      const w = await aWorkspace([fast, slow])
      const held = deferred<Binding>()
      w.state.get(slow)!.binding = held.promise
      const reading = w.bridge.agentRoutes(lease(), request())
      await tick(30)
      w.commit(slow, { is: 'admitted' })
      w.commit(fast, { is: 'admitted' })
      const routes = await reading
      expect(ids(routes.servers)).toEqual([fast])
      expect(routes.pending).toEqual([slow])
      expect(routes.none).toEqual([])
      held.resolve(undefined as unknown as Binding)
    },
  )

  it('a plugin whose route opening is held after it connected does not hold the other back', async () => {
    const w = await aWorkspace(['aster', 'zinnia'])
    const held = deferred<void>()
    w.state.get('aster')!.open = held.promise
    const reading = w.bridge.agentRoutes(lease(), request())
    w.commit('aster', { is: 'admitted' })
    await tick(20)
    w.commit('zinnia', { is: 'admitted' })
    const routes = await reading
    expect(ids(routes.servers)).toEqual(['zinnia'])
    expect(routes.pending).toEqual(['aster'])
    held.resolve()
  })

  it('one plugin failing fast does not end the read while another is still starting', async () => {
    const w = await aWorkspace(['aster', 'zinnia'])
    const failing = deferred<Binding>()
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

  it('an attachment that never settles leaves the scope unknown within the answer bound', async () => {
    const held = deferred<void>()
    const w = await aWorkspace(['aster'], 150, held.promise)
    const started = performance.now()
    const routes = await w.bridge.agentRoutes(lease(), request())
    expect(routes).toMatchObject({ servers: [], pending: [], none: [], unknown: true })
    expect(performance.now() - started).toBeLessThan(1_000)
    held.resolve()
  })

  it('closing a stale route never holds the answer back', async () => {
    const w = await aWorkspace(['aster', 'zinnia'], 300)
    const l = lease()
    const r = request()
    w.commit('aster', { is: 'admitted' })
    w.commit('zinnia', { is: 'admitted' })
    expect(ids((await w.bridge.agentRoutes(l, r)).servers)).toEqual(['aster', 'zinnia'])
    const held = deferred<void>()
    w.state.get('aster')!.close = held.promise
    w.commit('aster', { runId: 'run-aster-2' })
    const started = performance.now()
    const routes = await w.bridge.agentRoutes(l, r)
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(ids(routes.servers)).toContain('zinnia')
    expect(w.closed).toContain('aster')
    held.resolve()
  })

  it('a plugin that failed and then comes back under a new switch revision is served in the same read', async () => {
    const w = await aWorkspace(['aster', 'zinnia'], 2_000)
    const failing = deferred<Binding>()
    w.state.get('zinnia')!.binding = failing.promise
    const started = performance.now()
    const reading = w.bridge.agentRoutes(lease(), request())
    w.commit('zinnia', { is: 'admitted' })
    failing.reject(new Error('fictional bind failure'))
    await tick(30)
    w.state.get('zinnia')!.binding = undefined
    w.commit('zinnia', { switchRevision: 1 })
    const routes = await reading
    expect(ids(routes.servers)).toEqual(['zinnia'])
    expect(routes.pending).toEqual(['aster'])
    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('a release whose cleanup hangs never holds a later read of the same caller past its bound', async () => {
    const w = await aWorkspace(['aster'], 200)
    const l = lease()
    const r = request()
    w.commit('aster', { is: 'admitted' })
    await w.bridge.agentRoutes(l, r)
    const held = deferred<void>()
    w.state.get('aster')!.close = held.promise
    const releasing = w.bridge.agentRoutes(l, { ...r, release: true })
    await tick(20)
    const started = performance.now()
    const readsBefore = w.controller.agentScope.mock.calls.length
    const later = await w.bridge.agentRoutes(l, r)
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(later.servers).toEqual([])
    held.resolve()
    await releasing
    await tick(20)
    expect(w.controller.agentScope).toHaveBeenCalledTimes(readsBefore)
  })

  it('close waits for a route still opening and for its late cleanup', async () => {
    const w = await aWorkspace(['aster'], 100)
    const opening = deferred<void>()
    const cleanup = deferred<void>()
    w.state.get('aster')!.open = opening.promise
    w.state.get('aster')!.close = cleanup.promise
    w.commit('aster', { is: 'admitted' })
    expect((await w.bridge.agentRoutes(lease(), request())).pending).toEqual(['aster'])
    let closed = false
    const closing = w.bridge.close().then(() => {
      closed = true
    })
    await tick(30)
    expect(closed).toBe(false)
    opening.resolve()
    await tick(30)
    expect(w.closed).toEqual(['aster'])
    expect(closed).toBe(false)
    cleanup.resolve()
    await closing
    expect(closed).toBe(true)
  })
})

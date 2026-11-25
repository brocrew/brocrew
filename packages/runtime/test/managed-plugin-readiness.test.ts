import { join } from 'node:path'
import { route, readinessHomes, deferred, ready, tick, Wire } from './fixtures/plugin-readiness'
import { expect, it, vi } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { CodexRuntime } from '../src/codex/codex-runtime'
import { CodexExited } from '../src/codex/codex-transport'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'
import type { RuntimeEvent, SessionHandle } from '../src/index'
import { StoppedBeforeSend, withManagedPluginAttachments } from '../src/managed-plugin-session'
import type {
  ManagedPluginDiscovery,
  ManagedPluginObserver,
} from '../src/managed-plugin-observation'

const { home, handles } = readinessHomes()

async function start(managed = true, observeManagedPlugins?: ManagedPluginObserver) {
  const location = home(),
    wire = new Wire(location)
  const runtime = new CodexRuntime(() => wire)
  const handle = await runtime.start({
    ...location,
    ...(managed ? { managedPluginMcp: [route] } : {}),
    ...(observeManagedPlugins && { observeManagedPlugins }),
  })
  handles.push(handle)
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  return { wire, handle, events }
}
const warnings = (events: RuntimeEvent[]) =>
  events.filter((event) => event.type === 'unknown' && event.label === 'managed-plugin/discovery')

it.each(
  (['start', 'resume'] as const).flatMap((launch) =>
    (
      [
        'healthy',
        'failed',
        'missing',
        'tools-error',
        'refused',
        'observer-throws',
        'failed-observer-throws',
      ] as const
    ).map((discovery) => ({ launch, discovery })),
  ),
)(
  'Codex $launch observes $discovery discovery without changing dispatch',
  async ({ launch, discovery }) => {
    const location = home()
    const wire = new Wire(location)
    const healthy = discovery === 'healthy' || discovery === 'observer-throws'
    wire.catalog = healthy ? ['echo'] : []
    wire.discovery = async () => {
      if (discovery === 'refused') throw new Error('fictional-private-discovery-marker')
      if (discovery === 'missing') return { data: [] }
      if (discovery === 'failed' || discovery === 'failed-observer-throws')
        return { data: [{ name: route.name, runtimeStatus: 'failed' }] }
      if (discovery === 'tools-error')
        return {
          data: [
            {
              name: route.name,
              runtimeStatus: 'connected',
              toolsError: 'fictional-private-discovery-marker',
              tools: {},
            },
          ],
        }
      return ready()
    }
    const observer = vi.fn<(event: ManagedPluginDiscovery) => void>(() => {
      if (discovery === 'observer-throws' || discovery === 'failed-observer-throws')
        throw new Error('fictional-observer-marker')
    })
    const runtime = new CodexRuntime(() => wire)
    const context = { ...location, managedPluginMcp: [route], observeManagedPlugins: observer }
    const handle =
      launch === 'start'
        ? await runtime.start(context)
        : await runtime.resume(
            { provider: 'codex', sessionId: 'fictional-thread', cwd: location.cwd, rotation: 0 },
            context,
          )
    handles.push(handle)
    const events: RuntimeEvent[] = []
    void (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    expect(observer).not.toHaveBeenCalled()
    await handle.send('Fictional observed turn')
    await tick()
    expect(observer.mock.calls).toEqual([
      [
        {
          server: route.name,
          tools: healthy ? ['echo'] : [],
          outcome: healthy ? 'discovered' : 'unavailable',
        },
      ],
    ])
    expect(wire.catalogsAtTurns).toEqual([healthy ? ['echo'] : []])
    expect(warnings(events)).toHaveLength(healthy ? 0 : 1)
    expect(JSON.stringify(observer.mock.calls)).not.toContain('fictional-private-discovery-marker')
    expect(JSON.stringify(observer.mock.calls)).not.toContain(route.capability)
    expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual([
      {
        method: 'mcpServerStatus/list',
        params: {
          threadId: 'fictional-thread',
          serverName: route.name,
          detail: 'toolsAndAuthOnly',
        },
      },
    ])
    const launchRequest = wire.requests.find((one) => one.method === `thread/${launch}`)
    expect(launchRequest).toBeDefined()
    expect(launchRequest!.params).not.toHaveProperty('observeManagedPlugins')
    expect(launchRequest!.params).not.toHaveProperty('config.observeManagedPlugins')
  },
)

it.each(
  (['start', 'resume'] as const).flatMap((launch) =>
    (['connected', 'failed'] as const).flatMap((status) =>
      [false, true].map((throws) => ({ launch, status, throws })),
    ),
  ),
)(
  'Claude $launch observes $status init with throwing observer $throws',
  async ({ launch, status, throws }) => {
    const location = home()
    const frames = new AsyncQueue<SDKMessage>()
    const received: unknown[] = []
    let launchOptions: unknown
    const query: ClaudeQuery = {
      async interrupt() {},
      close() {
        frames.close()
      },
      async return() {
        frames.close()
      },
      [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
    }
    const observer = vi.fn<(event: ManagedPluginDiscovery) => void>(() => {
      if (throws) throw new Error('fictional-observer-marker')
    })
    const runtime = new ClaudeRuntime(
      (params) => {
        launchOptions = params.options
        void (async () => {
          for await (const message of params.prompt) received.push(message)
        })()
        return query
      },
      async () => true,
    )
    const context = { ...location, managedPluginMcp: [route], observeManagedPlugins: observer }
    const handle =
      launch === 'start'
        ? await runtime.start(context)
        : await runtime.resume(
            { provider: 'claude', sessionId: 'fictional-claude', cwd: location.cwd, rotation: 0 },
            context,
          )
    handles.push(handle)
    const events: RuntimeEvent[] = []
    void (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    expect(observer).not.toHaveBeenCalled()
    frames.push({
      type: 'system',
      subtype: 'init',
      session_id: 'fictional-claude',
      cwd: location.cwd,
      tools: [`mcp__${route.name}__echo`, 'mcp__person-server__private-tool', 'Read'],
      mcp_servers: [
        { name: route.name, status },
        { name: 'person-server', status: 'connected' },
      ],
    } as unknown as SDKMessage)
    await tick()
    expect(observer.mock.calls).toEqual([
      [
        {
          server: route.name,
          tools: status === 'connected' ? ['echo'] : [],
          outcome: status === 'connected' ? 'discovered' : 'unavailable',
        },
      ],
    ])
    expect(events.some((event) => event.type === 'tool_inventory')).toBe(true)
    await handle.send('Fictional observed turn')
    await tick()
    expect(received).toHaveLength(1)
    expect(launchOptions).not.toHaveProperty('observeManagedPlugins')
    expect(launchOptions).not.toHaveProperty('managedPluginObserver')
  },
)

it('holds the first model turn until the managed catalog is available, while showing working', async () => {
  const { wire, handle, events } = await start()
  const discovery = deferred<unknown>()
  wire.discovery = () => discovery.promise
  await handle.send('Fictional first turn')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(wire.catalogsAtTurns).toEqual([])
  expect(events.some((event) => event.type === 'status' && event.state === 'working')).toBe(true)
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual([
    {
      method: 'mcpServerStatus/list',
      params: {
        threadId: 'fictional-thread',
        serverName: 'plugin-fern',
        detail: 'toolsAndAuthOnly',
      },
    },
  ])
  wire.catalog = ['echo']
  discovery.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toEqual([['echo']])
  expect(warnings(events)).toEqual([])
})

it('keeps a successful discovery on the fast path for the same thread and server set', async () => {
  const { wire, handle } = await start()
  const saved = handle.ref
  wire.catalog = ['echo']
  await handle.send('Fictional first healthy turn')
  await tick()
  wire.finish()
  await tick()
  expect(await handle.managedPluginHealth!([route])).toEqual([])
  const unexpected = vi.fn(async () => {
    throw new Error('fictional unexpected discovery')
  })
  wire.discovery = unexpected
  await handle.send('Fictional following healthy turn')
  await tick()
  expect(unexpected).not.toHaveBeenCalled()
  expect(wire.catalogsAtTurns).toEqual([['echo'], ['echo']])
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual(
    Array.from({ length: 2 }, () => ({
      method: 'mcpServerStatus/list',
      params: {
        threadId: saved!.sessionId,
        serverName: route.name,
        detail: 'toolsAndAuthOnly',
      },
    })),
  )
  expect(handle.ref).toEqual(saved)
})

it('starts without a dead plugin and records one fixed line without provider error text', async () => {
  const { wire, handle, events } = await start()
  wire.discovery = async () => {
    throw new Error('fictional-private-marker')
  }
  await handle.send('Fictional first turn')
  await tick()
  expect(wire.catalogsAtTurns).toEqual([[]])
  expect(warnings(events)).toHaveLength(1)
  expect(JSON.stringify(warnings(events))).not.toContain('fictional-private-marker')
  expect(JSON.stringify(warnings(events))).not.toContain(route.capability)
  wire.finish()
  await tick()
  await handle.send('Fictional later turn')
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(2)
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toHaveLength(2)
  expect(warnings(events)).toHaveLength(1)
})

it.each(['refused', 'tools-error'] as const)(
  'reobserves a %s first discovery on the same Codex thread before a later turn',
  async (outcome) => {
    const { wire, handle, events } = await start()
    wire.discovery = async () => {
      if (outcome === 'refused') throw new Error('fictional-private-discovery-marker')
      return {
        data: [
          {
            name: route.name,
            runtimeStatus: 'connected',
            toolsError: 'fictional-private-discovery-marker',
            tools: {},
          },
        ],
      }
    }
    const saved = handle.ref
    await handle.send('Fictional ordinary first turn')
    await tick()
    expect(wire.catalogsAtTurns).toEqual([[]])
    expect(warnings(events)).toHaveLength(1)
    expect(JSON.stringify(warnings(events))).not.toContain('fictional-private-discovery-marker')
    wire.finish()
    await tick()
    expect(handle.status()).toBe('idle')

    let reread = false
    const recovered = deferred<unknown>()
    wire.discovery = () => {
      reread = true
      return recovered.promise
    }
    await handle.send('Fictional later turn after discovery recovered')
    await tick()
    expect(reread).toBe(true)
    expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual(
      Array.from({ length: 2 }, () => ({
        method: 'mcpServerStatus/list',
        params: {
          threadId: saved!.sessionId,
          serverName: route.name,
          detail: 'toolsAndAuthOnly',
        },
      })),
    )
    expect(wire.catalogsAtTurns).toEqual([[]])
    expect(handle.ref).toEqual(saved)
    expect(wire.requests.filter((one) => one.method === 'thread/start')).toHaveLength(1)
    expect(wire.requests.some((one) => one.method === 'thread/resume')).toBe(false)

    wire.catalog = ['echo']
    recovered.resolve(ready())
    await tick()
    expect(wire.catalogsAtTurns).toEqual([[], ['echo']])
    expect(warnings(events)).toHaveLength(1)
    expect(handle.ref).toEqual(saved)
  },
)

it.each(['tools-error', 'unknown', 'refused'] as const)(
  'reobserves %s health after a previously ready Codex discovery without replacing the thread',
  async (outcome) => {
    const { wire, handle } = await start()
    const saved = handle.ref
    wire.catalog = ['echo']
    await handle.send('Fictional first healthy turn')
    await tick()
    expect(wire.catalogsAtTurns).toEqual([['echo']])
    wire.finish()
    await tick()
    expect(handle.status()).toBe('idle')

    wire.discovery = async () => {
      if (outcome === 'refused') throw new Error('fictional-private-health-marker')
      if (outcome === 'unknown') return { data: [] }
      return {
        data: [
          {
            name: route.name,
            runtimeStatus: 'connected',
            toolsError: 'fictional-private-health-marker',
            tools: {},
          },
        ],
      }
    }
    // Unknown permits a fresh observation, never a provider replacement or a broker reset.
    expect(await handle.managedPluginHealth!([route])).toBeUndefined()
    const recovered = deferred<unknown>()
    wire.discovery = () => recovered.promise
    await handle.send('Fictional later turn after an unknown health reading')
    await tick()
    expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual(
      Array.from({ length: 3 }, () => ({
        method: 'mcpServerStatus/list',
        params: {
          threadId: saved!.sessionId,
          serverName: route.name,
          detail: 'toolsAndAuthOnly',
        },
      })),
    )
    expect(wire.catalogsAtTurns).toEqual([['echo']])
    expect(wire.requests.filter((one) => one.method === 'thread/start')).toHaveLength(1)
    expect(wire.requests.some((one) => one.method === 'thread/resume')).toBe(false)
    expect(handle.ref).toEqual(saved)
    recovered.resolve(ready())
    await tick()
    expect(wire.catalogsAtTurns).toEqual([['echo'], ['echo']])
  },
)

it('a late healthy reading cannot relatch readiness after a newer turn was cancelled', async () => {
  const { wire, handle } = await start()
  const saved = handle.ref
  wire.catalog = ['echo']
  await handle.send('Fictional first healthy turn')
  await tick()
  wire.finish()
  await tick()

  const healthReply = deferred<unknown>()
  wire.discovery = () => healthReply.promise
  const health = handle.managedPluginHealth!([route])
  await tick()
  const newerReply = deferred<unknown>()
  wire.discovery = () => newerReply.promise
  await handle.send('Fictional next turn while health is unread')
  await tick()
  expect(wire.catalogsAtTurns).toEqual([['echo']])
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toHaveLength(3)
  await handle.interrupt()
  await tick()
  expect(handle.status()).toBe('idle')

  // Both answers are now obsolete. Neither may confirm readiness or dispatch words.
  healthReply.resolve(ready())
  expect(await health).toEqual([])
  newerReply.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toEqual([['echo']])

  const currentReply = deferred<unknown>()
  wire.discovery = () => currentReply.promise
  await handle.send('Fictional replacement after cancellation')
  await tick()
  expect(wire.catalogsAtTurns).toEqual([['echo']])
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual(
    Array.from({ length: 4 }, () => ({
      method: 'mcpServerStatus/list',
      params: {
        threadId: saved!.sessionId,
        serverName: route.name,
        detail: 'toolsAndAuthOnly',
      },
    })),
  )
  currentReply.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toEqual([['echo'], ['echo']])
  expect(handle.ref).toEqual(saved)
  expect(wire.requests.filter((one) => one.method === 'thread/start')).toHaveLength(1)
  expect(wire.requests.some((one) => one.method === 'thread/resume')).toBe(false)
})

it('an older healthy reply cannot replace a newer unknown reading before the next turn', async () => {
  const { wire, handle } = await start()
  const saved = handle.ref
  wire.catalog = ['echo']
  await handle.send('Fictional first healthy turn')
  await tick()
  wire.finish()
  await tick()

  const olderReply = deferred<unknown>()
  wire.discovery = () => olderReply.promise
  const older = handle.managedPluginHealth!([route])
  await tick()
  wire.discovery = async () => ({ data: [] })
  expect(await handle.managedPluginHealth!([route])).toBeUndefined()
  // No turn separates these reads. The older reply must not supersede the newer UNKNOWN.
  expect(wire.catalogsAtTurns).toEqual([['echo']])
  olderReply.resolve(ready())
  expect(await older).toEqual([])
  expect(handle.status()).toBe('idle')
  expect(wire.catalogsAtTurns).toEqual([['echo']])

  const currentReply = deferred<unknown>()
  wire.discovery = () => currentReply.promise
  await handle.send('Fictional next turn after overlapping health reads')
  await tick()
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual(
    Array.from({ length: 4 }, () => ({
      method: 'mcpServerStatus/list',
      params: {
        threadId: saved!.sessionId,
        serverName: route.name,
        detail: 'toolsAndAuthOnly',
      },
    })),
  )
  expect(wire.catalogsAtTurns).toEqual([['echo']])
  expect(handle.ref).toEqual(saved)
  expect(wire.requests.filter((one) => one.method === 'thread/start')).toHaveLength(1)
  expect(wire.requests.some((one) => one.method === 'thread/resume')).toBe(false)
  currentReply.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toEqual([['echo'], ['echo']])
})

it.each(['held', 'rejected'] as const)(
  'settles a %s discovery when the transport ends',
  async (reply) => {
    const observer = vi.fn<ManagedPluginObserver>()
    const { wire, handle, events } = await start(true, observer)
    const discovery = deferred<unknown>()
    let rejectRequest!: (error: Error) => void
    wire.discovery = () =>
      reply === 'held'
        ? discovery.promise
        : new Promise((_, reject) => {
            rejectRequest = reject
          })
    await handle.send('Fictional first turn')
    await vi.advanceTimersByTimeAsync(12_000)
    expect(wire.catalogsAtTurns).toEqual([])
    const exit = new CodexExited('fictional exit')
    if (reply === 'rejected') {
      // On exit, native transport first rejects the RPC, then closes its incoming queue.
      rejectRequest(exit)
      wire.queue.push({ kind: 'notification', method: 'account/updated', params: {} })
    }
    wire.close(exit)
    await tick()
    expect(handle.status()).toBe('errored')
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      server: route.name,
      tools: [],
      outcome: 'cancelled',
    })
    discovery.resolve(ready())
    await tick()
    expect(wire.catalogsAtTurns).toEqual([])
    expect(observer).toHaveBeenCalledOnce()
    expect(warnings(events)).toEqual([])
  },
)

it('keeps a starting plugin ahead of the first turn past ten seconds', async () => {
  const { wire, handle, events } = await start()
  wire.discovery = async () =>
    wire.catalog.length ? ready() : { data: [{ name: route.name, runtimeStatus: 'starting' }] }
  await handle.send('Fictional first turn')
  await vi.advanceTimersByTimeAsync(12_000)
  expect(wire.catalogsAtTurns).toEqual([])
  expect(warnings(events)).toEqual([])
  wire.catalog = ['echo']
  await vi.advanceTimersByTimeAsync(50)
  expect(wire.catalogsAtTurns).toEqual([['echo']])
})

it.each(['failed', 'authenticationRequired', 'disabled', 'cancelled'])(
  'a terminal %s discovery does not prevent a turn',
  async (runtimeStatus) => {
    const { wire, handle, events } = await start()
    wire.discovery = async () => ({
      data: [{ name: route.name, runtimeStatus, toolsError: 'fictional-private-marker' }],
    })
    await handle.send('Fictional first turn')
    await tick()
    expect(wire.catalogsAtTurns).toEqual([[]])
    expect(warnings(events)).toHaveLength(1)
    expect(JSON.stringify(warnings(events))).not.toContain('fictional-private-marker')
  },
)

it('stops an undispatched turn after ten seconds and a late catalog cannot send it', async () => {
  const { wire, handle, events } = await start()
  const discovery = deferred<unknown>()
  wire.discovery = () => discovery.promise
  await handle.send('Fictional first turn')
  await vi.advanceTimersByTimeAsync(12_000)
  expect(wire.catalogsAtTurns).toEqual([])
  await handle.interrupt()
  await tick()
  expect(
    events.filter((event) => event.type === 'turn' && event.state === 'interrupted'),
  ).toHaveLength(1)
  discovery.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toEqual([])
  expect(warnings(events)).toEqual([])
  const replacement = deferred<unknown>()
  wire.discovery = () => replacement.promise
  await handle.send('Fictional replacement turn')
  await tick()
  expect(wire.catalogsAtTurns).toEqual([])
  expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual(
    Array.from({ length: 2 }, () => ({
      method: 'mcpServerStatus/list',
      params: {
        threadId: handle.ref!.sessionId,
        serverName: route.name,
        detail: 'toolsAndAuthOnly',
      },
    })),
  )
  replacement.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toHaveLength(1)
})

it('closing during discovery prevents a late turn from being sent', async () => {
  const { wire, handle } = await start()
  const discovery = deferred<unknown>()
  wire.discovery = () => discovery.promise
  await handle.send('Fictional first turn')
  await handle.close()
  discovery.resolve(ready())
  await tick()
  expect(wire.catalogsAtTurns).toEqual([])
})

it('does not query or wait for unmanaged Codex sessions', async () => {
  const { wire, handle } = await start(false)
  await handle.send('Fictional first turn')
  expect(wire.catalogsAtTurns).toEqual([[]])
  expect(wire.requests.some((one) => one.method === 'mcpServerStatus/list')).toBe(false)
})

it('Claude still delivers its first prompt immediately with its authenticated managed route', async () => {
  const location = home(),
    frames = new AsyncQueue<SDKMessage>()
  const received: unknown[] = []
  let options: unknown
  const query: ClaudeQuery = {
    async interrupt() {},
    close() {
      frames.close()
    },
    async return() {
      frames.close()
    },
    [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
  }
  const runtime = new ClaudeRuntime(
    (params) => {
      options = params.options.mcpServers
      void (async () => {
        for await (const message of params.prompt) received.push(message)
      })()
      return query
    },
    async () => true,
  )
  const handle = await runtime.start({ ...location, managedPluginMcp: [route] })
  handles.push(handle)
  frames.push({
    type: 'system',
    subtype: 'init',
    session_id: 'fictional-claude',
    cwd: location.cwd,
  } as unknown as SDKMessage)
  await tick()
  await handle.send('Fictional first turn')
  await tick()
  expect(received).toHaveLength(1)
  expect(options).toEqual({
    'plugin-fern': {
      type: 'http',
      url: route.url,
      headers: { Authorization: `Bearer ${route.capability}` },
    },
  })
})

it.each(['Stop', 'Close'] as const)(
  '%s settles a managed reopen while skills preparation is held',
  async (end) => {
    const location = home()
    const wires: Wire[] = []
    let revision = 'initial'
    const runtime = withManagedPluginAttachments(
      new CodexRuntime(() => {
        const wire = new Wire(location)
        const request = wire.request.bind(wire)
        wire.request = async (method, params) =>
          method === 'skills/list'
            ? { data: [{ cwd: location.cwd, skills: [], errors: [] }] }
            : request(method, params)
        wires.push(wire)
        return wire
      }),
      {
        read: async () => ({ revision, servers: revision === 'initial' ? [route] : [] }),
        close: async () => {},
      },
    )
    const preparation = deferred<void>()
    const preparing = deferred<void>()
    const beforeSkillDiscovery = vi.fn(async () => {}).mockImplementationOnce(async () => {})
    beforeSkillDiscovery.mockImplementationOnce(() => {
      preparing.resolve()
      return preparation.promise
    })
    const handle = await runtime.start({
      ...location,
      builtInSkills: { root: join(location.cwd, 'built-in'), skills: [] },
      sharedSkillsRoot: join(location.cwd, 'shared'),
      beforeSkillDiscovery,
    })
    revision = 'changed'
    const rejected = vi.fn()
    const sending = handle.send('fictional cancelled message').catch(rejected)
    await preparing.promise
    const stopping = end === 'Close' ? handle.close() : handle.interrupt()
    try {
      await tick()
      expect(rejected.mock.calls[0]?.[0]).toBeInstanceOf(StoppedBeforeSend)
      await stopping
      expect(wires[1]!.requests.some((one) => one.method === 'thread/resume')).toBe(false)
      expect(wires.flatMap((wire) => wire.catalogsAtTurns)).toEqual([])
      if (end === 'Stop') expect(handle.status()).toBe('idle')
    } finally {
      preparation.resolve()
      await sending
      await stopping
      await handle.close()
    }
  },
)

it.each([false, true])(
  'recovers Codex before the next tool call, preserving its thread (route changed %s)',
  async (changed) => {
    const location = home(),
      wires: Wire[] = []
    let currentRoute = route
    const runtime = withManagedPluginAttachments(
      new CodexRuntime(() => {
        const wire = new Wire(location)
        // A fake process owns a real completion promise, settled only by close.
        let exit!: () => void
        Object.assign(wire, {
          quiesced: new Promise<void>((resolve) => {
            exit = resolve
          }),
        })
        const close = wire.close.bind(wire)
        wire.close = () => {
          close()
          exit()
        }
        wire.catalog = ['echo']
        wires.push(wire)
        return wire
      }),
      {
        read: async () => ({ revision: 'unchanged', servers: [currentRoute] }),
        close: async () => {},
      },
    )
    const handle = await runtime.start(location)
    handles.push(handle)
    const saved = handle.ref
    await handle.send('fictional initial tool call')
    await tick()
    expect(wires[0]!.catalogsAtTurns).toEqual([['echo']])
    wires[0]!.finish()
    await tick()
    wires[0]!.catalog = []
    wires[0]!.discovery = async () => ({ data: [{ name: route.name, runtimeStatus: 'failed' }] })
    if (changed)
      currentRoute = { ...route, url: 'http://127.0.0.1:8124/mcp', capability: 'b'.repeat(64) }
    await handle.send('fictional recovered tool call')
    await tick()
    expect(wires).toHaveLength(2)
    expect(handle.ref).toEqual(saved)
    expect(wires[0]!.catalogsAtTurns).toHaveLength(1)
    expect(wires[1]!.catalogsAtTurns).toEqual([['echo']])
    expect(wires[1]!.requests.find((one) => one.method === 'thread/resume')).toMatchObject({
      params: {
        threadId: saved!.sessionId,
        config: {
          mcp_servers: {
            [route.name]: {
              url: currentRoute.url,
              http_headers: { Authorization: `Bearer ${currentRoute.capability}` },
            },
          },
        },
      },
    })
    wires[1]!.finish()
    await tick()
    await handle.send('fictional healthy following call')
    await tick()
    expect(wires).toHaveLength(2)
    expect(wires[1]!.catalogsAtTurns).toEqual([['echo'], ['echo']])
  },
)

it.each([
  ['failed', [route.name]],
  ['connected', []],
  ['starting', undefined],
  ['notStarted', undefined],
  ['authenticationRequired', undefined],
  ['disabled', undefined],
  ['cancelled', undefined],
  [null, undefined],
  ['invented-status', undefined],
] as const)(
  'Codex public attachment health treats %s conservatively',
  async (runtimeStatus, expected) => {
    const { wire, handle } = await start()
    wire.discovery = async () => ({
      data: [{ name: route.name, runtimeStatus, tools: {}, toolsError: null }],
    })
    const health = (
      handle as SessionHandle & {
        managedPluginHealth(
          servers: readonly (typeof route)[],
        ): Promise<readonly string[] | undefined>
      }
    ).managedPluginHealth
    expect(typeof health).toBe('function')
    expect(await health.call(handle, [route])).toEqual(expected)
    expect(wire.requests.filter((one) => one.method === 'mcpServerStatus/list')).toEqual([
      {
        method: 'mcpServerStatus/list',
        params: {
          threadId: 'fictional-thread',
          serverName: route.name,
          detail: 'toolsAndAuthOnly',
        },
      },
    ])
  },
)
it('an unscoped or missing Codex status row cannot authorize a recovery', async () => {
  const { wire, handle } = await start()
  wire.discovery = async () => ({ data: [{ name: 'person-server', runtimeStatus: 'failed' }] })
  const health = (
    handle as SessionHandle & {
      managedPluginHealth(
        servers: readonly (typeof route)[],
      ): Promise<readonly string[] | undefined>
    }
  ).managedPluginHealth
  expect(typeof health).toBe('function')
  expect(await health.call(handle, [route])).toBeUndefined()
})

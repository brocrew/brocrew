import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import { fixture, cleanupLifecycleFixtures, deferred } from './plugin-lifecycle-fixtures'
import { echoBinding } from './helpers/plugin-echo-binding'
import {
  withManagedPluginAttachments,
  type ManagedPluginMcpServer,
  type SessionHandle,
} from '@brobot2/runtime'
import { FakeRuntime } from '@brobot2/runtime/testing'

import {
  closes,
  connected,
  live,
  request,
  lease,
  recoveringLive,
} from './helpers/plugin-agent-bridge'
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function holdToolCall(
  f: Awaited<ReturnType<typeof live>>,
  quiescent: Promise<void> = new Promise(() => {}),
  result: Promise<never> = new Promise(() => {}),
  firstOnly = false,
) {
  const original = await f.binding()
  let held = false
  f.binding.mockResolvedValueOnce({
    ...original,
    server: {
      ...original.server,
      tool() {
        if (firstOnly && held) return original.server.tool()
        held = true
        f.call()
        return { result, quiescent, cancel() {} }
      },
    },
  })
}
/** A server that breaks its contract at dispatch leaves the broker unavailable with the call unproven. */
async function breakToolCall(f: Awaited<ReturnType<typeof live>>) {
  const original = await f.binding()
  f.binding.mockResolvedValueOnce({
    ...original,
    server: {
      ...original.server,
      tool() {
        f.call()
        throw new Error('fictional broken execution')
      },
    },
  })
}
describe.skipIf(process.platform === 'win32')('live lifecycle agent bridge, inert server', () => {
  it('keeps routes and the host after a tool fails without completion proof', async () => {
    const recover = vi.fn(async () => {})
    const f = await live({ restartHost: recover })
    const original = await f.binding()
    const result = deferred<never>(),
      quiet = deferred<void>()
    let first = true
    f.binding.mockResolvedValueOnce({
      ...original,
      server: Object.assign({}, original.server, {
        tool() {
          if (!first) return original.server.tool()
          first = false
          f.call()
          return { result: result.promise, quiescent: quiet.promise, cancel() {} }
        },
      }),
    })
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [before] = await f.bridge.routes(owner, req)
    const starts = f.starts()
    const client = await connected(before!)
    const pending = client.callTool({ name: 'echo', arguments: {} })
    await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
    quiet.reject(new Error('unknown remote completion'))
    result.reject(new Error('stalled call'))
    expect(await pending).toMatchObject({ isError: true })
    expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
      content: [{ text: 'fictional fern' }],
    })
    const [after] = await f.bridge.routes(owner, req)
    expect(after).toEqual(before)
    expect(f.starts()).toBe(starts)
    expect(recover).not.toHaveBeenCalled()
    expect(f.diagnostic).not.toHaveBeenCalledWith('chrome', 'recovery-host-started')
  })
  it.each(['idle', 'active'] as const)(
    'recovers after a positive unexpected exact-host exit with an %s broker',
    async (mode) => {
      const exited = deferred<void>()

      const f = await live({
        firstExit: exited.promise,
        restartHost: (id, runId, stopped) => f.controller.restartPluginTools(id, runId, stopped),
      })
      if (mode === 'active') {
        await holdToolCall(f)
      }
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      const [before] = await f.bridge.routes(owner, req)
      const client = await connected(before!)
      let pending: Promise<unknown> | undefined
      try {
        if (mode === 'active') {
          pending = client.callTool({ name: 'echo', arguments: {} }, undefined, { timeout: 1500 })
          void pending.catch(() => {})
          await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
        }
        exited.resolve()
        await vi.waitFor(() => expect(f.starts()).toBe(2))
        if (pending) expect(await pending).toMatchObject({ isError: true })
        const [after] = await f.bridge.routes(owner, req)
        expect(after!.capability).not.toBe(before!.capability)
        expect(
          await (await connected(after!)).callTool({ name: 'echo', arguments: {} }),
        ).toMatchObject({ content: [{ text: 'fictional fern' }] })
        expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
      } finally {
        exited.resolve()
      }
    },
  )
  it('resumes only after late positive exact-host proof following the real stop timeout', async () => {
    const exited = deferred<void>(),
      stopping = deferred<void>()

    const f = await live({
      firstExit: exited.promise,
      firstStop: () => stopping.promise,
      restartHost: (id, runId, stopped) => f.controller.restartPluginTools(id, runId, stopped),
    })
    await breakToolCall(f)
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [before] = await f.bridge.routes(owner, req)
    const client = await connected(before!)
    try {
      const pending = client.callTool({ name: 'echo', arguments: {} }, undefined, { timeout: 1500 })
      await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
      expect(await pending).toMatchObject({ isError: true })
      await vi.waitFor(
        () => expect(f.diagnostic).toHaveBeenCalledWith('chrome', 'recovery-host-unproven'),
        { timeout: 22000 },
      )
      expect(f.starts()).toBe(1)
      expect(await f.bridge.routes(owner, req)).toEqual([])
      exited.resolve()
      await vi.waitFor(() => expect(f.starts()).toBe(2))
      const [after] = await f.bridge.routes(owner, req)
      expect(after!.capability).not.toBe(before!.capability)
      expect(
        await (await connected(after!)).callTool({ name: 'echo', arguments: {} }),
      ).toMatchObject({ content: [{ text: 'fictional fern' }] })
    } finally {
      exited.resolve()
      stopping.resolve()
    }
  })
  it('lets the person retry an unexpected-exit block but never recreates on a failed physical proof', async () => {
    let rejectExit!: (error: Error) => void
    const exited = new Promise<void>((_resolve, reject) => {
      rejectExit = reject
    })

    const f = await live({
      firstExit: exited,
      restartHost: (id, runId, stopped) => f.controller.restartPluginTools(id, runId, stopped),
    })
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    await f.bridge.routes(owner, req)
    rejectExit(new Error('fictional unproved physical exit'))
    await vi.waitFor(async () =>
      expect((await f.controller.status()).cards[0]?.state).toBe('Unavailable'),
    )
    f.failStop()
    await expect(f.bridge.restartPlugin('chrome')).rejects.toThrow()
    expect(f.starts()).toBe(1)
    expect(f.events.filter((event) => event === 'stop')).toHaveLength(1)
    f.failStop(false)
    await f.bridge.restartPlugin('chrome')
    expect(f.starts()).toBe(2)
    const [after] = await f.bridge.routes(owner, req)
    expect(await (await connected(after!)).callTool({ name: 'echo', arguments: {} })).toMatchObject(
      { content: [{ text: 'fictional fern' }] },
    )
  })
  it('treats duplicate exact-run wakeups as non-authorizing until the retained exit witness resolves', async () => {
    const exited = deferred<void>()
    const f = await live({
      firstExit: exited.promise,
      restartHost: (id, runId, stopped) => f.controller.restartPluginTools(id, runId, stopped),
    })
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [before] = await f.bridge.routes(owner, req)
    const old = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
    f.bridge.hostExited('chrome', randomUUID())
    for (let i = 0; i < 5; i++) f.bridge.hostExited('chrome', old.runId)
    await Promise.resolve()
    expect(f.starts()).toBe(1)
    expect(f.events).not.toContain('stop')
    expect((await f.bridge.routes(owner, req))[0]!.capability).toBe(before!.capability)
    expect(
      await (await connected(before!)).callTool({ name: 'echo', arguments: {} }),
    ).toMatchObject({ content: [{ text: 'fictional fern' }] })
    exited.resolve()
    await vi.waitFor(() => expect(f.starts()).toBe(2))
    for (let i = 0; i < 5; i++) f.bridge.hostExited('chrome', old.runId)
    const [after] = await f.bridge.routes(owner, req)
    expect(after!.capability).not.toBe(before!.capability)
    expect(await (await connected(after!)).callTool({ name: 'echo', arguments: {} })).toMatchObject(
      { content: [{ text: 'fictional fern' }] },
    )
    expect(f.starts()).toBe(2)
  })
  it.each(['uninstall', 'drain'] as const)(
    'a late exact exit never reverses %s',
    async (action) => {
      const exited = deferred<void>()
      const f = await recoveringLive(exited.promise)
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      await f.bridge.routes(owner, req)
      const old = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
      let draining: Promise<void> | undefined
      if (action === 'uninstall') await f.controller.uninstall(f.person, 'chrome')
      else draining = f.controller.drain()
      exited.resolve()
      await draining
      f.bridge.hostExited('chrome', old.runId)
      // Neither a wakeup nor a direct trusted request can restore an installation or drain.
      await expect(f.controller.restartPluginTools('chrome', old.runId, vi.fn())).rejects.toThrow()
      expect(f.starts()).toBe(1)
      expect(await f.bridge.routes(owner, req)).toEqual([])
      // An already coalesced broker retirement may settle, but cannot start another host.
      await f.bridge.restartPlugin('chrome').catch(() => undefined)
      expect(f.starts()).toBe(1)
    },
  )
  it.each(['claude', 'codex'] as const)(
    '%s keeps its conversation identity and calls the real replacement route on its next sent turn',
    async (provider) => {
      const f = await live({
        restartHost: (id, runId, stopped) => f.controller.restartPluginTools(id, runId, stopped),
      })
      await breakToolCall(f)
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      const raw = new FakeRuntime(provider)
      const replies: unknown[] = []
      const configs: ManagedPluginMcpServer[][] = []
      const refresh = vi.fn()
      function instrument<T extends SessionHandle>(
        handle: T,
        initial: readonly ManagedPluginMcpServer[],
      ): T {
        let servers = initial
        configs.push([...servers])
        // This fake provider owns no process; real MCP calls below still cross the host broker.
        Object.defineProperty(handle, 'awaitProcessExit', { value: () => Promise.resolve() })
        if (provider === 'claude')
          Object.defineProperty(handle, 'refreshManagedPlugins', {
            value: async (next: readonly ManagedPluginMcpServer[]) => {
              refresh()
              servers = next
              configs.push([...servers])
            },
          })
        const session: SessionHandle = handle
        vi.spyOn(session, 'send').mockImplementation(async () => {
          const client = await connected(servers[0]!)
          replies.push(
            await client.callTool({ name: 'echo', arguments: {} }, undefined, { timeout: 1500 }),
          )
        })
        return handle
      }
      const start = raw.start.bind(raw),
        resume = raw.resume.bind(raw)
      const started = vi
        .spyOn(raw, 'start')
        .mockImplementation(async (options) =>
          instrument(await start(options), options.managedPluginMcp ?? []),
        )
      const resumed = vi
        .spyOn(raw, 'resume')
        .mockImplementation(async (ref, options) =>
          instrument(await resume(ref, options), options.managedPluginMcp ?? []),
        )
      const runtime = withManagedPluginAttachments(raw, {
        async read() {
          const servers = await f.bridge.routes(owner, req)
          return { revision: String(f.starts()), servers }
        },
        async close() {
          await f.bridge.routes(owner, { ...req, release: true })
        },
      })
      const conversation = await runtime.start({ cwd: process.cwd(), providerHome: f.root })
      closes.push(() => conversation.close())
      const identity = conversation.ref
      expect(identity).not.toBeNull()
      const first = conversation.send('fictional first turn')
      await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
      await first
      expect(replies[0]).toMatchObject({ isError: true })
      await vi.waitFor(() => expect(f.starts()).toBe(2))
      await conversation.send('fictional next turn')
      expect(replies[1]).toMatchObject({ content: [{ text: 'fictional fern' }] })
      expect(conversation.ref).toEqual(identity)
      expect(started).toHaveBeenCalledOnce()
      expect(configs).toHaveLength(2)
      expect(configs[1]![0]!.capability).not.toBe(configs[0]![0]!.capability)
      if (provider === 'codex') {
        expect(resumed).toHaveBeenCalledOnce()
        expect(resumed.mock.calls[0]![0]).toEqual(identity)
      } else {
        expect(resumed).not.toHaveBeenCalled()
        expect(refresh).toHaveBeenCalledOnce()
      }
      expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
    },
  )
  it('records binding failure once with its stage, cause and real error message', async () => {
    const f = await live()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    f.binding.mockRejectedValueOnce(new Error('fictional-private-downstream-name'))
    try {
      expect(await f.bridge.routes(lease(), request(f.local.sink.workspaceId))).toEqual([])
      expect(log.mock.calls).toEqual([['Some plugin tools were refused.']])
      const failures = f.diagnostic.mock.calls.filter(([, reason]) =>
        ['binding-failed', 'route-open-failed'].includes(reason),
      )
      expect(failures).toHaveLength(2)
      expect(failures[0]![2]).toMatchObject({
        stage: 'binding-connection',
        cause: 'unknown',
        correlation: expect.stringMatching(/^[a-f0-9-]{36}$/),
        reason: 'fictional-private-downstream-name',
      })
      expect(failures[1]![2]).toEqual(failures[0]![2])
      // The same fixed stage and cause reach the card, and from there the agent's launch line.
      expect(f.bridge.toolsCause(failures[0]![0])).toBe('binding-connection: unknown')
    } finally {
      log.mockRestore()
    }
  })
  it('uninstall during a call that is still being cancelled completes, and the call ends with a plain refusal', async () => {
    const f = await live()
    await holdToolCall(f)
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [route] = await f.bridge.routes(owner, req)
    const client = await connected(route!)
    const pending = client.callTool({ name: 'echo', arguments: {} }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
    // The bridge is still winding that call down; its revoke answer is a notice, not a gate.
    await f.controller.uninstall(f.person, 'chrome')
    expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
    const outcome = await pending
    // Never a success, never a hang: either a refused call or an error result.
    if ('value' in outcome) expect(outcome.value).toMatchObject({ isError: true })
    else expect(outcome.error).toBeInstanceOf(Error)
    expect(await f.bridge.routes(owner, request(f.local.sink.workspaceId))).toEqual([])
  })
  it('reports an unavailable broker on the Running card, withholds dead routes and never overlaps unproven work', async () => {
    const f = await live()
    await breakToolCall(f)
    const close = closes.pop()!
    try {
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      const [route] = await f.bridge.routes(owner, req)
      const client = await connected(route!)
      const pending = client.callTool({
        name: 'echo',
        arguments: { private: 'fictional-private-input' },
      })
      await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
      expect(await pending).toMatchObject({ isError: true })
      expect((await f.controller.status()).cards[0]).toMatchObject({
        state: 'Running',
        toolsUnavailable: true,
      })
      expect(await f.bridge.routes(owner, req)).toEqual([])
      expect(await f.bridge.routes(owner, request(f.local.sink.workspaceId))).toEqual([])
      // A new lease gets no route either while the old work is not proven quiet.
      expect(await f.bridge.routes(lease(), request(f.local.sink.workspaceId))).toEqual([])
      expect(f.binding).toHaveBeenCalledTimes(2) // One fixture lookup, one broker. No replacement.
      expect(f.call).toHaveBeenCalledOnce()
    } finally {
      // Detach closes this consumer; it makes no claim about the host's exit.
      await expect(close()).resolves.toBeUndefined()
    }
  })
  it('retains both caller routes after a call of unknown completion and its late positive completion', async () => {
    const f = await live()
    let prove!: () => void
    const quiet = new Promise<void>((resolve) => {
      prove = resolve
    })
    const stalled = Promise.reject<never>(new Error('fictional stalled call'))
    void stalled.catch(() => undefined)
    await holdToolCall(f, quiet, stalled, true)
    const owner = lease(),
      first = request(f.local.sink.workspaceId),
      second = request(f.local.sink.workspaceId)
    const [beforeFirst] = await f.bridge.routes(owner, first)
    const [beforeSecond] = await f.bridge.routes(owner, second)
    const client = await connected(beforeFirst!)
    const pending = client.callTool({ name: 'echo', arguments: {} })
    await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
    expect(await pending).toMatchObject({ isError: true })
    expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
    expect(await f.bridge.routes(owner, first)).toEqual([beforeFirst])
    expect(await f.bridge.routes(owner, second)).toEqual([beforeSecond])
    expect(f.binding).toHaveBeenCalledTimes(2)
    prove()
    await new Promise((resolve) => setImmediate(resolve))
    const freshFirst = await f.bridge.routes(owner, first)
    expect(freshFirst).toHaveLength(1)
    const freshSecond = await f.bridge.routes(owner, second)
    expect(freshSecond).toHaveLength(1)
    expect(freshFirst[0]!.capability).toBe(beforeFirst!.capability)
    expect(freshSecond[0]!.capability).toBe(beforeSecond!.capability)
    for (const route of [freshFirst[0]!, freshSecond[0]!]) {
      const liveClient = await connected(route)
      expect(await liveClient.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ text: 'fictional fern' }],
      })
    }
    expect(f.binding).toHaveBeenCalledTimes(2)
    expect(f.call).toHaveBeenCalledTimes(3)
    expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
  })
  it('automatically restarts only the exact Chrome host, bounds attempts, and keeps failed exit negative', async () => {
    let now = 0

    const f = await live({
      now: () => now,
      restartHost: (id, runId, stopped) => f.controller.restartPluginTools(id, runId, stopped),
    })
    const bridgeClose = closes.pop()!
    try {
      const original = await f.binding()
      f.binding.mockImplementation(async () => ({
        ...original,
        server: {
          ...original.server,
          tool() {
            f.call()
            throw new Error('fictional private failure')
          },
        },
      }))
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      for (let attempt = 1; attempt <= 4; attempt++) {
        let route: ManagedPluginMcpServer | undefined
        await vi.waitFor(async () => {
          const current = await f.bridge.routes(owner, req)
          expect(current).toHaveLength(1)
          route = current[0]
        })
        const client = await connected(route!)
        const pending = client.callTool({ name: 'echo', arguments: {} })
        await vi.waitFor(() => expect(f.call).toHaveBeenCalledTimes(attempt))
        expect(await pending).toMatchObject({ isError: true })
        if (attempt <= 3) await vi.waitFor(() => expect(f.starts()).toBe(attempt + 1))
        else
          await vi.waitFor(() =>
            expect(f.diagnostic).toHaveBeenCalledWith('chrome', 'recovery-rate-limited'),
          )
        now += 100
      }
      expect(f.starts()).toBe(4)
      expect(await f.bridge.routes(owner, req)).toEqual([])
      expect((await f.controller.status()).cards[0]).toMatchObject({
        state: 'Running',
        toolsUnavailable: true,
      })
      // A person fallback can try the same exact run; a failed physical proof still grants nothing.
      f.failStop()
      await expect(f.bridge.restartPlugin('chrome')).rejects.toThrow()
      expect(f.starts()).toBe(4)
      expect(f.diagnostic).toHaveBeenCalledWith('chrome', 'recovery-host-unproven')
    } finally {
      await expect(bridgeClose()).resolves.toBeUndefined()
      // A detached consumer cannot turn the failed physical stop into a clean exit.
      expect(f.controller.cleanForShutdown()).toBe(false)
      expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
      expect(f.starts()).toBe(4)
    }
  })
  it('reports failed binding, then clears the health warning only after a usable route exists', async () => {
    const f = await live()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      f.binding.mockRejectedValueOnce(new Error('fictional-private-downstream-name'))
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      expect(await f.bridge.routes(owner, req)).toEqual([])
      expect((await f.controller.status()).cards[0]).toMatchObject({
        state: 'Running',
        toolsUnavailable: true,
      })
      const [route] = await f.bridge.routes(owner, req)
      const client = await connected(route!)
      expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ text: 'fictional fern' }],
      })
      expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
    } finally {
      log.mockRestore()
    }
  })
  it('does not re-add an old recovery warning after a fresh caller has already used the replacement', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const f = await live({
      async restartHost(id, runId, stopped) {
        await f.controller.restartPluginTools(id, runId, stopped)
        await held
      },
    })
    await breakToolCall(f)
    try {
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      const [before] = await f.bridge.routes(owner, req)
      const old = await connected(before!)
      const pending = old
        .callTool({ name: 'echo', arguments: {} }, undefined, { timeout: 1500 })
        .catch(() => null)
      await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(f.starts()).toBe(2))
      let after: ManagedPluginMcpServer | undefined
      await vi.waitFor(async () => {
        const routes = await f.bridge.routes(owner, req)
        expect(routes).toHaveLength(1)
        after = routes[0]
      })
      const current = await connected(after!)
      expect(await current.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ text: 'fictional fern' }],
      })
      expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
      release()
      await new Promise((resolve) => setImmediate(resolve))
      expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
      await pending
    } finally {
      release()
    }
  })
  it('binds a changed installation identity after its own invalidation and rotates the caller route', async () => {
    const f = await live()
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      const [before] = await f.bridge.routes(owner, req)
      const oldClient = await connected(before!)
      await oldClient.callTool({ name: 'echo', arguments: {} })
      // Exercise a real committed installation change instead of overriding the old view seam.
      const installation = f.controller.screen(f.person, 'chrome').installation.installId
      await f.controller.uninstall(f.person, 'chrome')
      await f.controller.install(f.person, 'chrome')
      expect(f.controller.screen(f.person, 'chrome').installation.installId).not.toBe(installation)
      const next = await f.bridge.routes(owner, req)
      expect(next).toHaveLength(1)
      expect(next[0]!.capability).not.toBe(before!.capability)
      const client = await connected(next[0]!)
      expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ text: 'fictional fern' }],
      })
      await expect(oldClient.callTool({ name: 'echo', arguments: {} })).rejects.toThrow()
      expect(f.binding).toHaveBeenCalledTimes(2)
      expect(f.call).toHaveBeenCalledTimes(2)
      expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
    } finally {
      log.mockRestore()
    }
  })
  it.each(['installation', 'lease'])(
    'does not carry a late binding failure from a revoked %s onto a healthy caller',
    async (scope) => {
      const f = await live()
      const close = scope === 'lease' ? closes.pop()! : undefined
      const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
      let rejectBinding!: (error: Error) => void
      const binding = new Promise<Awaited<ReturnType<typeof f.binding>>>((_resolve, reject) => {
        rejectBinding = reject
      })
      f.binding.mockImplementationOnce(() => binding)
      try {
        const owner = lease()
        const pending = f.bridge.routes(owner, request(f.local.sink.workspaceId))
        await vi.waitFor(() => expect(f.binding).toHaveBeenCalledOnce())
        if (scope === 'installation') f.bridge.deny('chrome')
        else f.revokeLease(owner)
        rejectBinding(new Error('fictional stale binding failure'))
        expect(await pending).toEqual([])
        const [route] = await f.bridge.routes(
          scope === 'installation' ? owner : lease(),
          request(f.local.sink.workspaceId),
        )
        const client = await connected(route!)
        expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
          content: [{ text: 'fictional fern' }],
        })
        expect(f.binding).toHaveBeenCalledTimes(2)
        expect(f.call).toHaveBeenCalledOnce()
        expect(f.diagnostic).toHaveBeenCalledWith(
          'chrome',
          'route-stale',
          expect.objectContaining({ correlation: expect.any(String) }),
        )
        expect((await f.controller.status()).cards[0]).toMatchObject({ state: 'Running' })
        expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
      } finally {
        log.mockRestore()
        // The stale binding never held a host exit witness; detach is only its notice.
        if (close) await expect(close()).resolves.toBeUndefined()
      }
    },
  )
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
    expect(f.call).toHaveBeenCalledTimes(2)
  })
  it('lease revocation ends discovery and calls', async () => {
    const f = await live(),
      owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [route] = await f.bridge.routes(owner, req)
    const client = await connected(route!)
    expect((await client.listTools()).tools).toHaveLength(1)
    f.revokeLease(owner)
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
it.skipIf(process.platform === 'win32')(
  'a real cold legacy attach stays unknown until ensureRunning reconciles, then its route can be called',
  async () => {
    const f = await fixture()
    const priorExit = deferred<void>()
    const start = f.opts.runtime.start.bind(f.opts.runtime)
    f.opts.runtime.start = async (spec) => {
      const run = await start(spec)
      return {
        ...run,
        exited: priorExit.promise,
        stop: async () => {
          await run.stop()
          priorExit.resolve()
        },
      }
    }
    await f.controller.install(f.handle, 'chrome')
    await f.controller.detach(f.handle)
    await f.controller.drain()
    const ready = deferred<void>()
    const entered = vi.fn()
    f.opts.runtime.start = async (spec) => {
      const run = await start(spec)
      return {
        ...run,
        ready: async () => {
          entered()
          await ready.promise
          return run.ready()
        },
      }
    }
    const cold = await PluginLifecycleController.open(f.opts)
    const binding = vi.fn(async () => echoBinding('fictional cold echo'))
    const bridge = createLifecycleAgentBridge({
      owner: { valid: () => true },
      controller: cold,
      binding,
      answerWithinMs: 100,
    })
    closes.push(() => bridge.close())
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    try {
      const reading = bridge.agentRoutes(owner, req)
      await vi.waitFor(() => expect(entered).toHaveBeenCalled())
      const unknown = await reading
      expect(unknown).toEqual({ servers: [], pending: [], none: [], unknown: true })
      expect(binding).not.toHaveBeenCalled()
      ready.resolve()
      await vi.waitFor(() => expect(cold.agentAttachments(req.workspaceId)).toHaveLength(1))
      const admitted = await bridge.agentRoutes(owner, req)
      expect(admitted.servers).toHaveLength(1)
      const client = await connected(admitted.servers[0]!)
      expect(await client.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ text: 'fictional cold echo' }],
      })
    } finally {
      ready.resolve()
    }
  },
)
it('workspace sources create fresh incarnations, preserve occupied names and release once', async () => {
  const owner = { agentRoutes: vi.fn(async () => ({ format: 1 as const, value: [] })) }
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
    const { Command, OWNER_WIRE, AGENT_ROUTES_FORMAT_2 } =
      await import('../src/main/plugins/supervisor/protocol')
    const f = await fixture()
    const owner = await PluginSupervisor.start({ root: f.root, workspaceRoots: [f.workspace] })
    const calls = vi.fn(async () => [])
    owner.bindAgentBridge({ routes: calls, revoke: vi.fn() })
    const peer = await PluginWorkspaceLease.attach({
      root: f.root,
      workspaceRoot: f.workspace,
      build: 'fictional-build',
      wire: {
        ...OWNER_WIRE,
        features: OWNER_WIRE.features.filter((one) => one !== AGENT_ROUTES_FORMAT_2),
      },
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
    expect(await peer.agentRoutes(input)).toEqual({ format: 1, value: [] })
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
describe.skipIf(process.platform === 'win32')('temporary attachment loss', () => {
  it('a recovered logical incarnation gets a fresh capability after its former route was revoked', async () => {
    const f = await live(),
      owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [before] = await f.bridge.routes(owner, req)
    // A mutation's block takes the plugin away for a moment; lifting it brings it back.
    const blocks = (f.controller as unknown as { blocks: Map<string, symbol> }).blocks
    blocks.set('chrome', Symbol())
    expect(await f.bridge.routes(owner, req)).toEqual([])
    blocks.delete('chrome')
    const [after] = await f.bridge.routes(owner, req)
    expect(after!.capability).not.toBe(before!.capability)
    const client = await connected(after!)
    expect((await client.listTools()).tools).toHaveLength(1)
  })
})

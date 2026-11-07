import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import { fixture, cleanupLifecycleFixtures, deferred } from './plugin-lifecycle-fixtures'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'
import type { Command } from '../src/main/plugins/supervisor/protocol'
import type { BrokerInput, BrokerClock } from '../src/main/plugins/tool-broker'
import {
  FakeRuntime,
  withManagedPluginAttachments,
  type ManagedPluginMcpServer,
  type SessionHandle,
} from '@brobot2/runtime'

const closes: (() => Promise<unknown>)[] = []
function brokerClock() {
  let now = 0,
    sequence = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const clock: BrokerClock = {
    now: () => now,
    after(ms, callback) {
      const key = ++sequence
      timers.set(key, { at: now + ms, callback })
      return () => {
        timers.delete(key)
      }
    },
  }
  return {
    clock,
    advance(ms: number) {
      now += ms
      for (const [key, one] of [...timers].sort((a, b) => a[1].at - b[1].at))
        if (one.at <= now && timers.delete(key)) one.callback()
    },
  }
}
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
async function live(
  change: {
    firstExit?: Promise<void>
    firstStop?: () => Promise<void>
    now?: () => number
    recoverChromeHost?: (
      view: ReturnType<ReturnType<typeof sharedLifecycleWorkspaces>['agentAttachments']>[number],
      stopped: () => void,
    ) => Promise<void>
  } = {},
) {
  const { firstExit, firstStop, ...bridgeChange } = change
  const consumer: { bridge?: ReturnType<typeof createLifecycleAgentBridge> } = {}
  const f = await fixture({
    deny: (id) => consumer.bridge?.deny(id),
    toolsUnavailable: (id) => consumer.bridge?.toolsUnavailable?.(id) ?? false,
    toolsCause: (id) => consumer.bridge?.toolsCause?.(id),
    onChromeHostExit: (runId) => consumer.bridge?.hostExited?.(runId),
  })
  if (firstExit || firstStop) {
    const start = f.opts.runtime.start.bind(f.opts.runtime)
    let first = true
    f.opts.runtime.start = async (spec) => {
      const run = await start(spec)
      if (!first) return run
      first = false
      return { ...run, exited: firstExit ?? run.exited, stop: firstStop ?? run.stop }
    }
  }
  await f.controller.detach(f.handle)
  const controller = sharedLifecycleWorkspaces(f.controller)
  const person = await controller.attach(f.local.sink)
  await controller.install(person, 'chrome')
  let valid = true,
    allowed = true
  const revoked = new Set<string>()
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
  const diagnostic = vi.fn()
  const bridge = createLifecycleAgentBridge({
    controller,
    owner: { valid: (id) => valid && !revoked.has(id) },
    binding,
    diagnostic,
    ...bridgeChange,
  })
  consumer.bridge = bridge
  closes.push(() => bridge.close())
  return {
    ...f,
    controller,
    person,
    bridge,
    binding,
    call,
    diagnostic,
    revokeLease: (one: WorkspaceLease) => {
      revoked.add(one.id)
      bridge.revoke(one)
    },
    setValid: (v: boolean) => {
      valid = v
    },
    allow: (v: boolean) => {
      allowed = v
    },
  }
}
describe.skipIf(process.platform === 'win32')('live lifecycle agent bridge, inert server', () => {
  it.each(['idle', 'active'] as const)(
    'recovers after a positive unexpected exact-host exit with an %s broker',
    async (mode) => {
      const exited = deferred<void>()

      const f = await live({
        firstExit: exited.promise,
        recoverChromeHost: (view, stopped) => restart(view.runId, stopped),
      })
      const restart = (runId: string, stopped: () => void) =>
        f.controller.restartChromeTools(runId, stopped)
      if (mode === 'active') {
        const original = await f.binding()
        f.binding.mockResolvedValueOnce({
          ...original,
          server: {
            ...original.server,
            tool() {
              f.call()
              return {
                result: new Promise<never>(() => {}),
                quiescent: new Promise<void>(() => {}),
                cancel() {},
              }
            },
          },
        })
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
      recoverChromeHost: (view, stopped) => restart(view.runId, stopped),
    })
    const restart = (runId: string, stopped: () => void) =>
      f.controller.restartChromeTools(runId, stopped)
    const original = await f.binding()
    let fail!: (error: Error) => void
    f.binding.mockResolvedValueOnce({
      ...original,
      server: {
        ...original.server,
        tool() {
          f.call()
          const proof = new Promise<void>((_resolve, reject) => {
            fail = reject
          })
          return { result: new Promise<never>(() => {}), quiescent: proof, cancel() {} }
        },
      },
    })
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [before] = await f.bridge.routes(owner, req)
    const client = await connected(before!)
    try {
      const pending = client.callTool({ name: 'echo', arguments: {} }, undefined, { timeout: 1500 })
      await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
      fail(new Error('fictional negative completion proof'))
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
      recoverChromeHost: (view, stopped) => restart(view.runId, stopped),
    })
    const restart = (runId: string, stopped: () => void) =>
      f.controller.restartChromeTools(runId, stopped)
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    await f.bridge.routes(owner, req)
    rejectExit(new Error('fictional unproved physical exit'))
    await vi.waitFor(async () =>
      expect((await f.controller.status()).cards[0]?.state).toBe('Unavailable'),
    )
    f.failStop()
    await expect(f.bridge.restartChrome()).rejects.toThrow()
    expect(f.starts()).toBe(1)
    expect(f.events.filter((event) => event === 'stop')).toHaveLength(1)
    f.failStop(false)
    await f.bridge.restartChrome()
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
      recoverChromeHost: (view, stopped) => restart(view.runId, stopped),
    })
    const restart = (runId: string, stopped: () => void) =>
      f.controller.restartChromeTools(runId, stopped)
    const owner = lease(),
      req = request(f.local.sink.workspaceId)
    const [before] = await f.bridge.routes(owner, req)
    const old = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
    f.bridge.hostExited(randomUUID())
    for (let i = 0; i < 5; i++) f.bridge.hostExited(old.runId)
    await Promise.resolve()
    expect(f.starts()).toBe(1)
    expect(f.events).not.toContain('stop')
    expect((await f.bridge.routes(owner, req))[0]!.capability).toBe(before!.capability)
    expect(
      await (await connected(before!)).callTool({ name: 'echo', arguments: {} }),
    ).toMatchObject({ content: [{ text: 'fictional fern' }] })
    exited.resolve()
    await vi.waitFor(() => expect(f.starts()).toBe(2))
    for (let i = 0; i < 5; i++) f.bridge.hostExited(old.runId)
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
      const recover = vi.fn((view, stopped) => restart(view.runId, stopped))
      const f = await live({ firstExit: exited.promise, recoverChromeHost: recover })
      const restart = (runId: string, stopped: () => void) =>
        f.controller.restartChromeTools(runId, stopped)
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      await f.bridge.routes(owner, req)
      const old = f.controller.agentAttachments(f.local.sink.workspaceId)[0]!
      let draining: Promise<void> | undefined
      if (action === 'uninstall') await f.controller.uninstall(f.person, 'chrome')
      else draining = f.controller.drain()
      exited.resolve()
      await draining
      f.bridge.hostExited(old.runId)
      // Neither a wakeup nor a direct trusted request can restore an installation or drain.
      await expect(f.controller.restartChromeTools(old.runId, vi.fn())).rejects.toThrow()
      expect(f.starts()).toBe(1)
      expect(await f.bridge.routes(owner, req)).toEqual([])
      // An already coalesced broker retirement may settle, but cannot start another host.
      await f.bridge.restartChrome().catch(() => undefined)
      expect(f.starts()).toBe(1)
    },
  )
  it.each(['claude', 'codex'] as const)(
    '%s keeps its conversation identity and calls the real replacement route on its next sent turn',
    async (provider) => {
      const f = await live({ recoverChromeHost: (view, stopped) => restart(view.runId, stopped) })
      const restart = (runId: string, stopped: () => void) =>
        f.controller.restartChromeTools(runId, stopped)
      const original = await f.binding()
      let fail!: (error: Error) => void
      f.binding.mockResolvedValueOnce({
        ...original,
        server: {
          ...original.server,
          tool() {
            f.call()
            const proof = new Promise<void>((_resolve, reject) => {
              fail = reject
            })
            return { result: new Promise<never>(() => {}), quiescent: proof, cancel() {} }
          },
        },
      })
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
      fail(new Error('fictional failed completion proof'))
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
        stage: 'route-binding',
        cause: 'unknown',
        correlation: expect.stringMatching(/^[a-f0-9-]{36}$/),
        reason: 'fictional-private-downstream-name',
      })
      expect(failures[1]![2]).toEqual(failures[0]![2])
      // The same fixed stage and cause reach the card, and from there the agent's launch line.
      expect(f.bridge.toolsCause(failures[0]![0])).toBe('route-binding: unknown')
    } finally {
      log.mockRestore()
    }
  })
  it('uninstall during a call that is still being cancelled completes, and the call ends with a plain refusal', async () => {
    const f = await live()
    const original = await f.binding()
    // A call whose server never answers and never proves it has gone quiet.
    f.binding.mockResolvedValueOnce({
      ...original,
      server: {
        ...original.server,
        tool() {
          f.call()
          return { result: new Promise<never>(() => {}), quiescent: new Promise<void>(() => {}), cancel() {} }
        },
      },
    })
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
  it('reports an unavailable broker on the Running card, withholds dead routes and never overlaps a failed proof', async () => {
    const f = await live()
    const original = await f.binding()
    let rejectProof!: (error: Error) => void
    const proof = new Promise<void>((_resolve, reject) => {
      rejectProof = reject
    })
    void proof.catch(() => undefined)
    f.binding.mockResolvedValueOnce({
      ...original,
      server: {
        ...original.server,
        tool() {
          f.call()
          return { result: new Promise<never>(() => {}), quiescent: proof, cancel() {} }
        },
      },
    })
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
      rejectProof(new Error('fictional-private-proof-error'))
      expect(await pending).toMatchObject({ isError: true })
      // The agents' plugin line names why: tools unavailable: proof-rejected.
      expect((await f.controller.status()).cards[0]).toMatchObject({
        state: 'Running',
        toolsUnavailable: true,
        toolsCause: 'proof-rejected',
      })
      expect(await f.bridge.routes(owner, req)).toEqual([])
      expect(await f.bridge.routes(owner, request(f.local.sink.workspaceId))).toEqual([])
      // A new lease gets no route either while the old work is not proven quiet.
      expect(await f.bridge.routes(lease(), request(f.local.sink.workspaceId))).toEqual([])
      expect(f.binding).toHaveBeenCalledTimes(2) // One fixture lookup, one broker. No replacement.
      expect(f.call).toHaveBeenCalledOnce()
    } finally {
      // An intentionally rejected remote proof must remain a negative shutdown receipt.
      await expect(close()).rejects.toThrow()
    }
  })
  it('replaces a failed broker only after positive completion and rotates both live callers', async () => {
    const f = await live(),
      original = await f.binding(),
      time = brokerClock()
    let prove!: () => void
    const quiet = new Promise<void>((resolve) => {
      prove = resolve
    })
    f.binding.mockResolvedValueOnce(
      Object.assign(
        {
          ...original,
          server: {
            ...original.server,
            tool() {
              f.call()
              return { result: new Promise<never>(() => {}), quiescent: quiet, cancel() {} }
            },
          },
        },
        { clock: time.clock },
      ),
    )
    const owner = lease(),
      first = request(f.local.sink.workspaceId),
      second = request(f.local.sink.workspaceId)
    const [beforeFirst] = await f.bridge.routes(owner, first)
    const [beforeSecond] = await f.bridge.routes(owner, second)
    const client = await connected(beforeFirst!)
    const pending = client.callTool({ name: 'echo', arguments: {} })
    await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
    time.advance(120000)
    expect(await pending).toMatchObject({ isError: true })
    time.advance(1000)
    expect((await f.controller.status()).cards[0]).toMatchObject({
      state: 'Running',
      toolsUnavailable: true,
    })
    expect(await f.bridge.routes(owner, first)).toEqual([])
    expect(await f.bridge.routes(owner, second)).toEqual([])
    expect(f.binding).toHaveBeenCalledTimes(2)
    prove()
    await new Promise((resolve) => setImmediate(resolve))
    const freshFirst = await f.bridge.routes(owner, first)
    expect(freshFirst).toHaveLength(1)
    const freshSecond = await f.bridge.routes(owner, second)
    expect(freshSecond).toHaveLength(1)
    expect(freshFirst[0]!.capability).not.toBe(beforeFirst!.capability)
    expect(freshSecond[0]!.capability).not.toBe(beforeSecond!.capability)
    for (const route of [freshFirst[0]!, freshSecond[0]!]) {
      const liveClient = await connected(route)
      expect(await liveClient.callTool({ name: 'echo', arguments: {} })).toMatchObject({
        content: [{ text: 'fictional fern' }],
      })
    }
    expect(f.binding).toHaveBeenCalledTimes(3)
    expect(f.call).toHaveBeenCalledTimes(3)
    expect((await f.controller.status()).cards[0]).not.toHaveProperty('toolsUnavailable')
  })
  it('automatically restarts only the exact Chrome host, bounds attempts, and keeps failed exit negative', async () => {
    let now = 0

    const f = await live({
      now: () => now,
      recoverChromeHost: (view, stopped) => restart(view.runId, stopped),
    })
    const restart = (runId: string, stopped: () => void) =>
      f.controller.restartChromeTools(runId, stopped)
    const bridgeClose = closes.pop()!
    let negative = false
    try {
      const original = await f.binding()
      let rejectProof!: (error: Error) => void
      f.binding.mockImplementation(async () => ({
        ...original,
        server: {
          ...original.server,
          tool() {
            f.call()
            const proof = new Promise<void>((_resolve, reject) => {
              rejectProof = reject
            })
            return { result: new Promise<never>(() => {}), quiescent: proof, cancel() {} }
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
        rejectProof(new Error('fictional private failure'))
        expect(await pending).toMatchObject({ isError: true })
        if (attempt === 4) negative = true
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
      await expect(f.bridge.restartChrome()).rejects.toThrow()
      expect(f.starts()).toBe(4)
      expect(f.diagnostic).toHaveBeenCalledWith('chrome', 'recovery-host-unproven')
    } finally {
      if (negative) await expect(bridgeClose()).rejects.toThrow()
      else await bridgeClose()
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
      async recoverChromeHost(view, stopped) {
        await restart(view.runId, stopped)
        await held
      },
    })
    const restart = (runId: string, stopped: () => void) =>
      f.controller.restartChromeTools(runId, stopped)
    const original = await f.binding()
    let fail!: (error: Error) => void
    f.binding.mockResolvedValueOnce({
      ...original,
      server: {
        ...original.server,
        tool() {
          f.call()
          const proof = new Promise<void>((_resolve, reject) => {
            fail = reject
          })
          return { result: new Promise<never>(() => {}), quiescent: proof, cancel() {} }
        },
      },
    })
    try {
      const owner = lease(),
        req = request(f.local.sink.workspaceId)
      const [before] = await f.bridge.routes(owner, req)
      const old = await connected(before!)
      const pending = old
        .callTool({ name: 'echo', arguments: {} }, undefined, { timeout: 1500 })
        .catch(() => null)
      await vi.waitFor(() => expect(f.call).toHaveBeenCalledOnce())
      fail(new Error('fictional failed proof'))
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
        // The revoked consumer's intentionally failed binding remains a negative cleanup receipt.
        // A truthful warning must not clear that separate safety barrier.
        if (close) await expect(close()).rejects.toThrow()
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
    const binding = vi.fn(async () => ({
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
            value: { content: [{ type: 'text', text: 'fictional cold echo' }] },
          }),
          quiescent: Promise.resolve(),
          cancel() {},
        }),
        admin() {
          throw new Error('person surface stays private')
        },
      },
    }))
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

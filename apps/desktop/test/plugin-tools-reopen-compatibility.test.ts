import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Provider } from '@brobot2/shared'
import type { LoginRenewalOperations } from '../src/main/providers/auth-types'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import { createLifecycleAgentBridge } from '../src/main/plugins/lifecycle/agent-bridge'
import type { WorkspaceLease } from '../src/main/plugins/supervisor/owner'
import {
  fixture,
  projection,
  cleanupLifecycleFixtures,
  deferred,
} from './plugin-lifecycle-fixtures'
import { genericUiFixture } from './plugin-ui-fixtures'
import { mcpRequestWorld } from './helpers/mcp-server-request-world'
import type { PluginBeforeTurnInput } from '../src/shared/plugin-contract'

const closes: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  try {
    for (const close of closes.splice(0).reverse()) await close()
  } finally {
    await cleanupLifecycleFixtures()
  }
})

/** Plugin fixtures only: RuntimeHost, provider recording and reopen controls are the shared world. */
async function connected(
  provider: Provider,
  pendingPerson = false,
  approvalMode: 'auto' | 'ask' = 'auto',
  options: {
    loginRenewal?: (provider: Provider) => LoginRenewalOperations | undefined
    holdHookAt?: number
  } = {},
) {
  const world = mcpRequestWorld()
  let closeBridge = async () => {},
    drain = async () => {},
    closePeer = async () => {}
  closes.push(async () => {
    try {
      await world.cleanup()
    } finally {
      try {
        await closeBridge()
      } finally {
        try {
          await drain()
        } finally {
          await closePeer()
        }
      }
    }
  })
  const f = await fixture({ appVersion: '1.0.0' }, false, 'fictional-list')
  drain = async () => {
    f.controller.consumersEnded()
    await f.controller.drain()
  }
  const server = new Server(
    { name: 'fictional-recipes', version: '1' },
    { capabilities: { tools: {} } },
  )
  const client = new Client({ name: 'fictional-retained-peer', version: '1' })
  closePeer = async () => {
    try {
      await client.close()
    } finally {
      await server.close()
    }
  }
  server.onerror = client.onerror = () => undefined
  const seen: { context: PluginBeforeTurnInput; requestId: string }[] = []
  const hookCompletions = new Map<string, Promise<unknown>>()
  const completedCallbacks = new Set<string>()
  const scheduledHook = options.holdHookAt === undefined ? undefined : world.gate()
  let waiting: ReturnType<typeof world.gate> | undefined
  let includeTitles = true
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'choose_titles', inputSchema: { type: 'object' } },
      { name: 'echo', inputSchema: { type: 'object' } },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'choose_titles')
      return { content: [{ type: 'text', text: 'Fictional echo.' }] }
    const context = structuredClone(request.params.arguments?.context) as PluginBeforeTurnInput
    seen.push({ context, requestId: String(request.params._meta?.requestId) })
    const pointers = includeTitles
      ? context.candidates.map(({ resourceId, version }) => ({ resourceId, version }))
      : []
    const held = seen.length === options.holdHookAt ? scheduledHook : waiting
    waiting = undefined
    try {
      if (held) await held.promise
      return {
        content: [],
        structuredContent: { pointers, title: 'Untrusted plugin prose must not be rendered.' },
      }
    } finally {
      completedCallbacks.add(context.turnId)
    }
  })
  const [downstream, upstream] = InMemoryTransport.createLinkedPair()
  await server.connect(downstream)
  await client.connect(upstream)
  const started: { pluginId: string; runId: string }[] = []
  const start = f.opts.runtime.start
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec),
      exit = deferred<void>()
    started.push({ pluginId: spec.package.manifest.id, runId: run.runId })
    return {
      ...run,
      exited: exit.promise,
      stop: async () => {
        await run.stop()
        exit.resolve()
      },
    }
  }
  const bridge = createLifecycleAgentBridge({
    owner: { valid: () => true },
    controller: f.controller,
    binding: async () => client,
  })
  f.controller.bindGenericTools(bridge)
  closeBridge = () => bridge.close()
  const cancelled = vi.spyOn(bridge, 'cancelTool')
  const lease: WorkspaceLease = {
    id: randomUUID(),
    workspace: 'a'.repeat(64),
    generation: randomUUID(),
    epoch: randomUUID(),
    counter: 0,
    renewedAt: 0,
    minor: 0,
    features: [],
  }
  const routeReads: { incarnation: string; released: boolean; plugins: string[] }[] = []
  const attachments = new WorkspacePluginAttachments(
    {
      agentRoutes: async (input) => {
        const value = await bridge.agentRoutes(lease, {
          kind: 'agent-routes',
          workspace: lease.workspace,
          generation: lease.generation,
          lease: 'b'.repeat(64),
          ...input,
          release: input.release ?? false,
        })
        routeReads.push({
          incarnation: input.incarnation,
          released: input.release === true,
          plugins: value.servers.map((one) => one.pluginId),
        })
        return { format: 2, value: { format: 2, ...value } }
      },
    },
    f.local.sink.workspaceId,
  )
  const install = async (version = '1.0.0', action: 'install' | 'update' = 'install') => {
    const pkg = genericUiFixture({
      target: f.opts.target,
      version,
      hooks: [
        {
          id: 'titles',
          kind: 'turn.context.titles',
          api: 1,
          invoke: { tool: 'choose_titles', inputField: 'context' },
        },
      ],
    })
    const source = join(f.parent, `fictional-${version}.tar`)
    await writeFile(source, pkg.archive)
    await f.controller.installPackage(
      f.handle,
      { source, sha256: pkg.binding.releaseDigest, bytes: pkg.archive.length },
      action,
    )
  }
  await install()
  await f.controller.setTitlesEnabled(f.handle, 'fictional-bakery', true)
  const personGate = world.gate()
  let person = f.handle
  if (pendingPerson) {
    const other = projection().sink
    person = await f.controller.attach({
      ...other,
      workspaceId: f.local.sink.workspaceId,
      reconcile: async (change) => {
        if (change.receipt) await personGate.promise
      },
    })
  } else personGate.release()
  const host = world.host({
    provider,
    ...(options.loginRenewal === undefined ? {} : { loginRenewal: options.loginRenewal }),
    pluginAttachments: attachments,
    pluginContext: {
      active: () => {
        try {
          return f.controller
            .hostSnapshot(person)
            .contributions.some(
              (one) =>
                one.kind === 'turn.context.titles' && one.state === 'active' && one.titlesEnabled,
            )
        } catch {
          return false
        }
      },
      beforeTurn: (input) => {
        const completion = f.controller.hostBeforeTurn(person, input)
        hookCompletions.set(input.turnId, completion)
        return completion
      },
    },
  })
  const id = await world.open(host, 'writer', approvalMode)
  const piece = world.store.rootOf(id)
  if (!piece) throw new Error('The public world did not create the conversation root.')
  const resource = world.store.addResource(
    {
      piece: piece.piece,
      role: 'made',
      title: 'Canonical fictional recipe',
      summary: null,
      name: 'fictional-recipe.md',
      sha256: 'd'.repeat(64),
      bytes: 42,
      addedBy: id,
    },
    7_000_000,
  )
  async function route(launch: number) {
    const target = world.launches[launch]?.options.managedPluginMcp?.find(
      (one) => one.pluginId === 'fictional-bakery',
    )
    if (!target) throw new Error('The provider launch has no fictional A route.')
    const caller = new Client({ name: 'fictional-provider-caller', version: '1' })
    try {
      await caller.connect(
        new StreamableHTTPClientTransport(new URL(target.url), {
          requestInit: { headers: { Authorization: `Bearer ${target.capability}` } },
        }),
      )
      expect((await caller.listTools()).tools.map((one) => one.name)).toContain('echo')
      return await caller.callTool({ name: 'echo', arguments: { text: 'Fictional routed input.' } })
    } finally {
      await caller.close()
    }
  }
  const sent = () => world.sent.filter((one) => one.profile === 'writer').map((one) => one.text)
  const turns = () => world.ledger(id).filter((event) => event.type === 'user_turn')
  const reopens = () => world.ledger(id).filter((event) => event.type === 'reopened')
  async function approve() {
    const external = await world.server()
    const tool = agentToolsFor(host, id).tools.find((one) => one.name === 'request_mcp_server')!
    const answer = await tool.call({
      name: 'fictional-notes',
      url: external.url,
      reaches: 'Read fictional notes.',
      who_gets_it: 'everyone',
    })
    expect(answer.structured).toMatchObject({ outcome: 'ok' })
    const requestId = answer.structured!.request as string
    expect(
      await executeRuntimeCommand(host, world.window, {
        kind: 'decideMcpServerRequest',
        requestId,
        approve: true,
      }),
    ).toMatchObject({ outcome: 'taken' })
    await expect
      .poll(() => sent().some((text) => text.includes(`The person approved request ${requestId}`)))
      .toBe(true)
    return { external, requestId }
  }
  return {
    world,
    f,
    host,
    id,
    piece,
    resource,
    seen,
    hookCompletions,
    completedCallbacks,
    scheduledHook,
    started,
    routeReads,
    cancelled,
    install,
    sent,
    turns,
    reopens,
    approve,
    route,
    person,
    personGate,
    omitTitles: () => {
      includeTitles = false
    },
    holdHook: () => {
      const gate = world.gate()
      waiting = gate
      return gate
    },
    idle: () => expect.poll(() => world.handles.get('writer')!.status()).toBe('idle'),
  }
}

const D1_ORIGINAL = 'Fictional original words before the fatal sign-in refusal.'
const D1_CONTINUATION = 'Fictional app words continuing the refused turn.'

async function textualFixture(provider: Provider, holdHookAt?: number) {
  let renewed = false
  const renewal: LoginRenewalOperations = {
    launchLabel: 'fictional rejected sign-in renewal',
    renew: vi.fn(async () => 'renewed' as const),
    renewRejected: vi.fn(async () => {
      renewed = true
      return 'renewed' as const
    }),
    rejectedTurnContinuation: D1_CONTINUATION,
    prepare: async (prepare) => ({ home: await prepare(), loginRenewed: false }),
  }
  const w = await connected(provider, false, 'auto', {
    loginRenewal: () => renewal,
    holdHookAt,
  })
  const failed = w.world.handles.get('writer')!
  Object.defineProperty(failed, 'checkSignIn', {
    configurable: true,
    value: async () => renewed,
  })
  return { ...w, failed, renewal }
}

async function refusedTextualContinuation(provider: Provider) {
  const w = await textualFixture(provider, 2)
  w.world.failTheNextTurnOnItsLogin = { cause: 'auth' }
  await w.host.send(w.id, D1_ORIGINAL, w.world.window)
  await expect.poll(() => w.seen.length).toBe(2)
  const resumed = w.world.handles.get('writer')!
  expect(resumed).not.toBe(w.failed)
  const checkSignIn = vi.fn(async () => false)
  Object.defineProperty(resumed, 'checkSignIn', {
    configurable: true,
    value: checkSignIn,
  })
  const terminal = w.world.gate()
  w.world.turnWait = terminal.promise
  w.world.refuseTheNextTurnOnItsLogin = true
  w.scheduledHook!.release()
  await expect.poll(() => resumed.status()).toBe('working')
  expect(w.sent().filter((text) => text.includes(D1_CONTINUATION))).toHaveLength(1)

  // The sign-in changes after dispatch, while the refused terminal is still held.
  checkSignIn.mockResolvedValue(true)
  const checksAtMove = checkSignIn.mock.calls.length
  w.world.turnWait = null
  terminal.release()
  await expect
    .poll(
      () =>
        w.world
          .ledger(w.id)
          .filter(
            (event) =>
              event.type === 'turn' && event.state === 'failed' && event.loginRefused === true,
          ).length,
    )
    .toBe(2)
  // A competing reopen calls checkSignIn before this terminal is written.
  expect(checkSignIn).toHaveBeenCalledTimes(checksAtMove)
  expect(w.world.launches).toHaveLength(2)
  expect(
    w.turns().filter((event) => event.appNotice === 'a-turn-continued-after-sign-in'),
  ).toHaveLength(1)
  expect(w.failed.origins).toEqual([{ kind: 'person' }])
  expect(w.sent().filter((text) => text.includes(D1_ORIGINAL))).toHaveLength(1)
  // The nonfatal helper proves the refused terminal, not an accepted origin/settings stamp.
  return { ...w, resumed, checkSignIn }
}

describe.each(['claude', 'codex'] as const)(
  '%s plugin observations at the shared tools-reopen seam',
  (provider) => {
    it('keeps ready A routes and canonical titles through a moved-sign-in plus approval while actual B download is held', async () => {
      const w = await connected(provider)
      expect(await w.route(0)).toMatchObject({
        content: [{ type: 'text', text: 'Fictional echo.' }],
      })
      const downloaded = w.world.gate(),
        entered = vi.fn()
      const download = w.f.opts.download
      w.f.opts.download = async (...args) => {
        entered()
        await downloaded.promise
        return download(...args)
      }
      const installing = w.f.controller.install(w.f.handle, 'fictional-list')
      const settled = installing.then(
        () => true,
        () => false,
      )
      await expect.poll(() => entered.mock.calls.length).toBe(1)
      const external = await w.world.server()
      const tool = agentToolsFor(w.host, w.id).tools.find(
        (one) => one.name === 'request_mcp_server',
      )!
      const answer = await tool.call({
        name: 'fictional-notes',
        url: external.url,
        reaches: 'Read fictional notes.',
        who_gets_it: 'everyone',
      })
      const requestId = answer.structured!.request as string
      const old = w.world.handles.get('writer')!,
        exit = w.world.gate()
      Object.defineProperty(old, 'checkSignIn', { configurable: true, value: async () => true })
      Object.defineProperty(old, 'awaitProcessExit', {
        configurable: true,
        value: () => exit.promise,
      })
      const held = 'Fictional words held for current plugin titles.'
      await w.host.send(w.id, held, w.world.window)
      await expect.poll(() => old.status()).toBe('ended')
      expect(
        await executeRuntimeCommand(w.host, w.world.window, {
          kind: 'decideMcpServerRequest',
          requestId,
          approve: true,
        }),
      ).toMatchObject({ outcome: 'taken' })
      exit.release()
      await expect.poll(() => w.sent().filter((text) => text.includes(held)).length).toBe(1)
      expect(w.world.launches).toHaveLength(2)
      expect(w.world.launches[1]!.options.externalMcp?.servers).toContainEqual(
        expect.objectContaining({ url: external.url }),
      )
      expect(w.world.launches[1]!.options.managedPluginMcp).toContainEqual(
        expect.objectContaining({ pluginId: 'fictional-bakery' }),
      )
      expect(w.reopens()).toMatchObject([{ because: 'the-sign-in-moved-on' }])
      const words = w.sent().find((text) => text.includes(held))!
      expect(words).toContain('Canonical fictional recipe')
      expect(words).not.toContain('Untrusted plugin prose')
      expect(words.indexOf('Sent by')).toBeLessThan(words.indexOf('Suggested file titles'))
      expect(w.started.filter((one) => one.pluginId === 'fictional-bakery')).toHaveLength(1)
      expect(w.started.filter((one) => one.pluginId === 'fictional-list')).toHaveLength(0)
      expect(
        w.routeReads
          .filter((one) => !one.released)
          .every((one) => one.plugins.includes('fictional-bakery')),
      ).toBe(true)
      expect(
        new Set(w.routeReads.filter((one) => !one.released).map((one) => one.incarnation)).size,
      ).toBe(2)
      expect(w.routeReads.some((one) => one.released)).toBe(true)
      expect(await w.route(1)).toMatchObject({
        content: [{ type: 'text', text: 'Fictional echo.' }],
      })
      await expect(w.route(0)).rejects.toThrow()
      expect(w.turns().filter((event) => JSON.stringify(event).includes(held))).toHaveLength(1)
      expect(JSON.stringify(w.turns())).not.toContain('Suggested file titles')
      downloaded.release()
      expect(await settled).toBe(true)
    })

    it('keeps the renewed-sign-in reason and approved notice on one new life with current A routes and titles', async () => {
      const w = await connected(provider)
      const external = await w.world.server()
      const tool = agentToolsFor(w.host, w.id).tools.find(
        (one) => one.name === 'request_mcp_server',
      )!
      const answer = await tool.call({
        name: 'fictional-notes',
        url: external.url,
        reaches: 'Read fictional notes.',
        who_gets_it: 'everyone',
      })
      const requestId = answer.structured!.request as string
      const old = w.world.handles.get('writer')!,
        turn = w.world.gate()
      Object.defineProperty(old, 'checkSignIn', { configurable: true, value: async () => true })
      w.world.turnWait = turn.promise
      void old.runTurnRefusedOnItsLogin('Fictional login refusal.')
      await expect.poll(() => old.status()).toBe('working')
      expect(
        await executeRuntimeCommand(w.host, w.world.window, {
          kind: 'decideMcpServerRequest',
          requestId,
          approve: true,
        }),
      ).toMatchObject({ outcome: 'taken' })
      expect(w.world.launches).toHaveLength(1)
      w.world.turnWait = null
      turn.release()
      await expect.poll(() => w.world.launches.length).toBe(2)
      await expect
        .poll(() =>
          w.sent().some((text) => text.includes(`The person approved request ${requestId}`)),
        )
        .toBe(true)
      expect(w.reopens()).toMatchObject([{ because: 'the-sign-in-was-renewed' }])
      expect(
        w.sent().filter((text) => text.includes(`The person approved request ${requestId}`)),
      ).toHaveLength(1)
      expect(w.sent().at(-1)).toContain('Canonical fictional recipe')
      expect(await w.route(1)).toMatchObject({
        content: [{ type: 'text', text: 'Fictional echo.' }],
      })
      expect(w.started).toHaveLength(1)
    })

    it('prepares real plugin titles for a textual rejected-login continuation without replaying the accepted original', async () => {
      const w = await textualFixture(provider)
      w.world.failTheNextTurnOnItsLogin = { cause: 'auth' }
      await w.host.send(w.id, D1_ORIGINAL, w.world.window)
      await expect
        .poll(
          () =>
            w.turns().filter((event) => event.appNotice === 'a-turn-continued-after-sign-in')
              .length,
        )
        .toBe(1)
      await expect
        .poll(
          () =>
            w.world
              .ledger(w.id)
              .filter((event) => event.type === 'turn' && event.state === 'completed').length,
        )
        .toBe(1)
      const resumed = w.world.handles.get('writer')!
      expect(resumed).not.toBe(w.failed)
      expect(resumed.ref).toEqual(w.failed.ref)
      expect(w.failed.origins).toEqual([{ kind: 'person' }])
      expect(resumed.origins).toEqual([undefined])
      expect(w.renewal.renewRejected).toHaveBeenCalledTimes(1)
      expect(w.reopens()).toMatchObject([{ because: 'the-sign-in-was-renewed' }])
      expect(w.world.launches).toHaveLength(2)
      expect(w.world.launches.at(-1)?.kind).toBe('resume')
      const refusedAt = w.world
        .ledger(w.id)
        .findIndex(
          (event) =>
            event.type === 'turn' && event.state === 'failed' && event.loginRefused === true,
        )
      const errorAt = w.world
        .ledger(w.id)
        .findIndex((event) => event.type === 'error' && event.fatal && event.cause === 'auth')
      const reopenedAt = w.world.ledger(w.id).findIndex((event) => event.type === 'reopened')
      expect(errorAt).toBeGreaterThanOrEqual(0)
      expect(refusedAt).toBeGreaterThan(errorAt)
      expect(reopenedAt).toBeGreaterThan(refusedAt)
      expect(w.turns().filter((event) => event.text === D1_ORIGINAL)).toHaveLength(1)
      expect(
        w.turns().filter((event) => event.appNotice === 'a-turn-continued-after-sign-in'),
      ).toEqual([expect.objectContaining({ text: D1_CONTINUATION, attribution: 'app_authored' })])
      expect(w.turns().filter((event) => event.carriesOn === true)).toEqual([])
      expect(w.sent().filter((text) => text.includes(D1_ORIGINAL))).toHaveLength(1)
      expect(w.sent().filter((text) => text.includes(D1_CONTINUATION))).toHaveLength(1)
      expect(w.sent().at(-1)).toContain('Canonical fictional recipe')
      expect(w.sent().at(-1)).not.toContain('Untrusted plugin prose')
      expect(JSON.stringify(w.turns())).not.toContain('Suggested file titles')
      expect(w.seen).toHaveLength(2)
      expect(w.started).toHaveLength(1)
      expect(await w.route(1)).toMatchObject({
        content: [{ type: 'text', text: 'Fictional echo.' }],
      })
    })

    it('drops textual continuation on Close during its actual title hook, after the public recovery decision settles', async () => {
      const w = await textualFixture(provider, 2)
      w.world.failTheNextTurnOnItsLogin = { cause: 'auth' }
      await w.host.send(w.id, D1_ORIGINAL, w.world.window)
      await expect.poll(() => w.seen.length).toBe(2)
      const resumed = w.world.handles.get('writer')!
      expect(resumed).not.toBe(w.failed)
      const pending = w.world
        .ledger(w.id)
        .find((event) => event.type === 'work_recovery' && event.phase === 'pending')
      if (pending?.type !== 'work_recovery') throw new Error('The public recovery did not begin.')
      const turnId = w.seen[1]!.context.turnId
      expect(w.completedCallbacks.has(turnId)).toBe(false)
      const completion = w.hookCompletions.get(turnId)
      if (!completion) throw new Error('The actual title consumer did not start.')
      await w.host.close(w.id, w.world.window)
      w.scheduledHook!.release()
      await Promise.allSettled([completion])
      await expect.poll(() => w.completedCallbacks.has(turnId)).toBe(true)
      await expect
        .poll(
          () =>
            w.world
              .ledger(w.id)
              .filter(
                (event) =>
                  event.type === 'work_recovery' &&
                  event.turn === pending.turn &&
                  event.since === pending.since &&
                  event.phase !== 'pending',
              ).length,
        )
        .toBe(1)
      // Recovery phase settles the decision; acceptance is checked independently.
      expect(w.sent().filter((text) => text.includes(D1_CONTINUATION))).toEqual([])
      expect(resumed.origins).toEqual([])
      expect(
        w.turns().filter((event) => event.appNotice === 'a-turn-continued-after-sign-in'),
      ).toEqual([])
      expect(w.turns().filter((event) => event.carriesOn === true)).toEqual([])
      expect(w.failed.origins).toEqual([{ kind: 'person' }])
      expect(w.sent().filter((text) => text.includes(D1_ORIGINAL))).toHaveLength(1)
      expect(w.turns()).toEqual([expect.objectContaining({ text: D1_ORIGINAL })])
      expect(w.seen).toHaveLength(2)
      expect(w.started).toHaveLength(1)
    })

    it('does not recheck a moved sign-in or carry on again when its textual retry is refused before any completion', async () => {
      const w = await refusedTextualContinuation(provider)
      expect(
        w.turns().filter((event) => event.appNotice === 'a-turn-continued-after-sign-in'),
      ).toHaveLength(1)
      expect(w.sent().filter((text) => text.includes(D1_CONTINUATION))).toHaveLength(1)
      expect(
        w.world
          .ledger(w.id)
          .filter((event) => event.type === 'turn' && event.state === 'completed'),
      ).toEqual([])
      expect(w.started).toHaveLength(1)
    })

    it('allows one later textual continuation after a real completed turn resets the rejected-retry guards', async () => {
      const w = await refusedTextualContinuation(provider)
      w.checkSignIn.mockResolvedValue(false)
      const ordinary = 'Fictional ordinary words completing before another refusal.'
      await w.host.send(w.id, ordinary, w.world.window)
      await expect
        .poll(
          () =>
            w.world
              .ledger(w.id)
              .filter((event) => event.type === 'turn' && event.state === 'completed').length,
        )
        .toBe(1)
      let renewedAgain = false
      w.checkSignIn.mockImplementation(async () => renewedAgain)
      vi.mocked(w.renewal.renewRejected!).mockImplementationOnce(async () => {
        renewedAgain = true
        return 'renewed'
      })
      const secondOriginal = 'Fictional new original words after the completed reset.'
      w.world.failTheNextTurnOnItsLogin = { cause: 'auth' }
      await w.host.send(w.id, secondOriginal, w.world.window)
      await expect
        .poll(
          () =>
            w.turns().filter((event) => event.appNotice === 'a-turn-continued-after-sign-in')
              .length,
        )
        .toBe(2)
      await expect
        .poll(
          () =>
            w.world
              .ledger(w.id)
              .filter((event) => event.type === 'turn' && event.state === 'completed').length,
        )
        .toBe(2)
      expect(w.renewal.renewRejected).toHaveBeenCalledTimes(2)
      expect(w.reopens()).toHaveLength(2)
      expect(w.world.launches).toHaveLength(3)
      const latest = w.world.handles.get('writer')!
      expect(latest).not.toBe(w.resumed)
      expect(latest.ref).toEqual(w.failed.ref)
      expect(latest.origins).toEqual([undefined])
      expect(w.resumed.origins).toEqual([{ kind: 'person' }, { kind: 'person' }])
      expect(w.sent().filter((text) => text.includes(D1_ORIGINAL))).toHaveLength(1)
      expect(w.sent().filter((text) => text.includes(secondOriginal))).toHaveLength(1)
      expect(w.sent().filter((text) => text.includes(ordinary))).toHaveLength(1)
      expect(w.sent().filter((text) => text.includes(D1_CONTINUATION))).toHaveLength(2)
      expect(w.turns().filter((event) => event.carriesOn === true)).toEqual([])
      expect(w.sent().at(-1)).toContain('Canonical fictional recipe')
      expect(w.seen).toHaveLength(5)
      expect(w.started).toHaveLength(1)
    })

    it('does not renew or add textual continuation for a fatal auth refusal explicitly on a fictional saved key', async () => {
      const w = await textualFixture(provider)
      w.world.failTheNextTurnOnItsLogin = { cause: 'auth', onAKey: true }
      await w.host.send(w.id, D1_ORIGINAL, w.world.window)
      await expect
        .poll(
          () =>
            w.world
              .ledger(w.id)
              .filter(
                (event) =>
                  event.type === 'turn' &&
                  event.state === 'failed' &&
                  event.loginRefused === true &&
                  event.onAKey === true,
              ).length,
        )
        .toBe(1)
      expect(w.world.ledger(w.id).filter((event) => event.type === 'error')).toEqual([
        expect.objectContaining({ cause: 'auth', fatal: true, onAKey: true }),
      ])
      expect(w.renewal.renewRejected).not.toHaveBeenCalled()
      expect(w.renewal.renew).not.toHaveBeenCalled()
      expect(w.reopens()).toEqual([])
      expect(w.world.launches).toHaveLength(1)
      expect(w.failed.origins).toEqual([{ kind: 'person' }])
      expect(w.sent().filter((text) => text.includes(D1_CONTINUATION))).toEqual([])
      expect(
        w.turns().filter((event) => event.appNotice === 'a-turn-continued-after-sign-in'),
      ).toEqual([])
      expect(w.turns()).toEqual([expect.objectContaining({ text: D1_ORIGINAL })])
      expect(w.seen).toHaveLength(1)
    })

    it('keeps a healthy SDK route while a second Person consumer is pending, then admits that consumer without restarting A', async () => {
      const w = await connected(provider, true)
      await w.host.send(w.id, 'Fictional words while Person settings are pending.', w.world.window)
      expect(w.world.launches[0]!.options.managedPluginMcp).toContainEqual(
        expect.objectContaining({ pluginId: 'fictional-bakery' }),
      )
      expect(w.seen).toHaveLength(0)
      expect(w.sent()[0]).not.toContain('Suggested file titles')
      expect(await w.route(0)).toMatchObject({
        content: [{ type: 'text', text: 'Fictional echo.' }],
      })
      const input = {
        turnId: randomUUID(),
        pieceId: w.piece.piece,
        candidates: w.world.store.pluginTitleCandidates!(w.piece.piece),
      }
      expect(await w.f.controller.hostBeforeTurn(w.f.handle, input)).toEqual({
        pointers: [{ resourceId: w.resource.resource, version: 'd'.repeat(64) }],
      })
      const dispatched = w.seen.length
      expect(await w.f.controller.hostBeforeTurn(w.person, input)).toEqual({ pointers: [] })
      expect(w.seen).toHaveLength(dispatched)
      w.personGate.release()
      await expect
        .poll(() =>
          w.f.controller.hostSnapshot(w.person).contributions.some((one) => one.state === 'active'),
        )
        .toBe(true)
      await w.idle()
      await w.host.send(w.id, 'Fictional words after Person metadata is ready.', w.world.window)
      expect(w.sent().at(-1)).toContain('Canonical fictional recipe')
      expect(w.started).toHaveLength(1)
      expect(w.f.state.getEnabled(w.f.local.sink.workspaceId, 'fictional-bakery').enabled).toBe(
        true,
      )
    })

    it('prepares one metadata-only block for an approved post-reopen batch and keeps ledger words and origin stamps unchanged', async () => {
      const w = await connected(provider)
      await w.approve()
      await expect.poll(() => w.world.launches.length).toBe(2)
      await w.idle()
      const running = w.world.gate()
      w.world.turnWait = running.promise
      await w.host.send(w.id, 'Fictional initial work.', w.world.window)
      await expect.poll(() => w.world.handles.get('writer')!.status()).toBe('working')
      const before = w.seen.length
      await w.host.queueMessage(w.id, 'First fictional held words.', w.world.window)
      await w.host.queueMessage(w.id, 'Second fictional held words.', w.world.window)
      w.world.turnWait = null
      running.release()
      await expect
        .poll(() => w.sent().some((text) => text.includes('Second fictional held words.')))
        .toBe(true)
      const batch = w.sent().find((text) => text.includes('Second fictional held words.'))!
      expect(batch).toContain('First fictional held words.')
      expect(batch.match(/Suggested file titles/g)).toHaveLength(1)
      expect(batch.indexOf('Sent by')).toBeLessThan(batch.indexOf('Suggested file titles'))
      expect(w.seen).toHaveLength(before + 1)
      expect(w.seen.at(-1)!.context.candidates).toEqual([
        {
          resourceId: w.resource.resource,
          version: 'd'.repeat(64),
          title: 'Canonical fictional recipe',
          pieceId: w.piece.piece,
        },
      ])
      expect(Object.keys(w.seen.at(-1)!.context).sort()).toEqual([
        'candidates',
        'pieceId',
        'turnId',
        'workspaceId',
      ])
      expect(JSON.stringify(w.turns())).not.toContain('Suggested file titles')
      expect(w.world.handles.get('writer')!.origins.at(-1)).toEqual({ kind: 'person' })
    })

    it('bypasses titles for a public provider command and for disabled title preferences without disabling A tools', async () => {
      const w = await connected(provider)
      const handle = w.world.handles.get('writer')!,
        prefix = provider === 'claude' ? '/' : '$'
      handle.commandsAnswer = {
        prefix,
        commands: [{ name: 'fictional', description: 'Fictional command.' }],
      }
      handle.simulateProviderCommands(
        { commands: [{ name: 'fictional', description: 'Fictional command.' }] },
        'fictional/commands',
        prefix,
      )
      await w.host.send(w.id, `${prefix}fictional`, w.world.window)
      expect(w.sent()).toEqual([`${prefix}fictional`])
      expect(w.seen).toHaveLength(0)
      await w.idle()
      await w.f.controller.setTitlesEnabled(w.f.handle, 'fictional-bakery', false)
      await w.host.send(w.id, 'Fictional ordinary words without titles.', w.world.window)
      expect(w.sent().at(-1)).not.toContain('Suggested file titles')
      expect(w.seen).toHaveLength(0)
      expect(w.world.launches[0]!.options.managedPluginMcp).toHaveLength(1)
      expect(w.f.state.getEnabled(w.f.local.sink.workspaceId, 'fictional-bakery').enabled).toBe(
        true,
      )
    })

    it('leaves inactive title preparation off direct, queued and interrupt handoffs on the public world', async () => {
      const w = await connected(provider, false, 'ask')
      await w.f.controller.setTitlesEnabled(w.f.handle, 'fictional-bakery', false)
      await w.host.send(w.id, 'Fictional inactive direct words.', w.world.window)
      await expect.poll(() => w.world.handles.get('writer')!.status()).toBe('waiting_permission')
      await w.host.send(w.id, 'Fictional inactive queued words.', w.world.window)
      await w.host.interrupt(w.id, w.world.window)
      await expect.poll(() => w.sent().length).toBe(2)
      await expect.poll(() => w.world.handles.get('writer')!.status()).toBe('waiting_permission')
      await w.host.sendInterrupting(w.id, 'Fictional inactive replacement words.', w.world.window)
      expect(w.sent()).toHaveLength(3)
      expect(w.sent().every((text) => !text.includes('Suggested file titles'))).toBe(true)
      expect(w.seen).toHaveLength(0)
      expect(w.world.handles.get('writer')!.origins).toHaveLength(3)
    })

    it('sends once at the unchanged 500ms title deadline, cancels that request only and ignores its late pointers', async () => {
      const w = await connected(provider),
        held = w.holdHook()
      const text = 'Fictional words with a late plugin callback.'
      const pending = w.host.send(w.id, text, w.world.window)
      await expect.poll(() => w.seen.length).toBe(1)
      await pending
      expect(w.sent().filter((one) => one.includes(text))).toHaveLength(1)
      expect(w.sent().at(-1)).not.toContain('Suggested file titles')
      await expect.poll(() => w.cancelled.mock.calls.length).toBe(1)
      expect(w.cancelled).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: w.f.local.sink.workspaceId,
          pluginId: 'fictional-bakery',
          instanceId: w.started[0]!.runId,
          requestId: w.seen[0]!.requestId,
        }),
      )
      const before = w.turns().length,
        sent = w.sent().length
      held.release()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(w.turns()).toHaveLength(before)
      expect(w.sent()).toHaveLength(sent)
    })

    it.each(['switch', 'titles'] as const)(
      'fences a held hook after its own %s revision changes through public controls',
      async (kind) => {
        const w = await connected(provider),
          held = w.holdHook()
        const pending = w.host.send(
          w.id,
          'Fictional words during a preference change.',
          w.world.window,
        )
        await expect.poll(() => w.seen.length).toBe(1)
        if (kind === 'switch') {
          await w.f.controller.setEnabled(w.f.handle, 'fictional-bakery', false)
          await w.f.controller.setEnabled(w.f.handle, 'fictional-bakery', true)
        } else await w.f.controller.setTitlesEnabled(w.f.handle, 'fictional-bakery', false)
        held.release()
        await pending
        expect(w.sent()).toHaveLength(1)
        expect(w.sent()[0]).not.toContain('Suggested file titles')
        expect(w.turns()).toHaveLength(1)
        expect(w.started).toHaveLength(1)
        expect(w.f.state.getEnabled(w.f.local.sink.workspaceId, 'fictional-bakery').enabled).toBe(
          true,
        )
      },
    )

    it('uses the existing direct Stop delivery route when Close arrives during a hook, with one fresh-life delivery', async () => {
      const w = await connected(provider),
        held = w.holdHook()
      const words = 'Fictional words preserved through Close.'
      const pending = w.host.send(w.id, words, w.world.window)
      await expect.poll(() => w.seen.length).toBe(1)
      await w.host.close(w.id, w.world.window)
      w.omitTitles()
      held.release()
      await pending
      await expect.poll(() => w.world.launches.length).toBe(2)
      expect(w.sent().filter((text) => text.includes(words))).toHaveLength(1)
      expect(w.world.handles.get('writer')!.origins).toHaveLength(1)
      expect(w.sent().at(-1)).not.toContain('Suggested file titles')
      expect(w.turns().filter((event) => JSON.stringify(event).includes(words))).toHaveLength(1)
      expect(w.seen).toHaveLength(2)
      expect(w.started).toHaveLength(1)
    })

    it('drops a detached Person consumer callback while another workspace keeps its own current title hook', async () => {
      const w = await connected(provider),
        held = w.holdHook()
      const other = await w.f.controller.attach(projection().sink)
      await w.f.controller.setTitlesEnabled(other, 'fictional-bakery', true)
      const pending = w.host.send(w.id, 'Fictional words during workspace detach.', w.world.window)
      await expect.poll(() => w.seen.length).toBe(1)
      await w.f.controller.detach(w.f.handle)
      const input = {
        turnId: randomUUID(),
        pieceId: w.piece.piece,
        candidates: w.world.store.pluginTitleCandidates!(w.piece.piece),
      }
      expect(await w.f.controller.hostBeforeTurn(other, input)).toEqual({
        pointers: [{ resourceId: w.resource.resource, version: 'd'.repeat(64) }],
      })
      held.release()
      await pending
      expect(w.sent()).toHaveLength(1)
      expect(w.sent()[0]).not.toContain('Suggested file titles')
      expect(w.started).toHaveLength(1)
      await w.f.controller.detach(other)
    })

    it.each(['update', 'restart'] as const)(
      'rejects the old hook after a public own-plugin %s and admits the next current run',
      async (action) => {
        const w = await connected(provider),
          held = w.holdHook()
        const pending = w.host.send(
          w.id,
          'Fictional words across a plugin run change.',
          w.world.window,
        )
        await expect.poll(() => w.seen.length).toBe(1)
        if (action === 'update') await w.install('2.0.0', 'update')
        else
          await w.f.controller.restartPluginTools('fictional-bakery', w.started[0]!.runId, () => {})
        held.release()
        await pending
        expect(w.sent()[0]).not.toContain('Suggested file titles')
        expect(w.started.filter((one) => one.pluginId === 'fictional-bakery')).toHaveLength(2)
        expect(w.started[1]!.runId).not.toBe(w.started[0]!.runId)
        await w.idle()
        await w.host.send(w.id, 'Fictional words on the replacement plugin run.', w.world.window)
        expect(w.sent().at(-1)).toContain('Canonical fictional recipe')
        expect(w.seen).toHaveLength(2)
        expect(w.turns()).toHaveLength(2)
      },
    )
  },
)

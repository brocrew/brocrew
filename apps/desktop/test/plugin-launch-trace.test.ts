import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  withManagedPluginAttachments,
  type AgentRuntime,
  type SessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import {
  attachmentTraceId,
  createRouteAdmissionTrace,
  recordRouteAdmissionTrace,
  type RouteAdmissionEvent,
} from '../src/main/plugins/route-admission-trace'
import { openManagedPluginRoute } from '../src/main/plugins/managed-transport'
import { pluginProviderFixture } from './fixtures/plugin-provider-fixture'

const closes: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
})
function output() {
  const root = mkdtempSync(join(tmpdir(), 'fictional-launch-trace-'))
  closes.push(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'plugin-route-admission.log')
  return {
    recordTrace: (event: RouteAdmissionEvent) => recordRouteAdmissionTrace(root, event),
    text: () => readFileSync(file, 'utf8'),
    rows: () =>
      readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as RouteAdmissionEvent),
  }
}
function provider(discovered = true) {
  const start = vi.fn(async (options: StartOptions) => {
    for (const server of options.managedPluginMcp ?? [])
      options.observeManagedPlugins?.({
        server: server.name,
        tools: discovered ? ['echo'] : [],
        outcome: discovered ? 'discovered' : 'unavailable',
      })
    return {
      status: () => 'idle',
      events: async function* () {
        yield* []
      },
      close: async () => {},
    } as unknown as SessionHandle
  })
  return {
    provider: 'codex',
    start,
    resume: vi.fn(async (_ref, options) => start(options)),
  } as unknown as AgentRuntime
}
const options = { cwd: '/fictional/work', providerHome: '/fictional/home' }

it.each(['empty', 'failed'] as const)(
  'persists an initial %s read at its stage on start and resume without secrets',
  async (outcome) => {
    const log = output()
    const owner = {
      recordTrace: log.recordTrace,
      agentRoutes: vi.fn(async () => {
        if (outcome === 'failed')
          throw new Error('Bearer fictional-private-token http://private.invalid/chat')
        return {
          format: 2 as const,
          value: { format: 2, servers: [], pending: ['fictional-plugin'], none: [], unknown: true },
        }
      }),
    }
    for (const resume of [false, true]) {
      const raw = provider()
      const runtime = withManagedPluginAttachments(
        raw,
        new WorkspacePluginAttachments(owner, randomUUID()).agent([]),
      )
      const handle = resume
        ? await runtime.resume(
            { provider: 'codex', sessionId: 'fictional-session', cwd: options.cwd, rotation: 0 },
            options,
          )
        : await runtime.start(options)
      closes.push(() => handle.close())
    }
    const rows = log.rows()
    expect(rows).toHaveLength(2)
    expect(
      rows.map(({ stage, outcome: result, serverCount }) => ({
        stage,
        outcome: result,
        serverCount,
      })),
    ).toEqual(Array.from({ length: 2 }, () => ({ stage: 'initial-read', outcome, serverCount: 0 })))
    expect(new Set(rows.map((row) => row.launch)).size).toBe(2)
    for (const row of rows) {
      expect(row.provider).toBe('codex')
      expect(row.launch).toMatch(/^[a-f0-9]{32}$/)
      expect(row.incarnation).toMatch(/^[a-f0-9]{32}$/)
      if (outcome === 'failed') expect(row.failureStage).toBe('attachment-read')
      else
        expect(row).toMatchObject({
          unknown: true,
          pending: [expect.stringMatching(/^[a-f0-9]{32}$/)],
        })
    }
    expect(log.text()).not.toMatch(/fictional|Bearer|http:|private|session/)
  },
)

it.each([true, false])(
  'joins configured route tools to provider discovery (healthy=%s)',
  async (discovered) => {
    const log = output()
    const fixture = await pluginProviderFixture()
    closes.push(() => fixture.close())
    const original = await fixture.route('fictional-original')
    let route: Awaited<ReturnType<typeof openManagedPluginRoute>> | undefined
    const owner = {
      recordTrace: log.recordTrace,
      agentRoutes: vi.fn(async (input: { incarnation: string; release?: boolean }) => {
        if (input.release) return { format: 1 as const, value: [] }
        const incarnation = attachmentTraceId(input.incarnation, 'incarnation', '')
        const trace = createRouteAdmissionTrace(log.recordTrace)(
          {
            incarnation,
            route: 'b'.repeat(32),
            plugin: attachmentTraceId(input.incarnation, 'plugin', 'fern'),
          },
          input.incarnation,
        )
        route = await openManagedPluginRoute(
          fixture.broker,
          original.agent,
          undefined,
          trace,
        )
        closes.push(() => route!.close())
        return {
          format: 2 as const,
          value: {
            format: 2,
            servers: [{ ...route.server, pluginId: 'fern' }],
            pending: [],
            none: [],
            unknown: false,
          },
        }
      }),
    }
    const runtime = withManagedPluginAttachments(
      provider(discovered),
      new WorkspacePluginAttachments(owner, randomUUID()).agent([]),
    )
    const handle = await runtime.start(options)
    closes.push(() => handle.close())
    const rows = log.rows()
    const configured = rows.find((row) => row.event === 'route-configured')!
    const discovery = rows.find((row) => row.event === 'launch-discovery')!
    expect(discovery).toMatchObject({
      provider: 'codex',
      stage: 'provider-discovery',
      outcome: discovered ? 'discovered' : 'unavailable',
      incarnation: configured.incarnation,
      attachmentRoute: configured.attachmentRoute,
      server: configured.server,
      plugin: configured.plugin,
      discoveredCount: discovered ? 1 : 0,
      discoveredTools: discovered ? configured.configuredTools : [],
    })
    expect(configured.configuredCount).toBe(1)
    const event = await handle.events()[Symbol.asyncIterator]().next()
    expect(event.value).toMatchObject({
      type: 'unknown',
      label: 'plugin/launch',
      raw: { launch: discovery.launch },
    })
    expect(rows.find((row) => row.stage === 'initial-read')).toMatchObject({
      outcome: 'configured',
      launch: discovery.launch,
      serverCount: 1,
    })
    for (const secret of [
      route!.server.capability,
      route!.server.url,
      route!.server.name,
      fixture.credential,
      'echo',
    ])
      expect(log.text()).not.toContain(secret)
  },
)

it('ignores a throwing launch observer without losing configured routes or changing launch count', async () => {
  const server = {
    name: 'plugin-fern',
    url: 'http://127.0.0.1:8123/mcp',
    capability: 'a'.repeat(64),
  }
  const raw = provider()
  const read = vi.fn(async () => ({ revision: 'fictional', servers: [server] }))
  const runtime = withManagedPluginAttachments(raw, {
    read,
    close: async () => {},
    observe() {
      throw new Error('fictional observer')
    },
  })
  const handle = await runtime.start(options)
  closes.push(() => handle.close())
  expect(raw.start).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ managedPluginMcp: [server] }),
  )
  expect(read).toHaveBeenCalledOnce()
})

it('persists only allowlisted launch fields and opaque ids even for a malformed observer event', () => {
  const log = output()
  log.recordTrace({
    process: 'a'.repeat(32),
    sequence: 1,
    event: 'launch-discovery',
    launch: 'fictional-token',
    incarnation: 'b'.repeat(32),
    stage: 'fictional-content',
    outcome: 'fictional-content',
    provider: 'fictional-content',
    failureStage: 'fictional-token',
    configuredTools: ['fictional-private-tool', 'c'.repeat(32)],
    discoveredTools: ['fictional-private-tool'],
    pending: ['fictional-personal-name'],
    configuredCount: -1,
    discoveredCount: Infinity,
    raw: 'Bearer fictional-private-token',
  } as unknown as RouteAdmissionEvent)
  expect(log.rows()).toEqual([
    expect.objectContaining({
      event: 'launch-discovery',
      incarnation: 'b'.repeat(32),
      configuredTools: ['c'.repeat(32)],
      discoveredTools: [],
      pending: [],
      failureStage: 'attachment-read',
    }),
  ])
  expect(log.text()).not.toMatch(/fictional|Bearer|Infinity/)
  expect(log.rows()[0]).not.toHaveProperty('configuredCount')
  expect(log.rows()[0]).not.toHaveProperty('discoveredCount')
})

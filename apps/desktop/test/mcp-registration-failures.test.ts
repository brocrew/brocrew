import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest'
import {
  discoverExternalMcpTools,
  ExternalMcpDiscoveryError,
  EXTERNAL_MCP_DISCOVERY_MS,
  FakeRuntime,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { registerRuntimeIpc } from '../src/main/runtime/ipc'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { createAgentStore, type AgentStore } from '../src/renderer/src/lib/agent-store'
import { RUNTIME_COMMAND_CHANNEL, type RuntimeBridge } from '../src/shared/runtime-ipc'

let folder: string
let db: AppDatabase
let host: RuntimeHost
let agents: AgentStore
const servers: Server[] = []
const methods: string[] = []
const rejected: unknown[] = []
let mainLog: MockInstance<typeof console.error>
let optionalGets = 0
const sink: RuntimeEventSink = {
  ownerId: 'fictional-mcp-window',
  aPersonIsBehindIt: true,
  alive: true,
  send: () => {},
  sendLiveness: () => {},
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brocrew-mcp-failure-'))
  db = openDatabase(join(folder, 'fictional.sqlite'))
  applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
  const store = createSessionStore(db)
  host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(folder, 'exports'),
    createRuntime: (provider) => new FakeRuntime(provider),
    prepareProviderHome: () => join(folder, 'fictional-provider-home'),
    providerHomePath: () => join(folder, 'fictional-provider-home'),
    resolveCwd: (session, cwd) => resolveSessionCwd(folder, session, cwd),
    newSessionId: () => 'fictional-mcp-session',
    now: () => 1000,
    readProviderConfig: () => ({
      home: folder,
      homeEnv: 'CODEX_HOME',
      model: 'fictional',
      authNote: null,
      files: [],
    }),
  })
  let listener: ((event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) | undefined
  registerRuntimeIpc({
    ipc: {
      handle: (channel, handle) => {
        expect(channel).toBe(RUNTIME_COMMAND_CHANNEL)
        listener = handle
      },
    },
    host,
    sinkFor: () => sink,
  })
  const registered = listener
  if (registered === undefined) throw new Error('The real IPC handler was not registered')
  mainLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  const bridge = {
    agentIdentities: async () => host.agentIdentities(),
    registerExternalMcpServer: async (input: {
      name: string
      url: string
      reach: 'everyone' | 'restricted'
    }) => {
      try {
        return await registered({} as IpcMainInvokeEvent, {
          kind: 'registerExternalMcpServer',
          ...input,
        })
      } catch (error) {
        rejected.push(error)
        // Electron logs the complete rejected object, not just its message.
        console.error(`Error occurred in handler for '${RUNTIME_COMMAND_CHANNEL}':`, error)
        throw error
      }
    },
  } as unknown as RuntimeBridge
  agents = createAgentStore(bridge)
  methods.length = 0
  rejected.length = 0
  optionalGets = 0
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  vi.restoreAllMocks()
  await host.closeAll()
  db.close()
  rmSync(folder, { recursive: true, force: true })
})

type Reply =
  | 'sse'
  | 'collision'
  | 'http'
  | 'invalid'
  | 'slow'
  | 'refused'
  | 'absent'
  | 'broken-sse-init'
  | 'broken-sse-tools'
  | 'bad-sse-envelope'
  | 'optional-get'

async function fictionalServer(reply: Reply): Promise<string> {
  const server = createServer((request, response) => {
    if (request.method !== 'POST') {
      optionalGets++
      response
        .writeHead(reply === 'optional-get' ? 500 : 405)
        .end('fictional optional stream refusal')
      return
    }
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      const message: { method: string; id?: number; params?: { protocolVersion?: string } } =
        JSON.parse(body)
      methods.push(message.method)
      if (reply === 'slow') return
      if (
        (reply === 'broken-sse-init' && message.method === 'initialize') ||
        (reply === 'broken-sse-tools' && message.method === 'tools/list') ||
        (reply === 'bad-sse-envelope' && message.method === 'tools/list')
      ) {
        const data =
          reply === 'bad-sse-envelope'
            ? JSON.stringify({ jsonrpc: 'fictional-bad-envelope' })
            : '{broken'
        response
          .writeHead(200, { 'Content-Type': 'text/event-stream' })
          .end(`event: message\ndata: ${data}\n\n`)
        return
      }
      if (reply === 'http') {
        response.writeHead(500).end('fictional internal detail must not reach the window')
        return
      }
      if (reply === 'invalid') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{broken')
        return
      }
      if (reply === 'refused') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32600, message: 'fictional MCP refusal' },
          }),
        )
        return
      }
      if (message.id === undefined) {
        response.writeHead(202).end()
        return
      }
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: message.params?.protocolVersion ?? '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'fictional', version: '1' },
            }
          : {
              tools: [
                {
                  name: reply === 'collision' ? 'list_profiles' : 'fictional_lookup',
                  inputSchema: { type: 'object' },
                },
              ],
            }
      response
        .writeHead(200, { 'Content-Type': 'text/event-stream' })
        .end(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`,
        )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fictional port missing')
  const url = `http://127.0.0.1:${address.port}/fictional/mcp`
  if (reply === 'absent') await new Promise<void>((resolve) => server.close(() => resolve()))
  else servers.push(server)
  return url
}

const register = (url: string, name = 'fictional') =>
  agents.registerExternalMcp({ name, url, reach: 'everyone' })

it('a fictional SSE server registers through the renderer store, IPC and host without a tool call', async () => {
  const url = await fictionalServer('sse')
  expect(await register(url)).toBeNull()
  expect(agents.identities.value?.externalMcpServers).toEqual([
    expect.objectContaining({ name: 'fictional', url, reach: 'everyone' }),
  ])
  expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
})

it.each([
  [
    'absent',
    (url: string) => `Couldn't reach the server at ${url}. Check that it's running and try again.`,
  ],
  [
    'http',
    (url: string) =>
      `The server at ${url} refused the MCP check (HTTP 500). Nothing was registered.`,
  ],
  [
    'invalid',
    (url: string) => `Couldn't read the server's MCP reply at ${url}. Nothing was registered.`,
  ],
  [
    'refused',
    (url: string) => `The server at ${url} refused the MCP check. Nothing was registered.`,
  ],
  ['slow', (url: string) => `The server at ${url} didn't answer in time. Nothing was registered.`],
] as const)(
  'a fictional %s server returns its distinct refusal through the real register path',
  async (reply, words) => {
    const url = await fictionalServer(reply)
    expect(await register(url)).toBe(words(url))
    expect(host.agentIdentities().externalMcpServers).toEqual([])
    expect(methods.every((method) => method === 'initialize')).toBe(true)
  },
  25000,
)

it('a refused address is reported without asking any server', async () => {
  expect(await register('http://example.invalid/mcp')).toContain('is not on this machine')
  expect(methods).toEqual([])
  expect(host.agentIdentities().externalMcpServers).toEqual([])
})

it('duplicate names and colliding tools return the existing exact host refusal', async () => {
  const url = await fictionalServer('sse')
  expect(await register(url)).toBeNull()
  expect(await register(url)).toBe(
    'There is already a server called fictional. Remove it first, or register this one under another name.',
  )
  const collision = await fictionalServer('collision')
  expect(await register(collision, 'other')).toContain('list_profiles')
  expect(await register(collision, 'other')).toContain('the whole server is refused')
  expect(host.agentIdentities().externalMcpServers).toHaveLength(1)
  expect(methods).not.toContain('tools/call')
})

it.each(['http', 'refused'] as const)(
  'a %s body is absent from the real IPC rejection and Electron-shaped log',
  async (reply) => {
    const url = await fictionalServer(reply)
    const words = await register(url)
    expect(words).toBe(
      `The server at ${url} refused the MCP check${reply === 'http' ? ' (HTTP 500)' : ''}. Nothing was registered.`,
    )
    expect(mainLog).toHaveBeenCalledTimes(1)
    expect(rejected).toHaveLength(1)
    const error = rejected[0]
    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) throw new Error('The IPC rejection was not an error')
    expect(Object.hasOwn(error, 'cause')).toBe(false)
    for (const rendered of [
      words,
      inspect(rejected, { depth: null }),
      inspect(mainLog.mock.calls, { depth: null }),
    ]) {
      expect(rendered).not.toContain('fictional internal detail must not reach the window')
      expect(rendered).not.toContain('fictional MCP refusal')
    }
    expect(host.agentIdentities().externalMcpServers).toEqual([])
  },
)

it.each(['broken-sse-init', 'broken-sse-tools', 'bad-sse-envelope'] as const)(
  '%s is unreadable promptly, rather than a deadline',
  async (reply) => {
    const url = await fictionalServer(reply)
    const started = performance.now()
    expect(await register(url)).toBe(
      `Couldn't read the server's MCP reply at ${url}. Nothing was registered.`,
    )
    expect(performance.now() - started).toBeLessThan(EXTERNAL_MCP_DISCOVERY_MS / 2)
    expect(host.agentIdentities().externalMcpServers).toEqual([])
    expect(methods).not.toContain('tools/call')
  },
)

it('a failed optional GET stream does not reject valid POST discovery replies', async () => {
  const url = await fictionalServer('optional-get')
  expect(await register(url)).toBeNull()
  expect(optionalGets).toBeGreaterThan(0)
  expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
  expect(host.agentIdentities().externalMcpServers).toHaveLength(1)
})

it.each(['http', 'refused'] as const)(
  'the %s discovery error itself contains only safe category metadata',
  async (reply) => {
    const url = await fictionalServer(reply)
    let error: unknown
    try {
      await discoverExternalMcpTools(url)
    } catch (failure) {
      error = failure
    }
    expect(error).toBeInstanceOf(ExternalMcpDiscoveryError)
    if (!(error instanceof ExternalMcpDiscoveryError))
      throw new Error('Missing classified discovery error')
    expect(error.kind).toBe('refused')
    expect(error.status).toBe(reply === 'http' ? 500 : null)
    expect(Object.hasOwn(error, 'cause')).toBe(false)
    expect(inspect(error, { depth: null })).not.toContain(
      'fictional internal detail must not reach the window',
    )
    expect(inspect(error, { depth: null })).not.toContain('fictional MCP refusal')
  },
)

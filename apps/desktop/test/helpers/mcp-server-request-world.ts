import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  FakeRuntime,
  FakeProviderSessions,
  type FakeSessionHandle,
  type StartOptions,
  type ResumeOptions,
  type SessionRef,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore } from '../../src/main/db/session-store'
import { archivedConversationsIn } from '../../src/main/archived-file'
import { NO_DISCOVERY } from '../../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'

export class McpRequestSink implements RuntimeEventSink {
  alive = true
  readonly messages: RuntimeEventMessage[] = []
  constructor(
    readonly ownerId = 'webContents:fixture',
    readonly aPersonIsBehindIt = true,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

export function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

export async function mcpRequestServer(tools = ['read_notes'], fail = false) {
  let connections = 0
  let requests = 0
  let responseWait: Promise<void> | null = null
  let heldResponses = 0
  let maximumHeldResponses = Infinity
  let failHeldResponses = false
  const http = createServer((req, res) => {
    requests++
    void (async () => {
      const held = responseWait !== null && heldResponses++ < maximumHeldResponses
      if (held) await responseWait
      if (fail || (held && failHeldResponses)) {
        res.writeHead(503)
        res.end('fictional server unavailable')
        return
      }
      const mcp = new McpServer({ name: 'fictional-notes', version: '1' })
      for (const name of tools)
        mcp.registerTool(name, { description: `Fictional ${name}` }, () => ({
          content: [{ type: 'text' as const, text: 'fictional notes' }],
        }))
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await mcp.connect(transport)
      res.on('close', () => void transport.close())
      await transport.handleRequest(req, res)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  http.on('connection', () => {
    connections++
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    holdUntil(promise: Promise<void>, most = Infinity) {
      responseWait = promise
      maximumHeldResponses = most
      heldResponses = 0
    },
    failHeldReplies() {
      failHeldResponses = true
    },
    get connections() {
      return connections
    },
    get requests() {
      return requests
    },
    async close() {
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}

export function mcpRequestWorld() {
  const folder = mkdtempSync(join(tmpdir(), 'brocrew-mcp-request-'))
  const work = mkdtempSync(join(tmpdir(), 'brocrew-mcp-request-work-'))
  const migrations = join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db/migrations')
  const issued = new FakeProviderSessions()
  let counter = 0
  let clock = 6_000_000
  let db = openDatabase(join(folder, 'fixture.sqlite'))
  applyMigrations(db, migrations)
  let store = createSessionStore(db, () => clock++)
  const hosts: RuntimeHost[] = []
  const oldDatabases: (typeof db)[] = []
  const servers: Awaited<ReturnType<typeof mcpRequestServer>>[] = []
  const releases: (() => void)[] = []
  const launches: {
    kind: 'start' | 'resume'
    profile: string
    options: StartOptions | ResumeOptions
  }[] = []
  const sent: { profile: string; text: string }[] = []
  const handles = new Map<string, FakeSessionHandle>()
  const window = new McpRequestSink()
  const world = {
    folder,
    work,
    window,
    launches,
    sent,
    handles,
    startWait: null as Promise<void> | null,
    startFailure: null as Error | null,
    turnWait: null as Promise<void> | null,
    get db() {
      return db
    },
    get store() {
      return store
    },
    gate() {
      const gate = deferred()
      releases.push(gate.release)
      return gate
    },
    async server(tools?: string[], fail = false) {
      const s = await mcpRequestServer(tools, fail)
      servers.push(s)
      return s
    },
    host(): RuntimeHost {
      class RecordingRuntime extends FakeRuntime {
        private async note(
          kind: 'start' | 'resume',
          options: StartOptions | ResumeOptions,
          make: () => Promise<FakeSessionHandle>,
        ) {
          const profile = basename(dirname(options.providerHome))
          launches.push({ kind, profile, options })
          if (world.startWait) await world.startWait
          if (world.startFailure !== null) throw world.startFailure
          const handle = await make()
          handles.set(profile, handle)
          const send = handle.send.bind(handle)
          handle.send = async (...args: Parameters<typeof send>) => {
            sent.push({ profile, text: args[0] })
            await send(...args)
          }
          const events = handle.events.bind(handle)
          const status = handle.status.bind(handle)
          let heldTurn = false
          handle.status = () => (heldTurn ? 'working' : status())
          handle.events = async function* () {
            for await (const event of events()) {
              if (event.type === 'turn' && world.turnWait) {
                heldTurn = true
                try {
                  await world.turnWait
                } finally {
                  heldTurn = false
                }
              }
              yield event
            }
          }
          return handle
        }
        override start(options: StartOptions) {
          return this.note('start', options, () => super.start(options))
        }
        override resume(ref: SessionRef, options: ResumeOptions) {
          return this.note('resume', options, () => super.resume(ref, options))
        }
      }
      const host = new RuntimeHost({
        store,
        archived: archivedConversationsIn(folder),
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(folder, 'exports'),
        createRuntime: (provider: Provider) => new RecordingRuntime(provider, { sessions: issued }),
        prepareProviderHome: (provider, profile = 'default') => {
          const home = join(folder, 'provider-homes', profile, provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider) => join(folder, 'provider-homes', provider),
        resolveCwd: (session, asked) => resolveSessionCwd(folder, session, asked),
        newSessionId: () => `fictional-session-${++counter}`,
        now: () => clock++,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
      hosts.push(host)
      return host
    },
    open(host: RuntimeHost, profile = 'writer', approvalMode: 'ask' | 'auto' = 'auto') {
      return host
        .createSession({ provider: 'claude', profileId: profile, cwd: work, approvalMode }, window)
        .then(({ sessionId }) => sessionId)
    },
    ledger(id: string) {
      return store.events(id).map((row) => row.event)
    },
    crashSnapshot() {
      const snapshot = join(folder, `crash-snapshot-${oldDatabases.length}.sqlite`)
      db.prepare('VACUUM INTO ?').run(snapshot)
      oldDatabases.push(db)
      db = openDatabase(snapshot)
      applyMigrations(db, migrations)
      store = createSessionStore(db, () => clock++)
      return world.host()
    },
    async restart() {
      for (const host of hosts.splice(0)) await host.closeAll()
      db.close()
      db = openDatabase(join(folder, 'fixture.sqlite'))
      applyMigrations(db, migrations)
      store = createSessionStore(db, () => clock++)
      return world.host()
    },
    async cleanup() {
      releases.forEach((release) => release())
      world.startWait = null
      world.turnWait = null
      world.startFailure = null
      for (const host of hosts) await host.closeAll()
      for (const server of servers) await server.close()
      db.close()
      oldDatabases.forEach((old) => old.close())
      rmSync(folder, { recursive: true, force: true })
      rmSync(work, { recursive: true, force: true })
    },
  }
  return world
}
export type McpRequestWorld = ReturnType<typeof mcpRequestWorld>

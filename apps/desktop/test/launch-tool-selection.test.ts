import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let root: string
let db: AppDatabase
let store: SessionStore
let host: RuntimeHost
let seen: (StartOptions | ResumeOptions)[]
let occupied: string[][]
const sink: RuntimeEventSink = {
  ownerId: 'fictional-window',
  aPersonIsBehindIt: true,
  alive: true,
  send() {},
  sendLiveness() {},
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-selected-tools-'))
  db = openDatabase(join(root, 'app.sqlite'))
  applyMigrations(db, migrations)
  store = createSessionStore(db, () => Date.UTC(2032, 0, 1))
  seen = []
  occupied = []
  const sessions = new FakeProviderSessions()
  class Watching extends FakeRuntime {
    constructor(provider: Provider) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions) {
      seen.push(options)
      return super.start(options)
    }
    override async resume(ref: SessionRef, options: ResumeOptions) {
      seen.push(options)
      return super.resume(ref, options)
    }
  }
  let counter = 0
  host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(root, 'exports'),
    createRuntime: (provider) => new Watching(provider),
    prepareProviderHome: (provider, profile = 'default') => {
      const home = join(root, 'homes', profile, provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider, profile = 'default') => join(root, 'homes', profile, provider),
    resolveCwd: (_id, requested) => requested ?? root,
    newSessionId: () => `fictional-${++counter}`,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'fictional-model',
      authNote: null,
      files: [],
    }),
    pluginAttachments: {
      agent(names) {
        occupied.push([...names])
        return {
          async read() {
            return { revision: 'fictional', servers: [] }
          },
          async close() {},
        }
      },
    },
  })
})
afterEach(async () => {
  await host.closeAll()
  db.close()
  rmSync(root, { recursive: true, force: true })
})

function server(name: string): ReturnType<SessionStore['externalMcpServersFor']>[number] {
  return { name, url: 'http://127.0.0.1:8124/mcp' } as ReturnType<
    SessionStore['externalMcpServersFor']
  >[number]
}

it('one launch uses the same granted servers for broker occupancy and the provider', async () => {
  let reads = 0
  const grants = vi
    .spyOn(store, 'externalMcpServersFor')
    .mockImplementation(() => [server(reads++ === 0 ? 'maple' : 'birch')])
  await host.createSession({ provider: 'claude', cwd: root }, sink)
  expect(seen.at(-1)?.externalMcp?.servers.map((one) => one.name)).toEqual(['maple'])
  expect(occupied.at(-1)).toEqual(['brobot', 'maple'])
  expect(grants).toHaveBeenCalledTimes(1)
})

it('resume and the panel share the launch resolver and observe withdrawn grants', async () => {
  let allowed = true
  const grants = vi
    .spyOn(store, 'externalMcpServersFor')
    .mockImplementation(() => (allowed ? [server('maple')] : []))
  const created = await host.createSession({ provider: 'claude', cwd: root }, sink)
  expect(seen.at(-1)?.externalMcp?.servers.map((one) => one.name)).toEqual(['maple'])
  const first = await host.whatThisAgentWasGiven(created.sessionId)
  expect(first.externalServers.map((one) => one.name)).toEqual(['maple'])
  await host.close(created.sessionId, sink)
  allowed = false
  grants.mockClear()
  await host.resumeSession(created.sessionId, sink)
  expect(seen.at(-1)).not.toHaveProperty('externalMcp')
  expect(occupied.at(-1)).toEqual(['brobot'])
  expect(grants).toHaveBeenCalledTimes(1)
  const panel = await host.whatThisAgentWasGiven(created.sessionId)
  expect(panel.externalServers).toEqual([])
  expect(panel.tools).toBeDefined()
})

it('an unidentified launch selection grants no external server even if the workspace has one', () => {
  const grants = vi.spyOn(store, 'externalMcpServersFor').mockReturnValue([server('ungranted')])
  const select = Reflect.get(host, 'selectedToolsForSession') as (
    id: string,
    provider: Provider,
    profile: string | null,
  ) => StartOptions
  const selected = select.call(host, 'fictional-unidentified', 'claude', null)
  expect(selected).not.toHaveProperty('externalMcp')
  expect(grants).not.toHaveBeenCalled()
})

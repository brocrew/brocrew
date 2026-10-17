import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  CAPABILITY_COLUMNS,
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
} from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **376 · a second project, and the grant the app gives itself** — Slice 4 P2c and HO-016 §2.
 *
 * ## ⚑ D-016 · the second project is gone, and the grant is what is left
 *
 * ⛔ **`D-016` took projects out** — the create door, placement at `createSession`, a project's
 * folder, `list_agents(project)`, `spawn_agent`'s `project` and the `same-project` reach — so §2 and
 * §5 went whole. ⛔ **Commit 3 made the database ONE migration** (`0000_the_tree.sql`): the `project`
 * table went, so §1's fold over its rows went with it, and there is no `0020` and no upgrade path, so
 * §6 went too. ⚑ **§3 stays** because it was never about a project: it is the grant, as a fresh
 * database writes it.
 *
 * ## ⛔ What this dispatch existed to make true, and the half that is left
 *
 * **A fresh install seeds nothing (D-014)**: BroBot's row is created with nothing chosen, exactly as
 * every other identity's is, and follows the one default set.
 *
 *  - **§3** BroBot's first row, read column by column — a resolved default would also pass over a
 *    seed that wrote today's default.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real IPC boundary.** The only double is the
 * provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('376 · a second project, and the grant the app gives itself', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  /** ⚠️ One registry for every runtime this suite builds — see `374`'s `issued`. */
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-second-project-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-second-project-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // ⚑ Past the migration's own wall clock (the policy row's `updated_at` is `strftime('%s','now')`).
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  /** `423`'s *New conversation as …* — a person opens a conversation as an identity. */
  const personOpens = async (profileId: string): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider: 'claude',
      profileId,
      approvalMode: 'ask',
      cwd: root,
    })) as { sessionId: string }
    return opened.sessionId
  }

  const rawColumn = (slug: string, column: string): unknown =>
    (
      db.prepare(`SELECT ${column} AS value FROM agent_identity WHERE slug = ?`).get(slug) as
        { value: unknown } | undefined
    )?.value

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · ⚑ gone at `D-016` commit 3 — the `project` table is not in the one migration, so there is
  // no project row to fold and no `projectRowId` to re-derive it.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · ⚑ gone at `D-016` — a project a person made, and a conversation that landed in it. The
  // create door, project placement at `createSession`, the project folder a launch inherited and the
  // roster are all deleted, and every case here was about one of them.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · no seed: BroBot's row is every identity's row
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · BroBot is created with nothing chosen, as every identity is', () => {
    /**
     * 🔴 **D-014 · one default set, and no rule names an agent.** ⛔ BroBot's first run writes the
     * row any identity's first run writes: every capability column NULL, so every grant follows the
     * ruled default. ⚠️ Read as COLUMNS, because a resolved default would also pass
     * over a seed that wrote today's default.
     */
    it('🔴 BroBot’s first run writes a row that has chosen NOTHING — column for column another identity’s', async () => {
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)).toBeNull()
      await personOpens(DEFAULT_PROFILE_ID)
      await personOpens('explorer')
      const nothingChosen = Object.fromEntries(
        CAPABILITY_FIELDS.map((field) => [field.key, 'default']),
      )
      for (const slug of [DEFAULT_PROFILE_ID, 'explorer']) {
        expect(store.capabilitiesOf(slug), slug).toEqual(DEFAULT_CAPABILITIES)
        const identity = store.agentIdentities().find((one) => one.slug === slug)
        expect(identity?.chosen, slug).toEqual(nothingChosen)
        for (const column of CAPABILITY_COLUMNS) {
          expect(rawColumn(slug, column), `${slug}.${column}`).toBeNull()
        }
      }
      // ⚑ **The control**: the same read sees a person's own save, so the NULLs above are the rows
      // and not the reader.
      expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' })).toBe(true)
      expect(rawColumn(DEFAULT_PROFILE_ID, 'can_message')).toBe('none')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · ⚑ gone at `D-016` — `list_agents(project)`, one identity bound to two projects, a spawn
  // inheriting its parent's project, the `same-project` command tree and `spawn_agent`'s `project`
  // argument. Projects, the filter, the argument and the `same-project` reach are all deleted.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §6 · ⚑ gone at `D-016` commit 3 — migration `0020`'s grant on upgrade. The database is ONE
  // migration, so there is no database from before it to upgrade.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
})

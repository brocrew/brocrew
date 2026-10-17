import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  agentIdentityRowId,
  identityCreatorColumn,
  readIdentityCreator,
} from '../src/main/db/identity'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  IDENTITY_ORIGINS,
  type IdentityCreator,
  type RuntimeEventMessage,
  type SessionInstructions,
} from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(here, '../src')
const migrationsFolder = join(srcRoot, 'main/db/migrations')

const NOTHING_INJECTED: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
}

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

class WatchingRuntime extends FakeRuntime {
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

/** ⚑ One `an-agent` creator, folded — see `AgentIdentity.createdBy`. */
const by = (agent: string): IdentityCreator => ({ by: 'an-agent', agent })

/**
 * 🔴 **598 · THE GRANT COVERS WHAT IT CREATED** — `HO-084` §1, from `HO-083` §1's measurement.
 *
 * ## ⛔ What was found, and it was found by the product running as itself
 *
 * ⚠️ **BroBot, managing a real project, read its own `list_profiles` and reported two identities it
 * could run as**: `trip-planning-pm` (**Ada**), which it had created, and `trip-destination-scout`
 * (**Ali**), which **Ada** had created and BroBot had never seen. ⛔ Its grant was
 * `any-this-app-does-not-seed`, which is true of every agent in the product — **including a
 * subordinate's own staff.**
 *
 * ⚑ **And a standing instruction said the opposite in the same session** — *leave the agents under
 * a project manager to that project manager*. 🔴 **BroBot's own sentence for it is the finding:**
 * *"Two mechanisms pointing opposite ways, with nothing but compliance in between."*
 *
 * ## 🔴 The fact the ruling turns on did not exist, and could not be derived
 *
 * ⛔ **`agent_identity` had no creator column, and the ledger has no identity-creation event** —
 * `create_agent` inserts a row and publishes nothing. ⚠️ So *who created this* was not a fold away;
 * it was absent. ⚑ `a-derivation-cannot-answer-what-its-ledger-does-not-contain` is the rule, and
 * the repair WRITES the difference at construction: `created_by`, one column.
 *
 * ## ⛔ D-014 · the rail that read it is gone, and the fact stays
 *
 * ⚠️ **The staffing reach (`can_staff`) and every grant that folded `created_by` into a refusal or
 * a listing were removed**: any agent may start a conversation as any identity that exists, and
 * `list_profiles` lists every identity. ⚑ **`created_by` is still WRITTEN at every door and read
 * back on `AgentIdentity.createdBy`** — it is a fact about a row's birth, and what this file keeps
 * is that the fact is recorded and read back honestly.
 *
 * ## ⚠️ What each section is for
 *
 * - **§1** the fact — every writer of an identity row records who, and the census is over the
 *   WRITERS rather than over the type (`a-payload-census-must-read-call-sites-not-types`).
 * - **§2** what NULL means, decided rather than fallen through.
 * - **§7** the encoding, and the hazard only a hand-edited database can plant.
 */
describe('598 · the grant covers what it created', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let handed: AgentToolset[]
  let counter: number
  let window: Sink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-598-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-598-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    sessions = new FakeProviderSessions()
    window = new Sink('webContents:1')
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new WatchingRuntime(provider, handed, sessions),
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
      readInstructions: () => ({
        instructions: NOTHING_INJECTED,
        systemHint: undefined,
        memoryLoaded: null,
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  const openAndClose = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const toolsJustHanded = (): AgentToolset => {
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no launch was handed a toolset')
    return one
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /**
   * ⚑ **Who created this identity, as the store reads it back** — `AgentIdentity.createdBy` off
   * `SessionStore.agentIdentities()`. ⚠️ `undefined` is *no such row* and `null` is *a row that
   * recorded nobody*, so a strict `toBeNull` cannot pass on a missing row.
   */
  const createdByOf = (slug: string): IdentityCreator | null | undefined =>
    store.agentIdentities().find((one) => one.slug === slug)?.createdBy

  const creatorColumn = (slug: string): unknown =>
    (
      db.prepare('SELECT created_by AS value FROM agent_identity WHERE slug = ?').get(slug) as
        { value: unknown } | undefined
    )?.value ?? null

  /** ⚑ Source with block comments and line comments stripped — `codeOf`'s rule, one file over. */
  const codeOf = (file: string): string =>
    readFileSync(join(srcRoot, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the fact this app had never written down
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · every writer of an identity row records WHO', () => {
    it('🔴 the person’s door records `a-person`, and the agent’s door records the agent', async () => {
      // ⛔ **The two doors, in one sample, because the whole repair is that they DIFFER.**
      // ⚑ `RuntimeHost.createAgent` is the window's and HO-005 leaves it ungated;
      // `RuntimeHost.createAgentFor` is an agent's and meets three rails — and until `598` the row
      // each of them wrote was byte-identical, which is why nothing could tell them apart.
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      void brobot
      host.createAgent({ slug: 'typed-by-hand', displayName: null, provider: null })
      expect(creatorColumn('typed-by-hand')).toBe('a-person')
      expect(createdByOf('typed-by-hand')).toEqual({ by: 'a-person' })

      const made = await callOn(toolsJustHanded(), 'create_agent', { profile_slug: 'made-by-bot' })
      expect(made.outcome, JSON.stringify(made)).toBe('ok')
      expect(creatorColumn('made-by-bot')).toBe(agentIdentityRowId(DEFAULT_PROFILE_ID))
      expect(createdByOf('made-by-bot')).toEqual(by(DEFAULT_PROFILE_ID))
    })

    it('⚑ a LAUNCH records `this-app`, and never whoever happened to be in the conversation', async () => {
      // 🔴 **The clause with the most room to go wrong, asserted rather than argued.** ⛔ A row
      // minted because a conversation started could plausibly be attributed to the spawner — and
      // that is `370`'s infer-from-an-accident defect with a RAIL reading the result: whoever
      // tripped over the name first would hold a grant nobody gave them.
      await openAndClose(DEFAULT_PROFILE_ID)
      expect(creatorColumn(DEFAULT_PROFILE_ID)).toBe('this-app')
      expect(createdByOf(DEFAULT_PROFILE_ID)).toEqual({ by: 'this-app' })

      // ⚑ **The control in the same sample**: an identity a person creates is `a-person`, so
      // `this-app` above is a distinction this column really draws rather than its only value.
      host.createAgent({ slug: 'a-second', displayName: null, provider: null })
      expect(creatorColumn('a-second')).toBe('a-person')
    })

    // ⚑ **D-016** — the third door, *an APPROVED proposal records the proposer*, is gone with
    // proposals: `create_project` and `decideProposal` no longer exist, so no identity row is
    // written on a person's press for an agent's ask.

    it('🔴 the CENSUS: every call site that writes an identity row supplies a creator', () => {
      // ⛔ **Over the WRITERS and not over the type** — `a-payload-census-must-read-call-sites-not-types`:
      // the column is required by the signature, so a type-shaped census would pass on a tree where
      // one door quietly passed `{ by: 'this-app' }` for an agent. ⚑ **This asks what each call
      // site SAYS.**
      const storeCode = codeOf('main/db/session-store.ts')
      // ⚠️ **The one writer of the row**, and the argument is REQUIRED — so a fourth writer cannot
      // be added without deciding what it records, which is `SaidAtCreation`'s own property moved
      // onto a fact the caller cannot decline to mention.
      expect(storeCode).toContain('broughtIntoBeingBy: IdentityCreator,')
      expect(storeCode).toContain('identityCreatorColumn(broughtIntoBeingBy)')
      // ⛔ **A launch is the app's, spelled at the one call site that means it**, and it does not
      // read the caller. ⚑ D-014 removed the seeded grants, whose targets were the second.
      expect(storeCode.split("{ by: 'this-app' }").length - 1).toBe(1)

      const hostCode = codeOf('main/runtime/runtime-host.ts')
      // ⚑ **The person's door**, and the only place in the host that says so.
      expect(hostCode).toContain("createAgentIdentity(said, { by: 'a-person' })")
      // ⚑ **The agent's door reads the grant door's own answer**, so *who is asking* is answered
      // once — see `MayCreateAgents`.
      expect(hostCode).toContain('createAgentIdentity({ ...said, provider }, may.creator)')
      // ⚑ **D-016** — the proposal door, which named the proposer, went with proposals.
      // 🔴 **The control the census needs** (standing rule 12, planting TWO): a phrase that is
      // genuinely absent, so the reads above are bytes rather than a matcher that agrees with
      // everything.
      expect(hostCode).not.toContain("createAgentIdentity(said, { by: 'this-app' })")
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what NULL means
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · an unrecorded creator is a decided answer', () => {
    it('⚑ a row that recorded no creator really is NULL, and the reader hands that on intact', () => {
      // ⛔ **A row written with no `created_by` at all** — the column is nullable and carries no
      // CHECK, so a row no door wrote holds one. ⚠️ `put-the-hazard-on-the-path-the-code-walks`:
      // the null is in the table rather than argued about. ⚑ **No backfill could fill it**: the
      // only statement available would claim `this-app` for a row it cannot know the maker of, and
      // a claim written into a ledger is worse than a null if it is wrong.
      db.prepare(
        'INSERT INTO agent_identity (id, slug, display_name, created_at) VALUES (?, ?, NULL, ?)',
      ).run(agentIdentityRowId('from-before'), 'from-before', 1)
      expect(creatorColumn('from-before')).toBeNull()
      expect(createdByOf('from-before')).toBeNull()
      // ⛔ **The schema half, which is what makes that null legal**: `created_by` carries no CHECK
      // and no REFERENCES — for `0017`'s price, and because *what happens to the rows an agent
      // created when that agent is removed* is a ruling nobody has made. ⚑ Read off the table the
      // migration built, so an unknown creator is as legal as a missing one.
      const ddl = (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_identity'")
          .get() as { sql: string }
      ).sql
      expect(
        ddl
          .split('\n')
          .filter((line) => line.includes('created_by'))
          .map((line) => line.trim()),
      ).toEqual(['`created_by` text,'])
      const foreignKeys = db
        .prepare(`SELECT "from" FROM pragma_foreign_key_list('agent_identity')`)
        .all() as { from: string }[]
      expect(foreignKeys.map((one) => one.from)).not.toContain('created_by')
      // ⚑ **The control**: the same table DOES carry CHECKs — the capability columns' — so the
      // absence above is a fact about this column rather than about how the table is written.
      expect(ddl).toMatch(/CONSTRAINT "agent_identity_can_message_ck" CHECK\(/)
      // ⚑ **The control in the same read**: a row written through a door carries one, so `null`
      // above is a state this reader distinguishes rather than its only answer.
      host.createAgent({ slug: 'from-today', displayName: null, provider: null })
      expect(createdByOf('from-today')).toEqual({ by: 'a-person' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the encoding, and one hazard only a hand-edit can plant
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the column, read back', () => {
    it('⚑ every origin round-trips, and the three shapes cannot collide', () => {
      // ⛔ **`db/identity.ts` owns both halves**, so the prefix is derived once — and `:` cannot
      // appear in a slug, which is what makes an `aid:` value unmistakable for the two bare words.
      for (const origin of IDENTITY_ORIGINS) {
        const creator: IdentityCreator =
          origin === 'an-agent' ? by('a-person') : ({ by: origin } as IdentityCreator)
        expect(readIdentityCreator(identityCreatorColumn(creator)), origin).toEqual(creator)
      }
      // 🔴 **The collision that cannot happen, planted rather than argued**: an agent whose SLUG is
      // one of the words is stored as `aid:a-person` and reads back as that agent.
      expect(readIdentityCreator(identityCreatorColumn(by('a-person')))).toEqual(by('a-person'))
      expect(readIdentityCreator('a-person')).toEqual({ by: 'a-person' })
    })

    it('⛔ a value this app cannot read folds to NULL, which is the refusing direction', () => {
      // ⚠️ **`parseChoice`'s rule one column over**, and here the least-claiming reading is *nobody
      // recorded it*. ⛔ A hand-edit cannot put a claim about who acted into a row.
      expect(readIdentityCreator('the-cat')).toBeNull()
      expect(readIdentityCreator('aid:')).toBeNull()
      expect(readIdentityCreator(null)).toBeNull()
      // ⚑ **Through the STORE, on a row a hand-edit really wrote** — a fold asserted only on the
      // function is a fold nothing proves the store calls.
      host.createAgent({ slug: 'edited', displayName: null, provider: null })
      db.prepare('UPDATE agent_identity SET created_by = ? WHERE slug = ?').run('the-cat', 'edited')
      expect(createdByOf('edited')).toBeNull()
    })
  })
})

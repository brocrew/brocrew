import { neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
import type { SessionInstructions } from '../src/shared/instruction-contracts'
import { performance } from 'node:perf_hooks'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  SEEDED_PROVIDERS,
  agentName,
  type AgentIdentity,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'
import { HUMAN_NAMES, aNameForANewAgent } from '../src/shared/human-names'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1) — a name somebody CREATES, not one this app ships.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/**
 * 🔴 **584 · the name this app assigns first, read from the generator and never typed here**
 * (`HO-078` §5, `human-names.ts`).
 */
const FIRST_NAME = aNameForANewAgent([], Math.random)

/**
 * # 🔴 538 · a name the app mints for itself
 *
 * ## ⛔ The defect, in one sentence, and it is `537` F5 rather than a new reading
 *
 * ⚠️ **Every identity this app minted for ITSELF got `displayName: null`** — a spawn target is
 * minted *"having said NOTHING of the CALLER's"*, a launch *"says NOTHING about the three facts a
 * creation says"*, and the only two doors that ever wrote one are a person at `NewAgent` and an
 * agent passing the OPTIONAL `display_name` to `create_agent`. ⛔ So the project manager this app
 * brings into being to hold BroBot's own seeded grant had no name, {@link agentName} fell through
 * to {@link profileLabel}, and `537`'s repair — every surface asking the app's one naming function
 * — got back the bare slug.
 *
 * App-created identities display their role names, such as “Project Manager”, rather than the
 * provider name.
 *
 * ## ⚑ The property
 *
 * > **An identity this app brought into being has a name a person can read, and it is the SAME
 * > word on every surface that names it.**
 *
 * ⚠️ **The second half is drawn rather than derived**, so it lives in
 * `a-name-on-every-surface.render.test.ts` — a component census cannot be run from node
 * (`a-test-that-imports-an-sfc-is-a-renderer-file`). **This file is the first half and the
 * mechanism**: who writes the column, when, from which table, and every door that must NOT.
 *
 * ## ⛔ What is deliberately absent, and it is a ruling rather than a gap
 *
 * There is no migration or back-fill: §4 asserts that the seed affects fresh installs only,
 * so the omission cannot silently become a compatibility promise.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '../src')
const migrationsFolder = join(SRC, 'main/db/migrations')

/** ⛔ This file is about a NAME, never about what a launch is told. */
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
  readonly aPersonIsBehindIt: boolean = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

const traceFixturePhase = <T>(phase: string, operation: () => T): T => {
  const began = performance.now()
  const emit = (event: string, outcome?: string): void => {
    console.log(
      JSON.stringify({
        fixture: 'name-setup',
        phase,
        event,
        outcome,
        atMs: performance.now(),
        elapsedMs: performance.now() - began,
      }),
    )
  }
  emit('begin')
  try {
    const value = operation()
    if (value instanceof Promise) {
      void value.then(
        () => {
          emit('end', 'fulfilled')
        },
        () => {
          emit('end', 'rejected')
        },
      )
      return value
    }
    emit('end', 'returned')
    return value
  } catch (error) {
    emit('end', 'threw')
    throw error
  }
}

describe('538 · a name the app mints for itself', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let window: Sink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = traceFixturePhase('user-data-temp', () =>
      mkdtempSync(join(tmpdir(), 'brobot2-538-')),
    )
    work = traceFixturePhase('work-temp', () => mkdtempSync(join(tmpdir(), 'brobot2-538-work-')))
    db = traceFixturePhase('database-open', () => openDatabase(join(userData, 'brobot2.sqlite')))
    traceFixturePhase('migrations', () => applyMigrations(db, migrationsFolder))
    clock = 5_000_000
    store = traceFixturePhase('store-create', () => createSessionStore(db, tick))
    counter = 0
    sessions = new FakeProviderSessions()
    host = traceFixturePhase(
      'host-create',
      () =>
        new RuntimeHost({
          store,
          ...neutralHostDeps(() => userData),
          createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
          prepareProviderHome: (provider: Provider, profileId?: string) => {
            const home = join(
              userData,
              'provider-homes',
              'default',
              profileId ?? 'default',
              provider,
            )
            mkdirSync(home, { recursive: true })
            return home
          },
          providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
          resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
          newSessionId: () => `sess_${++counter}`,
          now: tick,
          readProviderConfig: fixtureProviderConfig,
          readInstructions: () => ({
            instructions: NOTHING_INJECTED,
            systemHint: undefined,
            memoryLoaded: null,
          }),
        }),
    )
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, provider: Provider = 'codex'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  const nameColumn = (slug: string): string | null | undefined =>
    (
      db.prepare('SELECT display_name FROM agent_identity WHERE slug = ?').get(slug) as
        { display_name: string | null } | undefined
    )?.display_name

  const roster = (): readonly AgentIdentity[] => host.agentIdentities().identities

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the property, through the door a first install actually goes through
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the identity this app mints for itself has a name', () => {
    /**
     * 🔴 **584 · RE-AIMED, and the two sentences say why** (standing rule 26).
     *
     * ⛔ **This test read *a first launch mints the project manager WITH the name a person
     * reads*.** ⚑ `HO-078` §1 stopped shipping that identity, so the SUBJECT is gone — and
     * `HO-078` §5 replaced the one-row seed with a generator, so the PROPERTY generalised: **every
     * identity this app mints for itself has a name a person reads**, rather than the one it
     * happened to ship. ⚠️ Stripping the assertion would have left this file green over a world
     * where nothing was named at all.
     *
     * ⛔ **This is a fresh install, exactly**: migrated database, empty `agent_identity`, and the
     * first thing that happens is a person opening a conversation as an agent nobody created.
     */
    it('🔴 a launch mints an identity WITH the name a person reads', async () => {
      // ⚑ **The premise, asserted**: nothing was there, so what follows is this launch's doing and
      // not a migration's (`a-fixture-must-not-depend-on-the-subject-removing-its-evidence`).
      expect(db.prepare('SELECT slug FROM agent_identity').all()).toEqual([])

      await personOpens('archivist')

      expect(nameColumn('archivist')).toBe(FIRST_NAME)
      // 🔴 …and the app's ONE naming function reads it back, which is the half a column cannot
      // state: `agentName` is what every identity surface asks since `449`/`537`.
      expect(agentName('archivist', roster())).toBe(FIRST_NAME)
    })

    /**
     * ⚑ **The SECOND identity gets the SECOND name** — which is what *uniqueness at assignment*
     * means when nothing has been renamed (`HO-078` §5.2). ⛔ A generator that answered the same
     * word twice would pass the test above and ship a roster of identical handles.
     */
    it('⚑ …and a second one gets the next name, never the first again', async () => {
      await personOpens('archivist')
      await personOpens('courier')
      expect(nameColumn('archivist')).toBe(HUMAN_NAMES[0])
      expect(nameColumn('courier')).toBe(HUMAN_NAMES[1])
    })

    /**
     * ⛔ **The paired negative, and it is what makes the two above measurements.** ⚑ BroBot's own
     * row is minted by the same launch path and gets NO name — {@link profileLabel} already
     * answers *BroBot (default)* for that slug with a roster and without one, so a generated handle
     * there would be a second answer to a question this app already answers (see §3).
     */
    it('⛔ BroBot is minted NAMELESS by the same door, which is what makes the rest a measurement', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      expect(nameColumn(DEFAULT_PROFILE_ID)).toBeNull()
      expect(agentName(DEFAULT_PROFILE_ID, roster())).toBe(DEFAULT_PROFILE_LABEL)
      // 🔴 **And it is the ONLY row** — `HO-078` §1's whole ruling, asserted at the door a fresh
      // install actually walks. ⚠️ Before `584` this launch minted `project-manager` beside it,
      // as the target of a start grant this app seeded for BroBot.
      expect(db.prepare('SELECT slug FROM agent_identity').all()).toEqual([
        { slug: DEFAULT_PROFILE_ID },
      ])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · where the seed is RESOLVED, and the doors that must not read it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the creation door does not consult it, and 433 is why', () => {
    /**
     * 🔴 **`339`'s `.nullable()` ruling makes *the caller did not mention it* and *the caller said
     * null* ONE value**, which is right for a wire and wrong for a seed. ⛔ At the creation door
     * that value MEANS something — `NewAgent.vue` sends `name.value.trim() === '' ? null : …`, so
     * a person who left the box empty has ANSWERED — and `433` settled this one column over by
     * resolving the seed at the call site that means it rather than inside the row writer.
     *
     * ⚠️ **Reachable because `agent_identity` is EMPTY on a fresh database** (`423`'s finding):
     * `0018` seeds only where a launch already wrote an `agent_profile` row and `0025` only where
     * `default` exists, so nothing has minted the project manager yet and the creation door is the
     * first writer.
     */
    it('🔴 584 · a creation that names nobody gets the APP’s name, and it is a REVERSAL', () => {
      expect(db.prepare('SELECT slug FROM agent_identity').all()).toEqual([])

      const made = store.createAgentIdentity(
        {
          slug: PROJECT_MANAGER_PROFILE_ID,
          displayName: null,
          provider: null,
        },
        { by: 'a-person' },
      )

      expect(made?.slug).toBe(PROJECT_MANAGER_PROFILE_ID)
      // 🔴 **This asserted `toBeNull()` until `584`, on `538`'s argument that an omission was the
      // model ANSWERING** — *"Omit if you have nothing better than the name above"*. ⛔ **`HO-078`
      // §5 took the question away from the model**: `create_agent` advertises no such field, so
      // there is no answer left to overrule and the app assigns. ⚠️ **Written as a reversal rather
      // than as a new fact**, because the old behaviour was reasoned and somebody will look for it.
      expect(nameColumn(PROJECT_MANAGER_PROFILE_ID)).toBe(FIRST_NAME)
    })

    /**
     * ⛔ **And a later launch does not rename it** — `INSERT OR IGNORE` is the whole mechanism, and
     * standing rule 11 is what it buys: the app may seed a default at creation and never
     * overwrites what somebody decided afterwards.
     *
     * 🔴 **584 · the row this pins is the one a PERSON emptied**, which is the shape rule 11 is
     * actually about: the generator runs at creation, `setAgentDisplayName(null)` is a person
     * taking the name away, and no launch afterwards puts one back.
     */
    it('⛔ …and a launch afterwards never re-names an identity a person emptied', async () => {
      store.createAgentIdentity(
        {
          slug: PROJECT_MANAGER_PROFILE_ID,
          displayName: null,
          provider: null,
        },
        { by: 'a-person' },
      )
      // ⚑ The premise: there really was a name to take away, so the null below is the person's.
      expect(nameColumn(PROJECT_MANAGER_PROFILE_ID)).toBe(FIRST_NAME)
      store.setAgentDisplayName(PROJECT_MANAGER_PROFILE_ID, null)
      expect(nameColumn(PROJECT_MANAGER_PROFILE_ID)).toBeNull()

      await personOpens(PROJECT_MANAGER_PROFILE_ID)
      expect(
        nameColumn(PROJECT_MANAGER_PROFILE_ID),
        'a launch re-granted a name the person removed',
      ).toBeNull()
    })

    /**
     * ⚑ **The positive control for the pair above**: the door really can write this column, so the
     * nulls are a decision about WHICH door rather than a store that cannot answer.
     */
    it('⚑ the same door writes the name it IS given, and a later launch keeps that too', async () => {
      store.createAgentIdentity(
        {
          slug: PROJECT_MANAGER_PROFILE_ID,
          displayName: 'The Boss',
          provider: null,
        },
        { by: 'a-person' },
      )
      await personOpens(PROJECT_MANAGER_PROFILE_ID)
      expect(nameColumn(PROJECT_MANAGER_PROFILE_ID)).toBe('The Boss')
      expect(agentName(PROJECT_MANAGER_PROFILE_ID, roster())).toBe('The Boss')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · `default` is deliberately NOT in the table
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · why the default profile has no entry', () => {
    /**
     * 🔴 **The brief asked for both built-in slugs and the answer is one**, and the reason is a
     * measurement rather than a preference.
     *
     * ⛔ **{@link profileLabel}'s hard-coded pair is not a second answer to this question.** It is
     * the answer for a caller with NO ROSTER — the second argument of {@link agentName} is
     * nullable for exactly that, *"before the read lands and on a host with no database"* — and a
     * row in a database cannot reach that caller. ⚑ So a `default` entry would leave the pair
     * precisely where it is and add a second writer of one fact.
     *
     * ⚠️ **{@link SEEDED_PROVIDERS} refused this exact shape first**: *"A seed equal to
     * `RuntimeScreen`'s `DEFAULT_PROVIDER` is not a seed; it is a backfill. It would be invisible
     * at every surface, it could not be measured."*
     */
    it('🔴 `default` reads the same word with a roster and without one, so a seed would be invisible', async () => {
      await personOpens(DEFAULT_PROFILE_ID)

      // ⚑ **584 · the exclusion is the GENERATOR's now**, and it is asked of the store rather
      // than of a table: BroBot's row is minted by the launch above and the column stays empty.
      expect(nameColumn(DEFAULT_PROFILE_ID)).toBeNull()
      // ⛔ **The pair.** Both readings answer the same word — which is what *invisible at every
      // surface* means, said as a measurement.
      expect(agentName(DEFAULT_PROFILE_ID, roster())).toBe(DEFAULT_PROFILE_LABEL)
      expect(agentName(DEFAULT_PROFILE_ID, null)).toBe(DEFAULT_PROFILE_LABEL)
      // ⚑ **And the divergence that proves the pair is a measurement**: an identity this app
      // NAMED reads its name with a roster and its slug without one, which is the question
      // `default` cannot be asked because it has a second answer built into the older function.
      await personOpens('archivist')
      expect(agentName('archivist', roster())).toBe(FIRST_NAME)
      expect(agentName('archivist', null)).toBe('archivist')
    })

    /**
     * ⚠️ **The one seed table left names exactly the slug it has a fact about.** ⛔
     * `SEEDED_DISPLAY_NAMES` retired with the identity it named (`HO-078` §5) and D-014 removed the
     * seeded roles and grants, so a fresh install seeds one fact — a first-run provider — about one
     * identity. ⚑ An assertion removed here is a row appearing in the table with nobody noticing.
     */
    it('⚠️ 584 · the one remaining seed table names ONE slug, and it is BroBot’s', () => {
      expect(SEEDED_PROVIDERS.map((seed) => seed.slug)).toEqual([DEFAULT_PROFILE_ID])
    })

    /**
     * ⚠️ **Folded before it is compared** (238) — the lookup that folded was
     * `seededDisplayNameFor`; what folds now is the TAKEN set, which is the same rule moved to the
     * place that spends it (`HO-078` §5.2).
     */
    it('⚠️ 584 · a name already taken in ANY spelling, and in either column, is skipped', () => {
      // ⛔ **The slug column counts**, which is the clause that stops `nadia` the agent standing
      // beside *Nadia* the handle.
      expect(aNameForANewAgent([HUMAN_NAMES[0]!.toUpperCase()], Math.random)).toBe(HUMAN_NAMES[1])
      // ⛔ The control: folding is not *anything containing the word*.
      expect(aNameForANewAgent([`${HUMAN_NAMES[0]!}-2`], Math.random)).toBe(HUMAN_NAMES[0])
      // Every name of BroBot's own list taken, and the next is still a name, none of them.
      const next = aNameForANewAgent(HUMAN_NAMES, Math.random)
      expect(HUMAN_NAMES.map((name) => name.toLowerCase())).not.toContain(next.toLowerCase())
    })
  })
})

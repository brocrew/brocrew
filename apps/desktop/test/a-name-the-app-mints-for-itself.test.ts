import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  SEEDED_PROVIDERS,
  agentName,
  type AgentIdentity,
  type RuntimeEventMessage,
  type SessionInstructions,
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

/** ⚠️ Prose stripped, so a docblock quoting a shape is never mistaken for the shape. */
const withoutProse = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-538-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-538-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', 'default', profileId ?? 'default', provider)
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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · no migration, no back-fill — the absence, measured
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · nothing reaches a database whose creation is past', () => {
    /**
     * The seed uses `INSERT OR IGNORE`, which affects new installs only. Existing rows
     * receive no migration or back-fill.
     *
     * ⚠️ **Asserted over the shipped SQL** rather than over a count of migrations, which would
     * move every time anything else lands.
     *
     * ⛔ **D-016 · the history is one migration now** (`0000_the_tree.sql`), so `0025`'s upgrade
     * path for the project manager — and the half of this case that pinned its NULL — went with
     * it. ⚑ What is kept is the absence: no migration, the first or any later one, back-fills a
     * display name onto an identity.
     */
    it('🔴 no migration writes a display name onto an identity', () => {
      const sql = readdirSync(migrationsFolder)
        .filter((name) => name.endsWith('.sql'))
        .map((name) => ({ name, text: readFileSync(join(migrationsFolder, name), 'utf8') }))

      // ⚑ The premise: there really are migrations to read, and the one that creates the table is
      // among them — named, so a sweep over an empty or moved folder cannot pass.
      expect(sql.map(({ name }) => name)).toContain('0000_the_tree.sql')
      expect(
        sql.find(({ name }) => name === '0000_the_tree.sql')?.text,
        'the sweep reads a migration that does not create the identity table',
      ).toMatch(/CREATE TABLE\s+`agent_identity`[^;]*?`display_name`/)

      for (const { name, text } of sql) {
        expect(
          /UPDATE\s+[`"]?agent_identity[`"]?[\s\S]*?display_name/i.test(text),
          `${name} back-fills a display name onto an identity`,
        ).toBe(false)
      }
    })

    /**
     * 🔴 **558 · RE-AIMED, because the world moved and stripping would have been the worst repair
     * available** (standing rule 26).
     *
     * ⛔ **This asserted *no UPDATE names this column*, and the sentence under it was the
     * argument:** there is no rename, so a name written once is the name forever, which is what
     * `538` §5's `create_agent` decision rested on. ⚑ **`HO-063` gap 2 asked for the rename and
     * 558 built it**, so the FACT changed rather than its spelling — and the assertion now pins
     * what it was always for: ⛔ **the app's own writers cannot overwrite a name, and exactly one
     * statement can, and it is a person's.**
     *
     * 🔴 **That is `HO-016` §2 made mechanical.** *The app may seed a default at creation; it never
     * re-grants what a person removed.* ⚠️ Both app writers are `INSERT OR IGNORE`, which cannot
     * touch a row that exists; the one `UPDATE` is reached only from the window wire behind
     * `requireAPerson`. ⛔ So the direction is a property of the statement shapes, and this is what
     * says so.
     *
     * ## ⚠️ And the sweep itself was weaker than it read — two ways, both found by this dispatch
     *
     * ⛔ **`INSERT OR IGNORE INTO agent_identity` also matches `agent_identity_home`**, a different
     * table with a different meaning (`a-column-name-is-a-claim`, one noun up). ⚑ **The word
     * boundary is now asserted.**
     *
     * 🔴 **And it never saw that second match, because of a 240-character window.** With prose
     * stripped, `ensureHomeRow`'s INSERT sat inside the window `writeProvider`'s UPDATE had already
     * consumed — so `matchAll` never started a match there. ⚠️ **558 added four statements between
     * them, which pushed it out and turned the census red for a reason that had nothing to do with
     * this dispatch.** ⛔ A census whose answer depends on how far apart two statements happen to
     * be written is a census that can go quiet on a reformat.
     */
    it('⛔ `display_name` is written by two statements: the app INSERTs it, a person UPDATEs it', () => {
      const files = walk(join(SRC, 'main')).filter((path) => path.endsWith('.ts'))
      // ⚑ The premise, so the sweep below is a walk over something.
      expect(files.length).toBeGreaterThan(20)

      // 🔴 **558 · the STATEMENT, delimited by its own backticks — not a fixed window.**
      //
      // ⛔ **This was `([\s\S]{0,240})` and the width was load-bearing without anybody
      // knowing.** With prose stripped, `writeProvider`'s `UPDATE` and the statements after it
      // sit within 240 characters of each other, so `matchAll` consumed them inside the first
      // match and never started a second — `a-fixed-width-slice-runs-into-the-next-region`.
      // ⚑ Every prepared statement here is a template literal, so its own delimiter is the
      // exact boundary and no number has to be chosen.
      //
      // ⛔ **`(?![_\w])` is the other half**: without it `agent_identity_home` is a match on
      // this table's name, and its `INSERT OR IGNORE` is filed as a writer of a column that
      // table does not have (`a-column-name-is-a-claim`).
      const writerOfThisTable =
        /`((INSERT OR IGNORE INTO agent_identity|UPDATE agent_identity)(?![_\w])[^`]*)`/g
      const writes = files.flatMap((path) =>
        [...withoutProse(readFileSync(path, 'utf8')).matchAll(writerOfThisTable)].map((found) => ({
          path: path.slice(SRC.length + 1).replaceAll('\\', '/'),
          verb: found[2]!,
          // ⛔ **The statement and not the file** — a `SET` list is what decides whether a column
          // moves, and `a-file-level-contains-cannot-tell-sibling-declarations-apart` is why this
          // is one statement rather than the whole file.
          body: found[1]!,
        })),
      )

      // ⚑ The premise again, one level down: there really are UPDATEs on this table, so the claim
      // below is about what they SET rather than about an empty list.
      expect(writes.filter((one) => one.verb === 'UPDATE agent_identity').length).toBeGreaterThan(1)

      // 🔴 **558 · EXACTLY ONE UPDATE moves this column, and it is the rename.** ⛔ The old
      // assertion was `.toBe(false)` for every UPDATE, with the message *"there is a rename now"* —
      // and there is. ⚠️ **A count and not a `some`**: a second statement that moved this column
      // would be a second answer to *what is this identity called*, which is the thing the old
      // negative was actually protecting.
      const renames = writes.filter(
        (one) => one.verb === 'UPDATE agent_identity' && one.body.includes('display_name'),
      )
      expect(
        renames.map((one) => one.path),
        'a second UPDATE moves display_name — two statements now answer what an identity is called',
      ).toEqual(['main/db/session-store.ts'])
      expect(renames[0]?.body).toContain('SET display_name = ?')

      // 🔴 **And the app's own writer still cannot overwrite one** — `HO-016` §2, as a property of
      // the statement rather than of an ordering. ⛔ `INSERT OR IGNORE` writes nothing to a row
      // that exists, so no seed can land on top of a name a person chose.
      const inserts = writes.filter((one) => one.verb === 'INSERT OR IGNORE INTO agent_identity')
      expect(inserts.map((one) => one.path)).toEqual(['main/db/session-store.ts'])
      expect(inserts[0]?.body).toContain('display_name')

      // ⚠️ **The word-boundary repair, asserted rather than trusted.** ⚑ **D-016 · `ensureHomeRow`
      // went, and with it the store's one `agent_identity_home` statement**, so the boundary is
      // measured on a plant: the sweep's own regex, over the two tables' statements side by side.
      // A sweep that counted the second would report a writer of a column that table does not have.
      const planted =
        '`INSERT OR IGNORE INTO agent_identity_home (identity_id) VALUES (?)`\n' +
        '`INSERT OR IGNORE INTO agent_identity (id, display_name) VALUES (?, ?)`'
      expect(
        [...planted.matchAll(writerOfThisTable)].map((found) => found[1]),
        'the sweep counts agent_identity_home as a writer of agent_identity',
      ).toEqual(['INSERT OR IGNORE INTO agent_identity (id, display_name) VALUES (?, ?)'])
      const everything = withoutProse(readFileSync(join(SRC, 'main/db/session-store.ts'), 'utf8'))
      expect(
        [...everything.matchAll(/INSERT OR IGNORE INTO agent_identity(?![_\w])/g)].length,
        'a second app INSERT writes agent_identity',
      ).toBe(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the seed is read at the two call sites that mean it, and nowhere else
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · where the table is read', () => {
    /**
     * 🔴 **The census, and it plants TWO** (standing rule 12). ⛔ A reader that found only the
     * first call per file would pass a one-planted control and be blind to a third call site in an
     * 8,000-line store — which is `a-payload-census-must-read-call-sites-not-types`' sibling and
     * the defect this census exists to catch.
     */
    it('🔴 584 · `nameForANewIdentity` is called at TWO mint sites, and in no row writer', () => {
      const code = withoutProse(readFileSync(join(SRC, 'main/db/session-store.ts'), 'utf8'))
      // ⛔ **Two, and the definition is NOT one of them** — it is
      // `const nameForANewIdentity = (profileSlug: …)`, so the arrow binding puts a space where
      // this pattern wants a paren. ⚠️ Said out loud because a reader who assumed otherwise would
      // read this number as one call site (`a-title-that-names-a-count-the-assertion-never-checks`).
      const calls = [...code.matchAll(/nameForANewIdentity\(/g)]
      expect(calls).toHaveLength(2)

      // ⛔ **The LAUNCH and the CREATION door** — every place a row comes into being. ⚠️ **`584`
      // added the second**: `HO-078` §5 gives an agent's creation the app's name, where `538`
      // deliberately left it null. D-014 removed the grant-target loop that was a third.
      expect(code).toContain('displayName: nameForANewIdentity(profileSlug),')
      expect(code).toContain(
        'displayName: blankToNull(said.displayName) ?? nameForANewIdentity(slug),',
      )

      // 🔴 **And NOT in the shared row writer.** ⛔ `writeIdentityRow` is what every door goes
      // through, so resolving the name there would make a launch's fallback overwrite the person's
      // own `null` — which is `433`'s defect one column over, and the reason the seed was ever
      // resolved at call sites.
      // ⚑ Both anchors asserted present first, so an absent one cannot slice an empty region.
      const from = code.indexOf('const writeIdentityRow')
      const to = code.indexOf('const setAgentProviderTx')
      expect(from).toBeGreaterThan(-1)
      expect(to).toBeGreaterThan(from)
      const writer = code.slice(from, to)
      expect(writer.length).toBeGreaterThan(200)
      expect(writer).toContain('ensureIdentityRow.run(')
      expect(
        writer,
        'the row writer resolves the name, so every door gets the same one',
      ).not.toContain('nameForANewIdentity(')
    })

    /** ⚑ **The control for the reader above**, planting two calls in one string. */
    it('⚑ the census reads every call in a file, not the first', () => {
      const planted = 'a = nameForANewIdentity(x)\nb = nameForANewIdentity(y)\n'
      expect([...planted.matchAll(/nameForANewIdentity\(/g)]).toHaveLength(2)
    })

    /**
     * 🔴 **`create_agent`'s `display_name` stays OPTIONAL, and the reason is measured.**
     *
     * ⛔ **A required argument would be a rail on ONE provider and a suggestion on the other.**
     * Claude's in-process MCP server parses arguments against the schema BEFORE the handler runs —
     * `safeParseAsync(normalizeObjectSchema(inputSchema), args)`, which `348` measured end to end
     * — so an omission would be refused by the transport and this app's own door would never run.
     * ⚠️ That puts argument shape ABOVE the standing wall, which is the ordering HO-031 §2.5
     * forbids and the confusion `445` measured. ⛔ **Codex does the opposite**:
     * `answerCodexToolCall` hands the arguments to the door UNPARSED, so a `required` there is
     * enforced by nothing.
     *
     * ⚑ **Both halves are asserted**, because either alone is a different claim.
     */
    it('🔴 584 · the tool advertises NO such field, and the two adapters are why removing it was the answer', () => {
      const tools = withoutProse(readFileSync(join(SRC, 'main/runtime/agent-tools.ts'), 'utf8'))
      // 🔴 **This asserted `.optional()` on `display_name: z` until `584`.** ⛔ `HO-078` §5 —
      // *"The app assigns the name. The agent does not choose it and does not ask."* — so the
      // field is GONE rather than made required, and the two adapters below are the measured
      // reason why *required* was never available as an answer.
      //
      // ⚠️ **The whole file, not a window** — `a-fixed-width-slice-runs-into-the-next-region`.
      expect(tools, 'create_agent advertises a name again').not.toContain('display_name: z')
      // ⛔ **And the reader is gone with the advertisement**, which is what `348`'s
      // `z.looseObject` makes load-bearing: an undocumented key is NOT stripped, so a reader left
      // behind would be a path a test could drive and no model was ever told about.
      expect(tools).not.toContain('CREATE_DISPLAY_NAME_ARGUMENT')
      // ⚑ **The door still HANDS one down, and it is the app's.** `NewAgent` is unchanged and a
      // person's typed name still wins; what this tool passes is `null`, every time.
      expect(tools).toContain('displayName: null,')

      const runtime = join(here, '../../../packages/runtime/src')

      // ⛔ **Claude: read off the SDK ITSELF and not off our own docblock about it.** ⚠️ `348`'s
      // note quotes this line, and a census that matched the quote would be asserting PROSE —
      // rule 26's first question, answered against the wrong file. ⚑ Resolving the dependency is
      // what makes it a measurement, and a moved file is a LOUD failure rather than a quiet pass.
      const sdk = createRequire(join(SRC, '../package.json')).resolve(
        '@modelcontextprotocol/sdk/server/mcp.js',
      )
      const server = readFileSync(sdk, 'utf8')
      expect(server, `${sdk} no longer parses arguments`).toContain('safeParseAsync')
      // 🔴 **And it THROWS rather than answering** — an `McpError`, which is a JSON-RPC error and
      // therefore exactly the shape `307` ruled *"carries no machine-readable policy meaning"*.
      expect(server).toContain('Invalid arguments for tool')
      expect(server).toContain('ErrorCode.InvalidParams')
      // ⚑ …and this app really does hand that server its raw shape, kept loose, so the parse above
      // is ours and an undocumented key reaches the door rather than being stripped.
      const claude = readFileSync(join(runtime, 'claude/agent-tools.ts'), 'utf8')
      expect(claude).toContain('looseShape(one.input, one.handlerOwnsMissingInput === true)')
      expect(claude).toContain(
        'const loose = missingAtHandler ? agentToolHandlerObject(shape) : z.looseObject(shape)',
      )

      // ⚑ Codex: the door is handed what arrived, unparsed — `isPlainObject` and nothing more.
      const codex = withoutProse(readFileSync(join(runtime, 'codex/agent-tools.ts'), 'utf8'))
      expect(codex).toContain('const answer = await tool.call(call.arguments)')
      expect(codex.split('tool.call(').length - 1).toBe(1)
      expect(codex).toContain('completed?.(answer)')
      expect(codex).toContain('return succeeded(answer)')
      expect(codex).not.toContain('inputSchema.parse')
    })
  })
})

/** Every file under a directory, recursively — the shape a source census walks. */
function walk(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

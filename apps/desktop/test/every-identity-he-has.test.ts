import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeLaunchGate, FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { RuntimeChangeMessage, SessionInstructions } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  NULL_SESSION_STORE,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  executeRuntimeCommand,
  noPersonBehindIt,
  refusedDuringAQuit,
} from '../src/main/runtime/ipc'
import {
  DEFAULT_PROFILE_ID,
  RUNTIME_CHANGE_SUBJECTS,
  type AgentIdentity,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'
import { CAPABILITY_FIELDS, type CapabilityGrant } from '../src/shared/capabilities'
import {
  HOLDING_SAYS,
  WHAT_HOLDS_AN_IDENTITY,
  identityUse,
  nothingHoldsIt,
  thisAppWouldMintIt,
  whatHoldsIt,
  type IdentityUse,
} from '../src/shared/agent-roster'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

/** ⚠️ This file is about the roster, and never about what a launch is told. */
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

/**
 * 🔴 **558 · every identity he has — the read, the writes, and the rename** (`HO-063` gaps 1 and 2).
 *
 * ## ⛔ What `HO-063` gap 1 says, and the half of it that was already true
 *
 * ⚠️ **The gap reads *"There is no list of identities… nothing shows a person"*, and on the code
 * that is not what is missing.** ⛔ `listIdentities` is `SELECT … FROM agent_identity ORDER BY slug`
 * — no project filter and no session join, because `369` DELETED `WHERE project_id = ?` and wrote
 * down why — and a surface draws every row it returns, with a count, a create button and an
 * orphan-folder note. ⚠️ **That surface was `SideRail.vue`'s Agents section and is
 * `TeamWorkspace.vue` since `570`** (`EXT-008` §4.4); the argument is about the LIST and does not
 * turn on which surface draws it. ⚑ **§2's first test is that control**: it passes on `main`, and
 * it is what says the LIST was never the problem.
 *
 * 🔴 **What IS missing is what the list cannot say about a row.** *Which projects it works in* and
 * *whether anything has ever run it* are derivable from two tables nothing joins to this one, and
 * `createdAt` cannot answer the second — both creation doors and the launch stamp it. ⛔ **So an
 * identity created six weeks ago and never used, and one that has held forty conversations, come
 * back from `agentIdentities()` as the same shape with different names.** ⚠️ That is the property
 * §2 measures, and it is what fails on `main`.
 *
 * ⚑ **D-016 · the projects half went with projects.** What the read says about a row now is how
 * many conversations have run as it and whether a launch of it is in flight or starting.
 *
 * ## ⚑ And the removal turned out to be the same question read backwards
 *
 * ⛔ **`HO-063` gap 1 also asks for *"a way to remove one nothing runs"*, and the facts that refuse
 * a removal are exactly the facts a roster row displays.** ⚑ So there is ONE record — `IdentityUse`
 * — and one derivation over it, `whatHoldsIt`, read by the roster to explain a control and by
 * `RuntimeHost.removeAgent` to refuse a press. §3 is what pins that they cannot come apart.
 *
 * ## ⚠️ Real host, real SQLite ledger, real migrations
 *
 * The only double is the provider. Every refusal below is the door's own.
 */

class Sink implements RuntimeEventSink {
  // ⚠️ Annotated rather than inferred, so `AnonymousSink` can override it.
  readonly aPersonIsBehindIt: boolean = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/**
 * ⚑ **Prose stripped before a source census reads it** — `a-source-census-must-strip-prose-before-it-asserts`.
 * ⛔ This dispatch's own docblocks name both verbs in prose, so a raw-file negative would be
 * satisfied by a comment about a door that had been deleted.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

/** ⛔ A channel that declares nobody — what `requireAPerson` is asked about. */
class AnonymousSink extends Sink {
  override readonly aPersonIsBehindIt = false
}

describe('558 · every identity he has', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let window: Sink
  let clock: number
  let said: RuntimeChangeMessage[]
  let gate: FakeLaunchGate | null
  const tick = (): number => clock++

  /** ⚑ Poll a condition with a bound — standing rule 13: every wait in a test has a deadline. */
  const waitFor = async (until: () => boolean, what: string): Promise<void> => {
    for (let tries = 0; tries < 200; tries++) {
      if (until()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        // ⚑ **The gate is read at LAUNCH rather than captured at construction**, so a test can hold
        // one launch open without building a second host.
        new FakeRuntime(provider, { sessions, ...(gate === null ? {} : { gate }) }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', 'default', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      announce: (change) => said.push(change),
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

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-558-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-558-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    said = []
    gate = null
    host = buildHost()
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    // ⛔ **Released before the quit**, or a held launch makes `closeAll` wait for a gate nobody
    // will open.
    gate?.release()
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

  const useOf = (slug: string): IdentityUse => {
    const one = host.agentIdentities().use.find((each) => each.slug === slug)
    if (one === undefined) throw new Error(`no identity called ${slug}`)
    return one
  }

  /**
   * ⛔ **Every capability named, because {@link CapabilityGrant} is a whole answer** — *"a surface
   * says what it means about all of them, every time, and `null` is a real answer"*. ⚑ None is
   * chosen here; this file is about the roster, not about the sheet.
   */
  const everyGrantTheDefault = (): CapabilityGrant =>
    Object.fromEntries(CAPABILITY_FIELDS.map((field) => [field.key, null])) as CapabilityGrant

  const identityOf = (slug: string): AgentIdentity => {
    const one = host.agentIdentities().identities.find((each) => each.slug === slug)
    if (one === undefined) throw new Error(`no identity called ${slug}`)
    return one
  }

  /**
   * 🔴 **THE FIXTURE, and it plants TWO** (standing rule 12).
   *
   * ⛔ **`never-run` is created and never launched** — `createAgentIdentity` writes an
   * `agent_identity` row and nothing else: no binding, no session, no home row, no folder. ⚑ That
   * is the population `HO-063` gap 1 is about and the one a live fixture cannot produce.
   *
   * ⚠️ **`has-run` is opened as a conversation**, which is the CONTROL: a read that found only this
   * one would pass every test a live fixture can write, which is §4.2's own sentence.
   */
  const oneOfEach = async (): Promise<void> => {
    host.createAgent({ slug: 'never-run', displayName: null, provider: null })
    host.createAgent({ slug: 'has-run', displayName: null, provider: null })
    await personOpens('has-run')
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · 538's two measurements, re-verified before anything is built on them
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe("§1 · `538`'s two measurements, re-taken", () => {
    /**
     * ⛔ **Measurement A was *an identity an agent creates with no `display_name` stays NULL*, and
     * `584` REVERSED it** (`HO-078` §5: *"The app assigns the name. The agent does not choose it
     * and does not ask."*). ⚑ `538`'s reason was that an omission was the model ANSWERING, on the
     * strength of the field's published sentence — **and there is no field any more**, so there is
     * no answer to respect.
     *
     * ⚠️ **Re-taken rather than deleted** (standing rule 26): what this file needs from `538` is
     * that the NAME COLUMN is decided at the creation door and by nothing afterwards, and that is
     * still exactly what is measured — the value it settles on just changed.
     *
     * ⚑ **Taken from the DOOR rather than from the tool's schema**, so what is measured is what the
     * column holds. ⚠️ The tool now always sends `displayName: null`, and `NewAgent.vue`'s
     * `trim() === '' ? null : …` reaches this same call the same way.
     */
    it('⚑ A · a creation that says no name gets the app’s, and a blank string is the same answer', () => {
      host.createAgent({
        slug: PROJECT_MANAGER_PROFILE_ID,
        displayName: null,
        provider: null,
      })
      const assigned = identityOf(PROJECT_MANAGER_PROFILE_ID).displayName
      expect(assigned).not.toBeNull()

      // ⚑ And a blank string is the same answer, which is what makes *the box was left empty* and
      // *no name was sent* one value — **and it gets a DIFFERENT name**, which is uniqueness at
      // assignment measured rather than described.
      host.createAgent({ slug: 'blank', displayName: '   ', provider: null })
      const second = identityOf('blank').displayName
      expect(second).not.toBeNull()
      expect(second).not.toBe(assigned)

      // ⛔ **The control: a name somebody TYPED is not replaced**, so the two above are a decision
      // about an absence rather than a door that ignores its argument.
      host.createAgent({ slug: 'named', displayName: 'The Boss', provider: null })
      expect(identityOf('named').displayName).toBe('The Boss')
    })

    /**
     * ⛔ **Measurement B: there was exactly one writer and no rename.**
     *
     * ⚠️ **This reads the WORKING TREE, so it cannot re-take the base's measurement** — what it
     * pins is the shape after the repair: the app's writer is still an `INSERT OR IGNORE`, and the
     * statement that retires *no rename* is an `UPDATE` a person drives. ⛔ **The EXACTLY-ONE half
     * is pinned by `a-name-the-app-mints-for-itself.test.ts` §4**, which sweeps every statement in
     * `src/main` bounded by its own backticks; `toContain` cannot express *only* and this does not
     * claim to.
     *
     * ⚑ **D-016 · the scope caveat went with proposals.** `propose_project` was the other
     * agent-initiated route to an identity (`displayName: proposal.name`); it is deleted, so A
     * holds of every identity an agent creates.
     */
    it('⚠️ B · the app still INSERTs this column and a person now UPDATEs it', () => {
      const source = readFileSync(join(SRC, 'main/db/session-store.ts'), 'utf8')
      // ⛔ The app's own writer is still the one that cannot overwrite a row that exists.
      expect(source).toContain('INSERT OR IGNORE INTO agent_identity\n')
      // 🔴 **And there is now an UPDATE that moves the column** — the rename.
      expect(source).toContain('UPDATE agent_identity SET display_name = ? WHERE id = ?')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the read — every identity, running or not, and the facts that tell them apart
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the read', () => {
    /**
     * ⚑ **THE CONTROL, and it passes on `main`.** ⛔ The list was never filtered by a project or
     * folded through a live session — `369` deleted the project parameter and said so — so an
     * identity nothing has ever run has always been in it. ⚠️ **This is here so §2's next test is
     * about the FACTS and not about the population**, and so nobody repairs a list that is already
     * complete.
     */
    it('⚑ the roster already names an identity nothing has ever run — that half was never missing', async () => {
      await oneOfEach()
      // ⚠️ **`default` is absent, and that is the app being honest**: nothing has run as BroBot in
      // this database, so no launch has minted its row. ⛔ The two the fixture planted are both
      // here, in the statement's own `ORDER BY slug`.
      expect(host.agentIdentities().identities.map((one) => one.slug)).toEqual([
        'has-run',
        'never-run',
      ])
    })

    /**
     * 🔴 **THE PROPERTY, and it FAILS on `main`.**
     *
     * ⛔ **Two identities, one that has never run and one that has, and the answer must tell them
     * apart by something that is not their name or their birthday.** ⚠️ `createdAt` cannot do it:
     * both creation doors and a launch stamp it, so an identity created six weeks ago and never
     * used is indistinguishable from one created six weeks ago and used since.
     *
     * ⚑ **Derived rather than typed**: the two answers are compared with the fields that are
     * trivially different — the identity's own names, its row id and its birthday — blanked, so the
     * assertion is about what the read SAYS rather than about a field somebody remembered to check.
     *
     * 🔴 **584 · `displayName` JOINED that blanked list, and it had to** (`HO-078` §5: *"the app
     * assigns a human name to every identity it mints"*). ⛔ **The FACT moved rather than its
     * spelling**: two rows created through the same door now carry DIFFERENT handles by
     * construction, so leaving the column in would have let `not.toEqual` pass on the handle alone
     * — the read would have looked like it told the two apart while saying nothing about USE, and
     * the non-vacuity check below is exactly the assertion that was there to catch that.
     * ⚠️ **Blanked rather than dropped** (standing rule 26): `584`'s own fact — both rows named, and
     * named APART — is asserted first, so the column is pinned here and then held constant.
     */
    it('🔴 the read tells an identity nothing has ever run from one that is running', async () => {
      await oneOfEach()
      const roster = host.agentIdentities()
      // 🔴 **584 · the app named both of them, and it named them APART** (`HO-078` §5.2's
      // *uniqueness enforced at assignment*). ⛔ This is the premise for blanking the column below:
      // the handle is a per-row fact now, like the id and the slug, rather than a fact about use.
      const named = (slug: string): string | null =>
        roster.identities.find((one) => one.slug === slug)?.displayName ?? null
      expect(named('never-run')).not.toBeNull()
      expect(named('has-run')).not.toBeNull()
      expect(named('never-run')).not.toBe(named('has-run'))

      const told = (slug: string): string => {
        const row = roster.identities.find((one) => one.slug === slug)
        const use = roster.use.find((one) => one.slug === slug)
        // ⛔ **Both halves of what the read answers about ONE identity**, with the four fields that
        // differ for every pair of rows removed.
        return JSON.stringify({
          ...row,
          ...use,
          id: '<id>',
          slug: '<slug>',
          displayName: '<displayName>',
          createdAt: '<createdAt>',
        })
      }
      expect(told('never-run')).not.toEqual(told('has-run'))

      // ⚠️ **And the non-vacuity: the two rows really are otherwise identical.** Both were created
      // through the same door with the same three arguments, so anything that differs — once the
      // id, the slug, the birthday and the handle this app assigned each of them are held constant
      // — is a fact this dispatch added rather than an accident of the fixture.
      const bare = (slug: string): string => {
        const row = roster.identities.find((one) => one.slug === slug)
        return JSON.stringify({
          ...row,
          id: '<id>',
          slug: '<slug>',
          displayName: '<displayName>',
          createdAt: '<createdAt>',
        })
      }
      expect(bare('never-run')).toEqual(bare('has-run'))
    })

    /** ⛔ **What the two facts actually say**, named rather than left to the comparison above. */
    it('⚑ it says how many conversations — and zero is a real answer', async () => {
      await oneOfEach()
      expect(useOf('never-run')).toEqual({
        slug: 'never-run',
        conversations: 0,
        thisAppMintsIt: false,
        isLaunching: false,
        isStarting: false,
        runsOn: { provider: null, from: 'nothing-yet' },
      })
      // ⚠️ **`isLaunching` is TRUE here, and it is not noise**: the fixture left this conversation
      // open, and a slot this host still holds is a referent no row could express.
      expect(useOf('has-run')).toEqual({
        slug: 'has-run',
        conversations: 1,
        thisAppMintsIt: false,
        isLaunching: true,
        isStarting: false,
        runsOn: { provider: 'codex', from: 'its-conversations' },
      })
    })

    /** ⚠️ **A second life of one identity is a second conversation**, counted as rows. */
    it('⚑ a second conversation as the same identity counts twice', async () => {
      host.createAgent({ slug: 'twice', displayName: null, provider: null })
      const first = await personOpens('twice')
      await host.close(first, window)
      await personOpens('twice')
      expect(useOf('twice').conversations).toBe(2)
    })

    /**
     * 🔴 **A conversation swept out of the person's OWN `~/.claude` has no identity of ours**, and
     * the count may not attribute it to one.
     *
     * ⛔ **`agent_identity_id` is null for exactly those rows**, and a `GROUP BY` without the guard
     * produces a group keyed `null` — an identity id this app never minted, carrying a count of
     * conversations that are not ours. ⚑ Planted directly, because the only door that writes such a
     * row is the adopt path and this is a question about the statement.
     */
    it('⛔ a conversation that belongs to nobody of ours is counted against nobody', async () => {
      await oneOfEach()
      db.prepare(
        `INSERT INTO provider_session (id, provider, cwd, status, created_at, updated_at)
         VALUES ('sess_swept', 'claude', '/tmp', 'ended', 1, 1)`,
      ).run()
      // ⚑ The premise: the planted row really has no identity, so the guard has something to skip.
      expect(
        db.prepare('SELECT agent_identity_id FROM provider_session WHERE id = ?').get('sess_swept'),
      ).toEqual({ agent_identity_id: null })
      expect(
        store.conversationsPerIdentity().map((one) => one.identityId),
        'a session with no identity of ours was counted against an identity id',
      ).toEqual(['aid:has-run'])
    })

    /**
     * ⛔ **One entry per identity and nothing else** — the rail that keeps the two lists joinable.
     * ⚑ Without it a roster could draw a control against a fact belonging to another row.
     */
    it('⛔ every identity has exactly one entry beside it, and no entry names a row that is gone', async () => {
      await oneOfEach()
      const roster = host.agentIdentities()
      expect(roster.use.map((one) => one.slug).sort()).toEqual(
        roster.identities.map((one) => one.slug).sort(),
      )
      expect(new Set(roster.use.map((one) => one.slug)).size).toBe(roster.use.length)
    })

    /**
     * 🔴 **The fold is PURE and reachable without a database**, which is what lets the removal and
     * the roster be one derivation rather than two.
     *
     * ⛔ **A history row naming an id no identity carries is DROPPED**, not reported: it can only
     * come from a row the delete refuses to create, and inventing a roster entry for it would make
     * this list disagree with `agentIdentities`' own.
     */
    it('⚑ the fold gives an identity with no history an entry saying so, and invents none', () => {
      // ⚠️ **TWO history rows against ONE identity**, so the fold is measured where the two lists
      // are different LENGTHS as well as where they name different things — a fold that bailed out
      // on the count rather than on the key would pass over a one-for-one fixture.
      const one = identityUse(
        [{ id: 'aid:solo', slug: 'solo', provider: null } as never],
        [
          { identityId: 'aid:ghost', conversations: 4, startedOn: { claude: 4, codex: 0 } },
          { identityId: 'aid:other-ghost', conversations: 9, startedOn: { claude: 0, codex: 9 } },
        ],
        new Set(),
        new Set(),
      )
      expect(one).toEqual([
        {
          slug: 'solo',
          conversations: 0,
          thisAppMintsIt: false,
          isLaunching: false,
          isStarting: false,
          runsOn: { provider: null, from: 'nothing-yet' },
        },
      ])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the removal, and the three things that hold an identity here
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the removal', () => {
    it('keeps an identity while its recoverable method change is unfinished', () => {
      host.createAgent({ slug: 'lark', displayName: null, provider: null })
      const change = store.beginMethodChange(
        'lark',
        {
          operation: 'delete',
          sourceId: null,
          target: 'review.md',
          files: [
            {
              name: 'review.md',
              before: {
                base64: '',
                fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                mode: 0o600,
              },
              after: null,
              afterMode: null,
            },
          ],
        },
        { who: 'a-person' },
        tick(),
      )!
      expect(change).not.toBeNull()
      const use = useOf('lark')
      expect(Reflect.get(use, 'hasUnfinishedMethodChange')).toBe(true)
      expect(whatHoldsIt(use)).toEqual(['unfinished-method-change'])
      expect(host.removeAgent('lark')).toEqual({
        ok: false,
        rail: 'it-is-still-held',
        held: ['unfinished-method-change'],
      })
      expect(store.agentIdentities().some((one) => one.slug === 'lark')).toBe(true)
      expect(
        store.settleMethodChange(
          'lark',
          change.id,
          'done',
          [{ name: 'review.md', fingerprint: null, mode: null }],
          { who: 'a-person' },
        ),
      ).toBe(true)
      expect(whatHoldsIt(useOf('lark'))).toEqual([])
      expect(host.removeAgent('lark')).toEqual({ ok: true, slug: 'lark' })
    })

    it('answers honestly if an unfinished change appears at the store removal guard', () => {
      host.createAgent({ slug: 'wren', displayName: null, provider: null })
      const remove = store.removeAgentIdentity
      store.removeAgentIdentity = (slug) => {
        store.beginMethodChange(
          slug,
          {
            operation: 'delete',
            sourceId: null,
            target: 'review.md',
            files: [
              {
                name: 'review.md',
                before: {
                  base64: '',
                  fingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                  mode: 0o600,
                },
                after: null,
                afterMode: null,
              },
            ],
          },
          { who: 'a-person' },
          tick(),
        )
        return remove(slug)
      }
      expect(host.removeAgent('wren')).toEqual({
        ok: false,
        rail: 'it-is-still-held',
        held: ['unfinished-method-change'],
      })
      expect(store.agentIdentities().some((one) => one.slug === 'wren')).toBe(true)
    })

    it('refreshes the roster when a saved-method change begins or settles', () => {
      const announce = Reflect.get(host, 'agentKnowledgeChanged') as () => void
      expect(announce).toBeTypeOf('function')
      const before = said.length
      announce.call(host)
      expect(said.slice(before)).toEqual([expect.objectContaining({ what: 'agents' })])
    })

    /** ⚑ THE CONTROL: an identity nothing holds goes, and the row really leaves the table. */
    it('⚑ an identity nothing has ever run is removed, and the row goes', () => {
      host.createAgent({ slug: 'never-run', displayName: null, provider: null })
      expect(nothingHoldsIt(useOf('never-run'))).toBe(true)
      expect(host.removeAgent('never-run')).toEqual({ ok: true, slug: 'never-run' })
      expect(host.agentIdentities().identities.map((one) => one.slug)).not.toContain('never-run')
      expect(db.prepare('SELECT id FROM agent_identity WHERE slug = ?').get('never-run')).toBe(
        undefined,
      )
    })

    /**
     * 🔴 **The first referent, and the database itself refuses it** —
     * `provider_session.agent_identity_id` is `NO ACTION`, so a bare `DELETE` raises.
     *
     * ⚑ **D-016 · one name where there were two**: `a-project` went with projects, so a launched
     * identity is held by `conversations`, and by `a-launch` while it runs.
     */
    it('🔴 an identity a conversation has run as is refused, while it runs and after', async () => {
      host.createAgent({ slug: 'has-run', displayName: null, provider: null })
      const open = await personOpens('has-run')
      // ⚑ **Two while the conversation is open**, and the order is the vocabulary's.
      expect(host.removeAgent('has-run')).toEqual({
        ok: false,
        rail: 'it-is-still-held',
        held: ['conversations', 'a-launch'],
      })
      // 🔴 **And CLOSING it takes exactly one of them away.** ⛔ That is the whole of why
      // *nothing runs* is *nothing has EVER run it*: a live-only reading would make this press
      // legal the moment somebody closed a window, on the identity they had been talking to.
      await host.close(open, window)
      expect(host.removeAgent('has-run')).toEqual({
        ok: false,
        rail: 'it-is-still-held',
        held: ['conversations'],
      })
      // ⚠️ **And the row is still there**, which is the half a refusal that returned cleanly could
      // otherwise hide.
      expect(host.agentIdentities().identities.map((one) => one.slug)).toContain('has-run')
    })

    /**
     * 🔴 **The second referent no foreign key catches, and it is the one that would have made the
     * press a lie.**
     *
     * ⛔ **A launch writes a row for the identity it names**, and the front door launches
     * {@link DEFAULT_PROFILE_ID} — so removing it survives exactly until somebody opens a
     * conversation. ⚑ Letting the press succeed and the row come back is HO-029 §3's shape — a
     * surface reporting a settlement that did not hold.
     *
     * 🔴 **584 · the subject is `default`, because the divergence MOVED there** (`HO-078` §1: *"a
     * fresh install seeds `brobot` (slug `default`) and no other identity"*). ⛔ **The FACT moved,
     * not its spelling.** This test used `project-manager` until the app stopped shipping a second
     * name for a press to be refused on.
     *
     * ⚠️ **Re-pointed rather than deleted** (standing rule 26), and measured where the readings
     * DIVERGE (standing rule 3): `default` refused, `project-manager` ALLOWED through the same door
     * one fact over. ⚑ That second arm is `HO-078` §1's own consequence rather than a side effect —
     * `IdentityUse.thisAppMintsIt` says it in as many words: **a person who removes a project
     * manager is no longer undone by the next launch.**
     */
    it('🔴 a name this app ships is refused, because the next launch would bring it back', async () => {
      // ⚑ The premise, and it is the measurement the refusal rests on: nothing has minted anything
      // yet, and a launch as `default` writes BroBot's own row without anybody creating it — which
      // is what a removal would be undone by.
      expect(host.agentIdentities().identities.map((one) => one.slug)).toEqual([])
      await personOpens(DEFAULT_PROFILE_ID)
      expect(host.agentIdentities().identities.map((one) => one.slug)).toContain(DEFAULT_PROFILE_ID)
      expect(useOf(DEFAULT_PROFILE_ID).thisAppMintsIt).toBe(true)
      const refused = host.removeAgent(DEFAULT_PROFILE_ID)
      expect(refused.ok).toBe(false)
      expect(refused.ok === false && refused.rail === 'it-is-still-held' && refused.held).toContain(
        'this-app',
      )

      // ⛔ **And `this-app` holds it ON ITS OWN**, which the launch above cannot show by itself: a
      // conversation has run as it, so `conversations` would carry that refusal whatever this arm
      // answered. ⚑ Asked of the ONE derivation the door spends, over this row's
      // own answer with its history taken away — `a-comparison-tested-where-both-sides-agree`.
      expect(
        whatHoldsIt({
          ...useOf(DEFAULT_PROFILE_ID),
          conversations: 0,
          isLaunching: false,
        }),
      ).toEqual(['this-app'])

      // 🔴 **The PAIR, one fact over** (standing rule 3): `project-manager` was refused here until
      // `584` and is removable now, because this app ships no name for it and no launch brings it
      // back. ⚠️ It has to be CREATED first — the app no longer mints one for anybody.
      host.createAgent({
        slug: PROJECT_MANAGER_PROFILE_ID,
        displayName: null,
        provider: null,
      })
      expect(useOf(PROJECT_MANAGER_PROFILE_ID).thisAppMintsIt).toBe(false)
      expect(host.removeAgent(PROJECT_MANAGER_PROFILE_ID)).toEqual({
        ok: true,
        slug: PROJECT_MANAGER_PROFILE_ID,
      })
    })

    /**
     * 🔴 **The referent that is not in the database at all** (found in review).
     *
     * ⛔ **`store.create` runs from `onRegistered`, AFTER the provider has been spawned.** So
     * between `createSession` and registration a freshly created identity has no binding, no
     * session and nothing pointing at it — every ledger-derived reason is false. ⚑ Without this
     * one the removal would succeed and `onRegistered`'s `INSERT OR IGNORE` would put the row back,
     * unbound from the conversation a person is watching start.
     *
     * ⚠️ **Planted with a provider that never finishes starting**, so the window the defect lives
     * in is held open rather than raced for.
     */
    it('🔴 an identity a launch is in flight for is refused, before any row exists', async () => {
      host.createAgent({ slug: 'starting', displayName: null, provider: null })
      // ⚑ The premise: nothing in the database points at it, so every other reason is false.
      expect(useOf('starting')).toMatchObject({
        conversations: 0,
        thisAppMintsIt: false,
        isLaunching: false,
      })
      gate = new FakeLaunchGate()
      // ⚠️ **Launched under a CAPITALISED spelling on purpose.** A slot keeps whatever its launcher
      // typed and the roster's slugs are folded by a database constraint, so a comparison that
      // folded neither side would let this removal through (238).
      const launching = host.createSession(
        { provider: 'codex', profileId: 'Starting', cwd: work, approvalMode: 'ask' },
        window,
      )
      // Test hygiene, not product behaviour: a red assertion below would otherwise leave this
      // launch pending and its rejection would land on whichever test ran next.
      launching.catch(() => {})
      await waitFor(() => gate?.held === 1, 'the launch to reach the gate')
      expect(useOf('starting').isLaunching).toBe(true)
      expect(host.removeAgent('starting')).toEqual({
        ok: false,
        rail: 'it-is-still-held',
        held: ['a-launch'],
      })
      gate.release()
      await launching
    })

    /**
     * 🔴 **724 · `714` F-4 — a conversation STARTING is told apart from one already RUNNING.**
     *
     * ⛔ **Measured by `714`**: {@link IdentityUse.isLaunching} counts every phase of a slot, so an
     * identity running one conversation and an identity running one AND starting a second were one
     * record — the premise below, which holds on `main` too. ⚑ `isStarting` carries the starting
     * launches alone. RED on `main` by assertion: the field is not there. (D-016 took the place a
     * start runs in, `projectsOfItsStarts`, out with projects.)
     */
    it('🔴 724 · a start is told apart from a running conversation — `isStarting`', async () => {
      for (const slug of ['both', 'running', 'starting']) {
        host.createAgent({ slug, displayName: null, provider: null })
      }
      await personOpens('both')
      await personOpens('running')
      gate = new FakeLaunchGate()
      const launch = (profileId: string): Promise<unknown> => {
        const launching = host.createSession(
          { provider: 'codex', profileId, cwd: work, approvalMode: 'ask' },
          window,
        )
        launching.catch(() => {})
        return launching
      }
      const intoBoth = launch('both')
      await waitFor(() => gate?.held === 1, 'the second launch of `both` to reach the gate')
      // ⚠️ Capitalised, so the fold of the slot's spelling is measured on this field too.
      const fresh = launch('Starting')
      await waitFor(() => gate?.held === 2, 'the first launch of `starting` to reach the gate')

      // ⚑ **The premise — F-4, measured**: in every field `main` has, a start and a conversation
      // already running are one record.
      const NOT_ON_MAIN = ['slug', 'isStarting']
      const withoutTheStart = (use: IdentityUse): Record<string, unknown> =>
        Object.fromEntries(Object.entries(use).filter(([key]) => !NOT_ON_MAIN.includes(key)))
      expect(withoutTheStart(useOf('both'))).toEqual(withoutTheStart(useOf('running')))
      expect(useOf('both')).toMatchObject({ isLaunching: true })

      // 🔴 **The subject**: the one starting a conversation says so.
      expect(useOf('both')).toMatchObject({ isStarting: true })
      // ⚑ **The control — running only**: launching, and starting nothing.
      expect(useOf('running')).toMatchObject({
        isLaunching: true,
        isStarting: false,
      })
      // ⚑ **The control — starting only**: no row says anything yet, and this does.
      expect(useOf('starting')).toMatchObject({
        conversations: 0,
        isLaunching: true,
        isStarting: true,
      })

      gate.release()
      await intoBoth
      await fresh
      // ⚑ **Registered, nothing is starting.**
      expect(useOf('both')).toMatchObject({ isStarting: false })
      expect(useOf('starting')).toMatchObject({
        isLaunching: true,
        isStarting: false,
      })
    })

    /**
     * ⚑ **724 · a start that is being CLOSED is not starting** — `AgentCard.state`'s `ending`, the same
     * two facts. ⛔ It is still launching (`isLaunching` counts every phase, and the removal door reads
     * it), so the two fields part here as they do for a running conversation.
     */
    it('⚑ 724 · a start a person closes before it arrives is launching and not starting', async () => {
      host.createAgent({ slug: 'leaving', displayName: null, provider: null })
      gate = new FakeLaunchGate()
      const launching = host.createSession(
        { provider: 'codex', profileId: 'leaving', cwd: work, approvalMode: 'ask' },
        window,
      )
      launching.catch(() => {})
      await waitFor(() => gate?.held === 1, 'the launch to reach the gate')
      expect(useOf('leaving')).toMatchObject({ isLaunching: true, isStarting: true })

      const closing = host.close(`sess_${String(counter)}`, window)
      expect(useOf('leaving')).toMatchObject({
        isLaunching: true,
        isStarting: false,
      })
      gate.release()
      await closing
      await launching.catch(() => {})
    })

    /** ⚑ **724 · the pure fold, both sets** — a member of the second is `isStarting`. */
    it('⚑ 724 · the fold reads the starting set beside the launching one, and neither for the other', () => {
      const identity = { id: 'aid:solo', slug: 'solo' } as never
      expect(identityUse([identity], [], new Set(['solo']), new Set())).toMatchObject([
        {
          isLaunching: true,
          isStarting: false,
        },
      ])
      expect(identityUse([identity], [], new Set(['solo']), new Set(['solo']))).toMatchObject([
        {
          isLaunching: true,
          isStarting: true,
        },
      ])
    })

    /**
     * 🔴 **The one name this app would mint back is the front door's own** (D-014).
     *
     * ⛔ **Keyed on {@link DEFAULT_PROFILE_ID}, the profile the front door launches**, because that
     * launch is what writes the row back — no seed table decides it. ⚑ Folded on the way in, so a
     * capitalised spelling is the same identity (238).
     */
    it('🔴 every name this app would mint back is `default`, and nothing else', () => {
      expect(thisAppWouldMintIt(DEFAULT_PROFILE_ID)).toBe(true)
      expect(thisAppWouldMintIt(DEFAULT_PROFILE_ID.toUpperCase()), 'in capitals').toBe(true)
      // ⛔ And the predicate is not simply TRUE: a name this app ships nothing for is not minted.
      expect(thisAppWouldMintIt('nobody-minted-this')).toBe(false)
      // 🔴 **`project-manager` is one of those names since `584`**, and it is the divergence this
      // whole section used to rest on — asserted here so the day it comes back is loud.
      expect(thisAppWouldMintIt(PROJECT_MANAGER_PROFILE_ID)).toBe(false)
    })

    /** ⛔ Criterion 12, the removal direction: a name with no row is not a thing to un-create. */
    it('⛔ a name with no row is refused rather than reported as removed', () => {
      expect(host.removeAgent('nobody-minted-this')).toEqual({
        ok: false,
        rail: 'no-such-agent',
      })
    })

    /**
     * ⚠️ **The guard between the read and the write, reached with a store DOUBLE.**
     *
     * ⛔ **It cannot be reached against a real store**: the roster read and the delete derive the
     * same `aid:<folded slug>` from the same slug, so a row the first found is a row the second
     * matches. ⚑ **That is exactly why it is doubled here** — a guard only a live race could trip
     * is a guard nothing measures
     * (`a-guard-that-only-a-live-run-can-trip-is-dark-by-default`), and reporting `ok` for a write
     * that moved no row is the one way this door can lie.
     */
    it('⚠️ a delete that moved no row is not reported as a removal', () => {
      host.createAgent({ slug: 'free', displayName: null, provider: null })
      const wroteNothing: SessionStore = { ...store, removeAgentIdentity: () => false }
      store = wroteNothing
      const deaf = buildHost()
      // ⚑ The creation above announced; this test is about what the REMOVAL announces.
      said.length = 0
      // ⚑ The premise: this host can see the identity, so the refusal below is about the WRITE.
      expect(deaf.agentIdentities().identities.map((one) => one.slug)).toContain('free')
      expect(deaf.removeAgent('free')).toEqual({ ok: false, rail: 'no-such-agent' })
      // ⛔ **And it announced nothing**, because nothing moved.
      expect(said.filter((one) => one.what === 'agents')).toEqual([])
    })

    /**
     * 🔴 **The roster and the refusal are ONE derivation, and this is what says so.**
     *
     * ⛔ **Every identity's `whatHoldsIt` predicts what the door does to it**, so a surface drawing
     * a control off the roster and a person pressing it cannot disagree. ⚑ `460` F1 is what two
     * derivations of one answer cost a screen later.
     */
    it('🔴 what the roster says holds an identity is exactly what the door refuses on', async () => {
      await oneOfEach()
      await personOpens(DEFAULT_PROFILE_ID)

      // ⚑ The premise: the roster carries at least one of each answer, so the loop below is not a
      // walk over rows that all say the same thing.
      const roster = host.agentIdentities().use
      expect(roster.filter((one) => nothingHoldsIt(one)).length).toBeGreaterThan(0)
      expect(roster.filter((one) => !nothingHoldsIt(one)).length).toBeGreaterThan(0)

      // ⛔ **Re-read per turn** — the roster is a fold over the WHOLE population, which is exactly
      // why `agent-store.ts` re-reads rather than splicing one row out.
      for (const slug of roster.map((one) => one.slug)) {
        const now = host.agentIdentities().use.find((one) => one.slug === slug)
        if (now === undefined) continue
        const use = now
        const predicted = whatHoldsIt(use)
        const answered = host.removeAgent(use.slug)
        if (predicted.length === 0) {
          expect(answered, `${use.slug} was refused after the roster said nothing held it`).toEqual(
            {
              ok: true,
              slug: use.slug,
            },
          )
        } else {
          expect(answered, `${use.slug} was removed while the roster said it was held`).toEqual({
            ok: false,
            rail: 'it-is-still-held',
            held: predicted,
          })
        }
      }
    })

    /**
     * ⚠️ Every reason a removal can carry has words, and they come from ONE table (485).
     *
     * 🔴 **And the COUNT, because sentences in other files say how many.** ⛔ A list that grows
     * while its prose does not is `a-number-can-survive-the-death-of-its-derivation`; this is the
     * line that makes the next member correct them.
     */
    it('each removal reason has its own distinct sentence', () => {
      // The unfinished recovery keeps its original bytes until settlement.
      expect(
        WHAT_HOLDS_AN_IDENTITY.length,
        'the vocabulary moved — correct every sentence that says how many there are',
      ).toBe(6)
      expect(Object.keys(HOLDING_SAYS).sort()).toEqual([...WHAT_HOLDS_AN_IDENTITY].sort())
      const says = Object.values(HOLDING_SAYS)
      expect(new Set(says).size).toBe(says.length)
      for (const sentence of says) expect(sentence.length).toBeGreaterThan(20)
    })

    /**
     * ⛔ **The external server grants go with the row, by CASCADE on the foreign key** — and
     * nothing on disk is touched.
     */
    it('⚑ a grant on the removed identity goes with it, by the schema rather than a second statement', () => {
      host.createAgent({ slug: 'free', displayName: null, provider: null })
      // ⛔ **The registry row is INSERTed rather than registered.** `registerExternalMcpServer`
      // opens a socket to the address a person typed — that is its whole rail — and this test is
      // about a foreign key, not about a preflight. ⚠️ The grant beside it still goes through
      // `setCapabilities`, which is the door a person presses.
      db.prepare(
        `INSERT INTO external_mcp_server (id, name, url, registered_at, reach)
         VALUES ('ems:notes', 'notes', 'http://127.0.0.1:4310/mcp', 1, 'restricted')`,
      ).run()
      host.setCapabilities('free', everyGrantTheDefault(), ['ems:notes'])
      expect(identityOf('free').externalMcpServerIds).toEqual(['ems:notes'])
      expect(host.removeAgent('free')).toEqual({ ok: true, slug: 'free' })
      expect(db.prepare('SELECT count(*) AS n FROM external_mcp_server_grant').get()).toEqual({
        n: 0,
      })
      // ⚠️ The server itself stays: removing an identity is not removing a registration.
      expect(host.agentIdentities().externalMcpServers.map((one) => one.id)).toEqual(['ems:notes'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the rename — gap 2's unlock
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the rename', () => {
    it('🔴 a name written at creation can be corrected, which is what `538` said was impossible', () => {
      host.createAgent({ slug: 'worker', displayName: 'Wrkr', provider: null })
      expect(identityOf('worker').displayName).toBe('Wrkr')
      expect(host.setAgentDisplayName('worker', 'Worker')?.displayName).toBe('Worker')
      expect(identityOf('worker').displayName).toBe('Worker')
    })

    /**
     * ⛔ **A name the APP decided can be corrected too**, and that is the half `HO-063` gap 2 turns
     * on: nobody was asked for it, so the correction has to reach it.
     *
     * 🔴 **584 · the value the app decides is no longer `Project Manager`, and for BroBot's own row
     * it is NO NAME AT ALL** (`HO-078` §5). ⛔ **The FACT moved rather than its spelling**: this
     * test read that string out of `SEEDED_DISPLAY_NAMES`, and both that table and
     * `seededDisplayNameFor` are DELETED — the app assigns from `HUMAN_NAMES` at the mint site now,
     * and `nameForANewIdentity` says `default` is *"the one slug it deliberately leaves nameless"*
     * because `profileLabel` already answers *BroBot (default)* and a handle there would be a
     * second answer in front of the one every surface gives.
     *
     * ⚠️ **Re-aimed to BOTH arms of the app's own decision** rather than dropped (standing rule 26,
     * and rule 12's *plant two*): the row the app mints for ITSELF and leaves nameless is one a
     * person can NAME, and the row the app mints WITH a name is one a person can RENAME. ⚑ Neither
     * value was typed by anybody, which is the property `HO-063` gap 2 asks for.
     */
    it('🔴 the name this app decided — or its silence — is a person’s to correct', async () => {
      // ⛔ **BroBot's own row, minted by the launch and deliberately nameless** — so what a person
      // corrects here is the app's decision to say nothing.
      await personOpens(DEFAULT_PROFILE_ID)
      expect(identityOf(DEFAULT_PROFILE_ID).displayName).toBeNull()
      expect(host.setAgentDisplayName(DEFAULT_PROFILE_ID, 'Planner')?.displayName).toBe('Planner')
      expect(identityOf(DEFAULT_PROFILE_ID).displayName).toBe('Planner')

      // ⚑ **The other arm: a name the app ASSIGNED, which nobody typed either.** A launch as a slug
      // this app ships nothing for mints the row and hands it the first free pool member — and the
      // rename has to reach that value exactly as it reaches a person's own.
      await personOpens(PROJECT_MANAGER_PROFILE_ID)
      // ⚠️ **Read rather than spelled**: the pool's order is `HUMAN_NAMES`' and this file is not the
      // place that pins it — `seed-one-name-the-rest.test.ts` §3 is.
      expect(identityOf(PROJECT_MANAGER_PROFILE_ID).displayName).not.toBeNull()
      expect(host.setAgentDisplayName(PROJECT_MANAGER_PROFILE_ID, 'Scheduler')?.displayName).toBe(
        'Scheduler',
      )
      expect(identityOf(PROJECT_MANAGER_PROFILE_ID).displayName).toBe('Scheduler')
    })

    /**
     * 🔴 **`HO-016` §2 — *the app may seed a default at creation; it never re-grants what a person
     * removed*.** ⛔ Asserted as BEHAVIOUR: a second launch runs the seed again and the person's
     * name survives it.
     */
    it('🔴 a later launch does not put an app-assigned name back over a rename', async () => {
      // ⚠️ **584 · the subject is a launch-minted identity now**, because `HO-078` §1 stopped
      // shipping one for `default`'s grant to name. ⛔ The PROPERTY is unchanged and is `HO-016`
      // §2's: the app assigns at creation and a restart never overwrites what a person decided.
      await personOpens(PROJECT_MANAGER_PROFILE_ID)
      // ⚑ The premise: this app really did name it, so there is something to have been written back.
      expect(identityOf(PROJECT_MANAGER_PROFILE_ID).displayName).not.toBeNull()
      host.setAgentDisplayName(PROJECT_MANAGER_PROFILE_ID, 'Planner')
      const second = await personOpens(PROJECT_MANAGER_PROFILE_ID)
      await host.close(second, window)
      expect(identityOf(PROJECT_MANAGER_PROFILE_ID).displayName).toBe('Planner')
    })

    /** ⚠️ `null` is *nobody has named this identity*, and a blank string is the same answer. */
    it('⚑ a name can be cleared, and a blank clears it too', () => {
      host.createAgent({ slug: 'worker', displayName: 'Worker', provider: null })
      expect(host.setAgentDisplayName('worker', null)?.displayName).toBeNull()
      host.setAgentDisplayName('worker', 'Worker')
      expect(host.setAgentDisplayName('worker', '   ')?.displayName).toBeNull()
    })

    /** ⛔ Criterion 12: a slug with no row is not renamed into existence. */
    it('⛔ a name with no row answers null rather than creating one', () => {
      expect(host.setAgentDisplayName('nobody-minted-this', 'Somebody')).toBeNull()
      expect(host.agentIdentities().identities.map((one) => one.slug)).not.toContain(
        'nobody-minted-this',
      )
    })

    /** ⚑ Folded, so `Worker` and `worker` are the same identity to rename (238). */
    it('⚑ the slug is folded, so a capitalised spelling renames the same row', () => {
      host.createAgent({ slug: 'worker', displayName: null, provider: null })
      expect(host.setAgentDisplayName('Worker', 'Worker')?.slug).toBe('worker')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the rails on both writes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the rails', () => {
    const asked = async (
      sink: RuntimeEventSink,
      command: Parameters<typeof executeRuntimeCommand>[2],
    ): Promise<unknown> => executeRuntimeCommand(host, sink, command)

    it('⛔ both writes are refused unless a person is asking', async () => {
      host.createAgent({ slug: 'worker', displayName: null, provider: null })
      const nobody = new AnonymousSink('webContents:anon')
      await expect(
        asked(nobody, { kind: 'setAgentDisplayName', profileId: 'worker', displayName: 'W' }),
      ).rejects.toThrow(noPersonBehindIt('setAgentDisplayName'))
      await expect(asked(nobody, { kind: 'removeAgent', profileId: 'worker' })).rejects.toThrow(
        noPersonBehindIt('removeAgent'),
      )
      // 🔴 **The PAIR, one fact over** (standing rule 3): the same payloads on a window sink are
      // allowed, so the refusals above are about the channel and not about the payload.
      await expect(
        asked(window, { kind: 'setAgentDisplayName', profileId: 'worker', displayName: 'W' }),
      ).resolves.not.toThrow()
      await expect(
        asked(window, { kind: 'removeAgent', profileId: 'worker' }),
      ).resolves.not.toThrow()
    })

    it('⛔ both are refused during a quit', async () => {
      host.createAgent({ slug: 'worker', displayName: null, provider: null })
      void host.closeAll()
      await expect(
        asked(window, { kind: 'setAgentDisplayName', profileId: 'worker', displayName: 'W' }),
      ).rejects.toThrow(refusedDuringAQuit('setAgentDisplayName'))
      await expect(asked(window, { kind: 'removeAgent', profileId: 'worker' })).rejects.toThrow(
        refusedDuringAQuit('removeAgent'),
      )
    })

    /**
     * ⛔ **Neither verb reaches a toolset**, which is what keeps an AGENT off them — the gate above
     * is about the channel. ⚑ A negative with a search shape (standing rule 4): the tools module
     * names `spawn_agent`, so the sweep is over something.
     */
    it('⛔ the only files in `src/main` that name either verb are the wire and the host', () => {
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? walk(join(dir, entry.name))
            : entry.name.endsWith('.ts')
              ? [join(dir, entry.name)]
              : [],
        )
      const files = walk(join(SRC, 'main'))
      // ⚑ The premise: the sweep is over a tree, not over one file somebody remembered — and it
      // reaches the toolset module, so a verb added there would surface.
      expect(files.length).toBeGreaterThan(40)
      expect(files.map((path) => path.slice(SRC.length + 1).replaceAll('\\', '/'))).toContain(
        'main/runtime/agent-tools.ts',
      )

      // ⛔ **The whole tree and not `agent-tools.ts` alone** (found in review). A one-file negative
      // proves that file was read, never that it is the whole toolset surface — `spawn_agent`
      // itself is named in six files under here.
      for (const verb of ['setAgentDisplayName', 'removeAgent']) {
        const naming = files
          .filter((path) => withoutComments(readFileSync(path, 'utf8')).includes(verb))
          .map((path) => path.slice(SRC.length + 1).replaceAll('\\', '/'))
          .sort()
        // ⚑ **The wire, the host and the store — and `agent-tools.ts` is not among them.**
        // ⚠️ `session-store.ts` is here because its own methods carry these names
        // (`setAgentDisplayName`, and `removeAgentIdentity` which contains `removeAgent`), which is
        // the store's half of each verb and reaches no toolset either.
        expect(naming, `${verb} is named somewhere new in src/main`).toEqual([
          'main/db/session-store.ts',
          'main/runtime/ipc.ts',
          'main/runtime/runtime-host.ts',
        ])
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · what the window is told, and the null store
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the announcement, and a host with no database', () => {
    /**
     * ⛔ **`agents` already covers both writes, and no subject is added** (`534`'s rule: do not add
     * a subject nothing reads). ⚑ The vocabulary is asserted by VALUE here as well as by the
     * announcements below, so a third member would go red in this file too.
     */
    it('⚑ a rename and a removal both announce `agents`, and the vocabulary is still two words', () => {
      // ⚑ **638 · a THIRD member**, `work` — the condition `534` set (*do not add a subject
      // nothing reads*) lapsed when `631` built the task lists that read it.
      expect([...RUNTIME_CHANGE_SUBJECTS]).toEqual(['conversations', 'agents', 'work'])
      host.createAgent({ slug: 'worker', displayName: null, provider: null })
      said.length = 0
      host.setAgentDisplayName('worker', 'Worker')
      expect(said).toEqual([{ what: 'agents' }])
      said.length = 0
      host.removeAgent('worker')
      expect(said).toEqual([{ what: 'agents' }])
    })

    /**
     * ⛔ **After the refusal, never before it** — nothing moved, so nothing is announced.
     *
     * 🔴 **584 · the HELD refusal is taken on `default` now** (`HO-078` §1). ⛔ It was
     * `project-manager`, which this app no longer ships, so that line had quietly become a second
     * `no-such-agent` — **green, with the world changed underneath it**, and the held arm dropped
     * without anybody deciding to (standing rule 26). ⚑ Both rails are named here rather than left
     * to the silence, so the two presses are measured where they DIVERGE.
     */
    it('⛔ a refused rename and a refused removal announce nothing', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      said.length = 0
      expect(host.setAgentDisplayName('nobody-minted-this', 'Somebody')).toBeNull()
      expect(host.removeAgent('nobody-minted-this')).toEqual({ ok: false, rail: 'no-such-agent' })
      const held = host.removeAgent(DEFAULT_PROFILE_ID)
      expect(held.ok === false && held.rail).toBe('it-is-still-held')
      expect(said).toEqual([])
    })

    /**
     * ⚑ **A host with no database answers, rather than throwing** — `NULL_SESSION_STORE`'s own contract.
     * ⛔ Both writes report that nothing happened, which is `setCapabilities`' `false` in the two
     * shapes these verbs answer in.
     */
    it('⚑ a host with no ledger renames nothing and removes nothing, and says so', () => {
      expect(NULL_SESSION_STORE.setAgentDisplayName('worker', 'Worker')).toBe(false)
      expect(NULL_SESSION_STORE.removeAgentIdentity('worker')).toBe(false)
      expect(NULL_SESSION_STORE.conversationsPerIdentity()).toEqual([])
    })
  })
})

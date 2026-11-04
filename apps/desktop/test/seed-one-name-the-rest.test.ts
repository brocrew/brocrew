import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { thisAppWouldMintIt } from '../src/shared/agent-roster'
import {
  AGENT_DISPLAY_NAME_CHARS,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  agentName,
  foldProfileName,
  type RuntimeEventMessage,
  type SessionInstructions,
} from '../src/shared/runtime-ipc'
import { HUMAN_NAMES, aNameForANewAgent, aNameKey } from '../src/shared/human-names'

/**
 * # 🔴 584 · seed one identity, and generate the names
 *
 * ## ⛔ What `HO-078` ordered, in its own words
 *
 * > §1 · ⚑ **"A fresh install ships `brobot` and no other identity."**
 * > §5 · ⚑ **"The app assigns the name. The agent does not choose it and does not ask."**
 *
 * ⚑ **Nothing is seeded** (D-014): a fresh install's one row is the one its first launch writes, and
 * every new row, that one included, holds the one default set until a person changes it. There is no
 * role and no seeded grant, so no grant can name a second identity into being.
 *
 * ## ⛔ What this file does NOT cover
 *
 *  1. **What a name looks like on a surface.** `a-name-on-every-surface.render.test.ts` and
 *     `test/dom/a-name-the-app-mints-for-itself.dom.test.ts` own that, and the second one measures
 *     BroBot's own list and the widest of the other names in ink.
 *  2. **The default set every identity holds.** `one-set-for-every-agent.test.ts` owns it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '../src')
const migrationsFolder = join(SRC, 'main/db/migrations')

/** ⚠️ Prose stripped, so a docblock quoting a shape is never mistaken for the shape. */
const withoutProse = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

/** ⛔ This file is about a ROSTER and a NAME, never about what a launch is told. */
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

/** ⚑ The toolset a launch was handed — the one a model on that conversation would call. */
class HandingRuntime extends FakeRuntime {
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

describe('584 · seed one identity, and generate the names', () => {
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

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new HandingRuntime(provider, handed, sessions),
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
      readInstructions: () => {
        return { instructions: NOTHING_INJECTED, systemHint: undefined, memoryLoaded: null }
      },
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-584-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-584-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    sessions = new FakeProviderSessions()
    host = buildHost()
    window = new Sink('webContents:1')
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

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const toolsOfLastLaunch = (): AgentToolset => {
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no toolset was handed to a launch')
    return one
  }

  const slugs = (): string[] =>
    (db.prepare('SELECT slug FROM agent_identity ORDER BY slug').all() as { slug: string }[]).map(
      (row) => row.slug,
    )

  const nameColumn = (slug: string): string | null | undefined =>
    (
      db.prepare('SELECT display_name FROM agent_identity WHERE slug = ?').get(slug) as
        { display_name: string | null } | undefined
    )?.display_name

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · HO-078 §1 — a fresh install ships brobot and nothing else
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a fresh install ships one identity, and this app mints the rest', () => {
    /**
     * Exercise the fresh-install path: a migrated database with empty `agent_identity`,
     * followed by the person’s first entry through the front door.
     */
    it('🔴 a first launch leaves ONE row, and it is the one a person talks to', async () => {
      // ⚑ **The premise, asserted**: the migrations wrote no identity, so what follows is this
      // launch's doing (`a-fixture-must-not-depend-on-the-subject-removing-its-evidence`).
      expect(slugs()).toEqual([])

      await personOpens(DEFAULT_PROFILE_ID)

      // ⛔ **The WHOLE roster and never a `not.toContain`.** ⚠️ The brief said a fresh install
      // shipped three identities; it shipped two, and only a set-shaped assertion could have said
      // so (`a-negative-is-only-as-strong-as-the-search-shape`).
      expect(slugs()).toEqual([DEFAULT_PROFILE_ID])
    })

    /**
     * 🔴 **`558`'s `thisAppWouldMintIt` is true for one name only: the front door's default
     * profile**, which the next launch would bring back. ⚑ Every other name is one a person can
     * remove, `project-manager` included, which older installs hold.
     */
    it('🔴 `project-manager` is a name a person can remove now, and BroBot’s own slug is not', () => {
      expect(thisAppWouldMintIt('project-manager')).toBe(false)
      // ⛔ **The control, and it is the one identity the answer must stay TRUE for.**
      expect(thisAppWouldMintIt(DEFAULT_PROFILE_ID)).toBe(true)
      // ⚑ **Folded**, so a launcher's spelling cannot walk around the answer (238).
      //
      // ⚠️ **592 · DERIVED from the slug rather than typed.** ⛔ It was the literal `'Default'`,
      // and `HO-078` §2's rename made it a spelling of a name nothing answers to — **a fixture
      // that types the value it is about does not survive a rename of that value**, which is the
      // one thing this dispatch could not have found without running it.
      //
      // ⛔ **The control is that the spelling really DIFFERS**, or this asserts a fold on a string
      // that never needed folding (`a-positive-assertion-must-differ-from-the-default`).
      const shouted = DEFAULT_PROFILE_ID.toUpperCase()
      expect(shouted, 'the loud spelling is the stored one, so the fold is untested').not.toBe(
        DEFAULT_PROFILE_ID,
      )
      expect(thisAppWouldMintIt(shouted)).toBe(true)
    })

    /**
     * 🔴 **BroBot's own loop, end to end** (`HO-078` §3): it creates an agent, and then gives it a
     * piece of work, which starts a conversation as it. ⛔ Creation is the one fact that admits the
     * start: every agent may start any agent that exists (D-014).
     */
    it('🔴 BroBot creates an agent and then starts one, and a name nobody created is refused', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const tools = toolsOfLastLaunch()

      expect((await callOn(tools, 'create_agent', { profile_slug: 'pm-webapp' })).outcome).toBe(
        'ok',
      )
      const started = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm-webapp',
        title: 'DEV-75297',
        brief: 'Look at DEV-75297.',
      })
      expect(started.outcome, JSON.stringify(started)).toBe('ok')
      expect(started.started).toBe(true)

      // ⛔ **The same call one fact over, REFUSED** (standing rule 3): a name nobody created.
      const refused = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm-nobody-created',
        title: 'a name that was never created',
        brief: 'Look at DEV-75297.',
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('no-such-profile')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · HO-078 §5 — the app assigns the name, at creation and nowhere else
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the app assigns a human name, and only when a row comes into being', () => {
    /**
     * 🔴 **The sequence a fresh install walks, asserted as a sequence.** ⛔ A generator that handed
     * out one word would satisfy *it has a name*; **uniqueness at assignment** is only visible
     * across two of them (`HO-078` §5.2).
     */
    it('🔴 the first agent is the first name, the second is the second', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const tools = toolsOfLastLaunch()
      await callOn(tools, 'create_agent', { profile_slug: 'alpha' })
      await callOn(tools, 'create_agent', { profile_slug: 'beta' })

      expect(nameColumn('alpha')).toBe(HUMAN_NAMES[0])
      expect(nameColumn('beta')).toBe(HUMAN_NAMES[1])
      // ⚑ **And the surface reads it back**, which is the half a column cannot state: `agentName`
      // is what every identity surface has asked since `449`/`537`.
      expect(agentName('alpha', store.agentIdentities())).toBe(HUMAN_NAMES[0])
    })

    /**
     * ⛔ **BroBot is the one slug the generator leaves alone**, and the reason is `538`'s: with a
     * roster and without one, {@link agentName} already answers *BroBot (default)* — so a handle
     * there would be a second answer to a question this app already answers, and it would be the
     * FIRST name of BroBot's own list, leaving every fresh install one short.
     */
    it('⛔ BroBot is left nameless, and it is the ONLY identity that is', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      await personOpens('archivist')

      expect(nameColumn(DEFAULT_PROFILE_ID)).toBeNull()
      expect(agentName(DEFAULT_PROFILE_ID, store.agentIdentities())).toBe(DEFAULT_PROFILE_LABEL)
      // ⚑ **The pair, in the same sample** — otherwise *BroBot has no name* is satisfied by a
      // generator that never ran.
      expect(nameColumn('archivist')).toBe(HUMAN_NAMES[0])
    })

    /**
     * 🔴 **A person's word beats the app's, and an absence does not** — the two halves of
     * `HO-078` §5 meeting at one door. ⚠️ **`NewAgent.vue` sends `trim() === '' ? null : …`**, so a
     * person who cleared the box arrives here as `null` and gets the app's name; a person who typed
     * one arrives with their string and keeps it.
     */
    it('🔴 a person’s typed name wins, and a blank one falls through to the app’s', () => {
      store.createAgentIdentity(
        {
          slug: 'typed',
          displayName: 'The Boss',
          provider: null,
        },
        { by: 'a-person' },
      )
      store.createAgentIdentity(
        { slug: 'blank', displayName: '   ', provider: null },
        { by: 'a-person' },
      )

      expect(nameColumn('typed')).toBe('The Boss')
      expect(nameColumn('blank')).toBe(HUMAN_NAMES[0])
    })

    /**
     * ⛔ **Standing rule 11 at the door that still mints.** ⚑ `ensureIdentityRow` is `INSERT OR
     * IGNORE`, so a launch after a person emptied the box writes nothing — **the app may seed a
     * default at creation and never re-grants what a person removed.**
     *
     * ⚠️ **Measured where the readings DIVERGE** (standing rule 3): the generator would have a name
     * to give, and gives none.
     */
    it('⛔ a launch never re-names an identity a person emptied', async () => {
      await personOpens('archivist')
      expect(nameColumn('archivist')).toBe(HUMAN_NAMES[0])
      expect(store.setAgentDisplayName('archivist', null)).toBe(true)

      await host.closeAll()
      store = createSessionStore(db, tick)
      host = buildHost()
      await personOpens('archivist')

      expect(nameColumn('archivist'), 'a launch re-granted a name the person removed').toBeNull()
      // ⚑ **The control**: the generator is not empty — a SECOND identity minted by the same host
      // still gets one, so the null above is the `INSERT OR IGNORE` rather than a broken seed.
      await personOpens('courier')
      expect(nameColumn('courier')).not.toBeNull()
    })

    /**
     * ⚠️ **Uniqueness is asked of BOTH columns, and that is the clause `HO-078` §5.2 buys.** ⛔ An
     * agent addressed as `ada` beside one displayed as *Ada* is a collision a person trips over
     * whichever column produced it — so the slug counts as taken.
     */
    it('⚠️ a name already answered to by a SLUG is skipped, not only one in the name column', () => {
      // 🔴 **The FIRST version of this test measured nothing, and the mutation row is what said
      // so** (`a-comparison-tested-where-both-sides-agree-measures-nothing`, bought by the author
      // of the row). ⛔ It opened a conversation as `ada` and read the next agent's name — **but
      // that launch ALSO assigned `ada` the display name *Ada***, so the two columns held the same
      // word and a generator reading only `display_name` answered identically. ⚑ `584 M5` survived
      // its first pass for exactly that reason.
      //
      // ⛔ **So the identity is ADDRESSED as `ada` and DISPLAYED as something else**, and the only
      // thing left that can make the generator skip *Ada* is the slug column.
      store.createAgentIdentity(
        {
          slug: foldProfileName(HUMAN_NAMES[0]!),
          displayName: 'The Boss',
          provider: null,
        },
        { by: 'a-person' },
      )
      store.createAgentIdentity(
        {
          slug: 'courier',
          displayName: null,
          provider: null,
        },
        { by: 'a-person' },
      )
      expect(nameColumn('courier')).toBe(HUMAN_NAMES[1])
      // ⚑ **The premise, asserted**: the display column really does NOT hold that word, so the
      // skip above is about the slug (`a-positive-assertion-must-differ-from-the-default`).
      expect(nameColumn(foldProfileName(HUMAN_NAMES[0]!))).toBe('The Boss')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · BroBot's own list, and the names after it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · BroBot’s own list, and the names after it', () => {
    /**
     * ⛔ **A set whose members must differ needs a distinctness check**
     * (`an-enumeration-whose-members-must-differ-needs-a-distinctness-check`), and it must differ
     * on the axis the code actually compares — which is {@link foldProfileName}, not the literal.
     */
    it('⛔ every name is distinct AFTER folding, and each one is a name a column can hold', () => {
      const folded = HUMAN_NAMES.map((name) => foldProfileName(name))
      expect(new Set(folded).size, 'two pool names fold to one').toBe(HUMAN_NAMES.length)
      expect(HUMAN_NAMES.length).toBeGreaterThan(20)
      for (const name of HUMAN_NAMES) {
        expect(name.trim(), `${name} is not trimmed`).toBe(name)
        expect(name.length, `${name} is longer than the column`).toBeLessThanOrEqual(
          AGENT_DISPLAY_NAME_CHARS,
        )
        // ⛔ **No pool member may fold to nothing**, or it would be skipped for ever and the
        // sequence would silently be one shorter than the list.
        expect(foldProfileName(name), `${name} folds away`).not.toBe('')
      }
    })

    /** Past BroBot's own list the names come from Faker's, and none of them is one already taken. */
    it('🔴 once BroBot’s own list is taken, the next name is still one nothing answers to', () => {
      const next = aNameForANewAgent(HUMAN_NAMES, Math.random)
      expect(HUMAN_NAMES.map(aNameKey)).not.toContain(aNameKey(next))
      // ⚑ **One fewer taken and BroBot's own list answers again**, in its order.
      expect(aNameForANewAgent(HUMAN_NAMES.slice(1), Math.random)).toBe(HUMAN_NAMES[0])
    })

    /** The agent past BroBot's own list is named too: the list running out names nobody blank. */
    it('⛔ the agent after BroBot’s own list still gets a name', () => {
      // ⚑ **The roster is filled through the store's own door**, so what takes the list is the
      // same column the generator reads rather than a fixture reaching around it.
      for (const name of HUMAN_NAMES) {
        store.createAgentIdentity(
          {
            slug: foldProfileName(name),
            displayName: null,
            provider: null,
          },
          { by: 'a-person' },
        )
      }
      const made = store.createAgentIdentity(
        {
          slug: 'one-too-many',
          displayName: null,
          provider: null,
        },
        { by: 'a-person' },
      )
      expect(made?.slug).toBe('one-too-many')
      const named = nameColumn('one-too-many')
      expect(named).toEqual(expect.any(String))
      expect(HUMAN_NAMES.map(aNameKey)).not.toContain(aNameKey(named!))
    })

    /** ⚠️ **A name that is blank or punctuation is not a collision** (086, the other way round). */
    it('⚠️ an unreadable name in the roster does not take a name with it', () => {
      expect(aNameForANewAgent(['   ', '?', ''], Math.random)).toBe(HUMAN_NAMES[0])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the agent never chooses and never asks
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · what `create_agent` advertises, and what it answers', () => {
    /**
     * 🔴 **The RAIL is the missing field, and the sentence is not** (standing rule 8.3: *a capture
     * proves what the provider was given; nothing proves the model obeyed it*). ⛔ An instruction
     * saying *do not ask what to call it* would be a sentence; a schema with no field for the
     * answer is a door.
     *
     * ⚠️ **`348`'s `z.looseObject` is why the TYPE had to go too**: an undocumented key is NOT
     * stripped, so a reader left behind would be a path a test could drive and no model was ever
     * told about.
     */
    it('🔴 the tool advertises no name at all, and sends the door a null', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const tool = toolsOfLastLaunch().tools.find((one) => one.name === 'create_agent')
      expect(tool, 'create_agent is not published').toBeDefined()
      // ⚑ **618 · `rules` joined the shape** (`HO-078` §4) — standing rule 26: the FACT moved,
      // and the claim this line makes is about `display_name`, which is still absent. ⛔ The
      // equality is kept rather than loosened to a `not.toContain`, because a `toEqual` is what
      // makes a FOURTH key somebody adds for another reason arrive as a decision.
      // ⚑ **D-042 · R2 · `model` and `effort` joined it, as that decision** — the agent's DEFAULT,
      // what its new conversations start on. ⛔ Neither names the agent, so `display_name` is still
      // the claim, and still absent.
      // ⚑ `kind` joined it: a normal agent or a service, fixed when it is made. It names no agent.
      expect(Object.keys(tool?.input ?? {}).sort()).toEqual([
        'effort',
        'kind',
        'model',
        'profile_slug',
        'provider',
        'rules',
      ])
      // ⛔ **Asserted at the DOOR as well as in the schema**, because the two could disagree only
      // silently: an undocumented key reaches the handler under `looseObject`.
      const made = await callOn(toolsOfLastLaunch(), 'create_agent', {
        profile_slug: 'ignored-name',
        display_name: 'What The Model Wanted',
      })
      expect(made.outcome, JSON.stringify(made)).toBe('ok')
      expect(nameColumn('ignored-name')).toBe(HUMAN_NAMES[0])
    })

    /**
     * ⛔ **The answer NAMES what this app chose, and that is what keeps *no round trip* true.** ⚑ A
     * door that assigns silently is a door a model has to ask about: the caller would have nothing
     * to put in the message it writes next, and asking the person is exactly what `HO-078` §5.1
     * measured costing a run.
     */
    it('⛔ the success answer tells the caller the name, in the payload AND in the sentence', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      const made = await callOn(toolsOfLastLaunch(), 'create_agent', { profile_slug: 'pm-travel' })
      expect(made.display_name).toBe(HUMAN_NAMES[0])
      const tool = toolsOfLastLaunch().tools.find((one) => one.name === 'create_agent')
      const said = await tool?.call({ profile_slug: 'pm-nordics' })
      expect(said?.text).toContain(`this app named it ${HUMAN_NAMES[1]!}`)
      // ⚑ **And the description says so too**, so a model reads it before it has anything to ask
      // about rather than after.
      expect(tool?.description).toContain('tells you what it chose')
    })

    /** Past BroBot's own list, the caller is told the name it got all the same. */
    it('⚠️ …and past BroBot’s own list, the answer names the agent all the same', async () => {
      for (const name of HUMAN_NAMES) {
        store.createAgentIdentity(
          {
            slug: foldProfileName(name),
            displayName: null,
            provider: null,
          },
          { by: 'a-person' },
        )
      }
      await personOpens(DEFAULT_PROFILE_ID)
      const tool = toolsOfLastLaunch().tools.find((one) => one.name === 'create_agent')
      const said = await tool?.call({ profile_slug: 'one-too-many' })
      expect((said?.structured as Record<string, unknown>).outcome).toBe('ok')
      const named = (said?.structured as Record<string, unknown>).display_name
      expect(named).toBe(nameColumn('one-too-many'))
      expect(said?.text).toContain(`this app named it ${String(named)}`)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · HO-078 §1.2 — nothing is taken from an install that has it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · an existing install keeps everything it has', () => {
    /**
     * 🔴 **Standing rule 11, in the direction a migration could break it.** ⛔ *"A migration that
     * deletes them would be re-granting-in-reverse and it is forbidden."* ⚑ Asserted over the
     * shipped SQL rather than over a count of files, which would move every time anything lands —
     * since D-016 that is the one migration, `0000_the_tree.sql`, and whatever is added after it.
     */
    it('🔴 no migration deletes an identity', () => {
      const sql = readdirSync(migrationsFolder)
        .filter((name) => name.endsWith('.sql'))
        .map((name) => ({ name, text: readFileSync(join(migrationsFolder, name), 'utf8') }))
      // ⚑ The premise: there really are migrations to read, and the one that builds the tree is
      // among them.
      expect(sql.length).toBeGreaterThan(0)
      expect(sql.map((one) => one.name)).toContain('0000_the_tree.sql')

      for (const { name, text } of sql) {
        expect(
          /DELETE\s+FROM\s+[`"]?agent_identity[`"]?(?![_\w])/i.test(text),
          `${name} deletes an identity`,
        ).toBe(false)
      }
      // ⛔ **The control the sweep needs** (standing rule 12): the pattern really does match, so the
      // negative above is a measurement rather than a regex that never fires.
      expect(
        /DELETE\s+FROM\s+[`"]?agent_identity[`"]?(?![_\w])/i.test('DELETE FROM agent_identity'),
      ).toBe(true)
    })

    /**
     * ⚑ **The app's own writer cannot overwrite a row that exists**, which is what makes every
     * sentence above a property of the STATEMENT rather than of an ordering. ⛔ Asserted over the
     * source, prose stripped, so a docblock cannot answer for code.
     */
    it('⚑ every write this app makes to an identity row is `INSERT OR IGNORE` or a person’s UPDATE', () => {
      const code = withoutProse(readFileSync(join(SRC, 'main/db/session-store.ts'), 'utf8'))
      const writes = [
        ...code.matchAll(/`((INSERT|UPDATE|DELETE)[^`]*agent_identity(?![_\w])[^`]*)`/g),
      ].map((found) => found[1]!)
      expect(writes.length).toBeGreaterThan(2)
      for (const statement of writes) {
        expect(
          statement.startsWith('INSERT OR IGNORE') ||
            statement.startsWith('UPDATE') ||
            statement.startsWith('DELETE'),
          statement,
        ).toBe(true)
        // ⛔ **No bare INSERT** — one would fail on a row that exists rather than leaving it alone,
        // and the failure would surface as a broken launch rather than as a re-grant.
        expect(statement.startsWith('INSERT INTO'), statement).toBe(false)
      }
      // ⚑ **The control**: the sweep really reads statements, so the loop is a measurement.
      expect(writes.some((one) => one.startsWith('INSERT OR IGNORE INTO agent_identity'))).toBe(
        true,
      )
    })
  })
})

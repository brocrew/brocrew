import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, parametersOf } from '@brobot2/runtime'
import { type AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { ToolWatchingRuntime } from './lib/provider-double'
import { fixtureProviderConfig, RecordingSink, syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'
import { callOn } from './helpers/call-tool'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * # 🔴 553 · anyone may ask; work needs a relationship
 *
 * **Two PO rulings, and the first one narrows what `549` shipped three hours earlier.**
 *
 * > ⚑ **HO-060 §2:** *Anyone may ask anyone. Assigning work requires a relationship.*
 * > ⛔ **§2.2, the property rather than the mechanism:** *You spawned it, or a person granted you
 * > the right.*
 * >
 * > ⚑ **HO-060 §3:** *`kind` defaulting to `work` means a model that simply sends a message
 * > assigns work. That is backwards wherever it happens, including between a parent and its own
 * > child.*
 *
 * ⚑ **D-014 kept §2.2's first arm and nothing else**: work goes only to a conversation the giver
 * started. No per-agent grant narrows it.
 *
 * ## ⚑ D-016 · work is GIVEN, by profile, and a message never carries it
 *
 * ⛔ **The `work` kind of message is gone**, and with it the rail that refused one to a conversation
 * the caller did not start (`assign-work-to-one-you-did-not-start`) and `admitAssignment`. ⚑ Work is
 * handed out with `give_work`, which names an AGENT, not a conversation: it goes to the giver's one
 * conversation with that agent, started for it the first time. **So the relationship is how the
 * give finds its conversation** — a conversation a person opened is never one a give reaches.
 * A message is a note or a follow-up on a piece the sender gave.
 *
 * ## ⛔ Why a GIVE and two strangers are in the fixture
 *
 * ⚠️ **A test that exercised only the admitted pair would pass under a gate that admitted
 * everything.** ⛔ So the fixture below plants two conversations a person opened, which this caller
 * did not start, and a child this caller started — and every section asks the same question of
 * each, which is `a-comparison-tested-where-both-sides-agree-measures-nothing`.
 *
 * ## ⚑ What fails on `main` at `b688a9b2`, and it is every section
 *
 * ⛔ **§1** — a `work` message to a conversation the caller did not start is ADMITTED and mints a
 * task. ⛔ **§3** — the omitted `kind` defaulted to
 * `'work'` there, so it opened one. ⚑ Since D-010 there is no default: an omitted kind is refused,
 * and since D-016 no kind of message gives work at all.
 *
 * ## ⚠️ What this file does NOT measure, and where it is measured instead
 *
 * ⛔ **The provider asymmetry behind §3's choice** — the MCP SDK's parse-and-throw against Codex's
 * unparsed hand-off — is `538` §3.3's measurement and is not re-derived here; what §3 asserts is
 * the CHOICE that measurement decided, which is that the argument stayed optional.
 * ⛔ **The exhaustive act and rail tables** are `the-rails-a-message-passes.test.ts` and
 * `a-floor-under-the-most-destructive-verb.test.ts` §7, which `553` re-aimed rather than copied.
 */

/** ⚑ **A `FakeRuntime` that keeps the toolset it was launched with** — `431`'s device. */
describe('553 · anyone may ask; work needs a relationship', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-553-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-553-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  /** `423`'s *New conversation as …* — a person opens a conversation. */
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

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  /**
   * 🔴 **The fixture — one caller, and TWO receivers it stands in two different relations to.**
   *
   * ⛔ **`boss` is the caller under test.** It STARTED `child`, by giving it a piece (D-016); it has
   * no relation of any kind to `stranger` or `peer`, which a person opened. ⚑ **So the admitted
   * pair and the refused pair are present in one fixture**, and a gate that admitted everything and
   * one that admitted nothing are told apart by the same test.
   */
  const aBossItsChildAndAStranger = async (): Promise<{
    boss: string
    bossTools: AgentToolset
    child: string
    label: string
    peer: string
    stranger: string
  }> => {
    const stranger = await personOpens('scribe')
    // ⚑ **A third receiver the caller did not start** — the reading `431` reported and did not
    // ship: *every conversation in your project, whoever started it*. ⚠️ Since D-016 there is no
    // project, and it stays as a second conversation the caller did not start.
    const peer = await personOpens('archivist')
    // ⛔ **An identity exists when a conversation has actually run as it** (criterion 12), so the
    // name a give will use is brought into being by a person before it can be given to —
    // `admitGive` refuses `no-such-profile` otherwise, which is a rail about names and not about
    // this ruling.
    await personOpens('hand')
    const boss = await personOpens('lead')
    const bossTools = theToolsetJustHandedOut()
    const given = await callOn(bossTools, 'give_work', {
      to: 'new',
      conversation_title: 'the work',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'hand',
      title: 'the work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const child = given.agent as string

    // ⚠️ **The premises.** ⛔ One parent edge, no parent edge.
    expect(store.parentOf(child)).toBe(boss)
    expect(store.parentOf(stranger)).toBeNull()
    expect(store.parentOf(peer)).toBeNull()
    return { boss, bossTools, child, label: given.label as string, peer, stranger }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · HO-060 §2 · the three cases the brief asks for, in one place
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · anyone may ask; assigning work requires a relationship', () => {
    /**
     * 🔴 **The whole ruling, over ONE caller, at ONE moment** (standing rule 3 + rule 12).
     *
     * ⛔ **Three verdicts and they must all be taken from the same identity**: a note to a
     * conversation the caller did not start with nothing granted, work given to the agent that
     * conversation runs as, and work given to the agent of a conversation this caller started. ⚑
     * **Split across three fixtures the first two would prove nothing** — a give that reached
     * whatever ran as the agent would pass the first and the last alike.
     *
     * ⚑ **D-016 · a give names an AGENT**, so *the same words as work* are a give to the stranger's
     * own agent — and they reach a conversation the caller starts for them, never the stranger.
     */
    it('🔴 a note crosses · work never reaches what it did not start · work reaches what it started', async () => {
      const { boss, bossTools, child, peer, stranger } = await aBossItsChildAndAStranger()

      // ⚑ **ADMITTED · a note to one it did not start, with nothing granted.** HO-060 §2.1:
      // *a worker asking another project's specialist how they handled this last time opens
      // nothing*, and BroBot used this arm the night the work arm refused it.
      const asked = await callOn(bossTools, 'message_agent', {
        agent: stranger,
        text: 'how did you handle this last time?',
        kind: 'note',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      expect(asked.kind).toBe('note')

      // ⛔ **NOT THE STRANGER · the same moment, the stranger's own agent given work.** The give goes
      // to the one conversation this caller has with that agent — none yet, so one it starts —
      // and nothing at all reached the conversation a person opened.
      const given = await callOn(bossTools, 'give_work', {
        to: 'new',
        conversation_title: 'for me',
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'scribe',
        title: 'for me',
        brief: 'please do this for me',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.agent).not.toBe(stranger)
      expect(store.parentOf(given.agent as string)).toBe(boss)
      expect(store.piecesOwnedBy(stranger)).toHaveLength(0)

      // ⛔ **NOT THE PEER · a second conversation that it did not start.** ⚠️ This is the half `431`
      // reported and declined to ship — *every conversation in your project, whoever started it* —
      // and D-014 refuses it at every word: a desk in the same room is not a conversation you
      // started.
      const nearby = await callOn(bossTools, 'give_work', {
        to: 'new',
        conversation_title: 'for me',
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'for me',
        brief: 'please do this for me',
      })
      expect(nearby.outcome, JSON.stringify(nearby)).toBe('ok')
      expect(nearby.agent).not.toBe(peer)
      expect(store.piecesOwnedBy(peer)).toHaveLength(0)
      // ⚑ **…and a note reaches it**, so what did not reach it is the work and not the words.
      expect(
        (
          await callOn(bossTools, 'message_agent', {
            agent: peer,
            text: 'how do you do this?',
            kind: 'note',
          })
        ).outcome,
      ).toBe('ok')

      // ⚑ **REACHED · work to the agent of a conversation this caller STARTED** — the one
      // relationship the rule admits, and it needs nobody to open a sheet.
      const handed = await callOn(bossTools, 'give_work', {
        to: child,
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'hand',
        title: 'the thing',
        brief: 'do the thing',
      })
      expect(handed.outcome, JSON.stringify(handed)).toBe('ok')
      expect(handed.agent).toBe(child)
      const mine = store.piecesGivenBy(boss).filter((one) => one.owner === child)
      expect(mine).toHaveLength(2)
      expect(TASK_IS_OPEN[mine.at(-1)!.state]).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · HO-058 §4 · the configuration burden
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a sheet a person never has to open', () => {
    /**
     * > 🔴 **The standing test (HO-058 §4):** *A person should never have to open a capability
     * > sheet to make a newly created agent do the thing its category exists to do.*
     *
     * ⛔ **A project manager's category exists to STAFF its project**, and any agent may add an agent, start it, and give it work — so a project
     * manager an agent created does all three.
     */
    it('🔴 a created project manager staffs and gives work', async () => {
      await personOpens('maker')
      const makerTools = theToolsetJustHandedOut()
      const made = await callOn(makerTools, 'create_agent', {
        profile_slug: 'fresh-pm',
        display_name: 'Fresh',
      })
      expect(made.outcome, JSON.stringify(made)).toBe('ok')

      const pm = await personOpens('fresh-pm')
      const pmTools = theToolsetJustHandedOut()
      const staffed = await callOn(pmTools, 'create_agent', {
        profile_slug: 'fresh-hand',
        display_name: 'Hand',
      })
      expect(staffed.outcome, JSON.stringify(staffed)).toBe('ok')
      // ⚑ **D-016 · starting it and giving it work are one act** — the give starts it.
      const given = await callOn(pmTools, 'give_work', {
        to: 'new',
        conversation_title: 'the piece',
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'fresh-hand',
        title: 'the piece',
        brief: 'here is the piece',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(store.piecesGivenBy(pm)).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · HO-060 §3 · the default kind must be harmless
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a model that simply sends a message assigns nothing', () => {
    it('a Message never opens a piece, and only a Give opens one', async () => {
      const { boss, bossTools, child } = await aBossItsChildAndAStranger()
      const before = store.piecesGivenBy(boss).length
      expect(before).toBe(1)

      for (const kind of [undefined, 'note', 'work']) {
        const sent = await callOn(bossTools, 'message_agent', {
          agent: child,
          text: 'a thought about the thing',
          ...(kind === undefined ? {} : { kind }),
        })
        expect(sent, JSON.stringify(sent)).toMatchObject({ outcome: 'ok', kind: 'note' })
        expect(store.piecesGivenBy(boss)).toHaveLength(before)
      }

      const given = await callOn(bossTools, 'give_work', {
        to: 'new',
        conversation_title: 'the thing',
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'hand',
        title: 'the thing',
        brief: 'a thought about the thing',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(store.piecesGivenBy(boss)).toHaveLength(before + 1)
    })

    it('publishes Message without a kind parameter', async () => {
      const { bossTools } = await aBossItsChildAndAStranger()
      const tool = bossTools.tools.find((one) => one.name === 'message_agent')
      if (tool === undefined) throw new Error('message_agent is not published')
      const kind = parametersOf(tool.input ?? {}).find((one) => one.name === 'kind')
      expect(kind).toBeUndefined()
    })

    // ⚑ **Landing D-014 · `1014 M23`**: what a model is told about giving work is what the rail
    // does. A sentence offering another way in sends it to a door that is permanently shut. ⚑
    // **D-016** — the message tool sends work to `give_work`, and the give says where work goes.
    it('the description sends work to give_work, which names a destination', async () => {
      const { bossTools } = await aBossItsChildAndAStranger()
      const tool = bossTools.tools.find((one) => one.name === 'message_agent')
      if (tool === undefined) throw new Error('message_agent is not published')
      expect(tool.description).toContain('To give work, use give_work')
      expect(tool.description).not.toContain('takes work from anybody')
      expect(tool.description).not.toContain('granted you more')
      const give = bossTools.tools.find((one) => one.name === 'give_work')
      if (give === undefined) throw new Error('give_work is not published')
      expect(give.description).toContain('to: "new" starts a new conversation for a new job')
      expect(give.description).toContain("A conversation's task label adds a new task there")
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · what the brief said must NOT move, pressed rather than promised
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · HO-026 §2', () => {
    it('a known colleague waiting on a person keeps its question open', async () => {
      const { bossTools, stranger } = await aBossItsChildAndAStranger()

      // ⚑ **Admitted**, so the refusals below are about the act and not about the pair.
      expect(
        (
          await callOn(bossTools, 'message_agent', {
            agent: stranger,
            text: 'here is a note',
            kind: 'note',
          })
        ).outcome,
      ).toBe('ok')

      await expect
        .poll(() => store.routedRequestsOf(stranger).some((request) => request.state === 'open'))
        .toBe(true)
      const waiting = store.routedRequestsOf(stranger)
      expect(waiting.some((request) => request.state === 'open')).toBe(true)
      const refused = await callOn(bossTools, 'interrupt_agent', { agent: stranger, reason: 'no' })
      expect(refused).toMatchObject({ outcome: 'refused', rail: 'a-person-is-being-asked' })
      expect(store.routedRequestsOf(stranger)).toEqual(waiting)
      expect(host.sessionIds).toContain(stranger)
    })
  })
})

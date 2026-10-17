import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { AgentState } from '../src/shared/agent-state'
import {
  DEFAULT_PROFILE_ID,
  type ResumableSessionInfo,
  type RuntimeEventMessage,
  type RuntimeStatesMessage,
  type TranscriptEvent,
  type UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'

/**
 * # F036 · an agent that owes another an answer says so — the host half (`80bff428`)
 *
 * ## What this file pins, and why it is its own file
 *
 * `80bff428` gave the one state its eighth arm, `owes-an-answer`: a conversation whose turn has
 * ended with a question still open that another conversation put to it — as its parent, or by name
 * — reads *"owes an answer to Ada (the owner of W1.1 · Build the pages)"*. The commit pinned the
 * ladder as a pure function (`the-one-state-ranks-its-six-facts-in-one-order` §1) and re-aimed one
 * census, and drove nothing on a real host: the scratch that proved the push was archived, not
 * committed. So nothing measured the INCREMENTAL machinery the commit is mostly made of:
 *
 *  - **the index** (`routedTo`), seeded ONCE per app run from `SessionStore.whoRoutedToWhom` and
 *    kept up to date by every routing written since (§1, §6);
 *  - **the re-asks** — a `request_routed` row re-asks the conversation it names (§1); a row that
 *    moves a noted asker's questions re-asks the one that owes (§1's answer); an asker's STATUS
 *    re-asks it, because a provider's own question is owed only while its asker is parked (§3); a
 *    replacement re-asks both sides (§4);
 *  - **what is not owed** — a question addressed to a person, though its routing names the parent
 *    (§2);
 *  - **the kept read** (`owedAsLastRead`) — a running conversation's owed set is kept until a row
 *    moves it, which is why every re-ask above is load-bearing and not just tidy;
 *  - **the cost** — a listing folds each asker's ledger once, however many conversations owe it
 *    (§5), and the index's seed is read once (§6);
 *  - **the stop** — owing an answer is idle enough to stop, and the stopped conversation still says
 *    it (§7).
 *
 * ## ⚠️ How a pushed word is asserted
 *
 * A card or a listing derives fresh at every read, so it says the right word even when the KEPT
 * read a flush works from went stale. Every assertion on a PUSHED word reads `pushed` and nothing
 * else (`a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`'s rule), and a fresh read is
 * compared only after the pushed word has been collected.
 *
 * ## ⚠️ Why the names are literals
 *
 * `ADA` is spelled out and never computed by the code under test: the D-036 file's family — BroBot
 * gives `W1.1` *Build the pages* to a new `worker`, who is minted *Ada* — so a rename of the naming
 * function cannot move the expectation with it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** BroBot's child, as every door names her: the first new agent, by the piece she owns. */
const ADA = 'Ada (the owner of W1.1 · Build the pages)'
const OWES_ADA = `owes an answer to ${ADA}`
const WAITING_ON_ADA = `waiting on ${ADA}`

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A stretch of the event loop long enough for everything a provider row starts to have run: five
 * turns of `setImmediate` (each pump, and the flush a mark arms, run there) and a short timer.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

/** A start the test can hold at the provider (D-036 §13's gate). */
interface StartGate {
  hold: Promise<void> | null
  release: () => void
  entered: number
}

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly startGate: StartGate,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    this.startGate.entered += 1
    if (this.startGate.hold !== null) await this.startGate.hold
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

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

/** A delay no other timer in the host uses, and no test waits out (D-036 §15's). */
const IDLE = 7_654_321

/** One countdown the host armed: the timer it got back and the callback it armed it with. */
interface Countdown {
  readonly timer: ReturnType<typeof setTimeout>
  readonly fn: () => void
}

describe('F036 · the host says who a conversation owes an answer to, and moves the word when that moves', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let startGate: StartGate
  let counter: number
  let clock: number
  let window: RecordingSink
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  /** The index's one seed — F071: read once per app run, never per read. */
  let seeded: MockInstance<SessionStore['whoRoutedToWhom']>
  let setTimeoutSpy: MockInstance<typeof setTimeout>
  let clearTimeoutSpy: MockInstance<typeof clearTimeout>
  let fired: Set<ReturnType<typeof setTimeout>>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, startGate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ The dep that makes the host derive and push at all — what main hands every window.
      statesMoved: (message) => {
        pushed.push(message)
      },
      // ⚑ D-018 · idle minutes counted on a delay nothing else uses and no case waits out — §7
      // runs its countdowns out by hand; everywhere else they never fire.
      idleStopAfterMs: IDLE,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-owes-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-owes-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    // ⚑ Call-through: the host still reads the real index; the test counts how often it does.
    seeded = vi.spyOn(store, 'whoRoutedToWhom')
    counter = 0
    hosts = []
    handles = []
    pushed = []
    startGate = { hold: null, release: () => undefined, entered: 0 }
    issued = new FakeProviderSessions()
    fired = new Set()
    // Call-through: the host still gets real timers, the test gets to read what it armed.
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    startGate.release()
    for (const built of hosts) await built.closeAll()
    for (const { timer } of armedAt(IDLE)) clearTimeout(timer)
    vi.restoreAllMocks()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  /** Every state pushed for one conversation, in order. */
  const saidOf = (id: string): AgentState[] =>
    pushed
      .flatMap((message) => message.moved)
      .filter((one) => one.conversation === id)
      .map((one) => one.state)
  const lastSaid = (id: string): AgentState | undefined => saidOf(id).at(-1)

  /** The card the app itself reads, through the clause no grant narrows — derived fresh. */
  const stateOf = (id: string): AgentState | undefined =>
    host.agentCard(id, THE_APP_ITSELF, id)?.state

  /** A list read, as the window makes it. */
  const listed = (id: string): ResumableSessionInfo | UnresumableSessionInfo | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find((row) => row.sessionId === id)
  const runningOf = (id: string): string | undefined => listed(id)?.running

  /** The provider double of a conversation, found by the ref its row carries. */
  const doubleOf = (id: string): FakeSessionHandle => {
    const row = listed(id)
    if (row === undefined || !('ref' in row)) throw new Error(`${id} is not a listed resumable row`)
    const found = handles.find((handle) => handle.ref.sessionId === row.ref.sessionId)
    if (found === undefined) throw new Error(`no provider double carries ${id}'s ref`)
    return found
  }

  /** Every `setTimeout` armed with exactly this delay, in order. */
  const armedAt = (ms: number): Countdown[] =>
    setTimeoutSpy.mock.calls.flatMap((call, index) =>
      call[1] === ms
        ? [
            {
              timer: setTimeoutSpy.mock.results[index]?.value as ReturnType<typeof setTimeout>,
              fn: call[0] as () => void,
            },
          ]
        : [],
    )
  const cleared = (): Set<unknown> => new Set(clearTimeoutSpy.mock.calls.map(([timer]) => timer))
  /** The countdowns the host really holds: neither cleared by a mark nor run out. */
  const live = (): Countdown[] =>
    armedAt(IDLE).filter(({ timer }) => !cleared().has(timer) && !fired.has(timer))

  /** What `get_agent_status` says of a conversation, in words, as another agent reads it. */
  const wordsOf = async (asking: string, about: string): Promise<string> => {
    const said = await callOn(agentToolsFor(host, asking), 'get_agent_status', { agent: about })
    expect(said.outcome, JSON.stringify(said)).toBe('ok')
    return (said.agent as { state: string }).state
  }

  /**
   * ⚑ **BroBot gives `W1.1` to Ada, and has settled on waiting on her** — D-036's
   * `aGiverWaitingOnAHelper`. Both run `auto`, so Ada's brief is a turn that ends, BroBot is handed
   * a stall notice, and BroBot's word has been DERIVED and pushed before anything is asked — so the
   * index of who routed to whom has been seeded, from a database that held no routing.
   */
  const aGiverWaitingOnAHelper = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    ada: string
    adaTools: AgentToolset
  }> => {
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    await settle()
    const brobotTools = agentToolsFor(host, brobot)
    const given = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      new: true,
      title: 'Build the pages',
      brief: 'build the pages',
    })
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const ada = given.agent as string
    await waitFor(() => turnsIn(ada) >= 1 && turnsIn(brobot) >= 1, 'the stall notice’s turn')
    await waitFor(
      () => lastSaid(brobot)?.is === 'waiting-on-a-worker',
      'the giver to be pushed as waiting on its helper',
    )
    await settle()
    expect(lastSaid(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    return { brobot, brobotTools, ada, adaTools: agentToolsFor(host, ada) }
  }

  /** Ada asks her parent, about the piece she holds; the id of the question. */
  const adaAsksHerParent = async (adaTools: AgentToolset, question = 'which schema?') => {
    const asked = await callOn(adaTools, 'ask_question', { who_answers: 'the-parent', question })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return asked.question as string
  }

  /** Wait until BroBot has been pushed the word `want`, and the turn the question started is over. */
  /** A pushed state as polled for: when its wait began is asserted with the rest, below. */
  const withoutSince = (state: AgentState | undefined): string =>
    JSON.stringify(state, (key, value: unknown) => (key === 'since' ? undefined : value))
  const untilPushed = async (id: string, want: AgentState, what: string): Promise<void> => {
    await waitFor(() => withoutSince(lastSaid(id)) === withoutSince(want), what)
    await settle()
    expect(lastSaid(id)).toEqual(want)
  }

  it('🔴 §1 · a question its child puts to it pushes the parent to *owes an answer to Ada*, and its answer pushes it back', async () => {
    const { brobot, ada, adaTools } = await aGiverWaitingOnAHelper()
    // ⛔ **THE PREMISE the index needs**: it was seeded before any routing existed, from a database
    // that held none — so what makes the routing below visible is the update every routing written
    // since makes, not a second seed.
    expect(seeded).toHaveBeenCalledTimes(1)
    expect(store.whoRoutedToWhom()).toEqual([])
    seeded.mockClear()

    const id = await adaAsksHerParent(adaTools)
    // 🔴 **THE PUSH** — the routing re-asks the parent it names; its turn ends with the question
    // open, and the state outranks its wait on Ada's work.
    await untilPushed(
      brobot,
      { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
      'the parent to be pushed as owing',
    )
    // ⚑ One derivation: the card, get_agent_status and a listing say the same, in the same words.
    expect(stateOf(brobot)).toEqual({ is: 'owes-an-answer', to: [ADA], since: expect.any(Number) })
    // ⚑ Since the question was put to it: the routing's own moment, which the asker's wait carries too.
    const asked = store.routedRequestsOf(ada).find((one) => one.requestId === id)?.at
    expect(asked).toEqual(expect.any(Number))
    expect(stateOf(brobot)).toMatchObject({ since: asked })
    expect(stateOf(ada)).toMatchObject({ is: 'waiting-on-an-answer', since: asked })
    const observer = await personOpens('reviewer')
    expect(await wordsOf(observer, brobot)).toBe(OWES_ADA)
    const agents = await callOn(agentToolsFor(host, observer), 'list_agents', {})
    const rows = agents.agents as { agent: string; state: string }[]
    expect(rows.find((one) => one.agent === brobot)?.state).toBe(OWES_ADA)
    // ⛔ The asker herself waits on the answer; she owes nobody.
    expect(stateOf(ada)?.is).toBe('waiting-on-an-answer')
    // ⚑ F071 · no second seed: every read above went through the index the routing updated.
    expect(seeded).not.toHaveBeenCalled()

    // ⚑ **THE PAIR — the answer, from the parent's own tool, and the word goes back.** The answer is
    // a row in the ASKER's ledger, so only the re-ask of a noted asker moves the parent's kept read.
    const before = saidOf(brobot).length
    const answered = await callOn(agentToolsFor(host, brobot), 'answer_question', {
      question: id,
      asked_by: ada,
      answers: [{ part: 'answer', answer: ['the one in schema.sql'] }],
    })
    expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
    await waitFor(
      () =>
        saidOf(brobot)
          .slice(before)
          .some((one) => one.is === 'waiting-on-a-worker'),
      'the answer to push the parent back to waiting on its helper',
    )
    await settle()
    expect(lastSaid(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    expect(await wordsOf(observer, brobot)).toBe(WAITING_ON_ADA)
  })

  it('⛔ §2 · a question its child ADDRESSED TO A PERSON names the parent and is not the parent’s to owe', async () => {
    const { brobot, ada, adaTools } = await aGiverWaitingOnAHelper()
    // ⚑ **First the positive, and its answer** — so Ada IS in the index as one who routes to
    // BroBot, and the only thing standing between her next question and *owes* is where it went.
    const first = await adaAsksHerParent(adaTools)
    await untilPushed(
      brobot,
      { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
      'the parent to owe the first',
    )
    const answered = await callOn(agentToolsFor(host, brobot), 'answer_question', {
      question: first,
      asked_by: ada,
      answers: [{ part: 'answer', answer: ['yes'] }],
    })
    expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
    await untilPushed(
      brobot,
      { is: 'waiting-on-a-worker', on: [ADA], since: expect.any(Number) },
      'the parent to be pushed back after the answer',
    )

    // ⚑ Now a question to a person, about the same piece.
    const asked = await callOn(adaTools, 'ask_question', {
      who_answers: 'a-person',
      piece: 'W1.1',
      question: 'which timezone should the clock open on?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const id = asked.question as string
    // ⛔ **THE PREMISE**: the routing names the parent (it may see and answer it, HO-088 §2.3) and
    // is open — only WHERE it went keeps it off the parent's owed set.
    const routing = store
      .routedRequestsOf(ada)
      .filter((one) => one.requestId === id)
      .at(-1)
    expect(routing).toMatchObject({
      state: 'open',
      parent: brobot,
      went: { is: 'the-person-the-asker-named' },
    })
    await settle()

    // 🔴 Fresh reads — a card, a tool and a listing, none of them a kept read — say it waits on Ada.
    expect(stateOf(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    const observer = await personOpens('reviewer')
    expect(await wordsOf(observer, brobot)).toBe(WAITING_ON_ADA)
    expect(listed(brobot)?.state).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    // …and nothing pushed it as owing since.
    expect(lastSaid(brobot)?.is).not.toBe('owes-an-answer')
    // ⛔ And the index never learnt a person's routing as one to owe.
    expect(store.whoRoutedToWhom()).toEqual([{ asker: ada, parent: brobot }])
  })

  it('🔴 §3 · a question the child’s PROVIDER raised is owed while the child is parked on it, and not once it is not', async () => {
    const { brobot, ada } = await aGiverWaitingOnAHelper()
    const adaHandle = doubleOf(ada)
    expect(adaHandle.status()).toBe('idle')

    // ⚑ The provider's own question, held open the way a real adapter holds it
    // (`a-question-a-grandchild-asked-is-not-yours-to-cut-into.test.ts`'s `childAsksItsParent`).
    const raised = adaHandle.simulateUserInput('which branch?', ['main', 'dev'], false)
    const release = adaHandle.waitForAPerson()
    await waitFor(
      () =>
        ledger(ada).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      'the routing of the provider’s question',
    )
    expect(adaHandle.status()).toBe('waiting_permission')
    // ⛔ THE PREMISE: it went to the parent, and nobody answered it.
    expect(
      store
        .routedRequestsOf(ada)
        .filter((one) => one.requestId === raised.id)
        .at(-1),
    ).toMatchObject({ state: 'open', parent: brobot, went: { is: 'the-parent' } })

    // 🔴 Parked on it: the parent owes it.
    await untilPushed(
      brobot,
      { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
      'the parent to owe the card',
    )

    // ⚑ **THE PAIR — the child is no longer parked**, and the question is still unanswered and open
    // in its ledger: only its STATUS moved, and that re-asks the parent, whose read was kept.
    const before = saidOf(brobot).length
    release()
    await waitFor(() => adaHandle.status() !== 'waiting_permission', 'the child to be unparked')
    await waitFor(
      () =>
        saidOf(brobot)
          .slice(before)
          .some((one) => one.is !== 'owes-an-answer'),
      'the parent to be pushed as no longer owing',
    )
    await settle()
    expect(lastSaid(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
    expect(stateOf(brobot)).toEqual({
      is: 'waiting-on-a-worker',
      on: [ADA],
      since: expect.any(Number),
    })
  })

  it('🔴 §4 · a stand-in owes what the conversation it replaced owed, and the replaced one owes nothing', async () => {
    const { brobot, adaTools } = await aGiverWaitingOnAHelper()
    await adaAsksHerParent(adaTools)
    await untilPushed(
      brobot,
      { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
      'the parent to owe it',
    )

    // The parent is stopped and its provider forgets it, so a message to it is a replacement. The
    // start is held at the provider while the stand-in is derived for the first time.
    await host.close(brobot, window)
    issued.forgetAll()
    startGate.hold = new Promise<void>((resolve) => {
      startGate.release = resolve
    })
    const entered = startGate.entered
    // The next id this host hands out is the stand-in's: read it before the act that mints it.
    const standIn = `sess_${String(counter + 1)}`
    const sending = host.startAndSend(brobot, 'are you there', window)
    await waitFor(() => startGate.entered === entered + 1, 'the replacement to reach the provider')
    // ⚑ The flush runs while the stand-in is still starting: it derives its first word now — and
    // KEEPS the owed read it took, before it stood in anybody's place.
    await settle()
    expect(saidOf(standIn).map((one) => one.is)).toEqual(['active'])
    startGate.release()
    const answer = await sending
    if (!('sent' in answer)) throw new Error(`nothing was sent: ${JSON.stringify(answer)}`)
    const next = answer.sent.sessionId
    startGate.hold = null
    // The premise: a new conversation stands in the parent's place.
    expect(next).toBe(standIn)
    expect(ledger(brobot).some((event) => event.type === 'replaced_by')).toBe(true)

    // ⚠️ Its own turn: should the stand-in not carry the `auto` mode over, it parks on a card, which
    // is allowed so the turn ends (D-036 §13's step).
    await waitFor(
      () => turnsIn(next) >= 1 || ledger(next).some((event) => event.type === 'permission_request'),
      'the stand-in’s turn to end or park',
    )
    const card = ledger(next).find((event) => event.type === 'permission_request')
    if (card?.type === 'permission_request' && turnsIn(next) === 0) {
      await host.respondPermission(next, card.id, { outcome: 'allow' }, window)
    }
    // 🔴 Its turn ends, and it owes what the one it replaced owed.
    await waitFor(() => turnsIn(next) >= 1, 'the stand-in’s turn to end')
    await waitFor(
      () => lastSaid(next)?.is === 'owes-an-answer',
      'the stand-in to be pushed as owing the answer',
    )
    await settle()
    expect(lastSaid(next)).toEqual({ is: 'owes-an-answer', to: [ADA], since: expect.any(Number) })

    // ⛔ THE PAIR — the replaced one owes nothing: it is listed, and it is idle.
    const old = listed(brobot)
    expect(old, 'the replaced conversation is listed').not.toBeUndefined()
    expect(old?.state).toEqual({ is: 'idle' })
  })

  it('⚑ §5 · a listing folds an asker’s ledger once, though another row owes it an answer', async () => {
    const { brobot, brobotTools, ada, adaTools } = await aGiverWaitingOnAHelper()
    // ⚑ A second helper, the control: it holds a piece BroBot gave and asked nobody anything.
    const second = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'tester',
      new: true,
      title: 'Review the pages',
      brief: 'review the pages',
    })
    expect(second, JSON.stringify(second)).toMatchObject({ outcome: 'ok', label: 'W1.2' })
    const control = second.agent as string
    await waitFor(() => turnsIn(control) >= 1, 'the control’s brief to end')
    await adaAsksHerParent(adaTools)
    await waitFor(() => lastSaid(brobot)?.is === 'owes-an-answer', 'the parent to owe it')
    await settle()

    // ⚑ Both helpers stopped: a stopped asker's ledger is READ by the listing (a running one's is
    // kept), so the count below measures the listing's own fold.
    for (const helper of [ada, control]) await host.close(helper, THE_APP_ITSELF)
    await waitFor(
      () => runningOf(ada) === 'not-running' && runningOf(control) === 'not-running',
      'both helpers to stop',
    )
    await settle()

    const reads = vi.spyOn(store, 'routedRequestsOf')
    reads.mockClear()
    const rows = host.resumableSessions()
    const readsOf = (id: string): number =>
      reads.mock.calls.filter(([sessionId]) => sessionId === id).length
    // ⛔ THE PREMISES: all three are rows of this one listing, and it did fold Ada as an asker —
    // the parent's row says it owes her.
    for (const id of [brobot, ada, control]) {
      expect(
        rows.find((row) => row.sessionId === id),
        `${id} is in the listing`,
      ).toBeDefined()
    }
    expect(rows.find((row) => row.sessionId === brobot)?.state).toEqual({
      is: 'owes-an-answer',
      to: [ADA],
      since: expect.any(Number),
    })
    // 🔴 Ada is read as often as the control, whose ledger is read for its own row alone: her
    // ledger served her own row AND the parent's owed answers from one fold.
    expect(readsOf(ada)).toBeGreaterThan(0)
    expect(readsOf(ada)).toBe(readsOf(control))
    // ⚑ And no listing reads the index again.
    expect(seeded).toHaveBeenCalledTimes(1)
  })

  it('⚑ §6 · the index names each asker and the conversation it routed to once, and never a person’s routing or a torn row', async () => {
    const { brobot, brobotTools, ada, adaTools } = await aGiverWaitingOnAHelper()
    const second = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'tester',
      new: true,
      title: 'Review the pages',
      brief: 'review the pages',
    })
    expect(second, JSON.stringify(second)).toMatchObject({ outcome: 'ok', label: 'W1.2' })
    const other = second.agent as string
    await waitFor(() => turnsIn(other) >= 1, 'the second helper’s brief to end')

    // Ada asks her parent twice; the second helper asks only a person.
    await adaAsksHerParent(adaTools, 'which schema?')
    await adaAsksHerParent(adaTools, 'which table?')
    const toAPerson = await callOn(agentToolsFor(host, other), 'ask_question', {
      who_answers: 'a-person',
      piece: 'W1.2',
      question: 'is the copy final?',
    })
    expect(toAPerson.outcome, JSON.stringify(toAPerson)).toBe('ok')
    // ⛔ THE PREMISE: the person's routing names the parent too.
    expect(store.routedRequestsOf(other).at(-1)).toMatchObject({
      parent: brobot,
      went: { is: 'the-person-the-asker-named' },
    })

    // 🔴 Each pair once; the person's routing is not an edge anybody owes on.
    expect(store.whoRoutedToWhom()).toEqual([{ asker: ada, parent: brobot }])

    // ⛔ A torn routing row — a payload that is not JSON — names no parent and is left out, without
    // throwing. Put far above the second helper's own ordinals, as D-036 §14 puts its torn row.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const top = (
      db.prepare('SELECT max(ordinal) AS top FROM events WHERE session_id = ?').get(other) as {
        top: number
      }
    ).top
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, (SELECT coalesce(max(generation), 0) FROM events WHERE session_id = ?), ?, 'request_routed', ?, ?)`,
    ).run('evt_torn_routing', other, other, top + 1000, '{not json at all', clock)
    expect(store.whoRoutedToWhom()).toEqual([{ asker: ada, parent: brobot }])
    warned.mockRestore()
  })

  describe('§7 · D-018 · owing an answer is idle enough to stop, and the stopped conversation still says it', () => {
    beforeEach(() => {
      // The stop says what it did; the case reads the host, not the log.
      vi.spyOn(console, 'info').mockImplementation(() => {})
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('🔴 the parent that owes its child an answer is stopped by its countdown, and still says it owes', async () => {
      const { brobot, ada, adaTools } = await aGiverWaitingOnAHelper()
      await adaAsksHerParent(adaTools)
      await untilPushed(
        brobot,
        { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
        'the parent to owe it',
      )
      expect(runningOf(brobot)).toBe('in-a-window')

      // ⚑ Run every live countdown out by hand, as their timers would — again after each, since a
      // stop of the child moves the parent's word and re-arms its countdown. Bounded.
      for (let round = 0; round < 10 && runningOf(brobot) !== 'not-running'; round++) {
        const now = live()
        if (now.length === 0) break
        for (const countdown of now) {
          fired.add(countdown.timer)
          countdown.fn()
        }
        await settle()
      }

      // 🔴 Stopped by the app — owing an answer held nothing a stop would lose…
      await waitFor(() => runningOf(brobot) === 'not-running', 'the parent to be stopped')
      // …and the stop changed nothing about the question: it still owes it, and says so.
      expect(listed(brobot)?.state).toEqual({
        is: 'owes-an-answer',
        to: [ADA],
        since: expect.any(Number),
      })
      const open = store.routedRequestsOf(ada).filter((one) => one.state === 'open')
      expect(open.map((one) => one.parent)).toContain(brobot)
    })
  })
})

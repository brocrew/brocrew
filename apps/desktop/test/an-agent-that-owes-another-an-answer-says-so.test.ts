import { waitFor } from './lib/f093-host'
import type { AgentState } from '../src/shared/agent-state-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
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
import { RuntimeHost,  } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  type ResumableSessionInfo,
  type RuntimeStatesMessage,
  type UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'

/**
 * A conversation whose turn ended with a question another conversation put to it still open reads
 * "owes an answer to …", and the word moves when the question, the asker's status or a replacement
 * moves it. Every assertion on a pushed word reads `pushed`; fresh reads are compared after.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** BroBot's child, as every door names her: the first new agent, by the piece she owns. */
const ADA = 'Ada (the owner of W1.1 · Build the pages)'
const OWES_ADA = `owes an answer to ${ADA}`
const WAITING_ON_ADA = `waiting on ${ADA}`

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

/** A start the test can hold at the provider. */
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

/** A delay no other timer in the host uses, and no test waits out. */
const IDLE = 7_654_321

/** One countdown the host armed: the timer it got back and the callback it armed it with. */
interface Countdown {
  readonly timer: ReturnType<typeof setTimeout>
  readonly fn: () => void
}

describe('the host says who a conversation owes an answer to, and moves the word when that moves', () => {
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
  /** The index's one seed, read once per app run. */
  let seeded: MockInstance<SessionStore['whoRoutedToWhom']>
  let setTimeoutSpy: MockInstance<typeof setTimeout>
  let clearTimeoutSpy: MockInstance<typeof clearTimeout>
  let fired: Set<ReturnType<typeof setTimeout>>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, startGate),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: fixtureProviderConfig,
      statesMoved: (message) => {
        pushed.push(message)
      },
      // Idle countdowns never fire on their own; the stop case runs them out by hand.
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
    // Call-through: the host still reads the real index; the test counts how often it does.
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
    host.agentCard(id)?.state

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

  /** BroBot gives W1.1 to Ada and has been pushed as waiting on her. */
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

  /** A pushed state as polled for: when its wait began is asserted with the rest, below. */
  const withoutSince = (state: AgentState | undefined): string =>
    JSON.stringify(state, (key, value: unknown) => (key === 'since' ? undefined : value))
  const untilPushed = async (id: string, want: AgentState, what: string): Promise<void> => {
    await waitFor(() => withoutSince(lastSaid(id)) === withoutSince(want), what)
    await settle()
    expect(lastSaid(id)).toEqual(want)
  }

  it('a question its child puts to it pushes the parent to *owes an answer to Ada*, and its answer pushes it back', async () => {
    const { brobot, ada, adaTools } = await aGiverWaitingOnAHelper()
    // The index was seeded once, before any routing existed.
    expect(seeded).toHaveBeenCalledTimes(1)
    expect(store.whoRoutedToWhom()).toEqual([])
    seeded.mockClear()

    const id = await adaAsksHerParent(adaTools)
    await untilPushed(
      brobot,
      { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
      'the parent to be pushed as owing',
    )
    expect(stateOf(brobot)).toEqual({ is: 'owes-an-answer', to: [ADA], since: expect.any(Number) })
    const asked = store.routedRequestsOf(ada).find((one) => one.requestId === id)?.at
    expect(asked).toEqual(expect.any(Number))
    expect(stateOf(brobot)).toMatchObject({ since: asked })
    expect(stateOf(ada)).toMatchObject({ is: 'waiting-on-an-answer', since: asked })
    const observer = await personOpens('reviewer')
    expect(await wordsOf(observer, brobot)).toBe(OWES_ADA)
    const agents = await callOn(agentToolsFor(host, observer), 'list_agents', {})
    const rows = agents.agents as { agent: string; state: string }[]
    expect(rows.find((one) => one.agent === brobot)?.state).toBe(OWES_ADA)
    expect(stateOf(ada)?.is).toBe('waiting-on-an-answer')
    expect(seeded).not.toHaveBeenCalled()

    // The answer is a row in the asker's ledger; it moves the parent's kept read back.
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

  it('a question its child addressed to a person names the parent and is not the parent’s to owe', async () => {
    const { brobot, ada, adaTools } = await aGiverWaitingOnAHelper()
    // First a question to the parent and its answer, so Ada is in the index.
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

    const asked = await callOn(adaTools, 'ask_question', {
      who_answers: 'a-person',
      piece: 'W1.1',
      question: 'which timezone should the clock open on?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    const id = asked.question as string
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

    // Fresh reads say it waits on Ada.
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
    expect(store.whoRoutedToWhom()).toEqual([{ asker: ada, parent: brobot }])
  })

  it('the index names an asker once however often it asked, and leaves out a torn routing row without throwing', async () => {
    const { brobot, ada, adaTools } = await aGiverWaitingOnAHelper()
    await adaAsksHerParent(adaTools, 'which schema?')
    await adaAsksHerParent(adaTools, 'which table?')
    expect(store.whoRoutedToWhom()).toEqual([{ asker: ada, parent: brobot }])

    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const top = (
      db.prepare('SELECT max(ordinal) AS top FROM events WHERE session_id = ?').get(ada) as {
        top: number
      }
    ).top
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, (SELECT coalesce(max(generation), 0) FROM events WHERE session_id = ?), ?, 'request_routed', ?, ?)`,
    ).run('evt_torn_routing', ada, ada, top + 1000, '{not json at all', clock)
    expect(store.whoRoutedToWhom()).toEqual([{ asker: ada, parent: brobot }])
    warned.mockRestore()
  })

  it('a question the child’s provider raised is owed while the child is parked on it, and not once it is not', async () => {
    const { brobot, ada } = await aGiverWaitingOnAHelper()
    const adaHandle = doubleOf(ada)
    expect(adaHandle.status()).toBe('idle')

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
    expect(
      store
        .routedRequestsOf(ada)
        .filter((one) => one.requestId === raised.id)
        .at(-1),
    ).toMatchObject({ state: 'open', parent: brobot, went: { is: 'the-parent' } })

    await untilPushed(
      brobot,
      { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
      'the parent to owe the card',
    )

    // Only the child's status moves; that re-asks the parent.
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

  it('a stand-in owes what the conversation it replaced owed, and the replaced one owes nothing', async () => {
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
    // The stand-in derives its first word while still starting.
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

    // Should the stand-in park on a card, allow it so the turn ends.
    await waitFor(
      () => turnsIn(next) >= 1 || ledger(next).some((event) => event.type === 'permission_request'),
      'the stand-in’s turn to end or park',
    )
    const card = ledger(next).find((event) => event.type === 'permission_request')
    if (card?.type === 'permission_request' && turnsIn(next) === 0) {
      await host.respondPermission(next, card.id, { outcome: 'allow' }, window)
    }
    await waitFor(() => turnsIn(next) >= 1, 'the stand-in’s turn to end')
    await waitFor(
      () => lastSaid(next)?.is === 'owes-an-answer',
      'the stand-in to be pushed as owing the answer',
    )
    await settle()
    expect(lastSaid(next)).toEqual({ is: 'owes-an-answer', to: [ADA], since: expect.any(Number) })

    // The replaced one owes nothing.
    const old = listed(brobot)
    expect(old, 'the replaced conversation is listed').not.toBeUndefined()
    expect(old?.state).toEqual({ is: 'idle' })
  })

  it('an imported ledger that routes a question to a running conversation is owed at its next state, though it kept owing nothing', async () => {
    const { brobot, ada, adaTools } = await aGiverWaitingOnAHelper()
    const reviewer = await personOpens('reviewer')
    await settle()
    // Its owed questions are folded and kept: none.
    expect(stateOf(reviewer)?.is).not.toBe('owes-an-answer')
    const id = await adaAsksHerParent(adaTools)
    await untilPushed(
      brobot,
      { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
      'the parent to be pushed as owing',
    )
    // Ada's question, as another machine exported it, now put to the reviewer by a conversation
    // nothing here has seen.
    const ledger = store
      .events(ada)
      .filter(({ event }) => JSON.stringify(event).includes(id))
      .map(({ event, at }, ordinal) => ({
        ordinal,
        at,
        event: JSON.parse(
          JSON.stringify(event).replaceAll(id, 'imported-question').replaceAll(brobot, reviewer),
        ) as TranscriptEvent,
      }))
    expect(ledger.map(({ event }) => event.type)).toContain('request_routed')
    store.importSnapshot({
      session: {
        id: 'imported-asker',
        provider: 'claude',
        sessionId: 'fictional-imported-thread',
        cwd: root,
        profileId: 'worker',
        updatedAt: clock,
        createdAt: clock,
      },
      derivedThrough: 0,
      ledger,
    })
    await waitFor(
      () => lastSaid(reviewer)?.is === 'owes-an-answer',
      'the reviewer to be pushed as owing the imported question',
    )
    expect(stateOf(reviewer)?.is).toBe('owes-an-answer')
  })

  describe('owing an answer is idle enough to stop, and the stopped conversation still says it', () => {
    beforeEach(() => {
      // The stop says what it did; the case reads the host, not the log.
      vi.spyOn(console, 'info').mockImplementation(() => {})
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    it('the parent that owes its child an answer is stopped by its countdown, and still says it owes', async () => {
      const { brobot, ada, adaTools } = await aGiverWaitingOnAHelper()
      await adaAsksHerParent(adaTools)
      await untilPushed(
        brobot,
        { is: 'owes-an-answer', to: [ADA], since: expect.any(Number) },
        'the parent to owe it',
      )
      expect(runningOf(brobot)).toBe('in-a-window')

      // Run every live countdown out by hand, again after each, since a stop re-arms the parent's.
      for (let round = 0; round < 10 && runningOf(brobot) !== 'not-running'; round++) {
        const now = live()
        if (now.length === 0) break
        for (const countdown of now) {
          fired.add(countdown.timer)
          countdown.fn()
        }
        await settle()
      }

      await waitFor(() => runningOf(brobot) === 'not-running', 'the parent to be stopped')
      // The stop changed nothing about the question.
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

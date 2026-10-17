import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, TURN_REFUSED, TurnInProgress } from '@brobot2/runtime'
import type { AgentToolAnswer } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import {
  agentToolsFor,
  refuseTool,
  type AgentToolHost,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { SessionStillStarting } from '../src/main/runtime/session-unavailable'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 650 · a refusal that clears on its own
 *
 * ⛔ **`agent-cannot-take-a-message` was priced `until-a-person-changes-it`** and told a caller
 * *"Coming back will not change that on its own — a person has to put that conversation right."*
 * ⚑ `643` F2 found one arm of that fold that clears with nobody acting; `650` counted twenty-three
 * routes into the catch and found two that an agent really meets:
 *
 *  - ⚑ **a launch in flight** (§1–§3) — the conversation is reserved and its provider has not
 *    arrived. It either comes up, and the identical call is admitted, or fails, and the identical
 *    call meets `no-such-agent`. Nobody acts either way. ⚑ **D-017 · R1 — and `message_agent` is
 *    no longer refused at all while it waits**: *still starting* is never a refusal, so the words
 *    wait for the start and are delivered when it lands, or meet `no-such-agent` when it fails. The
 *    shared word is still `interrupt_agent`'s (and `withdraw_task`'s).
 *  - ⚑ **a turn another sender opened first** (§4) — two calls in one tick to one idle agent. The
 *    loser was told a person had to put the conversation right, about an agent that was busy
 *    answering the winner. ⛔ **`650` gave it a word and `657` retired it**: the loser is HELD now
 *    (`hold-the-second-message.test.ts`), so §4 measures a hold rather than a refusal.
 *
 * ⚠️ **The first is its own word, typed where the fact is known** (§5 proves it is the TYPE and
 * never the text), and the catch-all keeps every byte of its price and its sentence for the arms
 * that really are a person's. ⛔ The person arms are measured unedited elsewhere:
 * `the-promise-a-rail-could-not-keep.test.ts` (errored) and `a-parent-that-survives-a-restart.test.ts`
 * (sign-in).
 *
 * ## ⛔ §6 and §7 are `643` F3 — *"the message was not queued"* about words that had gone
 *
 * 🔴 **Both branches of `queueMessage` numbered the task AFTER the words had left**, and a database
 * that could not write threw from there into the same catch. ⚑ **D-016 · a give takes its number
 * BEFORE the send (R4)**, so what is left to fail after the words have gone is the piece's own row,
 * and `recordTheGive` contains that failure; §6 walks the idle branch and §7 the held one, where the
 * refusal was sharpest — the mailbox held the words and was going to flush them.
 *
 * ## ⚑ The controls, because every claim here is a pair
 *
 * Each section keeps the pre-`650` answer as a literal or runs the same call one fact over, so a
 * green is a measurement rather than a restatement (standing rules 3 and 12).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⛔ **The fold's word and sentence as they shipped until `650`** — the control every section reads. */
const THE_FOLD = 'agent-cannot-take-a-message'
const THE_FOLDS_SENTENCE =
  'that agent is not in a state where it can be given anything to do, so the message was not queued. Coming back will not change that on its own — a person has to put that conversation right.'

/** ⚑ **The row a person reads**, cut at `TOOL_SUMMARY_MAX` — `refused (<rail>): <sentence>`. */
const THE_ROW_BOUND = 200

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

describe('650 · a refusal that clears on its own', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /**
   * ⚑ **A launch held inside `prepareProviderHome`** — after the reservation, before the provider
   * is asked to start (`the-roster-that-names-nobody.test.ts`' seam). ⛔ It can be RELEASED, and the
   * launch lands, or FAILED, and the launch is abandoned — the two ways the wait ends.
   */
  let hold: { gate: Promise<void>; release: () => void; fail: () => void } | null

  const armTheHold = (): void => {
    let release = (): void => {}
    let fail = (): void => {}
    const gate = new Promise<void>((resolve, reject) => {
      release = resolve
      fail = () => reject(new Error('650 · the provider home could not be prepared'))
    })
    gate.catch(() => undefined)
    hold = { gate, release: () => release(), fail: () => fail() }
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-650-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-650-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 4_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    sessions = new FakeProviderSessions()
    hold = null
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
      prepareProviderHome: async (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        if (hold !== null) await hold.gate
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    hold?.release()
    hold = null
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, approvalMode: 'ask' | 'auto' = 'auto') =>
    (await host.createSession({ provider: 'claude', profileId, approvalMode, cwd: work }, window))
      .sessionId

  /** An identity exists only once a person has run a conversation as it (341 criterion 12). */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  /** ⚑ **Both halves of an answer**, because the text half is what a person's row draws. */
  const toolsOf = (sessionId: string, over: AgentToolHost = host) => {
    const set = agentToolsFor(over, sessionId)
    return async (name: ToolName, args: Record<string, unknown>): Promise<AgentToolAnswer> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return tool.call(args)
    }
  }
  const payload = (answer: AgentToolAnswer): Record<string, unknown> =>
    answer.structured as Record<string, unknown>

  /**
   * ⚑ **D-017 · R1 — a call that WAITS for a launch**, raced against a short timer: it answers
   * nothing while the launch is held, so a refusal would be the only thing that settles it.
   */
  const stillPending = async (answer: Promise<AgentToolAnswer>): Promise<unknown> =>
    Promise.race([
      answer.then(payload),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('still pending'), 100)
      }),
    ])

  /** ⛔ **Bounded, and it waits on the THING** — a card's state, never a guessed duration. */
  const until = async (check: () => boolean | Promise<boolean>, what: string): Promise<void> => {
    for (let n = 0; n < 400; n += 1) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const cardsOf = async (
    call: ReturnType<typeof toolsOf>,
  ): Promise<{ agent: string; state: string }[]> =>
    (payload(await call('list_agents', {})) as { agents: { agent: string; state: string }[] })
      .agents

  const eventsOf = (sessionId: string): { type: string; [key: string]: unknown }[] =>
    store.events(sessionId).map((one) => one.event as { type: string; [key: string]: unknown })

  /**
   * ⚑ **D-016 · the labels of the pieces a conversation was given** — its `work_given` rows, in the
   * order they were written. ⛔ A message opens no piece and takes no number any more; a give does.
   */
  const labelsIn = (sessionId: string): string[] =>
    eventsOf(sessionId)
      .filter((event) => event.type === 'work_given')
      .map((event) => event.label as string)

  /**
   * ⚑ **A parent and a sibling it gave a piece to that is really running**, so every refusal below
   * has the same call one fact over admitted beside it. ⛔ **No grant is written**: the default set
   * lets any agent give work to any agent this app holds (D-014, D-016).
   */
  const aParentWithASibling = async (): Promise<{
    parent: string
    call: ReturnType<typeof toolsOf>
    sibling: string
  }> => {
    await bringIdentityIntoBeing('worker')
    await bringIdentityIntoBeing('sibling')
    const parent = await personOpens(DEFAULT_PROFILE_ID)
    const call = toolsOf(parent)
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'sibling',
        title: 'the control',
        brief: 'the control',
      }),
    )
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { parent, call, sibling: given.agent as string }
  }

  /**
   * ⛔ **Give with the launch held, and hand back the id the listing advertises** — ⚑ **D-017 · R11:
   * as `active`**, the one state's word for a start on its way in (there is no *starting* state).
   * ⚑ **D-016 · a give is what starts a conversation now**, and its brief waits for the launch.
   */
  const aSpawnInFlight = async (
    call: ReturnType<typeof toolsOf>,
  ): Promise<{ id: string; spawning: Promise<AgentToolAnswer> }> => {
    armTheHold()
    const before = new Set((await cardsOf(call)).map((card) => card.agent))
    const spawning = call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the subject',
      brief: 'the subject',
    })
    spawning.catch(() => undefined)
    let id = ''
    await until(async () => {
      const fresh = (await cardsOf(call)).find(
        (card) => !before.has(card.agent) && card.state === 'active',
      )
      id = fresh?.agent ?? ''
      return fresh !== undefined
    }, 'the held spawn to be listed as active')
    return { id, spawning }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · a launch in flight, driven to where it CLEARS by arriving
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§1 a launch in flight is not refused: the message waits for it and is delivered once it lands', async () => {
    const { call, sibling } = await aParentWithASibling()
    const { id, spawning } = await aSpawnInFlight(call)
    // ⚑ **D-016 · a note** — work is a give's now, and the one in flight is the subject's own.
    const words = { agent: id, text: 'please start on this', kind: 'note' }

    // ⚑ **D-017 · R1 — *still starting* is never a refusal**: the words wait for the start.
    const waiting = call('message_agent', words)
    expect(await stillPending(waiting)).toBe('still pending')
    // ⛔ **Nothing was sent or queued while the launch is held.**
    expect(eventsOf(id).filter((event) => event.type !== 'status')).toEqual([])

    // ⚠️ **The control, one fact over**: the same caller, the same words, a sibling that is running.
    expect(payload(await call('message_agent', { ...words, agent: sibling }))).toMatchObject({
      outcome: 'ok',
    })

    // 🔴 **And it CLEARS** — the launch lands and the waiting call is delivered, with nobody acting.
    // This is the assertion the old sentence was false against: *"coming back will not change that
    // on its own"*.
    hold?.release()
    hold = null
    expect(payload(await spawning)).toMatchObject({ outcome: 'ok', agent: id })
    const delivered = payload(await waiting)
    expect(delivered).toMatchObject({ outcome: 'ok', delivery: 'sent', agent: id })
    // ⚑ **The wait burned no number** (D-016 · R4): the control's give took the first number under
    // the parent's root and the give in flight the second; the waiting note took none.
    expect([...labelsIn(sibling), ...labelsIn(id)]).toEqual(['W3.1', 'W3.2'])
    // ⛔ **The pre-650 answer is never given.**
    expect(delivered.rail).toBeUndefined()

    // ⚑ **The shared word's sentence, still said where a launch in flight is refused**
    // (`interrupt_agent`'s twin, `withdraw_task`) — the clauses it is FOR, by name (standing rule 5).
    // ⚠️ **657 · `nothing was done to it`**, because the word is said at `withdraw_task` too, where
    // nothing is sent — the clause names what was refused of neither door.
    const sentence = refuseTool('that-conversation-has-not-started').reason
    expect(sentence).toContain('nothing was done to it')
    expect(sentence).toContain('on its own')
    expect(sentence).toContain('make the same call again')
    expect(sentence).not.toMatch(/\ba person\b/i)
    // ⚑ **A person reads all of it** — the row is cut at 200 characters and this one fits.
    expect(`refused (that-conversation-has-not-started): ${sentence}`.length).toBeLessThanOrEqual(
      THE_ROW_BOUND,
    )
    expect(sentence).not.toBe(THE_FOLDS_SENTENCE)
  })

  /**
   * ⚠️ **What the shared word answers AFTER** (found by `650`'s own review, re-ordered at `681`).
   * ⛔ `sessionFor` threw before `queueMessage` asked its target-dependent walls, so a starting
   * target answered first — `650` F1. ⚑ **`681` (PM ruling R30b) moved those walls into the
   * entitlement's gate**, ahead of the throw: entitlement, then the boundary and the work walls, then
   * *not started* — `a-starting-child-is-already-in-its-project.test.ts` §3 is where that order is
   * measured. ⚑ **This test is the FIRST of those walls**, asked at the top of `message_agent`: a
   * caller a person has narrowed to `can_message: none` is never told to retry a launch it may not
   * message at all.
   */
  it('§1.1 a caller narrowed to message nobody is refused by its own wall, not told to retry a launch', async () => {
    const { call } = await aParentWithASibling()
    const { id, spawning } = await aSpawnInFlight(call)
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' })).toBe(true)
    expect(
      payload(await call('message_agent', { agent: id, text: 'hello', kind: 'note' })),
    ).toMatchObject({ outcome: 'refused', rail: 'may-not-message' })
    // ⚠️ **The control**: the same launch, the grant put back, is not refused — ⚑ **D-017 · R1** —
    // the words wait for the start, and are delivered once it lands.
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'any' })).toBe(true)
    const waiting = call('message_agent', { agent: id, text: 'hello', kind: 'note' })
    expect(await stillPending(waiting)).toBe('still pending')
    hold?.release()
    hold = null
    await Promise.allSettled([spawning])
    expect(payload(await waiting)).toMatchObject({ outcome: 'ok', agent: id })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the same arm, cleared by FAILING — and what the retry meets at both doors
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§2 a launch that fails clears the wait too, and the waiting call and the retry meet no-such-agent at both doors', async () => {
    const { call, sibling } = await aParentWithASibling()
    const { id, spawning } = await aSpawnInFlight(call)
    // ⚑ **D-016 · a note**: the piece in flight is not written until its brief arrives.
    const words = { agent: id, text: 'please start on this', kind: 'note' }
    // ⚑ **D-017 · R1** — the words wait for the start rather than being refused.
    const waiting = call('message_agent', words)
    expect(await stillPending(waiting)).toBe('still pending')

    hold?.fail()
    hold = null
    // ⚠️ **The give's own call rejects** rather than answering — a launch that fails is not a
    // refusal `give_work` names. Settled, because what this section measures is the RETRY.
    await Promise.allSettled([spawning])
    // 🔴 **The waiting call is ANSWERED, and in the retry's word**: nothing was recorded, so there is
    // no such conversation. ⛔ It was the tool call itself that failed, with the reopen's sentence.
    expect(payload(await waiting)).toMatchObject({
      outcome: 'refused',
      rail: 'no-such-agent',
      permanence: 'permanent',
    })
    await until(
      async () => !(await cardsOf(call)).some((card) => card.agent === id),
      'the failed launch to be abandoned',
    )

    // 🔴 **The corrected docblock clause, measured**: the reservation is gone, so the retry is
    // `no-such-agent` — not `that-conversation-has-already-ended`, which `interrupt-rails.ts` and
    // `shared/refusals.ts` both claimed until `650`.
    expect(payload(await call('message_agent', words))).toMatchObject({
      outcome: 'refused',
      rail: 'no-such-agent',
      permanence: 'permanent',
    })
    expect(
      payload(await call('interrupt_agent', { agent: id, reason: 'stop that' })),
    ).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
    // ⚠️ **The control**: the same caller's same words to a conversation that did come up.
    expect(payload(await call('message_agent', { ...words, agent: sibling }))).toMatchObject({
      outcome: 'ok',
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · one word at two doors — and a reservation being CLOSED is neither
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§3 a reopen in flight is the shared word at interrupt, a message waits for it, and a Close is a stop', async () => {
    const { call } = await aParentWithASibling()
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      }),
    )
    const child = given.agent as string
    const piece = given.piece as string
    // ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone): the app's own stop.
    await host.close(child, THE_APP_ITSELF)
    // ⚑ **D-017 · R2 — stopped, and still listed**: a stopped conversation is within reach.
    await until(() => !host.sessionIds.includes(child), 'the child to stop')

    // ⚑ **A person presses Reopen** while its launch is held — the route `commandedBy` re-derives.
    armTheHold()
    const reopening = host.resumeSession(child, window)
    reopening.catch(() => undefined)
    await until(
      async () => (await cardsOf(call)).some((c) => c.agent === child && c.state === 'active'),
      'the reopen to be listed as active',
    )

    // ⚑ **D-017 · R1 — the message WAITS for the reopen**; the interrupt still says the shared word.
    const messaged = call('message_agent', {
      agent: child,
      text: 'are you back',
      kind: 'follow-up',
      piece,
    })
    expect(await stillPending(messaged)).toBe('still pending')
    const interrupted = payload(await call('interrupt_agent', { agent: child, reason: 'wait' }))
    expect(interrupted).toMatchObject({
      outcome: 'refused',
      rail: 'that-conversation-has-not-started',
      permanence: 'while-this-holds',
      remedy: 'make-the-same-call-when-this-settles',
    })

    // ⛔ **Now a person Closes it before its provider arrives.** It has no session either, and this
    // start will never land — so it is not the shared word at the interrupt. ⚑ **D-017 · R1/R3 — a
    // message still waits**: a Close is a stop, and a message waits it out and starts it again.
    const closing = host.close(child, window)
    closing.catch(() => undefined)
    const messagedWhileClosing = call('message_agent', {
      agent: child,
      text: 'are you back',
      kind: 'follow-up',
      piece,
    })
    expect(await stillPending(messagedWhileClosing)).toBe('still pending')
    const interruptedWhileClosing = payload(
      await call('interrupt_agent', { agent: child, reason: 'wait' }),
    )
    // 🔴 **RED before `650`**: this said `that-conversation-has-not-started` — *wait for it to be
    // working* — about a launch that was being cancelled. ⚑ **D-017 — and it is no ending either**:
    // a Close is a stop, and a stop has no turn running, so nothing was interrupted or asked.
    expect(interruptedWhileClosing).toMatchObject({ outcome: 'ok', agent: child, asked: false })
    expect(interruptedWhileClosing.rail).toBeUndefined()

    hold?.release()
    hold = null
    await Promise.allSettled([reopening, closing])
    // ⚑ **…and both waiting messages are delivered**: the stop is waited out and it is started again.
    expect(payload(await messaged)).toMatchObject({ outcome: 'ok', agent: child })
    expect(payload(await messagedWhileClosing)).toMatchObject({ outcome: 'ok', agent: child })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · a turn another sender opened first, driven to where it CLEARS
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **A caller, and a child of its own whose turn PARKS** — `ask`, so the Fake's turn waits on a
   * permission card and the agent is still busy when the loser retries. ⛔ **The receiver is a
   * conversation the caller STARTED**, because a follow-up goes only to one the caller gave work
   * (D-014, D-016), and a follow-up refused on entitlement would never reach the race this section
   * is about. ⚠️ Its brief has run and ended, so it is idle and the first message below is the first
   * turn it has since.
   */
  const aCallerAndAParkingReceiver = async (): Promise<{
    call: ReturnType<typeof toolsOf>
    receiver: string
    piece: string
  }> => {
    await bringIdentityIntoBeing('worker')
    const call = toolsOf(await personOpens(DEFAULT_PROFILE_ID))
    const { agent, piece } = await aParkingChildOf(call, 'worker')
    return { call, receiver: agent, piece }
  }

  /** ⚑ **One conversation's state, as the caller's own `list_agents` says it.** */
  const stateOf = async (
    call: ReturnType<typeof toolsOf>,
    agent: string,
  ): Promise<string | undefined> =>
    (await cardsOf(call)).find((card) => card.agent === agent)?.state

  /**
   * ⚑ **A child the caller gives a piece to, idle once its brief has run, and in `ask` from then
   * on.** ⚑ **D-016 · a give takes no mode** — the child runs in its giver's, `auto` here, so the
   * brief's turn ends on its own; then the app itself sets the child to `ask`, so every later turn
   * parks on a card.
   */
  const aParkingChildOf = async (
    call: ReturnType<typeof toolsOf>,
    profile: string,
  ): Promise<{ agent: string; piece: string }> => {
    const given = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: 'a receiver that parks',
        brief: 'a receiver that parks',
      }),
    )
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const agent = given.agent as string
    await until(
      () => eventsOf(agent).some((event) => event.type === 'turn'),
      'the brief to run and end',
    )
    await until(async () => (await stateOf(call, agent)) === 'idle', 'the receiver to be idle')
    await host.setApprovalMode(agent, 'ask', THE_APP_ITSELF)
    return { agent, piece: given.piece as string }
  }

  it('§4 two calls in one tick to one idle agent: one goes, and the other is HELD rather than refused', async () => {
    const { call, receiver, piece } = await aCallerAndAParkingReceiver()
    const numbered = vi.spyOn(store, 'numberUnder')

    const asked = { agent: receiver, text: 'what are you on', kind: 'follow-up', piece }
    const told = { agent: receiver, text: 'then do this', kind: 'note' }
    const answers = (
      await Promise.all([call('message_agent', asked), call('message_agent', told)])
    ).map(payload)

    // 🔴 **657 · neither is refused.** ⛔ Until `657` the loser answered `agent-started-a-turn-first`
    // — *busy, not broken, make the same call again* — and a model had to come back. ⚑ It is held
    // now, which is what the retry used to earn, without a second call.
    expect(answers.map((one) => one.outcome)).toEqual(['ok', 'ok'])
    expect(answers.map((one) => one.delivery).sort()).toEqual(['queued', 'sent'])
    expect(answers.map((one) => one.rail)).not.toContain('agent-started-a-turn-first')
    // ⚑ **The held words are in the mailbox, recorded once — and no number was consumed**: a
    // message opens no piece (D-016), so the receiver holds only the piece its brief opened.
    expect(eventsOf(receiver).filter((event) => event.type === 'message_queued')).toHaveLength(1)
    expect(labelsIn(receiver)).toEqual(['W2.1'])
    expect(numbered).not.toHaveBeenCalled()
  })

  // ⛔ **§4.1 is gone with its subject** (D-016): two pieces of work in one tick met the one-open-task
  // rail, `agent-already-has-work-open`, and the tree has no such rail — a conversation holds as
  // many pieces as it is given.

  it('§4 · control: the same two calls one AFTER the other are sent and then held, and nothing is refused', async () => {
    const { call, receiver, piece } = await aCallerAndAParkingReceiver()
    const first = payload(
      await call('message_agent', {
        agent: receiver,
        text: 'what are you on',
        kind: 'follow-up',
        piece,
      }),
    )
    const second = payload(
      await call('message_agent', { agent: receiver, text: 'then do this', kind: 'note' }),
    )
    expect([first.delivery, second.delivery]).toEqual(['sent', 'queued'])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · classified by TYPE, never by text
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§5 the same bytes classify differently by type and field alone', async () => {
    await bringIdentityIntoBeing('worker')
    const caller = await personOpens(DEFAULT_PROFILE_ID)
    const target = await personOpens('worker')
    const starting = `session is still starting: ${target}`
    // ⛔ **One plant per call**, and each pair differs ONLY in its type or its one field — the
    // message a model reads in `said` is byte-identical inside every pair.
    const plants: readonly (readonly [string, Error, string])[] = [
      [
        'a launch in flight',
        new SessionStillStarting(starting, false),
        'that-conversation-has-not-started',
      ],
      ['the same text, untyped', new Error(starting), THE_FOLD],
      ['a reservation being closed', new SessionStillStarting(starting, true), THE_FOLD],
      // ⚠️ **657 · the tool no longer has a word for this** — `queueMessage` HOLDS a lost race, so a
      // `TurnInProgress` never reaches this catch through the real host
      // (`hold-the-second-message.test.ts` §1). Planted here past the host, it folds like any
      // other unclassified throw.
      ['a turn already held', new TurnInProgress(), THE_FOLD],
      ['the same text, untyped', new Error(TURN_REFUSED), THE_FOLD],
    ]
    for (const [what, thrown, rail] of plants) {
      // ⚠️ **The real host with ONE member replaced**, so the tool's own checks in front of
      // `queueMessage` run against a live target and only the throw is planted.
      const over = new Proxy(host, {
        get(target, key, receiver) {
          if (key === 'queueMessage') return () => Promise.reject(thrown)
          const value: unknown = Reflect.get(target, key, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      }) as unknown as AgentToolHost
      const answered = payload(
        await toolsOf(caller, over)('message_agent', {
          agent: target,
          text: 'hi',
          // ⚑ **D-016 · a note** — a follow-up names a piece the caller gave, and it gave none.
          kind: 'note',
        }),
      )
      expect([what, answered.rail]).toEqual([what, rail])
      expect((answered.detail as { said: string }).said, what).toBe(thrown.message)
    }
    // ⚑ **And the wire text is the text a person saw before** — no class name in front of it,
    // because `readableError` strips only a `\w*Error:` prefix.
    expect(String(new SessionStillStarting(starting, false))).toBe(`Error: ${starting}`)
    expect(String(new TurnInProgress())).toBe(`Error: ${TURN_REFUSED}`)
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · §7 · the number, after the words have gone
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('§6 idle branch: a piece that cannot be written down after its brief went out is not reported as unsent', async () => {
    // ⚠️ **No sibling given a piece first**: the control below is a give to it, and a give to a
    // conversation whose piece stalled is refused (D-016 · the stall rule).
    await bringIdentityIntoBeing('worker')
    await bringIdentityIntoBeing('sibling')
    const call = toolsOf(await personOpens(DEFAULT_PROFILE_ID))
    // ⚑ **D-016 · R4 — the number is taken BEFORE the send**, so what can fail after the words have
    // gone is the piece's own row: `recordGive`, in the owner's ledger.
    const failing = vi.spyOn(store, 'recordGive').mockImplementation(() => {
      throw new Error('SQLITE_FULL: database or disk is full')
    })
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const answered = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'build the thing',
      }),
    )
    // 🔴 **RED before `650`** (as a task's number): `agent-cannot-take-a-message` — *"the message
    // was not queued"* — while the receiver's own ledger held the turn those words opened.
    expect(answered).toMatchObject({ outcome: 'ok', delivery: 'sent' })
    const worker = answered.agent as string
    const turns = eventsOf(worker).filter((event) => event.type === 'user_turn')
    expect(JSON.stringify(turns)).toContain('build the thing')
    expect(labelsIn(worker)).toEqual([])
    expect(warned.mock.calls.flat().join(' ')).toContain('no piece was written')

    // ⚠️ **The control**: with the store answering, the same give to another agent writes its
    // piece down — under the NEXT number, because the one the failed write took is burned (R4).
    failing.mockRestore()
    const control = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'sibling',
        title: 'x',
        brief: 'build it',
      }),
    )
    expect(control).toMatchObject({ outcome: 'ok', delivery: 'sent' })
    expect(labelsIn(control.agent as string)).toEqual(['W3.2'])
  })

  it('§7 held branch: a brief the mailbox will flush is not reported as unqueued', async () => {
    await bringIdentityIntoBeing('sibling')
    const { call, receiver: control, piece } = await aCallerAndAParkingReceiver()
    // ⚠️ **A second identity**, because a give reaches the one conversation a giver has with it.
    const worker = await aParkingChildOf(call, 'sibling')
    // ⚑ **Both parked on a follow-up**, which opens no piece — so the held branch is taken and no
    // other rail stands in front of it, and the turn it opens drives the piece each holds (so no
    // stall stands in front of a give either). ⚠️ A follow-up and not a person's turn, because a
    // person sends to a conversation an agent started only once they have taken it over.
    for (const [id, named] of [
      [control, piece],
      [worker.agent, worker.piece],
    ] as const) {
      expect(
        payload(
          await call('message_agent', {
            agent: id,
            text: 'what are you on',
            kind: 'follow-up',
            piece: named,
          }),
        ),
      ).toMatchObject({ outcome: 'ok', delivery: 'sent' })
      await until(async () => {
        const state = await stateOf(call, id)
        return state !== undefined && state !== 'idle'
      }, 'the receiver to be busy with the follow-up')
    }
    // ⚠️ **The control first**: the same held give with the store answering writes its piece.
    expect(
      payload(
        await call('give_work', {
          profile: 'worker',
          title: 'x',
          brief: 'and then this',
          definition_of_done: 'The requested result and its checks are recorded.',
        }),
      ),
    ).toMatchObject({ outcome: 'ok', delivery: 'held', agent: control })
    expect(labelsIn(control)).toEqual(['W3.1', 'W3.3'])

    vi.spyOn(store, 'recordGive').mockImplementation(() => {
      throw new Error('SQLITE_READONLY: attempt to write a readonly database')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const answered = payload(
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'sibling',
        title: 'x',
        brief: 'and then this',
      }),
    )
    // 🔴 **RED before `650`, and the sharpest case**: the refusal said nothing was queued while
    // the mailbox held these words and was going to deliver them — a retry would send them twice.
    expect(answered).toMatchObject({ outcome: 'ok', delivery: 'held', agent: worker.agent })
    expect(eventsOf(worker.agent).filter((event) => event.type === 'message_queued')).toHaveLength(
      1,
    )
    expect(labelsIn(worker.agent)).toEqual(['W3.2'])
  })
})

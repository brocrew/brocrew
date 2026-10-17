import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider, TurnEnding } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { AgentCard, RuntimeEventSink } from './helpers/giver-notice-host'
import { TOOL_NAMES, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  INTERRUPT_RAILS,
  admitInterrupt,
  interruptPermanenceOf,
  interruptRetryableOf,
  refuseInterrupt,
} from '../src/main/runtime/interrupt-rails'
import { MESSAGE_RAILS } from '../src/main/runtime/message-rails'
import { QUESTION_RAILS } from '../src/main/runtime/question-rails'
import { REPLY_RAILS } from '../src/main/runtime/reply-rails'
import { SPAWN_RAILS } from '../src/main/runtime/spawn-rails'
import { TOOL_REFUSALS, refuseTool } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  ASKED_TO_STOP,
  HOW_WORK_STOPPED,
  WHERE_A_STOP_IS_OBSERVED,
  WHO_STOPPED_IT,
  howWorkStopped,
  stoppedBy,
  whoAskedClause,
  type StopReading,
  type WhereAStopIsObserved,
} from '../src/shared/how-work-stopped'
import { TASK_IS_OPEN, derivePieces } from '../src/shared/tasks'
import { mailboxOf } from '../src/shared/mailbox'
import { deriveRoutedRequests } from '../src/shared/questions'
import { ENDING_SENTENCE } from '../src/renderer/src/lib/ending'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { askedToStopSays } from '../src/renderer/src/lib/stop-unanswered'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { agentName, type AgentIdentity } from '../src/shared/runtime-ipc'

/**
 * 🔴 **395 · the interruption that looks like a provider fault** — Slice 4 S5, HO-007's last build
 * dispatch, and HO-016 §1/§2.
 *
 * ## ⛔ The requirement, which is not *"interrupting works"*
 *
 * **Interrupt a turn and the provider stops mid-sentence. On the wire that is what a provider dying
 * looks like, and a person watching sees the same thing either way: work that stopped.** ⚠️ So the
 * requirement is that an interruption is **DISTINGUISHABLE from a fault at every place either one
 * can be observed** — and if a person cannot tell *somebody stopped this* from *this broke*, this
 * app manufactures false provider bugs.
 *
 * ⚑ **§1 is the deliverable. Everything after it is the thing §1 measures.** The enumeration
 * `WHERE_A_STOP_IS_OBSERVED` drives the loop, so *"they differ everywhere"* is a search shape rather
 * than three assertions somebody chose — and a fourth surface added to that list arrives here with
 * no reading and goes red.
 *
 * ## ⚠️ Where the two providers are measured, and it is not here
 *
 * ⛔ **The both-provider demonstration is in `packages/runtime/test/claude-runtime.test.ts` and
 * `codex-runtime.test.ts`**, where each adapter is driven from its own wire — *"not one plus an
 * argument that the other is the same"*. ⚑ **They differ IN KIND** and that is why it is not
 * arguable: Claude's `interrupt()` forces the local terminal after a bounded ack wait, and Codex's
 * fires `turn/interrupt` and awaits its answer, unbounded — an answer the provider may never send,
 * and after which the turn may still be running (709 corrected the mechanism).
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is the
 * provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
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

/** `394`'s double, with the handles kept — a test has to BE the provider to fault like one. */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
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

describe('395 · the interruption that looks like a provider fault', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      // ⚑ **Short, because the wait is the thing under test in §4 and nothing else needs it.** The
      // shipped bound is two seconds; a test that waited that long for a Codex-shaped stall would be
      // measuring the clock rather than the door.
      interruptWaitMs: 40,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-interrupt-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-interrupt-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    claimed.add(sessionId)
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
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

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  /**
   * ⚑ **The ending the Sessions page reads**, off the one column it reads — `turn.end_reason` for the
   * newest closed turn. ⛔ Read from the table rather than derived, because the claim under test is
   * what that SURFACE says.
   */
  const lastEndingOf = (sessionId: string): TurnEnding | null =>
    (
      db
        .prepare(
          `SELECT end_reason AS reason FROM turn
            WHERE session_id = ? AND closed_at IS NOT NULL ORDER BY ordinal DESC LIMIT 1`,
        )
        .get(sessionId) as { reason: TurnEnding | null } | undefined
    )?.reason ?? null

  /** ⚑ The caller a PM's own tools present — `agent-tools.ts`'s `agentCallerId`, spelled once. */
  const asPm = (pm: string): { ownerId: string } => ({ ownerId: `agent:${pm}` })

  /** One capability, changed and nothing else — the *"one fact over"* half of every pair. */
  const reach = (profileId: string, edit: { canMessage?: string }): void => {
    expect(store.setCapabilities(profileId, edit as never)).toBe(true)
  }

  /**
   * `393`'s helper: a PM in a window with one child of its own, started through the real door.
   *
   * ⚑ **D-016 · the door is a give, and its brief is the child's first turn** — which parks on the
   * Fake's permission card, since the PM is in `ask` and a give runs in its giver's mode. ⚠️ So the
   * child comes back BUSY, where a spawn left it idle and {@link busy} then parked it: the brief is
   * that turn, and a test that wants the child idle first lets it finish ({@link letTheTurnFinish}).
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    pmProfile: string
    worker: string
    piece: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    const siblings = [workerProfile, `${workerProfile}-b`]
    for (const one of siblings) await bringIdentityIntoBeing(one)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work',
      brief: 'the work this dispatch is about',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerHandle = latestHandle()
    await waitFor(
      () =>
        workerHandle.status() === 'waiting_permission' &&
        ledger(worker).some((event) => event.type === 'permission_request'),
      'the brief’s turn to park on its permission card',
    )
    return { pm, pmProfile, worker, piece: given.label as string, pmTools, workerHandle }
  }

  /**
   * ⚑ **The notices a person actually reads**, folded by the renderer's own fold over the recorded
   * ledger — the replay path, which `394` §5 pins as the one that has to agree with the live one.
   */
  const noticesIn = (sessionId: string): string[] =>
    noticeItemsIn(sessionId).map((item) => item.text)
  /** ⚑ **737** · the notices themselves, with the facts a surface re-says them from. */
  const noticeItemsIn = (sessionId: string): NoticeItem[] => {
    const state = createTranscript()
    for (const entry of store.events(sessionId))
      applyEvent(state, entry.event, entry.at, entry.ordinal)
    return state.items.flatMap((item) => (item.kind === 'notice' ? [item] : []))
  }

  /**
   * ⚑ **A conversation that is WORKING and is not waiting on anybody** — the state a parent may cut
   * into.
   *
   * ⛔ **Not a turn, and it does not need to be.** The representative turn in this double always
   * parks on a permission card, which is the one state `a-person-is-being-asked` refuses — so a
   * *"busy but nobody is being asked"* child is built the way both real adapters produce one, as an
   * out-of-turn burst: `SessionMachine.noteProviderWork` latches `unbidden` on provider content, and
   * `forceEnd` is what Stop does to it. ⚠️ `123` is the dispatch that made the button work on exactly
   * this shape, and `conformance.test.ts` drives it on all three seams.
   */
  const working = async (sessionId: string, handle: FakeSessionHandle): Promise<void> => {
    handle.simulateThinking({ text: 'deciding what to do', redacted: false })
    await waitFor(() => handle.status() === 'working', 'the conversation to be working')
    void sessionId
  }

  /**
   * Park a conversation on its card, which is where both a stop and a fault can land.
   *
   * ⚠️ **Sent as whoever COMMANDS it.** A spawned child has no owner, so a window's `send` is
   * refused by `mayControl` — the caller has to be the parent that spawned it, which is also the
   * caller every one of these turns would really have in the app.
   */
  const busy = async (
    sessionId: string,
    handle: FakeSessionHandle,
    by: { ownerId: string } = window,
  ): Promise<void> => {
    await host.send(sessionId, 'a long piece of work', by)
    await waitFor(
      () => handle.status() === 'waiting_permission',
      'the turn to park on its permission card',
    )
  }

  /** Wait for the turn row to close, whichever way it closed. */
  const turnEnded = async (sessionId: string, atLeast = 1): Promise<void> => {
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length >= atLeast,
      'the turn to reach a terminal',
    )
  }

  /**
   * Answer the open card so the turn runs to its own terminal (`379`'s helper, `394`'s claim).
   *
   * ⛔ **A person answers a permission and nothing else can** — `mayAnswerAsAHuman` refuses a
   * commander and refuses the app — so the window has to CLAIM a spawned child first, exactly as a
   * person taking one over does.
   */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = ledger(sessionId).filter((event) => event.type === 'turn').length
    // ⚠️ **Waited for on the LEDGER, not on the handle.** `busy` watches the machine's status, which
    // moves a pump-tick before the row lands — and a helper that read the ledger the instant the
    // status flipped would be flaky in exactly the direction that reads as *"there was no card"*.
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parked on to reach the ledger',
    )
    // ⚠️ **`[...].reverse().find` and not `findLast`**, which this project's lib does not carry —
    // the same correction `394` made to the answer door's own lookup.
    const card = [...ledger(sessionId)]
      .reverse()
      .find((event) => event.type === 'permission_request')
    if (card === undefined || card.type !== 'permission_request') throw new Error('no card')
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, card.id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · THE DELIVERABLE — an interruption and a fault, side by side, everywhere either shows
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · an interruption is distinguishable from a fault', () => {
    /**
     * ⛔ **One conversation stopped, one conversation broken, at the same point in the same turn.**
     *
     * ⚑ **Both are parked on a card first**, so the two runs differ in exactly one thing: what
     * happens next. A stop that had been taken against an idle session and a fault against a busy
     * one would have been two different experiments wearing one comparison's clothes.
     */
    const twoEndings = async (): Promise<{ stopped: string; broken: string }> => {
      const stopped = await personOpens('stopped')
      const stoppedHandle = latestHandle()
      await busy(stopped, stoppedHandle)
      await host.interrupt(stopped, window)
      await turnEnded(stopped)

      const broken = await personOpens('broken')
      const brokenHandle = latestHandle()
      await busy(broken, brokenHandle)
      // ⚑ **A FATAL provider error, which is the fault that looks most like a stop**: it settles the
      // open card exactly as an interrupt does, and terminalises the turn from outside the provider's
      // own reply. ⛔ A recoverable failure would have been the easy comparison.
      brokenHandle.simulateError('the provider stream ended unexpectedly', true)
      await turnEnded(broken)
      return { stopped, broken }
    }

    /**
     * ⛔ **What each observation point SAYS, as data** — so the loop below reads a reading rather
     * than performing one.
     */
    const readingsOf = async (
      sessionId: string,
    ): Promise<Readonly<Record<WhereAStopIsObserved, string>>> => {
      const card = host.agentCard(sessionId, window, sessionId)
      return {
        // ⚑ **The ledger's own fold** — `how` and `who`, which is the pair no single field carries.
        'the-ledger': JSON.stringify(howWorkStopped(store.events(sessionId))),
        // ⚑ **What a person actually reads**: the notices the transcript fold produced, plus the
        // Sessions row's sentence for the ending the turn table holds.
        'the-transcript': JSON.stringify([
          noticesIn(sessionId),
          ENDING_SENTENCE[lastEndingOf(sessionId) ?? 'unknown'],
        ]),
        // ⚑ **What a parent is handed** — the card `get_agent_status` and `list_agents` render.
        'what-a-parent-is-told': JSON.stringify({
          state: card?.state ?? null,
          lastEndedTurn: card?.lastEndedTurn ?? null,
        }),
      }
    }

    it('🔴 they differ at EVERY place either one can be observed — the whole list, not three picks', async () => {
      const { stopped, broken } = await twoEndings()
      const wasStopped = await readingsOf(stopped)
      const wasBroken = await readingsOf(broken)
      // ⛔ **The enumeration drives the loop.** A fourth member of `WHERE_A_STOP_IS_OBSERVED` has no
      // reading in `readingsOf` and does not compile; a member whose two readings agree fails here.
      expect(WHERE_A_STOP_IS_OBSERVED.length).toBeGreaterThan(0)
      for (const place of WHERE_A_STOP_IS_OBSERVED) {
        expect(wasStopped[place], `${place} cannot tell a stop from a fault`).not.toEqual(
          wasBroken[place],
        )
        // ⚑ **The control that stops an empty reading passing**: a place that returned the same
        // nothing for both would satisfy `not.toEqual` only if the nothings differed, and this holds
        // both halves to being a reading at all.
        expect(wasStopped[place].length, `${place} read nothing`).toBeGreaterThan(2)
        expect(wasBroken[place].length, `${place} read nothing`).toBeGreaterThan(2)
      }
    })

    it('⛔ …and the difference is a PAIR of rows, because no single field carries it', async () => {
      const { stopped, broken } = await twoEndings()
      const turnOf = (id: string): string => {
        const turn = ledger(id).find((event) => event.type === 'turn')
        if (turn === undefined || turn.type !== 'turn') throw new Error('no terminal turn')
        return turn.state
      }
      // 🔴 **This is the finding, asserted rather than described.** A fatal error that lands on a
      // turn an interrupt was already requested for is written `interrupted` by
      // `SessionMachine.terminalizeErrored` — so the turn's own state is not the discriminator, and
      // a reader that asked only *"was it interrupted"* would call a dead provider a clean stop.
      const stoppedThenBroke = await personOpens('both')
      const bothHandle = latestHandle()
      await busy(stoppedThenBroke, bothHandle)
      await host.interrupt(stoppedThenBroke, window)
      bothHandle.simulateError('the provider stream ended unexpectedly', true)
      await turnEnded(stoppedThenBroke)
      expect(turnOf(stoppedThenBroke)).toBe(turnOf(stopped))
      expect(turnOf(stopped)).toBe('interrupted')
      // ⚑ **And the fold still tells all three apart**, because it reads the neighbours.
      expect(howWorkStopped(store.events(stopped)).how).toBe('it-was-stopped')
      expect(howWorkStopped(store.events(broken)).how).toBe('the-provider-faulted')
      expect(howWorkStopped(store.events(stoppedThenBroke)).how).toBe(
        'it-was-stopped-and-it-faulted',
      )
      // ⛔ **Neither half is dropped**, which is the ruling: reporting only the stop would hide a
      // dead provider, and reporting only the fault would accuse one that was told to stop.
      expect(howWorkStopped(store.events(stoppedThenBroke)).who).toBe('a-person')
    })

    it('🔴 a person is told WHO, and “you stopped it” is no longer said about an agent’s doing', async () => {
      const { pm, pmProfile, worker, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      // 🔴 **The paragraph that stood here was this defect described as a property, and `496` closed
      // it.** ⛔ It read: *"A child parked on a person's card is the one state an agent may NOT cut
      // into (§3) — **but it may still END it**, and the teardown calls `machine.forceEnd()` on both
      // adapters, so the ledger takes `turn:'interrupted'` from a gesture no person made."*
      // ⚠️ **HO-034 §1 ruled exactly that sentence**: *an agent may not end a conversation while a
      // person is being asked something in it*, and `END_RAILS` refuses it now — **so the more
      // destructive door is shut and the less destructive one is what an agent has left.**
      //
      // ⚑ **The turn this test is about is the same turn**: an agent's ask, a forced terminal, and a
      // ledger that has to name who did it. `RuntimeHost.interrupt` is the door `interrupt_agent`
      // reaches once its own rails admit, and §6 drives it the same way.
      await host.interrupt(worker, asPm(pm))
      await turnEnded(worker)
      // ⛔ **The sentence `222` shipped said *"you stopped its last turn before it finished"* about
      // this exact turn.** A person did not; their PM did.
      expect(ENDING_SENTENCE.interrupted).not.toContain('you stopped')
      // ⚑ **And the actor IS available where the ledger for it is open** — named, and named as the
      // conversation a person can go and look at.
      const reading = howWorkStopped(store.events(worker))
      expect(reading).toEqual({ how: 'it-was-stopped', who: 'an-agent', asker: pm })
      expect(whoAskedClause(reading)).toBe(pm)
      // ⚠️ **The transcript says it in words**, which is the surface a person is actually reading
      // when they are deciding whether their provider is broken.
      const notices = noticesIn(worker)
      // 🔴 **709 · R43 — the ASK is drawn as an ask** (`asked to stop by …`), and the turn below it
      // says how the turn ended in the provider's word. ⛔ *"stopped by …"* was true only while the
      // machine renamed whatever the provider did next.
      // 🔴 **737 · `734` F-2, `732` F-4 — and never by the `sess_` handle**: it read *"asked to stop by
      // sess_…"*. ⚑ The fold, which holds no roster, says the asker's CATEGORY…
      expect(notices).toContain('asked to stop by an agent')
      expect(notices.join('\n')).not.toContain(pm)
      expect(notices).not.toContain(`stopped by ${pm}`)
      expect(notices).toContain('turn interrupted')
      // ⚑ …and keeps the facts — WHICH identity asked, the PM's own (732) — so the transcript NAMES
      // the agent with the roster (`NoticeEntry`): a roster naming the PM draws its name, never the
      // handle and never the slug (737 review: it compared the function with itself over no roster).
      const asked = noticeItemsIn(worker).find((item) => item.askedToStop !== undefined)
      expect(asked?.askedToStop).toEqual({ by: 'an-agent', agent: pm, agentProfile: pmProfile })
      const roster = [{ slug: pmProfile, displayName: 'Pat' } as unknown as AgentIdentity]
      expect(agentName(pmProfile, roster), 'the premise: the roster names the PM').toBe('Pat')
      expect(askedToStopSays(asked!.askedToStop!, roster)).toBe('asked to stop by Pat')
    })

    it('⚠️ a conversation nobody has stopped reads NOTHING about an actor — the absence is honest', async () => {
      const quiet = await personOpens('quiet')
      const handle = latestHandle()
      await busy(quiet, handle)
      // ⚑ **Closed rather than interrupted**: the teardown interrupts the running turn, so the
      // ledger holds `interrupted` with nobody attached — which is exactly the state the removed
      // `this-app` member was reaching for.
      await host.close(quiet, window)
      await turnEnded(quiet)
      const reading = howWorkStopped(store.events(quiet))
      expect(reading.how).toBe('it-was-stopped')
      expect(reading.who).toBeNull()
      expect(whoAskedClause(reading)).toBeNull()
      // ⛔ **And the ending sentence does not invent one.** Passive, because nothing knows.
      expect(ENDING_SENTENCE.interrupted).toBe('its last turn was stopped before it finished')
    })

    it('🔴 …and where the CARD would otherwise AGREE — `state` is `idle` for a stop and a finish', async () => {
      // ⛔ **This is the arm that stops `lastEndedTurn` being dead weight.** In the pair above, a FATAL
      // fault leaves the session `errored` and a stop leaves it `idle`, so `AgentCard.state` tells
      // those two apart on its own — ⚑ **a comparison tested where both sides already agree measures
      // nothing**, and so does one tested where they already disagree.
      //
      // ⚠️ **The pair used here is a stop against a clean FINISH**, and that is a measurement rather
      // than a substitution: a parent asking *"is my child all right?"* reads `idle` for a turn that
      // finished and `idle` for one somebody threw away, which is the same blindness the fault case
      // is about with one of the two words changed. ⛔ A RECOVERABLE fault cannot stand here, and the
      // reason is worth writing down: `runFailedTurn` opens a machine turn without a `user_turn`, and
      // the turn TABLE is opened by `user_turn` and by nothing else — so there is no closed turn row
      // for the card to narrow to, and the reading is `null` rather than wrong.
      const stopped = await personOpens('stopped-b')
      const stoppedHandle = latestHandle()
      await busy(stopped, stoppedHandle)
      await host.interrupt(stopped, window)
      await turnEnded(stopped)

      const done = await personOpens('done-b')
      const doneHandle = latestHandle()
      await busy(done, doneHandle)
      await letTheTurnFinish(done)

      const stoppedCard = host.agentCard(stopped, window, stopped)
      const doneCard = host.agentCard(done, window, done)
      // ⛔ **The state agrees**, which is the premise rather than the assertion. ⚑ **D-017 · R11** —
      // the one derivation's `idle`.
      expect(stoppedCard?.state).toEqual({ is: 'idle' })
      expect(doneCard?.state).toEqual(stoppedCard?.state)
      // 🔴 **…and the reading does not.**
      // ⚑ **484 · `endedAt` and `since` travel with the reading**, so a parent holding this beside
      // the `state` above is never resolving *stale* against *an older turn* out of a docblock.
      expect(stoppedCard?.lastEndedTurn).toMatchObject({
        how: 'it-was-stopped',
        who: 'a-person',
        asker: null,
        since: 'nothing-has-started-since',
      })
      expect(stoppedCard?.lastEndedTurn?.endedAt).toBeGreaterThan(0)
      expect(doneCard?.lastEndedTurn).toMatchObject({
        how: 'it-finished',
        who: null,
        asker: null,
        since: 'nothing-has-started-since',
      })
    })

    it('⛔ a clean finish and a stop are told apart too — the third arm, so the pair is not a coin flip', async () => {
      const finished = await personOpens('finished')
      const handle = latestHandle()
      await busy(finished, handle)
      await letTheTurnFinish(finished)
      expect(howWorkStopped(store.events(finished))).toEqual({
        how: 'it-finished',
        who: null,
        asker: null,
      })
      // ⚑ **Three answers from one fold**, so §1's `not.toEqual` is measuring a reading with range
      // rather than a boolean that happens to flip.
      expect(new Set(HOW_WORK_STOPPED).has('it-finished')).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · who may interrupt — the chain below the caller, whatever the target is doing
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · entitlement under both verbs', () => {
    it('⛔ a caller cannot interrupt a conversation it does not command — entitlement before existence', async () => {
      const mine = await aPmAndItsWorker()
      const theirs = await aPmAndItsWorker()
      // ⚑ D-016 · each brief's turn is parked on a person's card first; ended, each child is idle.
      await letTheTurnFinish(theirs.worker)
      await letTheTurnFinish(mine.worker)
      await working(theirs.worker, theirs.workerHandle)
      // ⚑ **D-017 · R12 — `not-below-you`, this door's own word, and NOT the answer an id that names
      // nothing gets.** ⛔ It was `no-such-agent` for both, so that walking ids could not tell which
      // exist; the ruling now is that `no-such-agent` is said only about an id no conversation has
      // (`05` rule 6), and a conversation that exists and is not below the caller is refused as that.
      const notMine = await callOn(mine.pmTools, 'interrupt_agent', {
        agent: theirs.worker,
        reason: 'stop',
      })
      expect(notMine.outcome).toBe('refused')
      expect(notMine.rail).toBe('not-below-you')
      expect(notMine.permanence).toBe('permanent')
      const nothing = await callOn(mine.pmTools, 'interrupt_agent', {
        agent: 'sess_nobody',
        reason: 'stop',
      })
      expect(nothing.rail).toBe('no-such-agent')
      expect(notMine.reason).not.toBe(nothing.reason)
      // ⚠️ **D-014 · no grant and no project floor stand behind this door any more**, so the refusal
      // above is entitlement and nothing else — and the same caller reaches its own child.
      await working(mine.worker, mine.workerHandle)
      expect(
        (await callOn(mine.pmTools, 'interrupt_agent', { agent: mine.worker, reason: 'stop' }))
          .outcome,
      ).toBe('ok')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the rails of the target's own state, each with the same call one fact over allowed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the target-state rails, including the refusal nobody asked for', () => {
    it('🔴 a child parked on a PERSON’s card is refused — cutting in would answer it for them', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      const refused = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })
      // 🔴 **This is a permission refusal in an interruption's
      // clothes.** Both adapters call `settleRequests()` INSIDE `interrupt()`, and
      // `RequestBroker.settleAll` safe-rejects every pending card — a permission resolves as
      // `{outcome:'deny'}`. ⛔ So an unguarded interrupt would let a parent DENY a person's card,
      // which is HO-005 Q2 arriving through a verb `394` never looked at.
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('a-person-is-being-asked')
      // 🔴 **`until-a-person-changes-it` since `424`, and the pairing below is what it MEANS**
      // (HO-023 §2.1, `422` row 12). ⛔ The state ends when the person answers — which is what the
      // second half of this test performs — and there is nothing the caller can do to bring that
      // about: `answer_question` deliberately cannot answer a permission, and waiting is not an act
      // a model can perform. ⚠️ So the payload no longer tells it to come back.
      expect(refused.permanence).toBe('until-a-person-changes-it')
      expect(refused.retryable).toBe(false)
      // ⛔ **The withdrawn clause, pinned by the words it used to be** — *"Wait for the person to
      // answer, then ask again if it is still working"*. ⚑ Waiting is not an act a model can
      // perform, so that sentence asked for a loop; what it says now is who ends this.
      expect(String(refused.reason)).not.toContain('then ask again if it is still working')
      expect(String(refused.reason)).toContain('Only the person answering ends this')
      // ⛔ **And nothing happened to the card**: it is still pending, and the turn is still open.
      expect(workerHandle.status()).toBe('waiting_permission')
      expect(ledger(worker).some((event) => event.type === 'turn')).toBe(false)
      // ⚑ **One fact over, the identical call goes through.** The person answers, the child carries
      // on working, and the interrupt is admitted — so the rail is about the card and not about the
      // child, the capability, or the caller.
      await letTheTurnFinish(worker)
      await working(worker, workerHandle)
      const admitted = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })
      expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    })

    /**
     * 🔴 **492 · the trap `HO-032` §2.1 named, measured** — *"the person pressing **Cancel turn** IS
     * the person being asked."*
     *
     * ## ⛔ The question, and why it had to be asked in the same state
     *
     * ⚠️ **`HO-032` §1 made a person's Cancel perform an interrupt while that person's own question
     * is open**, which is precisely the state the rail above refuses. ⛔ **If the person's cancel
     * reached that rail, the repair would ship a button that refuses itself** — and widening the
     * rail to let it through would widen something `486` has just been through, because
     * `aPersonIsBehindIt` describes the OWNER and not the caller.
     *
     * ## ⚑ It does not reach it, and the reason is structural rather than lucky
     *
     * 🔴 **Two doors, and `INTERRUPT_RAILS` is asked at only one of them.** `admitInterrupt`'s
     * single production caller is `RuntimeHost.interruptAgent`, whose single caller is the
     * `interrupt_agent` tool; a person answers through `respondPermission`, which asks
     * `mayAnswerAsAHuman` and nothing else. ⚠️ `make-the-word-mean-one-thing.test.ts` §2 holds the
     * source census with its search shape; this is the BEHAVIOUR, and the two readings are taken on
     * one conversation, on one card, in one state — which is the only way the comparison measures
     * anything (*a comparison tested where both sides agree measures nothing*).
     *
     * ## ⚠️ And the asymmetry is the design, not a hole in it
     *
     * ⛔ **The rail exists because `settleAll` answers a card on the person's behalf and writes
     * nothing.** ⚑ A person answering their own card decides it, and `user_decision` records that
     * they did. **What is refused is an agent converting a person's pending question into a denial;
     * what is admitted is the person answering it.**
     */
    it('🔴 492 · the person being asked is ADMITTED where the agent is refused — one card, one instant', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')

      // ⛔ **The agent's reading first**, so the person's is taken against a card that is provably
      // still open and a rail that is provably still firing.
      const refused = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('a-person-is-being-asked')
      expect(workerHandle.status()).toBe('waiting_permission')

      // 🔴 **The person's reading, on the same conversation and the same card.**
      const card = [...ledger(worker)]
        .reverse()
        .find((event) => event.type === 'permission_request')
      if (card === undefined || card.type !== 'permission_request') throw new Error('no card')
      if (!claimed.has(worker)) {
        host.claimSession(worker, window)
        claimed.add(worker)
      }
      const before = ledger(worker).filter((event) => event.type === 'turn').length
      await expect(
        host.respondPermission(worker, card.id, { outcome: 'cancel' }, window),
      ).resolves.toEqual({ outcome: 'taken' })
      await waitFor(
        () => ledger(worker).filter((event) => event.type === 'turn').length > before,
        'the cancelled turn to reach its terminal',
      )

      // ⚑ **The press did what the button says**, and the rail never saw it.
      expect(
        ledger(worker)
          .filter((event) => event.type === 'turn')
          .at(-1),
      ).toMatchObject({
        state: 'interrupted',
      })
      expect(
        ledger(worker).some(
          (event) => event.type === 'user_decision' && event.outcome === 'cancel',
        ),
      ).toBe(true)

      // 🔴 **494 · 492 F2 closed, and BOTH halves are asserted here.** ⛔ `491`'s sentence is
      // untouched — **a cancel still writes no `work_interrupted`** — and the reading names the
      // person anyway, because {@link UserDecisionEvent.by} has carried the caller since `477` and
      // the fold reads it now. ⚑ That pairing is the whole of `494`: nothing new is written, so
      // HO-029 §2.2's *do not backfill* was never in the way.
      expect(ledger(worker).some((event) => event.type === 'work_interrupted')).toBe(false)
      expect(store.lastEndedTurn(worker)).toMatchObject({
        how: 'it-was-stopped',
        who: 'a-person',
        asker: null,
      })
      // ⚠️ **The conversation-level field on the SAME card, and it is why the store's ask query
      // moved too** (494). ⛔ A payload answering *a person stopped that turn* beside *no row says
      // who asked* is `484`'s own defect — two neighbouring facts a reader has to choose between.
      expect(store.lastAskToStop(worker)).toMatchObject({
        by: 'a-person',
        asker: null,
        turn: 'the-turn-that-ended-last',
      })
    })

    it('⛔ a conversation whose provider DIED is answered *nothing to interrupt*, not “that id is wrong”', async () => {
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      await letTheTurnFinish(worker)
      await working(worker, workerHandle)
      // ⚑ **The paired positive FIRST, on the same conversation**, so the refusal below is about the
      // ending and not about anything that was ever true of this child.
      expect(
        (await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })).outcome,
      ).toBe('ok')
      // 🔴 **The provider DIES**, which is this dispatch's other subject: a faulted conversation is
      // still there, still commanded, and still answerable.
      // ⚠️ **No second burst first**, and the reason is the machine being right rather than a
      // shortcut: `forceEnd` latches `foreignTerminal`, so `noteProviderWork` declines to open a
      // fresh burst while the provider still owes a terminal for the work we ended.
      workerHandle.simulateError('the provider stream ended unexpectedly', true)
      await waitFor(() => workerHandle.status() === 'errored', 'the child to be errored')
      // ⚑ **D-017 — nothing is running in it, so there is nothing to interrupt**, and the door says
      // so: `ok`, `asked: false`, and the state in the one derivation's words. ⛔ It was refused
      // `that-conversation-has-already-ended`; nothing ends a conversation any more, and a stopped
      // one is started again by a message. ⚑ **Not `no-such-agent`** — the id is right, which is
      // the half of this test's title that stands.
      const answered = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })
      expect(answered, JSON.stringify(answered)).toMatchObject({
        outcome: 'ok',
        agent: worker,
        asked: false,
        state: 'idle',
      })
      expect(pm).toBeTruthy()
    })

    it('⚠️ the rails are asked AFTER entitlement, so a refused caller learns nothing about the target', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      const stranger = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      // ⛔ **A child parked on a person's card and a caller that is not above it.** Both rails are
      // live; the one that answers is ENTITLEMENT (D-014: no grant floor stands in front of it any
      // more), so the caller is never told that somebody is being asked something inside a
      // conversation it may not touch. ⚑ **D-017 · R12** — in this door's own word, `not-below-you`.
      const refused = await callOn(stranger.pmTools, 'interrupt_agent', {
        agent: worker,
        reason: 'stop',
      })
      expect(refused.rail).toBe('not-below-you')
      expect(JSON.stringify(refused)).not.toContain('a-person-is-being-asked')
      // ⚑ **The control**: the caller that started it makes the same call and reaches the card rail
      // — so the ordering above is an ordering and not a state in which the card rail never fires.
      expect(
        (await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })).rail,
      ).toBe('a-person-is-being-asked')
    })

    it('⛔ every rail in the vocabulary is REACHED, and each carries the permanence its table says', () => {
      // ⚠️ **A negative needs a search shape**, and so does a vocabulary: a rail nothing reaches
      // passes vacuously. ⛔ `that-conversation-has-not-started` is the one the tests above do not
      // provoke through the tool, so it is reached through `admitInterrupt` itself, which is the same
      // function the door calls, with the state a starting slot presents. ⚠️ **This said the window
      // was microseconds in this harness, and since `650` that is not so**: a held launch keeps it
      // open for as long as a test likes, and `a-refusal-that-clears-on-its-own.test.ts` §3 drives
      // `interrupt_agent` into it through the tool.
      const source = readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      for (const rail of INTERRUPT_RAILS) {
        const built = refuseInterrupt(rail, { agent: 'sess_x' })
        expect(built.permanence).toBe(interruptPermanenceOf(rail))
        expect(built.retryable).toBe(interruptRetryableOf(rail))
        expect(built.reason.length, rail).toBeGreaterThan(60)
        expect(built.reason.endsWith('.'), rail).toBe(true)
        // ⛔ **No sentence names a capability, a column or an event** — HO-015 §2: a refusal states a
        // fact about THIS call and does not describe how the system works.
        for (const machinery of ['can_interrupt', 'canInterrupt', 'turn', 'settleRequests']) {
          expect(built.reason, `${rail} names ${machinery}`).not.toContain(machinery)
        }
      }
      // ⚑ **And the door really does reach every member**, by the same shape `374` uses one file over.
      expect(source).toContain('admitInterrupt(sessionId, status, askedOf)')
      expect(source).toContain("refuseInterrupt('that-conversation-has-not-started'")
    })

    it('🔴 425 · a launch in flight is the one rail here with an act, and it is the SAME call', () => {
      // ⛔ **Standing rule 3, at the door's own admission function.** ⚑ `admitInterrupt` is what
      // `interrupt_agent` calls. ⚠️ *"A window of microseconds through the tool"* was this comment's
      // reason and it is no longer true — see the note above, and `650`'s §3, which reaches it.
      const refused = admitInterrupt('sess_x', null)
      expect(refused?.rail).toBe('that-conversation-has-not-started')
      // 🔴 **The caller changes NOTHING** — the launch either attaches its provider session or fails
      // and abandons the reservation, and either way the wait is bounded by something already
      // happening. ⚑ That is why this shares a word with `that-work-is-being-sent`: deliberately
      // shared owners, the same act.
      expect(refused?.remedy).toBe('make-the-same-call-when-this-settles')

      // ⚑ **The same call, one fact over: the conversation has started.** ⛔ Admitted, and there is
      // no payload at all to carry a remedy on.
      expect(admitInterrupt('sess_x', 'working')).toBeNull()

      // 🔴 **And the sharpest `null` in the registered tables, beside it — decided twice, independently.**
      // ⛔ When `425` wrote it, `a-person-is-being-asked` was `while-this-holds` and its sentence
      // said *wait for the person to answer*: honest CONTEXT, and **not an act this caller can
      // perform**, because only the person's own door ends that state and `answer_question`
      // deliberately cannot answer a permission. ⚑ Recording it as a remedy would tell a person
      // reading the transcript that their agent had a way out when the way out was them.
      // ⚠️ **`424` then repriced the rail to `until-a-person-changes-it` and rewrote the sentence**
      // — *only the person answering ends this, and asking again will not* — which is the same
      // finding arriving through the permanence. **The `null` was right either way, and both halves
      // are asserted here so neither can drift back on its own.**
      const asked = admitInterrupt('sess_x', 'waiting_permission')
      expect(asked?.rail).toBe('a-person-is-being-asked')
      expect(asked?.permanence).toBe('until-a-person-changes-it')
      expect(asked?.retryable).toBe(false)
      expect(asked?.remedy).toBeNull()
      expect(asked?.reason).toContain('Only the person answering ends this')
    })

    it('⛔ no interrupt rail NAME collides with the compared roster — but the one it shares on purpose', () => {
      // ⚑ `374`'s census extended to this vocabulary: one grammar, and a `rail` that says which
      // rule stopped a call whichever door built the payload. The global roster is derived in
      // `what-an-agent-is-told-about-its-work.test.ts`; this local comparison names its inputs below.
      //
      // 🔴 **650 · ONE located exception, and it is named here rather than let through.** ⛔ A
      // launch in flight is one fact, and `message_agent` meets it too; since `650` it answers with
      // this vocabulary's word rather than folding it into `agent-cannot-take-a-message`. ⚠️ **The
      // exception is as narrow as the fact**: one word, one other vocabulary, and the same
      // permanence and act at both doors — which is what stops a shared NAME becoming a shared
      // name for two things. The sentences differ, because each states a fact about its own call.
      const SHARED = 'that-conversation-has-not-started'
      const others = [
        ...SPAWN_RAILS,
        ...MESSAGE_RAILS,
        ...TOOL_REFUSALS,
        ...REPLY_RAILS,
        ...QUESTION_RAILS,
      ] as readonly string[]
      for (const rail of INTERRUPT_RAILS) {
        if (rail === SHARED) continue
        expect(others).not.toContain(rail)
      }
      // ⛔ **Where the shared word lives, exactly**: in `TOOL_REFUSALS` and in no other list.
      const owners = (
        [
          ['SPAWN_RAILS', SPAWN_RAILS],
          ['MESSAGE_RAILS', MESSAGE_RAILS],
          ['TOOL_REFUSALS', TOOL_REFUSALS],
          ['REPLY_RAILS', REPLY_RAILS],
          ['QUESTION_RAILS', QUESTION_RAILS],
        ] as const
      )
        .filter(([, rails]) => (rails as readonly string[]).includes(SHARED))
        .map(([name]) => name)
      expect(owners).toEqual(['TOOL_REFUSALS'])
      // ⚑ **One meaning at both doors**: the same permanence, the same act, a different sentence.
      const atTheInterruptDoor = refuseInterrupt(SHARED, { agent: 'sess_x' })
      const atTheMessageDoor = refuseTool(SHARED, { agent: 'sess_x' })
      expect(atTheMessageDoor.permanence).toBe(interruptPermanenceOf(SHARED))
      expect(atTheMessageDoor.remedy).toBe(atTheInterruptDoor.remedy)
      expect(atTheMessageDoor.retryable).toBe(interruptRetryableOf(SHARED))
      expect(atTheMessageDoor.reason).not.toBe(atTheInterruptDoor.reason)
      // ⚑ The control: the list it is being compared against is not empty, and it does contain the
      // names it should.
      expect(others).toContain('may-not-message')
      expect(others).toContain('no-such-agent')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the mechanic — what is recorded, when, and what the answer refuses to claim
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the ask is a fact, and it is written before the provider is touched', () => {
    it('🔴 the ask lands INSIDE the turn it stops, ahead of the terminal', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      // ⛔ **Through the HOST's door with the parent as the caller**, and not through the tool — a
      // child parked on a person's card is the one state the tool refuses (§3), and what this test
      // is about is where the row LANDS rather than who may ask for it. ⚑ Same `recordTheAsk`, same
      // `by`, and §7 asserts there is only one writer of either.
      await host.interrupt(worker, asPm(pm))
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'turn'),
        'the interrupted terminal',
      )
      const types = ledger(worker).map((event) => event.type)
      // ⛔ **The ask precedes the terminal**, which is what makes `events.turn_id` carry it: the turn
      // is still open when the row is written, and the terminal that closes it has not been emitted.
      expect(types.lastIndexOf('work_interrupted')).toBeLessThan(types.lastIndexOf('turn'))
      // ⚑ **And the database agrees**, which is the half a fold over the whole ledger could not see:
      // the row is stamped with the turn it stopped.
      const stamped = db
        .prepare(
          `SELECT e.turn_id AS turnId FROM events e WHERE e.session_id = ? AND e.type = 'work_interrupted'`,
        )
        .all(worker) as { turnId: string | null }[]
      expect(stamped).toHaveLength(1)
      expect(stamped[0]?.turnId).not.toBeNull()
    })

    it('🔴 the LAST ask wins — a person stopping a turn an agent already asked about is the person', async () => {
      // ⛔ **Found by writing this dispatch's own mutation row and watching it SURVIVE.** Nothing
      // stopped a turn twice, so *"the last ask wins"* was a sentence in a docblock with nothing
      // behind it — and the reading it protects is the one a person meets: their PM asks a child to
      // stop, the child does not, and they press Stop themselves. ⚑ Reporting the agent then would
      // tell a person somebody else did what they just did.
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      await letTheTurnFinish(worker)
      await working(worker, workerHandle)
      expect(
        (await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })).outcome,
      ).toBe('ok')
      // ⚑ **The agent's ask is on the ledger first**, which is what makes the second one a second.
      expect(howWorkStopped(store.events(worker))).toMatchObject({ who: 'an-agent', asker: pm })
      await host.interrupt(worker, window)
      const after = howWorkStopped(store.events(worker))
      expect(after.who).toBe('a-person')
      // ⛔ **And the agent's NAME goes with it.** The two fields are one fact: a person's ask that
      // inherited the agent's id would say *"sess_4 stopped it"* about a button somebody pressed.
      expect(after.asker).toBeNull()
      expect(whoAskedClause(after)).toBe('a person')
    })

    it('⛔ a PERSON’s stop writes the ask too, beside `user_command` and not instead of it', async () => {
      const quiet = await personOpens('quiet')
      const handle = latestHandle()
      await busy(quiet, handle)
      // ⚑ **The IPC boundary writes the breadcrumb; the host writes the ask.** They answer different
      // questions and are gated by different predicates, so the pairing is asserted rather than left
      // as a claim two files make about each other.
      host.noteUserCommand(quiet, 'interrupted', window)
      await host.interrupt(quiet, window)
      await turnEnded(quiet)
      const ours = ledger(quiet)
      expect(
        ours.some((event) => event.type === 'user_command' && event.command === 'interrupted'),
      ).toBe(true)
      const ask = ours.find((event) => event.type === 'work_interrupted')
      expect(ask).toEqual({ type: 'work_interrupted', by: 'a-person' })
      // ⛔ **No `agent` field for a person**, so a reader cannot mistake the absence for an unnamed
      // agent — `stoppedBy` gives the two different words.
      expect(stoppedBy('a-person', null)).toBe('a person')
      expect(stoppedBy('an-agent', null)).toBe('an agent')
    })

    // ⚑ **D-017 · commit 3** — *`end_agent` writes the ask as well* went with `end_agent`: nothing
    // ends a conversation, and the one door left that asks a turn to stop is `interrupt_agent`'s.

    it('⛔ the answer says `asked`, never `stopped` — because Codex may never terminalise', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      await letTheTurnFinish(worker)
      await working(worker, workerHandle)
      // ⚠️ **Called through the tool itself rather than through `callOn`**, because `492` needs the
      // WORDS as well as the payload and `callOn` returns only the structured half.
      const verb = pmTools.tools.find((one) => one.name === 'interrupt_agent')
      if (verb === undefined) throw new Error('no interrupt_agent')
      const spoken = await verb.call({ agent: worker, reason: 'stop' })
      const said = spoken.structured as Record<string, unknown>
      // 🔴 **The two providers differ in KIND here** and that is why the vocabulary matters: Claude
      // forces the local terminal, Codex awaits an answer that may never arrive (709). ⛔ A
      // payload claiming the work had stopped would be false on one of them.
      expect(said).toMatchObject({ outcome: 'ok', agent: worker, asked: true })
      expect(Object.keys(said)).not.toContain('stopped')
      // ⚑ **`state` is what it is doing NOW**, read after the bounded wait — a fact a caller can
      // check rather than a claim about the interruption.
      expect(said.state).toBe(workerHandle.status())
      // 🔴 **492 · and the claim is SHARED BYTES with the permission card's Cancel**, which performs
      // this same act since `HO-032` §1. ⛔ Two spellings of one act is what HO-030 §2 says teaches a
      // reader to stop reading the sentence at all. ⚑ The subjects stay each surface's own — this
      // one names an agent and its state; the card names the turn — and only the claim is shared.
      expect(spoken.text).toContain(ASKED_TO_STOP)
      expect(spoken.text).not.toContain('was stopped')
      expect(spoken.text).not.toContain('is interrupted')
    })

    it('⚠️ the wait is BOUNDED, so a wedged provider cannot hold a parent’s turn open', async () => {
      const { worker, pmTools, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      await letTheTurnFinish(worker)
      await working(worker, workerHandle)
      // ⛔ **A provider that never answers the interrupt** — Codex's shape, built here by making the
      // handle's own `interrupt` hang. ⚑ *The deadline releases the WAITER, not the work*: the call
      // is still in flight when the tool answers.
      let released = false
      const stalled = new Promise<void>(() => {
        /* never resolves — the wedged app-server */
      })
      workerHandle.interrupt = async (): Promise<void> => {
        released = true
        await stalled
      }
      const said = await callOn(pmTools, 'interrupt_agent', { agent: worker, reason: 'stop' })
      expect(released).toBe(true)
      expect(said.outcome).toBe('ok')
      // ⚑ **And the ask is on the ledger even though the provider never answered**, which is the
      // whole reason it is written first.
      expect(ledger(worker).some((event) => event.type === 'work_interrupted')).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the three folds — the brief said an interruption settles all of them. It settled none, and
  // since `397` it settles exactly one: the QUESTION, which is the one it really destroys.
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what an interruption does to a task, a question and a held message', () => {
    it('🔴 an interrupted turn leaves the task, ENDS the question (397), and SENDS the held message', async () => {
      // ⚑ Work given through the real door, so the piece is a derived row and not a fixture — ⚑
      // D-016: the give is that door, and its brief the turn now parked on its card.
      const { pm, pmProfile, worker, piece, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      expect(workerHandle.status()).toBe('waiting_permission')
      // ⚑ A second message, held behind the running turn — `354`'s singleton, still one for work.
      // ⛔ **415 · it is a QUESTION** (HO-021 §1 property 3): the child is holding an open piece of
      // work, so a second piece would be refused. ⚠️ Nothing this test measures moves — a question
      // is held in the same slot, flushed by the same code and abandoned by the same teardown; what
      // it does not do is open a second task, which is why the fold below reads one.
      const held = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'and this',
        kind: 'follow-up',
        piece,
      })
      expect(held.outcome, JSON.stringify(held)).toBe('ok')
      // ⛔ **Through the host's door with the parent as caller**, for §4's reason: the tool refuses a
      // child parked on a person's card, and what an interruption does to the three folds is not a
      // question about who may ask for one.
      // ⚠️ **The window is attached first, and since `396` it is no longer load-bearing.** It was:
      // an unattended child's flush never fired, because `flushQueued` sat under `deliver`'s sink
      // gate, so without this line the assertion below measured that defect instead of what an
      // interruption does to a held message. ⛔ **Kept, and kept as a claim about THIS test**: what
      // is being measured here is the fold, and pinning the flush's independence from a window is
      // the test below's job and `396`'s suite's.
      host.claimSession(worker, window)
      claimed.add(worker)
      // ⚑ **Read BEFORE the interrupt**, because the held message starts a turn of its own the
      // instant the interruption produces `status:'idle'` — and that turn raises its own card. The
      // assertion below is about the requests this interruption could have killed, not about every
      // row the ledger ends up holding.
      const openWhenStopped = store
        .routedRequestsOf(worker)
        .filter((one) => one.state === 'open')
        .map((one) => one.requestId)
      expect(openWhenStopped.length).toBeGreaterThan(0)
      await host.interrupt(worker, asPm(pm))
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'turn'),
        'the interrupted terminal',
      )
      // ⚠️ **720 · waited for, not assumed.** The control below reads the held message's OWN card,
      // which its flushed turn raises a few microtasks after the terminal. ⛔ This read used to rely on
      // `host.interrupt` returning before the terminal landed, so the `waitFor` above always yielded
      // a macrotask; since `720` (`709` F-6) the Stop door returns through a bounded wait, the
      // terminal is already there, and the read came a tick early.
      await waitFor(
        () =>
          deriveRoutedRequests(worker, store.events(worker)).some(
            (one) => !openWhenStopped.includes(one.requestId),
          ),
        'the held message’s own card',
      )
      const after = store.events(worker)
      // 🔴 **The TASK stays OPEN, and `400` changed what it is CALLED.** ⛔ This read
      // `.every((task) => task.state !== 'silent')` — `393`'s predicate excluded an interruption
      // from the fold because *"folding it here would report work as said-nothing the instant
      // somebody pressed Stop"*, which was a complaint about the WORD. HO-018 §2.1 retired it: an
      // interrupted turn is nothing driving the work, said plainly, and that is exactly criterion 4.
      // ⚠️ **Replaced by the stronger claim rather than adjusted until it passed** — what the old
      // assertion was defending is the sentence below it, and that is what is asserted now.
      const tasks = derivePieces(worker, after)
      expect(tasks.length).toBeGreaterThan(0)
      expect(tasks.every((one) => TASK_IS_OPEN[one.state])).toBe(true)
      // ⚑ **Asserted IN THE GAP, because the held message is flushed a moment later.** The task the
      // interruption caught is `stalled` at the turn's own ending, and the flush that follows starts
      // a fresh turn on this same conversation — so a check taken after it would be reading a
      // conversation that is working again rather than the state the interruption left.
      const atTheInterrupt = derivePieces(
        worker,
        after.slice(0, after.findIndex((entry) => entry.event.type === 'turn') + 1),
      )
      // 🔴 **D-005a · re-aimed (F019's fix check): a message waiting in its queue is driving it.**
      // ⛔ The held question starts the next turn the instant the interruption idles it, so the fold
      // holds the stall: the task reads `working` at the interrupt, and its giver is told nothing.
      expect(atTheInterrupt[0]).toMatchObject({
        state: 'working',
        stalledBecause: null,
        endedAt: null,
      })
      // ⚑ **THE PAIR, and it is what `400` defended**: the same ledger with nothing waiting in the
      // queue — an interrupted turn is nothing driving the work, said plainly.
      const withNothingWaiting = derivePieces(
        worker,
        after
          .slice(0, after.findIndex((entry) => entry.event.type === 'turn') + 1)
          .filter((entry) => entry.event.type !== 'message_queued'),
      )
      expect(withNothingWaiting[0]).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
        endedAt: null,
      })
      // 🔴 **REPAIRED by `397`, and this assertion was written to go red on exactly this commit.**
      //
      // ⛔ **It read `.every((one) => one.state === 'open')`** — the residue `395` measured and `396`
      // §7 reported: the fold cannot see a `turn` event, no branch existed, and a routed request the
      // interruption had already killed went on reading *nobody has ended this*. ⚠️ **Replaced by
      // the opposite claim rather than adjusted until it passed** — `396`'s rule, second use — and
      // the state is asserted BY NAME so a later ending sliding into its place cannot pass this.
      //
      // ⚑ **A permission-shaped routing gets the ending too**, which this row is: `settleAll` takes
      // permissions and questions alike, and criterion 10's *nothing is dropped at the boundary*
      // means the row is here to be closed.
      const requests = deriveRoutedRequests(worker, after)
      const stopped = requests.filter((one) => openWhenStopped.includes(one.requestId))
      expect(stopped).toHaveLength(openWhenStopped.length)
      expect(stopped.every((one) => one.state === 'interrupted')).toBe(true)
      expect(stopped.every((one) => one.endedAt !== null)).toBe(true)
      // ⚑ **And the control that keeps *"the interruption closed it"* from meaning *"everything is
      // closed"***: the held message's own turn raises a fresh card afterwards, and that one is
      // still `open`. A writer that closed rows by session rather than by id would fail here.
      const since = requests.filter((one) => !openWhenStopped.includes(one.requestId))
      expect(since.length).toBeGreaterThan(0)
      expect(since.every((one) => one.state === 'open')).toBe(true)
      // 🔴 **And the held message is SENT, not abandoned** — the interruption produces `status:'idle'`
      // and the host flushes on exactly that. ⛔ The brief's claim was inverted here, not merely
      // wrong: an interruption ADVANCES a held task.
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out after the interrupt',
      )
      expect(mailboxOf(store.events(worker)).map((one) => one.ending)).toContain('sent')
      expect(pm).toBeTruthy()
    })

    it('🔴 REPAIRED by 396: an UNATTENDED child flushes its mailbox — the defect this measured', async () => {
      // ⛔ **This test used to assert the DEFECT and `396` turned it red, which is what it was for.**
      //
      // `395` found that `RuntimeHost.deliver` called `flushQueued` BELOW
      // `if (!session.sink.alive) return`, and that a spawned session's sink is `NO_SURFACE`, whose
      // `alive` is `false` — so the one trigger that sends a held message, the target going `idle`,
      // never ran for exactly the conversations a mailbox exists for. ⚑ It wrote the finding as a
      // MEASUREMENT rather than a comment: the same held message going out at once with a window
      // attached, and still held with none.
      //
      // ⚠️ **`396` moved the flush out from under the gate and this assertion went red**, exactly as
      // the note predicted. ⛔ **It is replaced rather than adjusted**: a red test quietly weakened
      // until it passes is how a repair loses its evidence, so what stands here now is the OPPOSITE
      // claim — the flush happens with no window attached — and the control that used to be the
      // interesting half is still here, because a test that only shows the repaired case would pass
      // either way once a window is claimed.
      //
      // ⚑ The dispatch that owns this behaviour now is `396`, and its own suite puts the hazard on
      // the path: `nothing-waits-on-somebody-looking.test.ts` §1.
      // ⚑ **D-016 · the turn is started by the give's brief**, so the message this test needs HELD
      // is a follow-up on that piece, meeting the running turn.
      const { pmProfile, worker, piece, pmTools, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      expect(workerHandle.status()).toBe('waiting_permission')
      const held = await callOn(pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        piece,
        text: 'second',
      })
      expect(held.delivery, JSON.stringify(held)).toBe('queued')
      await letTheTurnFinish(worker)
      // ⛔ **`letTheTurnFinish` CLAIMS the conversation** — the control, and it is still the control:
      // with a live sink the held message goes out at once, as it always did.
      await waitFor(
        () => mailboxOf(store.events(worker)).some((one) => one.ending === 'sent'),
        'the held message to go out to a child somebody is watching',
      )

      // 🔴 **And now the same shape with nobody watching.** A second child, a second held message,
      // and the turn ends the same way — through the provider rather than through a person, so no
      // window is ever attached.
      const alone = await aPmAndItsWorker()
      reach(alone.pmProfile, { canMessage: 'any' })
      // ⚑ **D-016 · the brief opens the turn here too**, for the reason the arm above states.
      expect(alone.workerHandle.status()).toBe('waiting_permission')
      const stranded = await callOn(alone.pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: alone.worker,
        piece: alone.piece,
        text: 'second',
      })
      expect(stranded.delivery, JSON.stringify(stranded)).toBe('queued')
      await host.interrupt(alone.worker, asPm(alone.pm))
      await waitFor(
        () => ledger(alone.worker).some((event) => event.type === 'turn'),
        'the interrupted terminal',
      )
      // ⛔ **Sent, with nobody looking.** This is the repair, measured where the defect was.
      await waitFor(
        () => mailboxOf(store.events(alone.worker)).some((one) => one.ending === 'sent'),
        'the held message to go out to a child NOBODY is watching',
      )
      expect(mailboxOf(store.events(alone.worker)).map((one) => one.ending)).toContain('sent')
    })

    it('⛔ a conversation ENDING settles all three, which is the sentence that IS true', async () => {
      // ⚑ D-016 · the give is the work, and its brief the turn parked on its card.
      const { pmProfile, worker, workerHandle } = await aPmAndItsWorker()
      reach(pmProfile, { canMessage: 'any' })
      expect(workerHandle.status()).toBe('waiting_permission')
      // ⛔ **496 · the PERSON's ending, because this is work IN FLIGHT** (HO-034 §1). ⚠️ What this
      // test is about is what an ENDING does to a task, a question and a held message — not who
      // performed it — and the ending that still reaches a conversation somebody is being asked
      // something in is the person's own. ⚑ (`endAgent`, which escalated to `THE_APP_ITSELF` and
      // called exactly this, went with `end_agent` in D-017.)
      if (!claimed.has(worker)) {
        host.claimSession(worker, window)
        claimed.add(worker)
      }
      await host.close(worker, window)
      const after = store.events(worker)
      // ⚑ **The converse of the test above, measured rather than assumed**: `status:'ended'` is what
      // both folds settle on, and it is the only thing that does. ⚠️ **The two vocabularies answer it
      // DIFFERENTLY since `400`** — HO-018 §2.3 — and that difference is the assertion: the REQUEST
      // is `abandoned`, terminally, and the TASK carries a condition and stays open.
      expect(derivePieces(worker, after).some((one) => one.state === 'stalled')).toBe(true)
      expect(derivePieces(worker, after).every((one) => TASK_IS_OPEN[one.state])).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the restart
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · what an interruption looks like after the app comes back', () => {
    it('🔴 the reading survives a relaunch field for field — it is derived, so there is nothing to lose', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      await host.interrupt(worker, asPm(pm))
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'turn'),
        'the interrupted terminal',
      )
      const before = howWorkStopped(store.events(worker))
      expect(before).toEqual({ how: 'it-was-stopped', who: 'an-agent', asker: pm })

      // ⚑ **A new host over the same database** — the app coming back. ⛔ The slot is gone, the
      // handle is gone, and the reading is not: it is a fold over rows that were written before the
      // provider was ever touched.
      await host.closeAll()
      const next = buildHost()
      const nextStore = createSessionStore(db, tick)
      expect(howWorkStopped(nextStore.events(worker))).toEqual(before)
      // ⚑ **484 · `toMatchObject`, because the reading now carries two fields the raw fold does
      // not** — `endedAt` and `since` come off the TURN TABLE, which is the half a fold over events
      // could never supply and the half that makes *which turn is this* answerable.
      expect(nextStore.lastEndedTurn(worker)).toMatchObject(before)
      expect(nextStore.lastEndedTurn(worker)?.since).toBe('nothing-has-started-since')
      // 🔴 **And the ask survives too, as the CONVERSATION's fact** (484).
      expect(nextStore.lastAskToStop(worker)).toMatchObject({
        by: 'an-agent',
        asker: pm,
        turn: 'the-turn-that-ended-last',
      })
      expect(next).toBeTruthy()
    })

    it('⚠️ a turn this app never saw the end of reads `nothing-has-said`, not `it-finished`', async () => {
      const quiet = await personOpens('quiet')
      const handle = latestHandle()
      await busy(quiet, handle)
      // ⛔ **A crash**: the turn row is closed by the next launch's sweep, which writes `end_reason`
      // and appends NOTHING to the ledger. ⚑ So the fold has a closed turn with no terminal event —
      // the state `222` §3's rule is about, and it says what was not seen rather than what did not
      // happen.
      db.prepare(`UPDATE turn SET closed_at = ?, end_reason = 'unknown' WHERE session_id = ?`).run(
        clock,
        quiet,
      )
      db.prepare(`DELETE FROM events WHERE session_id = ? AND type = 'turn'`).run(quiet)
      // ⚑ **484 · `endedAt` is present on THIS arm too**, and it is the arm where it matters most:
      // a turn closed by the sweep says *this app did not see how it ended*, which is a different
      // claim from *this app does not know when*. ⛔ The closing time is `end_reason`'s own
      // neighbour in the turn table, so the sweep wrote it even though it appended nothing.
      const unseen = store.lastEndedTurn(quiet)
      expect(unseen).toMatchObject({ how: 'nothing-has-said', who: null, asker: null })
      expect(unseen?.endedAt).toBeGreaterThan(0)
      expect(handle).toBeTruthy()
    })

    it('⛔ a conversation with no closed turn reads NULL, which is a different answer', async () => {
      const fresh = await personOpens('fresh')
      // ⚑ **`null` is *there is no closed turn*; `nothing-has-said` is *there is one and we did not
      // see how it ended*.** Two facts, two answers, and `222` is the dispatch that separated them.
      expect(store.lastEndedTurn(fresh)).toBeNull()
      expect(host.agentCard(fresh, window, fresh)?.lastEndedTurn).toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the censuses
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the censuses', () => {
    const strip = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

    it('⛔ the published inventory gained exactly one name, and it is the tenth', () => {
      // ⛔ **A FIXED index, corrected in place by `396`** (142's rule). ⚠️ This was written as
      // `TOOL_NAMES.length - 1` — *an anchor on a list's last member dies when anything appends* —
      // which is the SECOND time in two dispatches: `395` corrected `394`'s copy of it and then
      // wrote its own. ⚑ **The claim was never about being last**, it was *this dispatch published
      // the tenth name*, and that is a fact about position 9 for ever. ⚑ **D-017 — except that a
      // name BEFORE it went**: `end_agent` stood fifth and was withdrawn, so the tenth published is
      // ninth in the list now, at position 8.
      expect(TOOL_NAMES.indexOf('interrupt_agent')).toBe(8)
      expect(agentToolsFor(host, 'sess_x').tools.map((one) => one.name)).toEqual([...TOOL_NAMES])
    })

    it('🔴 exactly ONE place records the ask, so no door can write it a second way', () => {
      // ⚠️ **A negative needs a search shape.** The claim is *"every interruption this app performs
      // is recorded once, by one function"* — so the enumeration is every `.ts` under `src/main`,
      // comments stripped, looking for the event type rather than for a word.
      const sources = readdirSync(mainRoot, { recursive: true, encoding: 'utf8' })
        .filter((entry) => typeof entry === 'string' && entry.endsWith('.ts'))
        .map((entry) => ({
          path: entry.replaceAll('\\', '/'),
          text: strip(readFileSync(join(mainRoot, entry), 'utf8')),
        }))
      const writers = sources
        .filter(({ text }) => text.includes("type: 'work_interrupted'"))
        .map(({ path }) => path)
      expect(writers).toEqual(['runtime/runtime-host.ts'])
      const host_ = sources.find((one) => one.path === 'runtime/runtime-host.ts')?.text ?? ''
      // ⛔ **One writer inside that file too** — every door goes through `recordTheAsk`.
      expect(host_.split("type: 'work_interrupted'")).toHaveLength(2)
      // ⚑ **The control that plants more than one** (standing rule 12): the same counting shape
      // finds several call sites, so *"exactly one writer"* above is a count and not a reader that
      // stops at the first match in a 10,000-line file.
      //
      // 🔴 **CORRECTED in place by `397`, and the correction is a finding** (142's rule). It read
      // `toHaveLength(4)` — three call sites — and *"every door records the ask"* was a property of
      // three lines that had to be remembered. ⛔ **A fourth door did not remember**:
      // `runSendInterrupting` stops a running turn to put a replacement in its place and wrote
      // nothing, so the most ordinary interruption in this app recorded nobody. ⚑ `397` made
      // membership structural instead — `askTheWorkToStop` is the only path to the provider — and
      // the assertion below is what keeps it that way.
      // ⚑ **699 added a THIRD caller and a FOURTH** — `end_agent` on a conversation nothing ran in,
      // and on one whose start was in flight — ⚑ **and D-017 took both away with `end_agent`**, so
      // `askTheWorkToStop` is once more the ONE caller of `recordTheAsk`.
      // ⚑ **A fourth caller**: a message (or an answer) that asks the turn it waits behind to stop.
      expect(host_.split('this.recordTheAsk(')).toHaveLength(2)
      expect(host_.split('this.askTheWorkToStop(')).toHaveLength(5)
      // ⛔ **And the provider is reached from exactly ONE line in the file.** This is the assertion
      // that makes the sentence above a fact rather than a habit: a fifth door cannot stop a turn
      // without going through the method that records the ask and writes the endings.
      expect(host_.split('session.handle.interrupt()')).toHaveLength(2)
      // ⚑ **The control**: the shape finds a writer when there is one, and the sweep is not empty.
      expect(sources.length).toBeGreaterThan(20)
      expect(sources.filter(({ text }) => text.includes("type: 'user_command'"))).toHaveLength(1)
    })

    it('⛔ the ask is recorded BEFORE the provider is asked, in both doors', () => {
      const source = strip(readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8'))
      // 🔴 **Order as a source fact, because a runtime test cannot see a row that was never
      // written.** `394` learned this one door over: an ordering that only shows up when the
      // provider stalls is an ordering nothing in a green suite measures.
      //
      // 🔴 **CORRECTED in place by `397`**: the two doors no longer touch the provider themselves,
      // so the ordering they used to hold individually is now held ONCE, in the method they both
      // call. ⚑ The claim is unchanged and the anchor moved to where the code moved — *correct a
      // stale anchor, do not retire it*.
      const stopper = source.indexOf('private askTheWorkToStop(')
      expect(stopper, 'askTheWorkToStop was renamed or removed').toBeGreaterThan(0)
      const stopBody = source.slice(stopper, source.indexOf('\n  }', stopper))
      expect(stopBody.indexOf('this.recordTheAsk(')).toBeLessThan(
        stopBody.indexOf('session.handle.interrupt()'),
      )
      // ⚠️ **And the endings go in between**, which is the ordering `397` added and the one that
      // makes the rows exist on a provider whose `interrupt()` never returns.
      expect(stopBody.indexOf("type: 'request_interrupted'")).toBeGreaterThan(
        stopBody.indexOf('this.recordTheAsk('),
      )
      expect(stopBody.indexOf("type: 'request_interrupted'")).toBeLessThan(
        stopBody.indexOf('session.handle.interrupt()'),
      )
      // ⚑ **D-017** — `endAgent`, the third door, which wrote it before the teardown, is gone.
    })

    it('⚠️ every member of the vocabulary is reachable, and none is a word nothing writes', async () => {
      // ⛔ **`395` drafted a third member, `this-app`, and removed it** — *a closed vocabulary
      // guards what a member says*, and nothing would have written it. ⚑ **`501` kept that true
      // and made it a REFUSAL**: `recordTheAsk` returns without a row when the caller is the app,
      // which the test below this one drives.
      //
      // 🔴 **501 · the vocabulary here is the DERIVED one.** `WHO_ASKED_IT_TO_STOP` was a
      // hand-written pair for this one producer, because `recordTheAsk` spelled its own two words
      // from `sessionSpeakingAs`; the writer asks `whoDidIt` now, so what it can write IS
      // {@link WHO_STOPPED_IT}. ⛔ This loop is what keeps every member of it a word something
      // writes, and it is the assertion a fourth caller kind has to answer to.
      const seen = new Set<string>()
      const quiet = await personOpens('quiet')
      const quietHandle = latestHandle()
      await busy(quiet, quietHandle)
      await host.interrupt(quiet, window)
      for (const event of ledger(quiet)) {
        if (event.type === 'work_interrupted') seen.add(event.by)
      }
      // ⛔ **496 · `an-agent` is produced through the STOP door and no longer through the ending.**
      // ⚠️ Both verbs still write this row in production — an agent may stop or end a child that is
      // merely working — but the Fake parks every turn it drives on a person's card, and that is the
      // one state HO-034 §1 refuses an agent for. ⚑ `RuntimeHost.interrupt` is the door
      // `interrupt_agent` reaches once its rails admit, and §6 drives it the same way.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief's turn is the one parked on its card.
      expect(workerHandle.status()).toBe('waiting_permission')
      await host.interrupt(worker, asPm(pm))
      for (const event of ledger(worker)) {
        if (event.type === 'work_interrupted') seen.add(event.by)
      }
      // 🔴 **501 · the third word, driven through the same door as the first.** ⛔ A caller whose
      // id is neither `webContents:` nor `agent:` — {@link THE_APP_ITSELF}'s own docblock names
      // the next one, *"the MCP tool a PM would spawn agents through … gets its own prefix from
      // whatever registers it"* — and until `501` this writer recorded it as **a person**, one
      // ordinal away from a `proposal_ended` row that named the same caller correctly.
      //
      // ⚠️ **No boundary mints such an id today, and the door that takes it is the HOST's**, which
      // is the unit the vocabulary belongs to: `RuntimeHost.interrupt` takes a `Caller`, and
      // `the-caller-that-may-command-but-not-watch.test.ts` already drives this same caller
      // through four other verbs. ⛔ That is why this is not the member `395` removed: that one
      // was a member for an ACT nothing performs, and this is a CALLER the doors admit.
      const unnameable = new RecordingSink('mcp:planner')
      const theirs = await host.createSession(
        { provider: 'claude', profileId: 'planner', approvalMode: 'ask', cwd: root },
        unnameable,
      )
      const theirHandle = latestHandle()
      await busy(theirs.sessionId, theirHandle, unnameable)
      await host.interrupt(theirs.sessionId, unnameable)
      for (const event of ledger(theirs.sessionId)) {
        if (event.type === 'work_interrupted') seen.add(event.by)
      }
      expect([...seen].sort()).toEqual([...WHO_STOPPED_IT].sort())
    })

    it('⛔ 501 · the APP asks nothing, so its stop writes no ask — and the same door one caller over does', async () => {
      // 🔴 **An actual refusal paired with the same call one fact over ALLOWED** (standing rule 3),
      // and the fact that differs is the CALLER and nothing else.
      //
      // ⛔ **The stop door admits {@link THE_APP_ITSELF}** — `mayCommand`'s first clause is
      // unconditional — so the symbol reaches `recordTheAsk`, and until `501` it was written down as
      // a person. ⚑ It is now an absence: *the app never asks a turn to stop as an act of its own*,
      // which is `395`'s own argument for removing the `this-app` member, made true rather than
      // claimed. ⚑ **D-017 — asked through `RuntimeHost.interrupt`**: `endAgent`, the door this was
      // measured on, went with `end_agent`, and `recordTheAsk` has one caller now, which both doors
      // reach.
      const byTheApp = await aPmAndItsWorker()
      expect(byTheApp.workerHandle.status()).toBe('waiting_permission')
      await host.interrupt(byTheApp.worker, THE_APP_ITSELF)
      await turnEnded(byTheApp.worker)
      expect(ledger(byTheApp.worker).filter((one) => one.type === 'work_interrupted')).toEqual([])

      // ⚑ **The paired positive**: the same verb, the same shape of conversation, and a caller
      // this app has a word for — so the empty array above is a refusal and not a door that
      // stopped working.
      const byItsParent = await aPmAndItsWorker()
      expect(byItsParent.workerHandle.status()).toBe('waiting_permission')
      await host.interrupt(byItsParent.worker, asPm(byItsParent.pm))
      await turnEnded(byItsParent.worker)
      expect(
        ledger(byItsParent.worker)
          .filter((one) => one.type === 'work_interrupted')
          .map((one) => (one.type === 'work_interrupted' ? one.by : '')),
      ).toEqual(['an-agent'])
    })

    it('⛔ the fold reads the ledger and nothing else — no store, no slot, no clock', () => {
      const source = readFileSync(join(here, '../src/shared/how-work-stopped.ts'), 'utf8')
      const imports = [...source.matchAll(/^import .*$/gm)].map((one) => one[0])
      // ⚑ **The ledger shape is still a TYPE** — `tasks.ts` and `mailbox.ts`'s property, so *"how
      // work stopped is a function of the ledger"* is checked by the compiler on every build rather
      // than by a test that has to remember to drop something.
      const ledgerShape = imports.filter((one) => one.includes('./runtime-ipc'))
      expect(ledgerShape).toHaveLength(1)
      expect(ledgerShape[0]).toContain('import type')
      // 🔴 **494 · a SECOND import, and it is a VALUE — so the claim is asserted TRANSITIVELY
      // rather than by a count.** ⛔ `whoCancelledIt` reads {@link UserDecisionEvent.by}, whose
      // vocabulary `who-did-it.ts` owns; a second spelling of those four words here is what
      // `stoppedBy`'s own rule forbids. ⚠️ **What criterion 2 asks is not how many imports this
      // file has** — it is that none of them can hand the fold a database, a clock or a disk.
      const vocabulary = imports.filter((one) => one.includes('./who-did-it'))
      expect(vocabulary).toHaveLength(1)
      expect(imports).toHaveLength(2)
      // ⛔ **And the module it reaches reaches NOTHING**, which is what makes the value import safe
      // rather than merely small. ⚑ The day `who-did-it.ts` grows an import, this goes red here
      // instead of going quiet in a fold that has since acquired a clock.
      const reached = readFileSync(join(here, '../src/shared/who-did-it.ts'), 'utf8')
      expect([...reached.matchAll(/^import .*$/gm)]).toHaveLength(0)
      // ⚑ **The control that plants TWO** (standing rule 12): the matcher over a value import and
      // a type import, so a pattern that could not tell them apart fails here rather than passing
      // over a second line that took a database.
      const planted = ["import { open } from 'node:fs'", "import type { A } from './a'"].join('\n')
      expect([...planted.matchAll(/^import .*$/gm)]).toHaveLength(2)
    })

    // 🔴 **610 · the title said *grew exactly one field* and this dispatch changed one** (rule 25).
    // ⛔ **A title is a claim**, and *grew one* was `484`'s arithmetic rather than this census's
    // subject: what it asserts is that the card's fields are EXACTLY these, which is what catches a
    // field added without a reader and a field renamed without its census. ⚑ `610` renamed
    // `profile` to `whose` — see `AgentCard.whose` — and this key is how that rename was found.
    it('⚠️ the card carries exactly these fields, and the two about the past are null for a conversation with no closed turn', async () => {
      const fresh = await personOpens('fresh')
      const card = host.agentCard(fresh, window, fresh)
      const shape: Record<keyof AgentCard, true> = {
        agent: true,
        worker: true,
        // ⚑ **D-016** · `project` went with projects.
        whose: true,
        provider: true,
        state: true,
        // ⚑ What its turn is stopped on until a person answers it.
        stoppedOnAPerson: true,
        spawnedBy: true,
        parent: true,
        // ⚑ **D-016 · commit 7 · R2** · the work that names this conversation — what `list_agents`'
        // line leads with — ⚑ and (W4.209) what to call its parent, by the piece it started it from.
        named: true,
        parentCalled: true,
        // ⚑ **D-016** · the spawn's time and reason went with `spawn_agent`; the card names the work
        // the conversation holds instead.
        pieces: true,
        // 🔴 **D-042 · R6 — what it runs on, so a giver can check what its helper runs**: the pair
        // it is selected to run and what its provider last reported. ⚑ About the present, not the
        // past — so neither of the two nulls below is about it (`AgentCard.runsOn`).
        runsOn: true,
        lastEndedTurn: true,
        // 🔴 **484 · the SECOND field about what already happened, and it is a different subject.**
        // ⛔ `lastEndedTurn` is about one TURN and this is about the CONVERSATION — see
        // `AgentCard.lastAskToStop` for why folding them would put a person's Stop of an idle
        // conversation on a turn it never touched.
        lastAskToStop: true,
        // 🔴 **676 · F3 — how many rows the two fields above could not read.** ⚑ A count about
        // THIS card's reads, and `0` on a clean ledger — pinned below.
        rowsUnread: true,
        // ⚑ **D-017 · R8 — whether the whole record those reads open could not be read.**
        ledgersSkipped: true,
      }
      expect(Object.keys(card ?? {}).sort()).toEqual(
        Object.keys(shape)
          .filter((key) => key !== 'worker')
          .sort(),
      )
      expect(card?.worker).toBeUndefined()
      expect(card?.rowsUnread).toBe(0)
      expect(card?.lastEndedTurn).toBeNull()
      expect(card?.lastAskToStop).toBeNull()
    })

    it('⛔ the readings a surface gives are the ones this module exports — no second phrasing', () => {
      // ⚠️ **`ending.ts`'s standing rule, applied to the actor**: *"neither is composed at a call
      // site — a surface that wanted its own phrasing would be the second vocabulary."*
      const reading: StopReading = { how: 'it-was-stopped', who: 'an-agent', asker: 'sess_9' }
      expect(whoAskedClause(reading)).toBe('sess_9')
      expect(whoAskedClause({ ...reading, asker: null })).toBe('an agent')
      expect(whoAskedClause({ ...reading, who: 'a-person', asker: null })).toBe('a person')
      expect(whoAskedClause({ how: 'it-finished', who: null, asker: null })).toBeNull()
      // 🔴 **737 · re-aimed, not stripped**: the transcript's ask no longer composes its own asker —
      // it hands its facts to `stop-unanswered.ts`, whose ONE naming function asks `stoppedBy` (the
      // category, or the name `agentName` gives it — never the handle).
      const transcript = readFileSync(join(here, '../src/renderer/src/lib/transcript.ts'), 'utf8')
      expect(transcript).toContain('text: askedToStopSays(askedToStop, null),')
      expect(transcript).not.toMatch(/stoppedBy\(/)
      const words = readFileSync(join(here, '../src/renderer/src/lib/stop-unanswered.ts'), 'utf8')
      expect(words).toContain('return stoppedBy(fact.by, named)')
    })
  })
})

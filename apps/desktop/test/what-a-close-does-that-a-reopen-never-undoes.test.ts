import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type {
  AgentToolAnswer,
  AgentToolset,
  FakeRuntime,
  FakeSessionHandle,
  RuntimeEvent,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { giverStallReceipts, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN, undrivenSentence } from '../src/shared/tasks'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import {
  theMessagesOf,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
// ⚑ **663 · the double this file built, lifted so the wake's tests run on both shapes too.**
import { ProviderDouble, type ResumeGate } from './lib/provider-double'

/**
 * 🔴 **661 · what a close does that a reopen never undoes** — `656`'s F2, F3 and F4.
 *
 * ⚑ **One host, a real Close and a real Reopen, for each finding** — never a ledger written by
 * hand. ⛔ Each section carries a control that plants the same shape where the old behaviour is
 * still the right one, so a repair that reached too far goes red here too.
 *
 *  - **§1 · F2** — a reopen no longer takes the hand-back away from a conversation an AGENT asked
 *    for. ⚑ A conversation a PERSON started still ends with the window that reopened it.
 *  - **§2 · F3** — a question the conversation was still asking when it was closed. ⚑ **D-017 ·
 *    R3/R4: a Close is a STOP and ends nothing**, so this app's own question stays open through it —
 *    in this run and after a restart — and an answer to it STARTS the asker (R1). ⛔ The remember/bring-back machinery `661` built for it is
 *    gone, with the `the-conversation-that-asked-has-ended` rail and its wake-it-yourself sentence.
 *  - **§3 · F4** — a parent told about the work a Close stopped. ⚑ **D-016c — a stop and a start
 *    move no piece and tell nobody anything**: the Close's notice is the turn it interrupted, told
 *    once, and a reopen makes none of it false, so nothing is corrected and nothing is told again.
 *    ⛔ The correction family `661` built here — *"that conversation was started again"*, and the
 *    stop told again after it — went with the stop cause. ⛔ §3.10a–c, a parent that stopped the
 *    conversation itself with `end_agent`, retired with that tool (D-017, commit 3).
 *
 * ⚑ **D-016 · the child is started by a GIVE**, and its brief is its first turn — which parks on the
 * Fake's card (the PM's `ask`), where a spawn started it idle and a `work` message parked it. A
 * notice names the piece by its LABEL, which is what every helper below matches on.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * ⚑ **What a Close of a worker MID-TURN tells its parent** (D-016c) — the turn it interrupted,
 * rendered, so a sentence that moves moves here with it. ⛔ Never a stop's own words: a stop is no
 * cause.
 */
const ITS_TURN_WAS_STOPPED = undrivenSentence('turn_interrupted')

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

describe('661 · what a close does that a reopen never undoes', () => {
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
  let secondWindow: RecordingSink
  let gate: ResumeGate
  const tick = (): number => clock++

  const buildHost = (
    over: SessionStore = store,
    runtime: (provider: Provider) => FakeRuntime = (provider) =>
      new ProviderDouble(provider, handles, issued, gate),
  ): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: runtime,
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
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-661-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-661-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_610_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = { held: null, entered: 0, silentUntilItsFirstTurn: false }
    host = buildHost()
    window = new RecordingSink('webContents:1')
    secondWindow = new RecordingSink('webContents:2')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /**
   * ⛔ **A restart, and nothing that survives one** — `652`'s helper. ⚠️ A second `SessionStore`
   * OBJECT is what makes the next host see the ledger as nobody's; the first host is closed whole
   * first, so no two ordinal counters ever share a ledger.
   */
  const relaunch = async (): Promise<void> => {
    await host.closeAll()
    host = buildHost(createSessionStore(db, tick))
  }

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  const personOpens = async (profileId: string, sink = window): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      sink,
    )
    return sessionId
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const runningOf = (sessionId: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )?.running

  /**
   * ⚑ **A PM in a window and one child it gave a piece to through the real door** — ⚑ D-016: the
   * give starts the child, in the PM's `ask`, and its brief is the child's first turn.
   */
  const aPmAndItsWorker = async (
    brief = 'migrate the schema',
  ): Promise<{ pm: string; worker: string }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const given = await callOn(agentToolsFor(host, pm), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work this dispatch is about',
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, worker: given.agent as string }
  }

  const cardsOn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'permission_request').length

  /** ⚑ **A piece by the label a notice names it by** — the id the receipts and the fold key on. */
  const pieceOf = (label: string): string => {
    const row = store.workByLabel(label)
    if (row === null) throw new Error(`no piece labelled ${label}`)
    return row.piece
  }

  /**
   * 🔴 **The worker holds the work MID-TURN, parked on a card it raised for it** — the shape in
   * which a close is what stalls the work, by the turn it interrupts, so the parent's FIRST notice
   * is {@link ITS_TURN_WAS_STOPPED}. ⚠️ A worker whose turn had already ended would have been
   * reported `turn_ended` before the close (§3.5). ⚑ **D-016** — the brief's own turn is the one
   * that parks.
   */
  const aWorkerMidTurn = async (): Promise<{ pm: string; worker: string; label: string }> => {
    const { pm, worker } = await aPmAndItsWorker()
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker) > 0, 'the card the work parks on')
    const open = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
    if (open === undefined) throw new Error('the give never opened a piece')
    return { pm, worker, label: open.label }
  }

  /**
   * ⚑ **…and asks its parent a question about it** — `591`'s shape. ⛔ The question is the app's
   * own (`ask_question`), so — D-017 · R4 — a stop does not end it: its words are in the asker's
   * ledger, and an answer starts the asker (R1, R6).
   */
  const aWorkerAskingItsParent = async (): Promise<{
    pm: string
    worker: string
    label: string
    requestId: string
  }> => {
    const held = await aWorkerMidTurn()
    const asked = await callOn(agentToolsFor(host, held.worker), 'ask_question', {
      who_answers: 'the-parent',
      piece: held.label,
      question: 'postgres or sqlite?',
      options: ['postgres', 'sqlite'],
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    return { ...held, requestId: theQuestionOf(held.worker).requestId }
  }

  /**
   * ⛔ **Answer the conversation's card, so its turn ends and it is idle.** ⚑ A question to the
   * PARENT is still open, so its row is a wait and nobody was pushed anything.
   */
  const letTheTurnFinish = async (worker: string): Promise<void> => {
    const card = events(worker)
      .filter(
        (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
          event.type === 'permission_request',
      )
      .at(-1)
    if (card === undefined) throw new Error('the worker is not parked on anything')
    const turns = events(worker).filter((event) => event.type === 'turn').length
    await host.respondPermission(worker, card.id, { outcome: 'allow' }, window)
    await waitFor(
      () => events(worker).filter((event) => event.type === 'turn').length > turns,
      'the turn to reach its own terminal',
    )
  }

  const theQuestionOf = (worker: string): { requestId: string; state: string } => {
    const row = store
      .routedRequestsOf(worker)
      .filter((one) => one.went.is === 'the-parent')
      .at(-1)
    if (row === undefined) throw new Error(`no routed question in ${worker}`)
    return row
  }

  const answerTo = (pm: string, requestId: string): Promise<Record<string, unknown>> =>
    callOn(agentToolsFor(host, pm), 'answer_question', {
      question: requestId,
      answers: [{ part: 'answer', answer: ['sqlite'] }],
    })

  /** ⛔ Every way words reach a conversation — a busy one HOLDS them, an idle one takes a turn. */
  const wordsIn = (sessionId: string): string[] => {
    const rows = events(sessionId)
    const sent = new Set(
      rows.flatMap((event) =>
        event.type === 'message_unqueued' &&
        event.reason === 'sent' &&
        event.messageId !== undefined
          ? [event.messageId]
          : [],
      ),
    )
    return rows.flatMap((event) =>
      event.type === 'user_turn'
        ? theMessagesOf(event).map((one) => one.text)
        : event.type === 'message_queued' &&
            (event.messageId === undefined || !sent.has(event.messageId))
          ? [event.text]
          : [],
    )
  }

  const theAnswerReached = (worker: string): boolean =>
    wordsIn(worker).some((text) => text.includes('answer: sqlite'))

  /**
   * ⚑ Matched on the FIRST line and the closing imperative — `614`'s neighbouring-element rule.
   * ⚑ **D-016** — the closing imperative names the piece by its label.
   */
  const noticesAbout = (parent: string, label: string, opening: string): string[] =>
    wordsIn(parent).filter((text) => {
      const lines = text.split('\n')
      return (
        ((lines[0] ?? '').includes(opening) && (lines.at(-1) ?? '').includes(`naming ${label}.`)) ||
        ((opening === 'not being worked on' || opening === '') &&
          (lines[0] ?? '').startsWith(`${label} still needs attention:`))
      )
    })

  /** ⚑ **D-016c — what a Close of a worker mid-turn tells its parent**: the turn it interrupted. */
  const toldItWasStopped = (parent: string, label: string): string[] =>
    noticesAbout(parent, label, 'not being worked on').filter((text) =>
      text.includes(ITS_TURN_WAS_STOPPED),
    )

  /** ⛔ **Everything this app said to a parent about one piece**, whatever its opening line. */
  const everythingSaidAbout = (parent: string, label: string): string[] =>
    noticesAbout(parent, label, '')

  /** ⚑ **D-016 · `work_stall_told`** — the giver's receipt, keyed by piece (was `work_reported`). */
  const receiptsTo = (parent: string, label: string) =>
    giverStallReceipts(store, parent).filter((event) => event.piece === pieceOf(label))

  /**
   * ⚑ What each receipt TOLD — a set-right receipt (a row written before D-016c) carries no cause,
   * so it reads as its `how`.
   */
  const whatEachReceiptTold = (parent: string, label: string): string[] =>
    receiptsTo(parent, label).map((one) =>
      one.type === 'work_reconciliation'
        ? (one.cause ?? one.outcome)
        : 'cause' in one
          ? one.cause
          : one.how,
    )

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · F2 — a reopen takes the hand-back away
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · F2 · the hand-back an agent-asked conversation was born with', () => {
    it('🔴 §1.1 an agent’s child, closed and reopened by a window, is RELEASED when that window goes — not ended', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      await host.close(worker, window)

      const opened = await host.resumeSession(worker, secondWindow)

      // 🔴 **The repair.** ⛔ `656` F2 measured `false`/`false` here: the reopen was a fresh
      // reservation under the window, and *"born without a surface"* answered from the window alone.
      expect(opened).toMatchObject({ startedWithoutAWindow: true, mayHandItBack: true })
      await host.closeSessionsForOwner(secondWindow.ownerId)
      // ⚑ **Released, and still its parent's**: it goes on running with nobody watching.
      expect(runningOf(worker)).toBe('unwatched')
      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(worker)
      expect(runningOf(pm)).toBe('in-a-window')
    })

    it('⚑ §1.2 THE CONTROL — a conversation a PERSON started still ends with the window that reopened it', async () => {
      // ⛔ **Rule 12.** Without this, §1.1 would pass over a host that answered `true` for every
      // reopen — which would stop a person's own Reopen ending with their own window (`523` Q3).
      const mine = await personOpens('alpha')
      await host.close(mine, window)

      const opened = await host.resumeSession(mine, secondWindow)

      expect(opened).toMatchObject({ startedWithoutAWindow: false, mayHandItBack: false })
      await host.closeSessionsForOwner(secondWindow.ownerId)
      expect(runningOf(mine)).toBe('not-running')
    })

    it('⛔ §1.3 a window that goes while its reopen is still STARTING cancels the reopen — it is not released onto a departed sink', async () => {
      // 🔴 **Found by this dispatch's review.** ⛔ §1.1 made a new state reachable: a slot still
      // starting, owned by a window, born without a surface. Releasing it would register the
      // session with the departed window's sink while nobody owns it — the split `release` exists
      // to prevent. ⚑ It is closed instead, which is what that race did before `661`.
      const { worker } = await aPmAndItsWorker()
      host.claimSession(worker, window)
      await host.close(worker, window)
      let open = (): void => {}
      gate.held = new Promise<void>((resolve) => {
        open = resolve
      })
      const before = gate.entered
      const reopening = host.resumeSession(worker, secondWindow).then(
        () => 'reopened',
        (error: unknown) => (error as Error).message,
      )
      await waitFor(() => gate.entered > before, 'the reopen to reach the provider')

      const leaving = host.closeSessionsForOwner(secondWindow.ownerId)
      open()
      await leaving

      expect(await reopening).not.toBe('reopened')
      expect(runningOf(worker)).toBe('not-running')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · F3 — a question nothing unwinds
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · F3 · a question the conversation was still asking when it was closed', () => {
    it('🔴 §2.1 a Close leaves it open, a reopen routes nothing again, and the parent’s answer reaches the worker', async () => {
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      // 🔴 **D-017 · R3/R4 — a Close is a stop, and ends nothing.** ⛔ Until D-017 the close
      // abandoned it and `661` remembered it for a reopen in the same run to route again.
      expect(theQuestionOf(worker)).toMatchObject({ requestId, state: 'open' })

      await host.resumeSession(worker, window)

      // ⚑ **One routing, the same question** — nothing to bring back, so the ledger holds the id once.
      expect(
        store.routedRequestsOf(worker).filter((one) => one.requestId === requestId),
      ).toHaveLength(1)
      const again = theQuestionOf(worker)
      expect(again.requestId).toBe(requestId)
      expect(REQUEST_IS_OPEN[again.state as keyof typeof REQUEST_IS_OPEN]).toBe(true)
      expect(theAnswerReached(worker)).toBe(false)
      // ⚑ **…and ONLY the app's own question.** The worker was also parked on a permission card
      // its PROVIDER raised; that card died with the provider (R4: a terminal status ends a provider's
      // cards), and the reopen is a new one that never had it — `question-has-already-ended` stays true
      // of it.
      const cards = store.routedRequestsOf(worker).filter((one) => one.requestId !== requestId)
      expect(cards.length).toBeGreaterThan(0)
      expect(cards.every((one) => one.state === 'abandoned')).toBe(true)

      const answered = await answerTo(pm, requestId)
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      expect(theQuestionOf(worker).state).toBe('answered')
      await waitFor(() => theAnswerReached(worker), 'the answer delivered into the worker')
      expect(wordsIn(worker).find((text) => text.includes('answer: sqlite'))).toContain(
        'postgres or sqlite?',
      )
    })

    it('🔴 §2.2 answered WHILE the asker is closed: taken, and the answer starts it', async () => {
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      expect(runningOf(worker)).toBe('not-running')

      // 🔴 **D-017 · R1 — every delivery starts its recipient.** ⛔ Until D-017 this was refused
      // `the-conversation-that-asked-has-ended`, and the parent had to wake the asker first.
      const early = await answerTo(pm, requestId)
      expect(early.outcome, JSON.stringify(early)).toBe('ok')
      expect(theQuestionOf(worker).state).toBe('answered')
      await waitFor(() => theAnswerReached(worker), 'the answer to start the worker and reach it')
      expect(runningOf(worker)).not.toBe('not-running')
    })

    it('🔴 §2.3 the pass-up door takes the one open question while its asker is stopped', async () => {
      // ⚑ **D-017 · R4** — the ledger holds the id ONCE (no ending, no second routing), and the door
      // reads it as the open question it is. ⛔ Until D-017 it was refused like §2.2's answer.
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      expect(
        store.routedRequestsOf(worker).filter((one) => one.requestId === requestId),
      ).toHaveLength(1)

      const passed = await callOn(agentToolsFor(host, pm), 'pass_question_up', {
        question: requestId,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
    })

    it('⚑ §2.4 …and after a RESTART it is still open, and the answer starts the asker', async () => {
      // ⛔ **The limit `661` kept is gone** (R4): the question's words are in the asker's ledger, not
      // in a host's memory, so a relaunch keeps it answerable.
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      await relaunch()

      expect(theQuestionOf(worker)).toMatchObject({ requestId, state: 'open' })
      await host.resumeSession(pm, window)
      const answered = await answerTo(pm, requestId)
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      await waitFor(() => theAnswerReached(worker), 'the answer to start the worker and reach it')
    })

    /**
     * ⛔ **§2.5 retired with `end_agent` (D-017, commit 3).** It measured R4 at the one ending an
     * agent could ask for — its parent's `end_agent` kept the question open, and the answer started
     * the asker. ⚑ Nothing ends a conversation now; a person's Close (§2.3) and a restart (§2.4) are
     * the stops left, and both keep the question the same way.
     */

    /**
     * ⛔ **§2.6 retired with its subject (D-017 · R4).** It pinned the repair's own bound — a question
     * brought back once, then ended by the parent, stayed ended — and nothing is brought back now:
     * the question never ended.
     */
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · F4 — a stall notice a reopen used to make false, and makes false no more
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · F4 · a parent told the conversation had stopped', () => {
    it('🔴 §3.1 is told ONCE, with the cause the row stands on — and the reopen tells it nothing more', async () => {
      const { pm, worker, label } = await aWorkerMidTurn()
      await host.close(worker, window)
      // ⚑ **D-016c — the Close's notice is the turn it interrupted**, never a stop's own words.
      await waitFor(() => toldItWasStopped(pm, label).length === 1, 'the parent told the stop')
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)

      await host.resumeSession(worker, window)
      await letItSettle()

      // 🔴 **`656` F4 measured the stop notice as the parent's last word about this task, beside a
      // child that was running again**, and `661` answered with a correction. ⚑ **D-016c — the
      // notice is true of the row after the reopen too**: a reopen moves no piece, so the row still
      // stands `stalled · turn_interrupted` and nothing is owed.
      expect(store.piecesOwnedBy(worker).find((one) => one.label === label)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
      })
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      // ⚑ **The receipt is the push's, and it is the only one** — a stop and a start write none.
      expect(whatEachReceiptTold(pm, label)).toEqual(['turn_interrupted'])
      expect(store.workReportedTo(pm).has(pieceOf(label))).toBe(true)
    })

    it('🔴 §3.2 …and never twice, whatever else the reopened conversation reports', async () => {
      const { pm, worker, label } = await aWorkerMidTurn()
      await host.close(worker, window)
      await waitFor(() => toldItWasStopped(pm, label).length === 1, 'the parent told the stop')
      await host.resumeSession(worker, window)

      // ⚑ **A status row from the reopened provider** — a trigger the pump asks on.
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no provider handle was issued')
      const before = events(worker).filter((event) => event.type === 'status').length
      handle.simulateThinking({ text: 'thinking it over', redacted: false })
      await waitFor(
        () => events(worker).filter((event) => event.type === 'status').length > before,
        'a status row from the reopened conversation',
      )
      await letItSettle()

      expect(toldItWasStopped(pm, label)).toHaveLength(1)
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
    })

    it('⚑ §3.3 a worker that was ASKING: the Close tells its parent nothing, and so does the reopen', async () => {
      // ⚑ **D-017 · R4 — the question survives the stop**, so the work still WAITS on the parent's
      // own answer: the composed row is a wait, and nothing about it stopped being true. ⛔ Until
      // D-017 the close abandoned the question, the parent was told *"has ended"*, and the reopen
      // routed the question again and sent the WAIT correction (`661` F3 and F4 on one row).
      const { pm, worker, label } = await aWorkerAskingItsParent()
      await host.close(worker, window)
      await letItSettle()
      expect(everythingSaidAbout(pm, label)).toEqual([])
      expect(whatEachReceiptTold(pm, label)).toEqual([])

      await host.resumeSession(worker, window)
      await letItSettle()

      expect(everythingSaidAbout(pm, label)).toEqual([])
      expect(whatEachReceiptTold(pm, label)).toEqual([])
    })

    /**
     * ⛔ **§3.3b retired with its subject (D-016c).** It pinned the reopen's own trigger for the
     * correction on Claude, whose reopened provider writes nothing until its first turn; a reopen
     * owes nobody anything now, so the trigger went with the correction.
     */

    it('⚑ §3.4 THE CONTROL — a conversation closed and NOT reopened: the notice stands', async () => {
      // ⛔ **Rule 12.** Without this, §3.1's *nothing more* would pass over a host that told nobody
      // anything at a Close.
      const { pm, worker, label } = await aWorkerMidTurn()
      await host.close(worker, window)
      await waitFor(() => toldItWasStopped(pm, label).length === 1, 'the parent told the stop')
      await letItSettle()

      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      expect(whatEachReceiptTold(pm, label)).toEqual(['turn_interrupted'])
    })

    it('⚑ §3.5 THE CONTROL — a parent whose last notice was NOT a stop is told nothing by the reopen', async () => {
      // ⛔ **Rule 12, on the turn the Close finds**: here its worker's turn ended first, so it was
      // told *"its turn ended"* — and a close then tells it nothing more (told once per task, and a
      // Close of an idle conversation interrupts no turn), so the reopen has nothing to tell either.
      const { pm, worker, label } = await aWorkerMidTurn()
      await letTheTurnFinish(worker)
      await waitFor(
        () =>
          noticesAbout(pm, label, 'not being worked on').some((text) =>
            text.includes(undrivenSentence('turn_ended')),
          ),
        'the parent told the turn ended',
      )
      await host.close(worker, window)
      await letItSettle()
      expect(toldItWasStopped(pm, label)).toEqual([])
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)

      await host.resumeSession(worker, window)
      await letItSettle()

      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      expect(noticesAbout(pm, label, 'not being worked on')).toHaveLength(1)
    })

    /**
     * ⛔ **§3.8 retired with its subject (D-016c).** It pinned a CORRECTION held at a quit, kept and
     * read at the parent's next start; no correction is written now. ⚑ That a quit hands on what a
     * conversation held is D-017 · R3's, pinned where a held message is the subject.
     */

    it('⛔ §3.7 held work a Close hands on: delivered at its start, never `message_never_sent`, and its giver is told nothing', async () => {
      // 🔴 **`415`'s F-race, on the notice's path** (found writing this file), re-aimed by D-017 ·
      // R3 and D-016c. ⛔ Until D-017 the finalizer settled the held message `message_never_sent`;
      // until D-016c the stop stalled it and the parent was told the stop, then set right. ⚑ **Now
      // the held message is handed on and the conversation started again, and a stop moves no
      // piece**, so the held work is driven by that start and its giver is owed nothing.
      // ⚑ **D-016 · the worker is busy with its FIRST piece** — the brief's own turn, parked on its
      // card — so a second give to it is HELD in its mailbox, which is the held work this is about.
      const { pm, worker } = await aPmAndItsWorker('busy with something else')
      host.claimSession(worker, window)
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no provider handle was issued')
      await waitFor(() => cardsOn(worker) > 0, 'the worker to be busy')
      const given = await callOn(agentToolsFor(host, pm), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The held one',
        brief: 'the held one',
      })
      expect(given).toMatchObject({ outcome: 'ok', agent: worker, delivery: 'held' })
      const label = given.label as string

      await host.close(worker, window)
      // ⚑ **D-016 · a brief is delivered with its piece's footer**, so it is found by its opening.
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'user_turn' && event.text.startsWith('the held one'),
          ),
        'the held work to be handed on and delivered at the start',
      )
      await letItSettle()
      expect(store.piecesOwnedBy(worker).find((one) => one.label === label)).toMatchObject({
        state: 'working',
        stalledBecause: null,
      })
      expect(everythingSaidAbout(pm, label)).toEqual([])
      expect(whatEachReceiptTold(pm, label)).toEqual([])
    })

    it('⛔ §3.7b …and the same when the provider ends its OWN stream — its slot is still `live` while it is torn down', async () => {
      // 🔴 **Found by this dispatch's review.** ⛔ A stream the provider ends itself goes straight to
      // the finalizer with the slot still `live`, where only `close()` moves `slot.phase`. ⚑ The
      // same shape as §3.7, ended by a fatal error instead of a Close — D-017 · R3: a provider
      // failure is a stop too.
      // ⚑ **D-016 · the worker is busy with its FIRST piece** — the brief's own turn, parked on its
      // card — so a second give to it is HELD in its mailbox, which is the held work this is about.
      const { pm, worker } = await aPmAndItsWorker('busy with something else')
      host.claimSession(worker, window)
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no provider handle was issued')
      await waitFor(() => cardsOn(worker) > 0, 'the worker to be busy')
      const given = await callOn(agentToolsFor(host, pm), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The held one',
        brief: 'the held one',
      })
      expect(given).toMatchObject({ outcome: 'ok', agent: worker, delivery: 'held' })
      const label = given.label as string

      handle.simulateError('the provider fell over', true)
      // ⚑ **D-016 · a brief is delivered with its piece's footer**, so it is found by its opening.
      await waitFor(
        () =>
          events(worker).some(
            (event) => event.type === 'user_turn' && event.text.startsWith('the held one'),
          ),
        'the held work to be handed on and delivered at the start',
      )
      await letItSettle()
      expect(store.piecesOwnedBy(worker).find((one) => one.label === label)).toMatchObject({
        state: 'working',
        stalledBecause: null,
      })
      expect(everythingSaidAbout(pm, label)).toEqual([])
      expect(whatEachReceiptTold(pm, label)).toEqual([])
    })

    it('🔴 §3.11 …and when that parent has stopped, a second stop neither starts it nor tells it — and a person is not handed it', async () => {
      // 🔴 **Round two of this dispatch's review, re-aimed by D-016c.** ⛔ Until D-016c the reopen's
      // correction re-armed the telling, and the second stop STARTED the stopped parent to tell it
      // the stop again. ⚑ **Told once per piece now, and a stop tells nobody anything**: the second
      // stop interrupts no turn — the reopened worker is idle — so the piece stays where the first
      // stop's turn left it, the parent is not started, and its receipt still stands, so the
      // person's band (the push's complement) does not list it either.
      const { pm, worker, label } = await aWorkerMidTurn()
      await host.close(worker, window)
      await waitFor(() => toldItWasStopped(pm, label).length === 1, 'the parent told the stop')
      await waitFor(() => cardsOn(pm) > 0, 'the parent’s own turn to park on its card')
      await letTheTurnFinish(pm)
      await host.resumeSession(worker, window)
      await letItSettle()
      const namedToAPerson = (): string[] =>
        host.stalledWorkForAPerson().rows.map((work) => work.label)
      expect(namedToAPerson()).not.toContain(label)

      await host.close(pm, window)
      await host.close(worker, window)
      expect(store.piecesOwnedBy(worker)[0]?.stalledBecause).toBe('turn_interrupted')
      await letItSettle()

      expect(runningOf(pm)).toBe('not-running')
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      expect(whatEachReceiptTold(pm, label)).toEqual(['turn_interrupted'])
      expect(namedToAPerson()).not.toContain(label)
    })

    it('🔴 §3.6 across a RESTART the receipt is what remembers the first notice, and nothing more is told', async () => {
      // ⚑ **`workReportedTo` answers which pieces the parent was told about**, and this is the
      // reader that needs it: a parent coming up after a restart is seeded from its own ledger, so
      // the notice is not owed again — at its own start, or at the worker's.
      const { pm, worker, label } = await aWorkerMidTurn()
      await host.close(worker, window)
      await waitFor(() => toldItWasStopped(pm, label).length === 1, 'the parent told the stop')
      await relaunch()

      await host.resumeSession(pm, window)
      await letItSettle()
      expect(everythingSaidAbout(pm, label)).toHaveLength(1)

      await host.resumeSession(worker, secondWindow)
      await letItSettle()

      expect(everythingSaidAbout(pm, label)).toHaveLength(1)
      expect(store.workReportedTo(pm).has(pieceOf(label))).toBe(true)
    })

    /**
     * ⛔ **§3.9 and §3.9b retired with their subject (D-016c).** They pinned the CORRECTION made
     * false by a second stop — the stop told again, the next reopen set right again, and after a
     * restart the ledger's `set-right` receipt re-arming the telling. ⚑ Told once per piece now, and
     * a stop or a start tells nobody anything (§3.11 measures the second stop).
     */

    /**
     * ⛔ **§3.10a, §3.10b and §3.10c retired with `end_agent` (D-017, commit 3).** Each had the parent
     * stop its child ITSELF — an asking child (told nothing, in this run and after a restart), and
     * held work where `415`'s F-race told the stop anyway, with the finalizer's `its-own-ending`
     * landing first. ⚑ Nothing ends a conversation now, and no agent can stop one it gave work to.
     */
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §6 · 675 — what the answer doors SAY about a question whose asker is not running
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **675 · three sentences, each measured on the arm where it was false, with its control**
   * (`661` F1, F2; `663` F3). ⚑ **D-017** took the rail two of them were said on away: an answer to
   * a question whose asker is stopped is a delivery, and starts it (R1, R6).
   */
  describe('§6 · 675 · what the answer doors say', () => {
    /**
     * ⚑ **`656`'s stream lever over this file's double** — the stream fails UNDER the host, so the
     * host's `for await` throws and no `status` row is written: a stop that leaves a provider's
     * question `open` with nobody running (`the-question-every-teardown-asks.test.ts`' `withLevers`, whose
     * double cannot reopen — this one shares `issued`, so a reopen resumes).
     */
    const levers = new Map<FakeSessionHandle, () => void>()
    class ADoubleWhoseStreamCanFail extends ProviderDouble {
      override async start(options: StartOptions): Promise<FakeSessionHandle> {
        const handle = await super.start(options)
        let fail!: () => void
        const failed = new Promise<IteratorResult<RuntimeEvent>>((_resolve, reject) => {
          fail = () => reject(new Error('the stream failed under the host'))
        })
        failed.catch(() => undefined)
        levers.set(handle, fail)
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'events') {
              return (): AsyncIterable<RuntimeEvent> => ({
                [Symbol.asyncIterator]() {
                  const inner = target.events()[Symbol.asyncIterator]()
                  return {
                    next: () => Promise.race([inner.next(), failed]),
                    return: async (): Promise<IteratorResult<RuntimeEvent>> =>
                      (await inner.return?.()) ?? { done: true, value: undefined },
                  }
                },
              })
            }
            const value = Reflect.get(target, property, target) as unknown
            return typeof value === 'function' ? (value as () => unknown).bind(target) : value
          },
        })
      }
    }
    const aHostWhoseStreamsCanFail = (): RuntimeHost =>
      buildHost(store, (provider) => new ADoubleWhoseStreamCanFail(provider, handles, issued, gate))

    /** ⚑ The stream under the LAST conversation started fails, and the host takes it down. */
    const itsStreamFails = async (sessionId: string): Promise<void> => {
      const handle = handles.at(-1)
      const fail = handle === undefined ? undefined : levers.get(handle)
      if (fail === undefined) throw new Error('no lever on the last start')
      fail()
      await waitFor(() => !host.sessionIds.includes(sessionId), 'the failed stream to end it')
    }

    const listing = async (pm: string): Promise<AgentToolAnswer> => {
      const tool = agentToolsFor(host, pm).tools.find((one) => one.name === 'list_questions')
      if (tool === undefined) throw new Error('no list_questions')
      // ⚑ Every question, the ended ones too: an `abandoned` entry is what these tests rule out.
      return tool.call({ state: 'all' })
    }

    it('#2 a question THIS APP raised is not “gone” when its stream fails — the answer is taken, and starts the asker', async () => {
      host = aHostWhoseStreamsCanFail()
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await itsStreamFails(worker)
      // ⚑ **The premise**: nothing ended the question — no `status` row, an `error` row instead —
      // so its row is still `open` and nobody is running to hear an answer.
      expect(REQUEST_IS_OPEN[theQuestionOf(worker).state as keyof typeof REQUEST_IS_OPEN]).toBe(
        true,
      )
      expect(
        events(worker).some(
          (event) => event.type === 'error' && event.message.includes('event stream failed'),
        ),
      ).toBe(true)

      // 🔴 **Until 675: `the-conversation-that-asked-has-gone`, `permanent`, *"never"***; until
      // D-017: `the-conversation-that-asked-has-ended`, wake it first. ⚑ **D-017 · R1/R6 — the
      // answer is a delivery, and a delivery starts its recipient**: taken, and it lands.
      const early = await answerTo(pm, requestId)
      expect(early.outcome, JSON.stringify(early)).toBe('ok')
      await waitFor(() => theAnswerReached(worker), 'the answer to start the worker and reach it')
    })

    it('#2 THE CONTROL — a question the PROVIDER raised dies with the stream, and there “never” is true', async () => {
      host = aHostWhoseStreamsCanFail()
      const { pm, worker } = await aPmAndItsWorker()
      const raised = handles.at(-1)!.simulateUserInput('which branch?', ['main', 'dev'], false, {})
      await waitFor(
        () =>
          store
            .routedRequestsOf(worker)
            .some((one) => one.requestId === raised.id && one.went.is === 'the-parent'),
        'the provider question to reach the parent',
      )
      await itsStreamFails(worker)

      const early = await answerTo(pm, raised.id)
      expect(early).toMatchObject({
        outcome: 'refused',
        rail: 'the-conversation-that-asked-has-gone',
        permanence: 'permanent',
      })
      // ⛔ …and after the same reopen the identical call still does not land: the new provider
      // never had that request. *"Retrying this will never succeed"* is the truth on this arm.
      await host.resumeSession(worker, window)
      expect((await answerTo(pm, raised.id)).rail).toBe('question-has-already-ended')
    })

    /**
     * ⛔ **#5 and its two controls retired with their subject (D-017).** They pinned which parent the
     * `the-conversation-that-asked-has-ended` rail told to wake the asker itself
     * (`THE_ASKER_IS_YOURS_TO_WAKE`), and the rail and its sentences are gone: an answer to a stopped
     * asker is taken and starts it (#2, §2.2).
     */

    it('#3 `list_questions` lists a question whose asker was closed ONCE, and open — before and after the reopen', async () => {
      // ⚑ **D-017 · R4** — a Close ends none of this app's questions, so the listing never says
      // `abandoned` about it. ⛔ Until D-017 the line read *"abandoned (the conversation that asked
      // it ended while it was waiting…)"*, and after the reopen the ledger held the id twice.
      const { pm, worker, requestId } = await aWorkerAskingItsParent()
      await host.close(worker, window)

      const statesListed = async (): Promise<string[]> => {
        const listed = await listing(pm)
        const entries = (listed.structured as { questions: { question: string; state: string }[] })
          .questions
        const lines = listed.text.split('\n')
        // One row for the question, and its own words once beneath it, with the asker to quote.
        expect(lines.filter((one) => one.startsWith(`  ${requestId} · `))).toHaveLength(1)
        const quoted = lines.filter((one) => one.includes(`quoting ${requestId} with asked_by `))
        expect(quoted).toHaveLength(1)
        expect(lines.filter((one) => one.includes(requestId))).toHaveLength(2)
        return entries.filter((one) => one.question === requestId).map((one) => one.state)
      }
      expect(await statesListed()).toEqual(['open'])

      await host.resumeSession(worker, window)
      expect(
        store.routedRequestsOf(worker).filter((one) => one.requestId === requestId),
      ).toHaveLength(1)
      expect(await statesListed()).toEqual(['open'])
    })
  })
})

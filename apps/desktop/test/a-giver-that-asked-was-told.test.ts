import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 719 · a giver that asked was told — R69 and R70
 *
 *  - **§1 · R69** (`711` F-1) — *"A notice taken back because the GIVER'S OWN act made it false (its
 *    question about the work) is recorded as a telling"*. ⚑ **D-016c — the push's own receipt is
 *    that record** (`work_stall_told`, keyed by piece): a receipt stands unless its message was
 *    abandoned, so the push the question took back still counts as told, and nothing is written
 *    beside it — no take-back writes a receipt. Before R69 the giver's slot and its ledger came
 *    apart (`711` §5, moved here and turned round):
 *    - a PUSH its question took back left the ledger with no word — the person's band listed the work
 *      beside a live giver (§1.1) — while the slot's cause kept the holder's later ending from the
 *      live giver (§1.2: *the slot follows the ledger*; since D-016c both say told, and the holder's
 *      stop tells nobody anything);
 *    - a CORRECTION its question took back, behind a stop the giver READ (§1.3, ⛔ retired with the
 *      corrections, D-016c);
 *    - on `703`'s F-C path — its own ending, a person's Reopen and Close, its own wake — the WAIT
 *      correction opened on nothing, its question's ending took it back, and the ledger fell back to
 *      its own ending: told nothing, and the same silence (§1.4, ⛔ retired with `end_agent`).
 *    ⚑ Controls: an ask that takes nothing back writes nothing (§1.5); a taking back the giver did
 *    not cause — an answer landing — writes nothing either, and the push's receipt stands (§1.6);
 *    the telling that goes straight in is seen by the receipt count (§1.7, `711` §5.3); the raw
 *    stream's line says what a stored row is (§1.8); the F-C row is written on the F-C path only —
 *    a waker that READ the ending writes none (§1.9, gone with its premise: D-017 · R4 keeps an
 *    asking worker's question open across its stop, so its stop pushes no ending to read); and a
 *    withdrawal, the giver's act too, writes none (§1.12). ⛔ **`404`'s rule** — an ending the giver
 *    asked for itself is told by its own answer (§1.10, §1.11, §1.13) — **retired with `end_agent`
 *    (D-017, commit 3)**: nothing ends a conversation now. ⚑ And `698`'s §3.1 — the pump re-sending a
 *    correction while the holder runs on the giver's question, which the withdrawn slot fix did —
 *    stays green in its own file.
 *  - **§2 · R70** (`711` F-2) — *"An answered task's row in `list_tasks` carries the answer's
 *    summary"*, so R48's *"look at it with list_tasks"* found the words the delivery could not bring;
 *    controls: an open row carries none (§2.2), and a withdrawn one none (§2.3). ⚠️ **Amended by
 *    `724` (R84)**: only a row whose answer reached nobody (`reply_undelivered`) carries them; a
 *    delivered answer's row carries no `summary` key
 *    (`small-true-words-for-the-model-and-the-lists.test.ts` §1). ⚑ **D-030 · R48's shape no longer
 *    loses the answer** (§2.1): a delivery that throws into a parent that still runs holds the words
 *    for it, so its row carries none — a row whose answer was lost is pinned by
 *    `the-words-that-were-lost-and-who-asked.test.ts` §1 (R89).
 *
 * ⚑ **On both provider shapes** — the Fake's, and Claude's silent-until-its-first-turn resume.
 * ⚠️ The shapes differ only where a conversation is RESUMED (§1.7); elsewhere the two runs are the
 * same run, which is stated rather than counted as coverage.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

describe('719 · a giver that asked was told', () => {
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
  let gate: ResumeGate
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-719-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-719-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_190_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const cardsOn = (id: string): number =>
    events(id).filter((event) => event.type === 'permission_request').length

  /** Cancel the parked turn to exercise legacy notice receipts; quiet ends use the holder ladder. */
  const letTheTurnEnd = async (id: string): Promise<void> => {
    const card = events(id)
      .filter((event) => event.type === 'permission_request')
      .at(-1) as { id: string } | undefined
    if (card === undefined) throw new Error(`${id} is not parked`)
    await host.respondPermission(id, card.id, { outcome: 'cancel' }, window)
    await letItSettle()
  }

  /** ⚑ What is HELD for a conversation, in the order it was queued. */
  const held = (id: string): string[] =>
    events(id).flatMap((event) => (event.type === 'message_queued' ? [event.text] : []))
  /** ⚑ What a conversation has READ — every turn it was handed. */
  const read = (id: string): string[] =>
    events(id).flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))
  const retractions = (id: string): number =>
    events(id).filter((event) => event.type === 'message_unqueued' && event.reason === 'retracted')
      .length
  /**
   * ⚑ The words of every receipt a conversation holds about ONE piece of work — `work_stall_told`
   * since D-016 (it was `work_reported`, keyed by task).
   */
  const receiptsAbout = (id: string, piece: string): string[] =>
    events(id).flatMap((event) =>
      event.type === 'work_stall_told' && event.piece === piece ? [event.how] : [],
    )
  /**
   * ⚑ Every notice that ONE piece of work is not being worked on, held or read — by the label it
   * names (D-016: a notice names the piece's label where it quoted the task's id). ⚑ **D-016c** — a
   * stop's is no other notice: it stalls the work on its turn's own cause, and says that.
   */
  const noticesAbout = (id: string, label: string): string[] =>
    [...held(id), ...read(id)].filter(
      (text) => text.includes('is not being worked on') && text.includes(`naming ${label}`),
    )
  /** ⚑ The person's band — the work nobody was told about, by piece. */
  const theBand = (): string[] => host.stalledWorkForAPerson().rows.map((row) => row.piece)
  const aQuestionAbout = (worker: string, piece: string): Record<string, unknown> => ({
    agent: worker,
    text: 'and the indexes?',
    kind: 'follow-up',
    piece,
  })
  /** ⚑ The rows `list_tasks` hands the conversation that gave the work out. */
  const youGaveOut = async (pm: string): Promise<Record<string, unknown>[]> =>
    ((await callOn(pm, 'list_tasks', { state: 'all' })) as { you_gave: Record<string, unknown>[] })
      .you_gave

  /**
   * ⚑ **In ONE app run, a worker parked mid-turn on the work its parent gave it**, with a person's
   * window on it — `711`'s rig. ⚑ D-016 · the give starts the worker, and its brief is the turn
   * that parks.
   */
  const aPmAndItsParkedWorker = async (): Promise<{
    pm: string
    worker: string
    piece: string
    label: string
  }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the migration',
      brief: 'migrate',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker) > 0, 'the worker to park mid-turn')
    const piece = store.piecesOwnedBy(worker)[0]?.piece
    if (piece === undefined) throw new Error('no piece')
    expect(piece).toBe(given.piece)
    return { pm, worker, piece, label: given.label as string }
  }

  describe.each([
    ['the Fake', false],
    ['Claude', true],
  ] as const)('on %s’s shape', (_shape, silent) => {
    /**
     * ⚑ **A parent MID-TURN when its child's turn ends with the work open**, so *"…is not being
     * worked on"* is HELD for it (`698` §3.2's rig) — and then it ASKS the child about the work, the
     * child takes the question up, and the push is taken back unread (`703` F-A).
     */
    const aGiverThatAskedWhileHoldingThePush = async (): Promise<{
      pm: string
      worker: string
      piece: string
      label: string
    }> => {
      const { pm, worker, piece, label } = await aPmAndItsParkedWorker()
      gate.silentUntilItsFirstTurn = silent
      await host.send(pm, 'keep an eye on the migration', window)
      await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
      await letTheTurnEnd(worker)
      await waitFor(
        () => held(pm).some((text) => text.includes('is not being worked on')),
        'the push to be held for the busy parent',
      )
      expect(receiptsAbout(pm, piece)).toEqual(['pushed'])
      const turns = cardsOn(worker)
      expect((await callOn(pm, 'message_agent', aQuestionAbout(worker, label))).outcome).toBe('ok')
      await waitFor(() => cardsOn(worker) > turns, 'the child to take the question up')
      await letItSettle()
      // ⚑ The premise: the push was taken back, unread.
      expect(retractions(pm)).toBe(1)
      expect(read(pm).filter((text) => text.includes('is not being worked on'))).toEqual([])
      return { pm, worker, piece, label }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // §1 · R69 — a notice its giver's own question made false is a telling
    // ─────────────────────────────────────────────────────────────────────────────

    describe('§1 · R69 — the giver’s own question told it', () => {
      it('ordinary ending pairs with the interrupted receipt: a failed reminder is held for its giver', async () => {
        const { pm, worker, piece } = await aPmAndItsParkedWorker()
        await host.send(pm, 'Watch the fictional work.', window)
        await waitFor(() => cardsOn(pm) > 0, 'the busy giver')
        const admission = host as unknown as { reconciliationMayWake(target: string): boolean }
        const original = admission.reconciliationMayWake.bind(host)
        vi.spyOn(admission, 'reconciliationMayWake').mockImplementation(
          (target) => target !== worker && original(target),
        )
        const card = events(worker)
          .filter((row) => row.type === 'permission_request')
          .at(-1)!
        if (card.type !== 'permission_request') throw new Error('no worker card')
        await host.respondPermission(worker, card.id, { outcome: 'allow' }, window)
        await waitFor(
          () =>
            store
              .reconciliationReceipts(worker, piece)
              .some((row) => row.step === 'giver' && row.outcome === 'delivered'),
          'the held giver receipt',
        )
        const receipt = store
          .reconciliationReceipts(worker, piece)
          .find((row) => row.step === 'giver' && row.outcome === 'delivered')!
        expect(store.reconciliationDelivery(pm, receipt.messageId!)).toBe('pending')
        expect(theBand()).not.toContain(piece)
        expect(receiptsAbout(pm, piece)).toEqual([])
        expect(
          store
            .reconciliationReceipts(worker, piece)
            .filter((row) => row.step === 'holder' && row.outcome === 'failed'),
        ).toHaveLength(1)
        expect(
          events(pm).filter(
            (row) =>
              row.type === 'message_queued' && row.appNotice === 'a-work-wait-needs-attention',
          ),
        ).toHaveLength(1)
        expect(store.piecesOwnedBy(worker)[0]).toMatchObject({
          state: 'stalled',
          stalledBecause: 'turn_ended',
        })
        expect(host.pieceBoard(pm).gave.find((row) => row.piece === piece)?.state).toBe('stalled')
      })

      /**
       * 🔴 **The subject — RED on `main`** (`711` §5.1, turned round). ⛔ There the ledger had
       * no word for the work once the push was taken back, so the person's band listed it beside a
       * live giver that had just asked about it. ⚑ Now the giver's question is a telling (R69): the
       * push's own receipt stands, with nothing written beside it (D-016c), so the band does not list
       * the work, and the giver is not pushed again when the holder's question turn stalls it.
       */
      it('§1.1 a push its question took back: the ledger says told, and the band does not list it', async () => {
        const { pm, worker, piece } = await aGiverThatAskedWhileHoldingThePush()
        // ⚑ The holder's question turn ends, with the work still open …
        await letTheTurnEnd(worker)
        await letItSettle()
        expect(store.piecesOwnedBy(worker)[0]?.state).toBe('stalled')

        // ⚑ … and neither the band nor the push is owed for it: one push was ever held …
        expect(theBand()).not.toContain(piece)
        expect(held(pm).filter((text) => text.includes('is not being worked on'))).toHaveLength(1)
        // ⚑ … because the ledger says it was told: the push's own receipt, which its question
        // took back, stands.
        expect(store.workReportedTo(pm).has(piece)).toBe(true)
        expect(receiptsAbout(pm, piece)).toEqual(['pushed'])
      })

      /**
       * 🔴 **The subject** (R69: *"the slot follows the ledger"*). ⛔ Before R69 the slot kept the
       * push's cause while the ledger held no word, so the two answered *was this giver told?*
       * differently. ⚑ Now both say told — the slot since the push, the ledger by the push's own
       * receipt — and **D-016c: a stop tells nobody anything**. So when the holder, running on the
       * giver's question, is closed, its work stalls on the turn the Close cut, nothing more is
       * pushed to the live giver, and the band does not list it.
       */
      it('§1.2 …and when the holder then stops, the live giver is not told again, and the band agrees', async () => {
        const { pm, worker, piece, label } = await aGiverThatAskedWhileHoldingThePush()
        const before = noticesAbout(pm, label)
        expect(before).toHaveLength(1)

        await host.close(worker, window)
        await waitFor(
          () => store.piecesOwnedBy(worker)[0]?.stalledBecause === 'turn_interrupted',
          'the holder’s stop to stall the work on the turn it cut',
        )
        // ⚠️ Settled, never waited on: a second push would be queued after the stall.
        await letItSettle()
        await letItSettle()

        expect(noticesAbout(pm, label)).toEqual(before)
        expect(receiptsAbout(pm, piece)).toEqual(['pushed'])
        expect(theBand()).not.toContain(piece)
      })

      /**
       * ⛔ **§1.3 retired with the corrections (D-016c).** It measured a CORRECTION — the one a
       * person's Reopen held behind the stop the giver had read — taken back by the giver's
       * question, and then the holder's second stop, which the stopped giver had to be started and
       * told. ⚑ A reopen sends no correction and a stop tells nobody anything, so neither half has a
       * subject left; R69's word in the ledger is §1.1's, and a stall told to a stopped giver is
       * §1.7's.
       */

      /**
       * ⛔ **§1.4 retired with `end_agent` (D-017, commit 3).** It measured `703`'s F-C path, which
       * began with the parent ENDING its child itself (told nothing, `its-own-ending`); nothing ends a
       * conversation now, so that path has no first step.
       */

      /**
       * ⚑ **The control — an ask that takes nothing back writes nothing** (R69: *"a notice taken
       * back"*). The giver READ the push, then asked: nothing was held to take back, so the push's
       * own receipt stands and nothing is written beside it.
       */
      it('§1.5 an ask after the push was READ takes nothing back, and writes nothing', async () => {
        const { pm, worker, piece, label } = await aPmAndItsParkedWorker()
        await letTheTurnEnd(worker)
        await waitFor(
          () => read(pm).some((text) => text.includes('is not being worked on')),
          'the push to be read by the idle parent',
        )
        const turns = cardsOn(worker)
        expect((await callOn(pm, 'message_agent', aQuestionAbout(worker, label))).outcome).toBe(
          'ok',
        )
        await waitFor(() => cardsOn(worker) > turns, 'the child to take the question up')
        await letItSettle()

        expect(retractions(pm)).toBe(0)
        expect(receiptsAbout(pm, piece)).toEqual(['pushed'])
        expect(store.workReportedTo(pm).has(piece)).toBe(true)
      })

      /**
       * ⚑ **The control — a taking back the giver did NOT cause**. ⚑ The child's answer lands and
       * takes the held push back (`703`'s `'answered'`). ⚑ **D-016c** — every take-back is alike: the
       * fact chooses only the words, nothing is written beside the push, and the push's own receipt
       * stands; the work is closed, so it is owed nothing either way.
       */
      it('§1.6 an answer that takes the push back writes nothing, and the push’s receipt stands', async () => {
        const { pm, worker, piece, label } = await aPmAndItsParkedWorker()
        await host.send(pm, 'keep an eye on the migration', window)
        await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
        await letTheTurnEnd(worker)
        await waitFor(
          () => held(pm).some((text) => text.includes('is not being worked on')),
          'the push to be held for the busy parent',
        )
        const turns = cardsOn(worker)
        await host.send(worker, 'please finish it', window)
        await waitFor(() => cardsOn(worker) > turns, 'the child to take the person’s message up')
        expect(
          await callOn(worker, 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'the migration is finished',
          }),
        ).toMatchObject({ outcome: 'ok' })
        await letItSettle()

        expect(retractions(pm)).toBe(1)
        expect(receiptsAbout(pm, piece)).toEqual(['pushed'])
        expect(store.workReportedTo(pm).has(piece)).toBe(true)
      })

      /**
       * ⚑ **The telling that goes straight in is seen by the receipt count** (`711` §5.3), though it
       * is sent rather than held. ⚑ **D-017 · R1** — a stall in this run is a delivery, and it
       * starts the stopped giver itself: the telling goes straight into that start. ⚑ **D-016c** —
       * the giver is closed first, then the holder mid-turn, so the holder's stop stalls the work on
       * the turn it cut, and that stall is what the giver is told.
       */
      it('§1.7 a stall while the giver is stopped: the notice starts the giver and tells it, and the count sees it', async () => {
        const { pm, worker, piece, label } = await aPmAndItsParkedWorker()
        gate.silentUntilItsFirstTurn = silent
        await host.close(pm, window)
        await host.close(worker, window)
        await waitFor(() => receiptsAbout(pm, piece).length > 0, 'the giver to be told')
        expect(receiptsAbout(pm, piece)).toEqual(['pushed'])
        await waitFor(
          () =>
            read(pm).filter(
              (text) => text.includes('is not being worked on') && text.includes(`naming ${label}`),
            ).length === 1,
          'the giver, started by the notice, to read it',
        )
        expect(store.piecesOwnedBy(worker)[0]?.stalledBecause).toBe('turn_interrupted')
        expect(theBand()).not.toContain(piece)
      })

      // ⚑ **D-017 · R4 — §1.9 went with its premise.** It was *"a waker that READ the ending writes
      // no its-own-wake beside its WAIT correction"*: a worker ASKING its parent was closed, and the
      // parent read *"has ended"*. ⛔ An asking worker's question survives its stop now, so the work
      // waits on an answer and the stop pushes the parent nothing — there is no ending to read
      // (`the-wakes-last-stale-sentences.test.ts` §2.1 pins that). ⚠️ `719`'s M6 named it as its
      // killer.

      /**
       * ⛔ **§1.10, §1.11 and §1.13 retired with `end_agent` (D-017, commit 3).** Each ended the
       * holder by the giver's own `end_agent` — `404`'s rule that an agent which ends a conversation
       * was told by its own answer (`its-own-ending`), after its question, after a correction it READ,
       * and behind one still HELD. ⚑ Nothing ends a conversation now, and an agent cannot stop one it
       * gave work to, so no stop is the giver's own act.
       */

      /**
       * ⚑ **The control — a WITHDRAWAL is the giver's act too, and writes no `its-own-question`**
       * (`719`'s review). R69 names the question; the withdrawal closes the work, which is owed
       * nothing: the push is taken back and nothing is written beside it (D-016c: no take-back writes
       * a receipt).
       */
      it('§1.12 a withdrawal that takes the push back writes no its-own-question', async () => {
        const { pm, worker, piece, label } = await aPmAndItsParkedWorker()
        await host.send(pm, 'keep an eye on the migration', window)
        await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
        await letTheTurnEnd(worker)
        await waitFor(
          () => held(pm).some((text) => text.includes('is not being worked on')),
          'the push to be held for the busy parent',
        )
        const withdrawn = await callOn(pm, 'withdraw_task', { piece: label })
        expect(withdrawn.outcome, JSON.stringify(withdrawn)).toBe('ok')
        await letItSettle()

        expect(retractions(pm)).toBe(1)
        expect(receiptsAbout(pm, piece)).toEqual(['pushed'])
      })

      /**
       * ⚑ **The raw stream says what a stored row is** — `describe-event.ts`, the one renderer file
       * R69 owed: the app told it nothing, its own question did. ⚑ **D-016c** — nothing writes
       * `its-own-question` or `set-right` now, and a ledger written before it still holds them, so
       * the Events tab still draws both. ⚑ Control: `set-right`'s line is unchanged, so the member
       * did not fall through to *"started again"*, which it is not.
       */
      it('§1.8 the Events tab reads its-own-question as the giver’s own act, not as a correction', () => {
        expect(
          describeEvent({ type: 'work_stall_told', piece: 'work_1', how: 'its-own-question' }),
        ).toBe(
          'work_1 · told nothing: it asked that conversation about the work itself · its-own-question (ours)',
        )
        expect(describeEvent({ type: 'work_stall_told', piece: 'work_1', how: 'set-right' })).toBe(
          'work_1 · told: that conversation was started again · set-right (ours)',
        )
      })
    })

    // ─────────────────────────────────────────────────────────────────────────────
    // §2 · R70 — the pointer leads to the words
    // ─────────────────────────────────────────────────────────────────────────────

    describe('§2 · R70 — list_tasks carries the answer’s words', () => {
      /**
       * 🔴 **The subject — RED on `main`** (`711` F-2). ⚑ R48's shape: the parent holds the push about
       * the work and a person's work message, and the child answers — the answer's delivery fails
       * (D-010: a busy parent holds it now, so a throw on the way in stands in) and the push was
       * replaced by *"…was answered, but the answer could not be delivered to you: look at it with
       * list_tasks"*. ⛔ There `list_tasks` showed `answered` and the outcome and not the words.
       * ⚑ **D-030 — the words now reach the parent themselves**: the delivery that threw holds them
       * in its mailbox (`held`), no line points anywhere, and — R84 — the row carries no words.
       */
      it('§2.1 an answer whose delivery threw is held for the parent: its words go to it, not onto the row', async () => {
        const { pm, worker, piece, label } = await aPmAndItsParkedWorker()
        await host.send(pm, 'keep an eye on the migration', window)
        await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
        await letTheTurnEnd(worker)
        await waitFor(
          () => held(pm).some((text) => text.includes('is not being worked on')),
          'the push to be held for the busy parent',
        )
        expect((await host.queueMessage(pm, 'and the backups', window)).outcome).toBe('queued')
        const turns = cardsOn(worker)
        await host.send(worker, 'please finish it', window)
        await waitFor(() => cardsOn(worker) > turns, 'the child to take the person’s message up')
        // ⚑ **D-010** — a busy parent HOLDS an answer now, so R48's shape is an answer whose delivery
        // THREW on the way in: its own delivery fails, once — ⚑ and since D-030 it is held all the same.
        const deliver = host.queueMessage.bind(host)
        host.queueMessage = (async (...args: Parameters<RuntimeHost['queueMessage']>) => {
          if (args[2] === THE_APP_ITSELF && args[1].includes('the migration is finished')) {
            host.queueMessage = deliver
            throw new Error('the way in failed')
          }
          return deliver(...args)
        }) as RuntimeHost['queueMessage']
        expect(
          await callOn(worker, 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'the migration is finished; the indexes are rebuilt',
          }),
        ).toMatchObject({ outcome: 'ok', delivered: 'held' })
        await letItSettle()
        // ⚑ The premise: the parent holds the answer's own words, once, and no line about them.
        expect(
          held(pm).filter((text) =>
            text.includes('the migration is finished; the indexes are rebuilt'),
          ),
        ).toHaveLength(1)
        expect(held(pm).filter((text) => text.includes('could not be delivered'))).toEqual([])

        const [row] = await youGaveOut(pm)
        expect(row).toMatchObject({ piece, state: 'answered', outcome: 'done' })
        expect(row).not.toHaveProperty('summary')

        // ⚑ Answered, and its answer still held for its busy giver: the board lists it by default,
        // and says why, until the words go in.
        const board = await callOn(pm, 'list_tasks', {})
        expect(
          (board['you_gave'] as Record<string, unknown>[]).find((one) => one['piece'] === piece),
        ).toMatchObject({ state: 'answered', answer_not_read: 'held-for-you' })
      })

      /** ⚑ **The control — an open row carries no words**: nothing has answered it. */
      it('§2.2 an open row carries none', async () => {
        const { pm, piece } = await aPmAndItsParkedWorker()

        const [row] = await youGaveOut(pm)
        expect(row).toMatchObject({ piece })
        expect(row?.state).not.toBe('answered')
        expect(row?.summary ?? null).toBeNull()
      })

      /** ⚑ **The control — a withdrawn row carries none**: the parent closed it, and nobody answered. */
      it('§2.3 a withdrawn row carries none', async () => {
        const { pm, worker, piece, label } = await aPmAndItsParkedWorker()
        await letTheTurnEnd(worker)
        const withdrawn = await callOn(pm, 'withdraw_task', { piece: label })
        expect(withdrawn.outcome, JSON.stringify(withdrawn)).toBe('ok')
        await letItSettle()

        const [row] = await youGaveOut(pm)
        expect(row).toMatchObject({ piece, state: 'withdrawn' })
        expect(row?.summary ?? null).toBeNull()
      })
    })
  })
})

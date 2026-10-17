import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { isGiverStallNotice, RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  theMessagesOf,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 711 · a notice that cannot be true is replaced — R48, R49, R54, and `701` F-1
 *
 *  - **§1 · R48** (`703` F-A1) — a child's answer is not delivered (a busy parent holding a work
 *    message refused it until D-010; since then its delivery throwing on the way in is what is left),
 *    and the parent still holds *"…It has not been answered. Look at it with list_tasks"*.
 *    ⚑ **Ruled: replaced by ONE true line** — answered, not delivered, `list_tasks` shows it — never
 *    kept (false) and never taken back with nothing in its place. ⛔ **D-030 retired the line with
 *    its subject** (§1.3–§1.6): a delivery that throws into a parent that still runs HOLDS the
 *    answer in its mailbox, as a busy parent's is held, so the answer lands and the push is taken
 *    back as any landed answer takes it back (§1.1).
 *    ⚑ Control: an answer whose delivery did not throw (§1.2).
 *  - **§2 · R49** (`703` F-A2) — after a PERSON's Reopen the parent held *"has ended"* and the
 *    correction behind it, *"…started again after you were told it had stopped. It is waiting: …
 *    nobody has answered"*; its own answer made the second line false, and R49 ruled it replaced by
 *    one line true at that moment. ⛔ **D-017 · R4 retired those cases** (§2.1, §2.3–§2.7): a Close
 *    no longer ends an asking worker's question, so its parent is told nothing and a Reopen sets
 *    nothing right. ⚑ Kept: the waker's own shape, which opened on nothing, is still taken back with
 *    nothing in its place (§2.2, `703` §1.11) — reached now on `703`'s F-C path.
 *  - **§3 · R54's main half** (`702` F-5) — the band's row carried a mark for a giver told *started
 *    again* or *still open*. ⛔ **D-016c retired it whole**: a stop, a reopen and a start tell
 *    nobody anything, so neither notice is sent and the row carries no mark.
 *  - **§4 · `701` F-1, retired by D-017b** — the forest's conversation node and both ends of a
 *    spawn edge carried the rail's kept-open fact (so did the project's list, gone at D-016); D-017b took the open/closed split
 *    out of the window, so every list now carries `running` and no kept-open word, and a
 *    conversation the quit stopped reads as one a person closed.
 *  - **§5 · moved** — `711`'s finding (a notice taken back because the giver ASKED about the work
 *    left the giver's slot and its ledger apart) was pinned here as measurements, and PM ruling R69
 *    repaired it: `a-giver-that-asked-was-told.test.ts` §1 holds them now, turned round.
 *
 * ⚑ **On both provider shapes** — the Fake's, and Claude's silent-until-its-first-turn resume.
 * ⚠️ The shapes differ only where a conversation is RESUMED (a person's start after a relaunch,
 * §4.2); where nothing is resumed the two runs are the same run, which is stated rather than counted
 * as coverage (`711`'s review).
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

describe('711 · a notice that cannot be true is replaced', () => {
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

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-711-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-711-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_110_000
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

  /** ⛔ `646` §2's restart — a graceful quit, then a new host over a new `SessionStore` object. */
  const quitAndRelaunch = async (): Promise<void> => {
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
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

  /** ⚑ Let the turn a conversation is parked in end — the person answers its last card. */
  const letTheTurnEnd = async (id: string): Promise<void> => {
    const card = events(id)
      .filter((event) => event.type === 'permission_request')
      .at(-1) as { id: string } | undefined
    if (card === undefined) throw new Error(`${id} is not parked`)
    await host.respondPermission(id, card.id, { outcome: 'allow' }, window)
    await letItSettle()
  }

  /** ⚑ What is HELD for a conversation, in the order it was queued. */
  const held = (id: string): string[] =>
    events(id).flatMap((event) => (event.type === 'message_queued' ? [event.text] : []))
  /**
   * ⚑ What a conversation has READ — every turn it was handed, as the words of each message in it.
   * 🔴 **D-027 moved where a message sits**: what was held goes out as ONE turn, whose `parts` are
   * the messages and whose own `text` is their words joined — so a turn is read through
   * `theMessagesOf`, as the product's readers read it, and never as one run of words.
   */
  const turnsRead = (id: string): string[][] =>
    events(id).flatMap((event) =>
      event.type === 'user_turn' ? [theMessagesOf(event).map((message) => message.text)] : [],
    )
  /** ⚑ …and every message it read, oldest first, whichever turn carried it. */
  const read = (id: string): string[] => turnsRead(id).flat()
  const unqueued = (pm: string): { reason: string; text: string; detail?: string }[] =>
    events(pm).flatMap((event) =>
      event.type === 'message_unqueued'
        ? [
            {
              reason: event.reason,
              text: event.text,
              ...(event.detail === undefined ? {} : { detail: event.detail }),
            },
          ]
        : [],
    )
  /** ⚑ The report a HELD message carries — what a person's transcript draws its entry from. */
  const reportHeldWith = (id: string, says: RegExp): unknown =>
    events(id).flatMap((event) =>
      event.type === 'message_queued' && says.test(event.text) ? [event.work] : [],
    )[0]
  /** ⚑ A push about undriven work, as the parent READ it (`400`'s notice). */
  const pushesRead = (pm: string): string[] => read(pm).filter((text) => isGiverStallNotice(text))

  const TAKEN_BACK_ANSWERED =
    /^taken back by this app before it was read, because it was no longer true: .+ answered that work$/

  /**
   * ⚑ **In ONE app run, a worker parked mid-turn on the work its parent gave it**, with a person's
   * window on it — `what-a-waker-reads-after-its-own-act.test.ts`' rig. ⚑ D-016 · the give starts
   * the worker, and its brief is the turn that parks.
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
     * worked on"* is HELD for it (`698` §3.2's rig).
     */
    const aBusyParentHoldingThePush = async (): Promise<{
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
        () => held(pm).some((text) => isGiverStallNotice(text)),
        'the push to be held for the busy parent',
      )
      return { pm, worker, piece, label }
    }

    /**
     * ⚑ **D-010 · an answer that could not be delivered, made so at the one door left.** Until
     * D-010 a busy parent already holding a message refused it (`parent-is-holding-a-message`); a
     * busy parent holds it now, so the one failure left is a delivery that THROWS on the way in —
     * ⚑ **and since D-030 that one is held too**, in the parent's mailbox while it runs (`held`).
     * ⚠️ One-shot, and only the answer's own delivery: everything else still goes through the real
     * door.
     */
    const theAnswersDeliveryFails = (): void => {
      const deliver = host.queueMessage.bind(host)
      let armed = true
      host.queueMessage = (async (...args: Parameters<RuntimeHost['queueMessage']>) => {
        if (armed && args[2] === THE_APP_ITSELF && args[1].includes('the migration is finished')) {
          armed = false
          throw new Error('the way in failed')
        }
        return deliver(...args)
      }) as RuntimeHost['queueMessage']
    }

    /** ⚑ The child answers the work while its parent already holds a person's work message. */
    const theChildAnswersBehindAPersonsMessage = async (
      pm: string,
      worker: string,
      label: string,
    ): Promise<void> => {
      expect((await host.queueMessage(pm, 'and the backups', window)).outcome).toBe('queued')
      const turns = cardsOn(worker)
      await host.send(worker, 'please finish it', window)
      await waitFor(() => cardsOn(worker) > turns, 'the child to take the person’s message up')
      theAnswersDeliveryFails()
      expect(
        await callOn(worker, 'reply_to_parent', {
          piece: label,
          outcome: 'done',
          summary: 'the migration is finished',
        }),
      ).toMatchObject({ outcome: 'ok', delivered: 'held' })
      await letItSettle()
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // §1 · R48, retired by D-030 — an answer whose delivery failed is held
    // ─────────────────────────────────────────────────────────────────────────────

    describe('§1 · R48, retired by D-030 — an answer whose delivery failed is held', () => {
      /**
       * 🔴 **The subject — RED on `main`** (`703` §1.8, pinned there as a measurement pending the
       * ruling). ⛔ `main` left *"It has not been answered"* standing about answered work. ⚑ R48 put
       * ONE true line in its place; ⚑ **D-030 — the answer is held instead**: its delivery threw and
       * the parent still runs, so the words wait in its mailbox like any held reply (`held`). The
       * push is taken back under `retracted`, saying why, and the parent reads the person's words,
       * then the answer, and never the push.
       */
      it('§1.1 a delivery that threw holds the answer, and the push is taken back as for any landed answer', async () => {
        const { pm, worker, piece, label } = await aBusyParentHoldingThePush()
        await theChildAnswersBehindAPersonsMessage(pm, worker, label)

        // ⚑ Taken back, saying why — never silently.
        expect(unqueued(pm)).toMatchObject([
          {
            reason: 'retracted',
            text: expect.stringContaining('still needs attention:'),
            detail: expect.stringMatching(TAKEN_BACK_ANSWERED),
          },
        ])
        // ⚑ …and the answer itself held in its place, once — no line ABOUT it.
        const theAnswer = held(pm).filter((text) => text.includes('the migration is finished'))
        expect(theAnswer).toHaveLength(1)
        expect(held(pm).filter((text) => text.includes('could not be delivered'))).toEqual([])
        expect(events(worker).some((event) => event.type === 'reply_undelivered')).toBe(false)
        // ⚑ The entry drawn beside it says what the words say: answered, and how.
        expect(reportHeldWith(pm, /the migration is finished/)).toMatchObject({
          piece,
          label,
          state: 'answered',
          outcome: 'done',
        })

        // ⚑ The person's words, then the answer — and never the push. 🔴 D-027: both are read in
        // ONE turn of everything held, after this one, oldest first.
        await letTheTurnEnd(pm)
        await waitFor(
          () => read(pm).some((text) => text.includes('the migration is finished')),
          'the held answer to be read',
        )
        const together = turnsRead(pm).at(-1) ?? []
        expect(together).toHaveLength(2)
        expect(together[0]).toBe('and the backups')
        expect(together[1]).toContain('the migration is finished')
        expect(pushesRead(pm)).toEqual([])
        // ⚑ **And the piece is true while the answer waits**: `list_tasks` shows it answered, and how.
        const listed = (await callOn(pm, 'list_tasks', { state: 'all' })) as {
          you_gave: { piece: string; state: string; outcome: string }[]
        }
        expect(listed.you_gave.find((one) => one.piece === piece)).toMatchObject({
          state: 'answered',
          outcome: 'done',
        })
      })

      /**
       * ⚑ **The control — an answer that LANDED is its own true line**: no second one is sent.
       * ⚑ D-030 · one fact over from §1.1 — its delivery does not throw, and it is held the same.
       */
      it('§1.2 an answer that lands takes the push back and adds no line of its own', async () => {
        const { pm, worker, label } = await aBusyParentHoldingThePush()
        const turns = cardsOn(worker)
        await host.send(worker, 'please finish it', window)
        await waitFor(() => cardsOn(worker) > turns, 'the child to take the person’s message up')
        expect(
          await callOn(worker, 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'the migration is finished',
          }),
        ).toMatchObject({ outcome: 'ok', delivered: 'held' })
        await letItSettle()
        expect(unqueued(pm).map((one) => one.reason)).toEqual(['retracted'])
        expect(held(pm).filter((text) => text.includes('could not be delivered'))).toEqual([])
      })

      /**
       * ⛔ **§1.3–§1.6 retired with R48's line (D-030).** Each measured where the line was sent or
       * not: nothing held about the work (§1.3), a push read while the answer landed (§1.4), a push
       * held only after it landed (§1.5), and the line handed on at a Close with no second loss
       * recorded (§1.6, `729`). ⚑ An answer whose delivery fails is now held for its giver — in its
       * mailbox while it runs, else kept for its next start — so no line is ever composed, and what
       * the push said is taken back as any landed answer takes it back (`703`).
       */
    })

    // ─────────────────────────────────────────────────────────────────────────────
    // §2 · R49 — after a person's Reopen, the question ends
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * ⛔ **§2 retired whole (D-017).** §2.1 and §2.3–§2.7 went with R4: each held a WAIT correction a
     * PERSON's Reopen queued behind *"has ended"* — an asking worker's Close abandoned its question,
     * the Reopen brought it back, and the correction said *"It is waiting"*. ⚑ A Close ends no
     * question now, so an asking worker's parent is told nothing by it (the work still waits on the
     * parent) and a Reopen has nothing to set right. ⚑ §2.2, the waker's own correction that opened
     * on NOTHING, went with commit 3: it was reached only on `703`'s F-C path, which began with the
     * parent's own `end_agent` (told nothing: `its-own-ending`), and nothing ends a conversation now.
     */

    // ─────────────────────────────────────────────────────────────────────────────
    // §3 · R54 — what the band's row said its giver was told, retired by D-016c
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * ⛔ **§3 retired whole (D-016c).** R54 marked the band's row for a giver told *"that
     * conversation was started again"* (`toldItStartedAgain`) or *"it is still open"*
     * (`toldItWasStillOpen`), and §3.5 measured the mark beside `holderKeptOpen` after a quit. ⚑ A
     * stop, a reopen and a start now tell nobody anything, so neither notice is ever sent, and the
     * band's row carries no mark: a giver was told once, when its work stalled, or it was not told
     * and the band lists the work (`work-that-stalls-with-nobody-to-tell.test.ts`).
     */

    // ─────────────────────────────────────────────────────────────────────────────
    // §4 · `701` F-1, retired by D-017b — no list splits open from closed
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Every list carries `running` without an open/closed or kept-open distinction. A
     * conversation stopped by quit and one closed by a person read the same everywhere;
     * starting either updates every list.
     */
    describe('§4 · `701` F-1, D-017b — every list draws a conversation the same way, with no kept-open word', () => {
      /**
       * ⚑ What each of the three readers carries for one conversation: its `running`, or why not.
       * ⚑ **D-016** took the fourth, the project's list, out with projects.
       */
      const whatEachListSays = (
        parent: string,
        id: string,
      ): { forest: unknown; edge: unknown; rail: unknown } => {
        const inTheForest = host
          .theWholeForest()
          .nodes.rows.find((node) => node.node === 'a-conversation' && node.conversation === id)
        const asAnEdge = host
          .whoCalledWhom(parent)
          .children.rows.find((edge) => edge.conversation === id)
        const onTheRail = host.resumableSessions().find((one) => one.sessionId === id)
        const said = (row: unknown): unknown =>
          row === undefined
            ? 'absent'
            : 'keptOpenAcrossAQuit' in (row as object)
              ? 'a kept-open word'
              : (row as { running?: unknown }).running
        return {
          forest: said(inTheForest),
          edge: parent === id ? 'n/a' : said(asAnEdge),
          rail: said(onTheRail),
        }
      }

      /**
       * 🔴 **The subject**: before D-017b each list carried `keptOpenAcrossAQuit: true` here — the
       * split the window no longer draws. ⚑ Listed in all three (non-vacuity: never `absent`), with no
       * word beside `running`.
       */
      it('§4.1 a conversation the quit stopped is in all three lists, with no kept-open word', async () => {
        const { pm, worker } = await aPmAndItsParkedWorker()
        gate.silentUntilItsFirstTurn = silent
        await quitAndRelaunch()
        expect(whatEachListSays(pm, worker)).toEqual({
          forest: 'not-running',
          edge: 'not-running',
          rail: 'not-running',
        })
        // ⚑ …and the edge's OTHER end: the child's own read names its parent, with no word either.
        const parent = host.whoCalledWhom(worker).parent
        expect(parent).toMatchObject({ running: 'not-running' })
        expect(parent).not.toHaveProperty('keptOpenAcrossAQuit')
      })

      /**
       * ⚑ **The controls**: a conversation a person CLOSED before the quit reads exactly as one the
       * quit stopped — and a start moves every list at once, so `running` is a live answer there.
       */
      it('§4.2 a closed conversation reads as a quit-stopped one, and a started one moves every list', async () => {
        const { pm, worker } = await aPmAndItsParkedWorker()
        await host.close(worker, window)
        gate.silentUntilItsFirstTurn = silent
        await quitAndRelaunch()
        expect(whatEachListSays(pm, worker)).toEqual({
          forest: 'not-running',
          edge: 'not-running',
          rail: 'not-running',
        })
        expect(whatEachListSays(pm, pm)).toMatchObject({
          forest: 'not-running',
          rail: 'not-running',
        })
        // ⚑ A person's start (what their message runs) — the positive control: every list moves.
        await host.resumeSession(pm, window)
        expect(host.whoCalledWhom(worker).parent).toMatchObject({ running: 'in-a-window' })
        expect(whatEachListSays(pm, pm)).toEqual({
          forest: 'in-a-window',
          edge: 'n/a',
          rail: 'in-a-window',
        })
      })
    })
  })
})

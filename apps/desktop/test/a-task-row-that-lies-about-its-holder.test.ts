import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { undrivenSentence } from '../src/shared/tasks'
import type { RuntimeEventMessage, UnqueuedMessageEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **648 · a task row that lies about its holder.**
 *
 * ⛔ **Three findings from three seats, and they are one subject**: `list_tasks` is the only
 * agent-facing reader on the LEDGER side of the line — every other one is bounded by the slot map
 * — so it is the only place a stale ledger fact and a live slot fact sit in the same row.
 *
 * > **What a task row promises, stated once:** every field on it must be true AT THE MOMENT IT IS
 * > READ, and a `stalledBecause` must be true of EVERY producer of that cause. A row that was true
 * > when it was written and is false when it is read is the defect all three findings are faces of.
 *
 *  - **§1 · A** (`643` F1) — a queued WORK message hit by a Claude sign-in rotation was left in the
 *    mailbox on a promise of *another attempt at the next turn boundary* that the latch makes
 *    impossible, so the row said `waiting` / `stalled_because: null` while nothing could move.
 *    ⚑ Now the app keeps that promise another way: it reopens the holder on the current sign-in,
 *    and the held work goes there.
 *  - **§2 · B** (`646` F1) — a person's Close then Reopen left `conversation_ended` standing over a
 *    conversation that is idle and answering. ⚑ **D-016c** — a stop no longer writes a cause at
 *    all, so there is nothing for a reopen to put back: §2 measures that a Close and a Reopen each
 *    leave the piece on its own turn's cause.
 *  - **§3 · C** (`D28`) — `given_to_is: null` folds *the slot is gone* and *you cannot see it*, and
 *    §3 is where that fold is read against the ledger field beside it.
 *
 * ⚑ **D-016 · the tree** — a task is a PIECE now, handed out with `give_work`, and a holder may hold
 * more than one: every row below is read by its label. The give's brief is the holder's first turn,
 * so the brief that must be HELD in §1 is a second give's, to the same conversation.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real rails.** The only double is the
 * provider, and it is subclassed to keep the toolsets the HOST handed each launch and to give the
 * Claude handle the one state `FakeRuntime` cannot otherwise inhabit — a latched sign-in
 * supersession, which is `a-parent-that-survives-a-restart.test.ts`' own double, copied for the
 * same reason.
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

/** ⛔ The provider double: it keeps every toolset, and it can move the machine credential. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    private readonly runningProvider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
    private readonly credentialGeneration: () => number,
  ) {
    super(runningProvider, { sessions })
  }
  /**
   * ⛔ **The real Claude handle remembers the credential it opened with and LATCHES** when a later
   * turn sees a different one; the slot stays live and `status()` stays idle, and only the turn
   * gate refuses. ⚑ Codex has no such check, so the double leaves both members absent there — which
   * is what makes §1 a Claude-only story and says so.
   */
  private watch(handle: FakeSessionHandle): FakeSessionHandle {
    if (this.runningProvider !== 'claude') return handle
    const openedWith = this.credentialGeneration()
    let superseded = false
    Object.defineProperties(handle, {
      signInSuperseded: { get: () => superseded, configurable: true },
      checkSignIn: {
        value: async () => {
          if (this.credentialGeneration() !== openedWith) superseded = true
          return superseded
        },
        configurable: true,
      },
    })
    return handle
  }
  override async start(options: Parameters<FakeRuntime['start']>[0]) {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return this.watch(handle as FakeSessionHandle)
  }
  override async resume(
    ref: Parameters<FakeRuntime['resume']>[0],
    options: Parameters<FakeRuntime['resume']>[1],
  ) {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return this.watch(handle as FakeSessionHandle)
  }
}

describe('648 · a task row that lies about its holder', () => {
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let userData: string
  let root: string
  let counter: number
  let clock: number
  let window: RecordingSink
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let credentialGeneration: number
  let hosts: RuntimeHost[]
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ToolWatchingRuntime(provider, handed, issued, () => credentialGeneration),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-648-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-648-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    hosts = []
    issued = new FakeProviderSessions()
    credentialGeneration = 0
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }
  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
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
  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }
  /** ⚑ **D-016** — one piece on its holder, by its label: a holder can hold more than one now. */
  const thePiece = (holder: string, label: string): { state: string; because: string | null } => {
    const row = store.piecesOwnedBy(holder).find((one) => one.label === label)
    if (row === undefined) throw new Error(`no piece ${label} on ${holder}`)
    return { state: row.state, because: row.stalledBecause }
  }
  const rowTheGiverReads = async (
    giverTools: AgentToolset,
    holder: string,
    label: string,
  ): Promise<Record<string, unknown>> => {
    const listed = (await callOn(giverTools, 'list_tasks', {})) as {
      you_gave: Record<string, unknown>[]
    }
    const row = listed.you_gave.find((one) => one.label === label && one.owner === holder)
    if (row === undefined) throw new Error(`no row naming ${label} on ${holder}`)
    return row
  }
  const endingsOn = (holder: string): UnqueuedMessageEvent[] =>
    store
      .events(holder)
      .map((entry) => entry.event)
      .filter((event): event is UnqueuedMessageEvent => event.type === 'message_unqueued')

  /** ⚑ The permission cards a holder's own ledger holds, newest last. */
  const cardsOn = (holder: string): string[] =>
    store
      .events(holder)
      .map((entry) => entry.event)
      .flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  /**
   * ⛔ **A PM and a worker its give started, with the worker PARKED on a permission card** — which
   * is the only way a brief queues rather than sends. ⚑ **D-016** — the first give's brief is the
   * worker's first turn and it is what parks on the card (a conversation a give starts runs in its
   * GIVER's mode, so the PM is in 'ask'); the one-open-task rail is gone, so the brief that must be
   * HELD is a second give's, to the same conversation, and the first piece is not the one read.
   */
  const aWorkerParkedOnACard = async (): Promise<{
    pmTools: AgentToolset
    worker: string
    cardId: string
  }> => {
    await bringIdentityIntoBeing('worker')
    await personOpens('pm', 'ask')
    const pmTools = theToolsetJustHandedOut()
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The first piece',
      brief: 'are you there',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    // ⚠️ **Claimed, because an agent-started conversation is born with no sink** — its cards go
    // nowhere until a window takes it over, which is also why `host.close` refuses it otherwise.
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker).length > 0, 'the worker to park on a card')
    const card = cardsOn(worker).at(-1)
    if (card === undefined) throw new Error('no card')
    return { pmTools, worker, cardId: card }
  }

  /** ⚑ **D-016** — the second give, to the conversation parked above, and the piece it opened. */
  const giveTheThing = async (pmTools: AgentToolset, worker: string): Promise<string> => {
    const gave = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The thing',
      brief: 'do the thing',
    })
    // ⚑ **The premise, asserted rather than assumed**: it really was HELD, not sent — and it
    // reached the same conversation.
    expect(gave).toMatchObject({ outcome: 'ok', agent: worker, delivery: 'held' })
    return gave.label as string
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · A — the flush that could never succeed, and now says so
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a queued WORK message whose sign-in moved', () => {
    it('🔴 §1.1 the flush leaves it held, and it goes in the life this app reopens on the current sign-in', async () => {
      const { pmTools, worker, cardId } = await aWorkerParkedOnACard()
      const label = await giveTheThing(pmTools, worker)
      expect(thePiece(worker, label)).toEqual({ state: 'waiting', because: null })

      // The machine sign-in moves while the brief waits.
      credentialGeneration++
      // Answering the card ends the turn, which is what wakes the flush.
      await host.respondPermission(worker, cardId, { outcome: 'deny' }, window)
      await waitFor(() => endingsOn(worker).length > 0, 'the held brief to go')

      // 🔴 **The repair, a second time.** Before 648 this row read `waiting` / `null` for the whole
      // life of the conversation; 648 ended the brief unsent. ⚑ Now the flush leaves it held, and
      // once the holder is free this app reopens it on the current sign-in, where it goes first.
      const endings = endingsOn(worker)
      expect(endings).toHaveLength(1)
      expect(endings[0]).toMatchObject({ reason: 'sent', text: 'do the thing' })
      const ledger = store.events(worker).map((entry) => entry.event)
      expect(ledger).toContainEqual({ type: 'reopened', because: 'the-sign-in-moved-on' })
      expect(ledger.findIndex((event) => event.type === 'reopened')).toBeLessThan(
        ledger.findIndex((event) => event.type === 'message_unqueued'),
      )
      expect(thePiece(worker, label).because).not.toBe('message_never_sent')
      expect(['working', 'stalled']).toContain(thePiece(worker, label).state)
      // ⚠️ **And the row the GIVER reads never said it was never sent.**
      const row = await rowTheGiverReads(pmTools, worker, label)
      expect(row.stalled_because).not.toBe('message_never_sent')
    })

    it('⚑ §1.2 THE CONTROL — the identical flush with the sign-in UNMOVED still delivers', async () => {
      // 🔴 **Rule 12, and rule 20's *a rule is proven by violating it***: every line of §1.1 is the
      // same except the one that moves the credential. ⛔ Without this, §1.1 would pass just as
      // well over a flush that had stopped delivering anything at all.
      const { pmTools, worker, cardId } = await aWorkerParkedOnACard()
      const label = await giveTheThing(pmTools, worker)
      expect(thePiece(worker, label)).toEqual({ state: 'waiting', because: null })

      // ⚑ **The one difference: nothing moves.**
      await host.respondPermission(worker, cardId, { outcome: 'deny' }, window)
      await waitFor(() => thePiece(worker, label).state !== 'waiting', 'the flush to run')

      // ⛔ **It WENT**, and the ending says `sent` rather than `abandoned`.
      const endings = endingsOn(worker)
      expect(endings).toHaveLength(1)
      expect(endings[0]?.reason).toBe('sent')
      expect(thePiece(worker, label).because).toBeNull()
      expect(['working', 'stalled']).toContain(thePiece(worker, label).state)
    })

    it('⚠️ §1.3 the SENTENCE is true of every producer now, and the old one was not', async () => {
      // 🔴 **`message_never_sent` said *the app stopped before the message carrying it was sent*,
      // and §1.1 is a producer where the app did not stop.** ⛔ A cause is only as true as its
      // widest producer, which is `624`'s repair one member over.
      expect(undrivenSentence('message_never_sent')).toBe('the message carrying it was never sent')
      // ⚑ **The control: the retired sentence is not merely absent, it CONTRADICTS §1.1** — the app
      // is still running there, which is what makes this a measurement rather than a restatement.
      expect(undrivenSentence('message_never_sent')).not.toContain('the app stopped')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · B — a close and a reopen each leave the piece on its turn's cause
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a person closes a conversation and opens it again', () => {
    /**
     * ⛔ A PM, a worker its give started, one piece of work SENT — the ordinary shape 646 measured.
     * ⚑ **D-016** — the give's brief is the worker's first turn.
     */
    const aPmAndItsWorkingChild = async (
      approvalMode: 'ask' | 'auto' = 'auto',
    ): Promise<{ pmTools: AgentToolset; worker: string; label: string }> => {
      await bringIdentityIntoBeing('worker')
      await personOpens('pm', approvalMode)
      const pmTools = theToolsetJustHandedOut()
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The thing',
        brief: 'do the thing',
      })
      expect(given).toMatchObject({ outcome: 'ok', delivery: 'sent', started: true })
      const worker = given.agent as string
      host.claimSession(worker, window)
      return { pmTools, worker, label: given.label as string }
    }

    it('🔴 §2.1 a close and a reopen leave the cause the turn wrote, and the row never contradicts itself', async () => {
      const { pmTools, worker, label } = await aPmAndItsWorkingChild()
      // ⚑ **D-016 · picked up, and its turn over** — the brief ran as the worker's first turn and
      // ended with the piece still open, before the give answered.
      await waitFor(
        () => thePiece(worker, label).because === 'turn_ended',
        'the work to be picked up and its turn to end',
      )

      await host.close(worker, window)
      // ⚑ **D-016c · a stop moves no piece** — the Close leaves the cause its turn wrote.
      expect(thePiece(worker, label)).toEqual({ state: 'stalled', because: 'turn_ended' })

      await host.resumeSession(worker, window)

      // 🔴 **`646` F1 measured this row reading *"the conversation it was given to has ended"*
      // beside `given_to_is: "idle"`.** ⚑ A reopen moves no piece either, so the cause is still the
      // turn's.
      expect(thePiece(worker, label)).toEqual({ state: 'stalled', because: 'turn_ended' })
      // ⛔ **The state did NOT move**, which is the other half of the ruling: *nothing is driving
      // this work* is still true, and no row says anybody picked it up.
      const row = await rowTheGiverReads(pmTools, worker, label)
      expect(row).toMatchObject({
        state: 'stalled',
        stalled_because: 'turn_ended',
        given_to_is: 'idle',
      })
    })

    it('⚑ §2.2 a conversation that is closed and NOT reopened keeps its turn’s cause, and its giver reads it', async () => {
      // ⚑ **D-016c** — there is no stop cause: the Close alone leaves the piece where its turn left
      // it, and the giver's row says so beside the holder's one state.
      const { pmTools, worker, label } = await aPmAndItsWorkingChild()
      // ⚑ **D-016 · picked up, and its turn over** — the brief ran as the worker's first turn and
      // ended with the piece still open, before the give answered.
      await waitFor(
        () => thePiece(worker, label).because === 'turn_ended',
        'the work to be picked up and its turn to end',
      )
      await host.close(worker, window)

      expect(thePiece(worker, label)).toEqual({ state: 'stalled', because: 'turn_ended' })
      const row = await rowTheGiverReads(pmTools, worker, label)
      // ⚠️ **And the pair AGREES**: the ledger field says the turn stalled it, and — ⚑ **D-017 ·
      // R2** — a Close is a stop, so the giver still reaches the holder (it was `null` while a Close
      // made it unreachable). ⚑ **R11 — its live field is the one state's word, `idle`**: whether a
      // process runs is never part of it, and since D-016c no ledger field says it either.
      expect(row).toMatchObject({
        stalled_because: 'turn_ended',
        given_to_is: 'idle',
      })
    })

    it('⚠️ §2.3 a close MID-TURN leaves the INTERRUPTION, through the reopen — the cause is per-task and real', async () => {
      // ⛔ **A second shape, because a fold that always wrote one word would pass §2.1.** ⚑ Here
      // the work's OWN turn is still running when the close lands — the child is parked on a card
      // it raised for that very message — so `close()`'s `forceEnd` writes `turn: interrupted` and
      // the cause is `turn_interrupted` rather than `turn_ended`.
      // ⚑ **SENT, not queued** — the give starts the worker, so its brief opens its own turn, and
      // that turn is what the close interrupts (D-016: the worker runs in its giver's 'ask' mode).
      const { worker, label } = await aPmAndItsWorkingChild('ask')
      await waitFor(() => cardsOn(worker).length > 0, 'the brief to park on its card')
      await waitFor(() => thePiece(worker, label).state === 'working', 'the work to be picked up')

      await host.close(worker, window)
      // ⚑ **`turn_interrupted` and not `turn_ended`** — the close stopped a turn that was running.
      expect(thePiece(worker, label)).toEqual({ state: 'stalled', because: 'turn_interrupted' })
      await host.resumeSession(worker, window)

      // ⚑ **And the reopen moves nothing** (D-016c).
      expect(thePiece(worker, label)).toEqual({ state: 'stalled', because: 'turn_interrupted' })
    })
    // ⚑ **D-016c** — §2.4 (*a SECOND close stalls it `conversation_ended` again — the memory is
    // spent, not kept*) went with the snapshot it measured: a stop keeps no cause to put back.
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · C — how to read `given_to_is: null`
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ **D-014 · the case that stays collapsed is not driven here**: it needs work given to a
  // conversation the giver did not start, which the give door now refuses, so only a ledger row
  // older than D-014 can still show it.

  describe('§3 · the pair, and what it can and cannot tell apart', () => {
    /**
     * ⚑ **D-017 · R2 — re-aimed.** A person's Close is a STOP now, and a conversation a message can
     * start is one its giver reaches, so the closed holder no longer reads `null`: it reads `idle`
     * (R11's one state, which no process fact enters). ⚠️ `null` is left to a holder the giver may
     * not reach, or one no message can start. ⚑ **D-016c** — beside it the ledger field is the
     * turn's own cause, so the STOPPED holder reads exactly as §2.1's reopened one does: a process
     * fact is never shown, in either field.
     */
    it('🔴 §3.1 a STOPPED holder reads `idle` + its turn’s cause, and the cause comes off the holder`s own ledger', async () => {
      // ⛔ **The disclosure that settles `D28`: `pieceBoard` takes a session id and no `Caller`,**
      // so the cause is not reach-gated and the giver reads it whatever its grant now says.
      await bringIdentityIntoBeing('worker')
      await personOpens('pm')
      const pmTools = theToolsetJustHandedOut()
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The work',
        brief: 'do it',
      })
      const worker = given.agent as string
      const label = given.label as string
      host.claimSession(worker, window)
      // ⚑ **D-016 · picked up, and its turn over** — the brief ran as the worker's first turn and
      // ended with the piece still open, before the give answered.
      await waitFor(
        () => thePiece(worker, label).because === 'turn_ended',
        'the work to be picked up and its turn to end',
      )
      await host.close(worker, window)

      const row = await rowTheGiverReads(pmTools, worker, label)
      expect(row).toMatchObject({
        given_to_is: 'idle',
        stalled_because: 'turn_ended',
      })
    })
  })
})

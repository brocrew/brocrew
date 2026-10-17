import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  DEFAULT_PROFILE_ID,
  RUNTIME_CHANGE_SUBJECTS,
  type RuntimeChangeMessage,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **638 · work moved and nothing announced it** — `631` §6.2, in the frontend seat's own words:
 * ⛔ ***"`534`'s `runtime:changed` fires on the session-row write that creates a child; no
 * equivalent fires when work moves between conversations. Until one does, the only way the band can
 * know is the 30-second poll."***
 *
 * ## ⛔ What this suite measures, and what it deliberately does not
 *
 * ⚑ **`638` §2.2 asks for a test that a change ARRIVES, not a LATENCY** — *"prefer a test that a
 * change ARRIVES AT ALL without a poll, which is a fact rather than a duration"*. ⛔ **Nothing here
 * reads a clock or asserts a millisecond.** Every assertion is *this act announced* or *this act
 * did not*.
 *
 * ⚠️ **And the negative half is as load-bearing as the positive one.** `638` §3.2: *"do not make it
 * a firehose"*. 🔴 §4 is what holds a turn's stall to ONE announcement (D-033), never one per row
 * of the provider stream.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/** ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`. */
const codeOf = (file: string): string =>
  readFileSync(join(srcRoot, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

describe('638 · a change to a conversation’s work announces itself', () => {
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

  class ToolWatchingRuntime extends FakeRuntime {
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
    override async resume(
      ref: SessionRef,
      options: ResumeOptions,
    ): ReturnType<FakeRuntime['resume']> {
      const handle = await super.resume(ref, options)
      if (options.agentTools) this.handed.push(options.agentTools)
      return handle
    }
  }

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
  let announced: RuntimeChangeMessage[]
  /** ⚑ **What the STORE already said at the moment each message was announced** — see §3. */
  let sawWhenAnnounced: { what: string; open: number; stalled: number }[]
  let watching: string | null

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-638-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-638-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    announced = []
    sawWhenAnnounced = []
    watching = null
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
      announce: (message) => {
        announced.push(message)
        // ⛔ **§3's measurement, taken INSIDE the announcement** — what a window would have read
        // had it re-read the instant it was told. ⚑ Taken here and not after, because *after* is
        // exactly the moment that cannot tell an announcement before the write from one after it.
        if (watching !== null) {
          sawWhenAnnounced.push({
            what: message.what,
            open: store.piecesGivenBy(watching).filter((one) => TASK_IS_OPEN[one.state]).length,
            // ⚑ **D-033 · §4's** — how many of them were already stalled at that moment.
            stalled: store.piecesGivenBy(watching).filter((one) => one.state === 'stalled').length,
          })
        }
      },
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
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

  const lastToolset = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ Every subject announced since the last reset, in order. */
  const said = (): string[] => announced.map((one) => one.what)
  const saidWork = (): number => announced.filter((one) => one.what === 'work').length

  /** ⛔ A pm that may give work, and one worker profile seeded so a give has somewhere to go. */
  const aPmThatMayGive = async (): Promise<{ pm: string; pmTools: AgentToolset }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens(DEFAULT_PROFILE_ID)
    return { pm, pmTools: lastToolset() }
  }

  /**
   * ⚑ **D-016 · the give IS the work** — `give_work` starts the worker, and its brief (`do the
   * thing`) is the worker's first turn.
   */
  const give = async (pmTools: AgentToolset): Promise<string> => {
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'do the thing',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return given.agent as string
  }

  /** ⛔ {@link aPmThatMayGive}, and the one piece it gave. */
  const aChainOfTwo = async (): Promise<{ pm: string; worker: string; pmTools: AgentToolset }> => {
    const { pm, pmTools } = await aPmThatMayGive()
    return { pm, worker: await give(pmTools), pmTools }
  }

  /** ⚑ The worker's open piece — the one its brief opened. */
  const theOpenPieceOf = (worker: string) => {
    const mine = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
    if (mine === undefined) throw new Error('the give never opened a piece')
    return mine
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the subject', () => {
    it('⛔ `work` is a member, and the three name three populations', () => {
      expect([...RUNTIME_CHANGE_SUBJECTS]).toEqual(['conversations', 'agents', 'work'])
      // ⚑ **Distinct**, because a duplicate would make one reader run for the other's fact —
      // `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`.
      expect(new Set(RUNTIME_CHANGE_SUBJECTS).size).toBe(RUNTIME_CHANGE_SUBJECTS.length)
    })

    it('⚠️ the payload carries the subject and NOTHING else — no conversation id', () => {
      // 🔴 **`638` §3.2's granularity, asserted rather than described.** ⛔ A task's state is
      // composed from OTHER conversations' ledgers, so an id would name a transitive closure
      // nobody has bounded — see {@link RUNTIME_CHANGE_SUBJECTS}' own note.
      const wire = codeOf('shared/runtime-ipc.ts')
      expect(wire).toContain(
        'export interface RuntimeChangeMessage {\n  readonly what: RuntimeChangeSubject\n}',
      )
    })
  })

  describe('§2 · a change ARRIVES, with no poll and no clock', () => {
    it('🔴 WORK GIVEN announces, and the control beside it does not', async () => {
      const { pm, pmTools } = await aPmThatMayGive()
      // ⛔ **THE CONTROL FIRST**: opening conversations announces `conversations` and `agents` and
      // NOT `work` — so the positive below is a fact about the work verb and not about a channel
      // that shouts. ⚑ **D-016** — the control was a spawn; the give is the work verb now, and
      // the act before it that moves no work is a person opening a conversation.
      expect(said(), 'an open announced nothing').toContain('conversations')
      expect(said(), 'an open announced work').not.toContain('work')

      announced.length = 0
      await give(pmTools)
      // ⚑ **THE MEASUREMENT** — it arrived, and it said `work`. No interval elapsed; nothing
      // polled; this is the announcement the act itself made.
      expect(said()).toContain('work')
      expect(store.piecesGivenBy(pm).some((one) => TASK_IS_OPEN[one.state])).toBe(true)
    })

    it('🔴 WORK ANSWERED announces', async () => {
      const { worker } = await aChainOfTwo()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to park',
      )
      const card = ledger(worker)
        .filter(
          (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
            event.type === 'permission_request',
        )
        .at(-1)
      if (card === undefined) throw new Error('no card')
      await host.respondPermission(worker, card.id, { outcome: 'allow' }, surface)
      const mine = theOpenPieceOf(worker)

      announced.length = 0
      const replied = await callOn(lastToolset(), 'reply_to_parent', {
        piece: mine.piece,
        outcome: 'done',
        summary: 'finished',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      expect(said()).toContain('work')
    })

    it('🔴 a QUESTION about the work announces — the half `638` nearly shipped silent', async () => {
      // ⛔ **The gap this dispatch's own adversarial pass found.** ⚑ A piece's `state` is COMPOSED
      // from `WhatAConversationIsWaitingOn`, and `answers` is one of THREE halves: a worker asking
      // about its work moves the row to `waiting-on-an-answer` on the holder's list AND the
      // giver's — and the first five announcements did not cover it.
      const { worker } = await aChainOfTwo()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to park',
      )
      const card = ledger(worker)
        .filter(
          (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
            event.type === 'permission_request',
        )
        .at(-1)
      if (card === undefined) throw new Error('no card')
      await host.respondPermission(worker, card.id, { outcome: 'allow' }, surface)
      const mine = theOpenPieceOf(worker)

      announced.length = 0
      const asked = await callOn(lastToolset(), 'ask_question', {
        piece: mine.label,
        question: 'which colour?',
        who_answers: 'a-person',
      })
      // ⛔ **`'refused'` is TRUTHY** — the first draft of this line read `asked.outcome ?? asked.ok`
      // and would have passed on a refusal (`a-positive-assertion-must-differ-from-the-default`).
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      // ⚑ **THE MEASUREMENT** — the act announced, and a count of call sites alone would not have
      // caught its absence.
      expect(said(), 'a question about the work announced nothing').toContain('work')
    })

    /**
     * 🔴 **The ENDING of a conversation holding work announces; its REOPEN does not** (D-016c) —
     * the turn its Close interrupted moves the piece it holds, and a window's Work tab re-reads
     * only on `work`. ⚑ A reopen moves no piece and brings back no question, so it has no work to
     * announce. The controls beside it are the same Reopen over answered work and over none.
     */
    it('🔴 the ENDING of a conversation holding work announces `work`, and its REOPEN announces none', async () => {
      const { worker } = await aChainOfTwo()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      announced.length = 0
      await host.close(worker, surface)
      expect(store.piecesOwnedBy(worker).some((one) => TASK_IS_OPEN[one.state])).toBe(true)
      // ⚑ **THE POSITIVE**: the ending moved the work it holds, and said so.
      expect(said(), 'the ending of a conversation holding work announced no work').toContain(
        'work',
      )
      announced.length = 0

      await host.resumeSession(worker, surface)

      expect(said(), 'the reopen announced something').toContain('conversations')
      expect(saidWork(), 'a reopen announced work').toBe(0)
    })

    it('⚑ …a REOPEN of a conversation whose only work is ANSWERED does not', async () => {
      // ⚑ The task is still in the ledger, and closed — a reopen moves no piece, and there is no
      // open piece for anything to move.
      const { worker } = await aChainOfTwo()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to park',
      )
      const card = ledger(worker)
        .filter(
          (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
            event.type === 'permission_request',
        )
        .at(-1)
      if (card === undefined) throw new Error('no card')
      await host.respondPermission(worker, card.id, { outcome: 'allow' }, surface)
      const mine = theOpenPieceOf(worker)
      const replied = await callOn(lastToolset(), 'reply_to_parent', {
        piece: mine.piece,
        outcome: 'done',
        summary: 'finished',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      await host.close(worker, surface)
      // ⛔ The premise: work in the ledger, and none of it open.
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)
      expect(store.piecesOwnedBy(worker).some((one) => TASK_IS_OPEN[one.state])).toBe(false)
      announced.length = 0

      await host.resumeSession(worker, surface)

      expect(said(), 'the reopen announced something').toContain('conversations')
      expect(saidWork(), 'a reopen over closed work announced work').toBe(0)
    })

    it('⚑ …and a REOPEN of a conversation holding none does not', async () => {
      const mine = await personOpens(DEFAULT_PROFILE_ID)
      await host.close(mine, window)
      announced.length = 0

      await host.resumeSession(mine, window)

      expect(said(), 'the reopen announced something').toContain('conversations')
      expect(saidWork(), 'a reopen with no work announced work').toBe(0)
    })

    it('⚑ and an act that moves NO work announces no `work`', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      announced.length = 0
      // ⛔ **An identity act** — it announces `agents` and must not claim the work population.
      // ⚠️ This is the negative that makes §2's positives mean something: the channel is live in
      // this harness and still says nothing about work.
      host.setSpawningEnabled(false)
      host.setSpawningEnabled(true)
      expect(saidWork(), 'an identity act announced work').toBe(0)
    })
  })

  describe('§3 · announced AFTER the durable write, never before', () => {
    it('⛔ a window that re-read the instant it was told would see the new answer', async () => {
      const { pm, pmTools } = await aPmThatMayGive()
      watching = pm
      sawWhenAnnounced.length = 0
      await give(pmTools)
      const atWork = sawWhenAnnounced.filter((one) => one.what === 'work')
      // ⚑ **THE POSITIVE CONTROL**: there was a `work` message to measure at all.
      expect(atWork.length, 'no work announcement to measure').toBeGreaterThan(0)
      // 🔴 **THE MEASUREMENT.** ⛔ An announcement made BEFORE the append would have read `0` here
      // — a window told to re-read a row that has not committed reads the old answer and believes
      // it, which is standing rule 18's shape on a push instead of on a press.
      for (const one of atWork) {
        expect(one.open, 'announced before the ledger append').toBeGreaterThan(0)
      }
    })
  })

  describe('§4 · a turn’s stall announces once, and never per provider event', () => {
    it('🔴 a TURN ENDING moves rows to `stalled` and announces `work` once', async () => {
      const { pm, worker } = await aChainOfTwo()
      const surface = new RecordingSink('webContents:9')
      host.claimSession(worker, surface)
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'permission_request'),
        'the worker to park',
      )
      const card = ledger(worker)
        .filter(
          (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
            event.type === 'permission_request',
        )
        .at(-1)
      if (card === undefined) throw new Error('no card')
      const mine = theOpenPieceOf(worker)

      // 🔴 **The reset moves BELOW the permission**, because `respondPermission` is itself one of
      // the thirteen now — it closes the `aPerson` half. ⛔ Resetting above it would attribute that
      // verb's announcement to the turn ending and this test would measure the wrong act, which is
      // `a-comparison-tested-where-both-sides-agree` in the other direction.
      await host.respondPermission(worker, card.id, { outcome: 'allow' }, surface)
      announced.length = 0
      watching = pm
      sawWhenAnnounced.length = 0
      await waitFor(
        () =>
          store.piecesOwnedBy(worker).find((one) => one.piece === mine.piece)?.state === 'stalled',
        'the turn to end',
      )
      // ⚑ The `idle` that follows a turn's own row reads the same stall, and must say nothing.
      await waitFor(() => {
        const types = ledger(worker).map((event) => event.type)
        const ended = types.lastIndexOf('turn')
        return ended >= 0 && types.slice(ended + 1).includes('status')
      }, 'the status after the turn')
      // ⛔ **The row really did move** — this is the state a person reads.
      expect(store.piecesOwnedBy(worker).find((one) => one.piece === mine.piece)?.state).toBe(
        'stalled',
      )
      // The stall moves once; its giver notice separately announces its queue and delivery.
      // 🔴 **D-033 · AND IT ANNOUNCED THE STALL ONCE.** ⚑ A turn ending arrives through `deliver`,
      // which appends one ledger row PER PROVIDER EVENT — announcing at each is the storm
      // `what-is-being-done.ts` names. ⚠️ So the host says it once, when the read it takes after a
      // `turn` or `status` row finds the piece moved — the turn's own row and the `idle` after it
      // read the same stall, and only the first says it. ⚑ Counted by what the store said at each
      // announcement: the permission's own read may echo `respondPermission` before the stall, and
      // that one saw no stall.
      expect(
        sawWhenAnnounced.filter((one) => one.what === 'work' && one.stalled > 0),
        'the stall and the giver notice queue and send each announce once',
      ).toHaveLength(3)
      expect(
        ledger(pm).filter(
          (event) =>
            event.type === 'message_queued' && event.appNotice === 'a-work-wait-needs-attention',
        ),
      ).toHaveLength(1)
      expect(
        store
          .reconciliationReceiptsForOwner(worker)
          .filter((row) => row.step === 'giver' && row.outcome === 'delivered'),
      ).toHaveLength(1)
    })
  })

  describe('§5 · one signal, one reader', () => {
    it('⚑ every announcement is at a VERB, after its append — never in the shared plumbing', () => {
      const host_ = codeOf('main/runtime/runtime-host.ts')
      // ⛔ **These call sites and no more** — the count is the assertion's. ⚠️ One in `publishOurs`, `recordOurs` or `deliver`
      // would make EVERY ledger append announce, which is §4's firehose — and that property, not
      // the number, is what this guards.
      // 🔴 **It was FIVE until this dispatch's own adversarial pass**, which found `aWorker` is one
      // of THREE halves composing a task's state: six question/permission/proposal verbs move the
      // other two, and `abandonQueued` strands held work at a teardown.
      // ⚑ **648 · the fourteenth**, and it is the same family as `abandonQueued`'s: `runFlush` now
      // ENDS a held message whose refusal can never clear, which moves that message's task from
      // `waiting` to `stalled`. ⛔ **The sibling branch four lines above it — the one that ends a
      // message whose attached path vanished — still does NOT announce**, and that is a finding of
      // `648` rather than a shape this census blesses.
      // ⚑ **673 · the fifteenth**: `announceTheWorkItHolds`' line. It was a REOPEN's; since D-016c
      // a reopen moves no piece and calls it no more (§2's ending/reopen pair), and the line is
      // the ending's and the replacement's.
      // ⚑ **692 · the sixteenth**: `withdraw_task` on a conversation a quit left open writes its
      // `task_withdrawn` row straight into that ledger — no session, so no `publishOurs` — and
      // announces at the verb, after the append, exactly as the live withdrawal does.
      // ⚑ **689 · and the ENDING, through the SAME line** — `announceTheWorkItHolds` was one rule
      // for both, so 689 did not move the count (`four-small-things-main-owes-the-window.test.ts` §1).
      // (Both kept by the PM at the 689 + 692 integration; counted on the merged tree: 16.)
      // ⚑ **D-009 · +3, each at its verb after its append** — a decline, a withdrawal, and the
      // questions a recipient's ending closes.
      // ⚑ **D-017 · +5, each at its act after its row, none in the plumbing below.** Two moved with
      // a rename and did not change the count: `abandonQueued`'s is `handOnWhatItHeld`'s (a stop
      // hands the held work on, R3) and `692`'s is `withdrawFromAStoppedConversation`'s (R2). ⚑ The
      // new ones: words this app holds for a conversation that is not running
      // (`holdForTheNextStart`, twice — into a running mailbox, or into the ledger for the next
      // start), a held message a start finds no longer true and ends (`whatWaitedForThisStart`), a
      // giver's held notice taken back while it waits for its start
      // (`takeBackWhatWaitsForTheGiversStart`), and a person's answer to this app's question from
      // the asker's ledger (`aPersonAnswersAQuestionThisAppAsked`, R6), after the decision's row.
      // ⚑ **D-016 · −1**: `decideProposal`'s — the `aPerson` half a proposal stopped waiting on —
      // went with proposals.
      // ⚑ **D-016, commit 5 · +1**: `runFlush` ends a held brief or new brief whose piece has ended
      // before it goes out — `648`'s family again, announced after its `message_unqueued` row.
      // ⚑ **D-016 · R4 · +1**: a person's rename of a piece a person gave (`retitleForAPerson`),
      // announced through `writeIntoItsLedger`'s `landed` callback — once its `work_retitled` row
      // is down, whatever state its owner is in.
      // ⚑ **D-029 · +1**: `letGoOfItsMissedJobs` — a wake-up start that finds its conversation can
      // never be reopened ends the missed-job words it held for that start (`abandoned`, their
      // `a-scheduled-job-that-will-not-run` rows), and announces once, after the last
      // `message_unqueued` row, at that act — held work stopped waiting, as `abandonQueued`'s did.
      // ⚑ **−1: `648`'s is gone** — a flush that meets a sign-in that moved on no longer ENDS what it
      // took: the words stay held for the reopen on the current sign-in, and no task moves.
      // ⚑ **D-033 · +1**: `sayWhenItsWorkMoved` — a piece moved by a turn, found by a read the host
      // already takes after a `turn`, `status` or background-level row, and said only when it
      // moved; never in the plumbing.
      // ⚑ **F046 · +1**: `titleTheOlderFiles` — the files kept before titles were taken, titled
      // once, announced once at the end of that act, after its last row.
      // ⚑ **+1**: `deleteConversation` — a delete takes the tree's pieces with its records, and
      // announces once, after the rows are gone.
      // ⚑ **+1**: `acceptAtTheService` — a give queued at a service whose conversation nothing runs
      // writes its piece into that ledger, and announces once, after the row is down.
      // ⚑ **+2**: `advanceTheService` — a service's next brief held for it, announced once after its
      // row; and `startTheServiceFor` — that brief ended unsent when the start it needed failed,
      // announced once after its `message_unqueued` row.
      // ⚑ **+1**: `setServicesOn` — a person's switch changes whether each piece queued at a service
      // waits for services, announced once after the services list is written.
      expect(host_.split("this.theWorldMoved('work')").length - 1).toBe(35)
      for (const verb of [
        'private declineMoveOffersFromText(',
        'async decideMoveRequest(',
        'async takeOnWork(',
      ]) {
        const at = host_.indexOf(verb)
        expect(at, `${verb} missing`).toBeGreaterThan(0)
        const body = host_.slice(at, host_.indexOf('\n  }\n', at))
        expect(body.split("this.theWorldMoved('work')").length - 1).toBe(1)
      }
      for (const plumbing of ['publishOurs(', 'recordOurs(', 'emitOurs(']) {
        const at = host_.indexOf(`private ${plumbing}`)
        expect(at, `${plumbing} not found`).toBeGreaterThan(0)
        expect(
          host_.slice(at, at + 2600),
          `${plumbing} announces — every ledger append would announce`,
        ).not.toContain("theWorldMoved('work')")
      }
      // ⚑ **THE POSITIVE CONTROL for those three negatives** — the same corpus, read for the
      // string they are hunting, so a slice that had stopped matching anything is visible here.
      expect(host_).toContain("this.theWorldMoved('work')")
    })

    it('⛔ the renderer serves it from the SAME reader, so there is no second cadence', () => {
      const screen = readFileSync(
        join(srcRoot, 'renderer/src/components/RuntimeScreen.vue'),
        'utf8',
      )
      // 🔴 **`631` §2.1's rule**: two cadences on one screen is two answers. ⚑ `readTheCast` is the
      // one `Promise.all` behind both `631`'s task lists and `632`'s child rows, and it is what
      // BOTH arms call.
      // 🔴 **SLICED to the arm, because `toContain` over the whole file is satisfied by a
      // NEIGHBOUR.** ⛔ `void readTheCast()` appears five times in this component — a watch, a
      // surface change, the `conversations` arm, this arm and the interval — so a file-wide
      // `toContain` passed while the arm itself had been re-pointed at another population.
      // ⚠️ `an-assertion-can-be-satisfied-by-a-neighbouring-element`, caught by a mutation row
      // that survived.
      const armAt = screen.indexOf('work: () => {')
      expect(armAt, 'the work arm is gone').toBeGreaterThan(0)
      const arm = screen.slice(armAt, screen.indexOf('},', armAt))
      // ⚑ **`631`'s task lists and `632`'s child rows are ONE `Promise.all` inside `readTheCast`**,
      // and it is what BOTH arms call — so there is no second cadence (`631` §2.1).
      expect(arm, 'the work arm stopped reading the band').toContain('void readTheCast()')
      // ⛔ **And the drawer's Work tab**, the other surface on THIS screen drawing a task's state —
      // without it the band updates instantly while the tab beside it keeps the old word. (The
      // Team forest is a third in the file, on another screen, and keeps its 30 s poll: `664` F3.)
      expect(arm, 'the work arm stopped reading the Work tab').toContain('void readTheWork()')
    })
  })
})

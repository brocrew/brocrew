import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { type AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeChangeMessage,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import { syntheticProviderHome, fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

/**
 * An act that moves work announces `work`, so a window re-reads without waiting for its poll.
 * Nothing here reads a clock: every assertion is "this act announced" or "this act did not", and a
 * turn's stall announces once, never once per provider event.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
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

  /** {@link aChainOfTwo}, its worker held by a second window and parked on its first card. */
  const aWorkerParkedOnItsCard = async (): Promise<{
    pm: string
    worker: string
    surface: RecordingSink
    card: string
  }> => {
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
    return { pm, worker, surface, card: card.id }
  }

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
      const { worker, surface, card } = await aWorkerParkedOnItsCard()
      await host.respondPermission(worker, card, { outcome: 'allow' }, surface)
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
      // Asking about a piece moves it to `waiting-on-an-answer` on the holder's list and the
      // giver's.
      const { worker, surface, card } = await aWorkerParkedOnItsCard()
      await host.respondPermission(worker, card, { outcome: 'allow' }, surface)
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
      const { worker, surface, card } = await aWorkerParkedOnItsCard()
      await host.respondPermission(worker, card, { outcome: 'allow' }, surface)
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
      const { pm, worker, surface, card } = await aWorkerParkedOnItsCard()
      const mine = theOpenPieceOf(worker)

      // Reset after the permission: answering it announces `work` too, and that is not the act
      // measured here.
      await host.respondPermission(worker, card, { outcome: 'allow' }, surface)
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
      // The stall announces once, though a turn ending appends one ledger row per provider event;
      // its giver notice separately announces its queue and its delivery. Counted by what the store
      // said at each announcement, so an echo of the permission before the stall is not counted.
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
})

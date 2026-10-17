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
import { giverStallReceipts, isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 698 · the wake's last stale sentences — `690` F-1, R37 (`690` F-2), `690` F-3, `692` F-e
 *
 * ⚑ **D-017 (commit 3) removed `resume_agent`**: a message starts a stopped conversation (R1). ⚑ So
 * "the wake" below is the parent's own message that starts the child. ⚑ **D-016 · the work is a
 * piece its parent GAVE**, and the give's brief is the turn the worker parks in.
 *
 * ⚑ **D-016c · a stop, a reopen and a start tell nobody anything**, and a giver is told once, when
 * its work stalls. So the sentences this file was written for — a stop notice a wake made false,
 * and the correction *"that conversation was started again"* — are never sent; what is left here is
 * what still holds without them.
 *
 *  - **§1 · F-1** — ⛔ retired with `resume_agent`: it measured the wake's *running — message_agent
 *    reaches it* beside a held message (D-010 made it true), and there is no wake left to answer.
 *  - **§2 · R37** — ⚑ **D-017 · R4**: an asking worker's question survives its stop, so the work
 *    WAITS on an answer and the stop pushes its parent nothing, and the parent's message that starts
 *    it has nothing to take back. §2.1 pins that.
 *  - **§3 · F-3** — the parent's own question about the work takes back a push it made false
 *    (`703`'s F-A), with no wake at all (§3.2). ⚑ **D-016c** — §3.1, §3.3, §3.4 and §3.5 went with
 *    their subject: which stop notices a wake took back (R32) and which it set right.
 *  - **§4 · F-e** — ⚑ **D-016c · gone with its subject**: the correction's opener for a parent told
 *    its child was still open. No correction is sent now.
 *
 * ⚑ **On both provider shapes** — the Fake's, and Claude's silent-until-its-first-turn resume —
 * switched before the wake each test measures, as `what-a-wake-still-says-wrong.test.ts` does.
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

describe('698 · the wake’s last stale sentences', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-698-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-698-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_980_000
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

  /** ⚑ Let the turn a conversation is parked in end — the person answers its last card. */
  const letTheTurnEnd = async (id: string): Promise<void> => {
    const card = events(id)
      .filter((event) => event.type === 'permission_request')
      .at(-1) as { id: string } | undefined
    if (card === undefined) throw new Error(`${id} is not parked`)
    await host.respondPermission(id, card.id, { outcome: 'allow' }, window)
    await letItSettle()
  }

  /** Every accepted giver notice, including a completed holder-first step. */
  const receipts = (pm: string): unknown[] => giverStallReceipts(store, pm)
  /** ⚑ What is HELD for a conversation, in the order it was queued. */
  const held = (id: string): string[] =>
    events(id).flatMap((event) => (event.type === 'message_queued' ? [event.text] : []))
  /** ⚑ What a conversation has READ — every turn it was handed. */
  const read = (id: string): string[] =>
    events(id).flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))
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
  /**
   * ⚑ **A push about work that stalled** — the words every such notice says of its piece
   * (`undrivenWorkText`), which §3.2 waits on as its premise.
   */
  const aStallNotice = (text: string): boolean => isGiverStallNotice(text)
  /** ⚑ **D-016 · a notice names the piece by its label and title**, where it said *Task #N*. */
  const A_PIECE_LINE = /^W\d+(?:\.\d+)+(?: · | still needs attention:)/

  /**
   * ⚑ **In ONE app run, a worker parked mid-turn on the work its parent gave it**, with a person's
   * window on it — `what-a-wake-still-says-wrong.test.ts`' rig. ⚑ **D-016 · the give's brief is the
   * turn it parks in** (the PM is in `ask`, and a give runs in its giver's mode).
   */
  const aPmAndItsParkedWorker = async (): Promise<{
    pm: string
    worker: string
    piece: string
  }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'migrate',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    host.claimSession(worker, window)
    await waitFor(() => cardsOn(worker) > 0, 'the worker to park mid-turn')
    return { pm, worker, piece: given.piece as string }
  }

  describe.each([
    ['the Fake', false],
    ['Claude', true],
  ] as const)('on %s’s shape', (_shape, silent) => {
    /**
     * ⛔ **§1 retired with `resume_agent` (D-017, commit 3).** §1.1, §1.2 and §1.4 measured the
     * wake's *running — message_agent reaches it* against a busy child holding a message, nothing
     * held, and a flush in flight; there is no wake left to answer, and the message door's own half
     * (a message held beside another, D-010) is `hold-the-second-message.test.ts`'.
     */

    /** ⚑ The parent's own question about the work — `703`'s F-A act. */
    const aQuestionTo = (worker: string, piece: string): Record<string, unknown> => ({
      agent: worker,
      text: 'and the indexes?',
      kind: 'follow-up',
      piece,
    })

    /**
     * ⚑ **D-017 · R1 — the parent's own message starts a stopped child**, which is what its
     * `resume_agent` did before commit 3. ⚑ A `note` — it opens nothing and names no piece — so it
     * is a start and not the parent's question about the work (`703`'s F-A, which takes notices
     * back on its own).
     */
    const theParentStartsIt = (pm: string, worker: string): Promise<Record<string, unknown>> =>
      callOn(pm, 'message_agent', { agent: worker, text: 'carry on', kind: 'note' })

    // ─────────────────────────────────────────────────────────────────────────────
    // §2 · R37 — an asking worker's stop, and the parent's message that starts it
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * ⚑ **A worker ASKING its parent when it is closed.** ⚑ **D-017 · R4 — its question survives
     * the stop**, so the work WAITS on the parent's answer and the stop tells the parent nothing.
     */
    const aPmWithAnAskingWorkerThatStopped = async (): Promise<{
      pm: string
      worker: string
    }> => {
      const { pm, worker, piece } = await aPmAndItsParkedWorker()
      const asked = await callOn(worker, 'ask_question', {
        who_answers: 'the-parent',
        piece,
        question: 'postgres or sqlite?',
        options: ['postgres', 'sqlite'],
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      await waitFor(
        () => read(pm).some((text) => text.includes('postgres or sqlite?')),
        'the question to reach the parent',
      )
      await host.close(worker, window)
      await letItSettle()
      gate.silentUntilItsFirstTurn = silent
      return { pm, worker }
    }

    describe('§2 · R37 — an asking worker’s stop tells its parent nothing', () => {
      /**
       * ⚑ **D-017 · R4 — the subject, as it now stands.** This was *"the waker reads 'It is
       * waiting', never 'has ended' first"*: the unread ending was taken back under `retracted` and
       * the WAIT correction went. ⛔ An asking worker's stop pushes nothing — its question survives
       * the stop, and ⚑ D-016c: a stop tells nobody anything — so the waker holds nothing about it,
       * and its wake takes nothing back: the parent never reads a word about the stop.
       * ⚑ D-016c · the correction this also ruled out (*"that conversation was started again"*) is
       * no longer written anywhere, so its check went with it.
       */
      it('§2.1 an asking worker’s stop tells its parent nothing, so the parent’s message that starts it takes nothing back and sets nothing right', async () => {
        const { pm, worker } = await aPmWithAnAskingWorkerThatStopped()
        // ⚑ The premise: the question reached the parent, and nothing about the stop did.
        expect(held(pm).filter((text) => A_PIECE_LINE.test(text))).toEqual([])
        expect(receipts(pm)).toEqual([])

        expect((await theParentStartsIt(pm, worker)).outcome).toBe('ok')
        await letTheTurnEnd(pm)
        await letItSettle()

        expect(unqueued(pm).map((one) => one.reason)).not.toContain('retracted')
        expect(receipts(pm)).toEqual([])
        expect(read(pm).filter(aStallNotice)).toEqual([])
      })
    })

    // ─────────────────────────────────────────────────────────────────────────────
    // §3 · F-3 — the parent's own question takes back the push it made false
    // ─────────────────────────────────────────────────────────────────────────────

    describe('§3 · F-3 — the parent’s own question takes back the push it made false', () => {
      /*
       * ⚑ **D-016c · §3.1 went with its subject** — an ending read mid-wake, the correction the
       * reopen then queued (`set-right`), and the waker's own question taking that correction back
       * (`its-own-question`). A reopen corrects nothing now, and a giver's question writes no
       * receipt: the push's own receipt stands.
       */

      /**
       * 🔴 **The same shape with NO wake — repaired since `703`** (`698` F-A). A child's turn ends
       * with its work open while the parent is busy; the parent is pushed *"is not being worked on"*
       * (`400`), asks the child about that work in that turn, and the child takes the question up.
       * ⚑ The push is taken back — the parent's own question is what made it false — and never read.
       * ⚑ RED before `703`, which read it after the child had taken the question up.
       */
      it('§3.2 a push the parent’s own question made false is taken back, with no wake at all', async () => {
        const { pm, worker, piece } = await aPmAndItsParkedWorker()
        await host.send(pm, 'keep an eye on the migration', window)
        await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
        await letTheTurnEnd(worker)
        await waitFor(() => held(pm).some(aStallNotice), 'the push to be held for the busy parent')
        const turns = cardsOn(worker)
        expect((await callOn(pm, 'message_agent', aQuestionTo(worker, piece))).outcome).toBe('ok')
        await waitFor(() => cardsOn(worker) > turns, 'the child to work on the question')
        await letTheTurnEnd(pm)
        await letItSettle()
        expect(unqueued(pm)).toMatchObject([
          {
            reason: 'retracted',
            detail: expect.stringMatching(/this conversation asked .+ about that work$/),
          },
        ])
        expect(read(pm).some(aStallNotice)).toBe(false)
      })
    })

    /*
     * ⚑ **D-016c · §3.3, §3.4, §3.5 and §4 went with their subject** — which stop notices a wake
     * took back (R32, `retractWhatItsWakeMadeFalse`), which it set right, and the opener of the
     * correction a reopen sent (`setRightANoticeAReopenMadeFalse`). A stop, a reopen and a start
     * tell nobody anything now.
     */
  })
})

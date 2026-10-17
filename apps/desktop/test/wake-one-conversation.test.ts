import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolAnswer, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 663 · wake one conversation — `resume_agent`
 *
 * ⚑ **`HO-018` §2.3's *ask the child to continue* had no door**: after a restart a parent could
 * re-assign, close or wait (`646` §7.2), and could not ask the child to CARRY ON — `message_agent` answers `no-such-agent` for a
 * conversation that is not running (`642` §1.2), and a fresh `spawn_agent` re-reads the instructions
 * but not the child's own account of what it has done. `663` built `resume_agent` for it.
 *
 * ⛔ **D-017 (commit 3) removed `resume_agent`**: every delivery starts its recipient (R1), so the
 * parent's own `message_agent` is the door that carries the child on. ⚑ **§1 is kept, re-aimed on
 * that door** — the whole path after a real restart, on BOTH provider shapes: the parent's message
 * starts its child and continues it, the child's `reply_to_parent` reaches the parent (§1.1); a
 * child started with no window is nobody's, claimable, and handed back (§1.2); a started parent is
 * told by the APP about the work it gave out (§1.3).
 *
 * ⛔ **Retired with the tool**: §2 (who the wake's fold admitted, and its one answer for the rest),
 * §2.7 and §2.9 (its reach and its waits across a teardown — the message door's own are
 * `a-message-that-crosses-a-project.test.ts`', `hold-the-second-message.test.ts`' and
 * `a-refusal-that-clears-on-its-own.test.ts`'), §3 (the launch rails a wake met as a spawn does — a
 * message start meets the message rails only, R1), §4 (the wake's failure words — a message start's
 * are `what-a-wake-still-says-wrong.test.ts` §3's, and a conversation that can never be reopened is
 * REPLACED now, R10), §5 (its description) and §6 (its fold's refusal).
 *
 * ⚠️ **The two shapes** (`663` §5): the Fake announces a resumed conversation at construction;
 * Claude writes nothing until its first turn.
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

describe('663 · wake one conversation: its parent’s message carries it on', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-663-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-663-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_630_000
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

  /**
   * ⛔ **`646` §2's restart** — the first host closed whole, then a new host over a new `SessionStore`
   * OBJECT on the same database, so nothing in memory survives and no two ordinal counters share a
   * ledger.
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

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  /** ⚑ Every tool call goes through the CURRENT host — a toolset kept across a restart is a dead one. */
  const answerOf = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<AgentToolAnswer> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args)
  }
  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> =>
    (await answerOf(caller, name, args)).structured as Record<string, unknown>

  const runningOf = (sessionId: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )?.running

  /** ⛔ Every way words reach a conversation — a busy one HOLDS them, an idle one takes a turn. */
  const wordsIn = (sessionId: string): string[] =>
    events(sessionId).flatMap((event) =>
      event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
    )

  const turnsIn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'turn').length

  /**
   * ⚑ **D-016 · a give through the real door** — it starts the holder the first time, and its brief
   * is the holder's first turn. ⚑ Returns the conversation it reached.
   */
  const gives = async (giver: string, profileId: string, brief: string): Promise<string> => {
    const given = await callOn(giver, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: profileId,
      title: brief,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return given.agent as string
  }

  /**
   * ⚑ **A PM a person opened, and a `worker` it gave work to, its turn over** — the Fake in `auto`
   * runs the brief's turn to its end, so the piece is open and nobody is driving it: exactly what a
   * restart or a close then leaves behind. ⚑ **D-016** — the give starts the worker AND gives it the
   * work, which a spawn and a `work` message did in two acts.
   */
  const aPmAndItsWorker = async (): Promise<{ pm: string; worker: string; piece: string }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    const worker = await gives(pm, 'worker', 'migrate the schema')
    await waitFor(() => turnsIn(worker) > 0, 'the turn the brief opened to end')
    const piece = store
      .piecesOwnedBy(worker)
      .find((one) => one.giver === pm && TASK_IS_OPEN[one.state])
    if (piece === undefined) throw new Error('the give never opened a piece')
    return { pm, worker, piece: piece.label }
  }

  const openPieceIn = (holder: string, giver: string): boolean =>
    store.piecesOwnedBy(holder).some((one) => one.giver === giver && TASK_IS_OPEN[one.state])

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · the whole path, after a real restart, on both provider shapes
  // ───────────────────────────────────────────────────────────────────────────────

  describe.each([
    ['the Fake', false],
    ['Claude', true],
  ] as const)('§1 · after a restart, on %s’s shape', (_shape, silent) => {
    /**
     * 🔴 **The option `HO-018` §2.3 ruled** — the parent carries its child on, and the child's own
     * answer reaches the parent. ⚑ **D-017 · R1 — one act now**: the parent's `message_agent` starts
     * the stopped child and delivers, where `663`'s wake started it and the next message continued
     * it.
     */
    it('§1.1 the parent’s message starts its child and continues it, and its reply reaches the parent', async () => {
      const { pm, worker, piece } = await aPmAndItsWorker()

      await relaunch()
      gate.silentUntilItsFirstTurn = silent
      // ⛔ **The premise: nothing is running.**
      expect(runningOf(worker)).toBe('not-running')
      await host.resumeSession(pm, window)
      // ⚑ **D-017 · R11 — the premise reads the CARD**, which starts nothing: a conversation this
      // app is not running, owed nothing, is `idle` (whether a process runs is not a state).
      const before = await callOn(pm, 'get_agent_status', { agent: worker })
      expect((before.agent as { state: string }).state).toBe('idle')
      expect(runningOf(worker)).toBe('not-running')

      // ⚑ **As a follow-up naming the piece, because the piece is still open and still the
      // child's** — ⚑ D-016: a second give to it is refused `its-work-has-stalled`, whose words
      // point here.
      const continued = await callOn(pm, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece,
        text: 'carry on from where you were',
      })
      expect(continued.outcome, JSON.stringify(continued)).toBe('ok')
      await waitFor(
        () => wordsIn(worker).some((text) => text.includes('carry on from where you were')),
        'the parent’s words to reach the started child',
      )

      const replied = await callOn(worker, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'carried on and finished the migration',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      await waitFor(
        () => wordsIn(pm).some((text) => text.includes('carried on and finished the migration')),
        'the child’s reply to reach its parent',
      )
      expect(store.piecesOwnedBy(worker).find((one) => one.label === piece)?.state).toBe('answered')
      // ⚑ **Both resumes went through the double's gate** — the parent's and the child's start.
      expect(gate.entered).toBe(2)
    })

    /**
     * ⚑ **`unwatched` and claimable, exactly as a given conversation is** (`646` §1's `| null`) —
     * ⚑ D-017 · R5: a start with no window is one a person's window may take.
     */
    it('§1.2 the child its parent’s message started is nobody’s window: unwatched, claimable, and handed back when that window goes', async () => {
      const { pm, worker, piece } = await aPmAndItsWorker()
      await relaunch()
      gate.silentUntilItsFirstTurn = silent
      await host.resumeSession(pm, window)

      const continued = await callOn(pm, 'message_agent', {
        agent: worker,
        kind: 'follow-up',
        piece,
        text: 'carry on',
      })
      expect(continued.outcome, JSON.stringify(continued)).toBe('ok')
      expect(runningOf(worker)).toBe('unwatched')
      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(worker)

      host.claimSession(worker, window)
      expect(runningOf(worker)).toBe('in-a-window')
      // ⚑ **661 F2 on this population**: an agent asked for it, so a person's window going away
      // releases it rather than stopping it.
      await host.closeSessionsForOwner(window.ownerId)
      await waitFor(() => runningOf(worker) === 'unwatched', 'the child to be handed back')
    })

    /**
     * 🔴 **A started conversation that itself gave out work is told about that work — by the APP**
     * (`663`'s review, round two): `tellAboutWorkItGaveOut` runs as any conversation comes back
     * (404), and a project manager whose worker stalled at the quit reads that notice beside the
     * words that started it. ⚑ **D-017 · R1** — those words are its giver's message now; ⛔ the
     * wake's *"Nothing from you was sent to it"* went with `resume_agent`.
     */
    it('§1.3 a parent its giver’s message started is told about the work IT gave out, by the app', async () => {
      await bringIdentityIntoBeing('pm')
      await bringIdentityIntoBeing('worker')
      const brobot = await personOpens(DEFAULT_PROFILE_ID, 'ask')
      const cardsOn = (id: string): number =>
        events(id).filter((event) => event.type === 'permission_request').length
      // ⚑ Both mid-turn at the quit, each parked on a card — so neither parent was told anything.
      // ⚑ **D-016** — each is started by its giver's give, and the brief is the turn that parks.
      const pm = await gives(brobot, 'pm', 'run the project')
      await waitFor(() => cardsOn(pm) > 0, 'the PM to park on its card')
      const worker = await gives(pm, 'worker', 'do the part')
      await waitFor(() => cardsOn(worker) > 0, 'the worker to park on its card')

      await relaunch()
      gate.silentUntilItsFirstTurn = silent
      await host.resumeSession(brobot, window)
      expect(openPieceIn(pm, brobot)).toBe(true)
      expect(openPieceIn(worker, pm)).toBe(true)
      const before = wordsIn(pm).length

      const sent = await callOn(brobot, 'message_agent', {
        agent: pm,
        text: 'how is the project going?',
        kind: 'note',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      await waitFor(
        () =>
          wordsIn(pm)
            .slice(before)
            .some((text) => text.includes('is not being worked on')),
        'the app to tell the started PM about its worker',
      )
      // ⛔ **…and nothing else reached it** but the words that started it and the app's notice.
      expect(
        wordsIn(pm)
          .slice(before)
          .every(
            (text) =>
              text.includes('is not being worked on') || text.includes('how is the project going?'),
          ),
      ).toBe(true)
    })
  })
})

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
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
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **D-017 · a stop is not an ending — two lives the landed suite does not yet pin.**
 *
 * ⚑ **§1** — {@link RuntimeHost.resumeSession} writes its OWN `launched` row (the call site distinct
 * from `createSession`'s, at the reopen). `a-models-own-question-stays-the-models.test.ts` already
 * pins that a FIRST life's own question outlives that life's own stop; it only ever resumes the PM,
 * never the child that asked. This pins the SECOND life: a conversation resumed once, whose question
 * in that later life survives that later life's own stop too.
 *
 * ⚑ **§2** — a message a stop handed on for its conversation's next start, whose task is withdrawn
 * while it waits, is ended `cancelled` — never resent as a stale turn once the conversation starts
 * again. ⚑ **D-016** — the message is a give's held brief, and the task a piece taken back.
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

describe('D-017 · a stop is not an ending', () => {
  describe('§1 · a resumed conversation writes its own launched row', () => {
    let userData: string
    let root: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let hosts: RuntimeHost[]
    let issued: FakeProviderSessions
    let counter: number
    let clock: number
    let window: RecordingSink
    const tick = (): number => clock++

    const buildHost = (): RuntimeHost => {
      const built = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${++counter}`,
        now: tick,
        readProviderConfig: (_provider, home) => ({
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
      userData = mkdtempSync(join(tmpdir(), 'brobot2-stop1-'))
      root = mkdtempSync(join(tmpdir(), 'brobot2-stop1-root-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      clock = 9_000_000
      store = createSessionStore(db, tick)
      counter = 0
      hosts = []
      issued = new FakeProviderSessions()
      host = buildHost()
      window = new RecordingSink('webContents:1')
    })

    afterEach(async () => {
      for (const built of hosts) await built.closeAll()
      db.close()
      for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
    })

    const callOn = async (
      sessionId: string,
      name: ToolName,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const tool = agentToolsFor(host, sessionId).tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }

    const personOpens = async (profileId: string): Promise<string> => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
        window,
      )
      return sessionId
    }

    /** ⚑ A PM in a window, and one child its give started through the real door (D-016). */
    const aPmAndAChild = async (): Promise<{ pm: string; child: string }> => {
      await host.close(await personOpens('worker'), window)
      const pm = await personOpens(DEFAULT_PROFILE_ID)
      const spawned = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The notes',
        brief: 'the notes',
      })
      expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
      return { pm, child: spawned.agent as string }
    }

    const questionOf = (asker: string, requestId: string) =>
      store
        .routedRequestsOf(asker)
        .filter((one) => one.requestId === requestId)
        .at(-1)

    const ledgerEvents = <T extends TranscriptEvent['type']>(
      sessionId: string,
      type: T,
    ): Extract<TranscriptEvent, { type: T }>[] =>
      store
        .events(sessionId)
        .map((row) => row.event)
        .filter((event): event is Extract<TranscriptEvent, { type: T }> => event.type === type)

    it("a resumed conversation writes its own launched row, and a question it asks in that later life survives that life's own stop too", async () => {
      const { pm, child } = await aPmAndAChild()
      // ⛔ Non-vacuous: generation 0 really did launch, once, and nothing is asked yet.
      expect(ledgerEvents(child, 'launched')).toHaveLength(1)

      // ⚑ Generation 0 ends trivially — nothing asked, so nothing for this quit to abandon.
      await host.closeAll()

      // ⚑ Generation 1: a fresh store object and a fresh host, over the SAME db file.
      store = createSessionStore(db, tick)
      host = buildHost()
      await host.resumeSession(child, window)
      // 🔴 **The premise `resumeSession`'s own write makes true**: a SECOND `launched` row, one per
      // generation — {@link M66} strips this call, which would leave this at 1.
      expect(ledgerEvents(child, 'launched')).toHaveLength(2)
      // ⚑ Pm resumed too, so asking it below is an ordinary delivery to a running recipient rather
      // than also exercising D-017 R1's own "a message starts its stopped recipient" — a real
      // mechanism, but not the one this test is about.
      await host.resumeSession(pm, window)

      const asked = await callOn(child, 'ask_question', {
        who_answers: 'an-agent',
        agent: pm,
        question: 'where should generation 1 look for the notes?',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      const q2 = asked.question as string
      // ⛔ Non-vacuous: it really was asked, and really is open, before generation 1's own stop.
      expect(questionOf(child, q2)?.state).toBe('open')
      // ⚑ Let the question's own delivery to pm settle before quitting, so the quit below measures
      // Q2's survival and nothing about that delivery's own race with a quit — a different question.
      await new Promise((resolve) => setTimeout(resolve, 50))

      // ⚑ Generation 1's own quit — its own terminal `status` row is what would abandon Q2 without
      // the SECOND `launched` row above.
      await host.closeAll()
      expect(store.whatTheQuitClosed()).toContain(child)

      // ⚑ Generation 2: a THIRD store object, so the read below is off the ledger alone.
      store = createSessionStore(db, tick)
      host = buildHost()
      expect(ledgerEvents(child, 'launched')).toHaveLength(2)
      // 🔴 **The assertion this test is about**: generation 1's own question outlives generation 1's
      // own stop — never `abandoned` by the terminal `status` row that stop wrote.
      expect(questionOf(child, q2)?.state).toBe('open')
    })
  })

  describe('§2 · a brief whose piece was taken back while it waited for a restart', () => {
    let userData: string
    let root: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let issued: FakeProviderSessions
    let counter: number
    let clock: number
    let window: RecordingSink
    const tick = (): number => clock++

    const buildHost = (): RuntimeHost =>
      new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${++counter}`,
        now: tick,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-stop2-'))
      root = mkdtempSync(join(tmpdir(), 'brobot2-stop2-root-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      clock = 9_500_000
      store = createSessionStore(db, tick)
      counter = 0
      issued = new FakeProviderSessions()
      host = buildHost()
      window = new RecordingSink('webContents:2')
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      await host.closeAll()
      db.close()
      for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
    })

    const callOn = async (
      sessionId: string,
      name: ToolName,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const tool = agentToolsFor(host, sessionId).tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }

    const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error(`timed out waiting for ${what}`)
    }

    const eventsOf = (sessionId: string): TranscriptEvent[] =>
      store.events(sessionId).map((row) => row.event)
    const cardsOn = (sessionId: string): number =>
      eventsOf(sessionId).filter((event) => event.type === 'permission_request').length

    const personOpens = async (profileId: string): Promise<string> => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
        window,
      )
      return sessionId
    }

    /**
     * ⚑ A PM in a window, and one worker its give started through the real door — both in 'ask'
     * mode (D-016: the brief is the worker's first turn).
     */
    const aPmAndItsWorker = async (): Promise<{ pm: string; worker: string }> => {
      await host.close(await personOpens('worker'), window)
      const pm = await personOpens('pm')
      const spawned = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The migration',
        brief: 'the migration',
      })
      expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
      return { pm, worker: spawned.agent as string }
    }

    it("a brief waiting for its conversation's next start, whose piece was taken back while it waited, is ended as cancelled instead of being resent", async () => {
      const { pm, worker } = await aPmAndItsWorker()
      host.claimSession(worker, window)

      // ⚑ **Busy** — the first give's brief is the worker's first turn, which parks on a permission
      // card in 'ask' mode.
      await waitFor(() => cardsOn(worker) > 0, "the worker's own card")

      // ⚑ **Held, and piece-carrying** — the worker is busy, so a second give from the same giver
      // reaches the same conversation and is queued (D-016: no one-open-task rail).
      const given = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The schema',
        brief: 'migrate the schema',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.agent).toBe(worker)
      expect(given.delivery).toBe('held')
      const held = store
        .piecesOwnedBy(worker)
        .find((one) => one.label === given.label && TASK_IS_OPEN[one.state])
      if (held === undefined) throw new Error('the give never opened a piece')
      const piece = held.piece
      const messageId = held.messageId
      if (messageId === null) throw new Error('the held work carries no message id')
      // ⛔ Non-vacuous: the message really is waiting, and nothing has ended it yet.
      expect(
        eventsOf(worker).some(
          (event) => event.type === 'message_queued' && event.messageId === messageId,
        ),
      ).toBe(true)
      expect(eventsOf(worker).some((event) => event.type === 'message_unqueued')).toBe(false)

      // ⚑ **Gate the conversation's own next start at its door.** A Close hands what it held to the
      // next start automatically (already pinned by `the-message-that-has-no-name.test.ts`'s "a
      // Close hands it on…"); held here so the withdrawal below reaches a conversation that is
      // genuinely stopped, before that automatic start has reserved anything for it.
      let releaseTheStart: () => void = () => {}
      const started = new Promise<void>((resolve) => {
        releaseTheStart = resolve
      })
      const realResumeSession = host.resumeSession.bind(host)
      vi.spyOn(host, 'resumeSession').mockImplementation(
        async (...args: Parameters<RuntimeHost['resumeSession']>) => {
          if (args[0] === worker) await started
          return realResumeSession(...args)
        },
      )

      await host.close(worker, window)

      // While the worker is stopped — its next start held at the door above — the pm takes the work
      // back. ⚑ **D-016 · ruling 8 — the take-back tells its owner, and waits for it to start to hear
      // it**, so the answer comes only once the start below is let through.
      const withdrawing = callOn(pm, 'withdraw_task', { piece })
      await waitFor(
        () => eventsOf(worker).some((event) => event.type === 'work_taken_back'),
        'the piece to be taken back',
      )

      // ⚑ **Settled already, before the next start ever runs** — the ending the take-back itself
      // writes, for the SAME message id.
      expect(eventsOf(worker).some((event) => event.type === 'reopened')).toBe(false)
      const endingsAtTheWithdrawal = eventsOf(worker).filter(
        (event) => event.type === 'message_unqueued',
      )
      expect(endingsAtTheWithdrawal).toHaveLength(1)
      expect(endingsAtTheWithdrawal[0]).toMatchObject({ reason: 'cancelled', messageId })

      // ⚑ Let the conversation start again.
      releaseTheStart()
      const withdrawn = await withdrawing
      expect(withdrawn.outcome, JSON.stringify(withdrawn)).toBe('ok')
      expect(withdrawn.tookBackTheMessage).toBe(true)
      await waitFor(
        () => eventsOf(worker).some((event) => event.type === 'reopened'),
        'the worker to start again',
      )
      // A real pause, so a resend fired by that restart is measured too, not raced past.
      await new Promise((resolve) => setTimeout(resolve, 50))

      // 🔴 **Exactly one ending, ever — `cancelled`, never resent as a stale turn once it starts.**
      const endings = eventsOf(worker).filter((event) => event.type === 'message_unqueued')
      expect(endings).toHaveLength(1)
      expect(endings[0]).toMatchObject({ reason: 'cancelled', messageId })
      expect(
        eventsOf(worker).some(
          (event) => event.type === 'user_turn' && event.text.includes('migrate the schema'),
        ),
      ).toBe(false)
    })
  })
})

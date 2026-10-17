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
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, refuseTool, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # 🔴 690 · the wake says only what is true — `675` F-a and F-h, at `resume_agent`
 *
 * ⛔ **D-017 (commit 3) removed `resume_agent`**: a message starts a stopped conversation (R1), so
 * there is no wake left to say anything. What `690` measured of the wake went with it — its answer
 * mirroring the message door's (F-a, §1.1–§1.4), the guards it asked, derived from that door (§1.5),
 * and its own sentence for a wake of itself (F-h, §2.1).
 *
 * ⚑ **What is kept is the message door's half of each pair**, which was the control and is still
 * true: `message_agent` refuses a running child whose Claude sign-in moved on with its own
 * `detail.said` (§1.1), starts a child that errored in place again and delivers (§1.2), and keeps
 * the table's sentence for a message to itself (§2.2).
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

describe('690 · the wake says only what is true', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-690-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-690-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_900_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    const issued = new FakeProviderSessions()
    const gate = anOpenGate()
    host = new RuntimeHost({
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
    hosts.push(host)
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

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** ⚑ What this host says it is doing with one recorded conversation — `runningStateOf`. */
  const runningOf = (sessionId: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )?.running

  const turnsIn = (sessionId: string): number =>
    store.events(sessionId).filter((entry) => entry.event.type === 'turn').length

  /**
   * ⚑ A PM a person opened, and one `worker` it gave a piece to, whose turn is over — so the worker
   * is RUNNING and idle.
   *
   * ⚑ **D-016 · the give starts the worker and its brief IS the turn** — where a spawn started it
   * idle and a `work` message opened the task. The PM is in `auto`, so the brief's turn ends at once.
   */
  const aPmAndItsRunningWorker = async (): Promise<{
    pm: string
    worker: string
    workerHandle: FakeSessionHandle
    piece: string
  }> => {
    const first = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
      window,
    )
    await host.close(first.sessionId, window)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
      window,
    )
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The schema',
      brief: 'migrate the schema',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerHandle = handles.at(-1)
    if (workerHandle === undefined) throw new Error('the worker has no provider handle')
    await waitFor(() => turnsIn(worker) > 0, 'the turn the brief opened to end')
    const piece = store.openPiecesOf(worker).find((one) => one.piece === given.piece)
    if (piece === undefined) throw new Error('the give never wrote its piece')
    return { pm, worker, workerHandle, piece: piece.label }
  }

  /**
   * ⚑ **The machine's Claude sign-in moved on**, as the real Claude handle sees it: `checkSignIn`
   * latches once a later turn finds a different credential — `a-parent-that-survives-a-restart`'s
   * double, which moves a generation; here the handle answers the latched state directly.
   */
  const itsSignInMovedOn = (handle: FakeSessionHandle): void => {
    Object.defineProperty(handle, 'checkSignIn', {
      value: async () => true,
      configurable: true,
    })
  }

  /** ⚑ What a caller sends to carry on: a question about the work — the piece it names. */
  const aQuestionTo = (worker: string, piece: string): Record<string, unknown> => ({
    agent: worker,
    kind: 'follow-up',
    piece,
    text: 'how far along are you?',
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · F-a — the wake answers what the message door answers
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§1 · F-a — a running conversation message_agent once refused, now delivered to', () => {
    /**
     * ⚑ **The message door's half of `690`'s pair** — the wake's half went with `resume_agent`
     * (D-017, commit 3). ⚑ An agent's message to a child whose sign-in moved on is HELD, and this
     * app reopens the idle child on the current sign-in for it — so it is delivered, not refused.
     */
    it('§1.1 a child whose Claude sign-in moved on: message_agent holds it, and it goes in the reopened child', async () => {
      const { pm, worker, workerHandle, piece } = await aPmAndItsRunningWorker()
      itsSignInMovedOn(workerHandle)

      const message = await callOn(pm, 'message_agent', aQuestionTo(worker, piece))
      expect(message).toMatchObject({ outcome: 'ok', delivery: 'queued', agent: worker })
      await waitFor(
        () =>
          store
            .events(worker)
            .some(
              (entry) =>
                entry.event.type === 'user_turn' && entry.event.text === 'how far along are you?',
            ),
        'the message to reach the reopened child',
      )
      expect(store.events(worker).map((entry) => entry.event)).toContainEqual({
        type: 'reopened',
        because: 'the-sign-in-moved-on',
      })
      expect(runningOf(worker)).not.toBe('not-running')
    })

    /**
     * ⚑ **Errored in place** — the provider faulted and the finalizer has not started yet.
     * ⚑ **D-017 · R1**: a provider failure is a STOP, and `message_agent` no longer refuses it
     * *"this conversation is over"* — it waits the failed provider out and starts the conversation
     * again. ⚠️ **Reached only by calling in the very tick of the fault**: both adapters close their
     * event queue with the fatal status, and the teardown starts a few microtasks later (`690`'s
     * review). ⛔ The wake asked in the same instant went with `resume_agent`.
     */
    it('§1.2 a child errored in place: message_agent starts it again and delivers', async () => {
      const { pm, worker, workerHandle, piece } = await aPmAndItsRunningWorker()
      workerHandle.simulateError('the provider stream ended unexpectedly', true)
      expect(workerHandle.status()).toBe('errored')

      const message = await callOn(pm, 'message_agent', aQuestionTo(worker, piece))
      expect(message, JSON.stringify(message)).toMatchObject({ outcome: 'ok', agent: worker })
    })

    /**
     * ⛔ **§1.3, §1.4 and §1.5 retired with `resume_agent` (D-017, commit 3)** — a teardown during
     * the wake's own sign-in read, the wake's *running* word for a child `message_agent` reaches, and
     * the census that derived the wake's guards from the message door's.
     */
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · F-h — a caller that asked to wake itself
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§2 · F-h — a message to itself', () => {
    /**
     * ⚑ **`message_agent` to itself keeps the table's sentence**, which is true there. ⛔ §2.1, a
     * WAKE of itself and its own sentence, and this test's second control (a wake of another agent
     * said *running*) went with `resume_agent` (D-017, commit 3).
     */
    it('§2.2 message_agent to itself keeps its own sentence', async () => {
      const { pm, piece } = await aPmAndItsRunningWorker()
      const message = await callOn(pm, 'message_agent', { ...aQuestionTo(pm, piece) })
      expect(message.rail).toBe('that-agent-is-you')
      expect(message.reason).toBe(refuseTool('that-agent-is-you').reason)
      // ⚑ **D-016 · a message gives no work**, so the sentence says what a message to itself is.
      expect(String(message.reason)).toContain('cannot send itself a message')
    })
  })
})

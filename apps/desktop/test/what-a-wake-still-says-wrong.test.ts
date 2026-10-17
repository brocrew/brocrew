import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AuthUnavailableError,
  NoCodexSignInOnThisComputerError,
  CodexRuntime,
  FakeProviderSessions,
  ResumeError,
} from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 673 · what a wake still says wrong — `663`'s F1 and F6, measured on one host
 *
 * ⚑ **D-017 (commit 3) removed `resume_agent`**: a message starts a stopped conversation (R1). ⚑ So
 * "the wake" below is the parent's own message that starts the child.
 *
 *  - **§1 · F1** — right after a reopen, before any turn, a parent's `list_tasks` said
 *    `stalled_because: conversation_ended` beside `given_to_is: idle` on Claude's shape: `648`'s
 *    unwind fired only on a row the PROVIDER writes, and Claude writes none until its first turn.
 *    ⚑ **D-016c** — a stop changes nothing about a piece, so there is no ending to unwind: the work
 *    reads its turn's own cause through the quit and the reopen, on either shape, before any row
 *    the provider writes. ⛔ §1.1, the parent's wake before any turn, went with `resume_agent`: a
 *    parent's start always carries its message's turn now.
 *  - **§2 · F8** — ⚑ **D-016c · gone with its subject**: what the app told a parent about its own
 *    wake of a child it had been told had stopped — the `its-own-wake` receipt, the correction
 *    *"that conversation was started again"*, and R32's taking back of a stop notice its wake made
 *    false. A stop and a start tell nobody anything now, so a waker is told nothing to correct.
 *  - **§3 · F6** — what the parent's message answers when the provider's resume fails on a sign-in,
 *    and when it fails on a thread the provider no longer has.
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

describe('673 · what a wake still says wrong', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-673-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-673-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_730_000
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

  /** ⛔ `646` §2's restart — a new host over a new `SessionStore` object on the same database. */
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

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const turnsIn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'turn').length

  /**
   * ⚑ **D-016 · a child given a piece** — `give_work` starts it, and its brief is its first turn.
   * Returns the child, its piece's id and its label.
   */
  const giveAChild = async (
    pm: string,
    profile: string,
    brief: string,
  ): Promise<{ child: string; piece: string; label: string }> => {
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: `The ${profile}`,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      child: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  /**
   * ⚑ A PM a person opened, and one `worker` it gave work to, whose turn is over. ⚑ **D-016** — the
   * give starts the worker and its brief is the turn that ends.
   */
  const aPmAndItsIdleWorker = async (): Promise<{
    pm: string
    worker: string
    piece: string
    label: string
  }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const { child: worker, piece, label } = await giveAChild(pm, 'worker', 'migrate the schema')
    await waitFor(() => turnsIn(worker) > 0, 'the turn the brief opened to end')
    const open = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
    if (open?.piece !== piece) throw new Error('the give never opened a piece')
    return { pm, worker, piece, label }
  }

  /** ⚑ What `list_tasks` tells the parent about one piece of work it gave out. */
  const whatThePmReads = async (
    pm: string,
    piece: string,
  ): Promise<{ stalled_because: unknown; given_to_is: unknown }> => {
    const row = ((await callOn(pm, 'list_tasks')).you_gave as Record<string, unknown>[]).find(
      (one) => one.piece === piece,
    )
    if (row === undefined) throw new Error('the parent does not see its own work')
    return { stalled_because: row.stalled_because, given_to_is: row.given_to_is }
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · F1 — the turn's cause, through a quit and the host's own reopen
  // ───────────────────────────────────────────────────────────────────────────────

  describe.each([
    ['the Fake', false],
    ['Claude', true],
  ] as const)('§1 · F1 on %s’s shape', (_shape, silent) => {
    /**
     * ⛔ **§1.1 retired with `resume_agent` (D-017, commit 3).** It measured the unwind after the
     * PARENT's wake, before any turn; a parent's start is its message now, and the turn that message
     * opens follows it at once, so an agent's start with no turn is gone. ⚑ §1.2, a person's Reopen
     * before any turn, is the subject on Claude's shape, and the Fake's is its control. ⚑ **D-016c** —
     * the quit wrote no cause over the turn's, so nothing waits on a provider row to put it back.
     */
    it('§1.2 reopened by a person, before any turn: the same', async () => {
      const { pm, worker, piece } = await aPmAndItsIdleWorker()
      await relaunch()
      gate.silentUntilItsFirstTurn = silent
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, window)
      await letItSettle()
      expect(await whatThePmReads(pm, piece)).toEqual({
        stalled_because: 'turn_ended',
        given_to_is: 'idle',
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · F8 — ⚑ D-016c: gone with its subject. It measured what the app told a parent about its own
  // wake of a child it had been told had stopped: the `its-own-wake` / `set-right` receipts, the
  // correction *"that conversation was started again"*, and R32's taking back of the stop notices
  // its wake made false (`wokenBy`, `retractWhatItsWakeMadeFalse`, `setRightANoticeAReopenMadeFalse`).
  // A stop, a reopen and a start tell nobody anything now, and a giver is told once, when its work
  // stalls. A first message joining a start in flight is
  // `a-first-message-starts-it-in-one-act.test.ts`'.
  // ───────────────────────────────────────────────────────────────────────────────

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · F6 — the two things Codex's resume can now say, as a wake reads them
  // ───────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **The wake's half of `663` F6.** `codex-runtime.test.ts` measures that Codex's `resume` now
   * rethrows an expired sign-in as `AuthUnavailableError` and a lost thread as a `ResumeError` with
   * its cause; these two measure what a wake answers for exactly those two shapes. ⚑ **D-017 · R1**:
   * the wake is the parent's message now, which answers a start that did not happen in the wake's
   * words, with its true reason.
   */
  describe('§3 · F6 — a sign-in is not a lost conversation', () => {
    /**
     * ⚑ What the parent sends to carry on — its message is what starts the stopped worker (R1).
     * ⚑ **D-016** — a note: it is talk, and a follow-up must name its piece.
     */
    const aQuestionTo = (worker: string): Record<string, unknown> => ({
      agent: worker,
      text: 'how far along are you?',
      kind: 'note',
    })
    /**
     * ⚑ **A worker that is stopped** — ⚑ D-017: by a person's Close (a person takes it over and
     * closes it), since `end_agent` went with commit 3; the parent's message is what starts it.
     */
    const aWorkerOver = async (): Promise<{ pm: string; worker: string }> => {
      const { pm, worker } = await aPmAndItsIdleWorker()
      host.claimSession(worker, window)
      await host.close(worker, window)
      await waitFor(
        () =>
          ![...host.resumableSessions()].some(
            (row) => row.sessionId === worker && row.running !== 'not-running',
          ),
        'the worker to be over',
      )
      return { pm, worker }
    }

    it('§3.1 an expired sign-in at the reopen reaches the sign-in word', async () => {
      const { pm, worker } = await aWorkerOver()
      gate.resumeFails = () => new AuthUnavailableError('codex', 'Your sign-in has expired.')
      const refused = await callOn(pm, 'message_agent', aQuestionTo(worker))
      expect(refused.rail).toBe('agent-did-not-start')
      expect(refused.detail).toEqual({
        agent: worker,
        because: 'its-sign-in-is-unusable',
        provider: 'codex',
      })
      expect(String(refused.reason)).toContain('its Codex sign-in could not be used')
    })

    it('§3.1b a reopen on a computer with no Codex sign-in to copy says that, in the wake’s words', async () => {
      const { pm, worker } = await aWorkerOver()
      gate.resumeFails = () =>
        new NoCodexSignInOnThisComputerError('personal Codex auth.json not found at /fictional')
      const refused = await callOn(pm, 'message_agent', aQuestionTo(worker))
      expect(refused.rail).toBe('agent-did-not-start')
      expect(refused.detail).toEqual({
        agent: worker,
        because: 'this-computer-has-no-sign-in-to-copy',
        provider: 'codex',
      })
      const said = String(refused.reason)
      expect(said).toContain('there is no Codex sign-in for that agent to start on')
      expect(said).toContain('Nothing was sent, and sending again will not help until then.')
      expect(said).not.toContain('/fictional')
    })

    it('§3.2 a thread the provider no longer has is still could-not-be-resumed', async () => {
      const { pm, worker } = await aWorkerOver()
      gate.resumeFails = () =>
        new ResumeError(
          { provider: 'codex', sessionId: 'th_gone', cwd: root, rotation: 0 },
          'resume failed: no such thread',
          { cause: new Error('thread/resume: not found') },
        )
      const refused = await callOn(pm, 'message_agent', aQuestionTo(worker))
      expect(refused.rail).toBe('that-conversation-could-not-be-resumed')
      expect(refused.detail).toEqual({ agent: worker, because: 'the-provider-could-not-resume-it' })
    })

    /**
     * 🔴 **697 · `673` F-6 — the error the Codex ADAPTER makes, not one this test wrote.** §3.1 and
     * §3.2 hand the wake errors shaped by hand; this one is `CodexRuntime.resume`'s own, for a
     * transport that could not be spawned. ⛔ On `main` it left as the factory's bare `Error`, the
     * wake's classifier knew nothing of it, and `resume_agent` threw where Claude's adapter — for the
     * same failure — answered *could not be resumed*.
     *
     * ⚠️ **705 · R39 — for a failure a person has to fix.** The error here carries no errno code, so
     * it reads as one; a spawn the machine ran short for (`EMFILE`, `EAGAIN`, …) answers the retryable
     * `that-conversation-could-not-be-woken-just-now` (`a-shortage-that-clears-by-itself.test.ts`).
     */
    it('§3.3 a Codex app-server that could not be spawned, for no shortage, is could-not-be-resumed, as on Claude', async () => {
      const { pm, worker } = await aWorkerOver()
      const produced = await new CodexRuntime(() => {
        throw new Error('spawn ENOENT')
      })
        .resume(
          { provider: 'codex', sessionId: 'th_1', cwd: root, rotation: 0 },
          { providerHome: join(root, 'codex-home-697') },
        )
        .catch((thrown: unknown) => thrown)
      // ⚑ The premise, read off the adapter rather than assumed: a ResumeError carrying the spawn.
      expect(produced).toBeInstanceOf(ResumeError)
      expect((produced as ResumeError).cause).toMatchObject({ message: 'spawn ENOENT' })
      gate.resumeFails = () => produced as Error
      const refused = await callOn(pm, 'message_agent', aQuestionTo(worker))
      expect(refused.rail).toBe('that-conversation-could-not-be-resumed')
      expect(refused.detail).toEqual({ agent: worker, because: 'the-provider-could-not-resume-it' })
    })
  })
})

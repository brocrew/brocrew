import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthUnavailableError, FakeProviderSessions, ResumeError } from '@brobot2/runtime'
import { NoCodexSignInOnThisComputerError, CodexRuntime } from '@brobot2/runtime/codex'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('what a wake still says wrong', () => {
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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
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
    it('reopened by a person after a quit, before any turn: the work still reads its turn’s own cause', async () => {
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

    /** The error the Codex adapter itself makes for a transport it could not spawn. */
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

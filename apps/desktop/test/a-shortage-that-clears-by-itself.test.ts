import {
  expectRecordedCannotRun,
  recordedSendNotices,
  expectRecordedMessageDelivered,
} from './lib/recorded-send'
import { newConversationGive, readSuccessfulGive } from './lib/give-fixture'
import { personOpener } from './helpers/person-opens-session'
import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRuntime } from '@brobot2/runtime/claude'
import { CodexRuntime, createSpawnTransportFactory } from '@brobot2/runtime/codex'
import { FakeProviderSessions, ResumeError } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import {
  aSpawnRefusedAfterItsPipes,
  aSpawnThatRanOutOf,
} from '../../../packages/runtime/test/fixtures/a-spawn-that-failed'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'

/**
 * ⚑ **Codex's transport spawns through `node:child_process` with no seam**, so the ONE spawn a test
 * wants to fail is armed here; every other spawn in the module graph reaches the real function.
 */
const armed = vi.hoisted(() => ({ next: null as null | (() => unknown) }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return {
    ...real,
    spawn: (...args: unknown[]): unknown => {
      const next = armed.next
      armed.next = null
      return next === null ? (real.spawn as (...given: unknown[]) => unknown)(...args) : next()
    },
  }
})

/**
 * # 🔴 705 · R39 — a shortage that clears by itself is not *until a person changes it*
 *
 * ⚑ **PM ruling R39** (`697` H-c): *"a transient setup failure (`spawn EMFILE`) is never until a
 * person changes it — a retryable word that says so."*
 *
 * ⛔ **What a wake answered on `main`, for a machine that ran short for a moment**: the one word a
 * `ResumeError` could reach — `that-conversation-could-not-be-resumed`, `until-a-person-changes-it`,
 * *"Waking it again will not help until a person has looked"* — on BOTH providers, because neither
 * adapter's error said which errno it was (`packages/runtime/test/the-errno-a-resume-carries.test.ts`). ⚑ **The errors below are the ADAPTERS' OWN**, made by the real `ClaudeRuntime`
 * over the SDK's real `query()` and the real `CodexRuntime` over its real transport, each handed a
 * spawn that failed in the shape Node gives it (measured in that file's §0) — and then handed to
 * the wake exactly as `what-a-wake-still-says-wrong.test.ts` §3.3 hands one.
 *
 * ⚑ **D-017 — the wake is the start a MESSAGE makes** (`resume_agent` and `end_agent` are gone):
 * the worker is stopped by the app, and its parent's `message_agent` starts it again — and a start
 * that does not happen is answered in the wake's words, with its true reason (R1).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ The new word — spelled here as a string, so `main` (which has no such word) can run this file. */

describe('705 · R39 — a shortage that clears by itself', () => {
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

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-705-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-705-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_050_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    armed.next = null
  })

  afterEach(async () => {
    armed.next = null
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const personOpens = personOpener(() => ({ host, root, window }), 'auto')

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
   * ⚑ A PM a person opened, and one `worker` it gave work to, and then stopped. ⚑ **D-016 · the
   * give starts the worker and its brief is the worker's first turn** — the start and the work in
   * one call.
   */
  const aWorkerOver = async (): Promise<{ pm: string; worker: string; piece: string }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const given = await readSuccessfulGive(() =>
      callOn(pm, 'give_work', newConversationGive('worker', 'the work', 'migrate the schema')),
    )
    const worker = given.agent as string
    const piece = given.piece as string
    await waitFor(() => turnsIn(worker) > 0, 'the turn the work opened to end')
    expect(store.piecesOwnedBy(worker).some((one) => TASK_IS_OPEN[one.state])).toBe(true)
    // ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone): the app's own stop.
    await host.close(worker, THE_APP_ITSELF)
    await waitFor(
      () =>
        ![...host.resumableSessions()].some(
          (row) => row.sessionId === worker && row.running !== 'not-running',
        ),
      'the worker to be over',
    )
    return { pm, worker, piece }
  }

  /**
   * ⚑ **The wake — D-017: the parent's MESSAGE, which starts the stopped worker** (`resume_agent`
   * is gone). A follow-up, since the worker holds the parent's work — ⚑ **D-016 · naming that
   * piece**, which a follow-up must.
   */
  const theWake = (pm: string, worker: string, piece: string) => {
    const tool = agentToolsFor(host, pm).tools.find((one) => one.name === 'message_agent')
    if (tool === undefined) throw new Error('no message_agent')
    return tool.call({ agent: worker, text: 'carry on', piece })
  }

  const shortageWords = (code: string): string =>
    code === 'EMFILE' ? 'BroCrew had too many files open' : 'ran short of open files'
  const programFailure = 'could not run its provider’s program'

  const remainsQueued = (worker: string, messageId: string): void => {
    expect(store.messagesWaitingIn(worker)).toContainEqual(
      expect.objectContaining({ messageId, text: 'carry on' }),
    )
  }

  // ───────────────────────────────────────────────────────────────────────────────
  // the adapters' own errors
  // ───────────────────────────────────────────────────────────────────────────────

  /** ⚑ Claude: the SDK's real `query()`, on the adapter's own spawn seam. */
  const claudeResumeOver = async (child: () => unknown): Promise<Error> => {
    const produced = await new ClaudeRuntime(
      undefined,
      async () => true,
      undefined,
      undefined,
      () => child() as never,
    )
      .resume(
        { provider: 'claude', sessionId: 'sess_705', cwd: root, rotation: 0 },
        { providerHome: join(root, 'claude-home-705') },
      )
      .catch((thrown: unknown) => thrown)
    expect(produced).toBeInstanceOf(ResumeError)
    return produced as Error
  }

  /** ⚑ Codex: the real transport and resume; a command that does not exist, in case it is unarmed. */
  const codexResumeOver = async (child: () => unknown): Promise<Error> => {
    armed.next = child
    const produced = await new CodexRuntime(
      createSpawnTransportFactory('/nonexistent/brobot2-705/codex'),
    )
      .resume(
        { provider: 'codex', sessionId: 'thr_705', cwd: root, rotation: 0 },
        { providerHome: join(root, 'codex-home-705') },
      )
      .catch((thrown: unknown) => thrown)
    expect(produced).toBeInstanceOf(ResumeError)
    return produced as Error
  }

  const SHORTAGES = [
    {
      name: 'Claude, a spawn EMFILE',
      code: 'EMFILE',
      make: () => claudeResumeOver(() => aSpawnThatRanOutOf('EMFILE', '/x/claude').child),
    },
    {
      name: 'Codex, a spawn EMFILE',
      code: 'EMFILE',
      make: () => codexResumeOver(() => aSpawnThatRanOutOf('EMFILE', '/x/codex').child),
    },
    {
      name: 'Codex, a spawn EAGAIN after its pipes',
      code: 'EAGAIN',
      make: () => codexResumeOver(() => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/codex').child),
    },
    // ⚑ **705 review** — every code the word is chosen for goes through a wake on a provider, and
    // Claude's pipes-made arm, which on `main` never reached any word: `resume()` returned a handle.
    {
      name: 'Claude, a spawn EAGAIN after its pipes',
      code: 'EAGAIN',
      make: () => claudeResumeOver(() => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/claude').child),
    },
    {
      name: 'Codex, a spawn ENFILE',
      code: 'ENFILE',
      make: () => codexResumeOver(() => aSpawnThatRanOutOf('ENFILE', '/x/codex').child),
    },
    {
      name: 'Claude, a spawn ENOMEM thrown at once',
      code: 'ENOMEM',
      make: () =>
        claudeResumeOver(() => {
          throw Object.assign(new Error('spawn ENOMEM'), { code: 'ENOMEM', syscall: 'spawn' })
        }),
    },
  ] as const

  // ───────────────────────────────────────────────────────────────────────────────
  // §1 · the word, its price, and the retry it asks for
  // ───────────────────────────────────────────────────────────────────────────────

  describe.each(SHORTAGES)('§1 · $name', ({ code, make }) => {
    const messageAfterFailedWake = async () => {
      const produced = await make()
      const { pm, worker, piece } = await aWorkerOver()
      gate.resumeFails = () => produced
      const answer = await theWake(pm, worker, piece)
      const kept = expectRecordedCannotRun(
        answer.structured as Record<string, unknown>,
        'message',
        shortageWords(code),
        false,
      )
      return { pm, worker, kept, answer }
    }

    it('keeps the message and reports a temporary start failure', async () => {
      const { worker, kept, answer } = await messageAfterFailedWake()
      expect(kept.recipient.id).toBe(worker)
      remainsQueued(worker, kept.recorded.id)
      expect(answer.text).not.toContain('Ask the person to fix it')
    })

    it('starts the same conversation and delivers the kept message once when the shortage clears', async () => {
      const { pm, worker, kept } = await messageAfterFailedWake()
      gate.resumeFails = undefined
      expect(
        await callOn(pm, 'message_agent', {
          agent: kept.recipient.address,
          text: 'the cause is fixed',
        }),
      ).toMatchObject({
        outcome: 'ok',
        receipt: { recipient: { id: worker } },
      })
      await expectRecordedMessageDelivered(() => events(worker), kept.recorded.id, 'carry on')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §2 · the controls — a real *never* keeps the permanent word
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§2 · a real never keeps the permanent word', () => {
    it('a missing provider session is not a shortage or a successful replacement', async () => {
      const { pm, worker, piece } = await aWorkerOver()
      issued.forgetAll()
      const address = store.workById(piece)?.label
      expect(address).toMatch(/^W/)
      const before = store.recorded().map(({ sessionId }) => sessionId)
      const answer = await theWake(pm, worker, piece)
      expect(answer.structured).toMatchObject({
        outcome: 'ok',
        receipt: {
          recorded: { kind: 'message', id: expect.any(String) },
          recipient: {
            id: worker,
            address,
            state: { kind: 'cannot-run', cause: { code: 'provider-file-missing' } },
          },
        },
      })
      expect(answer.text).toContain('its session file is missing')
      expect(store.messagesWaitingIn(worker)).toContainEqual(
        expect.objectContaining({ text: 'carry on' }),
      )
      expect(store.recorded().map(({ sessionId }) => sessionId)).toEqual(before)
      expect(store.replacements()).toEqual([])
    })

    it('⚑ a spawn a PERSON has to fix — the binary not there — on each provider', async () => {
      for (const produced of [
        await claudeResumeOver(() => {
          throw Object.assign(new Error('spawn /x/claude ENOTDIR'), {
            code: 'ENOTDIR',
            syscall: 'spawn /x/claude',
          })
        }),
        await codexResumeOver(() => aSpawnRefusedAfterItsPipes('ENOENT', '/x/codex').child),
      ]) {
        const { pm, worker, piece } = await aWorkerOver()
        gate.resumeFails = () => produced
        const answer = await theWake(pm, worker, piece)
        const kept = expectRecordedCannotRun(
          answer.structured as Record<string, unknown>,
          'message',
          programFailure,
          true,
        )
        expect(kept.recipient.id).toBe(worker)
        remainsQueued(worker, kept.recorded.id)
        gate.resumeFails = undefined
      }
    })
  })

  /**
   * 🔴 **705 review · Claude's pipes-made arm, for a failure a PERSON has to fix** — not a control:
   * on `main` Claude's `resume()` handed back a handle for it (`ENOENT` reaches the child a tick after
   * `spawn`, with its pipes made), so no wake word was ever given and the wake said `ok`.
   */
  describe('§2b · Claude, a binary that is not there, after its pipes', () => {
    it('🔴 the permanent word — never a wake that says it woke', async () => {
      const produced = await claudeResumeOver(
        () => aSpawnRefusedAfterItsPipes('ENOENT', '/x/claude').child,
      )
      const { pm, worker, piece } = await aWorkerOver()
      gate.resumeFails = () => produced
      const answer = await theWake(pm, worker, piece)
      const kept = expectRecordedCannotRun(
        answer.structured as Record<string, unknown>,
        'message',
        programFailure,
        true,
      )
      remainsQueued(worker, kept.recorded.id)
      expect(host.sessionIds).not.toContain(worker)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────
  // §3 · standing rule 8.4 — what a PERSON sees at it
  // ───────────────────────────────────────────────────────────────────────────────

  describe('§3 · what a person reads in the transcript', () => {
    const noticesOf = (sessionId: string) => recordedSendNotices(events(sessionId))

    it('keeps the sent-message history and says how to retry after a shortage', async () => {
      const produced = await SHORTAGES[1].make()
      const { pm, worker, piece } = await aWorkerOver()
      gate.resumeFails = () => produced
      const answer = await theWake(pm, worker, piece)
      const kept = expectRecordedCannotRun(
        answer.structured as Record<string, unknown>,
        'message',
        shortageWords(SHORTAGES[1].code),
        false,
      )
      expect(noticesOf(pm).some((text) => text.startsWith('refused: message_agent'))).toBe(false)
      expect(events(pm)).toContainEqual(
        expect.objectContaining({
          type: 'message_sent',
          messageId: kept.recorded.id,
          to: worker,
        }),
      )
      expect(answer.text).toContain('send a message to this address to try starting it again.')
      expect(answer.text).not.toContain('Ask the person to fix it')
    })

    it('tells the giver when a person can fix the provider program', async () => {
      const produced = await claudeResumeOver(
        () => aSpawnRefusedAfterItsPipes('ENOENT', '/x/claude').child,
      )
      const { pm, worker, piece } = await aWorkerOver()
      gate.resumeFails = () => produced
      const answer = await theWake(pm, worker, piece)
      expectRecordedCannotRun(
        answer.structured as Record<string, unknown>,
        'message',
        programFailure,
        true,
      )
      expect(noticesOf(pm).some((text) => text.startsWith('refused: message_agent'))).toBe(false)
      expect(answer.text).toContain('Ask the person to fix it, with request_action.')
    })
  })
})

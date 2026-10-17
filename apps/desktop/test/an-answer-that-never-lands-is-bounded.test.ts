import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AnswerRefused,
  FakeRuntime,
  type FakeSessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **742 · `739` F-6 — a person's answer the provider never takes is BOUNDED.**
 *
 * ⛔ **The defect**: `respondPermission` and `respondUserInput` awaited the adapter's answer with no
 * bound. An adapter whose answer never settles held the person's IPC for good — the card dark, and
 * Home saying *"answer sent — waiting for the conversation to settle"* with nothing ever following
 * (standing rule 8.4). ⚑ Now the door waits `interruptWaitMs` — `interrupt`'s own bound — and then
 * answers `unacknowledged`, releasing the waiter and not the work: an answer that lands later is
 * recorded then.
 *
 * ⚠️ **Neither adapter on `main` can hang here**: both spend the request and write the answer
 * synchronously. So the RED is by a provider double whose answer is PARKED — the brief's *"transport
 * that never answers"* — which the handle's contract (`Promise<void>`) allows. The control is the
 * same double answering at once, which is every provider on `main`.
 *
 * | § | the answer | what the door must do |
 * |---|---|---|
 * | **1** | a decision the provider never takes | answer `unacknowledged` after the bound, record nothing |
 * | **2** | …and then takes, late | record it then, and the turn goes on |
 * | **3** | …and then takes, after the conversation was closed | record nothing on a life put away |
 * | **4** | …and then refuses, late | log it — never an unhandled rejection, never a row |
 * | **5** | a question's answer: never taken, taken late, taken after a close, a fault late | the same as §1–§4 |
 * | **6** ⚑ control | taken at once, refused at once (rejected or thrown), a fault at once | exactly as on `main` |
 * | **7** | the wire | `unacknowledged` and `waitedMs` reach the window |
 *
 * ⚑ **What a person sees at the limit (rule 8.4)**: the door answers, so nothing holds the window;
 * the card is the provider's question still, and the words for *"not acknowledged"* are `743`'s.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ Short, so the test measures the bound and not the clock; `main` has no bound at all. */
const WAIT_MS = 40
/**
 * ⚑ **How long a door may take to answer** — well past `WAIT_MS`, and well short of the host's
 * default two seconds, so a bound that was not the one configured reads as `pending` too.
 */
const SOON_MS = 1_000

class AWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

class CountingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
  ) {
    super(provider)
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
}

type Door = 'respondPermission' | 'respondUserInput'

/**
 * ⚑ **An adapter that has taken the call and not finished it** — the parked answer. `land` hands
 * the answer to the double's own door and settles with what it did; `settle` says done without
 * touching it (an answer the provider took some other way); `fail` rejects.
 */
interface Parked {
  readonly calls: number
  land(): Promise<void>
  settle(): void
  fail(error: unknown): void
}

function park(handle: FakeSessionHandle, door: Door): Parked {
  const real = (handle[door] as (...args: unknown[]) => Promise<void>).bind(handle)
  let calls = 0
  let args: unknown[] = []
  let resolve: () => void = () => {}
  let reject: (error: unknown) => void = () => {}
  ;(handle as unknown as Record<Door, (...args: unknown[]) => Promise<void>>)[door] = (
    ...given: unknown[]
  ) =>
    new Promise<void>((yes, no) => {
      calls += 1
      args = given
      resolve = yes
      reject = no
    })
  return {
    get calls() {
      return calls
    },
    async land() {
      try {
        await real(...args)
        resolve()
      } catch (error) {
        reject(error)
      }
    },
    settle: () => resolve(),
    fail: (error) => reject(error),
  }
}

/** ⚑ Where a promise stands after `ms` — `'pending'` is the hang, as a value an assertion names. */
async function within(ms: number, promise: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<{ state: 'pending' }>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'pending' }), ms)
  })
  try {
    return await Promise.race([
      promise.then(
        (value) => ({ state: 'resolved', value }),
        (error: unknown) => ({
          state: 'rejected',
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      late,
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

describe('742 · an answer that never lands is bounded (739 F-6)', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let counter: number
  let window: AWindow
  let unhandled: unknown[]
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-742-'))
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-742-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    handles = []
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new CountingRuntime(provider, handles),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      interruptWaitMs: WAIT_MS,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new AWindow('webContents:1')
  })

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const decisions = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).filter((event) => event.type === 'user_decision')

  /** A conversation parked on a permission card, and the card's id. */
  const aCard = async (): Promise<{ id: string; card: string; handle: FakeSessionHandle }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    await host.send(id, 'edit the file', window)
    await waitFor(
      () => ledger(id).some((event) => event.type === 'permission_request'),
      'the turn to park on its card',
    )
    const card = ledger(id).find((event) => event.type === 'permission_request') as
      { id: string } | undefined
    const handle = handles.at(-1)
    if (card === undefined || handle === undefined) throw new Error('no card')
    return { id, card: card.id, handle }
  }

  /** A conversation with a provider's question open, and its id. */
  const aQuestion = async (): Promise<{ id: string; card: string; handle: FakeSessionHandle }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no handle')
    const { id: card } = handle.simulateUserInput('Which one?', ['this', 'that'])
    await waitFor(
      () => ledger(id).some((event) => event.type === 'user_input_request'),
      'the question to reach the ledger',
    )
    return { id, card, handle }
  }

  const UNACKNOWLEDGED = { outcome: 'unacknowledged', waitedMs: WAIT_MS }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1–§4 · a decision on a permission card
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1–§4 · a decision the provider does not take', () => {
    it('🔴 §1 · the door answers `unacknowledged` after the bound, and records nothing', async () => {
      const { id, card, handle } = await aCard()
      const parked = park(handle, 'respondPermission')
      const door = host.respondPermission(id, card, { outcome: 'allow' }, window)
      // ⛔ **On `main` this is `pending` for good** — the host awaited an answer that never comes.
      expect(await within(SOON_MS, door)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
      expect(parked.calls).toBe(1)
      // ⚑ **Nothing is recorded as taken** — standing rule 18: the ledger says an answer was taken
      // only when it was.
      expect(decisions(id)).toEqual([])
    })

    it('🔴 §2 · a decision the provider takes LATE is recorded then, and the turn goes on', async () => {
      const { id, card, handle } = await aCard()
      const parked = park(handle, 'respondPermission')
      const door = host.respondPermission(id, card, { outcome: 'allow' }, window)
      expect(await within(SOON_MS, door)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
      expect(decisions(id)).toEqual([])
      // ⚑ **The waiter was released, not the work**: the answer lands, and the row that settles
      // the card is written when it does.
      await parked.land()
      await letItSettle()
      expect(decisions(id)).toEqual([
        { type: 'user_decision', requestId: card, outcome: 'allow', by: { who: 'a-person' } },
      ])
      await waitFor(
        () => ledger(id).some((event) => event.type === 'tool_result'),
        'the tool the card was about to run',
      )
      expect(unhandled).toEqual([])
    })

    it('🔴 §3 · …but never on a conversation that was closed while it waited', async () => {
      const { id, card, handle } = await aCard()
      const parked = park(handle, 'respondPermission')
      const door = host.respondPermission(id, card, { outcome: 'allow' }, window)
      expect(await within(SOON_MS, door)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
      await host.close(id, window)
      const rowsAtTheClose = ledger(id).length
      // ⚑ **The adapter says done** after the life it answered for was put away.
      parked.settle()
      await letItSettle()
      // ⛔ **A row after the ending** would say a person's answer was taken by a conversation that
      // had ended — its card went with it.
      expect(decisions(id)).toEqual([])
      expect(ledger(id)).toHaveLength(rowsAtTheClose)
      expect(unhandled).toEqual([])
    })

    it('🔴 §4 · a LATE refusal is logged — never unhandled, never a row', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { id, card, handle } = await aCard()
      const parked = park(handle, 'respondPermission')
      const door = host.respondPermission(id, card, { outcome: 'allow' }, window)
      expect(await within(SOON_MS, door)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
      parked.fail(new AnswerRefused('not-pending', 'the request was settled another way'))
      await letItSettle()
      expect(unhandled).toEqual([])
      expect(decisions(id)).toEqual([])
      expect(
        warned.mock.calls.some((call) =>
          String(call[0]).includes(
            `answering ${card} did not complete after the host stopped waiting`,
          ),
        ),
      ).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · an answer to a provider's question
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · an answer to a question the provider does not take', () => {
    const THIS = { kind: 'answer', answers: { q0: 'this' } } as const

    it('🔴 §5.1 · the door answers `unacknowledged` after the bound, and records nothing', async () => {
      const { id, card, handle } = await aQuestion()
      const parked = park(handle, 'respondUserInput')
      const door = host.respondUserInput(id, card, THIS, window)
      // ⛔ **On `main` this is `pending` for good**, as §1's is.
      expect(await within(SOON_MS, door)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
      expect(parked.calls).toBe(1)
      expect(decisions(id)).toEqual([])
    })

    it('🔴 §5.2 · an answer the provider takes LATE is recorded then', async () => {
      const { id, card, handle } = await aQuestion()
      const parked = park(handle, 'respondUserInput')
      const door = host.respondUserInput(id, card, THIS, window)
      expect(await within(SOON_MS, door)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
      await parked.land()
      await letItSettle()
      expect(decisions(id)).toEqual([
        { type: 'user_decision', requestId: card, outcome: 'answered', by: { who: 'a-person' } },
      ])
      expect(unhandled).toEqual([])
    })

    it('🔴 §5.3 · …but never on a conversation that was closed while it waited', async () => {
      const { id, card, handle } = await aQuestion()
      const parked = park(handle, 'respondUserInput')
      const door = host.respondUserInput(id, card, THIS, window)
      expect(await within(SOON_MS, door)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
      await host.close(id, window)
      const rowsAtTheClose = ledger(id).length
      parked.settle()
      await letItSettle()
      expect(decisions(id)).toEqual([])
      expect(ledger(id)).toHaveLength(rowsAtTheClose)
      expect(unhandled).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5.4 · a late FAULT, on the question door
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§5.4 · a fault after the bound, on the other door', () => {
    it('🔴 a LATE fault is logged — never unhandled, never a row', async () => {
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { id, card, handle } = await aQuestion()
      const parked = park(handle, 'respondUserInput')
      const door = host.respondUserInput(
        id,
        card,
        { kind: 'answer', answers: { q0: 'this' } },
        window,
      )
      expect(await within(SOON_MS, door)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
      parked.fail(new Error('the transport broke'))
      await letItSettle()
      expect(unhandled).toEqual([])
      expect(decisions(id)).toEqual([])
      expect(
        warned.mock.calls.some((call) =>
          String(call[0]).includes(
            `answering ${card} did not complete after the host stopped waiting: the transport broke`,
          ),
        ),
      ).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §6 · ⚑ the control — a provider that answers is unchanged
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · ⚑ control — a provider that answers, as every provider on `main` does', () => {
    it('⚑ a decision taken at once: `taken`, and its row is written before the door returns', async () => {
      const { id, card } = await aCard()
      expect(await host.respondPermission(id, card, { outcome: 'deny' }, window)).toEqual({
        outcome: 'taken',
      })
      expect(decisions(id)).toEqual([
        { type: 'user_decision', requestId: card, outcome: 'deny', by: { who: 'a-person' } },
      ])
    })

    it('⚑ an answer taken at once: `taken`, and its row is written before the door returns', async () => {
      const { id, card } = await aQuestion()
      expect(
        await host.respondUserInput(id, card, { kind: 'answer', answers: { q0: 'that' } }, window),
      ).toEqual({ outcome: 'taken' })
      expect(decisions(id)).toEqual([
        { type: 'user_decision', requestId: card, outcome: 'answered', by: { who: 'a-person' } },
      ])
    })

    it('⚑ a refusal at once is still the refusal, in its sentence', async () => {
      const { id, card } = await aCard()
      await host.respondPermission(id, card, { outcome: 'allow' }, window)
      // ⚑ The same card again: the provider is no longer waiting for it.
      expect(await host.respondPermission(id, card, { outcome: 'allow' }, window)).toEqual({
        outcome: 'refused',
        reason: 'the agent is no longer waiting for an answer to this',
        stillOpen: false,
      })
    })

    it('⚑ a handle that THROWS its refusal, rather than rejecting, is still classified', async () => {
      const { id, card, handle } = await aCard()
      ;(handle as unknown as { respondPermission: () => never }).respondPermission = () => {
        throw new AnswerRefused('not-pending', `permission request ${card} is not pending`)
      }
      expect(
        await within(SOON_MS, host.respondPermission(id, card, { outcome: 'allow' }, window)),
      ).toEqual({
        state: 'resolved',
        value: {
          outcome: 'refused',
          reason: 'the agent is no longer waiting for an answer to this',
          stillOpen: false,
        },
      })
    })

    it('⚑ a fault at once still throws — it is neither a refusal nor `unacknowledged`', async () => {
      const { id, card, handle } = await aCard()
      const parked = park(handle, 'respondPermission')
      const door = host.respondPermission(id, card, { outcome: 'allow' }, window)
      parked.fail(new Error('the transport broke'))
      expect(await within(SOON_MS, door)).toEqual({
        state: 'rejected',
        message: 'the transport broke',
      })
      expect(decisions(id)).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the wire carries it
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the fact reaches the window, for `743` to draw', () => {
    it('🔴 the IPC answers `unacknowledged` with the bound it waited', async () => {
      const { id, card, handle } = await aCard()
      park(handle, 'respondPermission')
      const answer = executeRuntimeCommand(host, window, {
        kind: 'respondPermission',
        sessionId: id,
        requestId: card,
        decision: { outcome: 'allow' },
      })
      expect(await within(SOON_MS, answer)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
    })

    it('🔴 …and for a question’s answer too', async () => {
      const { id, card, handle } = await aQuestion()
      park(handle, 'respondUserInput')
      const answer = executeRuntimeCommand(host, window, {
        kind: 'respondUserInput',
        sessionId: id,
        requestId: card,
        response: { kind: 'answer', answers: { q0: 'this' } },
      })
      expect(await within(SOON_MS, answer)).toEqual({ state: 'resolved', value: UNACKNOWLEDGED })
    })
  })
})

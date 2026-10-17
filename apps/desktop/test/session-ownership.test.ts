import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentRuntime,
  RuntimeEvent,
  SessionHandle,
  SessionRef,
  SessionStatus,
} from '@brobot2/runtime'
// Read-only reach into the runtime's internals, on the same terms as `liveness.test.ts`: the queue
// is not on the package's public surface and the package is GO-locked, but the OVERFLOW this file
// tests is a property of that exact class. A hand-rolled imitation would prove the imitation works.
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * **A session must not stop being owned before it stops existing** (051, from 048 §1 finding 3).
 *
 * There were four ways a session could end and only one of them closed the provider. The other
 * three deleted the host's map entry — which is the only handle able to stop a Claude query or reap
 * a detached Codex process group — and then reported the session dead to the renderer. `closeAll()`
 * on quit could no longer reach it. The worst of the three is an event-stream FAILURE, because the
 * commonest cause is an `AsyncQueue` overflow: the queue fails itself when the producer outruns the
 * consumer, so the failure is on OUR side of the pipe and the provider is still running, possibly
 * unattended.
 *
 * Driven against a real SQLite database, because half of what the finalizer does is durable and the
 * old code left it undone: `error{fatal:true}` is terminal to liveness and to the renderer and means
 * nothing to the store's reducer, so a failed stream left the row at `working` with its turn open.
 * A fake store cannot show that.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

/**
 * A provider we drive by hand. Its event stream is a REAL {@link AsyncQueue}, so "the queue
 * overflowed" is the queue's own behaviour rather than a story this file tells about it.
 *
 * What it records is the ORDER of teardown, which is the property under test: `closedWhileRegistered`
 * is read from the host at the moment `close()` is called, so "the handle is closed before the
 * session is unregistered" is asserted directly instead of through a proxy for it.
 *
 * ⚠️ **Where it diverges from the real adapters, and why that is the point.** Both real handles emit
 * `session:'ended'` and `status:'ended'` through the queue before closing it (`claude-runtime.ts`
 * `doClose`, `codex-runtime.ts` `doClose`), which is what makes the store terminalize on an ordinary
 * close today. This one closes the queue silently — so the terminal rows asserted below can ONLY
 * have come from the finalizer. An adapter-faithful double would have made every assertion here pass
 * without `store.terminate` existing at all, which is exactly the vacuity to avoid: the finalizer is
 * the belt for adapters that do not say goodbye, and this is an adapter that does not.
 */
class ScriptedHandle implements SessionHandle {
  readonly queue: AsyncQueue<RuntimeEvent>
  closes = 0
  closedWhileRegistered: number[] = []
  /** Set to make `close()` outlast the host's bound, for the "provider will not stop" path. */
  closeDelayMs = 0
  private state: SessionStatus = 'idle'

  constructor(
    readonly ref: SessionRef,
    private readonly registeredCount: () => number,
    highWaterMark?: number,
  ) {
    this.queue = new AsyncQueue<RuntimeEvent>(highWaterMark)
  }

  events(): AsyncIterable<RuntimeEvent> {
    return this.queue
  }
  status(): SessionStatus {
    return this.state
  }
  /**
   * ⚑ **446 · declared and inert**, for `QuietRuntime`'s reason in `runtime-host.test.ts`: this
   * double publishes its own statuses by hand and holds no `SessionMachine` to count into.
   */
  waitForAPerson(): () => void {
    return (): void => {}
  }
  send(): Promise<void> {
    this.state = 'working'
    return Promise.resolve()
  }
  respondPermission(): Promise<void> {
    return Promise.resolve()
  }
  respondUserInput(): Promise<void> {
    return Promise.resolve()
  }
  interrupt(): Promise<void> {
    return Promise.resolve()
  }
  setApprovalMode(): Promise<void> {
    return Promise.resolve()
  }
  get approval(): { effective: 'ask' | 'auto'; requested: 'ask' | 'auto' } {
    return { effective: 'ask', requested: 'ask' }
  }
  readonly blanketGrants: readonly string[] = []
  readonly planNeedsGoAhead = false
  readonly settings = {
    model: { effective: undefined, requested: undefined },
    reasoningEffort: { effective: undefined, requested: undefined },
    planMode: { effective: false, requested: false },
  }
  setWorkFolders(): void {}
  readonly workFolders = { effective: [], requested: [] }
  setPlanMode(): Promise<void> {
    return Promise.reject(new Error('not planning'))
  }
  setModel(): Promise<void> {
    return Promise.resolve()
  }
  setReasoningEffort(): Promise<void> {
    return Promise.resolve()
  }

  async close(): Promise<void> {
    this.closes += 1
    this.closedWhileRegistered.push(this.registeredCount())
    if (this.closeDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.closeDelayMs))
    }
    this.state = 'idle'
    this.queue.close()
  }

  /** Push events with no consumer running yet — the shape that overflows a bounded queue. */
  flood(count: number): void {
    for (let i = 0; i < count; i++) {
      this.queue.push({ type: 'assistant_delta', text: `chunk ${i}` })
    }
  }
}

describe('one finalizer owns the end of a session (051)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sink: RecordingSink
  let handle: ScriptedHandle

  /** The host, wired to one scripted provider. `highWaterMark` is the queue's, for the overflow. */
  function buildHost(options: { highWaterMark?: number; closeDrainTimeoutMs?: number } = {}) {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider: Provider): AgentRuntime => ({
        provider,
        // ⚑ **D-042 · R1 moved a fact here: every start NAMES its model and effort**, and a Codex
        // start naming nothing reads `model/list` and names its `isDefault` row at that row's own
        // default effort — an empty list now refuses the launch (`nothing-names-a-model`, F2)
        // before the finalizer this file is about is ever reached. One row, marked as Codex marks
        // its default (`codex-runtime.ts`' `model/list` mapping), is the least a real login answers.
        listModels: async () => [
          {
            id: 'scripted',
            label: 'scripted',
            isDefault: true,
            efforts: [{ id: 'medium', label: 'medium' }],
            defaultEffort: 'medium',
          },
        ],
        start: () => {
          handle = new ScriptedHandle(
            { provider, sessionId: 'provider-session', cwd: dir, rotation: 0 },
            () => built.sessionIds.length,
            options.highWaterMark,
          )
          return Promise.resolve(handle)
        },
        resume: () => Promise.reject(new Error('not used here')),
      }),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => 'sess_1',
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'scripted',
        authNote: null,
        files: [],
      }),
      ...(options.closeDrainTimeoutMs === undefined
        ? {}
        : { closeDrainTimeoutMs: options.closeDrainTimeoutMs }),
    })
    return built
  }

  /** Open a session and take one turn, so there is an OPEN turn for the ending to have to close. */
  async function openSessionMidTurn(): Promise<string> {
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await host.send(created.sessionId, 'do the thing', sink)
    expect(store.turns(created.sessionId)[0]?.closedAt).toBeNull()
    return created.sessionId
  }

  const row = (id: string) =>
    db.prepare('SELECT status FROM provider_session WHERE id = ?').get(id) as { status: string }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-ownership-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    host = buildHost()
    sink = new RecordingSink()
  })

  afterEach(() => {
    // No `closeAll()` here: several of these tests end with a deliberately wedged session, and the
    // point of the bound inside the finalizer is that teardown does not wait on one forever.
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('closes the provider before it unregisters the session, on an explicit close', async () => {
    const id = await openSessionMidTurn()
    await host.close(id, sink)

    expect(handle.closes).toBe(1)
    // The ownership property, read from the host at the moment of the close rather than inferred:
    // the session was still in the map, so `closeAll()` could still have reached it. ⚠️ This one
    // path always held — the old `tearDown` closed the handle first too — so this case is a
    // REGRESSION GUARD, not evidence of the fix. The three below it are the evidence.
    expect(handle.closedWhileRegistered).toEqual([1])
    expect(host.sessionIds).toEqual([])
    expect(row(id).status).toBe('ended')
    expect(store.turns(id)[0]).toMatchObject({ endReason: 'ended' })
  })

  it('closes the provider when the stream simply ENDS — the path that never did', async () => {
    const id = await openSessionMidTurn()
    // The provider's own stream finishing, with nobody having asked us to close.
    handle.queue.close()

    await waitFor(() => host.sessionIds.length === 0, 'the session to be unregistered')
    expect(handle.closes).toBe(1)
    expect(handle.closedWhileRegistered).toEqual([1])
    expect(row(id).status).toBe('ended')
    expect(store.turns(id)[0]?.closedAt).not.toBeNull()
  })

  it('closes the provider when the stream FAILS, and records the session as errored', async () => {
    const id = await openSessionMidTurn()
    handle.queue.fail(new Error('transport died'))

    await waitFor(() => host.sessionIds.length === 0, 'the session to be unregistered')
    // The renderer is told, as it always was...
    expect(sink.events().at(-1)).toEqual({
      type: 'error',
      message: 'event stream failed: transport died',
      fatal: true,
    })
    // ...and now the provider is actually stopped, and the session is durably over. Before 051 the
    // handle was dropped here and the row stayed at `working` with an open turn: a session that
    // would come back from a restart claiming to be mid-turn, over a provider nobody could reach.
    expect(handle.closes).toBe(1)
    expect(handle.closedWhileRegistered).toEqual([1])
    expect(row(id).status).toBe('errored')
    expect(store.turns(id)[0]).toMatchObject({ endReason: 'ended' })
    expect(store.turns(id)[0]?.closedAt).not.toBeNull()
  })

  it('finalizes a session whose stream never drains, instead of only forgetting it', async () => {
    host = buildHost({ closeDrainTimeoutMs: 40 })
    const id = await openSessionMidTurn()
    // A provider that acknowledges the close and then never ends its stream. `close()` used to
    // delete the map entry here and stop — no terminal state, no turn closed, liveness still armed.
    const wedged = handle
    wedged.close = async (): Promise<void> => {
      wedged.closes += 1
      wedged.closedWhileRegistered.push(host.sessionIds.length)
      await Promise.resolve()
    }

    await host.close(id, sink)

    expect(wedged.closes).toBe(1)
    // The ownership property on THIS path too. It is the path where it was most obviously missing —
    // the map entry was deleted with the provider still producing — so leaving it unasserted here
    // would have tested the criterion everywhere except where it failed.
    expect(wedged.closedWhileRegistered).toEqual([1])
    expect(host.sessionIds).toEqual([])
    expect(row(id).status).toBe('ended')
    expect(store.turns(id)[0]).toMatchObject({ endReason: 'ended' })
    wedged.queue.close()
  })

  it('does not let a provider that will not stop hang the quit', async () => {
    host = buildHost({ closeDrainTimeoutMs: 40 })
    const id = await openSessionMidTurn()
    handle.closeDelayMs = 5_000

    // `closeAll()` is what `before-quit` blocks the whole application on, so an adapter whose
    // teardown never settles must not be able to hold it. Bounded, reported, and finalized anyway.
    await host.closeAll()
    expect(host.sessionIds).toEqual([])
    expect(row(id).status).toBe('ended')
  })

  it('tears the provider down when the QUEUE overflows — a consumer failure, a provider still live', async () => {
    // The real bound, made small. An overflow is the queue failing ITSELF because the producer
    // outran the consumer; nothing tells the adapter, so before 051 the Claude query or the Codex
    // child carried on running while the app let go of the only handle that could stop it.
    host = buildHost({ highWaterMark: 2 })
    const id = await openSessionMidTurn()
    handle.flood(6)

    await waitFor(() => host.sessionIds.length === 0, 'the session to be unregistered')
    const last = sink.events().at(-1)
    expect(last).toMatchObject({ type: 'error', fatal: true })
    expect((last as { message: string }).message).toMatch(/AsyncQueue overflow/)
    expect(handle.closes).toBe(1)
    expect(handle.closedWhileRegistered).toEqual([1])
    expect(row(id).status).toBe('errored')
    // Acceptance 4 on this path too: an overflow is a fatal error like any other, so it must not
    // leave a turn open behind an errored session.
    expect(store.turns(id)[0]).toMatchObject({ endReason: 'ended' })
    expect(store.turns(id)[0]?.closedAt).not.toBeNull()
  })

  it('records the FAILURE when a failed stream is then closed, not the close', async () => {
    const id = await openSessionMidTurn()
    // The stream fails and the app quits in the same tick — the shape a crash during shutdown has.
    handle.queue.fail(new Error('transport died'))
    await Promise.all([host.close(id, sink), host.closeAll(), host.close(id, sink)])
    await waitFor(() => host.sessionIds.length === 0, 'the session to be unregistered')

    expect(handle.closes).toBe(1)
    // ⚠️ This does NOT test "whichever ending arrives first wins", which is what an earlier title
    // here claimed. The ordering is deterministic, not a race: `fail()` rejects the pump's parked
    // waiter synchronously, so the pump's `finally` is queued as a microtask before `tearDown` gets
    // past its first `await`. And the reverse ordering is not merely untested but UNREACHABLE —
    // `tearDown` awaits the provider stop and then the drain before it finalizes, so on any adapter
    // that ends its stream on close the pump always claims the barrier. What is tested is the
    // consequence that matters: the close was a consequence of the failure, not a second opinion
    // about it, and `errored` is the answer that survives.
    expect(row(id).status).toBe('errored')
    // One turn, closed once, with the reason the finalizer passes — a transposed argument in
    // `terminate(id, status, reason, at)` would still leave exactly one turn row.
    expect(store.turns(id)).toHaveLength(1)
    expect(store.turns(id)[0]).toMatchObject({ endReason: 'ended' })
  })

  it('finalizes ONCE however many endings arrive, and the guard is what makes that true', async () => {
    // Everything `runFinalize` does is individually idempotent — `stopProvider` has its own barrier,
    // `settleTx` only closes a turn that is open, `delete` on a missing key is a no-op — so counting
    // closes and turns cannot tell a working single-flight guard from a missing one. Counting the
    // ENTRIES does. Without `session.finalizing ??=`, three concurrent closers plus the pump's own
    // ending run the finalizer four times, and this is the assertion that says so.
    let terminations = 0
    store = {
      ...store,
      terminate: (sessionId, status, reason, at) => {
        terminations += 1
        return createSessionStore(db).terminate(sessionId, status, reason, at)
      },
    }
    host = buildHost()
    const id = await openSessionMidTurn()

    await Promise.all([host.close(id, sink), host.close(id, sink), host.closeAll()])
    await waitFor(() => host.sessionIds.length === 0, 'the session to be unregistered')

    expect(terminations).toBe(1)
    expect(handle.closes).toBe(1)
    expect(row(id).status).toBe('ended')
    expect(store.turns(id)).toHaveLength(1)
    expect(store.turns(id)[0]).toMatchObject({ endReason: 'ended' })
  })

  it('leaves the fatal error in the ledger, then the terminal state — in that order', async () => {
    const id = await openSessionMidTurn()
    handle.queue.fail(new Error('transport died'))
    await waitFor(() => host.sessionIds.length === 0, 'the session to be unregistered')

    // The ledger is the append-only record of what happened; the row is the summary. The summary
    // must not describe an ending the ledger has no event for.
    const ledger = store.events(id)
    expect(ledger.at(-1)?.event).toMatchObject({ type: 'error', fatal: true })
    expect(row(id).status).toBe('errored')
    // Nothing was invented to make the row agree with itself: no `status: ended` event we never
    // observed was appended to the ledger to justify the column (035's rule).
    expect(ledger.filter((entry) => entry.event.type === 'status')).toHaveLength(0)
  })
})

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

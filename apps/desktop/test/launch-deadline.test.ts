import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProcessExit,
  FakeRuntime,
  type AgentRuntime,
  type SessionHandle,
} from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * **A launch you can end** (102).
 *
 * A launch has no deadline: a slow provider is waited for (`a-slow-provider-is-waited-for.test.ts`).
 * What ends one before its provider answers is the person's Cancel, and these tests hold that it
 * reaches the provider, releases the conversation and confirms the provider stopped.
 *
 * ⚠️ **Every test that proves a refusal is paired with one proving the ordinary launch still
 * works.** A suite that only asserted "cancel refuses" would pass in full against a host that had
 * stopped being able to open anything at all.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A handle whose `close()` can be held open — 070's lever, for the case where termination cannot
 * be confirmed. A `Proxy` rather than a subclass for the reason `process-ownership.test.ts` gives:
 * the Fake's state lives in own fields its own methods mutate.
 */
function gateClose(
  handle: SessionHandle,
  gate: Promise<void>,
  onClose: () => void,
): { handle: SessionHandle; closed: () => boolean } {
  let finished = false
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          onClose()
          await gate
          await target.close()
          finished = true
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return { handle: proxied, closed: () => finished }
}

/**
 * A provider whose handshake never answers — the wedge itself, measured on Codex.
 *
 * `answer` is what it does when the launch is aborted, and the three settings are the three
 * genuinely different providers this dispatch has to survive:
 *
 *  - `'tears-down'` — the conforming adapter. Stops its child, then rejects. Both real adapters do
 *    exactly this: `cancelWith(signal, () => transport.close())`.
 *  - `'slow-to-die'` — conforms, but its teardown takes a while. This is what makes "the id stays
 *    refused until termination is CONFIRMED" a real assertion rather than a shape.
 *  - `'arrives-anyway'` — the race nothing can rule out: the handshake completes a moment after we
 *    stopped waiting, so a live provider is handed back to nobody. If that handle is not closed,
 *    the retry that follows is a second provider on one transcript.
 */
class StallingRuntime implements AgentRuntime {
  readonly provider = 'codex' as const
  /** Whether the provider child this launch "spawned" is still running. */
  running = false
  /** Set when the launch observed its abort — the signal really reached the adapter. */
  aborted = false
  private readonly inner: FakeRuntime
  /** Set on the `arrives-anyway` path, so a test can gate and inspect the handle we handed over. */
  late: { handle: SessionHandle; closed: () => boolean } | null = null
  private readonly teardown = deferred()
  private readonly arrival = deferred()

  constructor(
    private readonly answer: 'tears-down' | 'slow-to-die' | 'arrives-anyway',
    private readonly closeGate?: Promise<void>,
    /**
     * A process this launch's provider owns, whose exit a test controls (233).
     *
     * ⚑ Handed to the inner double rather than modelled here, so the handle that arrives late is a
     * real `FakeSessionHandle` publishing a real `awaitProcessExit` — which is the whole question
     * on the `arrives-anyway` path: the host owns that provider against something, and
     * until 233 it owned it against the bounded `close()`.
     */
    exit?: FakeProcessExit,
  ) {
    // Assigned here rather than as a field initializer, so it can see the constructor parameter.
    this.inner = new FakeRuntime('codex', exit ? { exit } : {})
  }

  /** Let a `slow-to-die` launch finish dying, or an `arrives-anyway` one arrive. */
  finishTeardown(): void {
    this.teardown.resolve()
  }
  arriveNow(): void {
    this.arrival.resolve()
  }

  /**
   * ⚑ **D-042 · R1 moved a fact here: a launch NAMES its model and effort before it spawns**, and a
   * Codex launch naming nothing reads `model/list` and names its `isDefault` row — so an empty list
   * now refuses the launch (`nothing-names-a-model`, F2) before the handshake this double stalls is
   * ever reached. ⛔ The list is answered by the inner Fake's, the same answer the ordinary launch
   * beside each refusal gets (its first row is Codex's default, by name): the stall stays the
   * HANDSHAKE's, and the pair compared is two launches that differ only in it.
   */
  listModels(
    context: Parameters<AgentRuntime['listModels']>[0],
  ): ReturnType<AgentRuntime['listModels']> {
    return this.inner.listModels(context)
  }

  start(options: Parameters<AgentRuntime['start']>[0]): Promise<SessionHandle> {
    return this.stall(options.signal, () => this.inner.start(options))
  }

  resume(...args: Parameters<AgentRuntime['resume']>): Promise<SessionHandle> {
    return this.stall(args[1].signal, () => this.inner.resume(args[0], args[1]))
  }

  private async stall(
    signal: AbortSignal | undefined,
    build: () => Promise<SessionHandle>,
  ): Promise<SessionHandle> {
    // The child exists from here — before the handshake, as Codex's detached app-server does.
    this.running = true
    const stopped = deferred()
    signal?.addEventListener(
      'abort',
      () => {
        this.aborted = true
        stopped.resolve()
      },
      { once: true },
    )
    if (this.answer === 'arrives-anyway') {
      // ⚠️ Built BEFORE the wait and handed over after it — which is also the honest order: Codex
      // spawns its detached child and only then awaits the handshake that answers late. Building
      // it afterwards would go through the Fake's own `assertNotCancelled` and turn this deaf
      // adapter into a conforming one, which is the case the other two settings already cover.
      const handle = await build()
      await this.arrival.promise
      // ⚠️ Wrapped even when nothing is gating it, and mutation testing is why: the first version
      // returned `closed: () => true` for the ungated case, so "the late provider was closed"
      // passed against a host that never closed anything. An already-resolved gate keeps the
      // observation real — `closed()` turns true when `close()` has actually been through.
      this.late = gateClose(handle, this.closeGate ?? Promise.resolve(), () => {})
      return this.late.handle
    }
    await stopped.promise
    if (this.answer === 'slow-to-die') await this.teardown.promise
    this.running = false
    throw new Error('codex start was cancelled')
  }
}

describe('cancelling a launch (102)', () => {
  let userData: string
  let sink: RecordingSink

  function buildHost(
    runtime: AgentRuntime,
    overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {},
  ): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
      closeDrainTimeoutMs: 40,
      ...overrides,
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-cancel-'))
    sink = new RecordingSink()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('reaches the launch through the real IPC boundary, not just through the host', async () => {
    // ⚠️ **The one the review's completeness sweep found, and the one every other test here was
    // blind to.** `executeRuntimeCommand`'s `createSession` case rebuilds its input FIELD BY FIELD,
    // and `launchKey` was not on the list — so the schema accepted it, the renderer sent it, and
    // the host was handed `undefined`. Every slot reserved with `launchKey: null`; the launcher's
    // Cancel could never match one. A dead button with a green suite on both sides of it, because
    // the host tests call `host.createSession` directly and the store tests use a fake bridge.
    // Nothing crossed the line, so nothing saw the line drop something.
    const runtime = new StallingRuntime('tears-down')
    const host = buildHost(runtime)

    const launching = executeRuntimeCommand(host, sink, {
      kind: 'createSession',
      provider: 'codex',
      launchKey: 'k1',
    })
    const failure = launching.catch((e: Error) => e)
    await waitFor(() => runtime.running, 'the provider to be spawned')

    // Through the boundary in BOTH directions: the key that went in is the key that comes back out.
    expect(await executeRuntimeCommand(host, sink, { kind: 'cancelLaunch', launchKey: 'k1' })).toBe(
      true,
    )
    expect(runtime.aborted).toBe(true)
    await failure
    await host.closeAll()
  })

  it('releases the slot AND confirms the provider stopped', async () => {
    const runtime = new StallingRuntime('tears-down')
    const host = buildHost(runtime)

    const launching = host.createSession({ provider: 'codex', launchKey: 'k1' }, sink)
    const failure = launching.catch((e: Error) => e)
    await waitFor(() => runtime.running, 'the provider to be spawned')

    expect(await host.cancelLaunch('k1', sink.ownerId)).toBe(true)

    // Confirmed, not merely asked for: the adapter saw the abort and its child is down.
    expect(runtime.aborted).toBe(true)
    expect(runtime.running).toBe(false)
    // The slot is gone, and the launch with it — so a fresh conversation is startable at once.
    expect(host.sessionIds).toEqual([])
    const ending = await failure
    // Positive first: the launch really did END, rather than quietly opening a conversation the
    // user had asked to stop.
    expect(ending).toBeInstanceOf(Error)
    const sentence = (ending as Error).message
    expect(sentence).toContain('stopped before it opened')
    expect(sentence).not.toContain('sess_')
    // ⚠️ …and NOT the provider's own words, which is what a bare rethrow would have shown.
    expect(sentence).not.toContain('codex start was cancelled')
    await host.closeAll()
  })

  it('…and the very next launch opens, so Cancel did not poison the app', async () => {
    // The pair for the test above: cancelling must cost only the launch it cancelled.
    const runtime = new StallingRuntime('tears-down')
    const real = new FakeRuntime('codex')
    let useReal = false
    const host = buildHost({
      provider: 'codex',
      listModels: (context) => real.listModels(context),
      start: (options) => (useReal ? real.start(options) : runtime.start(options)),
      resume: (ref, options) => real.resume(ref, options),
    })

    const failing = host
      .createSession({ provider: 'codex', launchKey: 'k1' }, sink)
      .catch(() => null)
    await waitFor(() => runtime.running, 'the provider to be spawned')
    await host.cancelLaunch('k1', sink.ownerId)
    await failing

    useReal = true
    const created = await host.createSession({ provider: 'codex' }, sink)
    expect(created.sessionId).toBe('sess_2')
    expect(host.sessionIds).toEqual(['sess_2'])
    await host.closeAll()
  })

  it('holds a reopen of the id until termination is confirmed, and starts nothing before', async () => {
    // ⚠️ **Acceptance 4's second half, and the line 102 said not to weaken.** The provider arrives
    // during the cancel and its `close()` does not return, so nothing may say it stopped. `close()`
    // still resolves on its bound — a hung provider must not hang the button — and a reopen of the
    // id WAITS for exactly as long as we do not know: no second provider, and no refusal for it.
    const closing = deferred()
    const runtime = new StallingRuntime('arrives-anyway', closing.promise)
    const host = buildHost(runtime)

    const launching = host.createSession({ provider: 'codex', launchKey: 'k1' }, sink)
    const failure = launching.catch((e: Error) => e)
    await waitFor(() => runtime.running, 'the provider to be spawned')

    const cancelling = host.cancelLaunch('k1', sink.ownerId)
    runtime.arriveNow() // it answers while the cancel is in flight — the hand-back interval
    expect(await cancelling).toBe(true)
    await failure

    // It was handed back, not registered…
    expect(host.sessionIds).toEqual([])
    expect(runtime.late?.closed()).toBe(false)
    // …and a reopen of the id waits, because we cannot say the process is gone.
    let reopened = false
    const reopening = host.resumeSession('sess_1', sink).then(
      () => {
        reopened = true
      },
      () => {
        reopened = true
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(reopened).toBe(false)
    expect(runtime.late?.closed()).toBe(false)

    closing.resolve()
    await waitFor(() => runtime.late?.closed() === true, 'the hand-back to finish')
    await reopening
    expect(reopened).toBe(true)
    await host.closeAll()
  })

  it("will not let one window cancel another window's launch", async () => {
    const runtime = new StallingRuntime('tears-down')
    const host = buildHost(runtime)

    const launching = host.createSession({ provider: 'codex', launchKey: 'k1' }, sink)
    const failure = launching.catch((e: Error) => e)
    await waitFor(() => runtime.running, 'the provider to be spawned')

    // Same key, different owner — the only thing standing between two windows is the scope.
    expect(await host.cancelLaunch('k1', 'owner:2')).toBe(false)
    expect(runtime.aborted).toBe(false)
    expect(runtime.running).toBe(true)

    // …and the window that started it still can, which is what makes the negative meaningful.
    expect(await host.cancelLaunch('k1', sink.ownerId)).toBe(true)
    await failure
    await host.closeAll()
  })

  it('says there was nothing to cancel, and leaves a session that already opened alone', async () => {
    // The race a press cannot avoid: the launch completes between the click and the command. A
    // cancel that reached into a LIVE session would end a conversation the user is now looking at.
    const host = buildHost(new FakeRuntime('codex'))

    const created = await host.createSession({ provider: 'codex', launchKey: 'k1' }, sink)

    expect(await host.cancelLaunch('k1', sink.ownerId)).toBe(false)
    expect(host.sessionIds).toEqual([created.sessionId])
    await host.closeAll()
  })
})

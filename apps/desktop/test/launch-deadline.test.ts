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
 * **A launch that ends, and a launch you can end** (102).
 *
 * 100 shipped with one door named and left open: *"a slot wedged in `starting` has no in-app
 * release… its symptom is a launcher that never settles"*. Two halves, and they are separable —
 * the handshake had no deadline where its sibling probe has had one since 058, and even with a
 * deadline a person watching a launcher spin should not have to wait it out.
 *
 * ⚠️ **Every test that proves a refusal is paired with one proving the ordinary launch still
 * works.** A suite that only asserted "cancel refuses" and "the deadline fires" would pass in full
 * against a host that had stopped being able to open anything at all, which is the vacuity 102
 * asked for by name.
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
     * on the `arrives-anyway` path: `giveUpOnLaunch` owns that provider against something, and
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

describe('a launch that cannot complete (102)', () => {
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
      // Short, so the wedge is reproduced rather than waited out. The value under test is the
      // BEHAVIOUR at expiry; the fifteen seconds the app ships is argued from the latency probe.
      launchTimeoutMs: 40,
      closeDrainTimeoutMs: 40,
      ...overrides,
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-launch-'))
    sink = new RecordingSink()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('ends by itself, saying what it waited for and how long — with no id in the sentence', async () => {
    const runtime = new StallingRuntime('tears-down')
    const host = buildHost(runtime)

    const failure = await host.createSession({ provider: 'codex' }, sink).catch((e: Error) => e)

    expect(failure).toBeInstanceOf(Error)
    const sentence = (failure as Error).message
    // What it waited for, and for how long. 40ms rounds to 0s, so the bound is stated by the shape
    // of the sentence rather than by a number this test picked.
    expect(sentence).toContain('agent did not answer')
    // 🔴 **716 · `710` F-5 — what a person can do, said as a gesture** (rule 8.4): it was a bare
    // *"Try again."* until `716`. A start left nothing behind, so it is started again.
    expect(sentence).toContain('No conversation was made: start it again.')
    // ⚠️ 085's rule, on the class 100 converted: no id, no owner, no internal state name.
    expect(sentence).not.toContain('sess_')
    expect(sentence).not.toContain('owner:')
    expect(sentence).not.toContain('took-too-long')
    // And it really was the deadline that ended it: the abort reached the adapter.
    await waitFor(() => runtime.aborted, 'the launch to be aborted')
    expect(runtime.running).toBe(false)
    await host.closeAll()
  })

  it('…while an ordinary launch, on the same bound, still opens', async () => {
    // The pair. Without it the test above passes against a host that cannot start anything.
    const host = buildHost(new FakeRuntime('codex'))

    const created = await host.createSession({ provider: 'codex' }, sink)

    expect(created.sessionId).toBe('sess_1')
    expect(host.sessionIds).toEqual(['sess_1'])
    await host.closeAll()
  })

  it('keeps refusing the id until the provider it gave up on is confirmed gone', async () => {
    // ⚠️ **070's split, on the new path.** The reservation goes at once so the user can try again;
    // the LAUNCH is handed its own aftermath, so `reserve` keeps refusing until the process is
    // really down. Without it the retry lands while the first provider is still alive.
    const runtime = new StallingRuntime('slow-to-die')
    const host = buildHost(runtime)

    await host.createSession({ provider: 'codex' }, sink).catch(() => undefined)
    await waitFor(() => runtime.aborted, 'the launch to be aborted')

    const refused = await host.resumeSession('sess_1', sink).catch((e: Error) => e)
    // ⚑ **D-017b** — 070's refusal in the new words (`not-confirmed-stopped`): *"cannot continue
    // yet"*, with no process fact in it; it said *"its agent has not confirmed that it stopped"*.
    expect((refused as Error).message).toContain('cannot continue yet')
    expect((refused as Error).message).not.toContain('sess_')

    runtime.finishTeardown()
    // Once it IS confirmed, the id is free again — refusing forever would be a different bug. The
    // next refusal is the ordinary "no such recording", which is a POSITIVE assertion that the
    // reservation path was reached rather than merely that one sentence stopped appearing.
    const until = Date.now() + 2_000
    let message: string
    do {
      const again = await host.resumeSession('sess_1', sink).catch((e: Error) => e)
      message = (again as Error).message
      if (!message.includes('cannot continue yet')) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    } while (Date.now() < until)
    expect(message).toBe('There is no record of this conversation here.')
    await host.closeAll()
  })

  it('closes a provider that arrives after we gave up, so two never reach one transcript', async () => {
    // ⚠️ **Acceptance 5, and the reason `giveUpOnLaunch` does more than abort.** A handshake that
    // answers one millisecond late hands back a live provider nobody is awaiting. Nothing else in
    // this app would ever close it: the caller has already been told the launch failed.
    const runtime = new StallingRuntime('arrives-anyway')
    const host = buildHost(runtime)

    const failure = await host.createSession({ provider: 'codex' }, sink).catch((e: Error) => e)
    expect((failure as Error).message).toContain('agent did not answer')

    runtime.arriveNow()

    await waitFor(() => runtime.late !== null, 'the late provider to arrive')
    await waitFor(() => runtime.late?.closed() === true, 'the late provider to be closed')
    // It was never registered, and no second one was started on the same id.
    expect(host.sessionIds).toEqual([])
    await host.closeAll()
  })

  /**
   * ⛔ **233, and the third of the three hand-back sites** (found by 233's own adversarial pass and
   * confirmed by its mutation table, where the row for this line SURVIVED its first run).
   *
   * `giveUpOnLaunch` closes the provider that arrived too late — the test above proves that — and
   * then owns the launch against something. Until 233 that something was the bounded `close()`,
   * which for Claude resolves in ~200 ms with the CLI child alive. So the id was freed while a
   * provider was still running, on the path whose whole purpose is that *"two never reach one
   * transcript"*.
   */
  it('233 · keeps owning the late provider against its PROCESS, not against its close()', async () => {
    const exit = new FakeProcessExit()
    const runtime = new StallingRuntime('arrives-anyway', undefined, exit)
    const host = buildHost(runtime)

    const failure = await host.createSession({ provider: 'codex' }, sink).catch((e: Error) => e)
    expect((failure as Error).message).toContain('agent did not answer')

    runtime.arriveNow()
    await waitFor(() => runtime.late?.closed() === true, 'the late provider to be closed')

    // ⚑ The double's `close()` has no `await` in its body, so it has genuinely RESOLVED — and the
    // process has not gone anywhere. That pair is the 229 H1 shape, here on the give-up path.
    expect(exit.isConfirmed).toBe(false)
    const refused = await host.resumeSession('sess_1', sink).catch((e: Error) => e)
    expect((refused as Error).message).toContain('cannot continue yet')

    // …and once the process really goes, the id is free — refusing forever would be a different bug.
    exit.confirm()
    const until = Date.now() + 2_000
    let message: string
    do {
      const again = await host.resumeSession('sess_1', sink).catch((e: Error) => e)
      message = (again as Error).message
      if (!message.includes('cannot continue yet')) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    } while (Date.now() < until)
    expect(message).toBe('There is no record of this conversation here.')
    await host.closeAll()
  })

  it('leaves no half-attached session behind — the host holds nothing for the window', async () => {
    // 100's regression shape. `attachOpen` is what a reloaded window reconciles against; a launch
    // that was given up on must not appear there, or the rail offers a conversation with nothing
    // behind it.
    const runtime = new StallingRuntime('tears-down')
    const host = buildHost(runtime)

    await host.createSession({ provider: 'codex' }, sink).catch(() => undefined)

    expect(host.attachOpenSessions(sink)).toEqual([])
    expect(host.sessionIds).toEqual([])
    expect(sink.messages).toEqual([])
    await host.closeAll()
  })
})

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
      // Long enough that nothing here can be the deadline firing: every ending below is a Cancel.
      launchTimeoutMs: 30_000,
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

  it('refuses the id thereafter when termination CANNOT be confirmed', async () => {
    // ⚠️ **Acceptance 4's second half, and the line 102 said not to weaken.** The provider arrives
    // during the cancel and its `close()` never returns, so nothing may say it stopped. `close()`
    // still resolves on its bound — a hung provider must not hang the button — and the id keeps
    // being refused for exactly as long as we do not know.
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
    // …and the id is refused, in 070's words, because we cannot say the process is gone.
    const refused = await host.resumeSession('sess_1', sink).catch((e: Error) => e)
    expect((refused as Error).message).toContain('cannot continue yet')

    closing.resolve()
    await waitFor(() => runtime.late?.closed() === true, 'the hand-back to finish')
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

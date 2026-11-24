import { EventEmitter } from 'node:events'
import type { ModelInfo, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent, type SessionHandle, type SessionRef } from '../src/index'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude'
import { AsyncQueue } from '../src/internal/async-queue'
import { SessionMachine } from '../src/internal/session-machine'
import { FakeQuery, init, collect, has, startFake } from './fake-claude-query'

describe('ClaudeRuntime — close/fatal barrier (028 P1-A)', () => {
  it('a fatal stream loss closes the SDK query from the errored state', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await handle.send('x') // an active turn
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(fq.closeCount).toBe(0)
    fq.end() // provider stream ends → finishUnexpected
    await consumer
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    expect(fq.closeCount).toBeGreaterThan(0) // Query.close() ran from the errored state (pre-fix: 0)
  })
})

/**
 * 🔴 **395 · a Claude interruption and a Claude fault, side by side on this adapter's own wire.**
 *
 * ⛔ **Not one provider plus an argument that the other is the same.** The Codex half is in
 * `codex-runtime.test.ts`, and the two are asserted separately because **they differ in kind** —
 * which is the whole reason the app may not carry a reading from one to the other.
 */
describe('395 · telling a Claude interruption from a Claude fault', () => {
  it('🔴 the discriminator is the NEIGHBOURS, not the turn — an interrupt emits no `error`', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')
    await handle.interrupt()
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    const shape = events.map((e) =>
      e.type === 'turn' ? `turn:${e.state}` : e.type === 'status' ? `status:${e.state}` : e.type,
    )
    // ⛔ **`turn:'interrupted'` then `status:'idle'`, and NO `error` anywhere.** That absence is the
    // one wire-level signal present for every fault and for no interruption — `completeTurn` emits
    // `error{fatal:false}` immediately before `turn:'failed'`, and `fatalError` emits
    // `error{fatal:true}` immediately before its own terminal.
    expect(shape).toContain('turn:interrupted')
    expect(shape.at(-1)).toBe('status:idle')
    expect(events.some((e) => e.type === 'error')).toBe(false)
    // ⚑ **And the session is still usable**, which is what makes an interruption not an ending.
    await expect(handle.send('again')).resolves.toBeUndefined()
    fq.end()
    await handle.close()
    await consumer
  })

  it('⛔ …and a FAULT on the same turn emits a fatal `error` and ends `errored`', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')
    // ⚑ **The same point in the same turn as the interrupt above** — the only variable is what
    // happens next, which is what makes the two readings comparable at all.
    fq.fail(new Error('the provider stream ended unexpectedly'))
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    const errors = events.filter((e) => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ fatal: true })
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['failed'])
    await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'errored'))
    await handle.close()
    await consumer
  })

  it('🔴 IN KIND: Claude FORCES the local terminal, and it does so on a bounded ack', async () => {
    // ⛔ **This is the half a comparison must not carry over.** Claude's `interrupt()` ends with
    // `if (!this.machine.isTerminal) this.machine.forceEnd()` — so the turn is over when the call
    // returns, whatever the SDK does. ⚠️ Codex's does the opposite: it fires `turn/interrupt`,
    // awaits only the request's answer, and leaves the ending to the provider's own
    // `turn/completed`. See `codex-runtime.test.ts`.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')
    // ⚑ **The SDK never acknowledges and never sends its own terminal** — the stalled provider `074`
    // was written for. The turn still ends.
    await handle.interrupt()
    expect(fq.interruptCount, 'Stop never reached the provider').toBe(1)
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    expect(handle.status()).toBe('idle')
    fq.end()
    await handle.close()
    await consumer
  })
})

/**
 * **The two controls 247 exposed, and the reason exposing them was not optional** (245 §2.2/§2.3).
 *
 * `245` listed `backgroundTasks` and `stopTask` as **ABSENT · 1** — the rank-1 gap — and found the
 * committed tree calling them in **0 files**. What made that a live defect rather than a feature
 * gap is `247` §1: a model reaches `run_in_background` unaided, so the app was already producing
 * background work it had no way to see, detach or stop.
 */
describe('detaching and stopping background work (247)', () => {
  it('⛔ passes the tool-use id straight through, and returns the provider’s own answer', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    fq.backgroundedIds.add('toolu_live')

    await expect(handle.backgroundWork?.('toolu_live')).resolves.toBe(true)
    // ⚠️ **`false` is a real answer, not an error**: the SDK reserves it for "an id was given and it
    // matched no foreground task", which is what a user clicking Background on work that just
    // finished should see. A guard that threw here would turn a race into a bug report.
    await expect(handle.backgroundWork?.('toolu_already_done')).resolves.toBe(false)
    expect(fq.calls).toEqual(['backgroundTasks:toolu_live', 'backgroundTasks:toolu_already_done'])

    // ⚑ **And the turn is NOT ended.** `interrupt` moves the machine because the turn is over;
    // this leaves it running on purpose, so a state change here would report an ending that is not
    // happening. The whole visible consequence is what the provider says next.
    expect(handle.status()).not.toBe('ended')
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(0)

    fq.end()
    await handle.close()
    await consumer
  })

  it('⛔ stops one task by the provider’s own id, and a refusal really rejects', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    // ⛔ `true` is *"the request went out"* (287 finding 5). It used to resolve `undefined`, which a
    // shutting-down session and a query with no `stopTask` resolved too — three different things
    // saying one word, and `RuntimeHost` reported all of them to the bar as a stop that was made.
    await expect(handle.stopBackgroundWork?.('bqiucw912')).resolves.toBe(true)
    expect(fq.calls).toEqual(['stopTask:bqiucw912'])
    // A stop the PROVIDER refuses is a real answer and the caller must see it — unlike a closed
    // session, where there is nothing left to stop.
    await expect(handle.stopBackgroundWork?.('refused')).rejects.toThrow(/refused to stop/)

    fq.end()
    await handle.close()
    await consumer
  })

  it('⚑ a CLOSED session detaches nothing and stops nothing, without throwing', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    fq.backgroundedIds.add('toolu_live')
    fq.end()
    await handle.close()
    await consumer

    // ⚠️ Paired with the positive above deliberately: `toolu_live` WOULD have returned `true` a
    // moment ago, so `false` here is the guard and not the fake declining.
    await expect(handle.backgroundWork?.('toolu_live')).resolves.toBe(false)
    // ⛔ **`false`, because nothing was sent** (287 finding 5) — and it is the same word
    // `backgroundWork` has always used for the same door one line up. The silent `undefined` this
    // replaces is what let `RuntimeHost` tell the bar the stop had gone out.
    await expect(handle.stopBackgroundWork?.('bqiucw912')).resolves.toBe(false)
    expect(fq.calls, 'and nothing reached the provider after teardown').toEqual([])
  })

  it('⛔ a query without the methods refuses BY NAME rather than pretending', async () => {
    // The `supportedModels` pattern (058/202): these are OPTIONAL on `ClaudeQuery` so a fake written
    // before 247 keeps compiling — which makes the adapter's `?.` guards the only thing between a
    // missing method and a control that silently reports success.
    //
    // 🔴 **This test's TITLE was true and NEITHER half of it was** (287 finding 5; `280` spotted the
    // assertion, the rest fell out of fixing it).
    //
    //  - The stop assertion accepted a silent `undefined` — the exact value a stop that really
    //    happened returned — so the row it was written to protect was reported to the bar as
    //    *"Asked to stop"* with nothing behind it.
    //  - ⛔ **And it never stripped a method.** `backgroundTasks`/`stopTask` are declared on
    //    `FakeQuery`, so they live on the PROTOTYPE, and `delete` on an instance removes an own
    //    property it does not have — a silent no-op. The adapter's `?.` guards were never once
    //    reached by this test. `backgroundWork` answered `false` because `backgroundedIds` is empty,
    //    which is a different code path with the same number in it.
    //
    // ⚑ Assigned `undefined` instead: an own property shadows the prototype, which is what a query
    // object built before 247 actually looks like — the method is simply not there to be called.
    const { fq, handle, events, consumer } = await startFake()
    const stripped = fq as unknown as { backgroundTasks?: unknown; stopTask?: unknown }
    stripped.backgroundTasks = undefined
    stripped.stopTask = undefined
    // The strip is asserted, not assumed — this line is the whole reason the test above was vacuous.
    expect(fq.backgroundTasks, 'the fake really has no such method now').toBeUndefined()
    expect(fq.stopTask).toBeUndefined()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    await expect(handle.backgroundWork?.('toolu_live')).resolves.toBe(false)
    await expect(handle.stopBackgroundWork?.('bqiucw912')).resolves.toBe(false)
    // ⚠️ The session is LIVE here — that is the whole difference from the closed-session case above
    // — so an empty call list is the missing method being refused rather than teardown refusing it.
    expect(fq.calls, 'nothing was invented to call').toEqual([])

    fq.end()
    await handle.close()
    await consumer
  })
})

/**
 * 110 · The machine's own ordering, read from inside the emit callback.
 *
 * ⚠️ **This test exists because a mutation survived and a reviewer named the reason.** Splitting
 * `fatalError` in two moved the turn-clearing to after the error emit — and nothing failed, because
 * the only consumer that reads `hasActiveTurn` on that event (`trackProgress`, arming the stall
 * watchdog) is un-armed a microsecond later by the terminal `turn`. An invariant defended only by
 * what its callers happen to do next is not defended.
 */
describe('SessionMachine — what a fatal error is delivered WITH (110)', () => {
  const machineRef: SessionRef = {
    provider: 'claude',
    sessionId: 'sess_m',
    cwd: '/tmp/x',
    rotation: 0,
  }

  /** Every emitted event, stamped with what the machine said about itself AT THAT MOMENT. */
  const trace = (drive: (m: SessionMachine) => void): string[] => {
    const seen: string[] = []
    let machine: SessionMachine
    // eslint-disable-next-line prefer-const
    machine = new SessionMachine((event) => {
      seen.push(`${event.type}:${machine.hasActiveTurn ? 'turn-live' : 'no-turn'}`)
    })
    machine.markStarting()
    machine.sessionStarted(machineRef, 'started')
    drive(machine)
    return seen
  }

  it('the turn is already gone when the fatal error is delivered', () => {
    const seen = trace((m) => {
      m.beginTurn()
      m.fatalError('the provider child died')
    })
    expect(seen).toEqual([
      'session:no-turn',
      'status:no-turn', // idle — no turn had begun yet
      'status:turn-live', // working — the turn is live, which is the paired positive
      'error:no-turn', // ⚠️ THE assertion: the turn is cleared BEFORE this is emitted
      'turn:no-turn',
      'status:no-turn',
    ])
  })

  it('…and the same for the ending whose error was reported elsewhere', () => {
    // `fatalAfterReportedError` is 110's path: `normalizeMessage` emitted the error, so the machine
    // emits only the terminal turn and the status. Same clearing, same order.
    const seen = trace((m) => {
      m.beginTurn()
      m.fatalAfterReportedError()
    })
    expect(seen).toEqual([
      'session:no-turn',
      'status:no-turn',
      'status:turn-live',
      'turn:no-turn',
      'status:no-turn',
    ])
    // …and it says nothing itself: no `error` event, which is what stops the same failure appearing
    // in one transcript twice.
    expect(seen.filter((s) => s.startsWith('error'))).toEqual([])
  })
})

/**
 * ## ⛔ 202 · what a quit does not wait for, on the Claude adapter (191 H3 and H5)
 *
 * Two findings that meet in `close()`: the teardown resolved on a receipt that certified only that
 * BroBot had let go of the query, and `send` could push a user message into a turn the app had
 * already told the user was over.
 */
describe('202 · the receipt, and the turn that must not start (191 H3, H5)', () => {
  /** A query from before {@link ClaudeQuery.return} existed — absence must not become a throw. */
  class NoReturnQuery implements ClaudeQuery {
    private readonly messages = new AsyncQueue<SDKMessage>()
    closeCount = 0
    emit(message: Record<string, unknown>): void {
      this.messages.push(message as unknown as SDKMessage)
    }
    async interrupt(): Promise<unknown> {
      return undefined
    }
    close(): void {
      this.closeCount++
      this.messages.close()
    }
    [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
      return this.messages[Symbol.asyncIterator]()
    }
  }

  it('⛔ H3 · close() does not resolve while the CLI is still exiting', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_receipt', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    let letGo!: () => void
    fq.holdReturn = new Promise<void>((resolve) => (letGo = resolve))

    let closed = false
    const closing = handle.close().then(() => (closed = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    // ⛔ Before 202 this was `true` here: `Query.close()` returns `void` and the adapter resolved on
    // it, while the child was still draining the stdin EOF that close had just sent.
    expect(closed, 'the teardown resolved before the child was gone').toBe(false)
    expect(fq.closeCount, 'and it really did start the teardown').toBeGreaterThanOrEqual(1)
    expect(fq.returnCount, 'by asking for the receipt the SDK does offer').toBe(1)

    letGo()
    await closing
    expect(closed).toBe(true)
    await consumer
  })

  it('…and the pairing: a query that answers at once closes at once', async () => {
    // ⚑ Without this, "close blocks" would pass for a build that had simply stopped resolving.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_receipt_fast', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    const t0 = Date.now()
    await handle.close()
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(fq.returnCount).toBe(1)
    await consumer
  })

  it('⛔ H3 · a CLI that will not exit is bounded, not waited on forever', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_receipt_wedged', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    fq.holdReturn = new Promise<void>(() => {}) // never

    vi.useFakeTimers()
    try {
      let closed = false
      const closing = handle.close().then(() => (closed = true))
      await vi.advanceTimersByTimeAsync(4_000)
      expect(closed, 'still inside the bound').toBe(false)
      await vi.advanceTimersByTimeAsync(2_000)
      await closing
      expect(closed, 'a teardown may not be held open by a child that will not die').toBe(true)
    } finally {
      vi.useRealTimers()
    }
    await consumer
  })

  it('a query with no receipt to give still closes — absence is not a failure', async () => {
    const nq = new NoReturnQuery()
    const runtime = new ClaudeRuntime(
      () => nq,
      async () => true,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    nq.emit(init('sess_no_receipt', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.close()
    expect(nq.closeCount).toBe(1)
    await consumer
  })

  it('🔴 H5 · a message is NOT pushed into a turn Stop already ended', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_stop', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    // A queued setting, so `send` has something to await between opening the turn and pushing.
    await handle.setModel('opus')
    let release!: () => void
    fq.holdSettings = new Promise<void>((resolve) => (release = resolve))

    const sending = handle.send('rm -rf the-important-thing')
    sending.catch(() => {})
    await vi.waitFor(() => expect(fq.calls).toContain('setModel:opus'))

    // 🔴 The user presses Stop while the settings are still in flight. `interrupt` bounds the SDK
    // ack and force-ends the turn locally — so from here the app has SAID the turn is over.
    await handle.interrupt()
    // The events reach `events` through the queue's own consumer, so the wait is for DELIVERY —
    // not for the interrupt, which has already happened (193's lesson).
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))
    const turns = events.filter((e) => e.type === 'turn')

    release()
    // ⛔ The send must not now start provider work. It refuses instead.
    await expect(sending).rejects.toThrow(/stopped before its message could be sent/)

    // ⚑ And nothing reached the provider: the user message was never queued.
    expect(
      events.filter((e) => e.type === 'turn'),
      'no second turn was opened by the stopped send',
    ).toHaveLength(turns.length)
    const last = events.filter((e) => e.type === 'status').at(-1)
    expect(last, 'the session is idle, as the user was told').toMatchObject({ state: 'idle' })

    await handle.close()
    await consumer
  })

  it('…and the pairing: an ordinary settings change still applies, and the turn still runs', async () => {
    // ⚑ Without this, H5's guard would pass for a build in which `send` never worked at all.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_ok', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    await handle.setModel('opus')
    await handle.send('hello')
    expect(fq.calls, 'the queued change landed before the message').toContain('setModel:opus')
    expect(
      events.filter((e) => e.type === 'status').at(-1),
      'and the turn is running',
    ).toMatchObject({ state: 'working' })

    await handle.close()
    await consumer
  })

  it('🔴 H5 · …and it is THIS turn, not merely SOME turn', async () => {
    // ⛔ The discriminator for `activeTurnId === turnId` against the weaker `hasActiveTurn`. The
    // weaker question passes whenever a turn is open — and one IS open in the case that matters,
    // because the user who pressed Stop usually types the next thing. Sending the stopped message
    // into that turn would attribute it to work it is not part of.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_which_turn', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    await handle.setModel('opus')
    let release!: () => void
    fq.holdSettings = new Promise<void>((resolve) => (release = resolve))
    const stopped = handle.send('the message the user gave up on')
    stopped.catch(() => {})
    await vi.waitFor(() => expect(fq.calls).toContain('setModel:opus'))

    await handle.interrupt()
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'interrupted'))

    // The user types the next thing. ⚠️ The gate is cleared for the NEW send only — the old one is
    // still awaiting the promise it captured, which is the whole shape of the window.
    fq.holdSettings = null
    await handle.send('what I actually meant')
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(1) // the new turn is still running

    release()
    await expect(stopped).rejects.toThrow(/stopped before its message could be sent/)
    // ⛔ …and the new turn is untouched: still exactly one terminal, still working.
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'status').at(-1)).toMatchObject({ state: 'working' })

    await handle.close()
    await consumer
  })

  it('⛔ H3 · the model probe waits for its own child too', async () => {
    // ⚑ 068 finding 7's launch: a real CLI, up to fifteen seconds, owned by nothing else. Its
    // teardown was `probe.close()` — `void` — so `listModels` resolved while the child was exiting,
    // and a quit racing it had nothing to wait on.
    const probe = new FakeQuery()
    let letGo!: () => void
    probe.holdReturn = new Promise<void>((resolve) => (letGo = resolve))
    probe.models = [{ value: 'sonnet', displayName: 'Sonnet' } as ModelInfo]
    const runtime = new ClaudeRuntime(
      () => probe,
      async () => true,
    )

    let done = false
    const listing = runtime.listModels({ providerHome: '/tmp/x/home' }).then((models) => {
      done = true
      return models
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(done, 'it resolved while its own child was still exiting').toBe(false)
    letGo()
    expect(await listing).toHaveLength(1)
    expect(probe.returnCount).toBe(1)
  })

  it('⛔ H5 · settings that never answer fail the turn instead of hanging the send', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_hang', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.setModel('opus')
    fq.holdSettings = new Promise<void>(() => {}) // never

    vi.useFakeTimers()
    try {
      const sending = handle.send('hello')
      sending.catch(() => {})
      await vi.advanceTimersByTimeAsync(11_000)
      // ⛔ The send IPC comes back. Before 202 it never did — three unbounded control requests
      // between opening the turn and pushing the message.
      await expect(sending).rejects.toThrow(/did not answer within/)
    } finally {
      vi.useRealTimers()
    }
    // …and the turn it opened was terminalized rather than left running forever.
    expect(events.filter((e) => e.type === 'turn').at(-1)).toMatchObject({ state: 'failed' })

    await handle.close()
    await consumer
  })
})

/**
 * ⛔ **`terminated` must mean terminated** (233, from 229 H1, verified by the PM).
 *
 * 202 made `close()` wait for the SDK's exit receipt, and the measurement it recorded is still
 * right: `await return()` takes 186–280 ms and no child is alive at that moment, 0/3 trials. What
 * 229 H1 found is what happens when the child does NOT cooperate — because every layer under that
 * receipt resolves anyway:
 *
 *  - `detachQueryAwaitingExit()` is `withTimeout(query.return(), 5 s)`, and `internal/bounded.ts`
 *    says in its own header *"Always resolves (never rejects)"*;
 *  - the SDK's `performCleanup()` ends with `Promise.race([transport.waitForExit(), 2000 ms])`;
 *  - and `ProcessTransport.close()` schedules SIGTERM at 2 s and SIGKILL 5 s after that, **both
 *    `unref`'d**, so a quit inside that window fires neither.
 *
 * So `close()` resolving is compatible with a live child, and the host was registering exactly that
 * promise as the launch's TERMINATION. These tests hold the shape no test could hold before: the
 * seam is `ClaudeRuntime`'s injected {@link SpawnChild}, which exists because the SDK will take our
 * spawn (`Options.spawnClaudeCodeProcess`, `sdk.d.ts:2377`) even though it exposes no child of its
 * own.
 */
describe('233 · the exit fact is not the teardown bound (229 H1)', () => {
  /**
   * A child that is alive until a test says otherwise. Only the members
   * `ClaudeChildWitness` actually touches, so it cannot accidentally pass by being a real process.
   */
  function fakeChild(pid: number | 'never-started' = 4242): {
    child: EventEmitter & { pid: number | undefined; stderr: EventEmitter }
    die: () => void
    fail: () => void
  } {
    const stderr = new EventEmitter() as EventEmitter & { setEncoding: (e: string) => void }
    stderr.setEncoding = () => {}
    // ⚠️ Spelled `'never-started'` rather than `undefined`, because `fakeChild(undefined)` takes the
    // DEFAULT — which silently gave the "spawn failed" case a live pid and made its assertion pass
    // over the wrong branch. Found by the test hanging, which is the honest way to find it.
    const child = Object.assign(new EventEmitter(), {
      pid: pid === 'never-started' ? undefined : pid,
      stderr,
    })
    return {
      child: child as never,
      die: () => child.emit('exit', 0, null),
      fail: () => child.emit('error', new Error('spawn ENOENT')),
    }
  }

  /**
   * The handle's exit fact — **and an assertion that it HAS one**.
   *
   * ⚑ `awaitProcessExit` is optional on `SessionHandle`, so reading it through the interface is the
   * same question the host asks: *does this adapter publish a fact at all?* Answering it here, in
   * every test below, is what stops the suite passing against a Claude handle that quietly stopped
   * implementing it — the member's absence is read by the host as "cannot say", which is silent.
   */
  function exitFactOf(handle: SessionHandle): Promise<void> {
    const fact = handle.awaitProcessExit?.()
    expect(fact, 'the Claude handle must publish a termination fact').toBeDefined()
    return fact as Promise<void>
  }

  /** A `ClaudeRuntime` whose SDK stand-in really calls the spawn hook, as `ProcessTransport` does. */
  async function startWithChild(spawned: ReturnType<typeof fakeChild>): Promise<{
    handle: Awaited<ReturnType<ClaudeRuntime['start']>>
    fq: FakeQuery
    spawnCalls: number
  }> {
    const fq = new FakeQuery()
    let spawnCalls = 0
    const runtime = new ClaudeRuntime(
      (params) => {
        // ⚑ **The stand-in has to SPAWN**, because the real transport does it synchronously inside
        // `query()`. A factory that ignored the hook would leave the witness with no child, and
        // every assertion below would pass over nothing (196's vacuity rule).
        params.options.spawnClaudeCodeProcess?.({
          command: 'claude',
          args: [],
          env: {},
          signal: new AbortController().signal,
        })
        return fq
      },
      async () => true,
      undefined,
      undefined,
      () => {
        spawnCalls++
        return spawned.child as never
      },
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    return { handle, fq, spawnCalls: spawnCalls }
  }

  it('⛔ close() RESOLVES while the child is still alive — and the exit fact does not', async () => {
    const spawned = fakeChild()
    const { handle, fq } = await startWithChild(spawned)

    let exited = false
    void exitFactOf(handle).then(() => (exited = true))

    // The SDK answers its receipt immediately, exactly as it does when `waitForExit` loses its own
    // 2 000 ms race: cleanup reports done, the child is still between TERM and KILL.
    await handle.close()

    expect(fq.returnCount, 'the teardown really did ask for the SDK receipt').toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    // 🔴 **The defect, in one pair of lines.** Before 233 these were the SAME promise, so the host
    // read the top line and recorded the bottom one as proven.
    expect(exited, 'a live child must not be reported as an exit').toBe(false)

    // …and the fact settles when, and only when, the process really goes.
    spawned.die()
    await exitFactOf(handle)
    expect(exited).toBe(true)
  })

  it('⚑ …and the pid is real, which is what 076 could not have', async () => {
    const spawned = fakeChild(9931)
    const { handle } = await startWithChild(spawned)

    // 076 recorded `providerPid` as a Claude gap because "the SDK owns Claude's subprocess and this
    // app holds no handle to it". It holds one now — that is what makes the exit fact possible.
    expect(handle.providerPid).toBe(9931)
  })

  it('⚑ the exit fact is one promise, not one per caller', async () => {
    const spawned = fakeChild()
    const { handle } = await startWithChild(spawned)

    // A method that minted a fresh promise per call would make "the fact" a per-caller opinion —
    // and the registry and the bounded waiter would then be holding two different objects.
    expect(exitFactOf(handle)).toBe(exitFactOf(handle))
  })

  it('⚑ a spawn that never produced a process is settled, not pending forever', async () => {
    const spawned = fakeChild('never-started')
    const { handle } = await startWithChild(spawned)

    spawned.fail()
    // Nothing is running, so there is nothing to wait for. `error` is read as an exit ONLY here —
    // with a pid it is not one, and Node still delivers `exit` for a child that started.
    await expect(exitFactOf(handle)).resolves.toBeUndefined()
  })

  it('⚑ a query that never spawned reports nothing running, rather than hanging a quit', async () => {
    // The fake `QueryFactory` used by every other test in this file ignores the Options, so no child
    // is ever created. That must not become a session the app can never let go of.
    const { handle } = await startFake()
    await expect(exitFactOf(handle)).resolves.toBeUndefined()
    // ⛔ **…and it is still ONE promise on this branch.** The contract says every call returns the
    // same object; a bare `Promise.resolve()` in the getter would satisfy the line above and quietly
    // break the contract for exactly the sessions that never spawned. The idempotence test below
    // runs against a spawned child, where identity holds by construction — so this is the half that
    // can actually fail, and the first draft of this dispatch did fail it.
    expect(exitFactOf(handle)).toBe(exitFactOf(handle))
  })

  /**
   * ⛔ **The RESUME half, which the first version of this dispatch left untested** (found by its own
   * adversarial pass). `resumeOptions` is built by spreading `optionsFor`, so the witness has to be
   * written onto it separately from `start`'s — and deleting that one line compiled, kept every test
   * green, and silently handed the SDK back its private spawn. A reopened Claude conversation would
   * then have had no exit fact at all, on exactly the gesture (Close, then Reopen) whose race this
   * dispatch exists to close.
   */
  it('⛔ a RESUMED session owns its child too, not only a started one', async () => {
    const spawned = fakeChild(5150)
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      (params) => {
        params.options.spawnClaudeCodeProcess?.({
          command: 'claude',
          args: [],
          env: {},
          signal: new AbortController().signal,
        })
        return fq
      },
      async () => true,
      undefined,
      undefined,
      () => spawned.child as never,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_reopened', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )

    expect(handle.providerPid, 'the reopen spawned a child of its own').toBe(5150)
    let exited = false
    void exitFactOf(handle).then(() => (exited = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(exited).toBe(false)
    spawned.die()
    await exitFactOf(handle)
    expect(exited).toBe(true)
  })

  /**
   * ⛔ **The `pid === undefined` guard, which nothing exercised** (found by the adversarial pass).
   * `spawnClaudeChild` forwards the SDK's abort signal to `spawn({signal})`, so Node emits an
   * `AbortError` on a child that is very much alive when the SDK's graceful window fires. Settling
   * the fact there would be this dispatch's own defect in miniature — reporting termination at the
   * moment we ASKED for a kill rather than when the kernel delivered one.
   */
  it('⛔ an error on a LIVE child is not an exit', async () => {
    const spawned = fakeChild(7788)
    const { handle } = await startWithChild(spawned)

    let exited = false
    void exitFactOf(handle).then(() => (exited = true))
    spawned.fail() // the forwarded abort, or any post-spawn error
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(exited, 'an error is not a death — the pid is still there').toBe(false)

    spawned.die()
    await exitFactOf(handle)
    expect(exited).toBe(true)
  })

  /**
   * ⚑ **074's rule, applied to the adapter that finally has a pid to get wrong.** Node does not
   * clear `ChildProcess.pid` on exit — `codex-transport.ts` carries the measurement across v20/v22/
   * v24 and Electron 43 — so a getter reading the raw field republishes a number that now belongs to
   * nothing, or later to somebody else. `SpawnCodexTransport.pid` has returned `undefined` past
   * death since 074; this is the same rule for Claude, and it was missing in this dispatch's first
   * draft.
   */
  it('⛔ stops naming the child the moment it is dead, rather than reporting a corpse', async () => {
    const spawned = fakeChild(3141)
    const { handle } = await startWithChild(spawned)
    expect(handle.providerPid).toBe(3141)

    spawned.die()
    await exitFactOf(handle)
    expect(
      handle.providerPid,
      'a confident wrong PID is worse than an honest absence',
    ).toBeUndefined()
  })

  it("⛔ stderr is drained, because the SDK cannot read a custom child's", async () => {
    const spawned = fakeChild()
    await startWithChild(spawned)

    // `SpawnedProcess` has no `stderr` member, so nothing in the SDK consumes it for a child we
    // supplied. An undrained pipe wedges the CLI once the buffer fills — this asserts the listener
    // is attached at all, which is the cheap half of that guarantee.
    expect(spawned.child.stderr.listenerCount('data')).toBeGreaterThan(0)
  })
})

/**
 * ## ⚑ 240 §3 · the error one clause poorer (233's other residual)
 *
 * ⛔ **233 removed a sentence from the product and wrote down that it had.** Supplying
 * `Options.spawnClaudeCodeProcess` means the SDK never reads our child's stderr, so the
 * `formatStderrTail()` it appends to `getProcessExitError` is empty and the `. stderr: …` clause
 * disappeared from the fatal error a user meets. The tail still reaches the log (085) — but a person
 * looking at a dead session is not looking at the log.
 *
 * ⚠️ **Scoped to the two endings the CLI's own output explains**, and the third test is the one that
 * says so: a resume mismatch is our sentence about what we expected, and pasting a provider's stderr
 * onto it would attribute our conclusion to them.
 */
describe('240 §3 · the CLI’s stderr is back in the sentence a person reads', () => {
  function fakeChildWithStderr(): {
    child: EventEmitter & { pid: number | undefined; stderr: EventEmitter }
    write: (text: string) => void
  } {
    const stderr = new EventEmitter() as EventEmitter & { setEncoding: (e: string) => void }
    stderr.setEncoding = () => {}
    const child = Object.assign(new EventEmitter(), { pid: 5150, stderr })
    return { child: child as never, write: (text: string) => stderr.emit('data', text) }
  }

  /** A runtime whose SDK stand-in really calls the spawn hook, so the witness has a child to drain. */
  async function startWithStderr(): Promise<{
    handle: Awaited<ReturnType<ClaudeRuntime['start']>>
    fq: FakeQuery
    events: RuntimeEvent[]
    consumer: Promise<void>
    write: (text: string) => void
  }> {
    const spawned = fakeChildWithStderr()
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      (params) => {
        params.options.spawnClaudeCodeProcess?.({
          command: 'claude',
          args: [],
          env: {},
          signal: new AbortController().signal,
        })
        return fq
      },
      async () => true,
      undefined,
      undefined,
      () => spawned.child as never,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    return { handle, fq, events, consumer, write: spawned.write }
  }

  const fatalMessage = (events: RuntimeEvent[]): string => {
    const fatal = events.find((e) => e.type === 'error' && e.fatal === true)
    expect(
      fatal,
      'the session must have ended fatally for there to be a sentence to read',
    ).toBeDefined()
    return (fatal as { message: string }).message
  }

  it('⛔ appends what the CLI said on its way out to the fatal error', async () => {
    const { fq, events, consumer, write } = await startWithStderr()
    write('Error: ENOSPC: no space left on device, write\n')

    fq.end() // the provider stream ends unexpectedly
    await consumer

    const message = fatalMessage(events)
    expect(message).toContain('the provider stream ended unexpectedly')
    // 🔴 The clause 233 removed. Absent on `20110e0`.
    expect(message).toContain('. stderr: Error: ENOSPC: no space left on device, write')
  })

  it('⚑ …and says nothing extra when the child said nothing', async () => {
    // The pairing. Without it the assertion above is satisfied by a clause that is always appended,
    // which would put an empty `. stderr: ` on every ordinary failure in the product.
    const { fq, events, consumer } = await startWithStderr()

    fq.end()
    await consumer

    expect(fatalMessage(events)).toBe('the provider stream ended unexpectedly')
  })

  it('⛔ …and on the OTHER unexpected ending: a stream that throws rather than closing', async () => {
    // ⚠️ **The highest-yield defect class this repository has recorded**: a rule changed at one of
    // its N call sites. `runLoop` reaches `finishUnexpected` two ways, and 233's residual is about
    // both of them — a fix applied only to the stream-ended branch would pass every other test here.
    const { fq, events, consumer, write } = await startWithStderr()
    write('panic: runtime error\n')

    fq.fail(new Error('the SDK stream blew up'))
    await consumer

    const message = fatalMessage(events)
    expect(message).toContain('the SDK stream blew up')
    expect(message).toContain('. stderr: panic: runtime error')
  })

  it('⚠️ bounds the clause, so a CLI that dies verbosely cannot make an unreadable error', async () => {
    const { fq, events, consumer, write } = await startWithStderr()
    write(`${'x'.repeat(4000)}TAIL-END`)

    fq.end()
    await consumer

    const message = fatalMessage(events)
    expect(message).toContain('TAIL-END') // the END of the tail is what explains an exit
    expect(message.length).toBeLessThan(700)
  })
})

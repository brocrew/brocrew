import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentRuntime } from '@brobot2/runtime'
import type { Provider, SessionStatus } from '@brobot2/shared'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * **Send while it is working — interrupt, or queue (077).**
 *
 * The contract under test, in one sentence: a message the user writes mid-turn is either sent by
 * interrupting what is running, or held by US until the turn ends — and at every moment in between,
 * the transcript says exactly which, and no path can lose it.
 *
 * ⚠️ **Why the queue is ours and not the provider's** — measured, not assumed:
 *  - **Claude** takes a mid-turn push into the SDK's own queue and runs it as its own turn once the
 *    current one finishes. Right behaviour, wrong ownership: `Query` has no cancel, and the probe
 *    measured `interrupt()` answering `still_queued: []` while a queued message went on to run —
 *    with and without a uuid stamped on it. Pushed there, it can never be taken back.
 *  - **Codex** has `turn/steer`, which is a third thing entirely: the probe measured the message
 *    landing INSIDE the running turn — same turn id, answered after the in-flight reply, the turn
 *    closing `completed`. Two prompts in one turn, which 045's one-prompt-per-turn row cannot say.
 *
 * So neither provider mechanism is used, and these tests pin the consequences of that: the message
 * waits in the host, reaches the provider by the ordinary `send` path, and opens its own turn —
 * ⚑ D-027 · one turn for everything held then, oldest first, so it is its own only when alone.
 *
 * Driven against `FakeRuntime`, whose representative turn parks on a permission card — which is what
 * makes the "a queued message cannot answer a card" case reachable at all.
 */

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  alive = true

  constructor(readonly ownerId = sinkOwnerId({ id: 1 })) {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }

  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }

  types(): string[] {
    return this.events().map((event) => event.type)
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('a message sent while a turn is running (077)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink

  /**
   * ⚠️ **Shared across every host this file builds, and it has to be** (found in review). It used to
   * be a local starting at zero, so two hosts in one test both minted `sess_1` — and the second
   * `createSession` was refused with *"already being run by another part of BroBot2"*, because the
   * launch reservation is keyed on the id and does not care which host asked.
   */
  let sessions = 0

  function buildHost(
    createRuntime: (provider: Provider) => AgentRuntime = (provider) => new FakeRuntime(provider),
  ): RuntimeHost {
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime,
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++sessions}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-queue-'))
    host = buildHost()
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  /**
   * Let every microtask a resumed flush schedules drain.
   *
   * ⚑ **A macrotask boundary, not a duration** — `setTimeout(…, 0)` fires only after the microtask
   * queue is empty, so this is a property of the event loop rather than a guess about how fast the
   * machine is. That distinction is the whole of {@link gatedSendHost}'s complaint about sleeps.
   */
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  /**
   * The name the last `message_queued` carried (354) — what a surface would cancel by.
   *
   * ⛔ **Read from the LEDGER, not remembered from the call**, so the helpers that queue on a
   * caller's behalf need no new return type. It throws rather than answering `''` for the same
   * reason {@link queueNamed} does: a cancel aimed at nothing passes every assertion below.
   */
  function heldMessageId(): string {
    const id = eventsOfType('message_queued').at(-1)?.messageId
    if (id === undefined) throw new Error('nothing has been queued in this test')
    return id
  }

  /**
   * Queue a message and hand back **the name it was given** (354).
   *
   * ⛔ **It throws when the message went straight out**, rather than answering with an empty string:
   * every caller below is about a message that is being HELD, and a helper that quietly returned
   * `''` for a `sent` outcome would turn "this test queued nothing" into "this test cancelled
   * nothing", which passes.
   */
  async function queueNamed(
    runtime: RuntimeHost,
    sessionId: string,
    text: string,
    by: RecordingSink,
  ): Promise<string> {
    const outcome = await runtime.queueMessage(sessionId, text, by)
    if (outcome.outcome !== 'queued') {
      throw new Error(`expected "${text}" to be held; it was ${outcome.outcome}`)
    }
    return outcome.messageId
  }

  /** Start a session and get it into a running turn parked on its permission card. */
  async function busySession(): Promise<string> {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'the first thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the card the turn parks on')
    return created.sessionId
  }

  const eventsOfType = <T extends TranscriptEvent['type']>(
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] =>
    sink
      .events()
      .filter((event): event is Extract<TranscriptEvent, { type: T }> => event.type === type)

  /**
   * ⛔ **A host whose flush can be held open at a NAMED suspension** — after the provider has taken
   * the message, or before it ever gets there.
   *
   * ⚠️ **The gate is on the RESUMPTION, and that is the whole of what makes these tests real**
   * (found writing 234 §1's). `runFlush` does `await session.handle.send(…)` and then publishes; the
   * defect lives in the gap between that promise RESOLVING and the continuation running, which is
   * an ordinary microtask boundary — `finalize` reaches `abandonQueued` synchronously from the
   * pump's `finally`, so either can go first.
   *
   * ⛔ **Gating BEFORE the inner send measured nothing.** The first version held the call itself, so
   * by the time it was released the teardown had closed the handle, the send threw, `runFlush`
   * caught it and published nothing at all — and the test passed with the fix REMOVED. ⚑ Held
   * after, the message really has gone to the provider and the continuation really does try to say
   * so, which is the interleaving the ledger's contradictory pair came from.
   *
   * ⛔ **And the arrival is a HANDSHAKE, not a sleep** (found in review). {@link flushInFlight} used
   * to wait on a status count and then sleep 50 ms; the count was wrong by one — `FakeRuntime`
   * emits `working` when the card is ANSWERED, before the turn ends — so the sleep was the only
   * thing getting the flush into position. ⚠️ **A sleep that lost would have degraded the race test
   * silently to vacuous**: the pre-existing re-check returns, nothing is published, and the
   * assertion still passes with the fix removed. `reached` resolves between the inner call and the
   * gate, so the test stands exactly where it says it stands.
   *
   * ⚑ **`checkSignIn` is the second gate, and it holds the flush BEFORE the handover** — inside
   * `assertSignInCurrent`, which is the only other place `runFlush` suspends long enough to matter.
   * It is what makes "the message never left" a state a test can be in.
   */
  function gatedSendHost(): {
    runtime: RuntimeHost
    arm: () => void
    release: () => void
    reachedSend: Promise<void>
    armGate: () => void
    releaseGate: () => void
    reachedGate: Promise<void>
    /** ⛔ Every text HANDED to the provider, recorded before the call (234 §1, run 1's `M2`). */
    sends: string[]
    /** Make the handover throw — the one path `handingOver`'s `finally` is load-bearing on. */
    failSends: () => void
    /** Resolves a macrotask after that throw, i.e. once `runFlush` has finished unwinding. */
    sendFailed: Promise<void>
  } {
    const latch = (): { promise: Promise<void>; open: () => void } => {
      let open = (): void => {}
      const promise = new Promise<void>((resolve) => {
        open = resolve
      })
      return { promise, open }
    }
    const sendGate = latch()
    const sendReached = latch()
    const signInGate = latch()
    const signInReached = latch()
    const failed = latch()
    const sends: string[] = []
    let armed = false
    let gateArmed = false
    let failing = false
    const runtime = buildHost((provider) => {
      const inner = new FakeRuntime(provider)
      const bind = <T extends object>(target: T, prop: string | symbol): unknown => {
        const value = Reflect.get(target, prop) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
      return new Proxy(inner, {
        get(target, prop) {
          if (prop !== 'start') return bind(target, prop)
          return async (opts: Parameters<AgentRuntime['start']>[0]) => {
            const handle = await target.start(opts)
            return new Proxy(handle, {
              get(h, p) {
                if (p === 'send') {
                  return async (text: string) => {
                    // ⛔ **Recorded BEFORE the call** (234 §1, from run 1's `M2` survivor). The claim
                    // a test needs is *"the provider was handed this"*, and that is true the moment
                    // the call is made — including against a handle teardown has already closed,
                    // where the call throws. Recorded after, the row could not be killed.
                    sends.push(withoutWhatThisAppAdds(text))
                    if (failing) {
                      try {
                        throw new Error('the provider would not take it')
                      } finally {
                        // ⚑ **A macrotask, and that is the point rather than a duration**: every
                        // microtask the throw schedules — `runFlush`'s inner `finally`, its `catch`,
                        // and the `.finally` that clears `session.flushing` — drains before a
                        // timeout fires. So this resolves exactly once the flush has unwound.
                        setTimeout(() => failed.open(), 0)
                      }
                    }
                    const sent = await h.send(text)
                    if (armed) {
                      sendReached.open()
                      await sendGate.promise
                    }
                    return sent
                  }
                }
                // ⚠️ `FakeRuntime` has no `checkSignIn` of its own, and `assertSignInCurrent` calls
                // it optionally — so supplying one here is what creates the suspension. `false` is
                // "the sign-in is current", which is the answer that lets the flush carry on.
                if (p === 'checkSignIn') {
                  return async () => {
                    if (gateArmed) {
                      signInReached.open()
                      await signInGate.promise
                    }
                    return false
                  }
                }
                return bind(h, p)
              },
            })
          }
        },
      }) as AgentRuntime
    })
    return {
      runtime,
      arm: () => {
        armed = true
      },
      release: () => sendGate.open(),
      reachedSend: sendReached.promise,
      armGate: () => {
        gateArmed = true
      },
      releaseGate: () => signInGate.open(),
      reachedGate: signInReached.promise,
      sends,
      failSends: () => {
        failing = true
      },
      sendFailed: failed.promise,
    }
  }

  /**
   * Start a session, queue a message, and let the turn end so the flush begins.
   *
   * ⚠️ **`beforeTheTurnEnds` runs after the queue and before the card is answered**, which is the
   * only place a gate can be armed: `send` and `queueMessage` pass through `assertCanTakeTurn`
   * themselves, so arming the sign-in gate any earlier suspends the SETUP rather than the flush.
   */
  async function queueThenEndTurn(
    gated: RuntimeHost,
    text: string,
    beforeTheTurnEnds: () => void = () => {},
  ): Promise<string> {
    const created = await gated.createSession({ provider: 'claude' }, sink)
    await gated.send(created.sessionId, 'the first thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the card')
    await gated.queueMessage(created.sessionId, text, sink)
    beforeTheTurnEnds()
    await gated.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    return created.sessionId
  }

  /**
   * Get a gated host to the moment the provider HAS the queued message and `runFlush` is suspended
   * on its way to saying so. ⚑ Waits on the HANDSHAKE, never on a clock.
   */
  async function flushInFlight(
    gated: ReturnType<typeof gatedSendHost>,
    text: string,
  ): Promise<string> {
    const id = await queueThenEndTurn(gated.runtime, text, gated.arm)
    await gated.reachedSend
    return id
  }

  it('holds the message, records it as QUEUED, and opens no turn for it', async () => {
    const id = await busySession()
    const turnsBefore = eventsOfType('user_turn').length

    const outcome = await host.queueMessage(id, 'and afterwards, do this', sink)

    expect(outcome.outcome).toBe('queued')
    // Recorded the moment it is queued — this is what makes "never silently dropped" durable rather
    // than a promise about the main process staying alive.
    expect(eventsOfType('message_queued').map((event) => event.text)).toEqual([
      'and afterwards, do this',
    ])
    // ⚠️ **And NOT as a turn.** 045 opens a turn row from `user_turn` and nothing else, so this is
    // the assertion that stops a message nobody has sent from getting a turn of its own.
    expect(eventsOfType('user_turn').length).toBe(turnsBefore)
    expect(eventsOfType('user_turn').map((event) => event.text)).not.toContain(
      'and afterwards, do this',
    )
  })

  it('sends it when the turn ends — as its OWN turn, after saying it stopped waiting', async () => {
    const id = await busySession()
    await host.queueMessage(id, 'and afterwards, do this', sink)

    // Answering the card lets the parked turn run to its terminal, which is the boundary the flush
    // hangs off.
    await host.respondPermission(id, 'turn_1_perm', { outcome: 'allow' }, sink)

    await waitFor(
      () => eventsOfType('user_turn').some((event) => event.text === 'and afterwards, do this'),
      'the queued message being sent',
    )

    const types = sink.types()
    const queuedAt = types.indexOf('message_queued')
    const unqueuedAt = types.indexOf('message_unqueued')
    const sentAt = types.lastIndexOf('user_turn')

    expect(eventsOfType('message_unqueued')[0]?.reason).toBe('sent')
    // The order is the story: queued → stopped being queued → became a turn. A `user_turn` before
    // the `message_unqueued` would be a transcript claiming it was sent while still saying it was
    // waiting.
    expect(queuedAt).toBeLessThan(unqueuedAt)
    expect(unqueuedAt).toBeLessThan(sentAt)
  })

  it('cannot answer a permission card — it waits for the CARD, not just for the turn (acc. 6)', async () => {
    const id = await busySession()
    await host.queueMessage(id, 'yes go ahead', sink)

    // The session is parked on a card: not idle, so nothing may flush. Give the event loop real
    // chances to get it wrong — a flush keyed on anything but the handle's own status would fire in
    // here.
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))

    expect(eventsOfType('user_turn').map((event) => event.text)).not.toContain('yes go ahead')
    expect(eventsOfType('message_unqueued')).toEqual([])
    // Paired positive (086): the negatives above are only meaningful if the message really is
    // waiting — otherwise this test passes over a queue that silently dropped it.
    expect(eventsOfType('message_queued').map((event) => event.text)).toEqual(['yes go ahead'])

    // …and once the card is answered by the one thing that CAN answer it, the queue drains.
    await host.respondPermission(id, 'turn_1_perm', { outcome: 'allow' }, sink)
    await waitFor(
      () => eventsOfType('user_turn').some((event) => event.text === 'yes go ahead'),
      'the queued message sending once the card was answered',
    )
  })

  it('the flush asks the HANDLE, not just the event that woke it (acc. 6, defence in depth)', async () => {
    // ⚠️ **Written because a mutation survived.** The test above proves a queued message does not
    // reach an open card — but it proves it via the EVENT KEY: no `status: idle` is emitted while a
    // card is open, so `flushQueued` is never called and the guard inside it is never run. Deleting
    // that guard left every assertion green, which means the second door was untested and a
    // refactor could have removed it silently.
    //
    // So this pins the guard itself: the handle is made to report a non-idle status at the exact
    // moment the `status: idle` event is delivered. The two disagreeing is the whole case the guard
    // exists for, and it is the only way to reach it from outside.
    const pin: { value: SessionStatus | null } = { value: null }
    const pinned = buildHost((provider) => {
      const inner = new FakeRuntime(provider)
      const bind = <T extends object>(target: T, prop: string | symbol): unknown => {
        const value = Reflect.get(target, prop) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
      return new Proxy(inner, {
        get(target, prop) {
          if (prop !== 'start') return bind(target, prop)
          return async (opts: Parameters<AgentRuntime['start']>[0]) => {
            const handle = await target.start(opts)
            return new Proxy(handle, {
              get(h, p) {
                if (p === 'status') return () => pin.value ?? h.status()
                return bind(h, p)
              },
            })
          }
        },
      }) as AgentRuntime
    })

    try {
      const created = await pinned.createSession({ provider: 'claude' }, sink)
      await pinned.send(created.sessionId, 'the first thing', sink)
      await waitFor(() => sink.types().includes('permission_request'), 'the card')
      await pinned.queueMessage(created.sessionId, 'must not go while a card is open', sink)

      // From here the handle insists it is still waiting on a human, whatever the stream says.
      pin.value = 'waiting_permission'
      await pinned.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
      await waitFor(
        () => sink.types().filter((type) => type === 'status').length >= 3,
        'the turn reaching its terminal status',
      )
      for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))

      expect(eventsOfType('user_turn').map((event) => event.text)).not.toContain(
        'must not go while a card is open',
      )
      // Paired positive: it is still WAITING, not lost — otherwise the negative above would also
      // pass against a flush that dropped it on the floor.
      expect(eventsOfType('message_unqueued')).toEqual([])
      pin.value = null
      await expect(
        pinned.cancelQueuedMessage(created.sessionId, heldMessageId(), sink),
      ).resolves.toBeUndefined()
    } finally {
      await pinned.closeAll()
    }
  })

  it('a cancelled message says so and is never sent', async () => {
    const id = await busySession()
    const held = await queueNamed(host, id, 'never mind this', sink)
    await host.cancelQueuedMessage(id, held, sink)

    expect(eventsOfType('message_unqueued')[0]).toMatchObject({
      reason: 'cancelled',
      text: 'never mind this',
    })

    // Let the turn finish: a cancelled message must not come back to life at the flush boundary.
    await host.respondPermission(id, 'turn_1_perm', { outcome: 'allow' }, sink)
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(eventsOfType('user_turn').map((event) => event.text)).not.toContain('never mind this')
  })

  it('interrupt-and-send does not let the queued message JUMP the interrupt (found in review)', async () => {
    // ⚠️ **The bug this pins was real and high severity.** `interrupt()` terminalizes the running
    // turn, which emits `status: idle` — the very signal the flush waits for — on a microtask that
    // lands before `sendInterrupting` resumes. So the queued message started its own turn first,
    // `waitForIdle` then saw `working` again, and the replacement went second: two turns from a
    // button that means "instead of", in the wrong order.
    // ⚠️ **`FakeRuntime` cannot reproduce this on its own, and the difference is the bug.** Its
    // `interrupt()` only sets a flag — the turn terminalizes later, from `driveTurn`'s continuation,
    // so `status: idle` is delivered AFTER `sendInterrupting` has already resumed and started its
    // own turn, and the handle-status guard turns the flush away. The real Claude adapter calls
    // `machine.completeTurn('interrupted')` SYNCHRONOUSLY inside `interrupt()`
    // (claude-runtime.ts:1382), so the idle lands while the session really is idle and the flush
    // fires. Modelled here by holding `interrupt()` open until the terminal has been delivered,
    // which is the ordering the real adapter produces.
    const claudeOrdering = buildHost((provider) => {
      const inner = new FakeRuntime(provider)
      const bind = <T extends object>(target: T, prop: string | symbol): unknown => {
        const value = Reflect.get(target, prop) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
      return new Proxy(inner, {
        get(target, prop) {
          if (prop !== 'start') return bind(target, prop)
          return async (opts: Parameters<AgentRuntime['start']>[0]) => {
            const handle = await target.start(opts)
            return new Proxy(handle, {
              get(h, p) {
                if (p !== 'interrupt') return bind(h, p)
                return async () => {
                  await h.interrupt()
                  // Yield until the terminal has actually been delivered, so the caller resumes to
                  // the same world the Claude adapter's caller resumes to.
                  for (let i = 0; i < 40 && h.status() !== 'idle'; i += 1) {
                    await new Promise((resolve) => setTimeout(resolve, 5))
                  }
                  await new Promise((resolve) => setTimeout(resolve, 5))
                }
              },
            })
          }
        },
      }) as AgentRuntime
    })
    host = claudeOrdering

    const id = await busySession()
    await host.queueMessage(id, 'the one that was waiting', sink)

    await host.sendInterrupting(id, 'no, do THIS', sink)

    // 🔴 **D-027 · R2 moved where the replacement goes: it JOINS what waits** (`itJoinsWhatWaits`)
    // — held last, and sent with the waiting message as ONE turn, oldest first, by the flush the
    // press lets go of in its `finally`. ⚑ That flush is still an await away when
    // `sendInterrupting` resolves, so the turn is waited for rather than assumed.
    await waitFor(() => eventsOfType('user_turn').length === 2, 'the one turn the press let go of')
    // ⚠️ **Strict and ordered.** Unmutated this reads exactly these two; with the hold removed the
    // second reads `'the one that was waiting'` alone — the queued message having started its own
    // turn off the idle that our own interrupt produced, ahead of the words that were to join it.
    expect(eventsOfType('user_turn').map((event) => event.text)).toEqual([
      'the first thing',
      'the one that was waiting\n\nno, do THIS',
    ])

    // …and it was HELD, not discarded: the user never cancelled it, so it went — ⚑ D-027 · in the
    // turn they asked for, as its FIRST part, the order they were held in. This is the positive
    // half — without it the assertion above would also pass against a host that joined the words
    // into anything at all.
    expect(eventsOfType('user_turn')[1]?.parts?.map((part) => part.text)).toEqual([
      'the one that was waiting',
      'no, do THIS',
    ])
    const cards = (): string[] =>
      sink
        .events()
        .filter(
          (event): event is Extract<TranscriptEvent, { type: 'permission_request' }> =>
            event.type === 'permission_request',
        )
        .map((event) => event.id)
    // The replacement turn parks on a card of its OWN, which arrives a hop after `sendInterrupting`
    // resolves. Taking the last card without waiting picks up the INTERRUPTED turn's, which is
    // already settled — a `.at(-1)` that reads as "the newest" and is not.
    await waitFor(() => cards().some((cardId) => cardId !== 'turn_1_perm'), 'the new turn’s card')
    const card = cards().find((cardId) => cardId !== 'turn_1_perm')
    await host.respondPermission(id, card!, { outcome: 'allow' }, sink)
    // ⚑ **D-027 · and nothing is left for the turn after it**: the held message went inside the
    // turn they asked for, so that turn's end sends nothing more — where, before D-027, it sent the
    // held message as a third turn. Its end is waited for, then the loop is given real chances.
    const turnStates = (): string[] =>
      sink
        .events()
        .filter(
          (event): event is Extract<TranscriptEvent, { type: 'turn' }> => event.type === 'turn',
        )
        .map((turn) => turn.state)
    await waitFor(() => turnStates().includes('completed'), 'the joined turn to end')
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(eventsOfType('user_turn')).toHaveLength(2)
    expect(eventsOfType('message_unqueued').map((event) => [event.text, event.reason])).toEqual([
      ['the one that was waiting', 'sent'],
      ['no, do THIS', 'sent'],
    ])
  })

  describe('a held stop word, taken back and the turn stopped as one press', () => {
    const turnStates = (): string[] => eventsOfType('turn').map((turn) => turn.state)
    const stopsAsked = (): number =>
      eventsOfType('user_command').filter((row) => row.command === 'interrupted').length

    it('takes the word back, stops the turn, and the word never goes', async () => {
      const gated = gatedSendHost()
      try {
        const created = await gated.runtime.createSession({ provider: 'claude' }, sink)
        await gated.runtime.send(created.sessionId, 'the first thing', sink)
        await waitFor(() => sink.types().includes('permission_request'), 'the card')
        const held = await queueNamed(gated.runtime, created.sessionId, 'stop', sink)

        await gated.runtime.takeBackAndStop(created.sessionId, held, sink)
        await waitFor(() => turnStates().includes('interrupted'), 'the stopped turn')
        // The turn's end flushes what is held, and there is nothing left to send.
        for (let i = 0; i < 10; i += 1) await settled()

        expect(eventsOfType('message_unqueued').map((row) => row.reason)).toEqual(['cancelled'])
        expect(stopsAsked()).toBe(1)
        expect(gated.sends).not.toContain('stop')
        expect(eventsOfType('user_turn').map((row) => row.text)).not.toContain('stop')
      } finally {
        await gated.runtime.closeAll()
      }
    })

    it('when the turn ends first and its flush has taken the word, it says so and stops nothing', async () => {
      const gated = gatedSendHost()
      try {
        // The flush is under way and held before the handover: the word has not reached the
        // provider yet, and nothing can take it back any more.
        const id = await queueThenEndTurn(gated.runtime, 'stop', gated.armGate)
        await gated.reachedGate
        const held = heldMessageId()

        await expect(gated.runtime.takeBackAndStop(id, held, sink)).rejects.toThrow(
          'too late to cancel: that message is already being sent',
        )
        expect(stopsAsked(), 'a refused take-back asked the turn to stop').toBe(0)

        gated.releaseGate()
        await waitFor(
          () => eventsOfType('user_turn').some((row) => row.text === 'stop'),
          'the flush sending what it took',
        )
        expect(eventsOfType('message_unqueued').map((row) => row.reason)).toEqual(['sent'])
        expect(turnStates()).not.toContain('interrupted')
      } finally {
        gated.releaseGate()
        await gated.runtime.closeAll()
      }
    })

    it('pressed in the same instant the turn ends, the word is taken back before any flush', async () => {
      const gated = gatedSendHost()
      try {
        const created = await gated.runtime.createSession({ provider: 'claude' }, sink)
        await gated.runtime.send(created.sessionId, 'the first thing', sink)
        await waitFor(() => sink.types().includes('permission_request'), 'the card')
        const held = await queueNamed(gated.runtime, created.sessionId, 'stop', sink)

        // Both arrive together, the turn's end and the press, as two commands can.
        const pressed = gated.runtime.takeBackAndStop(created.sessionId, held, sink)
        const answered = gated.runtime.respondPermission(
          created.sessionId,
          'turn_1_perm',
          { outcome: 'allow' },
          sink,
        )
        await Promise.allSettled([pressed, answered])
        for (let i = 0; i < 10; i += 1) await settled()

        expect(eventsOfType('message_unqueued').map((row) => row.reason)).toEqual(['cancelled'])
        expect(gated.sends).not.toContain('stop')
        expect(eventsOfType('user_turn').map((row) => row.text)).not.toContain('stop')
      } finally {
        await gated.runtime.closeAll()
      }
    })
  })

  it('a message already being sent cannot be cancelled — the ledger never says both (review)', async () => {
    // ⚠️ **Also real and high severity.** `runFlush` captures the text into a local and then
    // suspends on `handle.send`; clearing `session.queued` from underneath it does NOT stop it. The
    // transcript ended up holding `cancelled` AND `sent` for one message, with a turn row open for a
    // message the user had just taken back and the provider already answering it.
    const gated = gatedSendHost()
    try {
      const id = await flushInFlight(gated, 'racing the flush')

      // The flush is in flight and the message is on its way to the provider. Cancelling now must
      // be refused — recording it as cancelled would be a lie about a message already sent.
      await expect(gated.runtime.cancelQueuedMessage(id, heldMessageId(), sink)).rejects.toThrow(
        'too late',
      )

      gated.release()
      await waitFor(
        () => eventsOfType('user_turn').some((event) => event.text === 'racing the flush'),
        'the gated send completing',
      )

      const reasons = eventsOfType('message_unqueued').map((event) => event.reason)
      // The invariant: exactly one ending per queued message, and never a contradictory pair.
      expect(reasons).toEqual(['sent'])
    } finally {
      gated.release()
      await gated.runtime.closeAll()
    }
  })

  /**
   * # 🔴 The same window, entered by the door that CANNOT be refused (234 §1, from `231`)
   *
   * ⛔ **`cancelQueuedMessage` refuses while a flush is in flight; `abandonQueued` had no guard at
   * all** — and it is reached from finalization, so the racing flush is the unattended one. The
   * ledger held BOTH `abandoned` and `sent` for one message, plus a `user_turn` opening a turn row
   * in a conversation that was at that moment being torn down.
   *
   * ⚠️ **This holds both publications against ONE message, which is the whole point.** A unit test
   * on `abandonQueued` proves the function; only standing inside the handover proves the seam — see
   * {@link gatedSendHost} for why the close is held too, and for what a version without that gate
   * measured (nothing at all, greenly).
   */
  it('🔴 a teardown inside the handover records ONE ending, not `abandoned` and `sent` (234 §1)', async () => {
    const gated = gatedSendHost()
    try {
      const id = await flushInFlight(gated, 'the one that is mid-flight')

      // ⛔ Finalization lands INSIDE `handle.send`. It cannot refuse — the session is ending either
      // way — so it takes the ending, and the flush must find the message gone when it resumes.
      await gated.runtime.close(id, sink)
      expect(
        eventsOfType('message_unqueued').map((event) => event.reason),
        'teardown did not account for the queued message',
      ).toEqual(['abandoned'])

      gated.release()
      // Give the resumed flush every chance to publish a second ending before we look. Its send
      // has ALREADY succeeded — the provider has the message — which is the real race.
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))

      expect(
        eventsOfType('message_unqueued').map((event) => event.reason),
        'one message, two contradictory endings — the ledger cannot hold both',
      ).toEqual(['abandoned'])
      // ⛔ …and no turn row was opened for it. `user_turn` is the event 045 builds a turn from, so
      // this is the durable half of the same lie.
      expect(eventsOfType('user_turn').map((event) => event.text)).not.toContain(
        'the one that is mid-flight',
      )
    } finally {
      gated.release()
      await gated.runtime.closeAll()
    }
  })

  /**
   * ⚠️ **The paired positive, and without it the test above is satisfied by a host that abandons
   * everything.** Same gate, same suspension, nothing closed — the flush owns the ending and says
   * `sent`, exactly as it does when nobody is racing it.
   */
  it('⚑ …and with nobody racing it, the same suspended flush still says `sent` (234 §1)', async () => {
    const gated = gatedSendHost()
    try {
      await flushInFlight(gated, 'nobody is racing this one')
      gated.release()
      await waitFor(
        () => eventsOfType('user_turn').some((event) => event.text === 'nobody is racing this one'),
        'the gated send completing',
      )
      expect(eventsOfType('message_unqueued').map((event) => event.reason)).toEqual(['sent'])
    } finally {
      gated.release()
      await gated.runtime.closeAll()
    }
  })

  /**
   * # ⛔ The detail says what we do NOT know, and only where we do not know it (234 §1)
   *
   * `abandoned` renders as a sentence about the conversation ending, and it did — but a reader
   * would take it to mean the message never left, and when the handover was under way it may have.
   *
   * ⛔ **THREE states, because two of them cannot tell the fix from the bug** (found by the
   * adversarial pass over this dispatch's own diff). The first version read `session.flushing`,
   * which is set before `runFlush`'s FIRST await and spans two suspensions that precede the
   * handover — so the uncertain sentence was attached to messages that provably never reached
   * `handle.send`, and a test with only the after-send and never-flushed cases passed either way.
   * ⚑ The middle case below is the one that discriminates.
   *
   * ⚑ **D-017 · R3 — and only the FIRST state ends now.** A Close is a stop, and a stop ends nothing
   * it held: a message that never reached the provider is handed on to the conversation's next
   * start, so the middle and last states write no ending at all at the Close — which is a sharper
   * version of *"no doubt invented"*: nothing is said about them because nothing happened to them.
   * ⚠️ **This file's store is `NULL_SESSION_STORE`**, so there is no recording to start again from
   * and the start for them fails; `the-message-that-has-no-name.test.ts` measures the start that
   * delivers them.
   */
  it('🔴 mid-handover is abandoned and says it may have left; mid-GATE and never-flushed are handed on, not ended', async () => {
    // 1 · after the handover — the message really is with the provider, and we say so.
    const afterSend = gatedSendHost()
    try {
      const id = await flushInFlight(afterSend, 'mid-flight')
      await afterSend.runtime.close(id, sink)
      expect(
        eventsOfType('message_unqueued').at(-1)?.detail,
        'the uncertain abandon says nothing about being uncertain',
      ).toMatch(/already being sent/)
      afterSend.release()
    } finally {
      afterSend.release()
      await afterSend.runtime.closeAll()
    }

    // 2 · ⛔ **THE DISCRIMINATOR** — a flush suspended in the turn gate. `session.flushing` is
    //     non-null here exactly as it is above, and the message has NOT been handed over. A detail
    //     claiming it may have reached the agent would be a sentence about something that did not
    //     happen, and it would be the ONLY ending the reader gets.
    sink.messages.length = 0
    const midGate = gatedSendHost()
    try {
      const id = await queueThenEndTurn(midGate.runtime, 'still at the gate', midGate.armGate)
      await midGate.reachedGate
      await midGate.runtime.close(id, sink)
      // ⚑ **D-017 · R3 — handed on, so no ending at all**: a detail claiming it may have reached the
      // agent would be a sentence about something that did not happen, and so would `abandoned`.
      expect(
        eventsOfType('message_unqueued'),
        'a message that never reached the provider was ended by a stop',
      ).toEqual([])

      // 🔴 **…and the flush must not go on to hand it over** (234 §1, from run 1's `M2` survivor).
      // ⛔ The ledger half above passes either way: without the check before the handover, the
      // resumed flush sends the message and then finds it no longer owns the ending, so it publishes
      // nothing — one ending in the transcript, and an agent answering a message that was accounted
      // for as abandoned, into a session being torn down. ⚑ The observable is the HANDOVER itself.
      midGate.releaseGate()
      await settled()
      // 🔴 **670 · by what the handed string CONTAINS.** ⛔ This compared whole array elements, and
      // since `607` every string a window hands over opens with the person's frame, so no element
      // could ever equal the bare words and the assertion passed over the very handover it forbids:
      // `234 M2` survived on `main`. ⚑ A negative takes the wide shape; the positive below keeps the
      // whole string, which is `607`'s own choice for it.
      expect(
        midGate.sends.some((sent) => sent.includes('still at the gate')),
        'the provider was handed a message the ledger had already ended',
      ).toBe(false)
      expect(eventsOfType('user_turn').map((event) => event.text)).not.toContain(
        'still at the gate',
      )
      // ⚑ …and the resumed flush wrote no ending for it either: it is the next start's to send.
      expect(eventsOfType('message_unqueued')).toEqual([])
    } finally {
      midGate.releaseGate()
      await midGate.runtime.closeAll()
    }

    // 3 · the ordinary path: queued, never flushed, closed. Nothing was in flight, nothing to doubt
    //     — and, D-017 · R3, nothing ended: it waits for the next start.
    sink.messages.length = 0
    const id = await busySession()
    await host.queueMessage(id, 'never went anywhere', sink)
    expect(eventsOfType('message_queued').map((event) => event.text)).toEqual([
      'never went anywhere',
    ])
    await host.close(id, sink)
    await settled()
    expect(
      eventsOfType('message_unqueued'),
      'a stop with nothing in flight ended what it held',
    ).toEqual([])
    expect(eventsOfType('user_turn').map((event) => event.text)).not.toContain(
      'never went anywhere',
    )
  })

  /**
   * ⛔ **A handover that THREW leaves nothing to be uncertain about** (234 §1, from run 1's `M6`
   * survivor).
   *
   * ⚠️ **`M6` — deleting the marker's `finally` — survived the first run, and the row's own
   * reasoning was what was wrong.** I wrote it as *"every abandon after the first flush claims a
   * doubt"*, and that cannot happen: `handingOver` is compared by IDENTITY, so a stale marker points
   * at a message that is already gone and can never match a new one.
   *
   * ⚑ **The `finally` is load-bearing on exactly one path**: a send that throws. `runFlush` catches
   * it and leaves the message QUEUED — so without the clear, the marker is still standing over a
   * message that is still there, and the next abandon inherits a doubt it has no right to. The
   * realistic causes are a session that went terminal and a refused sign-in; neither reached the
   * provider, so the bare `abandoned` is the true word.
   *
   * ⚑ **D-017 · R3 — and a stop now ends only the message the marker stands over** (a cut
   * handover). So the property reads more sharply than it did: with the marker cleared, the Close
   * finds nothing mid-handover and ends NOTHING — the message is handed on to the next start. A
   * marker left standing would make it the one message a stop abandons, with a doubt it has no
   * right to.
   */
  it('🔴 a send that threw leaves the message queued, and a Close then hands it on rather than abandoning it (234 §1)', async () => {
    const failing = gatedSendHost()
    try {
      const id = await queueThenEndTurn(failing.runtime, 'the one that would not go', () =>
        failing.failSends(),
      )
      await failing.sendFailed

      // The catch left it queued on purpose — nothing has ended it yet.
      expect(eventsOfType('message_unqueued')).toEqual([])
      // ⚑ **607 · what the provider was handed, whole** — a window is a person, so the words
      // arrive under `HO-088` §4's line. ⛔ Re-aimed rather than loosened to `some(includes)`:
      // what this test is about is that the string reached the transport at all, and a whole-string
      // match still says so while also saying it was not mangled on the way.
      expect(failing.sends).toContain(
        messageNamingItsSender('the one that would not go', THE_PERSON_AT_A_WINDOW),
      )

      await failing.runtime.close(id, sink)
      await settled()
      expect(
        eventsOfType('message_unqueued'),
        'a handover that threw was recorded as one that may have reached the agent',
      ).toEqual([])
    } finally {
      await failing.runtime.closeAll()
    }
  })

  it('holds a SECOND queued message BEHIND the first, never overwriting it (acc. 5, D-010)', async () => {
    const id = await busySession()
    await host.queueMessage(id, 'the first waiting one', sink)

    // ⚑ **D-010** — this was refused until the mailbox held more than one; now it waits its turn.
    const second = await host.queueMessage(id, 'the second waiting one', sink)
    expect(second.outcome).toBe('queued')
    // The first is untouched. Overwriting would be the silent drop the dispatch calls the worst
    // outcome, wearing the word "queue".
    expect(eventsOfType('message_queued').map((event) => event.text)).toEqual([
      'the first waiting one',
      'the second waiting one',
    ])
    expect(eventsOfType('message_unqueued')).toEqual([])
  })

  /**
   * ⚑ **D-017 · R3 — a Close is a STOP, and a stop ends nothing it held.** This read *"a
   * conversation that ends underneath it records the message as ABANDONED"*. ⛔ A Close no longer
   * ends the conversation, so the message gets no ending here: it is handed on to the next start,
   * which sends it first. ⚑ What stays true of acc. 5: it is never sent into the conversation that
   * is stopping, and nobody is told it was cancelled. ⚠️ `NULL_SESSION_STORE` has no recording to
   * start again from — the start that delivers it is `the-message-that-has-no-name.test.ts`'.
   */
  it('a conversation that stops underneath it hands the message on — no ending, never sent into the stop (acc. 5)', async () => {
    const id = await busySession()
    await host.queueMessage(id, 'this goes at the next start', sink)

    await host.close(id, sink)
    await settled()

    expect(eventsOfType('message_unqueued')).toEqual([])
    expect(eventsOfType('user_turn').map((event) => event.text)).not.toContain(
      'this goes at the next start',
    )
  })

  /**
   * ⚑ **D-017 · R1 — *still closing* is never a refusal.** A send or a queue that arrives during
   * teardown waits out the stop and starts the conversation again; a start that fails is a delivery
   * failure with ITS true reason. ⚠️ **This file's store is `NULL_SESSION_STORE`**, so the true
   * reason here is that there is no recording to start again from — which is what makes the
   * refusal measurable at all. ⛔ Never *still closing*, and nothing is held in the ledger of the
   * conversation that was stopping.
   */
  it('a send or a queue arriving during teardown waits out the stop, and a start that fails says its own true reason (acc. 7)', async () => {
    const id = await busySession()
    // Not awaited: teardown has to be IN FLIGHT for this to be the case under test. Awaiting it
    // would test the closed session instead, which is a different path.
    const closing = host.close(id, sink)

    const queued = host.queueMessage(id, 'too late', sink)
    const sent = host.send(id, 'also too late', sink)
    // ⚑ Each says there is nothing recorded to start again from — the start's own reason, or the
    // existence rail asked before a start (`unknown session`), whichever door the message took.
    // ⚠️ Both are the one fact of a store that records nothing; neither is the stop's.
    // ⚑ **D-017b · the words moved, the fact did not**: *"no recording of this conversation to
    // reopen"* became *"no record of this conversation here"*, and the stop's own sentence says
    // BroBot2 is *still putting away this conversation's last session* where it said *still
    // closing* — so the negative below names the stop in its current words, or it is vacuous.
    const noRecording = /no record of this conversation|unknown session/
    const theStopSays = "still putting away this conversation's last session"
    // ⚑ …and those ARE the stop's words, in both of its arms, so the two negatives below exclude
    // something real.
    expect(describeUnavailable('still-closing')).toContain(theStopSays)
    expect(describeUnavailable('still-closing', { reopening: true })).toContain(theStopSays)
    await expect(queued).rejects.toThrow(noRecording)
    await expect(sent).rejects.toThrow(noRecording)
    await expect(queued).rejects.not.toThrow(theStopSays)
    await expect(sent).rejects.not.toThrow(theStopSays)

    await closing
    expect(eventsOfType('message_queued')).toEqual([])
  })

  it('an idle session SENDS a queue request instead of refusing it — the keypress race (acc. 5)', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)

    // Nothing is running: the composer decided "queue" against a status that had already changed.
    const outcome = await host.queueMessage(created.sessionId, 'straight out', sink)

    expect(outcome.outcome).toBe('sent')
    expect(eventsOfType('user_turn').map((event) => event.text)).toContain('straight out')
    // Nothing was ever queued, so there is nothing to cancel and nothing claiming to wait.
    expect(eventsOfType('message_queued')).toEqual([])
  })

  it('interrupt-and-send closes the running turn as `interrupted` (acc. 3)', async () => {
    const id = await busySession()

    await host.sendInterrupting(id, 'stop that, do this instead', sink)

    // `sendInterrupting` resolves once the handle reports idle; the `turn` event describing HOW it
    // ended reaches the sink through the pump, which is a separate hop. Asserting straight after the
    // await reads an empty list and fails against a correct host.
    const turnStates = (): string[] =>
      sink
        .events()
        .filter(
          (event): event is Extract<TranscriptEvent, { type: 'turn' }> => event.type === 'turn',
        )
        .map((turn) => turn.state)
    await waitFor(() => turnStates().includes('interrupted'), 'the interrupted turn terminal')

    expect(turnStates()).toContain('interrupted')
    expect(eventsOfType('user_turn').map((event) => event.text)).toContain(
      'stop that, do this instead',
    )
  })

  it('tells every window the queue changed — including when it EMPTIES (076 dedupe trap)', async () => {
    const id = await busySession()

    // ⚠️ **A baseline first, and this is not ceremony.** `lastDisclosures` starts unset, so the very
    // first `publishStateIfChanged` on a session goes out whatever the dedupe key contains — a test
    // that measured from session creation would pass against a key that had forgotten `queued`
    // entirely. That is exactly how 076 shipped the same bug 060 had already fixed once.
    await host.setApprovalMode(id, 'ask', sink)
    const baseline = sink.liveness.length

    const held = await queueNamed(host, id, 'waiting on you', sink)
    const afterQueue = sink.liveness.slice(baseline)
    // ⚑ **The NAME travels with the text** (354): a window that was told only the words could not
    // cancel it, because the verb no longer takes a session on its own.
    expect(afterQueue.at(-1)?.queued).toMatchObject([{ id: held, text: 'waiting on you' }])

    await host.cancelQueuedMessage(id, held, sink)
    const afterCancel = sink.liveness.slice(baseline + afterQueue.length)
    // `[]`, not absent: "nothing is queued any more" is a value that has to travel, or a second
    // window keeps offering to cancel a message that is already gone. ⚑ **`394` made the empty
    // value an EMPTY LIST rather than `null`, which makes this assertion matter more rather than
    // less**: `[]` is truthy, so a projection that guarded on truthiness would now apply it and
    // swallow the genuinely-absent case instead — `toEqual([])` refuses both mistakes.
    expect(afterCancel.length).toBeGreaterThan(0)
    expect(afterCancel.at(-1)?.queued).toEqual([])
  })

  it('leaves an unattended session unattended — no card, no queue, no stall (acc. 8)', async () => {
    // `auto` is the yolo opt-in: the whole point is that nobody is watching. Queueing must not
    // introduce a state that waits for a human.
    const created = await host.createSession({ provider: 'claude', approvalMode: 'auto' }, sink)
    await host.send(created.sessionId, 'run unattended', sink)

    // ⛔ **This used to wait for `status` events and was a FALSE GREEN** (186, from 182 H4). The
    // opening statuses arrive before the asynchronous driver reaches its card, so the two negatives
    // below were read at a moment when nothing could have contradicted them yet — and the Fake
    // published a card in every mode, so what they were really measuring was the scheduler.
    //
    // Waited on the turn's TERMINAL instead: after it, the turn is over and no card can still be
    // coming. The tool_call assertion is the positive pair — an unattended session still DOES the
    // work, so "no card" is a statement about consent rather than about a turn that never ran.
    await waitFor(() => sink.types().includes('turn'), 'the unattended turn to finish')
    expect(sink.types(), 'it ran the tool, it just did not ask').toContain('tool_call')
    // No card was published, so nothing was waiting on a human…
    expect(sink.types()).not.toContain('permission_request')
    // …and nothing queued itself behind one.
    expect(eventsOfType('message_queued')).toEqual([])
    expect(eventsOfType('message_unqueued')).toEqual([])
  })
})

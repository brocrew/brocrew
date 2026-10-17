import { isReasoning, stallNotice, type RuntimeEvent } from '@brobot2/runtime'
import type { SessionLiveness } from '../../shared/runtime-ipc'

/**
 * "Is the provider actually alive?" — answered from the signals we already have.
 *
 * A PID would only answer it for one provider: the host spawns the Codex app-server
 * child, but the Claude subprocess belongs to the Agent SDK and we never hold its
 * handle. So liveness here is **behavioural** — what the session is doing, and how
 * long it has been since it last did anything — which is both uniform across
 * providers and closer to the question actually being asked, since a process that is
 * up but wedged is exactly the case that hurt.
 *
 * The rule that matters: silence is measured, not duration. Every event resets the
 * window, so a legitimately long turn never reads as stalled — and a turn parked on a
 * permission card is not silence at all, it is waiting for the user.
 *
 * ⚑ **The notice now covers work no turn was ever opened for, and its last clause is finally true**
 * (123). This arms on `status: working`, which as of 123 includes a burst the provider started by
 * itself — so a background run that wakes the agent and then goes quiet raises the same notice a
 * stalled turn does. ⛔ Until 123 that sentence ended *"you can interrupt"* while `interrupt()`
 * returned on its first line for want of a turn: the notice named a control that did nothing, in the
 * one state where the user most needed it (122 §11.2).
 */

/**
 * The silence window before a working turn reads as `silent`.
 *
 * It deliberately matches the runtime's own stall watchdog so the header and the
 * in-transcript notice describe the same reality. That constant is internal to
 * `packages/runtime` (which is GO-locked and not to be edited), so this is a
 * deliberate duplicate — `test/liveness.test.ts` imports the runtime's value and
 * fails if the two ever drift apart.
 */
export const DEFAULT_SILENCE_WINDOW_MS = 120_000

export interface LivenessTimers {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
}

const realTimers: LivenessTimers = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    // Reporting on silence must never be the reason the process stays alive.
    ;(handle as { unref?: () => void }).unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface LivenessOptions {
  windowMs?: number
  now?: () => number
  timers?: LivenessTimers
}

/**
 * Tracks one session's liveness from its event stream. Fed every event the host
 * forwards; calls `onChange` only when the state actually changes, so the renderer
 * is not woken for a state it already shows.
 */
export class LivenessTracker {
  private state: SessionLiveness
  private working = false
  /** Whether the last event was the model reasoning, so a silence after it is said as thinking. */
  private afterReasoning = false
  private handle: unknown = null
  private readonly windowMs: number
  private readonly now: () => number
  private readonly timers: LivenessTimers

  constructor(
    private readonly onChange: (liveness: SessionLiveness) => void,
    options: LivenessOptions = {},
  ) {
    this.windowMs = options.windowMs ?? DEFAULT_SILENCE_WINDOW_MS
    this.now = options.now ?? Date.now
    this.timers = options.timers ?? realTimers
    this.state = { state: 'live', since: this.now() }
  }

  get current(): SessionLiveness {
    return this.state
  }

  /** True once the session is terminal — nothing can bring it back. */
  private get frozen(): boolean {
    return this.state.state === 'ended' || this.state.state === 'errored'
  }

  /**
   * Observe one event. Called for every event the host forwards, before it is sent,
   * so the renderer never sees an event that contradicts the liveness beside it.
   */
  observe(event: RuntimeEvent): void {
    if (this.frozen) return

    switch (event.type) {
      case 'status':
        // The lifecycle statuses are terminal; the rest describe an alive session.
        if (event.state === 'ended') return this.terminal('ended')
        if (event.state === 'errored') return this.terminal('errored')
        // A card waiting on the user is not a stall — stop watching until it is answered.
        this.working = event.state === 'working'
        break
      case 'session':
        if (event.state === 'ended') return this.terminal('ended')
        break
      case 'error':
        // ⚠️ **An error that carries a `cause` does NOT hand its message to the header** (110,
        // found in review). `detail` is rendered under the session header whenever the state is not
        // `live`, so before 110 this line could only ever show a diagnostic — every `cause`-bearing
        // error was non-fatal and never reached here. A fatal one now does, and its `message` is the
        // provider's verbatim sentence: *"Failed to authenticate. API Error: 401 OAuth access token
        // has been revoked."* would have been printed under the header, in the provider's words,
        // beside a transcript notice carefully written not to use them. That is the leak the `cause`
        // split exists to prevent, arriving through the sibling surface nobody was looking at.
        //
        // No detail rather than a translated one: the transcript already says what happened and what
        // to do, and a second, shorter version of it in a different place is how two surfaces come to
        // disagree. The sentence is not lost — it is on the event, in the ledger, and in the debug
        // stream.
        if (event.fatal) return this.terminal('errored', event.cause ? undefined : event.message)
        // The runtime's own stall notice reports this silence; it is not proof of life.
        if (event.stall) return
        break
      default:
        break
    }

    // Anything arriving at all is proof of life: back to live, window restarted.
    this.afterReasoning = isReasoning(event)
    this.activity()
  }

  /** Stop the timer — the session is gone and nothing further will be reported. */
  stop(): void {
    this.clear()
  }

  private activity(): void {
    this.clear()
    if (this.state.state !== 'live') this.set({ state: 'live', since: this.now() })
    if (!this.working) return
    const quietFrom = this.now()
    this.handle = this.timers.setTimeout(() => {
      this.handle = null
      if (this.frozen || !this.working) return
      this.set({
        // When the silence STARTED, not when we concluded it had: the provider has
        // already been quiet for a whole window by now, and a counter starting at 0s
        // would understate the stall at the exact moment it starts mattering.
        since: quietFrom,
        state: 'silent',
        ...(this.afterReasoning
          ? { detail: stallNotice(this.windowMs, true), thinking: true as const }
          : {
              detail: `no activity for ${Math.round(this.windowMs / 1000)}s — the provider may be busy, rate-limited, or stalled; you can interrupt`,
            }),
      })
    }, this.windowMs)
  }

  private terminal(state: 'ended' | 'errored', detail?: string): void {
    this.clear()
    this.working = false
    this.set(
      detail === undefined ? { state, since: this.now() } : { state, since: this.now(), detail },
    )
  }

  private set(liveness: SessionLiveness): void {
    this.state = liveness
    this.onChange(liveness)
  }

  private clear(): void {
    if (this.handle !== null) {
      this.timers.clearTimeout(this.handle)
      this.handle = null
    }
  }
}

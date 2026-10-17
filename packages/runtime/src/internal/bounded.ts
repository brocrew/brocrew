/**
 * Await `p`, but resolve after `ms` at the latest — so a teardown barrier never
 * hangs on a provider that is slow (or fails) to acknowledge an interrupt or a
 * flushed write. Always resolves (never rejects); a rejection of `p` is
 * swallowed, since teardown is best-effort past this point. The timer is
 * `unref`'d so a pending bound can't keep the process alive.
 */
export function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') timer.unref()
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    p.then(done, done)
  })
}

/**
 * What {@link withDeadline} rejects with when the wait ran out. Its own class, so a caller can tell
 * work that was too slow, which the next ask may find answered, from work that failed.
 */
export class DidNotAnswerInTime extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DidNotAnswerInTime'
  }
}

/** Whether a failure, or a cause it carries, is a wait that ran out ({@link DidNotAnswerInTime}). */
export function didNotAnswerInTime(error: unknown): boolean {
  for (let one = error, depth = 0; one instanceof Error && depth < 8; depth += 1) {
    if (one instanceof DidNotAnswerInTime) return true
    one = one.cause
  }
  return false
}

/**
 * Await `p`, but REJECT after `ms` — the other half of {@link withTimeout}, for the case where a
 * caller needs to know the wait failed rather than merely that it is over (058 review).
 *
 * The distinction is the whole reason both exist. `withTimeout` is for TEARDOWN, where past a point
 * nothing can be done and pressing on is right. This is for a QUESTION: a provider probe that never
 * answers must become a rejection, because the layer above turns a rejection into "we could not
 * ask" and keeps working, while a promise that simply never settles is indistinguishable from one
 * still in flight — it poisons every caller that awaits it, forever.
 *
 * ⚠️ **It does not cancel `p`.** Nothing here can: the work is a child process, and reaching into
 * it is the caller's job. A caller MUST still tear its resource down on the rejection path, which
 * is why every use of this is paired with a `finally` that closes something. Rejecting only
 * releases the AWAITER; it does not release the work.
 *
 * The timer is `unref`'d so a pending bound cannot keep the process alive.
 */
export function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DidNotAnswerInTime(`${what} did not answer within ${ms}ms`)),
      ms,
    )
    if (typeof timer.unref === 'function') timer.unref()
    p.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * **The other axis of the same distinction** (070, from 068 finding 2).
 *
 * {@link withTimeout} and {@link withDeadline} both say the same thing about the awaiter: releasing
 * it does not release the work. These two are how the WORK gets released — the half that had no
 * implementation, which is why a provider spawned before its handshake had nothing that could stop
 * it and could outlive the app.
 *
 * Refuse before anything is spawned. Called at the very top of a launch, above the transport, the
 * query and the preconditions: a cancelled launch must leave no state to unwind, and the only way to
 * promise that is to have created none.
 */
export function assertNotCancelled(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted === true) throw new Error(`${what} was cancelled before it started`)
}

/** A launch's cancel, wired to the teardown of what the launch has built. See {@link cancelWith}. */
export interface LaunchCancel {
  /** Whether the launch has been cancelled — read after every await inside the launch. */
  readonly cancelled: boolean
  /**
   * Stop reacting to the signal. Called once the launch is over, however it ended.
   *
   * ⚠️ **Not optional, and not merely hygiene.** A signal left wired to a session that successfully
   * started would hand whoever holds the controller a way to close a LIVE conversation's transport
   * out from under it — the handle is the caller's the moment it is returned, and
   * `SessionHandle.close` is the only thing that may stop it after that.
   */
  release(): void
}

/**
 * Tear down what a launch built the moment the launch is cancelled — and only while it is running.
 *
 * The listener is what makes cancellation reach a CHILD PROCESS rather than an awaiting promise. It
 * fires at most once, its teardown's own failure is swallowed (this is teardown; there is nobody
 * left to tell), and it is removed by {@link LaunchCancel.release}.
 *
 * ⛔ **An ALREADY-aborted signal tears down too** (180). `addEventListener('abort')` on a signal
 * that has already fired never runs, and until a launch could await between its
 * {@link assertNotCancelled} and its spawn, nothing could get in there — the whole prologue was
 * synchronous. 180's per-home boot gate put an await exactly there, and the hole became reachable:
 * abort in that interval and the child spawns with no listener wired, which is 070's leak with the
 * ownership gap moved one line to the left. Two conformance tests found it, and they were right to.
 */
export function cancelWith(
  signal: AbortSignal | undefined,
  tearDown: () => Promise<void> | void,
): LaunchCancel {
  if (signal === undefined) return { cancelled: false, release: () => {} }
  const onAbort = (): void => {
    void (async () => tearDown())().catch(() => {
      // Teardown on a cancel path: the caller is already being told the launch failed, and a
      // second failure here has nowhere to go that is not noise on top of it.
    })
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  return {
    get cancelled(): boolean {
      return signal.aborted
    },
    release: () => signal.removeEventListener('abort', onAbort),
  }
}

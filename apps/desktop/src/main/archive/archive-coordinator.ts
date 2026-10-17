/**
 * **Catch-up work on the database, queued and stoppable** (062, from 061 finding 1).
 *
 * Imports from a provider's file and rebuilds go through here: one at a time, so two passes never
 * derive the same session at once; stopped at their next batch once the quit begins; and waited for
 * before the database closes, so a pass admitted a moment before the quit never writes into a
 * closed connection.
 *
 * ## The three states
 *
 *  - **`open`** — ordinary running. Work is admitted.
 *  - **`background-closed`** — the quit has started. New work is refused and anything in flight is
 *    cancelled at its next batch.
 *  - **`closed`** — {@link ArchiveCoordinator.drain} has been called and returned. Nothing is
 *    admitted at all, and the caller may now close the database.
 *
 * ## ⚠️ Background work must not nest
 *
 * The lane is a queue, so a job that submits work would wait for itself forever. It cannot be
 * detected at the call site without threading async context through everything, so it is a rule
 * rather than a guard: none of the callers of {@link ArchiveCoordinator.background} calls another.
 */

/** Where the coordinator is in its lifetime. See the module note for what each state admits. */
export type ArchiveGate = 'open' | 'background-closed' | 'closed'

/** What a refused submission says. Matched by {@link isArchiveRefused}, never parsed by eye. */
const REFUSED = 'BroCrew is shutting down, so no new archive work was started'

/**
 * Whether an error is a refusal from the coordinator rather than a failure of the work.
 *
 * A refusal is not a fault: it means the app is going away and the work will be there next time.
 * Callers that have an honest "nothing happened" answer of their own use this to give it, instead of
 * reporting a shutdown as an error the user is supposed to do something about.
 */
export function isArchiveRefused(error: unknown): boolean {
  return error instanceof Error && error.message === REFUSED
}

export interface ArchiveCoordinator {
  /** Which door is open. See {@link ArchiveGate}. */
  readonly gate: ArchiveGate
  /**
   * True once work is refused — asked by the entry points that have a better answer than a
   * rejection, so they never pay for a scan they are not allowed to use.
   */
  readonly backgroundClosed: boolean
  /**
   * Run catch-up work: an import or a rebuild.
   *
   * Queued, so two passes never derive the same session at once (046's P2 — the loser collides on
   * `(session_id, ordinal)` and the winner has already made it look permanently done). Cancellable:
   * the `cancelled` predicate handed to the work is true from the moment the gate closes, and the
   * work is expected to ask it between batches and between sessions.
   *
   * Rejects with the refusal ({@link isArchiveRefused}) if the gate is shut **at submission**.
   *
   * ⚠️ **A job that was admitted while the gate was open still runs, even if the quit arrives while
   * it is queued behind another one** — and that is the point of admission, not a hole in it. It
   * starts already cancelled, so it stops at its first batch boundary; and because it was admitted,
   * {@link drain} waits for it.
   */
  background<T>(work: (cancelled: () => boolean) => Promise<T>): Promise<T>
  /** Refuse new work and cancel what is in flight. Idempotent; never un-done. */
  rejectNewBackgroundWork(): void
  /**
   * Close the lane and wait for everything already admitted.
   *
   * ⚠️ **Unbounded, and that is the choice.** A bound here could only ever fire in the case it
   * exists to prevent — closing SQLite out from under a job that is still writing to it. Nothing it
   * waits for is unbounded on its own terms: cancellable work asks at every batch boundary, and the
   * steps that cannot be interrupted are synchronous better-sqlite3 commits, during which no
   * timeout could fire anyway.
   *
   * Never rejects. A job that failed still counts as finished, and the drain's only question is
   * whether anyone is still holding the connection.
   */
  drain(): Promise<void>
}

export function createArchiveCoordinator(): ArchiveCoordinator {
  let gate: ArchiveGate = 'open'
  /** Every admitted job, as a promise that cannot reject. See {@link track}. */
  const inFlight = new Set<Promise<void>>()
  /** The tail of the queue — one pass at a time, whatever asked for it. */
  let backgroundTail: Promise<void> = Promise.resolve()

  /**
   * Remember a job for the drain.
   *
   * What is tracked is a SETTLED shadow of the caller's promise, not the promise itself: a job that
   * rejects must still be waited for, and adding the raw promise to a set the drain awaits would
   * turn every failed pass into an unhandled rejection.
   */
  const track = <T>(work: Promise<T>): Promise<T> => {
    const settled = work.then(
      () => {},
      () => {},
    )
    inFlight.add(settled)
    void settled.then(() => inFlight.delete(settled))
    return work
  }

  return {
    get gate(): ArchiveGate {
      return gate
    },

    get backgroundClosed(): boolean {
      return gate !== 'open'
    },

    background<T>(work: (cancelled: () => boolean) => Promise<T>): Promise<T> {
      if (gate !== 'open') return Promise.reject(new Error(REFUSED))
      // The predicate is READ AT EVERY ASK, never captured: a job admitted now and started after
      // the quit sees `true` on its first question, which is how "queued across a shutdown" comes
      // out as a pass that writes nothing rather than one that races the close.
      const run = (): Promise<T> => work(() => gate !== 'open')
      const result = backgroundTail.then(run, run)
      // Both arms, so a pass that threw does not stop the next one from running.
      backgroundTail = result.then(
        () => {},
        () => {},
      )
      return track(result)
    },

    rejectNewBackgroundWork(): void {
      if (gate === 'open') gate = 'background-closed'
    },

    async drain(): Promise<void> {
      gate = 'closed'
      // In rounds rather than once, because REMOVAL lags: entries delete themselves on a microtask
      // after settling, so a round can resolve while the set still lists promises that are already
      // done. Re-reading it is how the loop notices, and since nothing new can be admitted now, the
      // set only shrinks — so this terminates.
      for (let round = [...inFlight]; round.length > 0; round = [...inFlight]) {
        await Promise.all(round)
      }
    },
  }
}

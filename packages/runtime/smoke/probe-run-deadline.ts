/**
 * ⛔ **One outer deadline for a whole probe run** (standing rule 13) — `655`, from `649` F3.
 *
 * `649` landed two hand-written copies of this and they already disagreed: the cancel-interrupt
 * probe's deadline was ABSOLUTE — born on the first test, shared by the second, with a refusal
 * before each capture — and the exec-permission probe's was PER CALL, a fresh timer every time it
 * was asked. ⚑ **This is the one semantics, and it is the cancel probe's**, for three reasons:
 *
 *  1. **A budget is a claim about the RUN.** A per-call timer hands every test its own budget, so a
 *     file of N tests is bounded by N budgets — the exact defect the cancel probe's `??=` fixed
 *     for arm D. With one test the two readings agree, which is why the exec copy never showed it.
 *  2. **A capture must not START after the deadline.** A timer lagging under load, or a Mac that
 *     slept, leaves the wall clock past the deadline while the timer has not fired; `refuse` reads
 *     the clock as well as the bit, so no provider child is spawned into a run that is already over.
 *  3. **Expiry tears down BEFORE it rejects — and WAITS for it, bounded.** The capture a deadline
 *     cuts off is still holding an app-server and a loopback server; `own` registers that teardown,
 *     and the timer rejects only once it has finished or `teardownMs` has passed. ⚠️ `655`'s review
 *     measured why "started" was not enough: the file ends with the rejection, vitest stops the fork
 *     (SIGTERM, then SIGKILL 500 ms later), and the transport only signals the app-server's group
 *     after a 2 s exit grace — so a teardown merely STARTED could die with the fork.
 *
 * ⚠️ **A late settle is reported as the deadline, never as the work's own result.** Work that
 * resolves or rejects once the run is out of time — bit OR clock — is the deadline's, so a refusal
 * something swallowed cannot turn an unmeasured arm into a pass.
 *
 * ⛔ **What this does NOT do: bound a single wait.** Every protocol wait keeps its own bound; this
 * is the outer one, and `042`'s rule (`vitest.smoke.config.ts`) sizes it — it must comfortably
 * EXCEED the sum of those waits, so a hung step fails as itself and not as *budget exceeded*.
 * {@link runBudgetMs} is how an adopter derives it rather than writing a constant.
 */

/** ⚑ Rule 13's word: a run the deadline cut off was never measured — not failed. */
export class ProbeRunDeadlineExpired extends Error {
  constructor(probe: string, budgetMs: number, what: string) {
    super(`NOT PERFORMED — the ${probe} exceeded its ${budgetMs}ms total budget while ${what}`)
    this.name = 'ProbeRunDeadlineExpired'
  }
}

/**
 * ⚑ **`042`'s sizing rule, as arithmetic.** The worst case is every bounded wait expiring in turn;
 * the budget is that sum times a margin, so it "comfortably exceeds" it and moves when a wait does.
 */
export const RUN_BUDGET_MARGIN = 1.5

export function runBudgetMs(serialWaitsMs: readonly number[]): number {
  const worst = serialWaitsMs.reduce((sum, one) => sum + one, 0)
  return Math.ceil(worst * RUN_BUDGET_MARGIN)
}

/**
 * ⚠️ **How far vitest's own `it()` timeout sits past the deadline and its teardown.** The deadline
 * must be the bound that fires — vitest's timeout releases the awaiter and not the child — so every
 * adopter passes {@link ProbeRunDeadline.testTimeoutMs} to its `it()`.
 */
export const TEST_TIMEOUT_MARGIN_MS = 30_000

export interface ProbeRunDeadline {
  readonly budgetMs: number
  /** For each `it()`: past the deadline AND its teardown, so the deadline always fires first. */
  readonly testTimeoutMs: number
  /** Run `work` inside what REMAINS of the run's budget. The deadline is born on the first call. */
  within<T>(what: string, work: () => Promise<T>): Promise<T>
  /** Before starting a capture: throw NOT PERFORMED, and start owned teardown, if out of time. */
  refuse(what: string): void
  /** Register the live capture's teardown. Returns the release its own `finally` must call. */
  own(stop: () => Promise<void>): () => void
}

/**
 * @param teardownMs how long expiry waits for the owned teardown before rejecting anyway — the
 * adopter's own teardown bound, so a teardown that hangs cannot hold the rejection forever.
 */
export function probeRunDeadline(
  probe: string,
  budgetMs: number,
  teardownMs: number,
): ProbeRunDeadline {
  let deadlineAt: number | null = null
  let expired = false
  let stopActive: (() => Promise<void>) | null = null

  const outOfTime = (): boolean => expired || (deadlineAt !== null && Date.now() >= deadlineAt)
  /**
   * Set the bit and START tearing the live capture down, both synchronously; then WAIT for the
   * teardown — bounded by `teardownMs` — so whoever rejects afterwards does so over a capture that
   * is already closed.
   */
  const expire = async (): Promise<void> => {
    expired = true
    const stop = stopActive
    if (stop === null) return
    let stopping: Promise<void>
    try {
      stopping = stop().catch(() => {})
    } catch {
      stopping = Promise.resolve()
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        stopping,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, teardownMs)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  return {
    budgetMs,
    testTimeoutMs: budgetMs + teardownMs + TEST_TIMEOUT_MARGIN_MS,

    async within<T>(what: string, work: () => Promise<T>): Promise<T> {
      deadlineAt ??= Date.now() + budgetMs
      const deadlineError = new ProbeRunDeadlineExpired(probe, budgetMs, what)
      if (outOfTime()) {
        await expire()
        throw deadlineError
      }

      let timer: ReturnType<typeof setTimeout> | undefined
      // ⚠️ Everything inside the `try`, so a `work` that throws synchronously still clears the
      // timer — otherwise it would fire later, tear down a capture it no longer owns, and reject
      // a promise nobody is holding (`655` review).
      try {
        const expiry = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void expire().then(() => reject(deadlineError))
          }, deadlineAt! - Date.now())
          timer.unref?.()
        })
        const pending = work().then(
          async (value) => {
            if (!outOfTime()) return value
            await expire()
            throw deadlineError
          },
          async (error: unknown) => {
            if (!outOfTime()) throw error
            await expire()
            throw deadlineError
          },
        )
        return await Promise.race([pending, expiry])
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    },

    refuse(what: string): void {
      if (!outOfTime()) return
      // ⚑ Synchronous by contract, so it STARTS the teardown; the capture's own `finally` — which
      // every adopter awaits before its work settles — is what waits for it.
      void expire()
      throw new ProbeRunDeadlineExpired(probe, budgetMs, what)
    },

    own(stop: () => Promise<void>): () => void {
      if (stopActive !== null) {
        throw new Error(`the ${probe} tried to own two captures at once`)
      }
      stopActive = stop
      return () => {
        if (stopActive === stop) stopActive = null
      }
    },
  }
}

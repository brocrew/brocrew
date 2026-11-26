/** A spaced read starts at most once per this: the queue's own look tick. */
const SPACE_MS = 5_000

/**
 * Coalesce a burst into one in-flight read and one follow-up that sees its last change.
 *
 * A `spaced` read waits before a read asked only by `ask(true)` until {@link SPACE_MS} after the
 * last read started, and at least as long as that read took (at most {@link SPACE_MS} after it
 * ended), so a stream of asks cannot keep the reader busy. The last ask is still read. Any other
 * ask ends the wait and reads now, except that `ask('scheduled')`, which carries no change of its
 * own, rides on a read already in flight.
 */
export function oneReadAtATime(
  read: () => Promise<void>,
  options: { readonly spaced?: boolean } = {},
): (patient?: boolean | 'scheduled') => Promise<void> {
  let running: Promise<void> | null = null
  let owed = false
  let hurried = false
  let endWait: (() => void) | null = null
  let reading = false
  let lastStarted: number | null = null
  let lastEnded = 0

  const waitOut = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => endWait?.(), ms)
      endWait = () => {
        clearTimeout(timer)
        endWait = null
        resolve()
      }
    })

  const drain = async (): Promise<void> => {
    try {
      let failed: { readonly error: unknown } | null = null
      while (owed) {
        if (options.spaced === true && !hurried && lastStarted !== null) {
          const took = lastEnded - lastStarted
          const ready = Math.max(lastStarted + SPACE_MS, lastEnded + Math.min(took, SPACE_MS))
          const left = ready - performance.now()
          if (left > 0) await waitOut(left)
        }
        owed = false
        hurried = false
        failed = null
        lastStarted = performance.now()
        reading = true
        try {
          await read()
        } catch (error) {
          failed = { error }
        }
        reading = false
        lastEnded = performance.now()
      }
      if (failed !== null) throw failed.error
    } finally {
      running = null
    }
  }

  return (patient?: boolean | 'scheduled') => {
    if (patient === 'scheduled' && reading && running !== null) return running
    owed = true
    // Only an explicit `true` may wait; an event object handed in by a listener must not.
    if (patient !== true) {
      hurried = true
      endWait?.()
    }
    if (running !== null) return running
    // ⛔ **`running` is set BEFORE the first read is called.** `read()` runs synchronously up to
    // its first `await`, and an ask made inside that stretch — a listener the read itself wakes —
    // must find a read in flight, not start a second one beside it. Found by this module's own
    // test: calling `drain()` and assigning its promise afterwards left exactly that gap.
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const mine = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    running = mine
    void drain().then(resolve, reject)
    // ⚠️ **`mine`, not `running`** (`672` review): a read that throws before its first `await`
    // makes `drain()` finish INSIDE the call above — its `finally` has already set `running` back
    // to `null`, and returning that would hand the caller no promise at all and leave the rejection
    // with nobody holding it.
    return mine
  }
}

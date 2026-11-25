/** The longest a spaced read waits before its owed follow-up, however long the last read took. */
const LONGEST_SPACE_MS = 5_000

/**
 * Coalesce a burst into one in-flight read and one follow-up that sees its last change.
 *
 * A `spaced` read also waits, before a follow-up owed only to `ask(true)`, as long as the read just
 * took (at most {@link LONGEST_SPACE_MS}), so a stream of asks cannot keep the reader busy back to
 * back. The follow-up is still read, one read's duration after that one. Any ask that is not
 * `ask(true)` ends the wait and reads now.
 */
export function oneReadAtATime(
  read: () => Promise<void>,
  options: { readonly spaced?: boolean } = {},
): (patient?: boolean) => Promise<void> {
  let running: Promise<void> | null = null
  let owed = false
  let hurried = false
  let endWait: (() => void) | null = null

  const waitOut = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => endWait?.(), Math.min(ms, LONGEST_SPACE_MS))
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
        owed = false
        hurried = false
        failed = null
        const started = performance.now()
        try {
          await read()
        } catch (error) {
          failed = { error }
        }
        const took = performance.now() - started
        if (options.spaced === true && owed && !hurried && took > 0) await waitOut(took)
      }
      if (failed !== null) throw failed.error
    } finally {
      running = null
    }
  }

  return (patient?: boolean) => {
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

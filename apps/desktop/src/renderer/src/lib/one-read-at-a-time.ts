/** Coalesce a burst into one in-flight read and one follow-up that sees its last change. */
export function oneReadAtATime(read: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null
  let owed = false

  const drain = async (): Promise<void> => {
    try {
      let failed: { readonly error: unknown } | null = null
      while (owed) {
        owed = false
        failed = null
        try {
          await read()
        } catch (error) {
          failed = { error }
        }
      }
      if (failed !== null) throw failed.error
    } finally {
      running = null
    }
  }

  return () => {
    owed = true
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

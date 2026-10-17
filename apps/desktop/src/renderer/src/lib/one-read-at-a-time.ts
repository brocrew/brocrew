/**
 * 🔴 **672 · at most one read in flight and one pending — so the LAST change is always read.**
 *
 * ## ⛔ What it replaces, priced
 *
 * ⚠️ **`668` made the Team page re-read the whole forest on every `conversations` and `work`
 * announcement**, and said in its own response that the cost was unmeasured. `672` measured it:
 * `RuntimeHost.theWholeForest` is SYNCHRONOUS on the main process and folds up to 500 ledgers, and
 * the announcements come in bursts — ending three children is six, a person answering three
 * children's cards is six, all in one macrotask on the fake runtime. ⛔ Each announcement was one
 * more read, every one of them computed on main while the screen's sequence number threw all but
 * the newest answer away. On a 200-conversation workspace at ~200 ledger events each, one burst of
 * six held main for **132–146 ms**; at ~2,000 events, **741–788 ms**.
 *
 * ## ⚑ The rule
 *
 * ⚑ **A read asked for while one is in flight does not start another** — it marks ONE more read
 * as owed, and however many asks arrive meanwhile, one read is owed. ⚑ **When the in-flight read
 * lands, the owed one starts**, so a change announced after the in-flight read had already been
 * answered on main is still read: *the last change is always read.* A burst of K asks costs at most
 * two reads (the same fixture: 44–49 ms and 247–263 ms).
 *
 * ⛔ **Not a timer.** A debounce needs a window, and a window is a number nobody has measured
 * (`the-world-moved.ts`' own refusal, standing rule 22); this needs none — the read's own round trip
 * is the window.
 *
 * ⚠️ **What a caller's promise means**: it settles when the reads it can be sure saw its change have
 * landed — the one in flight AND the owed one. It rejects only when the LAST read did, so a failure
 * the owed read then repaired is not reported as the outcome.
 */
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

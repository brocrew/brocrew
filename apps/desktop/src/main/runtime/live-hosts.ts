/**
 * **"Nobody is running this" and "I am not the one running this" are different sentences** (198,
 * from 194 H1 and 191 H6/H7/H8).
 *
 * Startup repair — `clearOrphanBuilds` and `settleOrphanRuns` — rests on one premise, which both
 * functions state in their own contracts: *at construction nothing is running, so any row claiming
 * to be is claiming it about a run that ended without saying so*. That premise is an assumption
 * about the **process**, and `session-store.ts` has said so in writing since 074:
 *
 * > *"a second `RuntimeHost` constructed against the same database while a first still held live
 * > sessions would settle rows those sessions are actively using — and the constructor has no
 * > guard, because one host per process is an invariant of the app rather than of this class."*
 *
 * ⛔ **`single-instance.ts` makes a second PROCESS impossible and does nothing about that
 * sentence.** 194 H1's mechanism is *"constructing a second `RuntimeHost`"* — reachable inside one
 * process, which is what every test does and what a window-per-project would do. A repair that
 * cannot tell the two sentences apart is the defect; the lock only makes it rarer.
 *
 * ## Why this is a directory of live hosts and not a column in the database
 *
 * A durable owner stamp — a pid, a run id, a lease — answers "who claimed this" and then has to
 * answer "is that claimant still alive", which is the question that has no local answer and the one
 * 191 M5 already reports going wrong: an `O_EXCL` lock file with no pid in it, whose owner was
 * SIGKILLed, denies every future attempt until somebody deletes it by hand. **A claim that can go
 * stale is a claim that will.**
 *
 * A live host cannot go stale. It is either in this directory or it is not, and what it holds is
 * read from the host itself at the moment of asking rather than from a copy that has to be kept in
 * step. There is one source of truth for what a host is running — its own slots — and this module
 * is a way to reach the other hosts, not a second record of their work.
 *
 * ## ⛔ Why a host joins and never leaves, which is a MEASUREMENT and not an oversight
 *
 * `RuntimeHost.closeAll()` used to leave this directory on its way out, described as tidy-up. `198`'s
 * mutation table put a row against it — *"leaving does nothing, so a host that closed everything
 * holds its work forever"* — and the row came back **GREEN**. It was right to:
 *
 *  - **It could not be shown to do anything.** `closeAll` closes every session before it would have
 *    left, so the slots are already empty; a host still listed here with nothing in flight excludes
 *    nothing, and the only cost of staying is one retained object.
 *  - ⛔ **And where it COULD have done something, it would have done the wrong thing.** A derive
 *    started before the quit resolves after it — `whileBuilding`'s `finally` runs when the promise
 *    settles, not when `closeAll` returns — so for that window a host that had left would have
 *    stopped reporting a rebuild that was **still writing to the database**. That is precisely the
 *    row `clearOrphanBuilds` must not clear.
 *
 * So the call is gone rather than the row being deleted. {@link joinLiveHosts} still hands back a
 * leave, because a TEST that plants a stand-in must be able to remove it before the next one — a
 * fixture outliving its test is a different problem from a host outliving its work.
 */

/** What the directory needs a host to be able to answer. */
export interface LiveHost {
  /**
   * **The ledger this host writes to — for IDENTITY, never for use** (198), which is why the type
   * is `object` and not `SessionStore`.
   *
   * ⛔ **A session id means nothing without the database it lives in.** Two hosts over two databases
   * can both be running `sess_1` and those are two different conversations; excluding one because
   * the other is live would leave a genuinely stranded row claiming to be busy forever, which is
   * 074's defect reintroduced by its own guard. Measured, not imagined: six tests in
   * `process-ownership.test.ts` and `whole-session-reads.test.ts` hand their hosts a counter for an
   * id generator, so `sess_1` recurs across a file in databases that have nothing to do with each
   * other.
   *
   * ⚠️ **Object identity, and what that cannot see.** Two `SessionStore`s opened over ONE database
   * file are two ledgers as far as this directory is concerned. The app makes exactly one, and the
   * alternative — comparing file paths — answers `:memory:` for every in-memory database and would
   * fail in the refusing direction, which is the worse one.
   */
  readonly ledger: object
  /**
   * Every session id this host is running or rebuilding **right now**.
   *
   * ⚠️ **Reserved counts, not just registered.** 062's rule is that ownership begins at the moment
   * an id is taken, before the provider answers — a session whose child is still starting is one
   * this host is running, and it is the exact window a second host's repair would land in.
   *
   * ⚠️ **And rebuilds count**, which is the half a slots-only answer would miss entirely:
   * `rebuildLedger` refuses a session that is in `slots`, so every in-flight rebuild is by
   * construction a session no slot names. 194 H1's second failure is that one — B clears A's
   * `building` marker, A goes on writing rows into a generation nothing will promote, and the
   * caller is told the import succeeded.
   */
  workInFlight(): Iterable<string>
  /** Provider sessions, probes, sign-ins, and launches still owned by this host. */
  providerProcessesInFlight?(): boolean
}

/**
 * Every host that exists in this process, in construction order.
 *
 * Module-level, because the thing it models is the process. Hosts over other databases are in here
 * too and are filtered out by {@link LiveHost.ledger} when asked — the alternative, a directory per
 * ledger, would need somewhere to put the ledgers and something to clean them up.
 */
const directory = new Set<LiveHost>()

/**
 * Join the directory. Returns the leave, which is safe to call more than once.
 *
 * Called from the `RuntimeHost` constructor — before the repair, so that a host asking what others
 * hold cannot be answered with its own (empty) work by accident, and so the ordering is one line
 * rather than a rule to remember. ⚠️ **The host drops the leave**; see the argument above for the
 * measurement that removed the call.
 */
export function joinLiveHosts(host: LiveHost): () => void {
  directory.add(host)
  return () => {
    directory.delete(host)
  }
}

/**
 * Every session id a host OTHER than `self`, **over the same ledger**, is running right now.
 *
 * The empty set is the normal answer: one app, one host, nothing else alive. That is what makes
 * this safe to put in front of a repair that has always run unconditionally — with no other host
 * in the process the behaviour is the one 074 shipped, byte for byte.
 */
export function workRunningElsewhere(self: LiveHost): ReadonlySet<string> {
  const elsewhere = new Set<string>()
  for (const host of directory) {
    if (host === self || host.ledger !== self.ledger) continue
    for (const id of host.workInFlight()) elsewhere.add(id)
  }
  return elsewhere
}

/** Cleanup admission spans every home and ledger in this app process. */
export function providerProcessesAreInFlight(): boolean {
  for (const host of directory) {
    if (host.providerProcessesInFlight?.()) return true
  }
  return false
}

/**
 * The shared request broker (009, fixing 007 P1-2). Tracks server-initiated
 * requests (permission / user-input) by id and makes resolution **atomic,
 * idempotent, and hang-proof**:
 *
 *  - `respond(id, value)` **synchronously takes + deletes** the resolver before
 *    resolving, so an allow-vs-deny race can never fulfil both — the first
 *    response wins and the second is told (via `false`) it did not.
 *  - `register(id)` never overwrites an existing/earlier resolver: a duplicate
 *    delivery for the same id is safe-rejected, so no earlier callback is left
 *    pending forever (007 P1-2, Claude duplicate `toolUseID`).
 *  - A request arriving once the session is closing/closed (gated on the
 *    `SessionMachine` state) is safe-rejected immediately.
 *  - An optional `AbortSignal` (Claude's `canUseTool` signal) settles the
 *    pending request when it aborts, and tells the owner the provider withdrew it.
 *  - `settleAll()` — called on interrupt, fatal error, and close — safe-rejects
 *    every pending request so nothing hangs.
 *
 * Generic over the response type; a handle holds one broker per response kind
 * (permission → `PermissionDecision`, user-input → `UserInputResponse`), each
 * with its own safe-reject default.
 */

/**
 * The outcome of {@link RequestBroker.reserve}: whether this call **took the
 * resolver slot** for the id (`accepted`), plus the response promise. Only an
 * `accepted` reservation may publish an actionable card — reserving BEFORE
 * publishing is what stops a duplicate id from surfacing a second card that would
 * cross-authorize the original request (023 P1-B confused-deputy).
 */
export interface Reservation<T> {
  readonly accepted: boolean
  /** The winning response when `accepted`; an already-resolved safe-reject otherwise. */
  readonly response: Promise<T>
}

export class RequestBroker<T> {
  private readonly pending = new Map<string, (value: T) => void>()
  private readonly answered = new Set<string>()

  constructor(
    /** True once the session is closing/closed — new requests are safe-rejected. */
    private readonly isClosing: () => boolean,
    /** The protocol-safe default response (deny / reject). */
    private readonly safeReject: () => T,
    /**
     * Told when a request's own signal settled it while it still awaited its response: the
     * provider withdrew it. Not told for a request an answer or {@link settleAll} settled first.
     */
    private readonly onWithdrawn?: (id: string) => void,
  ) {}

  /**
   * **Atomically reserve** the resolver slot for `id` (023 P1-B). Returns
   * `accepted:true` with the pending response promise when this call took the slot;
   * `accepted:false` with an already-resolved safe-reject when the session is
   * closing, the request is **already aborted**, `id` is a duplicate (never
   * overwriting the earlier resolver), or `id` was already answered. The caller MUST
   * publish an actionable card only when `accepted` — a rejected reservation is
   * handled on the safe path with no card, so a duplicate id can never surface a
   * second card that resolves the first request.
   *
   * `signal` (Claude's `canUseTool`) settles the pending request on abort. An
   * **ALREADY-aborted** signal is checked HERE, before the slot is claimed (052, fixing
   * 044 GO-blocking P2 #2): the previous code installed a resolver, immediately
   * force-rejected it, and still answered `accepted:true`, so the caller published a
   * card for a request the provider had already been safely refused — a dead card the
   * UI could never answer. Nothing pending, nothing published, no resolver to leak.
   */
  reserve(id: string, signal?: AbortSignal): Reservation<T> {
    if (this.isClosing() || signal?.aborted || this.pending.has(id) || this.answered.has(id)) {
      return { accepted: false, response: Promise.resolve(this.safeReject()) }
    }
    const response = new Promise<T>((resolve) => {
      this.pending.set(id, resolve)
      // Not yet aborted (guarded above) — settle if it aborts while we wait. Bound to this
      // reservation: a late abort of an earlier request's signal must not settle a later one that
      // reuses its id.
      signal?.addEventListener('abort', () => this.forceReject(id, resolve), { once: true })
    })
    return { accepted: true, response }
  }

  /**
   * Register a request awaiting its response (the {@link reserve} response,
   * discarding acceptance). Kept for callers that generate unique ids and don't
   * gate publishing on acceptance (the Fake). Adapters use {@link reserve} so they
   * can withhold the card for a duplicate/closing reservation (023 P1-B).
   */
  register(id: string, signal?: AbortSignal): Promise<T> {
    return this.reserve(id, signal).response
  }

  /**
   * Deliver a response for `id`. Returns whether it won. A losing/duplicate/late
   * responder gets `false` and MUST be told it did not win (never a false
   * success). The take+delete is synchronous, so a concurrent second `respond`
   * finds nothing.
   */
  respond(id: string, value: T): boolean {
    const resolve = this.pending.get(id)
    if (!resolve) return false
    this.pending.delete(id)
    this.answered.add(id)
    resolve(value)
    return true
  }

  private forceReject(id: string, owner: (value: T) => void): void {
    const resolve = this.pending.get(id)
    if (resolve !== owner) return
    this.pending.delete(id)
    this.answered.add(id)
    resolve(this.safeReject())
    this.onWithdrawn?.(id)
  }

  /**
   * Safe-reject every still-pending request (interrupt / fatal error / close).
   *
   * ⚑ **695 · `answer` names WHY, when the default's reason would be false.** The default is the
   * broker's own safe-reject — *"session closed"* on Claude — which is true at a close. A Stop is not
   * a close: since `695` declared `perTaskStopAffordance` the CLI SPARES a background agent across
   * it, so a pending ask of that agent is denied into a model that is still running. Still a
   * refusal, never an allow — only the reason changes.
   */
  settleAll(answer: () => T = this.safeReject): void {
    for (const [id, resolve] of this.pending) {
      this.answered.add(id)
      resolve(answer())
    }
    this.pending.clear()
  }

  /**
   * Retire the tombstones of fully-settled requests — the **lifecycle-bounded retention
   * policy** (057, fixing 044 P2 #7). Callers invoke this at a **turn terminal**, the point
   * at which the owning turn can no longer reference its requests.
   *
   * **Why this cannot reopen a stale authorization.** `answered` is not what makes a late
   * answer safe — {@link respond} consults only `pending`, and every id in `answered` had
   * its resolver **taken and deleted** before it was tombstoned. So a late/duplicate/replayed
   * answer for a retired id finds no resolver and is refused with `false` exactly as before:
   * the id is unreachable because its turn is gone. `answered` only suppresses a *fresh
   * reservation* of an id that was already answered, and pruning is deliberately scoped so
   * that suppression still holds for the whole life of the turn that owns the id — a
   * same-turn duplicate is still refused.
   *
   * Still-`pending` requests are untouched (their ids are not in `answered`), so retiring
   * mid-flight cannot orphan a live request. Returns the retired ids so a caller with a
   * stronger, id-shape-specific barrier (the Codex adapter's monotonic numeric floor) can
   * fold them into it and keep refusing them even across turns.
   */
  retireSettled(): string[] {
    const retired = [...this.answered]
    this.answered.clear()
    return retired
  }

  /** ⚑ **F084** — whether `id` still awaits its response: a tool call still on its card has not run. */
  has(id: string): boolean {
    return this.pending.has(id)
  }

  /** Number of requests still awaiting a response (for tests/diagnostics). */
  get pendingCount(): number {
    return this.pending.size
  }

  /** Tombstones currently retained — the bounded-memory assertion's probe (057). */
  get answeredCount(): number {
    return this.answered.size
  }
}

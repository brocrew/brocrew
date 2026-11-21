import type { RuntimeEvent, TurnLimit } from '../events'
import { isRecord, readField, readNumber, readString } from './normalize-fields'

/**
 * ⛔ **How full a window has to be before the app says so** (177 §1).
 *
 * ⚠️ **Codex sends no equivalent of Claude's `allowed_warning`, so this number is ours and it has
 * to be argued.** `RateLimitSnapshot` reports `usedPercent` and nothing that says "you are about to
 * be throttled"; the wall itself arrives as `rateLimitReachedType`, which needs no threshold at all.
 * So this governs only the APPROACH.
 *
 * ⚑ **90, for three reasons, and the third is the one that matters.**
 *  1. What is being bought is the last tenth of a window: ≤30 minutes on the 5-hour window, ~16
 *     hours on the 7-day one. Either is still enough time to do something about it.
 *  2. A warning that fires for most of a window is ambient state, not a warning. That belongs on a
 *     meter (086's surface), not in the transcript.
 *  3. ⛔ **Measured on this machine, the routine frame carries `usedPercent: 74`** — so a floor of
 *     90 leaves the LIVE negative control real: the frame that actually arrives has to stay quiet,
 *     and `throttle-probe.smoke.ts` asserts that against the provider rather than against a fixture.
 *     A floor at 70 would have made the paired negative untestable on the wire.
 */
const RATE_LIMIT_WARN_PERCENT = 90

/**
 * The user-facing line for a rate-limit snapshot that is ACTUALLY constraining the session, or
 * `null` for the routine heartbeat (177 §1, mirroring `claude/normalize.ts`'s `rateLimitThrottle`).
 *
 * ⚠️ **`AccountRateLimitsUpdatedNotification` documents itself as a SPARSE rolling update** —
 * *"Nullable account metadata may be unavailable in a rolling update and does not clear a previously
 * observed value."* This function is pure and has no memory of earlier frames, so it judges each one
 * on what it carries: a `null` is read as "not reported here", never as "reset to fine". That is the
 * only safe direction available TO A PURE FUNCTION — and 182 M4 is that it is not the whole
 * contract. ⛔ **The memory lives in {@link RateLimitWatch} now**, which merges each frame into the
 * last one before calling this; a caller that supplies no watch still gets exactly this per-frame
 * reading, which is what every fixture in `codex-normalize.test.ts` asserts.
 *
 * ⛔ **`credits` is deliberately NOT a gate**, and it is the one field that looks like it should be.
 * Measured live on a `pro` plan mid-session: `{hasCredits:false, unlimited:false, balance:"0"}`,
 * while the turn ran perfectly. Never having bought credits is the normal state, so gating on it
 * would fire a warning on every routine frame — the exact noise 074 removed from Claude's side.
 *
 * ⛔ **One window carries the whole sentence — its percentage AND its reset** (188 §2, from 182 M4).
 * The reset used to be `Math.max` across both windows while the percentage came from the fuller one,
 * so a 95% five-hour window resetting in twenty minutes beside a 10% weekly window was reported as
 * *"95% of a 5-hour window used; resets <next week>"*. Two windows, one sentence, and the number a
 * person would act on belonged to neither. The wall and spend-control lines name no percentage, so
 * they take the same window's reset for the same reason: whichever window is fullest is the one that
 * stopped the turn, and a reset from any other window is a time at which nothing changes.
 *
 * ⚠️ **`qualify` is what stops the sentence describing no real bucket** (201, from 192 H1). A
 * `RateLimitSnapshot` is ONE metered bucket — `GetAccountRateLimitsResponse.rateLimitsByLimitId` is
 * keyed by `limitId` and this machine's own account really carries two, `codex` and
 * `codex_bengalfox` (*"GPT-5.3-Codex-Spark"*). ⛔ **The line names its bucket only when naming it
 * distinguishes something**: the bucket the provider itself calls the main one, and any account with
 * exactly one, speak in the unqualified sentence 177 shipped. See {@link RateLimitWatch.qualifies}.
 */
export function rateLimitPressure(snapshot: unknown, qualify = false): string | null {
  if (!isRecord(snapshot)) return null
  const reached = readString(snapshot, 'rateLimitReachedType')
  // The window the sentence is ABOUT: whichever is fuller, and a snapshot that names neither has
  // no window to quote a reset from.
  const worst = fullestWindow(snapshot)
  const resets = windowResetsAt(worst?.window)
  const when = resets > 0 ? `; resets ${new Date(resets * 1000).toISOString()}` : ''
  // Which bucket this is about, when that is a question the reader could be wrong about. The
  // provider's own display name first, its id second, and NOTHING when it gave us neither — a
  // sentence that says "on the  limit" would be worse than the one that says nothing.
  const named = readString(snapshot, 'limitName') || readString(snapshot, 'limitId')
  const where = qualify && named ? ` on the ${named} limit` : ''
  // The wall, as the provider itself reports it — no threshold of ours involved.
  if (reached) {
    return `codex is rate-limited (${reached})${where} — the turn may stall until it resets${when}`
  }
  if (readField(snapshot, 'spendControlReached') === true) {
    return `codex has reached its spend control${where} — the turn may stall until it resets${when}`
  }
  // The approach. Both windows are reported by the same shape, so the fuller one carries it.
  if (!worst || worst.used < RATE_LIMIT_WARN_PERCENT) return null
  return (
    `codex is approaching its rate limit${where} — ${Math.round(worst.used)}% of ` +
    `${windowName(worst.window)} used${when}`
  )
}

/**
 * 🔒 **How many metered buckets one session will hold state for** (201, 052's rule on 200's
 * surface). The key is a `limitId` off the wire, so an unbounded map is a provider-driven leak.
 * Measured: this machine's account carries **two**. Past the cap a frame is judged ALONE — the
 * pre-188 per-frame reading — rather than merged into a bucket it is not about.
 */
const MAX_TRACKED_BUCKETS = 16

/** Where a frame that names no `limitId` goes when nothing better can be said about it. */
const UNNAMED_BUCKET = '(unnamed)'

/** One metered limit, and the last sentence this session showed about it. */
interface RateLimitBucket {
  /** Everything ever observed about this bucket. Nulls never clear; sub-objects merge into. */
  snapshot: Record<string, unknown>
  /** The last line THIS bucket actually showed — `null` again the moment it returns to quiet. */
  said: string | null
}

/**
 * The provider's sparse-update contract, held per BUCKET for one session (201, from 192 H1; 188 §2,
 * from 182 M4).
 *
 * ## ⛔ What the contract says, and what BroBot was doing instead
 *
 * `AccountRateLimitsUpdatedNotification`'s own doc: *"Clients should merge available values into the
 * most recent `account/rateLimits/read` response or refetch that snapshot. Nullable account metadata
 * may be unavailable in a rolling update and does not clear a previously observed value."*
 * `RateLimitSnapshot.spendControlReached` says it a second time and more sharply: *"`None` is
 * unavailable, not a sparse-update recovery."*
 *
 * 188 gave this class a memory and got three things wrong about what the memory IS, all three
 * measured by 192 H1 and re-read line by line by the PM:
 *
 * | | |
 * |---|---|
 * | ⛔ **one flat record for a keyed protocol** | `GetAccountRateLimitsResponse.rateLimitsByLimitId` is *"the multi-bucket view keyed by metered `limit_id`"*, and this machine's own account really carries two — `codex` and `codex_bengalfox` (*"GPT-5.3-Codex-Spark"*). A frame for one overwrote the keys it carried and inherited the rest, so the sentence described **no real bucket** |
 * | ⛔ **a TOP-LEVEL merge for a nested shape** | a rolling frame's fresh `primary` replaced the held one whole, taking the `windowDurationMins` and `resetsAt` that were null only because UNAVAILABLE. 165's rule, third time: an absent field is a VALUE |
 * | ⛔ **no baseline to merge INTO** | *"the most recent `account/rateLimits/read` response"* is the other half of the sentence, and nothing called it. See {@link seed} — 201 chose to make the call |
 *
 * ## The merge, and the one place it is allowed to forget
 *
 * A non-null field replaces; a null or absent field keeps what was last observed; two records at the
 * same key merge into one another rather than replacing ({@link mergeSparse}). ⚠️ **With one expiry,
 * and it is the provider's number rather than ours**: a bucket is dropped once every window it holds
 * has a `resetsAt` in the past. ⛔ **An UNKNOWN reset is unknown, not past** (201 §5) — the old
 * `.filter((at) => at > 0)` ran BEFORE `.every(...)`, so a bucket holding one expired window beside
 * one window that had never reported a reset expired on the strength of the window it had chosen to
 * ignore. ⚑ When no reset is known at all the value STANDS: an unresettable wall is the state 177
 * exists to show, and dropping it on a timer of our own would be inventing exactly the "reset to
 * fine" this class refuses to infer from an absence.
 *
 * ## ⛔ …and it says each thing ONCE, per bucket, until quiet returns
 *
 * 177 measured `account/rateLimits/updated` at once or twice per turn. Above 90% every one of them
 * produced a fresh transcript warning, so a hundred-turn conversation accumulated a hundred-odd
 * identical lines — 182 M4's third half. {@link observe} returns a line only when it differs from
 * the last line that BUCKET actually showed. ⛔ **And a return to quiet clears it** (201 §4): before,
 * `said` survived until expiry, so a warning that went away and came back word-for-word was deduped
 * against a state that had ended. 074's rule is that routine is noise; it is NOT that a returning
 * wall is routine. ⚠️ A REPEAT is still not silence: the frame becomes lifecycle chatter and is in
 * the raw history, exactly like the quiet ones.
 */
export class RateLimitWatch {
  private readonly buckets = new Map<string, RateLimitBucket>()

  /**
   * The bucket the PROVIDER calls the main one — `GetAccountRateLimitsResponse.rateLimits` is
   * documented as *"the backward-compatible single-bucket view"*, so its `limitId` is the account's
   * default. Known only once {@link seed} has answered; two things read it, and both need it to
   * come from the provider rather than from a guess of ours (see {@link qualifies}, {@link keyFor}).
   */
  private primaryLimitId: string | null = null

  /** The one line the over-the-cap path is deduped against. 🔒 One string, not a map. */
  private overflowSaid: string | null = null

  /**
   * ⚑ The bucket the last frame merged into, by its key — `null` key: a frame judged alone, over
   * the cap ({@link lastReading}).
   */
  private lastObserved: { readonly key: string | null; readonly frame: unknown } | null = null

  /**
   * ⚑ **What the last frame {@link observe} took says about its bucket, merged** — for a reading of
   * how full its windows are ({@link rateLimitUsage}): the bucket's whole held snapshot, so a sparse
   * frame does not read as a window that lost its reset, and the bucket the provider calls its
   * main one. `null` before any frame.
   */
  lastReading(): UsageBucket | null {
    const last = this.lastObserved
    if (last === null) return null
    const bucket = last.key === null ? undefined : this.buckets.get(last.key)
    return { snapshot: bucket?.snapshot ?? last.frame, mainLimitId: this.primaryLimitId }
  }

  /** ⚑ Every bucket held, as {@link lastReading} gives one — what a {@link seed} read in full. */
  heldReadings(): UsageBucket[] {
    return [...this.buckets.values()].map((bucket) => ({
      snapshot: bucket.snapshot,
      mainLimitId: this.primaryLimitId,
    }))
  }

  /**
   * 🔴 **The provider's own word on whether ordinary usage is allowed** — 0.160.0's
   * `GetAccountRateLimitsResponse.ordinaryUsageAllowed`, read off `account/rateLimits/read`; `null`
   * until a read has carried a boolean.
   *
   * ⚑ The field's contract, whole: *"Backend permission for ordinary included usage, validated
   * against the active account. Null means unavailable; clients must not infer recovery from
   * percentages or reset times."* W4's ruling (provider follow-ups 1): while it is a boolean it decides
   * the MAIN limit, and the old inference is kept only where the provider gave no boolean — because
   * a wall nothing else can end would otherwise stand for the rest of the session.
   *  - `false` — the main limit stands, said with no reset time (so nothing downstream ends it by
   *    one either), is never dropped by a reset passing, and {@link awaitingTheProvidersWord} has the
   *    runtime read again before each turn. ⛔ It holds until a read says `true`: a read that says
   *    `null`, or a rolling wall (which agrees with it), does not undo it.
   *  - `true` — no rate-limit wall is said for the main limit, except one a rolling frame reported
   *    AFTER the read was asked: that frame is the newer word.
   */
  private ordinaryUsageAllowed: boolean | null = null

  /** When this session last saw the main limit's wall on a ROLLING frame, in ms — see `seed`. */
  private mainWallSeenAt = 0

  /** Whether a read has been taken into this watch yet — the first goes UNDER what it holds. */
  private seeded = false

  /**
   * 🔴 **F074 — the limit a turn Codex refused with `usageLimitExceeded` ended on**: the main
   * bucket's reached marker (its name, failing that) and when it resets — the latest reset among
   * its windows that are full, else its fullest window's — as this session's reads and frames left
   * them. ⛔ **No reset while the provider says ordinary usage is not allowed** — its contract
   * forbids inferring recovery from a reset time — ⛔ **nor for depleted credits**, which no window
   * resets.
   */
  reachedLimit(): TurnLimit {
    const key = this.mainKey()
    const snapshot = key === null ? undefined : this.buckets.get(key)?.snapshot
    if (snapshot === undefined) return { provider: 'codex' }
    const window =
      readString(snapshot, 'rateLimitReachedType') ||
      readString(snapshot, 'limitName') ||
      readString(snapshot, 'limitId')
    const full = [readField(snapshot, 'primary'), readField(snapshot, 'secondary')].filter(
      (one) => (readNumber(one, 'usedPercent') ?? 0) >= 100,
    )
    const resets =
      this.ordinaryUsageAllowed === false || window.endsWith('_credits_depleted')
        ? 0
        : full.length > 0
          ? Math.max(...full.map(windowResetsAt))
          : windowResetsAt(fullestWindow(snapshot)?.window)
    return {
      provider: 'codex',
      ...(window === '' ? {} : { window }),
      ...(resets > 0 ? { resetsAt: resets * 1000 } : {}),
    }
  }

  /** True while the provider's last word was "not allowed" — the runtime re-reads before a turn. */
  awaitingTheProvidersWord(): boolean {
    return this.ordinaryUsageAllowed === false
  }

  /**
   * ⛔ **Seed from an `account/rateLimits/read` response** — the half of the contract's own sentence
   * that had no implementation (201 §2). Answers with the lines worth showing, usually none.
   *
   * ⚠️ **The baseline goes UNDERNEATH what has already been observed**, never over it. This is
   * called without blocking the session start, so a rolling frame can and does arrive first; that
   * frame is NEWER, and a baseline that overwrote it would resurrect the state the app just left.
   *
   * ⛔ **Only the primary bucket speaks from a baseline.** The others are held — so a later rolling
   * frame naming one merges into a real snapshot instead of starting from nothing — but a warning
   * about a metered limit this session has not touched is 074's noise. A rolling frame for a
   * non-primary bucket DOES speak: the provider pushed it because this session is metering on it.
   */
  seed(response: unknown, now: number = Date.now(), askedAt: number = now): string[] {
    const top = readField(response, 'rateLimits')
    const primary = readString(top, 'limitId')
    if (primary !== '') this.primaryLimitId = primary
    const allowed = readField(response, 'ordinaryUsageAllowed')
    if (allowed === true) {
      // ⚑ A rolling wall on the main limit seen after this read was ASKED is the newer word.
      this.ordinaryUsageAllowed = this.mainWallSeenAt > askedAt ? null : true
    } else if (allowed === false) {
      this.ordinaryUsageAllowed = false
    }
    // ⛔ A read with no boolean leaves a held word as it was — `false` holds until a read says `true`.
    const seeds = new Map<string, Record<string, unknown>>()
    const byId = readField(response, 'rateLimitsByLimitId')
    if (isRecord(byId)) {
      for (const [key, value] of Object.entries(byId)) if (isRecord(value)) seeds.set(key, value)
    }
    // A server that filled only the backward-compatible view still gives us one bucket.
    if (isRecord(top) && !seeds.has(primary || UNNAMED_BUCKET)) {
      seeds.set(primary || UNNAMED_BUCKET, top)
    }
    for (const [key, snapshot] of seeds) {
      if (!this.buckets.has(key) && this.buckets.size >= MAX_TRACKED_BUCKETS) continue
      const bucket = this.buckets.get(key) ?? { snapshot: {}, said: null }
      // ⚠️ The FIRST read goes under what is held — rolling frames that overtook it are newer. A
      // LATER read (the turn-start re-read) was asked after them, so it goes on top: a fresher
      // percentage or reset must not lose to the one it replaces.
      bucket.snapshot = this.seeded
        ? mergeSparse(bucket.snapshot, snapshot)
        : mergeSparse(snapshot, bucket.snapshot)
      this.buckets.set(key, bucket)
    }
    this.seeded = true
    this.dropExpired(now)
    const key = this.mainKey()
    const bucket = key === null ? undefined : this.buckets.get(key)
    if (key === null || bucket === undefined) return []
    const line = this.speak(key, bucket)
    return line === null ? [] : [line]
  }

  /**
   * Take one `rateLimits` payload; answer with the line to show, or `null` for "nothing new".
   *
   * `now` is milliseconds and injectable so the expiry above is testable without waiting for a
   * window to roll — production passes nothing.
   */
  observe(incoming: unknown, now: number = Date.now()): string | null {
    if (!isRecord(incoming)) {
      this.lastObserved = null
      return null
    }
    this.dropExpired(now)
    const key = this.keyFor(incoming)
    this.lastObserved = { key, frame: incoming }
    // Over the cap: no memory is better than the wrong memory. Judged alone, exactly as this did
    // before 188 — which never downgraded a wall it could see, only one it had been told about.
    if (key === null) {
      const line = rateLimitPressure(incoming)
      if (line === null) {
        this.overflowSaid = null
        return null
      }
      if (line === this.overflowSaid) return null
      this.overflowSaid = line
      return line
    }
    const bucket = this.buckets.get(key) ?? { snapshot: {}, said: null }
    bucket.snapshot = mergeSparse(bucket.snapshot, incoming)
    this.buckets.set(key, bucket)
    // A wall on the main limit, reported after the read, is the newer word — over a `true` only; a
    // `false` it agrees with stands.
    if (this.isMain(key) && readString(incoming, 'rateLimitReachedType') !== '') {
      this.mainWallSeenAt = now
      if (this.ordinaryUsageAllowed === true) this.ordinaryUsageAllowed = null
    }
    return this.speak(key, bucket)
  }

  /** The line this bucket has to show right now, deduped against the last one it showed. */
  private speak(key: string, bucket: RateLimitBucket): string | null {
    const line = this.isMain(key)
      ? mainLimitPressure(bucket.snapshot, this.qualifies(key), this.ordinaryUsageAllowed)
      : rateLimitPressure(bucket.snapshot, this.qualifies(key))
    // ⛔ 201 §4 — quiet clears the memory of what was said. Anything else deduplicates a returning
    // wall against a wall that had ended.
    if (line === null) {
      bucket.said = null
      return null
    }
    if (line === bucket.said) return null
    bucket.said = line
    return line
  }

  /**
   * Whether this bucket's sentence must name itself.
   *
   * ⚑ **Only when naming it distinguishes something.** One bucket, or the one the provider calls the
   * main one, speaks in the sentence 177 shipped and §3 pins. A second metered limit — real on this
   * machine — names itself, because two unqualified sentences about different buckets are the defect
   * this dispatch is named for arriving from the other end.
   */
  private qualifies(key: string): boolean {
    return this.buckets.size > 1 && key !== this.primaryLimitId
  }

  /** The bucket `ordinaryUsageAllowed` is about: the one the provider calls the main one. */
  private isMain(key: string): boolean {
    return key === this.mainKey()
  }

  /** The main bucket's key — the provider's default, or failing that the only bucket there is. */
  private mainKey(): string | null {
    if (this.primaryLimitId !== null) return this.primaryLimitId
    return this.buckets.size === 1 ? ([...this.buckets.keys()][0] ?? null) : null
  }

  /**
   * Which bucket a frame is about, or `null` when we are over the cap and must not guess.
   *
   * ⚠️ **A frame that names no bucket is the case with a real trade-off.** Measured, every rolling
   * frame in a live capture carried its `limitId` — which is not "always", and the contract says
   * nullable metadata may be unavailable in a rolling update. Filing an unnamed frame under its own
   * key would be strict and would reintroduce 192 H1's own harm: a sparse `{primary:{usedPercent:92}}`
   * in an empty bucket says *"approaching"* while a wall stands in the real one. So it is attributed
   * to the default the provider itself named, and failing that to the only bucket there is — both
   * unambiguous — and only an ambiguous frame gets a bucket of its own.
   */
  private keyFor(incoming: Record<string, unknown>): string | null {
    const named = readString(incoming, 'limitId')
    if (named !== '') return this.buckets.has(named) ? named : this.room(named)
    if (this.primaryLimitId !== null && this.buckets.has(this.primaryLimitId)) {
      return this.primaryLimitId
    }
    if (this.buckets.size === 1) return [...this.buckets.keys()][0] ?? null
    return this.buckets.has(UNNAMED_BUCKET) ? UNNAMED_BUCKET : this.room(UNNAMED_BUCKET)
  }

  /** A new bucket key, or `null` when this session is already holding as many as it will. */
  private room(key: string): string | null {
    return this.buckets.size < MAX_TRACKED_BUCKETS ? key : null
  }

  /**
   * Forget every bucket whose windows have all reset.
   *
   * ⚠️ **It forgets what was SAID as well as what was held.** A wall that lifts and returns is news
   * the second time; keeping the sentence would dedup it against a limit that had ended.
   */
  private dropExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      // ⛔ Not the main limit while the provider says usage is not allowed: a reset time passing is
      // exactly the inference its contract forbids.
      if (this.ordinaryUsageAllowed === false && this.isMain(key)) continue
      if (snapshotExpired(bucket.snapshot, now)) this.buckets.delete(key)
    }
  }
}

/**
 * {@link rateLimitPressure} for the MAIN limit, with the provider's `ordinaryUsageAllowed` deciding
 * the wall whenever it said anything — see {@link RateLimitWatch}'s field of the same name.
 */
function mainLimitPressure(
  snapshot: Record<string, unknown>,
  qualify: boolean,
  ordinaryUsageAllowed: boolean | null,
): string | null {
  if (ordinaryUsageAllowed === null) return rateLimitPressure(snapshot, qualify)
  if (ordinaryUsageAllowed === false) {
    // ⛔ One sentence, with NO reset time: a reset time here would let the person's queue end the
    // wall by it (`foldProviderLimits`), which is the inference the field forbids. ⚑ Spelled with
    // the queue's own `is rate-limited`, so it reads as `stopped` — the provider's marker when it
    // gave one, the field's meaning when it did not.
    const reached = readString(snapshot, 'rateLimitReachedType') || 'included usage not allowed'
    const named = readString(snapshot, 'limitName') || readString(snapshot, 'limitId')
    const where = qualify && named ? ` on the ${named} limit` : ''
    return `codex is rate-limited (${reached})${where} — turns may stall until codex says usage is allowed again`
  }
  // Allowed: no rate-limit wall, whatever the snapshot's marker says; an approach still speaks, and
  // so does a spend control, which is not what this field answers.
  const withoutWall = { ...snapshot, rateLimitReachedType: null }
  return rateLimitPressure(withoutWall, qualify)
}

/**
 * True once every window this snapshot holds says its own reset has already happened.
 *
 * ⛔ **A window with no usable `resetsAt` blocks expiry rather than being skipped** (201 §5). The
 * old form filtered the unknowns out and then asked whether the rest had passed, so a snapshot
 * holding one past window beside one that had never reported a reset was dropped — the whole wall
 * with it — on the strength of a window it had decided not to count. An unknown reset is unknown; it
 * is not past. A snapshot holding no window at all cannot expire, which is 188's rule unchanged.
 */
function snapshotExpired(snapshot: Record<string, unknown>, now: number): boolean {
  const windows = [readField(snapshot, 'primary'), readField(snapshot, 'secondary')].filter(
    (window) => isRecord(window),
  )
  if (windows.length === 0) return false
  const resets = windows.map(windowResetsAt)
  if (resets.some((at) => at === 0)) return false
  return resets.every((at) => at * 1000 <= now)
}

/**
 * Merge a sparse update into what is held, at EVERY level (201 §3, from 192 H1).
 *
 * ⛔ **The old merge was one level deep**, so a rolling frame's fresh `primary` replaced the held one
 * whole. `RateLimitWindow` is `{usedPercent, windowDurationMins: number|null, resetsAt: number|null}`
 * — two of its three fields are exactly the *"nullable account metadata"* the contract says a rolling
 * update may omit — so a frame reporting only that the percentage moved took the window's length and
 * its reset with it, and the sentence lost the *"; resets …"* a person would act on.
 *
 * ⚠️ **Arrays replace.** No field of `RateLimitSnapshot` is one today; if one appears, merging index
 * by index would be inventing a shape the provider never described.
 */
function mergeSparse(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  // ⛔ **The BASE is copied too, and `{ ...base }` was not enough.** {@link seed} calls this with the
  // provider's own response as the base, so a shallow spread left the retained snapshot holding
  // `primary`, `secondary` and `credits` BY REFERENCE into a payload the raw history also carries.
  // Nothing mutates it today, which is exactly what makes the aliasing the kind that survives.
  const merged = copyRecord(base)
  for (const [key, value] of Object.entries(incoming)) {
    // ⛔ 165's rule: an absent field is a VALUE, and here the value is "not reported in this frame".
    if (value === null || value === undefined) continue
    const held = merged[key]
    merged[key] =
      isMergeable(held) && isMergeable(value) ? mergeSparse(held, value) : structuredCopy(value)
  }
  return merged
}

/** A plain object — the only thing {@link mergeSparse} recurses into. */
function isMergeable(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value)
}

/**
 * A defensive copy of anything the provider handed us before it is retained.
 *
 * ⚠️ The watch holds these for the life of a session, and the payload it is given is the same object
 * the raw history carries. Retaining it by reference would tie the two together; a copy is cheap at
 * this size and is what makes "held" mean held.
 */
function structuredCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuredCopy)
  return isMergeable(value) ? copyRecord(value) : value
}

/** {@link structuredCopy} for a value already known to be a record — and the base of a merge. */
function copyRecord(value: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) copy[key] = structuredCopy(inner)
  return copy
}

/** ⚑ The fuller of a snapshot's two windows — the one that stopped the turn (188 §2). */
function fullestWindow(snapshot: unknown): { window: unknown; used: number } | undefined {
  return [readField(snapshot, 'primary'), readField(snapshot, 'secondary')]
    .map((window) => ({ window, used: readNumber(window, 'usedPercent') ?? -1 }))
    .sort((a, b) => b.used - a.used)[0]
}

/** A window's `resetsAt` in epoch SECONDS, or `0` when it is absent or unusable. */
function windowResetsAt(window: unknown): number {
  const at = readNumber(window, 'resetsAt')
  return at !== undefined && at > 0 ? at : 0
}

/** One metered bucket's held snapshot, and the bucket the provider calls its main one, if known. */
export interface UsageBucket {
  readonly snapshot: unknown
  readonly mainLimitId: string | null
}

/**
 * ⚑ **How full each window of one metered bucket is** — a `provider_usage`, or `null` when the
 * snapshot holds no window. ⚑ Named as the warning lines name them ({@link windowName}): *a 7-day
 * window*, or the slot (`primary`, `secondary`) when the provider did not say its length — and
 * with the bucket's own name when it is not the main one. `usedPercent` is already a percentage;
 * `resetsAt` is in seconds, so ms is ×1000.
 */
export function rateLimitUsage(bucket: UsageBucket | null): RuntimeEvent | null {
  if (bucket === null || !isRecord(bucket.snapshot)) return null
  const { snapshot, mainLimitId } = bucket
  // ⚑ The name a window is kept under must not move between frames, so it is said from what the
  // frame and the provider say, never from how many buckets are held: the provider's own name for
  // a metered model (`limitName`, which its main bucket does not carry), else the bucket's id when
  // the provider named another bucket its main one.
  const id = readString(snapshot, 'limitId')
  const named =
    readString(snapshot, 'limitName') ||
    (mainLimitId !== null && id !== '' && id !== mainLimitId ? id : '')
  const readings = (['primary', 'secondary'] as const).flatMap((slot) => {
    const window = readField(snapshot, slot)
    if (!isRecord(window)) return []
    const said = windowName(window)
    const name = said === 'this window' ? `its ${slot} window` : said
    const used = readNumber(window, 'usedPercent')
    const resets = windowResetsAt(window)
    // ⚑ A window the bucket gives no number for is no reading.
    if ((used === undefined || used < 0) && resets === 0) return []
    return [
      {
        window: (named ? `${name} (${named})` : name).slice(0, 120),
        usedPercent: used !== undefined && used >= 0 ? used : null,
        resetsAt: resets > 0 ? resets * 1000 : null,
      },
    ]
  })
  return readings.length === 0 ? null : { type: 'provider_usage', readings }
}

/**
 * How to say a `windowDurationMins` out loud — *"a 7-day window"*, *"a 5-hour window"*.
 *
 * The field is nullable, and a window whose length the provider did not report is described as
 * exactly that rather than given a made-up duration.
 */
function windowName(window: unknown): string {
  const mins = readNumber(window, 'windowDurationMins')
  if (mins === undefined || mins <= 0) return 'this window'
  if (mins % 1440 === 0) return `a ${mins / 1440}-day window`
  if (mins % 60 === 0) return `a ${mins / 60}-hour window`
  return `a ${Math.round(mins)}-minute window`
}

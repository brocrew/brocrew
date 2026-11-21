import type { RuntimeEvent, TurnLimit } from '../events'
import { isRecord, readField, readNumber, readString } from './normalize-fields'

/**
 * How full a window must be before the app warns. Codex has no equivalent of Claude's
 * `allowed_warning`, and the wall itself arrives as `rateLimitReachedType`, so this governs only the
 * approach. 90 leaves the last tenth of a window to act on, keeps the routine frame (about 74%)
 * quiet, and avoids a warning that fires for most of a window.
 */
const RATE_LIMIT_WARN_PERCENT = 90

/**
 * The user-facing line for a rate-limit snapshot that is constraining the session, or `null` for the
 * routine heartbeat.
 *
 * Pure and per-frame: a `null` field means "not reported here", never "reset"; {@link RateLimitWatch}
 * does the merging across frames. `credits` is not a gate, because a zero balance is normal. One
 * window (the fullest) supplies both the percentage and the reset, so the sentence never mixes
 * windows. `qualify` names the bucket (`limitName`/`limitId`) only when naming distinguishes
 * something; see {@link RateLimitWatch.qualifies}.
 */
export function rateLimitPressure(snapshot: unknown, qualify = false): string | null {
  if (!isRecord(snapshot)) return null
  const reached = readString(snapshot, 'rateLimitReachedType')
  // The window the sentence is about: the fuller one, if any.
  const worst = fullestWindow(snapshot)
  const resets = windowResetsAt(worst?.window)
  const when = resets > 0 ? `; resets ${new Date(resets * 1000).toISOString()}` : ''
  // The bucket's own display name, else its id, else nothing.
  const named = readString(snapshot, 'limitName') || readString(snapshot, 'limitId')
  const where = qualify && named ? ` on the ${named} limit` : ''
  // The wall, as the provider reports it.
  if (reached) {
    return `codex is rate-limited (${reached})${where} — the turn may stall until it resets${when}`
  }
  if (readField(snapshot, 'spendControlReached') === true) {
    return `codex has reached its spend control${where} — the turn may stall until it resets${when}`
  }
  // The approach: the fuller window carries it.
  if (!worst || worst.used < RATE_LIMIT_WARN_PERCENT) return null
  return (
    `codex is approaching its rate limit${where} — ${Math.round(worst.used)}% of ` +
    `${windowName(worst.window)} used${when}`
  )
}

/**
 * How many metered buckets one session holds state for; the key is a wire `limitId`, so the map is
 * bounded. Past the cap a frame is judged alone.
 */
const MAX_TRACKED_BUCKETS = 16

/** The bucket for a frame that names no `limitId` and cannot be attributed. */
const UNNAMED_BUCKET = '(unnamed)'

/** One metered limit and the last sentence shown about it. */
interface RateLimitBucket {
  /** Everything observed about this bucket. Nulls never clear; sub-objects merge. */
  snapshot: Record<string, unknown>
  /** The last line this bucket showed; `null` again once it returns to quiet. */
  said: string | null
}

/**
 * The provider's sparse-update contract, held per bucket for one session.
 * `AccountRateLimitsUpdatedNotification` says clients should merge available values into the latest
 * `account/rateLimits/read` response, and nullable metadata does not clear a previously observed
 * value. So a non-null field replaces, a null or absent field keeps what was observed, and nested
 * records merge ({@link mergeSparse}); {@link seed} supplies the read as the baseline.
 *
 * A bucket is dropped once every window it holds has a `resetsAt` in the past. An unknown reset is
 * not past, and when no reset is known the value stands rather than being dropped on a timer.
 *
 * Each line is said once per bucket: {@link observe} returns a line only when it differs from the last
 * one that bucket showed, and a return to quiet clears that memory so a returning wall is news again.
 */
export class RateLimitWatch {
  private readonly buckets = new Map<string, RateLimitBucket>()

  /**
   * The bucket the provider calls the main one: the `limitId` of `GetAccountRateLimitsResponse.rateLimits`
   * (the backward-compatible single-bucket view). Known only after {@link seed}; used by
   * {@link qualifies} and {@link keyFor}.
   */
  private primaryLimitId: string | null = null

  /** The line the over-the-cap path is deduped against. One string, not a map. */
  private overflowSaid: string | null = null

  /** The bucket the last frame merged into; a `null` key means judged alone over the cap ({@link lastReading}). */
  private lastObserved: { readonly key: string | null; readonly frame: unknown } | null = null

  /**
   * The last observed frame's bucket, merged, for {@link rateLimitUsage}: the bucket's whole held
   * snapshot (so a sparse frame does not look like a window that lost its reset) and the main
   * bucket's id. `null` before any frame.
   */
  lastReading(): UsageBucket | null {
    const last = this.lastObserved
    if (last === null) return null
    const bucket = last.key === null ? undefined : this.buckets.get(last.key)
    return { snapshot: bucket?.snapshot ?? last.frame, mainLimitId: this.primaryLimitId }
  }

  /** Every held bucket, as {@link lastReading} gives one; what a {@link seed} read in full. */
  heldReadings(): UsageBucket[] {
    return [...this.buckets.values()].map((bucket) => ({
      snapshot: bucket.snapshot,
      mainLimitId: this.primaryLimitId,
    }))
  }

  /**
   * `GetAccountRateLimitsResponse.ordinaryUsageAllowed` from `account/rateLimits/read`; `null` until
   * a read carries a boolean. Its contract: null means unavailable, and clients must not infer
   * recovery from percentages or reset times. While it is a boolean it decides the main limit:
   *  - `false`: the main limit stands with no reset time, is never dropped by a reset passing, and
   *    {@link awaitingTheProvidersWord} makes the runtime re-read before each turn. It holds until a
   *    read says `true`; a `null` read or a rolling wall does not undo it.
   *  - `true`: no wall is said for the main limit, except one a rolling frame reported after the
   *    read was asked.
   * Where the provider gave no boolean, the percentage and reset inference is kept.
   */
  private ordinaryUsageAllowed: boolean | null = null

  /** When a rolling frame last showed the main limit's wall, in ms; see `seed`. */
  private mainWallSeenAt = 0

  /** Whether a read has been taken in; the first goes under what is held. */
  private seeded = false

  /**
   * The limit a turn refused with `usageLimitExceeded` ended on: the main bucket's reached marker
   * (else its name) and the latest reset among its full windows (else its fullest window's). No reset
   * while the provider says ordinary usage is not allowed, nor for depleted credits, which no window
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

  /** True while the provider's last word was that usage is not allowed; the runtime re-reads before a turn. */
  awaitingTheProvidersWord(): boolean {
    return this.ordinaryUsageAllowed === false
  }

  /**
   * Seed from an `account/rateLimits/read` response and return the lines worth showing, usually
   * none. The baseline goes under what was already observed, since this runs without blocking
   * session start and a rolling frame that arrived first is newer. Only the main bucket speaks from
   * a baseline; the others are held so a later rolling frame merges into a real snapshot, but a
   * rolling frame for any bucket does speak.
   */
  seed(response: unknown, now: number = Date.now(), askedAt: number = now): string[] {
    const top = readField(response, 'rateLimits')
    const primary = readString(top, 'limitId')
    if (primary !== '') this.primaryLimitId = primary
    const allowed = readField(response, 'ordinaryUsageAllowed')
    if (allowed === true) {
      // A rolling wall on the main limit seen after this read was asked is the newer word.
      this.ordinaryUsageAllowed = this.mainWallSeenAt > askedAt ? null : true
    } else if (allowed === false) {
      this.ordinaryUsageAllowed = false
    }
    // A read with no boolean leaves a held word as it was.
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
      // The first read goes under what is held; a later read (turn-start re-read) was asked after
      // the frames and goes on top.
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
   * Take one `rateLimits` payload; answer with the line to show, or `null` for nothing new. `now` is
   * in milliseconds and injectable for tests.
   */
  observe(incoming: unknown, now: number = Date.now()): string | null {
    if (!isRecord(incoming)) {
      this.lastObserved = null
      return null
    }
    this.dropExpired(now)
    const key = this.keyFor(incoming)
    this.lastObserved = { key, frame: incoming }
    // Over the cap: judged alone, with no merged memory.
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
    // A wall on the main limit reported after the read is the newer word; it overrides a `true` only.
    if (this.isMain(key) && readString(incoming, 'rateLimitReachedType') !== '') {
      this.mainWallSeenAt = now
      if (this.ordinaryUsageAllowed === true) this.ordinaryUsageAllowed = null
    }
    return this.speak(key, bucket)
  }

  /** The line this bucket has to show now, deduped against its last one. */
  private speak(key: string, bucket: RateLimitBucket): string | null {
    const line = this.isMain(key)
      ? mainLimitPressure(bucket.snapshot, this.qualifies(key), this.ordinaryUsageAllowed)
      : rateLimitPressure(bucket.snapshot, this.qualifies(key))
    // Quiet clears the memory of what was said, so a returning wall is not deduped against an ended one.
    if (line === null) {
      bucket.said = null
      return null
    }
    if (line === bucket.said) return null
    bucket.said = line
    return line
  }

  /** Whether this bucket's sentence must name itself: only for a non-main bucket when several are held. */
  private qualifies(key: string): boolean {
    return this.buckets.size > 1 && key !== this.primaryLimitId
  }

  /** The bucket `ordinaryUsageAllowed` is about: the main one. */
  private isMain(key: string): boolean {
    return key === this.mainKey()
  }

  /** The main bucket's key: the provider's default, else the only bucket there is. */
  private mainKey(): string | null {
    if (this.primaryLimitId !== null) return this.primaryLimitId
    return this.buckets.size === 1 ? ([...this.buckets.keys()][0] ?? null) : null
  }

  /**
   * Which bucket a frame is about, or `null` when over the cap. A frame without a `limitId` goes to
   * the provider's main bucket, else the only bucket, since a sparse frame in an empty bucket could
   * say "approaching" while a wall stands in the real one; only an ambiguous frame gets its own bucket.
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

  /** A new bucket key, or `null` when the session already holds the maximum. */
  private room(key: string): string | null {
    return this.buckets.size < MAX_TRACKED_BUCKETS ? key : null
  }

  /** Forget every bucket whose windows have all reset, including what was said, so a returning wall is news. */
  private dropExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      // Not the main limit while the provider says usage is not allowed; a reset passing is the forbidden inference.
      if (this.ordinaryUsageAllowed === false && this.isMain(key)) continue
      if (snapshotExpired(bucket.snapshot, now)) this.buckets.delete(key)
    }
  }
}

/** {@link rateLimitPressure} for the main limit, where `ordinaryUsageAllowed` decides the wall whenever it is set. */
function mainLimitPressure(
  snapshot: Record<string, unknown>,
  qualify: boolean,
  ordinaryUsageAllowed: boolean | null,
): string | null {
  if (ordinaryUsageAllowed === null) return rateLimitPressure(snapshot, qualify)
  if (ordinaryUsageAllowed === false) {
    // No reset time, so nothing downstream ends the wall by one; spelled `is rate-limited` so it reads as stopped.
    const reached = readString(snapshot, 'rateLimitReachedType') || 'included usage not allowed'
    const named = readString(snapshot, 'limitName') || readString(snapshot, 'limitId')
    const where = qualify && named ? ` on the ${named} limit` : ''
    return `codex is rate-limited (${reached})${where} — turns may stall until codex says usage is allowed again`
  }
  // Allowed: no wall whatever the marker says; an approach or spend control still speaks.
  const withoutWall = { ...snapshot, rateLimitReachedType: null }
  return rateLimitPressure(withoutWall, qualify)
}

/**
 * True once every window this snapshot holds says its reset has passed. A window with no usable
 * `resetsAt` blocks expiry, and a snapshot with no window cannot expire.
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
 * Merge a sparse update into what is held at every level, since `RateLimitWindow` has two nullable
 * fields a rolling update may omit. Arrays replace.
 */
function mergeSparse(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  // Copy the base too: {@link seed} passes the provider's response, which the raw history also
  // holds, so a shallow spread would retain it by reference.
  const merged = copyRecord(base)
  for (const [key, value] of Object.entries(incoming)) {
    // Null or absent means not reported in this frame.
    if (value === null || value === undefined) continue
    const held = merged[key]
    merged[key] =
      isMergeable(held) && isMergeable(value) ? mergeSparse(held, value) : structuredCopy(value)
  }
  return merged
}

/** A plain object, the only thing {@link mergeSparse} recurses into. */
function isMergeable(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value)
}

/** A copy of provider data before it is retained, so held state does not alias the raw history. */
function structuredCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuredCopy)
  return isMergeable(value) ? copyRecord(value) : value
}

/** {@link structuredCopy} for a known record; the base of a merge. */
function copyRecord(value: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) copy[key] = structuredCopy(inner)
  return copy
}

/** The fuller of a snapshot's two windows, the one that stopped the turn. */
function fullestWindow(snapshot: unknown): { window: unknown; used: number } | undefined {
  return [readField(snapshot, 'primary'), readField(snapshot, 'secondary')]
    .map((window) => ({ window, used: readNumber(window, 'usedPercent') ?? -1 }))
    .sort((a, b) => b.used - a.used)[0]
}

/** A window's `resetsAt` in epoch seconds, or `0` when absent or unusable. */
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
 * How full each window of one bucket is, as a `provider_usage`, or `null` when no window exists.
 * Windows are named as {@link windowName} names them, with the bucket's name when it is not the main
 * one. `usedPercent` is a percentage; `resetsAt` is in seconds and converted to ms.
 */
export function rateLimitUsage(bucket: UsageBucket | null): RuntimeEvent | null {
  if (bucket === null || !isRecord(bucket.snapshot)) return null
  const { snapshot, mainLimitId } = bucket
  // The name must not move between frames, so it uses the frame's `limitName`, else the bucket id
  // when the provider named another bucket its main one, never the held-bucket count.
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
    // A window with no number is no reading.
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

/** How to say a `windowDurationMins`, e.g. "a 7-day window"; "this window" when the length is unreported. */
function windowName(window: unknown): string {
  const mins = readNumber(window, 'windowDurationMins')
  if (mins === undefined || mins <= 0) return 'this window'
  if (mins % 1440 === 0) return `a ${mins / 1440}-day window`
  if (mins % 60 === 0) return `a ${mins / 60}-hour window`
  return `a ${Math.round(mins)}-minute window`
}

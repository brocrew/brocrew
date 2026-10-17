/**
 * # 🔴 D-031 · the Mac's local time — one answer, in `main` and in the window
 *
 * Match the system clock in both processes. For the local offset at any instant, `main` reads
 * the zone file the
 * system's clock reads (`main/system-zone.ts`) and hands it here as plain data ({@link LocalZone})
 * — to this module in `main` itself, and over the bridge in the window
 * (`renderer/src/lib/local-zone.ts`). ⛔ Every time either process says, and every local wall time
 * it reads an instant as (the calendar D-029's jobs are placed on, `schedule-evidence.ts`), asks
 * this module — no second derivation.
 *
 * ⛔ **Not the runtime's own zone data.** Electron's main process and its Chromium carry their own
 * copy of the time-zone database (ICU's), and it can be older than the Mac's: Morocco moved to
 * GMT+0 for good in the Mac's 2026c, while Electron's copy still puts it at GMT+1 — an hour ahead
 * of the menu bar, of the shell and of the Claude CLI, which links the system's ICU and so reads the
 * Mac's release. `Intl` given the zone's NAME reads that same stale copy, so a formatter here is
 * given an OFFSET (`+01:00`), never a name.
 *
 * ⚠️ **No zone handed over — `main` could not read the file, or nothing asked — is the runtime's
 * own offset**, and every answer here is then the one the `Date` methods give. That is what every
 * test sees: no test hands a zone over.
 */

/** ⚑ A day, in ms: a local day is a UTC day moved by the offset. */
const DAY_MS = 86_400_000

/**
 * ⚑ **A day a rule names** — POSIX's `Mm.w.d[/time]`, the one form the Mac's zone files use: the
 * `week`th `weekday` of `month`, at `time` past that day's local midnight.
 */
export interface RuleDay {
  /** 1–12. */
  readonly month: number
  /** 1–5, and 5 is the month's last such weekday. */
  readonly week: number
  /** 0–6, 0 being Sunday. */
  readonly weekday: number
  /** ms past local midnight, ⚠️ which may be negative or past a day. */
  readonly time: number
}

/**
 * ⚑ **The rule that governs every instant after a zone's last change** — a zone file's footer.
 * Offsets are ms EAST of UTC. ⚑ `starts` is said in standard time and `ends` in daylight time,
 * as POSIX says them.
 */
export interface ZoneRule {
  readonly standard: number
  readonly daylight: {
    readonly offset: number
    readonly starts: RuleDay
    readonly ends: RuleDay
  } | null
}

/** ⚑ A zone's change: from `at` on, local time is `offset` ms east of UTC. */
export interface ZoneChange {
  readonly at: number
  readonly offset: number
}

/**
 * 🔴 **The Mac's zone, as plain data** — what `main` reads off the system's zone file, and what
 * crosses the bridge to the window. ⚑ `before` holds before the first change, `changes` are in
 * order, and `rule`, where there is one, governs after the last of them; ⚠️ with no change at all
 * it governs every instant.
 */
export interface LocalZone {
  readonly before: number
  readonly changes: readonly ZoneChange[]
  readonly rule: ZoneRule | null
}

/**
 * 🔴 **Main→renderer: the Mac's time zone moved** — the zone `main` read again, whole. ⚑ Its own
 * channel, like `app:last-draft-save`: it is about the machine, not about any conversation.
 */
export const LOCAL_ZONE_MOVED_CHANNEL = 'app:local-zone-moved'

let readTheZone: () => LocalZone | null = () => null

/**
 * ⚑ **Where every answer below reads the zone from** — `main`'s copy in `main`, the bridge's in
 * the window. ⚠️ Read at EVERY answer, so a zone that moved is said at once, and the window's
 * reactive copy is a dependency of whatever drew a time.
 */
export function readLocalTimeFrom(read: () => LocalZone | null): void {
  readTheZone = read
}

/** The zone every answer here reads now, as {@link readLocalTimeFrom} was handed it; `null` when none. */
export function theZoneReadNow(): LocalZone | null {
  return readTheZone()
}

/**
 * ⛔ **The interval {@link offsetAt} last kept** — `[keptFrom, keptTo)` at `keptOffset`, in
 * `keptZone` — and the reason the walk costs what it did: it asks one interval hundreds of
 * thousands of times. ⚑ Measured on the walk of a line that never matches, which runs thousands of
 * years past the last change into the rule's: Paris's file, 161 ms kept, 2,176 ms computed afresh.
 */
let keptZone: LocalZone | null = null
let keptFrom = 0
let keptTo = 0
let keptOffset = 0

function keep(from: number, to: number, offset: number): number {
  keptFrom = from
  keptTo = to
  keptOffset = offset
  return offset
}

/** ⚑ **How far local time is from UTC at `at`**, in ms east — the Mac's, or the runtime's own. */
function offsetAt(at: number): number {
  const zone = readTheZone()
  if (zone === null) return Math.round(-new Date(at).getTimezoneOffset() * 60_000)
  if (zone === keptZone && at >= keptFrom && at < keptTo) return keptOffset
  keptZone = zone
  const { changes, rule } = zone
  const last = changes[changes.length - 1]
  if (rule !== null && (last === undefined || at >= last.at)) {
    return ruleOffsetAt(rule, at, last?.at ?? Number.NEGATIVE_INFINITY)
  }
  const first = changes[0]
  if (first === undefined || at < first.at) {
    return keep(Number.NEGATIVE_INFINITY, first?.at ?? Number.POSITIVE_INFINITY, zone.before)
  }
  let low = 0
  let high = changes.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((changes[middle]?.at ?? Number.POSITIVE_INFINITY) <= at) low = middle
    else high = middle - 1
  }
  const change = changes[low] ?? first
  return keep(change.at, changes[low + 1]?.at ?? Number.POSITIVE_INFINITY, change.offset)
}

/**
 * ⚑ **The rule's offset at `at`**, from its changes in `at`'s year and the years either side —
 * sorted, so a rule whose daylight time spans the new year (the southern hemisphere's) reads as
 * any other. ⚑ A change outside `Date`'s range is no change.
 */
function ruleOffsetAt(rule: ZoneRule, at: number, since: number): number {
  const { standard, daylight } = rule
  if (daylight === null) return keep(since, Number.POSITIVE_INFINITY, standard)
  const year = new Date(at + standard).getUTCFullYear()
  // ⛔ An instant whose local year is past `Date`'s range, at its very edge, has no change of the
  // rule to read: it is said in standard time and nothing is kept — an interval kept with no change
  // in it would say standard time for every later instant, daylight time included.
  if (Number.isNaN(year)) {
    keptZone = null
    return standard
  }
  const edges: ZoneChange[] = []
  for (let each = year - 1; each <= year + 1; each += 1) {
    edges.push({ at: ruleDayAt(each, daylight.starts) - standard, offset: daylight.offset })
    edges.push({ at: ruleDayAt(each, daylight.ends) - daylight.offset, offset: standard })
  }
  const inOrder = edges.filter((edge) => !Number.isNaN(edge.at)).sort((a, b) => a.at - b.at)
  let from = since
  let to = Number.POSITIVE_INFINITY
  let offset = inOrder[0]?.offset === standard ? daylight.offset : standard
  for (const edge of inOrder) {
    if (edge.at > at) {
      to = edge.at
      break
    }
    from = Math.max(edge.at, since)
    offset = edge.offset
  }
  return keep(from, to, offset)
}

/** ⚑ A rule's day in `year`, at its time, as a wall clock read as UTC. */
function ruleDayAt(year: number, { month, week, weekday, time }: RuleDay): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  let date = 1 + ((weekday - firstWeekday + 7) % 7) + (week - 1) * 7
  while (date > days) date -= 7
  return Date.UTC(year, month - 1, date) + time
}

/** ⚑ An instant's local wall clock — `Date`'s local getters, in the Mac's zone. */
export interface LocalFields {
  readonly year: number
  /** 0–11, as `Date` counts it. */
  readonly month: number
  readonly date: number
  /** 0–6, 0 being Sunday. */
  readonly day: number
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
}

/** ⚑ **`at` on the Mac's wall clock.** */
export function localFields(at: number): LocalFields {
  const wall = new Date(at + offsetAt(at))
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth(),
    date: wall.getUTCDate(),
    day: wall.getUTCDay(),
    hours: wall.getUTCHours(),
    minutes: wall.getUTCMinutes(),
    seconds: wall.getUTCSeconds(),
  }
}

/** ⚑ **Whether two instants fall on one day of the Mac's calendar.** */
export function sameLocalDay(a: number, b: number): boolean {
  return Math.floor((a + offsetAt(a)) / DAY_MS) === Math.floor((b + offsetAt(b)) / DAY_MS)
}

/**
 * 🔴 **A formatter in the Mac's zone that keeps the person's locale** — `Intl.DateTimeFormat` with
 * the offset at the instant as its zone (`+01:00`), so the locale's own style and hour cycle stand
 * and only the zone is the Mac's. ⚑ The instant is never moved, so a moment `Intl` can format is
 * still one.
 *
 * ⛔ **Built ONCE per offset, on first use** (`255`): `Date.prototype.toLocaleTimeString` builds a
 * fresh `Intl.DateTimeFormat` on every call, which cost 36× on the Events tab at its cap. ⚠️ Built
 * through the global `Intl.DateTimeFormat` when first used, never a reference kept at load —
 * `clock-format.test.ts` counts constructions on the global.
 *
 * ⚠️ **The offset is rounded to the minute**: `Intl` takes no finer one, and only a zone's local
 * mean time, a century and more ago, has seconds.
 */
export function localFormat(options: Intl.DateTimeFormatOptions): (at: number) => string {
  const built = new Map<number, Intl.DateTimeFormat>()
  return (at) => {
    const minutes = Math.round(offsetAt(at) / 60_000)
    let format = built.get(minutes)
    if (format === undefined) {
      format = new Intl.DateTimeFormat(undefined, { ...options, timeZone: offsetZone(minutes) })
      built.set(minutes, format)
    }
    return format.format(at)
  }
}

/** ⚑ `+01:00`, `-03:30`, `+00:00` — an offset as `Intl` names a zone. */
function offsetZone(minutes: number): string {
  const whole = Math.abs(minutes)
  const hours = String(Math.floor(whole / 60)).padStart(2, '0')
  return `${minutes < 0 ? '-' : '+'}${hours}:${String(whole % 60).padStart(2, '0')}`
}

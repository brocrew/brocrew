import { clockTimeFrom } from '../../../shared/clock'
import type { Provider } from '@brobot2/shared'
import { PROVIDER_NAME, type ProviderUsageReading } from '../../../shared/runtime-ipc'
import type { LimitStanding, ProviderCondition } from '../../../shared/provider-limit'
import { agoWords, fullTime } from './clock'

export type UsageProviderNames = Readonly<Partial<Record<Provider, string>>>

export function usageProviderName(
  provider: Provider,
  names: UsageProviderNames | undefined,
  generic: string,
): string {
  return names === undefined ? PROVIDER_NAME[provider] : (names[provider] ?? generic)
}

export const UNCONFIRMED_USAGE = 'Not yet confirmed'

export function readingStatus(reading: ProviderUsageReading, now: number): string | null {
  return reading.unconfirmed === true
    ? `${UNCONFIRMED_USAGE} · read ${agoWords(reading.at, now)}`
    : null
}

/**
 * # 🔴 UI-009 · A usage limit, said plainly (F052)
 *
 * Describe a provider approaching its limit as near the limit, with its reset time. Avoid claiming work is about to stop or placing an informational warning under a heading that promises an action to settle.
 *
 * ⚑ **One sentence from what the provider said**: who, how near (`is near` / `has reached`), which
 * limit (the window the provider named, in a person's words), how much of it is used where a line
 * said so (F096), and when it resets. ⛔ The provider's own lines stay reachable on the sentence's
 * title — reworded here, never re-measured.
 */

/** ⚑ The standing, as a person says it. */
const HOW_NEAR: Readonly<Record<LimitStanding, string>> = {
  'about-to-stop': 'is near',
  stopped: 'has reached',
}

/** One limit's word and, when a line said it, how much of it is used: *weekly (96% used)*. */
interface LimitSaid {
  readonly word: string
  readonly used: number | null
}

/** " (96% used)", or nothing when no line said how much. */
const usedWords = (used: number | null): string =>
  used === null ? '' : ` (${String(Math.round(used))}% used)`

/**
 * "its weekly limit (96% used)" / "its 5-hour (85% used) and weekly (96% used) limits" /
 * "a usage limit" — ⚑ F096: each limit with how much of it is used, where a line said it.
 */
function whichLimit(limits: readonly LimitSaid[], unnamedUsed: number | null): string {
  if (limits.length === 0) return `a usage limit${usedWords(unnamedUsed)}`
  if (limits.length === 1) return `its ${limits[0]!.word} limit${usedWords(limits[0]!.used)}`
  const each = limits.map((one) => `${one.word}${usedWords(one.used)}`)
  return `its ${each.slice(0, -1).join(', ')} and ${each.at(-1)!} limits`
}

/** The higher of two figures, either of which may be unsaid. */
const fuller = (one: number | null, other: number | null): number | null =>
  one === null ? other : other === null ? one : Math.max(one, other)

/**
 * How far apart two moments are, in a person's words: *"less than a minute"*, *"45 min"*,
 * *"3 h 12 min"* under a day, *"2 days"* from a day up. Minutes and days are rounded.
 */
export function spanWords(ms: number): string {
  const span = Math.abs(ms)
  if (span < 60_000) return 'less than a minute'
  const minutes = Math.round(span / 60_000)
  if (minutes < 60) return `${String(minutes)} min`
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`
  }
  const days = Math.round(minutes / (24 * 60))
  return days === 1 ? '1 day' : `${String(days)} days`
}

/**
 * The reset, relative to `now`: *"resets in 3 h 12 min"*, or *"reset 2 days ago"* once it has
 * passed; `null` when the provider has not said. The exact moment goes on the title
 * ({@link usageTitle}, {@link readingTitle}).
 */
export function resetWords(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null
  return resetsAt > now
    ? `resets in ${spanWords(resetsAt - now)}`
    : `reset ${spanWords(now - resetsAt)} ago`
}

/** How much of a reading's window has gone, beside how much of it is used. */
export interface TimeGone {
  /** 0..1 of the window. */
  readonly fraction: number
  /** *"2 h 30 min of 5 h gone"*, *"4 of 7 days gone"*. */
  readonly words: string
  /** The confirmed usage figure is ahead of the time gone. */
  readonly ahead: boolean
}

/**
 * The time gone in a reading's window, `1 - (resetsAt - now) / length`, clamped to 0..1. `null`
 * when the window's length is unknown, or the reset is unsaid or past: a passed reset is not the
 * start of a new window.
 */
export function timeGone(reading: ProviderUsageReading, now: number): TimeGone | null {
  const length = reading.period?.durationMs ?? null
  if (length === null || reading.resetsAt === null || reading.resetsAt <= now) return null
  const fraction = Math.min(1, Math.max(0, 1 - (reading.resetsAt - now) / length))
  const gone = spanWords(fraction * length)
  const whole = spanWords(length)
  const sameDays = /^(\d+) days?$/.exec(gone)
  const words =
    sameDays !== null && whole.endsWith(' days')
      ? `${sameDays[1]!} of ${whole} gone`
      : `${gone} of ${whole} gone`
  return {
    fraction,
    words,
    ahead:
      reading.unconfirmed !== true &&
      reading.usedPercent !== null &&
      reading.usedPercent > fraction * 100,
  }
}

/** "it resets in 3 h 12 min", "it reset 2 days ago", or that it has not said. */
function whenItResets(resetsAt: number | null, now: number): string {
  const words = resetWords(resetsAt, now)
  return words === null ? 'it hasn’t said when it resets' : `it ${words}`
}

/**
 * A sentence from supplied limit facts, with the reset relative to the display clock.
 * Windows and percentages come from the core reading; repeated window words share their fullest figure.
 */
export function usageSays(
  condition: ProviderCondition,
  now: number,
  names?: UsageProviderNames,
): string {
  if (condition.meaning === undefined) return condition.says
  const limits: LimitSaid[] = []
  let unnamedUsed: number | null = null
  for (const { word, used } of condition.meaning) {
    if (word === null) {
      unnamedUsed = fuller(unnamedUsed, used)
      continue
    }
    const at = limits.findIndex((one) => one.word === word)
    if (at === -1) limits.push({ word, used })
    else limits[at] = { word, used: fuller(limits[at]!.used, used) }
  }
  return `${usageProviderName(condition.provider, names, 'This provider')} ${HOW_NEAR[condition.standing]} ${whichLimit(limits, unnamedUsed)}; ${whenItResets(condition.resetsAt, now)}.`
}

/** ⚑ **What the sentence's title carries** — the provider's own lines, and the exact reset. */
export function usageTitle(condition: ProviderCondition): string {
  const reset = condition.resetsAt === null ? '' : fullTime(condition.resetsAt)
  return [...condition.said, ...(reset === '' ? [] : [reset])].join('\n')
}

/**
 * ⚑ **What a reading's title carries** — the exact reset, when the provider said one, and when this
 * app received the reading.
 */
export function readingTitle(reading: ProviderUsageReading, now: number): string {
  const lines: string[] = []
  if (reading.resetsAt !== null) {
    lines.push(`${reading.resetsAt > now ? 'Resets' : 'Reset'} ${fullTime(reading.resetsAt)}`)
  }
  lines.push(`Received ${fullTime(reading.at)}`)
  if (reading.unconfirmed === true) lines.push(UNCONFIRMED_USAGE)
  return lines.join('\n')
}

/**
 * 🔴 **W4.26 · one usage reading, near a limit or not** — *"Weekly limit: 42% used; it resets in 3
 * days."* ⚑ The window in a person's words where this app has one, else the provider's own word;
 * a bucket the provider named (Codex's *"(GPT-5.3-Codex-Spark)"*) stays beside it.
 * ⛔ F096: readings are kept across a restart, so one whose window has reset since is routine — said
 * in the past (*"Weekly limit: was 95% used; it reset 2 days ago."*), never as the window now.
 */
export function readingSays(reading: ProviderUsageReading, now: number): string {
  const word = reading.period?.word ?? null
  const bucket = reading.period?.bucketName ?? null
  const named =
    word === null
      ? reading.window
      : `${word[0]!.toUpperCase()}${word.slice(1)} limit${bucket === null ? '' : ` (${bucket})`}`
  if (reading.resetsAt !== null && reading.resetsAt <= now) {
    const was =
      reading.usedPercent === null
        ? 'how much was used wasn’t said'
        : `was ${Math.round(reading.usedPercent)}% used`
    return `${named}: ${was}; ${whenItResets(reading.resetsAt, now)}.`
  }
  const used =
    reading.usedPercent === null
      ? 'how much is used isn’t said'
      : `${Math.round(reading.usedPercent)}% used`
  return `${named}: ${used}; ${whenItResets(reading.resetsAt, now)}.`
}

/**
 * 🔴 **F074 — a turn that ended on its provider's usage limit, said in the conversation** — on the
 * turn's own ending: *"Claude’s usage limit was reached; it resets at 17:50"*. ⚑ The reset is said
 * as of the turn's own moment, on the Mac's clock, with its day when that is another; ⛔ a reset
 * at or before that moment is not said.
 */
export function aTurnsLimitSays(
  limit: { readonly provider: Provider; readonly resetsAt?: number; readonly window?: string },
  at: number | undefined,
  names?: UsageProviderNames,
): string {
  const resetsAt = limit.resetsAt ?? null
  // A refusal that names no limit and no reset is nothing this app can time: the provider's plan or
  // its usage refused the turn, and its own words are the error just above.
  if (limit.window === undefined && resetsAt === null) {
    return `${usageProviderName(limit.provider, names, 'This provider')} refused the turn on its plan or usage; what it said is just above`
  }
  const ahead = resetsAt !== null && (at === undefined || resetsAt > at)
  // ⛔ A reset already past is not said: it is no longer when anything comes back.
  const resets = ahead
    ? `; it resets at ${clockTimeFrom(resetsAt, at ?? resetsAt)}`
    : resetsAt === null
      ? '; it hasn’t said when it resets'
      : ''
  return `${usageProviderName(limit.provider, names, 'the provider')}’s usage limit was reached${resets}`
}

/**
 * 🔴 **W4.63 · a provider at its usage limit, as the Providers card heads it** — *"At its limit until
 * 17:50"*, *"… until 17:50 on 7 October"* another day, on the Mac's clock. ⚑ Only for a STOPPED
 * wall — the one F074's hold reads — never for one about to stop; ⛔ `null` for any other.
 * ⚑ A wall that names no reset (Codex while it says ordinary usage is not allowed), or one whose
 * reset has passed while it still stands, says so rather than giving a time.
 */
export function atItsLimitSays(condition: ProviderCondition, now: number): string | null {
  if (condition.standing !== 'stopped') return null
  if (condition.meaning === undefined) return condition.says || null
  const at = condition.resetsAt
  if (at === null) return 'At its limit. It hasn’t said when that lifts.'
  if (at <= now) return `At its limit. It was due to lift at ${clockTimeFrom(at, now)}.`
  // An untimed wall makes this the minimum wait rather than a promised return.
  const untimed = condition.meaning.some((one) => one.untimed)
  return `At its limit ${untimed ? 'at least ' : ''}until ${clockTimeFrom(at, now)}`
}

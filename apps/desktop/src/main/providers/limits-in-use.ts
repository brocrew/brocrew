import { providerRecord, type Provider } from '@brobot2/shared'
import {
  foldProviderLimits,
  USAGE_NEARS_ITS_LIMIT_AT,
  usageWarnings,
  wallsFromUsage,
  type ProviderLimitSeen,
} from '../../shared/provider-limit'
import type { LedgerWalk } from '../../shared/question-contracts'
import { drawnInTheTitleBar } from '../../shared/usage-window'
import { limitMeaning } from './limit-meaning'
import { usagePeriod, warningWindow } from './usage-period'

/** A usage reading as a person's limits use it, with the account it was read on when known. */
export interface ReadingInUse {
  readonly window: string
  readonly usedPercent: number | null
  readonly resetsAt: number | null
  readonly at: number
  readonly account?: string
  /** Kept by an earlier run and not yet confirmed: it names its account and warns of nothing. */
  readonly unconfirmed?: true
}

/** How a life's account is written on the limits it recorded. */
export function limitIdentity(provider: Provider, kind: 'account' | 'sign-in', id: string): string {
  return `${provider}:${kind}:${id}`
}

/** The id a reading carries for a recorded limit's account; `undefined` when it cannot be read. */
function readingAccountOf(provider: Provider, identity: string | undefined): string | undefined {
  for (const kind of ['account', 'sign-in'] as const) {
    const prefix = limitIdentity(provider, kind, '')
    if (identity?.startsWith(prefix) === true && identity.length > prefix.length)
      return identity.slice(prefix.length)
  }
  return undefined
}

/** A reading as far as the account in use is concerned. */
interface ReadOnAnAccount {
  readonly window: string
  readonly at: number
  readonly account?: string
}

/**
 * The account in use: the one the newest reading the title bar draws was read on
 * ({@link drawnInTheTitleBar}). Readings kept by an earlier run name it too, since they are shown.
 */
export function accountInUse(
  provider: Provider,
  readings: readonly ReadOnAnAccount[],
): string | undefined {
  let newest: ReadOnAnAccount | undefined
  for (const one of readings) {
    if (!drawnInTheTitleBar(usagePeriod(provider, one.window))) continue
    if (newest === undefined || one.at >= newest.at) newest = one
  }
  return newest?.account
}

/**
 * A provider's readings of the account in use, with those of no known account: the one projection
 * the title bar's numbers and the limit notices both read, so they never describe two accounts.
 */
export function readingsOfTheAccountInUse<Reading extends ReadOnAnAccount>(
  provider: Provider,
  readings: readonly Reading[],
): readonly Reading[] {
  const inUse = accountInUse(provider, readings)
  if (inUse === undefined) return readings
  return readings.filter((one) => one.account === undefined || one.account === inUse)
}

/**
 * The limits a person is told of describe the account in use ({@link readingsOfTheAccountInUse}).
 * Readings kept by an earlier run warn of nothing. A limit another account reached is not told. A
 * warning gives way to a newer reading of the same window that warns itself, so the figure told is
 * the current one: a known account's only to its own reading, and a warning of no known account to
 * any, and to a newer lower figure as well. Without a reading of a known account, every recorded
 * limit is told, and an account that cannot be read counts as unknown. What holds work is decided
 * elsewhere.
 */
export function limitsOfTheAccountInUse(
  walk: LedgerWalk<ProviderLimitSeen>,
  usage: Readonly<Partial<Record<Provider, readonly ReadingInUse[]>>>,
  now: number,
): LedgerWalk<ProviderLimitSeen> {
  const inUse = providerRecord((provider) => accountInUse(provider, usage[provider] ?? []))
  const ofAnother = (provider: Provider, account: string | undefined): boolean =>
    inUse[provider] !== undefined && account !== undefined && account !== inUse[provider]
  const counted = providerRecord((provider) =>
    readingsOfTheAccountInUse(provider, usage[provider] ?? []).filter(
      (one) => one.unconfirmed !== true,
    ),
  )
  // Every counted reading that speaks for its window now, at any figure, by the warnings' own rules.
  const speaking = usageWarnings(counted, [], now, warningWindow, 0)
  const outdated = (wall: ProviderLimitSeen, account: string | undefined): boolean => {
    if (wall.standing !== 'about-to-stop') return false
    const figure = limitMeaning(wall.said).used
    return speaking.some(({ reading, wall: its }) => {
      const used = reading.usedPercent
      if (
        its.provider !== wall.provider ||
        reading.window !== wall.window ||
        reading.at <= wall.at ||
        used === null
      )
        return false
      // A known account's warning gives way only to that account's own reading.
      if (account !== undefined)
        return reading.account === account && used >= USAGE_NEARS_ITS_LIMIT_AT
      return used >= USAGE_NEARS_ITS_LIMIT_AT || (figure !== null && used < figure)
    })
  }
  const rows = walk.rows.filter((wall) => {
    const account = readingAccountOf(wall.provider, wall.account)
    return !ofAnother(wall.provider, account) && !outdated(wall, account)
  })
  const near = wallsFromUsage(counted, rows, now, warningWindow)
  if (near.length === 0 && rows.length === walk.rows.length) return walk
  return { ...walk, rows: foldProviderLimits([...rows, ...near], [], now) }
}

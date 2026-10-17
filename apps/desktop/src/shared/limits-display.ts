import type { LedgerWalk } from './questions'
import type { ProviderLimitSeen } from './provider-limit'

export interface LimitsDisplayScope {
  readonly databaseEpoch: number
  readonly signInEpoch: number
}

/** A dated display reading, separate from current conversation facts and admission. */
export interface LimitsDisplayReading extends LimitsDisplayScope {
  readonly operation: number
  readonly pinStartedAt: number
  readonly pinFinishedAt: number
  readonly evaluatedAt: number
  readonly usageAt: number
  readonly finishedAt: number
  readonly walked: LedgerWalk<ProviderLimitSeen>
}

export type LimitsDisplayAnswer =
  | { readonly is: 'read'; readonly reading: LimitsDisplayReading }
  | ({ readonly is: 'unavailable' } & LimitsDisplayScope)

export interface LimitsDisplayChanged extends LimitsDisplayScope {
  readonly why: 'scope' | 'unavailable' | 'closed'
}

export const LIMITS_DISPLAY_CHANGED_CHANNEL = 'runtime:limits-display-changed'

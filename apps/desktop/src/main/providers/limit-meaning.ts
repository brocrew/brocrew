import {
  readProviderLimit,
  type ProviderLimitMeaning,
  type ProviderLimitSeen,
} from '../../shared/provider-limit'
import type { LedgerWalk } from '../../shared/question-contracts'
import { usagePeriod } from './usage-period'

/** Decode adapter diagnostics at the core read boundary, including retained ledger rows. */
export function limitMeaning(said: string): ProviderLimitMeaning {
  const limit = readProviderLimit(said, 0)
  const used = /(\d+(?:\.\d+)?)% (?:of .+? )?used\b/.exec(said)?.[1]
  return {
    word: limit === null ? null : usagePeriod(limit.window).word,
    used: used === undefined ? null : Number(used),
    untimed: limit !== null && limit.resetsAt === null,
  }
}

export function limitsForDisplay(
  walk: LedgerWalk<ProviderLimitSeen>,
): LedgerWalk<ProviderLimitSeen> {
  return {
    ...walk,
    rows: walk.rows.map((wall) =>
      wall.meaning === undefined ? { ...wall, meaning: limitMeaning(wall.said) } : wall,
    ),
  }
}

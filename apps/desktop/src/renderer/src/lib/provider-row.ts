import type {
  ApiKeyStatus,
  AuthState,
  ProviderUsageReading,
  ProviderVersion,
} from '../../../shared/runtime-ipc'
import { keyCantBeRead } from './saved-key'
import { readingSays, readingStatus } from './usage-limit'

export interface ProviderStanding {
  readonly words: 'Ready' | 'Needs setup' | 'At its limit' | "Couldn't check"
  readonly tone: 'ready' | 'not-ready' | 'at-limit' | 'unknown'
}
export interface ProviderRowFacts {
  readonly auth: AuthState | null
  readonly key: ApiKeyStatus | null
  readonly version: ProviderVersion | null
  readonly atItsLimit: string | null
}

/** The same four readings head the list and the provider's existing controls. */
export function providerStanding(facts: ProviderRowFacts): ProviderStanding | null {
  if (facts.version?.program?.standing === 'missing' || keyCantBeRead(facts.key))
    return { words: 'Needs setup', tone: 'not-ready' }
  const auth = facts.auth
  if (auth === null) return null
  if (auth.state === 'unknown') return { words: "Couldn't check", tone: 'unknown' }
  if (auth.state !== 'usable') return { words: 'Needs setup', tone: 'not-ready' }
  if (
    auth.login === 'api-key' &&
    facts.key?.set === true &&
    facts.key.refusedForBilling !== undefined
  )
    return { words: 'Needs setup', tone: 'not-ready' }
  return facts.atItsLimit === null
    ? { words: 'Ready', tone: 'ready' }
    : { words: 'At its limit', tone: 'at-limit' }
}

/** Preserve dated/unconfirmed evidence in the provider's existing usage words. */
export function providerRowDetail(
  facts: ProviderRowFacts,
  readings: readonly ProviderUsageReading[] | null,
  now: number,
): string {
  const standing = providerStanding(facts)
  if (standing === null) return 'Checking…'
  if (standing.tone === 'not-ready') return 'Sign in or use an API key.'
  if (standing.tone === 'unknown')
    return facts.auth?.state === 'unknown' ? facts.auth.reason : "Couldn't check this provider."
  if (facts.atItsLimit !== null) return facts.atItsLimit
  const tightest =
    readings?.reduce<ProviderUsageReading | null>(
      (held, reading) =>
        reading.usedPercent !== null &&
        (held === null || reading.usedPercent > (held.usedPercent ?? -1))
          ? reading
          : held,
      null,
    ) ?? null
  if (tightest !== null) {
    const status = readingStatus(tightest, now)
    return `${readingSays(tightest, now)}${status ? ` ${status}` : ''}`
  }
  return facts.auth?.state === 'usable' && facts.auth.login === 'api-key'
    ? 'Runs on the saved API key.'
    : 'No usage reading yet.'
}

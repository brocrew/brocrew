import { providerRecord, SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import type { ProviderUsageReading, UsageWindowSeen } from '../shared/runtime-ipc'
import type { AppDatabase } from './db/connection'

/** Each provider's newest usage reading per window, and the windows it has reported, across a restart. */
export interface KeptUsage {
  readonly readings: Readonly<Record<Provider, readonly KeptReading[]>>
  readonly seen: Readonly<Record<Provider, readonly UsageWindowSeen[]>>
  /** The sign-in each provider's latest reading was read on (`SessionHandle.signInTag`), when tagged. */
  readonly readOn?: Readonly<Partial<Record<Provider, string>>>
}

/** A reading with the id of the account it was read on, when known; never the account's email. */
export interface KeptReading extends ProviderUsageReading {
  readonly account?: string
}

export const NO_USAGE_KEPT: KeptUsage = {
  readings: providerRecord(() => []),
  seen: providerRecord(() => []),
}

export interface UsageKept {
  read(): KeptUsage
  write(usage: KeptUsage): void
}

export function usageKeptIn(database: AppDatabase): UsageKept {
  const readings = database.prepare(
    `SELECT provider, "window", used_percent AS usedPercent, resets_at AS resetsAt, at, account
     FROM provider_usage_reading ORDER BY provider, position`,
  )
  const seen = database.prepare(
    'SELECT provider, "window", "first", "last" FROM provider_usage_window_seen ORDER BY provider, position',
  )
  const readOn = database.prepare('SELECT provider, tag FROM provider_usage_read_on')
  return {
    read() {
      const held = providerRecord((): KeptReading[] => [])
      for (const { provider, account, ...row } of readings.all() as (KeptReading & {
        provider: Provider
        account: string | null
      })[]) {
        held[provider].push(account === null ? row : { ...row, account })
      }
      const windows = providerRecord((): UsageWindowSeen[] => [])
      for (const { provider, ...row } of seen.all() as (UsageWindowSeen & { provider: Provider })[])
        windows[provider].push(row)
      const tags = readOn.all() as { provider: Provider; tag: string }[]
      return {
        readings: held,
        seen: windows,
        ...(tags.length === 0
          ? {}
          : { readOn: Object.fromEntries(tags.map(({ provider, tag }) => [provider, tag])) }),
      }
    },
    write: database.transaction((usage: KeptUsage) => replaceUsage(database, usage)),
  }
}

function replaceUsage(database: AppDatabase, usage: KeptUsage): void {
  for (const table of [
    'provider_usage_reading',
    'provider_usage_window_seen',
    'provider_usage_read_on',
  ])
    database.prepare(`DELETE FROM ${table}`).run()
  const reading = database.prepare(
    `INSERT OR IGNORE INTO provider_usage_reading
     (provider, "window", position, used_percent, resets_at, at, account) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const seen = database.prepare(
    `INSERT OR IGNORE INTO provider_usage_window_seen (provider, "window", position, "first", "last")
     VALUES (?, ?, ?, ?, ?)`,
  )
  const readOn = database.prepare(
    'INSERT INTO provider_usage_read_on (provider, tag) VALUES (?, ?)',
  )
  for (const provider of SUPPORTED_PROVIDERS) {
    usage.readings[provider].forEach((r, position) =>
      reading.run(provider, r.window, position, r.usedPercent, r.resetsAt, r.at, r.account ?? null),
    )
    usage.seen[provider].forEach((w, position) =>
      seen.run(provider, w.window, position, w.first, w.last),
    )
    const tag = usage.readOn?.[provider]
    if (tag !== undefined) readOn.run(provider, tag)
  }
}

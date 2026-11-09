import { join } from 'node:path'
import { providerRecord, SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import { MAX_INSTANT } from '../shared/clock'
import type { ProviderUsageReading, UsageWindowSeen } from '../shared/runtime-ipc'
import type { AppDatabase } from './db/connection'
import { importSideFile, objectIn } from './db/side-file-import'

/** The file older builds kept these readings in, imported once into the `provider_usage_*` tables. */
export const PROVIDER_USAGE_FILE = 'provider-usage.json'

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

/** Imports `provider-usage.json` from `userData` once, skipping each row it cannot use. */
export function importProviderUsageFile(database: AppDatabase, userData: string): void {
  importSideFile(database, join(userData, PROVIDER_USAGE_FILE), (said) => {
    const whole = objectIn(said)
    const rows = (kind: string, provider: Provider): Record<string, unknown>[] => {
      const listed = objectIn(whole[kind])[provider]
      return Array.isArray(listed) ? listed.map(objectIn) : []
    }
    const time = (value: unknown): value is number =>
      typeof value === 'number' && value > 0 && value <= MAX_INSTANT
    const tags = objectIn(whole['readOn'])
    replaceUsage(database, {
      readings: providerRecord((provider) =>
        rows('readings', provider).flatMap(({ window, usedPercent, resetsAt, at, account }) =>
          typeof window === 'string' && time(at)
            ? [
                {
                  window,
                  usedPercent: typeof usedPercent === 'number' ? usedPercent : null,
                  resetsAt: time(resetsAt) ? resetsAt : null,
                  at,
                  ...(typeof account === 'string' ? { account } : {}),
                },
              ]
            : [],
        ),
      ),
      seen: providerRecord((provider) =>
        rows('seen', provider).flatMap(({ window, first, last }) =>
          typeof window === 'string' && time(first) && time(last) ? [{ window, first, last }] : [],
        ),
      ),
      readOn: Object.fromEntries(
        SUPPORTED_PROVIDERS.flatMap((p) => (typeof tags[p] === 'string' ? [[p, tags[p]]] : [])),
      ),
    })
  })
}

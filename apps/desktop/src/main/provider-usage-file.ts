import { join } from 'node:path'
import { providerRecord, SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import { MAX_INSTANT } from '../shared/clock'
import type { ProviderUsageReading, UsageWindowSeen } from '../shared/runtime-ipc'
import type { AppDatabase } from './db/connection'
import { importSideFile, objectIn } from './db/side-file-import'
import { isRecordedAccountTag } from './providers/index'

/** Existing opaque identities plus legacy tags, which remain distinct from new namespaces. */
const opaqueTag = (tag: unknown): tag is string =>
  typeof tag === 'string' &&
  (isRecordedAccountTag(tag) ||
    /^(?:[0-9a-f]{32}|(?:credential|account):[0-9a-f]{64}|api-revision:[0-9]+)$/.test(tag))

/** The file older builds kept these readings in, imported once into the `provider_usage_*` tables. */
export const PROVIDER_USAGE_FILE = 'provider-usage.json'

/** Newest readings per connection/window, and provider-wide reported windows, across a restart. */
export interface KeptUsage {
  readonly readings: Readonly<Record<Provider, readonly KeptReading[]>>
  readonly seen: Readonly<Record<Provider, readonly UsageWindowSeen[]>>
  /** Legacy unknown-connection sign-in tags; never assigned to a recorded connection. */
  readonly readOn?: Readonly<Partial<Record<Provider, string>>>
  /** The sign-in tag each recorded connection's latest reading was read on. */
  readonly readOnConnections?: readonly {
    readonly provider: Provider
    readonly connectionId: string
    readonly tag: string
  }[]
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
    `SELECT provider, connection_id AS connectionId, "window", used_percent AS usedPercent, resets_at AS resetsAt, at, account
     FROM provider_usage_reading ORDER BY provider, position`,
  )
  const seen = database.prepare(
    'SELECT provider, "window", "first", "last" FROM provider_usage_window_seen ORDER BY provider, position',
  )
  const readOn = database.prepare(
    'SELECT provider, connection_id AS connectionId, tag FROM provider_usage_read_on ORDER BY provider, connection_id',
  )
  return {
    read() {
      const held = providerRecord((): KeptReading[] => [])
      for (const { provider, account, connectionId, ...row } of readings.all() as (Omit<
        KeptReading,
        'account' | 'connectionId'
      > & {
        provider: Provider
        account: string | null
        connectionId: string | null
      })[]) {
        held[provider].push({
          ...row,
          ...(account === null ? {} : { account }),
          ...(connectionId === null ? {} : { connectionId }),
        })
      }
      const windows = providerRecord((): UsageWindowSeen[] => [])
      for (const { provider, ...row } of seen.all() as (UsageWindowSeen & { provider: Provider })[])
        windows[provider].push(row)
      const tags = readOn.all() as {
        provider: Provider
        connectionId: string | null
        tag: string
      }[]
      const legacy = tags.filter((row) => row.connectionId === null)
      const scoped = tags.flatMap(({ provider, connectionId, tag }) =>
        connectionId === null ? [] : [{ provider, connectionId, tag }],
      )
      return {
        readings: held,
        seen: windows,
        ...(legacy.length === 0
          ? {}
          : { readOn: Object.fromEntries(legacy.map(({ provider, tag }) => [provider, tag])) }),
        ...(scoped.length === 0 ? {} : { readOnConnections: scoped }),
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
     (provider, connection_id, "window", position, used_percent, resets_at, at, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const seen = database.prepare(
    `INSERT OR IGNORE INTO provider_usage_window_seen (provider, "window", position, "first", "last")
     VALUES (?, ?, ?, ?, ?)`,
  )
  const readOn = database.prepare(
    'INSERT OR IGNORE INTO provider_usage_read_on (provider, connection_id, tag) VALUES (?, ?, ?)',
  )
  for (const provider of SUPPORTED_PROVIDERS) {
    usage.readings[provider].forEach((r, position) =>
      reading.run(
        provider,
        r.connectionId ?? null,
        r.window,
        position,
        r.usedPercent,
        r.resetsAt,
        r.at,
        r.account ?? null,
      ),
    )
    usage.seen[provider].forEach((w, position) =>
      seen.run(provider, w.window, position, w.first, w.last),
    )
    const tag = usage.readOn?.[provider]
    if (tag !== undefined) readOn.run(provider, null, tag)
  }
  for (const { provider, connectionId, tag } of usage.readOnConnections ?? [])
    readOn.run(provider, connectionId, tag)
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
                  ...(opaqueTag(account) ? { account } : {}),
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
        SUPPORTED_PROVIDERS.flatMap((p) => (opaqueTag(tags[p]) ? [[p, tags[p]]] : [])),
      ),
    })
  })
}

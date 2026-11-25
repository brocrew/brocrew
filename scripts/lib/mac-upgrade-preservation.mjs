import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCompressedCheckpoint, readDatabase } from './upgrade-database.mjs'
import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { recordedLineage, requireEvidence } from './upgrade-path.mjs'
import { liveProviderSessions } from './upgrade-session-preservation.mjs'
import { retainedFixtureTables } from './upgrade-retention.mjs'

export const USAGE_TABLES = [
  'provider_usage_reading',
  'provider_usage_window_seen',
  'provider_usage_read_on',
]

function rowsKept(before, after, table, ignored = []) {
  const withoutIgnored = (row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !ignored.includes(key)))
  const indexed = new Map(after.map((row) => [row.id, withoutIgnored(row)]))
  for (const row of before) {
    requireEvidence(indexed.has(row.id), `${table} lost row ${row.id}.`)
    requireEvidence(
      isDeepStrictEqual(withoutIgnored(row), indexed.get(row.id)),
      `${table} changed row ${row.id}.`,
    )
  }
}

export function dataPreserved(
  before,
  after,
  {
    allowAppended = false,
    usage = false,
    candidateLineage,
    retentionVersion = '',
    providerSessionEvidence,
  } = {},
) {
  const live =
    candidateLineage &&
    liveProviderSessions(
      { tables: before, lineage: recordedLineage(before.migrations) },
      { tables: after, lineage: recordedLineage(after.migrations) },
      candidateLineage,
    )
  const rawPrefixMatches = isDeepStrictEqual(
    before.migrations.map((row) => ({ ...row })),
    (live ? after.migrations.slice(0, before.migrations.length) : after.migrations).map((row) => ({
      ...row,
    })),
  )
  const rawTimestampsMatch = candidateLineage?.every(
    (entry, index) => after.migrations[index]?.created_at === entry.createdAt,
  )
  if (live && providerSessionEvidence !== undefined) {
    const receipt = { ...live.receipt, rawPrefixMatches, rawTimestampsMatch }
    writeFileSync(providerSessionEvidence, JSON.stringify(receipt, null, 2))
  }
  requireEvidence(
    rawPrefixMatches && (!live || (rawTimestampsMatch && live.receipt.matchesLineage)),
    'Migration records differ from the expected lineage.',
  )
  for (const table of ['provider_session', 'events']) {
    requireEvidence(
      Array.isArray(before[table]) && Array.isArray(after[table]) && before[table].length > 0,
      `No baseline evidence for ${table}.`,
    )
  }
  requireEvidence(
    before.provider_session.length >= 2,
    'Fixture must create at least two conversations.',
  )
  requireEvidence(
    before.provider_session.length === after.provider_session.length,
    'Conversation count changed.',
  )
  const defaults = live?.additions.provider_session
  const expected =
    defaults === undefined
      ? before.provider_session
      : before.provider_session.map((row) => ({ ...defaults, ...row }))
  rowsKept(expected, after.provider_session, 'provider_session', [
    'status',
    'updated_at',
    'closed_by_the_quit_at',
  ])
  const retained = retainedFixtureTables(before, after, retentionVersion)
  rowsKept(retained.tables.events, after.events, 'events')
  if (!allowAppended) {
    requireEvidence(
      retained.tables.events.length === after.events.length,
      'Unexpected new events rows before any resume.',
    )
  }
  if (usage)
    for (const table of USAGE_TABLES)
      requireEvidence(
        Array.isArray(before[table]) &&
          Array.isArray(after[table]) &&
          isDeepStrictEqual(before[table], after[table]),
        `${table} rows changed or are missing.`,
      )
  return Object.fromEntries(
    ['provider_session', 'events', ...(usage ? USAGE_TABLES : [])].map((name) => [
      name,
      {
        before: before[name].length,
        after: after[name].length,
        preserved: retained.tables[name].length,
        ...(name === 'events' && retained.removed.length ? { trimmed: retained.removed } : {}),
      },
    ]),
  )
}

export function requireOrdinaryMacFixture(snapshot, version) {
  if (version !== '0.2.27') return
  requireEvidence(
    snapshot.storage.free * 2 <= snapshot.storage.pages,
    'The signed updater ordinary fixture is compaction-eligible; use the generic matrix compaction case instead.',
  )
}

export function requireOrdinaryMacFile(file, version) {
  if (version !== '0.2.27') return
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    requireOrdinaryMacFixture(
      {
        storage: {
          pages: Number(db.prepare('PRAGMA page_count').get().page_count),
          free: Number(db.prepare('PRAGMA freelist_count').get().freelist_count),
        },
      },
      version,
    )
  } finally {
    db.close()
  }
}

// 695-own-main: gzip reads delegate to packaged Electron in Node-only mode, without an app window.
export async function macCheckpointSnapshot(folder, app, run, evidence) {
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
  let decoded
  if (manifest.database.compression === 'gzip') {
    const executable = (
      await run('/usr/bin/plutil', [
        '-extract',
        'CFBundleExecutable',
        'raw',
        '-o',
        '-',
        join(app, 'Contents', 'Info.plist'),
      ])
    ).trim()
    decoded = readCompressedCheckpoint(folder, manifest, {
      program: join(app, 'Contents', 'MacOS', executable),
      os: 'mac',
    })
    writeFileSync(
      join(evidence, 'b-checkpoint-reader.json'),
      JSON.stringify(decoded.reader, null, 2),
    )
  } else decoded = readDatabase(folder, 'database.sqlite')
  return { ...decoded.tables, migrations: decoded.tables.__drizzle_migrations }
}

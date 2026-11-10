import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { legacyConversation, legacyIdentity } from './fixtures/legacy-migration-data'

const migrations = fileURLToPath(new URL('../src/main/db/migrations', import.meta.url))
const directories: string[] = []
const databases: AppDatabase[] = []
const quote = (name: string) => `"${name}"`

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'provider-id-upgrade-'))
  directories.push(folder)
  const file = join(folder, 'fictional.sqlite')
  const db = openDatabase(file)
  databases.push(db)
  return { folder, file, db }
}

function through(folder: string, last: number): string {
  const target = join(folder, `through-${last}`)
  cpSync(migrations, target, { recursive: true })
  const file = join(target, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(file, 'utf8')) as { entries: { idx: number }[] }
  journal.entries = journal.entries.filter((entry) => entry.idx <= last)
  writeFileSync(file, JSON.stringify(journal))
  return target
}

function put(db: AppDatabase, table: string, row: Record<string, unknown>): void {
  const columns = Object.keys(row)
  db.prepare(
    `INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  ).run(...Object.values(row))
}

function exists(db: AppDatabase, table: string): boolean {
  return (
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', table) !==
    undefined
  )
}

function rows(db: AppDatabase, table: string, columns?: string[]): unknown[] {
  return db
    .prepare(
      `SELECT ${columns ? columns.map(quote).join(',') : '*'} FROM ${quote(table)} ORDER BY 1`,
    )
    .all()
}

const movedStateRows: Record<string, Record<string, unknown>> = {
  imported_side_file: { name: 'fictional-import.json' },
  archived_conversation: { conversation_id: 'cedar', archived_at: 108 },
  sign_in_change: { provider: 'codex', changed_at: 109 },
  provider_usage_reading: {
    provider: 'codex',
    window: 'weekly',
    position: 0,
    used_percent: 11,
    resets_at: null,
    at: 110,
    account: 'native-account:fictional/account-G7',
  },
  provider_usage_window_seen: {
    provider: 'codex',
    window: 'weekly',
    position: 0,
    first: 110,
    last: 110,
  },
  provider_usage_read_on: { provider: 'codex', tag: 'native-account:fictional/account-G7' },
  schedule_attempt: { conversation_id: 'cedar', record: '{"fictional":"schedule"}', at: 111 },
  cut_life: { conversation_id: 'cedar', record: '{"fictional":"life"}', since: 112 },
  cut_turn: { id: 'fictional-cut', record: '{"fictional":"cut"}', at: 113 },
  draft: { slot: 'fictional-slot', entry: '{"fictional":"draft"}' },
  profile_execution: { identity_id: 'fictional-identity', entry: '{"fictional":"execution"}' },
  profile_execution_state: { id: 1, services_off: 0 },
}

function plant(db: AppDatabase, last: number): void {
  if (last >= 28)
    for (const [table, row] of Object.entries(movedStateRows)) put(db, table, row)
  legacyConversation(db, {
    id: 'cedar',
    profileId: 'cedar-baker',
    provider: 'claude',
    cwd: '/fictional/bakery',
    approvalMode: 'ask',
  })
  legacyConversation(db, {
    id: 'birch',
    profileId: 'birch-gardener',
    provider: 'codex',
    cwd: '/fictional/garden',
    approvalMode: 'auto',
  })
  db.prepare(
    'UPDATE provider_session SET parent_session_id = ?, external_ref = ?, model = ?, reasoning_effort = ? WHERE id = ?',
  ).run(
    'cedar',
    '{"sessionId":"native-birch","cwd":"/fictional/garden"}',
    'fictional-model',
    'medium',
    'birch',
  )
  if (last >= 1)
    db.prepare(
      'UPDATE provider_session SET reported_model = ?, reported_effort = ? WHERE id = ?',
    ).run('reported-fictional', 'high', 'birch')
  if (last >= 21) {
    put(db, 'provider_connection', {
      id: 'fictional-gateway',
      provider: 'codex',
      name: 'Fictional gateway',
      auth_method: 'api-key',
      credential_source: 'provider-api-key',
    })
    db.prepare('UPDATE provider_session SET connection_id = ? WHERE id = ?').run(
      'fictional-gateway',
      'birch',
    )
  }
  put(db, 'turn', {
    id: 'turn-cedar',
    session_id: 'cedar',
    ordinal: 0,
    prompt: 'Bake a fictional loaf.',
    opened_at: 101,
  })
  put(db, 'events', {
    id: 'words',
    session_id: 'cedar',
    ordinal: 1,
    type: 'assistant_message',
    payload: '{"type":"assistant_message","text":"Fictional words."}',
    created_at: 102,
    turn_id: 'turn-cedar',
  })
  if (last === 0) {
    put(db, 'events', {
      id: 'fragment',
      session_id: 'cedar',
      ordinal: 0,
      type: 'unknown',
      payload: JSON.stringify({
        type: 'unknown',
        provider: 'claude',
        category: 'activity',
        raw: {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { partial_json: 'fragment' } },
        },
      }),
      created_at: 101,
    })
    put(db, 'raw_frame', {
      id: 'raw',
      session_id: 'cedar',
      ordinal: 0,
      format: 'fictional',
      frame: '{"fictional":true}',
      created_at: 102,
    })
  }
  put(db, 'derived_generation', {
    session_id: 'cedar',
    active: 0,
    normalizer_version: 1,
    derived_through: 20,
    highest: 0,
    updated_at: 103,
  })
  put(db, 'work', { id: 'root', number: 1, owner_session_id: 'cedar', created_at: 103 })
  put(db, 'work', {
    id: 'piece',
    parent_id: 'root',
    number: 1,
    owner_session_id: 'birch',
    given_by_session_id: 'cedar',
    title: 'Garden',
    brief: 'Plant a fictional tree.',
    created_at: 104,
  })
  put(db, 'work_resource', {
    id: 'resource',
    work_id: 'piece',
    role: 'input',
    name: 'fictional.txt',
    sha256: 'a'.repeat(64),
    bytes: 1,
    added_by_session_id: 'cedar',
    created_at: 104,
  })
  const identity = (
    db
      .prepare('SELECT agent_identity_id AS id FROM provider_session WHERE id = ?')
      .get('cedar') as { id: string }
  ).id
  put(db, 'identity_instruction', {
    id: 'instruction',
    identity_id: identity,
    version: 1,
    text: 'Fictional rules.',
    wrote_it: 'an-agents-proposal',
    by: '{"who":"a-person"}',
    conversation_id: 'cedar',
    said: 'A fictional proposal.',
    created_at: 104,
  })
  put(db, 'identity_memory_amendment', {
    id: 'removed',
    identity_id: identity,
    seq: 1,
    provider: 'claude',
    entry: 'fictional.md',
    act: 'removed',
    by: '{"who":"a-person"}',
    text_before: 'Fictional memory.',
    created_at: 105,
  })
  if (last >= 17)
    put(db, 'identity_memory_amendment', {
      id: 'restored',
      identity_id: identity,
      seq: 2,
      provider: 'claude',
      entry: 'fictional.md',
      act: 'restored',
      by: '{"who":"a-person"}',
      text_after: 'Fictional memory.',
      source_id: 'removed',
      created_at: 106,
    })
  if (last >= 18)
    put(db, 'identity_memory_amendment', {
      id: 'pending',
      identity_id: identity,
      seq: 3,
      provider: 'codex',
      entry: 'fictional.md',
      act: 'corrected',
      by: '{"who":"a-person"}',
      text_before: 'before',
      text_after: 'after',
      outcome: 'pending',
      created_at: 107,
    })
  if (exists(db, 'work_legacy_stall_cut'))
    put(db, 'work_legacy_stall_cut', { session_id: 'cedar', generation: 0, through_ordinal: 1 })
}

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close()
  for (const folder of directories.splice(0)) rmSync(folder, { recursive: true, force: true })
})

it.each([0, 17, 21, 28])('preserves populated rows and references when upgrading after %s', (last) => {
  const { folder, file, db } = fixture()
  applyMigrations(db, through(folder, last))
  plant(db, last)
  const tables = [
    'provider_session',
    'turn',
    'events',
    'derived_generation',
    'work',
    'work_resource',
    'identity_instruction',
    'identity_memory_amendment',
  ]
  if (last >= 21) tables.push('provider_connection', 'work_legacy_stall_cut')
  if (last >= 28) tables.push(...Object.keys(movedStateRows))
  const kept = tables.map((table) => ({
    table,
    columns: (db.pragma(`table_info(${quote(table)})`) as { name: string }[]).map(
      (column) => column.name,
    ),
    rows: rows(db, table),
  }))
  const triggers = db
    .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name")
    .all()
  applyMigrations(db, migrations)
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  expect(db.pragma('foreign_key_check')).toEqual([])
  for (const before of kept) {
    const expected =
      before.table === 'events' && last === 0
        ? (before.rows as Record<string, unknown>[])
            .filter((row) => row.id !== 'fragment')
            .map((row) => ({ ...row, ordinal: 0 }))
        : before.rows
    expect(rows(db, before.table, before.columns), before.table).toEqual(expected)
  }
  expect(exists(db, 'raw_frame')).toBe(false)
  // Later historical migrations may add triggers; each one already present must survive.
  const afterTriggers = db
    .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name")
    .all()
  expect(afterTriggers).toEqual(expect.arrayContaining(triggers))
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND (tbl_name='provider_session' OR tbl_name='identity_memory_amendment') AND sql IS NOT NULL",
      )
      .all(),
  ).toHaveLength(8)
  db.close()
  const reopened = openDatabase(file)
  databases.push(reopened)
  expect(rows(reopened, 'provider_session')).toMatchObject([
    { id: 'birch', profile_id: 'birch-gardener', parent_session_id: 'cedar' },
    { id: 'cedar', profile_id: 'cedar-baker', connection_id: null },
  ])
  applyMigrations(reopened, migrations)
  expect(reopened.pragma('foreign_key_check')).toEqual([])
})

it.each([
  [true, 21],
  [false, 21],
  [true, 28],
  [false, 28],
] as const)(
  'restores original foreign_keys=%s on success and failed upgrade after %s',
  (enabled, last) => {
    const { folder, db } = fixture()
    applyMigrations(db, through(folder, last))
    plant(db, last)
    db.pragma(enabled ? 'foreign_keys = ON' : 'foreign_keys = OFF')
    const before = rows(db, 'provider_session')
    const journal = rows(db, '__drizzle_migrations')
    const broken = through(folder, 29)
    const file = join(broken, '0029_open_provider_ids.sql')
    const sql = readFileSync(file, 'utf8')
    writeFileSync(
      file,
      sql.replace('DROP TABLE `provider_session`;', 'SELECT * FROM a_fictional_missing_table;'),
    )
    expect(() => applyMigrations(db, broken)).toThrow()
    expect(rows(db, 'provider_session')).toEqual(before)
    expect(rows(db, '__drizzle_migrations')).toEqual(journal)
    expect(exists(db, 'provider_session_next')).toBe(false)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(enabled ? 1 : 0)
    applyMigrations(db, migrations)
    expect(rows(db, 'provider_session')).toEqual(before)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(enabled ? 1 : 0)
  },
)

it('rolls back when the in-transaction foreign-key check finds an orphan', () => {
  const { folder, db } = fixture()
  applyMigrations(db, through(folder, 21))
  plant(db, 21)
  const before = rows(db, 'events')
  const journal = rows(db, '__drizzle_migrations')
  const broken = through(folder, 29)
  const file = join(broken, '0029_open_provider_ids.sql')
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(
      'CREATE TEMP TABLE `provider_migration_foreign_keys`',
      "UPDATE events SET session_id = 'fictional-orphan';\n--> statement-breakpoint\nCREATE TEMP TABLE `provider_migration_foreign_keys`",
    ),
  )
  expect(() => applyMigrations(db, broken)).toThrow()
  expect(rows(db, 'events')).toEqual(before)
  expect(rows(db, '__drizzle_migrations')).toEqual(journal)
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
})

it('fresh installs accept another provider while retaining non-provider checks and indexes', () => {
  const { db } = fixture()
  applyMigrations(db, migrations)
  put(db, 'provider_session', {
    id: 'other',
    provider: 'fictional',
    cwd: '/fictional/other',
    created_at: 1,
    updated_at: 1,
  })
  expect(() =>
    put(db, 'provider_session', {
      id: 'invalid',
      provider: 'fictional',
      cwd: '/fictional/other',
      status: 'fictional-status',
      created_at: 1,
      updated_at: 1,
    }),
  ).toThrow()
  legacyIdentity(db, 'fictional-scribe', 'claude')
  const identity = (
    db.prepare('SELECT id FROM agent_identity WHERE slug = ?').get('fictional-scribe') as {
      id: string
    }
  ).id
  const amendment = {
    id: 'fictional-amendment',
    identity_id: identity,
    seq: 1,
    provider: 'fictional',
    entry: 'fictional.md',
    act: 'corrected',
    by: '{"who":"a-person"}',
    text_before: 'before',
    text_after: 'after',
    outcome: 'pending',
    created_at: 1,
  }
  put(db, 'identity_memory_amendment', amendment)
  expect(() =>
    put(db, 'identity_memory_amendment', { ...amendment, id: 'bad-seq', seq: 0 }),
  ).toThrow()
  expect(() =>
    put(db, 'identity_memory_amendment', { ...amendment, id: 'duplicate', seq: 2 }),
  ).toThrow()
  put(db, 'turn', {
    id: 'other-turn',
    session_id: 'other',
    ordinal: 0,
    prompt: 'fictional',
    opened_at: 1,
  })
  db.prepare('DELETE FROM provider_session WHERE id = ?').run('other')
  expect(rows(db, 'turn')).toEqual([])
  expect(db.pragma('foreign_key_check')).toEqual([])
})

it('a failed fresh migration leaves no applied journal entries or partial application tables', () => {
  const { folder, db } = fixture()
  const broken = through(folder, 29)
  const file = join(broken, '0029_open_provider_ids.sql')
  writeFileSync(
    file,
    readFileSync(file, 'utf8') +
      '\n--> statement-breakpoint\nSELECT * FROM a_fictional_missing_table;',
  )
  expect(() => applyMigrations(db, broken)).toThrow()
  expect(rows(db, '__drizzle_migrations')).toEqual([])
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'",
      )
      .all(),
  ).toEqual([])
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
})

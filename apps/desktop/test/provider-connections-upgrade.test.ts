import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { usageKeptIn } from '../src/main/provider-usage-file'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string; when: number }[]
}
const released = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/provider-connections-releases.json'),
    'utf8',
  ),
) as {
  prefixes: Record<string, { count: number }>
  releases: { release: string; commit: string; prefix: string }[]
}
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function prefix(folder: string, count: number) {
  const old = join(folder, 'old')
  mkdirSync(join(old, 'meta'), { recursive: true })
  const entries = journal.entries.slice(0, count)
  writeFileSync(join(old, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries)
    copyFileSync(join(migrations, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`))
  return old
}
function rows(db: AppDatabase, table: string, columns: string[]) {
  return db.prepare(`SELECT ${columns.map((name) => `"${name}"`).join(', ')} FROM "${table}"`).all()
}

it.each([
  { label: 'landed resource-preservation migration', count: 33 },
  ...Array.from({ length: 21 }, (_, n) => ({ label: `migration prefix ${n + 1}`, count: n + 1 })),
  ...released.releases.map(({ release, prefix }) => ({
    label: release,
    count: released.prefixes[prefix]!.count,
  })),
])(
  'upgrades $label without changing agents, sign-in references or conversation history',
  ({ count }) => {
    const folder = mkdtempSync(join(tmpdir(), 'fictional-connections-upgrade-'))
    folders.push(folder)
    const db = openDatabase(join(folder, 'fictional.sqlite'))
    try {
      applyMigrations(db, prefix(folder, count))
      db.prepare(
        `INSERT INTO agent_identity (id,slug,provider,model_choice,created_at)
         VALUES ('aid:fern','fern','claude','{"provider":"claude","model":"haiku","effort":null}',1)`,
      ).run()
      db.prepare(
        `INSERT INTO provider_session (id,provider,external_ref,cwd,status,profile_id,created_at,updated_at)
         VALUES ('fictional-thread','claude','fictional-native-id','/fictional/original','idle','fern',1,2)`,
      ).run()
      db.prepare(
        `INSERT INTO events (id,session_id,ordinal,type,payload,created_at)
         VALUES ('fictional-event','fictional-thread',0,'user_turn','{"text":"Fictional history"}',1)`,
      ).run()
      if (count >= 4)
        db.prepare(
          `INSERT INTO provider_api_key (provider,sealed,updated_at) VALUES ('claude','fictional-sealed-reference',1)`,
        ).run()
      const tables = [
        'agent_identity',
        'provider_session',
        'events',
        ...(count >= 4 ? ['provider_api_key'] : []),
      ]
      const before = tables.map((table) => {
        const columns = (
          db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]
        ).map((column) => column.name)
        return { table, columns, values: rows(db, table, columns) }
      })
      applyMigrations(db, migrations)
      for (const saved of before) expect(rows(db, saved.table, saved.columns)).toEqual(saved.values)
      expect(db.prepare('SELECT connection_id FROM agent_identity').all()).toEqual([
        { connection_id: null },
      ])
      expect(db.prepare('SELECT connection_id FROM provider_session').all()).toEqual([
        { connection_id: null },
      ])
      expect(
        db
          .prepare(
            'SELECT provider, auth_method, credential_source, base_url FROM provider_connection ORDER BY id',
          )
          .all(),
      ).toEqual([
        {
          provider: 'claude',
          auth_method: 'api-key',
          credential_source: 'provider-api-key',
          base_url: null,
        },
        {
          provider: 'claude',
          auth_method: 'sign-in',
          credential_source: 'provider-sign-in',
          base_url: null,
        },
        {
          provider: 'codex',
          auth_method: 'api-key',
          credential_source: 'provider-api-key',
          base_url: null,
        },
        {
          provider: 'codex',
          auth_method: 'sign-in',
          credential_source: 'provider-sign-in',
          base_url: null,
        },
      ])
      const saved = db.prepare('SELECT * FROM provider_connection ORDER BY id').all()
      applyMigrations(db, migrations)
      expect(db.prepare('SELECT * FROM provider_connection ORDER BY id').all()).toEqual(saved)
    } finally {
      db.close()
    }
  },
)

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: usage storage upgrade retains legacy figures, tags, seen windows and the description migration`, () => {
    const folder = mkdtempSync(join(tmpdir(), 'fictional-scoped-usage-upgrade-'))
    folders.push(folder)
    const db = openDatabase(join(folder, 'fictional.sqlite'))
    try {
      applyMigrations(db, prefix(folder, 34))
      db.prepare(
        'INSERT INTO provider_usage_reading (provider,"window",position,used_percent,resets_at,at,account) VALUES (?, ?, 0, 42, 4000, 1000, ?)',
      ).run(provider, 'seven_day', 'a1'.repeat(16))
      db.prepare('INSERT INTO provider_usage_read_on (provider,tag) VALUES (?, ?)').run(
        provider,
        'b2'.repeat(16),
      )
      db.prepare(
        'INSERT INTO provider_usage_window_seen (provider,"window",position,"first","last") VALUES (?, ?, 0, 500, 1000)',
      ).run(provider, 'seven_day')
      db.prepare('UPDATE provider_connection SET name = ?, description = ? WHERE id = ?').run(
        'Fictional preserved name',
        'Fictional preserved description',
        `${provider}:sign-in`,
      )
      const connections = db.prepare('SELECT * FROM provider_connection ORDER BY id').all()
      applyMigrations(db, migrations)
      expect(db.prepare('SELECT * FROM provider_connection ORDER BY id').all()).toEqual(connections)
      expect(db.prepare('SELECT connection_id FROM provider_usage_reading').all()).toEqual([
        { connection_id: null },
      ])
      expect(db.prepare('SELECT connection_id FROM provider_usage_read_on').all()).toEqual([
        { connection_id: null },
      ])
      const restored = usageKeptIn(db).read()
      expect(restored.readings[provider]).toEqual([
        {
          window: 'seven_day',
          usedPercent: 42,
          resetsAt: 4000,
          at: 1000,
          account: 'a1'.repeat(16),
        },
      ])
      expect(restored.readings[provider][0]).not.toHaveProperty('connectionId')
      expect(restored.readOn).toEqual({ [provider]: 'b2'.repeat(16) })
      expect(restored).not.toHaveProperty('readOnConnections')
      expect(restored.seen[provider]).toEqual([{ window: 'seven_day', first: 500, last: 1000 }])
    } finally {
      db.close()
    }
  })
}

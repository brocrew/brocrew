import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'

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
  prefixes: Record<string, { count: number; sha256: string }>
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

it('binds the upgrade fixtures to the unchanged migration bytes of published releases', () => {
  for (const prefix of Object.values(released.prefixes)) {
    const entries = journal.entries.slice(0, prefix.count).map(({ tag, when }) => ({
      tag,
      when,
      sha256: createHash('sha256')
        .update(readFileSync(join(migrations, `${tag}.sql`)))
        .digest('hex'),
    }))
    expect(createHash('sha256').update(JSON.stringify(entries)).digest('hex')).toBe(prefix.sha256)
  }
  for (const release of released.releases) {
    expect(release.commit).toMatch(/^[a-f0-9]{40}$/)
    expect(released.prefixes[release.prefix]).toBeDefined()
  }
})

it.each([
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

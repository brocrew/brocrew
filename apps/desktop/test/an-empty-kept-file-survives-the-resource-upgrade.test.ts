import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const shaOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brocrew-empty-resource-upgrade-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('released 0031 resource rows survive empty-file persistence', () => {
  it.each([
    { foreignKeys: true, fail: false },
    { foreignKeys: false, fail: false },
    { foreignKeys: true, fail: true },
    { foreignKeys: false, fail: true },
  ])(
    'preserves raw rows with foreign keys $foreignKeys and rollback $fail',
    ({ foreignKeys, fail }) => {
      const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'))
      const entries = journal.entries.filter((one: { idx: number }) => one.idx <= 31)
      expect(entries).toHaveLength(32)
      const next = journal.entries[32]
      expect(next.idx).toBe(32)
      expect(next.when).toBeGreaterThan(entries[31].when)
      const prefix = join(root, 'released-0031')
      const target = join(root, 'resource-upgrade')
      for (const folder of [prefix, target]) {
        mkdirSync(join(folder, 'meta'), { recursive: true })
        for (const one of entries) {
          copyFileSync(join(migrationsFolder, one.tag + '.sql'), join(folder, one.tag + '.sql'))
        }
        writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
      }
      writeFileSync(
        join(target, next.tag + '.sql'),
        readFileSync(join(migrationsFolder, next.tag + '.sql'), 'utf8') +
          (fail
            ? '\n--> statement-breakpoint\nINSERT INTO fictional_missing_resource_upgrade VALUES (1);'
            : ''),
      )
      writeFileSync(
        join(target, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: [...entries, next] }),
      )
      const file = join(root, 'released-resources.sqlite')
      let saved = openDatabase(file)
      try {
        applyMigrations(saved, prefix)
        saved.exec(`
          INSERT INTO provider_session (id,provider,cwd,status,created_at,updated_at)
            VALUES ('sess_resource','claude','/fictional/resources','idle',101,102);
          INSERT INTO work (id,number,owner_session_id,created_at)
            VALUES ('work_resource_root',1,'sess_resource',103);
          INSERT INTO work (id,parent_id,number,owner_session_id,given_by_session_id,title,brief,created_at)
            VALUES ('work_resource_child','work_resource_root',1,'sess_resource','sess_resource','Café','raw\r\nbrief',104);
        `)
        const insert = saved.prepare(`INSERT INTO work_resource
          (id,work_id,role,title,summary,name,sha256,bytes,added_by_session_id,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
        insert.run(
          'res_input',
          'work_resource_root',
          'input',
          null,
          'raw\r\nsummary',
          'source.PRIVATE_EXTENSION',
          'a'.repeat(64),
          3,
          null,
          105,
        )
        insert.run(
          'res_made',
          'work_resource_child',
          'made',
          'Café 🟩',
          null,
          'answer.md',
          'b'.repeat(64),
          17,
          'sess_resource',
          106,
        )
        const emptyRow = [
          'res_zero',
          'work_resource_child',
          'made',
          null,
          null,
          'empty.bin',
          shaOf(Buffer.alloc(0)),
          0,
          null,
          107,
        ]
        expect(() => insert.run(...emptyRow)).toThrow('work_resource_bytes_ck')
        const schema = () =>
          saved
            .prepare(
              "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .all() as { type: string; name: string; tbl_name: string; sql: string }[]
        const tables = (
          saved
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' " +
                "AND name!='__drizzle_migrations' ORDER BY name",
            )
            .all() as { name: string }[]
        ).map((one) => one.name)
        const rows = () =>
          tables.map((table) => ({
            table,
            rows: saved.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
          }))
        const journalRows = () =>
          saved.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()
        const contracts = () => ({
          columns: saved.prepare('PRAGMA table_info(work_resource)').all(),
          keys: saved.prepare('PRAGMA foreign_key_list(work_resource)').all(),
          indexes: saved
            .prepare(
              "SELECT name,sql FROM sqlite_master WHERE type='index' " +
                "AND tbl_name='work_resource' ORDER BY name",
            )
            .all(),
        })
        const beforeRows = rows()
        const beforeSchema = schema()
        const beforeJournal = journalRows()
        const beforeContracts = contracts()
        saved.pragma(foreignKeys ? 'foreign_keys = ON' : 'foreign_keys = OFF')
        if (fail) {
          expect(() => applyMigrations(saved, target)).toThrow(/fictional_missing_resource_upgrade/)
          expect(schema()).toEqual(beforeSchema)
          expect(journalRows()).toEqual(beforeJournal)
          expect(() => insert.run(...emptyRow)).toThrow('work_resource_bytes_ck')
        } else {
          applyMigrations(saved, target)
          expect(contracts()).toEqual(beforeContracts)
          expect(schema().filter((one) => one.name !== 'work_resource')).toEqual(
            beforeSchema.filter((one) => one.name !== 'work_resource'),
          )
          const oldSql = beforeSchema.find((one) => one.name === 'work_resource')!.sql
          const newSql = schema().find((one) => one.name === 'work_resource')!.sql
          for (const check of oldSql.split('\n').filter((line) => line.includes('CONSTRAINT '))) {
            expect(newSql).toContain(
              check.trim().replace(/,$/, '').replace('"bytes" >= 1', '"bytes" >= 0'),
            )
          }
          expect(journalRows().slice(0, -1)).toEqual(beforeJournal)
          expect(journalRows()).toHaveLength(beforeJournal.length + 1)
        }
        expect(rows()).toEqual(beforeRows)
        expect(saved.pragma('foreign_keys', { simple: true })).toBe(foreignKeys ? 1 : 0)
        expect(saved.pragma('foreign_key_check')).toEqual([])
        if (!fail) {
          // A new statement follows the rebuilt table; the released prepared statement is not reused.
          saved
            .prepare(
              `INSERT INTO work_resource
            (id,work_id,role,name,sha256,bytes,created_at)
            VALUES ('res_zero','work_resource_child','made','empty.bin',?,0,107)`,
            )
            .run(shaOf(Buffer.alloc(0)))
          expect(
            saved.prepare("SELECT bytes,sha256 FROM work_resource WHERE id='res_zero'").get(),
          ).toEqual({ bytes: 0, sha256: shaOf(Buffer.alloc(0)) })
        }
        const finalRows = rows()
        const finalSchema = schema()
        const finalJournal = journalRows()
        applyMigrations(saved, fail ? prefix : target)
        expect(rows()).toEqual(finalRows)
        expect(schema()).toEqual(finalSchema)
        expect(journalRows()).toEqual(finalJournal)
        saved.close()
        saved = openDatabase(file)
        saved.pragma(foreignKeys ? 'foreign_keys = ON' : 'foreign_keys = OFF')
        applyMigrations(saved, fail ? prefix : target)
        expect(rows()).toEqual(finalRows)
        expect(schema()).toEqual(finalSchema)
        expect(journalRows()).toEqual(finalJournal)
        expect(saved.pragma('foreign_keys', { simple: true })).toBe(foreignKeys ? 1 : 0)
        expect(saved.pragma('foreign_key_check')).toEqual([])
        saved.pragma('foreign_keys = ON')
        expect(() =>
          saved.prepare("DELETE FROM work WHERE id='work_resource_child'").run(),
        ).toThrow(/FOREIGN KEY/)
        expect(() =>
          saved.prepare("UPDATE work_resource SET bytes=-1 WHERE id='res_made'").run(),
        ).toThrow('work_resource_bytes_ck')
        expect(() =>
          saved.prepare("UPDATE work_resource SET role='draft' WHERE id='res_made'").run(),
        ).toThrow('work_resource_role_ck')
        expect(() =>
          saved.prepare("UPDATE work_resource SET sha256='invalid' WHERE id='res_made'").run(),
        ).toThrow('work_resource_sha256_ck')
      } finally {
        saved.close()
      }
    },
  )
})

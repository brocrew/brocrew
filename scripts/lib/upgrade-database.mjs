import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { canonicalRow, recordedLineage, sha256 } from './upgrade-path.mjs'

/** What a copy of a data folder's database holds: integrity check, tables, keys, migrations. */
export function readDatabase(folder, file = 'brobot2.sqlite') {
  const copy = mkdtempSync(join(tmpdir(), 'upgrade-path-db-'))
  try {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (existsSync(join(folder, `${file}${suffix}`))) {
        copyFileSync(join(folder, `${file}${suffix}`), join(copy, `brobot2.sqlite${suffix}`))
      }
    }
    const db = new DatabaseSync(join(copy, 'brobot2.sqlite'), { readOnly: true })
    try {
      const integrity = db
        .prepare('PRAGMA integrity_check')
        .all()
        .map((row) => row.integrity_check)
      const names = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name)
      const quoted = (name) => `"${name.replace(/"/g, '""')}"`
      const tables = Object.fromEntries(
        names.map((name) => [name, db.prepare(`SELECT * FROM ${quoted(name)}`).all()]),
      )
      const keys = Object.fromEntries(
        names.map((name) => [
          name,
          db
            .prepare(`PRAGMA table_info(${quoted(name)})`)
            .all()
            .filter((column) => column.pk > 0)
            .sort((a, b) => a.pk - b.pk)
            .map((column) => column.name),
        ]),
      )
      const lineage = recordedLineage(
        db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all(),
      )
      return { integrity, tables, keys, lineage }
    } finally {
      db.close()
    }
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}
export const whole = (read) => read.integrity.length === 1 && read.integrity[0] === 'ok'
export const describeDatabase = (read) => ({
  integrity: read.integrity,
  schema: read.lineage.length,
  lineage: read.lineage,
  tables: Object.fromEntries(
    Object.entries(read.tables).map(([name, rows]) => [
      name,
      {
        rows: rows.length,
        sha256: sha256(
          rows
            .map((row) => canonicalRow(row))
            .sort()
            .join('\n'),
        ),
      },
    ]),
  ),
})

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
export const json = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

// F13's own objects. Everything else in the file is the app's authoritative data.
const DERIVED_TABLES = new Set(['question_copy', 'question_copy_progress'])
const DERIVED_TRIGGERS = new Set([
  'question_copy_insert',
  'question_copy_update',
  'question_copy_delete',
])
const SAMPLE = 20

const quote = (name) => `"${name.replaceAll('"', '""')}"`
const tableNames = (db, schema = 'main') =>
  db
    .prepare(
      `SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all()
    .map((row) => row.name)
const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${quote(table)})`).all()
// A cell as its storage type and raw bytes, so 5 and '5' never compare equal.
const cell = (column, alias = '') => {
  const c = `${alias}${quote(column)}`
  return `json_array(typeof(${c}), hex(CAST(${c} AS BLOB)))`
}
const rowCells = (columns, alias = '') =>
  `json_array(${columns.map((c) => cell(c.name, alias)).join(',')})`
const keyColumns = (columns) => columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk)

/** Read while an app has the file open, so wait out its writes. */
export function progress(file) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 })
  try {
    if (!tableNames(db).includes('question_copy_progress')) return null
    return db.prepare('SELECT * FROM question_copy_progress WHERE id=1').get() ?? null
  } finally {
    db.close()
  }
}

/** Copy a closed database with its sidecars into `directory` and describe the copy. */
export function snapshot(file, directory) {
  mkdirSync(directory, { recursive: true })
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    if (existsSync(file + suffix))
      copyFileSync(file + suffix, join(directory, 'brobot2.sqlite' + suffix))
  const copy = join(directory, 'brobot2.sqlite')
  const db = new DatabaseSync(copy, { readOnly: true })
  try {
    const tables = {}
    for (const table of tableNames(db)) {
      const columns = columnsOf(db, table)
      const key = keyColumns(columns)
      const order = key.length ? key.map((c) => quote(c.name)).join(',') : rowCells(columns)
      const hash = createHash('sha256')
      let count = 0
      for (const row of db
        .prepare(`SELECT ${rowCells(columns)} AS bytes FROM ${quote(table)} ORDER BY ${order}`)
        .iterate()) {
        hash.update(row.bytes + '\n')
        count++
      }
      tables[table] = { count, sha256: hash.digest('hex'), columns }
    }
    return {
      file: copy,
      bytes: statSync(copy).size,
      integrity: db
        .prepare('PRAGMA integrity_check')
        .all()
        .map((row) => row.integrity_check),
      foreignKeys: db.prepare('PRAGMA foreign_key_check').all(),
      schema: db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
        )
        .all(),
      migrations: db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all(),
      userVersion: db.prepare('PRAGMA user_version').get().user_version,
      tables,
      progress: tables.question_copy_progress
        ? db.prepare('SELECT * FROM question_copy_progress').all()
        : null,
    }
  } finally {
    db.close()
  }
}

/**
 * Every authoritative row of `before` is compared by its key, as storage types and bytes.
 * A removed or changed row is a difference; a new row is listed, not counted.
 */
export function compare(before, after) {
  const result = { before: before.file, after: after.file, differences: [], inserted: [] }
  const differ = (entry) => result.differences.push(entry)
  if (JSON.stringify(before.migrations) !== JSON.stringify(after.migrations))
    differ({
      kind: 'migration records changed',
      before: before.migrations,
      after: after.migrations,
    })
  if (before.userVersion !== after.userVersion)
    differ({ kind: 'user_version changed', before: before.userVersion, after: after.userVersion })
  const authoritative = (row) =>
    !DERIVED_TABLES.has(row.tbl_name) && !DERIVED_TRIGGERS.has(row.name)
  const ddlBefore = before.schema.filter(authoritative),
    ddlAfter = after.schema.filter(authoritative)
  if (JSON.stringify(ddlBefore) !== JSON.stringify(ddlAfter))
    differ({ kind: 'authoritative schema changed', before: ddlBefore, after: ddlAfter })
  for (const table of Object.keys(after.tables))
    if (!before.tables[table] && !DERIVED_TABLES.has(table)) differ({ kind: 'new table', table })

  const db = new DatabaseSync(after.file, { readOnly: true })
  try {
    db.prepare('ATTACH DATABASE ? AS prior').run(before.file)
    for (const [table, meta] of Object.entries(before.tables)) {
      if (DERIVED_TABLES.has(table)) continue
      const now = after.tables[table]
      if (!now) {
        differ({ kind: 'table removed', table })
        continue
      }
      if (JSON.stringify(meta.columns) !== JSON.stringify(now.columns)) {
        differ({ kind: 'columns changed', table })
        continue
      }
      const key = keyColumns(meta.columns)
      if (!key.length) {
        if (meta.count !== now.count || meta.sha256 !== now.sha256)
          differ({ kind: 'unkeyed table changed', table, before: meta.count, after: now.count })
        continue
      }
      const keyOf = (alias) => `json_array(${key.map((c) => cell(c.name, alias)).join(',')})`
      const on = key.map((c) => `p.${quote(c.name)} IS n.${quote(c.name)}`).join(' AND ')
      const changed = meta.columns
        .map((c) => `${cell(c.name, 'p.')} IS NOT ${cell(c.name, 'n.')}`)
        .join(' OR ')
      const first = quote(key[0].name)
      let removed = 0,
        modified = 0
      const samples = []
      for (const row of db
        .prepare(
          `SELECT ${keyOf('p.')} AS key, ${rowCells(meta.columns, 'p.')} AS before, ${rowCells(meta.columns, 'n.')} AS after, n.${first} IS NULL AS missing
           FROM prior.${quote(table)} p LEFT JOIN main.${quote(table)} n ON ${on}
           WHERE n.${first} IS NULL OR ${changed}`,
        )
        .iterate()) {
        if (row.missing) removed++
        else modified++
        if (samples.length < SAMPLE) {
          const old = JSON.parse(row.before),
            fresh = JSON.parse(row.after)
          samples.push({
            key: row.key,
            removed: Boolean(row.missing),
            fields: row.missing
              ? []
              : meta.columns
                  .filter((_, i) => JSON.stringify(old[i]) !== JSON.stringify(fresh[i]))
                  .map((c) => c.name),
          })
        }
      }
      if (removed || modified) differ({ kind: 'rows changed', table, removed, modified, samples })
      const added = db
        .prepare(
          `SELECT ${keyOf('n.')} AS key FROM main.${quote(table)} n LEFT JOIN prior.${quote(table)} p ON ${on} WHERE p.${first} IS NULL`,
        )
        .all()
      if (added.length)
        result.inserted.push({
          table,
          count: added.length,
          samples: added.slice(0, SAMPLE).map((row) => row.key),
        })
    }
    return result
  } finally {
    db.close()
  }
}

/** The derived copies hold exactly the ledger's keyed questions, and the key index finds them. */
export function copyParity(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const expected = `SELECT id AS event_id, CASE WHEN json_valid(payload) THEN json_extract(payload,'$.passedUpFrom') END AS passed_up_from, session_id FROM events WHERE type='question_asked' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.passedUpFrom') END IS NOT NULL`
    const cells = (alias) =>
      ['event_id', 'passed_up_from', 'session_id'].map((c) => cell(c, alias)).join(',')
    const left = `SELECT ${cells('e.')} FROM (${expected}) e`
    const right = `SELECT ${cells('q.')} FROM question_copy q`
    const missing = db.prepare(`SELECT count(*) AS n FROM (${left} EXCEPT ${right})`).get().n
    const extra = db.prepare(`SELECT count(*) AS n FROM (${right} EXCEPT ${left})`).get().n
    const copyRows = db.prepare('SELECT count(*) AS n FROM question_copy').get().n
    const keys = db
      .prepare(
        `SELECT DISTINCT passed_up_from AS key FROM (${expected}) WHERE typeof(passed_up_from)='text' ORDER BY passed_up_from`,
      )
      .all()
      .map((row) => row.key)
    keys.push('round-trip-absent-key')
    const lookups = []
    for (const key of keys) {
      const ledger = db
        .prepare(
          `SELECT DISTINCT session_id AS id FROM (${expected}) WHERE passed_up_from=? ORDER BY session_id`,
        )
        .all(key)
        .map((row) => row.id)
      const copies = db
        .prepare(
          `SELECT DISTINCT q.session_id AS id FROM question_copy q INDEXED BY question_copy_key_idx WHERE q.passed_up_from=? ORDER BY q.session_id`,
        )
        .all(key)
        .map((row) => row.id)
      lookups.push({
        key,
        ledger: ledger.length,
        copies: copies.length,
        same: JSON.stringify(ledger) === JSON.stringify(copies),
      })
    }
    return {
      copyRows,
      missing,
      extra,
      lookups: lookups.filter((row) => !row.same).slice(0, SAMPLE),
      lookupsChecked: lookups.length,
      ok: missing === 0 && extra === 0 && lookups.every((row) => row.same),
    }
  } finally {
    db.close()
  }
}

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const quote = (value) => `"${value.replaceAll('"', '""')}"`
export const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
export const json = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const derived = new Set(['question_copy', 'question_copy_progress'])
const tables = (db, schema = 'main') =>
  db
    .prepare(
      `SELECT name FROM ${schema}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all()
    .map((r) => r.name)
const columns = (db, table, schema = 'main') =>
  db.prepare(`PRAGMA ${schema}.table_info(${quote(table)})`).all()
const typed = (column, alias = '') => {
  const c = `${alias}${quote(column)}`
  return `json_array(typeof(${c}), hex(CAST(${c} AS BLOB)))`
}
const rowText = (cols, alias = '') =>
  `json_array(${cols.map((c) => typed(c.name, alias)).join(',')})`

export function progress(file) {
  if (!existsSync(file)) return null
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    if (!tables(db).includes('question_copy_progress')) return null
    return db.prepare('SELECT * FROM question_copy_progress WHERE id=1').get() ?? null
  } finally {
    db.close()
  }
}

export function read(file, sql, ...params) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return db.prepare(sql).all(...params)
  } finally {
    db.close()
  }
}

export function closedSnapshot(file, directory) {
  mkdirSync(directory)
  const sidecars = ['', '-wal', '-shm', '-journal'].map((suffix) => {
    const source = file + suffix,
      present = existsSync(source)
    if (present) copyFileSync(source, join(directory, 'brobot2.sqlite' + suffix))
    return { suffix, present, bytes: present ? statSync(source).size : 0 }
  })
  const copied = join(directory, 'brobot2.sqlite')
  const db = new DatabaseSync(copied, { readOnly: true })
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all()
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
    assert(
      integrity.length === 1 && integrity[0].integrity_check === 'ok',
      'Closed copy integrity failure',
    )
    assert(foreignKeys.length === 0, 'Closed copy foreign key failure')
    const manifest = {}
    for (const table of tables(db)) {
      const cols = columns(db, table)
      const pk = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk)
      const hash = createHash('sha256')
      let count = 0
      for (const row of db
        .prepare(
          `SELECT ${rowText(cols)} AS bytes FROM ${quote(table)} ORDER BY ${pk.length ? pk.map((c) => quote(c.name)).join(',') : rowText(cols)}`,
        )
        .iterate()) {
        hash.update(row.bytes + '\n')
        count++
      }
      manifest[table] = { count, sha256: hash.digest('hex'), columns: cols }
    }
    const schema = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all()
    const migrations = db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all()
    const result = {
      file: copied,
      sidecars,
      integrity,
      foreignKeys,
      schema,
      migrations,
      tables: manifest,
      userVersion: db.prepare('PRAGMA user_version').get(),
      applicationId: db.prepare('PRAGMA application_id').get(),
      progress: manifest.question_copy_progress
        ? db.prepare('SELECT * FROM question_copy_progress').all()
        : [],
    }
    json(join(directory, 'snapshot.json'), result)
    return result
  } finally {
    db.close()
  }
}

// Every historical row is compared as storage types and raw bytes. Exceptions name exact keys
// and columns in the reviewed run manifest, rather than exempting a table as startup noise.
export function compare(before, after, allowances = []) {
  const db = new DatabaseSync(after.file, { readOnly: true })
  const result = { before: before.file, after: after.file, differences: [], total: 0, allowances }
  const note = (value) => {
    result.total++
    if (result.differences.length < 100) result.differences.push(value)
  }
  try {
    db.prepare('ATTACH DATABASE ? AS prior').run(before.file)
    assert(
      JSON.stringify(before.migrations) === JSON.stringify(after.migrations),
      'Migration records changed',
    )
    assert(
      JSON.stringify(before.userVersion) === JSON.stringify(after.userVersion),
      'user_version changed',
    )
    assert(
      JSON.stringify(before.applicationId) === JSON.stringify(after.applicationId),
      'application_id changed',
    )
    for (const [table, meta] of Object.entries(before.tables)) {
      if (derived.has(table)) continue
      if (!after.tables[table]) {
        note({ table, kind: 'missing-table' })
        continue
      }
      const cols = meta.columns
      assert(
        JSON.stringify(cols) === JSON.stringify(after.tables[table].columns),
        `Authoritative schema changed: ${table}`,
      )
      const pk = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk)
      // Tables without a declared key are immutable multisets, including duplicate counts.
      if (!pk.length) {
        if (meta.count !== after.tables[table].count || meta.sha256 !== after.tables[table].sha256)
          note({ table, kind: 'unkeyed-table-change' })
        continue
      }
      const key = (alias) => `json_array(${pk.map((c) => typed(c.name, alias)).join(',')})`
      const on = pk.map((c) => `p.${quote(c.name)} IS n.${quote(c.name)}`).join(' AND ')
      const changed = cols
        .map((c) => `${typed(c.name, 'p.')} IS NOT ${typed(c.name, 'n.')}`)
        .join(' OR ')
      for (const row of db
        .prepare(
          `SELECT ${key('p.')} AS key, ${rowText(cols, 'p.')} AS before, ${rowText(cols, 'n.')} AS after, n.${quote(pk[0].name)} IS NULL AS missing FROM prior.${quote(table)} p LEFT JOIN main.${quote(table)} n ON ${on} WHERE n.${quote(pk[0].name)} IS NULL OR ${changed}`,
        )
        .iterate()) {
        const rule = allowances.find((a) => a.table === table && a.key === row.key)
        const oldCells = JSON.parse(row.before),
          newCells = JSON.parse(row.after)
        const fields = cols
          .filter((_, i) => JSON.stringify(oldCells[i]) !== JSON.stringify(newCells[i]))
          .map((c) => c.name)
        if (
          row.missing ||
          table === 'events' ||
          !rule ||
          !fields.every((c) => rule.columns.includes(c))
        )
          note({ table, ...row, fields })
      }
      // Insert permissions are also explicit. Dynamic journey rows are listed by exact key by
      // the app adapter, with their owning session checked before an allowance is issued.
      for (const row of db
        .prepare(
          `SELECT ${key('n.')} AS key FROM main.${quote(table)} n LEFT JOIN prior.${quote(table)} p ON ${on} WHERE p.${quote(pk[0].name)} IS NULL`,
        )
        .iterate()) {
        if (!allowances.some((a) => a.table === table && a.key === row.key && a.insert === true))
          note({ table, kind: 'unapproved-insert', key: row.key })
      }
    }
    for (const table of Object.keys(after.tables))
      if (!before.tables[table] && !derived.has(table))
        note({ table, kind: 'new-authoritative-table' })
    const sourceObject = (r) =>
      !derived.has(r.tbl_name) &&
      !['question_copy_insert', 'question_copy_update', 'question_copy_delete'].includes(r.name)
    const oldSchema = before.schema.filter(sourceObject)
    const newSchema = after.schema.filter(sourceObject)
    if (JSON.stringify(oldSchema) !== JSON.stringify(newSchema))
      note({ kind: 'authoritative-ddl-change', before: oldSchema, after: newSchema })
    return result
  } finally {
    db.close()
  }
}

export function copyParity(file) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const expected = `SELECT id AS event_id, CASE WHEN json_valid(payload) THEN json_extract(payload,'$.passedUpFrom') END AS passed_up_from, session_id FROM events WHERE type='question_asked' AND CASE WHEN json_valid(payload) THEN json_extract(payload,'$.passedUpFrom') END IS NOT NULL`
    const cells = (prefix) =>
      ['event_id', 'passed_up_from', 'session_id'].map((c) => typed(c, prefix)).join(',')
    const left = `SELECT ${cells('e.')} FROM (${expected}) e`
    const right = `SELECT ${cells('q.')} FROM question_copy q`
    const missing = db.prepare(`SELECT * FROM (${left} EXCEPT ${right})`).all()
    const extra = db.prepare(`SELECT * FROM (${right} EXCEPT ${left})`).all()
    const count = db
      .prepare('SELECT count(*) AS n, count(DISTINCT event_id) AS unique_ids FROM question_copy')
      .get()
    const keyComparisons = []
    const keys = db
      .prepare(
        `SELECT DISTINCT passed_up_from AS key, typeof(passed_up_from) AS storage FROM (${expected}) WHERE typeof(passed_up_from)='text' ORDER BY passed_up_from`,
      )
      .all()
    keys.push(
      { key: 'round-trip-absent', storage: 'text' },
      { key: 5, storage: 'integer' },
      { key: '5', storage: 'text' },
    )
    for (const { key, storage } of keys) {
      const bound = storage === 'integer' ? BigInt(key) : key
      assert(
        db.prepare('SELECT typeof(?) AS storage').get(bound).storage === storage,
        'Oracle parameter storage type mismatch',
      )
      const ledger = db
        .prepare(
          `SELECT DISTINCT session_id AS id FROM (${expected}) WHERE passed_up_from=? ORDER BY session_id`,
        )
        .all(bound)
        .map((r) => r.id)
      const copies = db
        .prepare(
          `SELECT DISTINCT e.session_id AS id FROM question_copy q INDEXED BY question_copy_key_idx JOIN events e ON e.id=q.event_id WHERE q.passed_up_from=? AND e.type='question_asked' AND CASE WHEN json_valid(e.payload) THEN json_extract(e.payload,'$.passedUpFrom') END=? ORDER BY e.session_id`,
        )
        .all(bound, bound)
        .map((r) => r.id)
      keyComparisons.push({ key, storage, ledger, copies })
    }
    return {
      expectedSql: expected,
      missing,
      extra,
      count,
      keyComparisons,
      ok:
        missing.length === 0 &&
        extra.length === 0 &&
        count.n === count.unique_ids &&
        keyComparisons.every((r) => JSON.stringify(r.ledger) === JSON.stringify(r.copies)),
    }
  } finally {
    db.close()
  }
}

export function typedKey(db, table, where, params) {
  const pk = columns(db, table)
    .filter((c) => c.pk)
    .sort((a, b) => a.pk - b.pk)
  assert(pk.length > 0, `No key in ${table}`)
  return db
    .prepare(
      `SELECT json_array(${pk.map((c) => typed(c.name)).join(',')}) AS key FROM ${quote(table)} WHERE ${where}`,
    )
    .all(...params)
    .map((r) => r.key)
}

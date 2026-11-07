// Fills a closed workspace that the old app created with a large synthetic ledger:
// 1000 ended conversations, 700 fold rows each in four generations, one unrelated row each.
import { statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { assert } from './storage-round-trip-db.mjs'

const SESSIONS = 1000
const GENERATIONS = 4
const PER_GENERATION = 175
const AT = 1700000000000
const TEXT = 'Synthetic question café ☕ 日本語'

// Columns the old schema requires that this seed does not set would make its rows unlike the app's.
function requireCovered(db, table, given) {
  const missing = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .filter((c) => c.notnull && c.dflt_value === null && !c.pk && !given.includes(c.name))
    .map((c) => c.name)
  assert(missing.length === 0, `Seed does not set required ${table} columns: ${missing.join(', ')}`)
}

export function seed(file, cwd) {
  const db = new DatabaseSync(file)
  let open = false
  try {
    db.exec('PRAGMA foreign_keys = ON')
    assert(
      !db.prepare("SELECT 1 FROM sqlite_master WHERE name='question_copy'").get(),
      'The old workspace already has F13 tables',
    )
    const sessionColumns = ['id', 'provider', 'cwd', 'status', 'created_at', 'updated_at']
    const eventColumns = [
      'id',
      'session_id',
      'generation',
      'ordinal',
      'type',
      'payload',
      'created_at',
    ]
    requireCovered(db, 'provider_session', sessionColumns)
    requireCovered(db, 'events', eventColumns)
    const before = db.prepare('SELECT count(*) AS n FROM events').get().n
    const addSession = db.prepare(
      `INSERT INTO provider_session (${sessionColumns.join(',')}) VALUES (?,?,?,?,?,?)`,
    )
    const addEvent = db.prepare(
      `INSERT INTO events (${eventColumns.join(',')}) VALUES (?,?,?,?,?,?,?)`,
    )
    let payloadBytes = 0
    const append = (session, generation, ordinal, payload, id) => {
      const text = JSON.stringify({ ...payload, padding: 'x'.repeat(1024) })
      payloadBytes += Buffer.byteLength(text)
      addEvent.run(id, session, generation, ordinal, payload.type, text, AT)
    }
    db.exec('BEGIN')
    open = true
    for (let s = 0; s < SESSIONS; s++) {
      const n = String(s).padStart(4, '0')
      const session = `round-trip-seed-${n}`
      addSession.run(session, 'codex', cwd, 'ended', AT, AT)
      for (let generation = 0; generation < GENERATIONS; generation++)
        for (let ordinal = 0; ordinal < PER_GENERATION; ordinal++) {
          const slot = generation * PER_GENERATION + ordinal
          // A tenth are passed-up questions (copied), a tenth plain questions (not copied).
          const payload =
            slot % 10 === 0
              ? {
                  type: 'question_asked',
                  requestId: `req_seed_${s}_${slot}`,
                  prompt: TEXT,
                  questions: [],
                  passedUpFrom: `fixture-key-${(s + slot) % 31}`,
                }
              : slot % 10 === 5
                ? {
                    type: 'question_asked',
                    requestId: `req_plain_${s}_${slot}`,
                    prompt: TEXT,
                    questions: [],
                  }
                : { type: 'status', state: 'ended' }
          append(
            session,
            generation,
            ordinal,
            payload,
            `round-trip-seed-${n}-${generation}-${slot}`,
          )
        }
      append(
        session,
        0,
        1000,
        { type: 'assistant_message', text: 'Unrelated synthetic café ☕ 日本語' },
        `round-trip-other-${n}`,
      )
    }
    db.exec('COMMIT')
    open = false
    const count = (where) =>
      db
        .prepare(`SELECT count(*) AS n FROM events WHERE id LIKE 'round-trip-seed-%' ${where}`)
        .get().n
    const result = {
      sessions: SESSIONS,
      foldRows: count(''),
      keyedQuestions: count(
        "AND type='question_asked' AND json_extract(payload,'$.passedUpFrom') IS NOT NULL",
      ),
      plainQuestions: count(
        "AND type='question_asked' AND json_extract(payload,'$.passedUpFrom') IS NULL",
      ),
      eventsBefore: before,
      eventsAfter: db.prepare('SELECT count(*) AS n FROM events').get().n,
      payloadBytes,
      foreignKeyProblems: db.prepare('PRAGMA foreign_key_check').all().length,
      sqlite: db.prepare('SELECT sqlite_version() AS v').get().v,
    }
    assert(
      result.foldRows === SESSIONS * GENERATIONS * PER_GENERATION &&
        result.keyedQuestions === SESSIONS * 70 &&
        result.plainQuestions === SESSIONS * 70 &&
        result.foreignKeyProblems === 0,
      `Seed came out wrong: ${JSON.stringify(result)}`,
    )
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    result.databaseBytes = statSync(file).size
    return result
  } finally {
    if (open) db.exec('ROLLBACK')
    db.close()
  }
}

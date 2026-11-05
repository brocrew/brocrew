import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { committedChangesOf, type Committed } from '../src/main/db/committed-changes'
import { howTheDatabaseFits } from '../src/main/db/newer-database'
import { buildLineage } from '../src/main/recovery/database-facts'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * The conversations holding a passed-up copy of a question are found by the copy's key: a derived
 * table its triggers keep current, filled for older rows in bounded slices, read only once full,
 * and checked against the ledger row itself. Until then, and whenever its index is missing, the
 * exact query over the ledger answers.
 */
describe('question copies are kept by triggers and filled in slices', () => {
  let folder: string
  let file: string
  let db: AppDatabase
  let store: SessionStore
  let ordinal = 0

  const open = () => {
    db = openDatabase(file)
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  }
  const reopen = () => {
    db.close()
    open()
  }
  const conversation = (id: string) =>
    store.create({
      id,
      provider: 'codex',
      cwd: folder,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
  const row = (session: string, payload: string, type = 'question_asked', generation = 0) => {
    const id = `evt_${String(ordinal)}`
    db.prepare(
      'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, session, generation, ordinal, type, payload, 1000 + ordinal)
    ordinal++
    return id
  }
  const question = (session: string, passedUpFrom: unknown, generation = 0) =>
    row(
      session,
      JSON.stringify({ type: 'question_asked', requestId: `q${String(ordinal)}`, passedUpFrom }),
      'question_asked',
      generation,
    )
  const fillToTheEnd = () => {
    for (let slice = 0; slice < 10_000; slice++) {
      const filled = store.fillQuestionCopies(200, 256 * 1024)
      if (filled.state !== 'filled') return filled
    }
    throw new Error('the copies never finished filling')
  }
  const progress = () =>
    db.prepare('SELECT done FROM question_copy_progress WHERE id = 1').get() as { done: number }
  const exists = (type: string, name: string) =>
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !==
    undefined

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'fictional-question-copies-'))
    file = join(folder, 'fictional.sqlite')
    ordinal = 0
    open()
    for (const id of ['alpha', 'beta', 'gamma']) conversation(id)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('opening creates the derived table, its index and its triggers, not yet full', () => {
    expect(exists('table', 'question_copy')).toBe(true)
    expect(exists('table', 'question_copy_progress')).toBe(true)
    expect(exists('index', 'question_copy_key_idx')).toBe(true)
    for (const name of ['question_copy_insert', 'question_copy_delete', 'question_copy_update'])
      expect(exists('trigger', name)).toBe(true)
    expect(progress().done).toBe(0)
  })

  it('answers the same ordered conversations before and after the copies are full', () => {
    question('gamma', 'first')
    question('alpha', 'first')
    question('beta', 'second')
    question('alpha', 'first', 1)
    row('beta', '{not json')
    question('beta', null)
    question('gamma', 5)
    const keys = ['first', 'second', '5', 'none']
    const before = keys.map((key) => store.conversationsHoldingACopyOf(key))
    expect(before[0]).toEqual(['alpha', 'gamma'])
    expect(fillToTheEnd().state).toBe('done')
    expect(progress().done).toBe(1)
    expect(keys.map((key) => store.conversationsHoldingACopyOf(key))).toEqual(before)
  })

  it('until the fill is done, rows older than the copies are still found, by the ledger query', () => {
    question('alpha', 'first')
    question('beta', 'first')
    // As rows written before the triggers existed: in the ledger, with no copy yet.
    db.exec('DELETE FROM question_copy')
    expect(store.conversationsHoldingACopyOf('first')).toEqual(['alpha', 'beta'])
    fillToTheEnd()
    expect(store.conversationsHoldingACopyOf('first')).toEqual(['alpha', 'beta'])
  })

  it('a torn or keyless question is written and has no copy', () => {
    const torn = row('alpha', '{not json')
    const keyless = question('alpha', undefined)
    const rows = db.prepare('SELECT event_id FROM question_copy').all() as { event_id: string }[]
    expect(rows.map((one) => one.event_id)).not.toContain(torn)
    expect(rows.map((one) => one.event_id)).not.toContain(keyless)
  })

  it('a numeric key matches only as the ledger query matches it', () => {
    question('alpha', 5)
    fillToTheEnd()
    expect(store.conversationsHoldingACopyOf('5')).toEqual([])
    // The copy keeps the key's own type, as the ledger's JSON holds it.
    expect(db.prepare('SELECT typeof(passed_up_from) AS type FROM question_copy').get()).toEqual({
      type: 'integer',
    })
  })

  it('the triggers keep the copies current through updates, deletes and a discarded generation', () => {
    const moved = question('alpha', 'first')
    question('beta', 'first', 1)
    fillToTheEnd()
    db.prepare(
      "UPDATE events SET payload = json_set(payload, '$.passedUpFrom', 'other') WHERE id = ?",
    ).run(moved)
    expect(store.conversationsHoldingACopyOf('first')).toEqual(['beta'])
    expect(store.conversationsHoldingACopyOf('other')).toEqual(['alpha'])
    store.discardGeneration('beta', 1, 100)
    expect(store.conversationsHoldingACopyOf('first')).toEqual([])
    db.prepare('DELETE FROM events WHERE id = ?').run(moved)
    expect(store.conversationsHoldingACopyOf('other')).toEqual([])
  })

  it('a copy left stale while a trigger was missing is repaired at the next open', () => {
    const moved = question('alpha', 'A')
    fillToTheEnd()
    db.exec('DROP TRIGGER question_copy_update')
    db.prepare(
      "UPDATE events SET payload = json_set(payload, '$.passedUpFrom', 'B') WHERE id = ?",
    ).run(moved)
    reopen()
    expect(exists('trigger', 'question_copy_update')).toBe(true)
    expect(progress().done).toBe(0)
    fillToTheEnd()
    expect(store.conversationsHoldingACopyOf('B')).toEqual(['alpha'])
    expect(store.conversationsHoldingACopyOf('A')).toEqual([])
  })

  it('a missing index over a filled table is not rebuilt: the ledger query answers', () => {
    question('alpha', 'first')
    fillToTheEnd()
    db.exec('DROP INDEX question_copy_key_idx')
    reopen()
    expect(exists('index', 'question_copy_key_idx')).toBe(false)
    expect(progress().done).toBe(0)
    expect(store.fillQuestionCopies(200, 256 * 1024).state).toBe('unindexed')
    expect(store.conversationsHoldingACopyOf('first')).toEqual(['alpha'])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('question_copy_key_idx'))
  })

  it('a slice visits no more rows than its bound, however few of them are questions', () => {
    for (let i = 0; i < 300; i++) row('alpha', '{"type":"status","state":"idle"}', 'status')
    question('alpha', 'first')
    const slice = store.fillQuestionCopies(50, 256 * 1024)
    expect(slice).toMatchObject({ state: 'filled', visited: 50, matched: 0 })
  })

  it('a slice stops at its byte bound, counted in bytes and not characters', () => {
    const wide = '😀'.repeat(20_000) // 80,000 bytes, 40,000 code units, 20,000 characters
    for (let i = 0; i < 10; i++)
      row(
        'alpha',
        JSON.stringify({
          type: 'question_asked',
          requestId: `w${String(i)}`,
          passedUpFrom: 'x',
          wide,
        }),
      )
    const slice = store.fillQuestionCopies(200, 256 * 1024)
    expect(slice.state).toBe('filled')
    // 256 KiB is passed by the fourth row of about 80 KB, and by no more.
    expect(slice.visited).toBe(4)
  })

  it('a slice reads ledger rows one at a time, and reads none past its byte bound', () => {
    const wide = '😀'.repeat(20_000)
    for (let i = 0; i < 10; i++)
      row(
        'alpha',
        JSON.stringify({
          type: 'question_asked',
          requestId: `w${String(i)}`,
          passedUpFrom: 'x',
          wide,
        }),
      )
    // Count the walk's rows as SQLite hands them over, however they are asked for.
    let read = 0
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql)
      if (!sql.includes('INDEXED BY events_fold_idx')) return statement
      return new Proxy(statement, {
        get(native, name) {
          if (name === 'all')
            return (...args: unknown[]) => {
              const rows = native.all(...args)
              read += rows.length
              return rows
            }
          if (name === 'iterate')
            return function* (...args: unknown[]) {
              for (const one of native.iterate(...args)) {
                read++
                yield one
              }
            }
          const value: unknown = Reflect.get(native, name, native)
          return typeof value === 'function' ? value.bind(native) : value
        },
      })
    })
    const slice = store.fillQuestionCopies(200, 256 * 1024)
    expect(slice.visited).toBe(4)
    expect(read).toBe(4)
  })

  it('a row bound that is not a whole number still makes a slice', () => {
    question('alpha', 'first')
    expect(store.fillQuestionCopies(62.5, 256 * 1024).state).toBe('filled')
  })

  it('a slice that cannot take the write lock at once is skipped', () => {
    question('alpha', 'first')
    const other = openDatabase(file)
    try {
      other.exec('BEGIN IMMEDIATE')
      const began = performance.now()
      expect(store.fillQuestionCopies(200, 256 * 1024).state).toBe('busy')
      expect(performance.now() - began).toBeLessThan(500)
      other.exec('ROLLBACK')
    } finally {
      other.close()
    }
  })

  it('the commit record names the copy table for a ledger write, and a slice moves nothing shown', () => {
    const heard: Committed[] = []
    const stop = committedChangesOf(db).listen((change) => heard.push(change))
    try {
      row('alpha', '{"type":"assistant_message","text":"x"}', 'assistant_message')
      const written = heard.at(-1)
      if (written === undefined || written.resync) throw new Error('no change heard')
      expect(written.tables.has('question_copy')).toBe(true)
      expect(written.visibleTables.has('question_copy')).toBe(false)
      heard.length = 0
      question('alpha', 'first')
      heard.length = 0
      store.fillQuestionCopies(200, 256 * 1024)
      const slice = heard.at(-1)
      if (slice === undefined || slice.resync) throw new Error('no slice heard')
      expect(slice.tables.has('question_copy')).toBe(true)
      expect(slice.tables.has('question_copy_progress')).toBe(true)
      expect([...slice.visibleTables]).toEqual([])
    } finally {
      stop()
    }
  })

  it('deleting a conversation records the copies its cascade removed', () => {
    question('gamma', 'first')
    const heard: Committed[] = []
    const stop = committedChangesOf(db).listen((change) => heard.push(change))
    try {
      db.prepare('DELETE FROM provider_session WHERE id = ?').run('gamma')
      const deleted = heard.at(-1)
      if (deleted === undefined || deleted.resync) throw new Error('no change heard')
      expect(db.prepare('SELECT count(*) AS n FROM question_copy').get()).toEqual({ n: 0 })
      expect(deleted.tables.has('question_copy')).toBe(true)
      expect(deleted.visibleTables.has('question_copy')).toBe(false)
      // An update of a conversation removes no copy, and says none.
      heard.length = 0
      db.prepare('UPDATE provider_session SET cwd = ? WHERE id = ?').run('/tmp/elsewhere', 'alpha')
      const updated = heard.at(-1)
      if (updated === undefined || updated.resync) throw new Error('no update heard')
      expect(updated.tables.has('question_copy')).toBe(false)
    } finally {
      stop()
    }
  })

  it('a build without this setup still opens the file, and its writes keep the copies full', async () => {
    question('alpha', 'first')
    fillToTheEnd()
    // The journal is unchanged, so a build that predates these tables fits the file.
    expect(howTheDatabaseFits(db, await buildLineage(migrations))).toEqual({ kind: 'fits' })
    // A writer that never ran this build's setup: the triggers in the file still keep the copy.
    const older = openDatabase(file)
    try {
      older
        .prepare(
          'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
        )
        .run(
          'evt_older',
          'beta',
          9000,
          'question_asked',
          JSON.stringify({ passedUpFrom: 'first' }),
          1,
        )
    } finally {
      older.close()
    }
    reopen()
    expect(progress().done).toBe(1)
    expect(store.conversationsHoldingACopyOf('first')).toEqual(['alpha', 'beta'])
  })
})

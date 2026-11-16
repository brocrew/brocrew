import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import {
  committedChangesOf,
  type Committed,
  type CommittedWrite,
} from '../src/main/db/committed-changes'
import { MainThreadWork, timedMethods } from '../src/main/stall-watch'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let db: AppDatabase
let seen: { write: CommittedWrite; tables: string[]; inTransaction: boolean }[]
beforeEach(() => {
  db = openDatabase(':memory:')
  db.exec('CREATE TABLE metrics_fixture (id INTEGER PRIMARY KEY, value TEXT)')
  seen = []
  committedChangesOf(db).listen((change) => {
    if (!change.resync && change.write)
      seen.push({
        write: change.write,
        tables: [...change.tables],
        inTransaction: db.inTransaction,
      })
  })
})
afterEach(() => db.close())
const insert = (id: number) =>
  db.prepare('INSERT INTO metrics_fixture VALUES (?, ?)').run(id, 'fictional value')

it.each(['call', 'default', 'deferred', 'immediate', 'exclusive'] as const)(
  'records one outer %s commit with direct rows and its outer writer',
  (variant) => {
    const recorder = committedChangesOf(db)
    const transaction = db.transaction(() => {
      insert(1)
      db.transaction(() => recorder.withWriter('nested', () => insert(2)))()
      return 'same result'
    })
    const call = variant === 'call' ? transaction : transaction[variant]
    expect(recorder.withWriter('store.batch', () => call())).toBe('same result')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      write: { component: 'store.batch', rows: 2 },
      tables: ['metrics_fixture'],
      inTransaction: false,
    })
    expect(seen[0]!.write.ms).toBeGreaterThanOrEqual(0)
  },
)

it('discards rolled-back savepoint counts and publishes nothing on outer rollback', () => {
  const failure = new Error('fictional rollback')
  db.transaction(() => {
    insert(1)
    try {
      db.transaction(() => {
        insert(2)
        throw failure
      })()
    } catch (error) {
      expect(error).toBe(failure)
    }
    insert(3)
  })()
  expect(seen.map((one) => one.write.rows)).toEqual([2])
  expect(() =>
    db.transaction(() => {
      insert(4)
      throw failure
    })(),
  ).toThrow(failure)
  expect(seen).toHaveLength(1)
})

it('counts direct autocommit changes, zero changes and trigger effects honestly', () => {
  db.exec(`CREATE TABLE triggered_fixture (id INTEGER);
    CREATE TRIGGER metrics_trigger AFTER INSERT ON metrics_fixture
    BEGIN INSERT INTO triggered_fixture VALUES (new.id); END`)
  insert(1)
  db.prepare('UPDATE metrics_fixture SET value = ? WHERE id = ?').run('different', 99)
  expect(seen.map((one) => one.write.rows)).toEqual([1])
  expect(seen[0]!.write.component).toBe('database.direct')
  expect(db.prepare('SELECT count(*) AS count FROM triggered_fixture').get()).toEqual({ count: 1 })
})

it('keeps writer scopes synchronous, nested and receiver-preserving', async () => {
  const recorder = committedChangesOf(db)
  const value = { same: true }
  let pending: Promise<unknown> | undefined
  const target = {
    id: 0,
    add() {
      insert(++this.id)
      recorder.withWriter('nested', () => insert(++this.id))
      insert(++this.id)
    },
    fail() {
      throw failure
    },
    value() {
      return value
    },
    later() {
      return (pending = Promise.resolve().then(() => insert(++this.id)))
    },
  }
  const failure = new Error('fictional method failure')
  const store = timedMethods(target, 'store', new MainThreadWork(), (name, call) =>
    recorder.withWriter(name, call),
  )
  expect(store.add).toBe(store.add)
  expect(store.value()).toBe(value)
  store.add()
  let caught: unknown
  try {
    store.fail()
  } catch (error) {
    caught = error
  }
  expect(caught).toBe(failure)
  insert(99)
  const returned = store.later()
  expect(returned).toBe(pending)
  await returned
  expect(seen.map((one) => one.write.component)).toEqual([
    'store.add',
    'nested',
    'store.add',
    'database.direct',
    'database.direct',
  ])
})

it('a failing observer cannot turn a committed write into a failed write', () => {
  committedChangesOf(db).listen(() => {
    throw new Error('fictional log failure')
  })
  expect(() => insert(1)).not.toThrow()
  expect(seen).toHaveLength(1)
  expect(db.prepare('SELECT count(*) AS count FROM metrics_fixture').get()).toEqual({ count: 1 })
})

it('a transaction SQLite ended under its caller remains an unattributed resync', () => {
  const changes: Committed[] = []
  committedChangesOf(db).listen((change) => changes.push(change))
  expect(() =>
    db.transaction(() => {
      db.exec('ROLLBACK')
      db.transaction(() => insert(1))()
    })(),
  ).toThrow()
  expect(changes).toHaveLength(1)
  expect(changes[0]!.resync).toBe(true)
  expect('write' in changes[0]!).toBe(false)
  expect(db.prepare('SELECT count(*) AS count FROM metrics_fixture').get()).toEqual({ count: 1 })
})

it('foreign commits have no local metrics and readonly connections stay unwrapped', () => {
  const folder = mkdtempSync(join(tmpdir(), 'brocrew-write-metrics-'))
  const file = join(folder, 'fictional.sqlite')
  const local = openDatabase(file)
  let other: AppDatabase | undefined
  let reader: AppDatabase | undefined
  try {
    local.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY)')
    const changes: Committed[] = []
    const recorder = committedChangesOf(local)
    recorder.listen((change) => changes.push(change))
    other = openDatabase(file)
    other.prepare('INSERT INTO fixture VALUES (?)').run(1)
    recorder.check()
    expect(changes).toHaveLength(1)
    expect(changes[0]!.resync).toBe(true)
    expect('write' in changes[0]!).toBe(false)

    reader = new Database(file, { readonly: true })
    const prepare = reader.prepare
    const transaction = reader.transaction
    const readonlyRecorder = committedChangesOf(reader)
    expect(reader.prepare).toBe(prepare)
    expect(reader.transaction).toBe(transaction)
    expect(
      readonlyRecorder.withWriter('read', () => reader!.prepare('SELECT id FROM fixture').all()),
    ).toEqual([{ id: 1 }])
  } finally {
    reader?.close()
    other?.close()
    local.close()
    rmSync(folder, { recursive: true, force: true })
  }
})

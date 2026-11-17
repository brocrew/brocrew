import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { openDatabase, WAL_SIZE_LIMIT_BYTES } from '../src/main/db/connection'

const walSize = (file: string): number =>
  statSync(`${file}-wal`, { throwIfNoEntry: false })?.size ?? 0

const directory = mkdtempSync(join(tmpdir(), 'brobot-fictional-leftover-wal-'))
afterEach(() => {
  vi.restoreAllMocks()
})
afterAll(() => rmSync(directory, { recursive: true, force: true }))

/** A database whose write-ahead log, over the limit, never checkpointed: as a crash leaves it. */
function aCrashedDatabase(name: string): string {
  const live = join(directory, `${name}-live.sqlite`)
  const crashed = join(directory, `${name}.sqlite`)
  const writer = new Database(live)
  try {
    writer.pragma('journal_mode = WAL')
    writer.pragma('wal_autocheckpoint = 0')
    writer.exec('CREATE TABLE fictional_notes (id INTEGER PRIMARY KEY, body TEXT)')
    const insert = writer.prepare('INSERT INTO fictional_notes (body) VALUES (?)')
    const body = 'x'.repeat(4000)
    writer.transaction(() => {
      for (let i = 0; i < 8000; i += 1) insert.run(body)
    })()
    expect(walSize(live)).toBeGreaterThan(2 * WAL_SIZE_LIMIT_BYTES)
    copyFileSync(live, crashed)
    copyFileSync(`${live}-wal`, `${crashed}-wal`)
  } finally {
    writer.close()
  }
  return crashed
}

it('a write-ahead log left over the limit by a crash is cut back when the database opens, and keeps its rows', () => {
  const crashed = aCrashedDatabase('cut')
  const db = openDatabase(crashed, { fileMustExist: true })
  try {
    expect(walSize(crashed)).toBeLessThanOrEqual(WAL_SIZE_LIMIT_BYTES)
    expect(db.prepare('SELECT count(*) AS n FROM fictional_notes').get()).toEqual({ n: 8000 })
  } finally {
    db.close()
  }
})

it('a cut that fails, as on a full disk, is logged and the database still opens with every row', () => {
  const crashed = aCrashedDatabase('full')
  const leftover = walSize(crashed)
  const pragma = Database.prototype.pragma
  vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
    this: Database.Database,
    source: string,
    options?: Database.PragmaOptions,
  ) {
    if (source === 'wal_checkpoint(TRUNCATE)')
      throw new Database.SqliteError('database or disk is full', 'SQLITE_FULL')
    return pragma.call(this, source, options)
  })
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const db = openDatabase(crashed, { fileMustExist: true })
  try {
    expect(warned).toHaveBeenCalledTimes(1)
    expect(String(warned.mock.calls[0]![0])).toContain('database or disk is full')
    expect(walSize(crashed)).toBe(leftover)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.prepare('SELECT count(*) AS n FROM fictional_notes').get()).toEqual({ n: 8000 })
  } finally {
    db.close()
  }
})

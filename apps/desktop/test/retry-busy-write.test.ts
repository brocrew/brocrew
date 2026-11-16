import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { retryBusyWrite } from '../src/main/db/retry-busy-write'

describe('a busy write retries before the next write', () => {
  let folder: string
  let db: Database.Database
  let other: Database.Database

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brocrew-write-'))
    const file = join(folder, 'fictional.sqlite')
    db = new Database(file)
    db.pragma('journal_mode = WAL')
    db.exec('CREATE TABLE words (id INTEGER PRIMARY KEY, text TEXT)')
    other = new Database(file)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    other.close()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('restarts a stale WAL snapshot, commits once, and keeps the next row after it', () => {
    let attempts = 0
    const first = db.transaction(() => {
      db.prepare('SELECT count(*) FROM words').get()
      if (++attempts === 1) other.prepare('INSERT INTO words(text) VALUES (?)').run('outside')
      db.prepare('INSERT INTO words(text) VALUES (?)').run('first')
    })
    retryBusyWrite(db, first)
    retryBusyWrite(db, () => db.prepare('INSERT INTO words(text) VALUES (?)').run('second'))
    expect(attempts).toBe(2)
    expect(db.prepare('SELECT text FROM words ORDER BY id').all()).toEqual([
      { text: 'outside' },
      { text: 'first' },
      { text: 'second' },
    ])
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  })

  it('fails a still-locked write, restores its timeout, then accepts the next write', () => {
    db.pragma('busy_timeout = 0')
    other.exec('BEGIN IMMEDIATE')
    const write = vi.fn(() => db.prepare('INSERT INTO words(text) VALUES (?)').run('blocked'))
    expect(() => retryBusyWrite(db, write)).toThrow(/locked/)
    expect(write).toHaveBeenCalledTimes(2)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(0)
    other.exec('ROLLBACK')
    retryBusyWrite(db, () => db.prepare('INSERT INTO words(text) VALUES (?)').run('later'))
    expect(db.prepare('SELECT text FROM words').all()).toEqual([{ text: 'later' }])
  })

  it('uses the original timeout budget and never retries a different error or nested work', () => {
    const clock = vi.spyOn(performance, 'now')
    clock.mockReturnValueOnce(0).mockReturnValueOnce(5000)
    const busy = vi.fn(() => {
      throw Object.assign(new Error('locked'), { code: 'SQLITE_BUSY' })
    })
    expect(() => retryBusyWrite(db, busy)).toThrow('locked')
    expect(busy).toHaveBeenCalledTimes(1)
    clock.mockRestore()
    const broken = vi.fn(() => {
      throw new Error('disk full')
    })
    expect(() => retryBusyWrite(db, broken)).toThrow('disk full')
    expect(broken).toHaveBeenCalledTimes(1)
    db.exec('BEGIN')
    expect(() => retryBusyWrite(db, busy)).toThrow('locked')
    expect(busy).toHaveBeenCalledTimes(2)
    db.exec('ROLLBACK')
  })
})

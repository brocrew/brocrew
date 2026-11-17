import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { openDatabase, WAL_SIZE_LIMIT_BYTES } from '../src/main/db/connection'

const walSize = (file: string): number =>
  statSync(`${file}-wal`, { throwIfNoEntry: false })?.size ?? 0

it('a write-ahead log left over the limit by a crash is cut back when the database opens, and keeps its rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'brobot-fictional-leftover-wal-'))
  const live = join(directory, 'live.sqlite')
  const crashed = join(directory, 'crashed.sqlite')
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
    // The files as a crash leaves them: the log never checkpointed into the database.
    copyFileSync(live, crashed)
    copyFileSync(`${live}-wal`, `${crashed}-wal`)
  } finally {
    writer.close()
  }

  const db = openDatabase(crashed, { fileMustExist: true })
  try {
    expect(walSize(crashed)).toBeLessThanOrEqual(WAL_SIZE_LIMIT_BYTES)
    expect(db.prepare('SELECT count(*) AS n FROM fictional_notes').get()).toEqual({ n: 8000 })
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

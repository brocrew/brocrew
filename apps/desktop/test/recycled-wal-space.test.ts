import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'

it('reclaims an oversized WAL when its reader releases and the next writer recycles it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-recycled-wal-'))
  const file = join(directory, 'workspace.sqlite')
  const writer = openDatabase(file)
  writer.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, body BLOB)')
  const reader = new Database(file, { readonly: true, fileMustExist: true })
  try {
    reader.exec('BEGIN')
    reader.prepare('SELECT count(*) FROM records').get()
    const insert = writer.prepare('INSERT INTO records (body) VALUES (zeroblob(4096))')
    writer.transaction(() => {
      for (let row = 0; row < 4096; row++) insert.run()
    })()
    expect(statSync(`${file}-wal`).size).toBeGreaterThan(8 * 1024 * 1024)
    expect(reader.prepare('SELECT count(*) AS n FROM records').get()).toEqual({ n: 0 })
    reader.exec('COMMIT')
    const [checkpoint] = writer.pragma('wal_checkpoint(PASSIVE)') as {
      log: number
      checkpointed: number
    }[]
    expect(checkpoint!.checkpointed).toBe(checkpoint!.log)
    insert.run()
    expect(writer.prepare('SELECT count(*) AS n FROM records').get()).toEqual({ n: 4097 })
    expect(statSync(`${file}-wal`).size).toBeLessThanOrEqual(8 * 1024 * 1024)
  } finally {
    reader.close()
    writer.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

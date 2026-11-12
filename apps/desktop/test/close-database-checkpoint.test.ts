import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { closeDatabase } from '../src/main/db/close-database'

it('reports a pinned WAL instead of closing the writer as though checkpointing succeeded', () => {
  const root = mkdtempSync(join(tmpdir(), 'fictional-checkpoint-busy-'))
  const file = join(root, 'copy.sqlite')
  const writer = new Database(file, { timeout: 0 })
  writer.pragma('journal_mode=WAL')
  writer.pragma('wal_autocheckpoint=0')
  writer.exec('CREATE TABLE kept(n); INSERT INTO kept VALUES(1)')
  const reader = new Database(file, { readonly: true })
  try {
    reader.exec('BEGIN')
    expect(reader.prepare('SELECT n FROM kept').get()).toEqual({ n: 1 })
    writer.exec('INSERT INTO kept VALUES(2)')
    expect(() => closeDatabase(writer)).toThrow('Database checkpoint did not finish')
    expect(writer.open).toBe(true)
    reader.exec('ROLLBACK')
    reader.close()
    closeDatabase(writer)
    expect(writer.open).toBe(false)
    const reopened = new Database(file)
    try {
      expect(reopened.prepare('SELECT n FROM kept ORDER BY n').all()).toEqual([{ n: 1 }, { n: 2 }])
    } finally {
      reopened.close()
    }
  } finally {
    if (reader.open) reader.close()
    if (writer.open) writer.close()
    rmSync(root, { recursive: true, force: true })
  }
})

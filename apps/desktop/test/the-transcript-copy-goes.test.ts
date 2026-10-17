import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { compactWhenMuchIsFree } from '../src/main/db/compact'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

it('upgrades a large fictional transcript copy, preserves the ledger and returns its space', () => {
  const folder = mkdtempSync(join(tmpdir(), 'brocrew-transcript-copy-'))
  const file = join(folder, 'fictional.sqlite')
  const before = join(folder, 'before')
  cpSync(migrations, before, { recursive: true })
  const journalPath = join(before, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] }
  journal.entries = journal.entries.filter((one) => one.idx < 11)
  writeFileSync(journalPath, JSON.stringify(journal))
  const db = openDatabase(file)
  try {
    applyMigrations(db, before)
    const session = db.prepare(
      `INSERT INTO provider_session (id, provider, cwd, created_at, updated_at) VALUES (?, ?, '/fictional', 1, 1)`,
    )
    const raw = db.prepare(
      'INSERT INTO raw_frame (id, session_id, ordinal, format, frame, created_at) VALUES (?, ?, ?, ?, ?, 1)',
    )
    const event = db.prepare(
      'INSERT INTO events (id, session_id, ordinal, type, payload, created_at, generation) VALUES (?, ?, ?, ?, ?, 1, 0)',
    )
    const frame = JSON.stringify({ type: 'fictional-provider-row', text: 'x'.repeat(6144) })
    const payload = JSON.stringify({
      type: 'assistant_message',
      text: 'fictional result '.repeat(64),
    })
    db.transaction(() => {
      for (const provider of ['claude', 'codex']) {
        const id = `fictional-${provider}`
        session.run(id, provider)
        for (let n = 0; n < 8192; n++) raw.run(`${id}-raw-${n}`, id, n, provider, frame)
        for (let n = 0; n < 16384; n++)
          event.run(`${id}-event-${n}`, id, n, 'assistant_message', payload)
      }
    })()
    db.pragma('wal_checkpoint(TRUNCATE)')
    const bytesBefore = statSync(file).size
    const kept = db
      .prepare('SELECT count(*) AS rows, sum(length(payload)) AS bytes FROM events')
      .get()
    applyMigrations(db, migrations)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'raw_frame%'").all()).toEqual(
      [],
    )
    expect(
      db.prepare('SELECT count(*) AS rows, sum(length(payload)) AS bytes FROM events').get(),
    ).toEqual(kept)
    expect(compactWhenMuchIsFree(db, 1024 ** 3)).toBe('compacted')
    const bytesAfter = statSync(file).size
    expect(bytesAfter).toBeLessThan(bytesBefore / 2)
    applyMigrations(db, migrations)
    expect(
      db.prepare('SELECT count(*) AS rows, sum(length(payload)) AS bytes FROM events').get(),
    ).toEqual(kept)
    const measurement = {
      rawRows: 16384,
      keptEvents: 32768,
      bytesBefore,
      bytesAfter,
      bytesFreed: bytesBefore - bytesAfter,
    }
    if (process.env['BROCREW_STORAGE_MEASUREMENT'])
      writeFileSync(
        process.env['BROCREW_STORAGE_MEASUREMENT'],
        JSON.stringify(measurement, null, 2) + '\n',
      )
  } finally {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  }
})

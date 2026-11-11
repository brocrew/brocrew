import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  measurementSize,
  seedMeasurementDatabase,
  measurementFacts,
  requireMeasurementCapacity,
  leaveMeasurementWal,
} from '../lib/recovery-measurement.mjs'
import { startOrder, READY_LINE } from '../lib/upgrade-path.mjs'

const migrations = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/desktop/src/main/db/migrations',
)
const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
const sqlOf = (tag) => readFileSync(join(migrations, `${tag}.sql`), 'utf8')

describe('populated recovery measurement', () => {
  it.runIf(process.platform === 'darwin')(
    'keeps a committed needle in WAL only and can reset that same owned fixture',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'measurement-wal-test-'))
      const file = join(root, 'fixture.sqlite')
      const db = new DatabaseSync(file)
      try {
        seedMeasurementDatabase(db, { journal, sqlOf, bytes: 1024 * 1024 })
      } finally {
        db.close()
      }
      try {
        const first = await leaveMeasurementWal(file)
        const second = await leaveMeasurementWal(file)
        expect(second.rows).toBe(first.rows)
        expect(first.needles.map((one) => one.id)).toEqual(['measurement-first', 'measurement-wal'])
        expect(second.needles).toEqual(first.needles)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
  it('takes decimal byte inputs and refuses ambiguous or out-of-budget requests', () => {
    expect(measurementSize('0')).toBe(0)
    expect(measurementSize('18000000000')).toBe(18_000_000_000)
    for (const value of ['-1', '1e9', '1.5', '18000000001', '', 'NaN'])
      expect(() => measurementSize(value)).toThrow('decimal integer')
  })

  it('requires actual APFS clone evidence and two database copies of post-build room before seeding', () => {
    const facts = { bytes: 18_000_000_000, free: 41_000_000_000, filesystem: 'apfs', cloned: true }
    expect(() => requireMeasurementCapacity(facts)).not.toThrow()
    expect(() => requireMeasurementCapacity({ ...facts, free: 35_000_000_000 })).toThrow(
      'two-database',
    )
    expect(() => requireMeasurementCapacity({ ...facts, filesystem: 'hfs' })).toThrow('APFS')
    expect(() => requireMeasurementCapacity({ ...facts, cloned: false })).toThrow('FORCE clone')
  })

  it.each([false, true])(
    'populates real rows and indexes in bounded transactions (earlier prefix %s)',
    (earlier) => {
      const db = new DatabaseSync(':memory:')
      try {
        let calls = 0
        const seeded = seedMeasurementDatabase(db, {
          journal,
          sqlOf,
          bytes: 8 * 1024 * 1024,
          earlier,
          beforeBatch: () => calls++,
        })
        const facts = measurementFacts(db)
        expect(seeded.bytes).toBeGreaterThanOrEqual(8 * 1024 * 1024)
        expect(seeded.bytes).toBeLessThanOrEqual(40 * 1024 * 1024)
        expect(seeded.rows).toBeGreaterThan(0)
        expect(seeded.maxBatchBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
        expect(calls).toBe(seeded.batches)
        expect(facts.rows).toBe(seeded.rows + 1)
        expect(facts.freePages).toBe(0)
        expect(facts.objects.some((one) => one.name === 'events' && one.bytes > 0)).toBe(true)
        for (const row of db
          .prepare("SELECT type,payload FROM events WHERE session_id='measurement-bulk' LIMIT 20")
          .all()) {
          expect(JSON.parse(row.payload).type).toBe(row.type)
          expect(JSON.parse(row.payload).text).toMatch(/^Fictional measurement row/)
        }
        if (earlier) db.exec(sqlOf(journal.entries.at(-1).tag))
        expect(
          db.prepare("SELECT payload FROM events WHERE id='measurement-first'").get().payload,
        ).toContain('Fictional measurement first answer.')
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      } finally {
        db.close()
      }
    },
  )

  it('stops on lost storage admission before inserting a bulk batch', () => {
    const db = new DatabaseSync(':memory:')
    try {
      expect(() =>
        seedMeasurementDatabase(db, {
          journal,
          sqlOf,
          bytes: 8 * 1024 * 1024,
          beforeBatch: () => {
            throw new Error('capacity lost')
          },
        }),
      ).toThrow('capacity lost')
      expect(
        db.prepare("SELECT count(*) AS n FROM events WHERE session_id='measurement-bulk'").get().n,
      ).toBe(0)
    } finally {
      db.close()
    }
  })

  it('reads the actual019 copy wording while retaining the old before-window ordering control', () => {
    const checkpointLine = 'BroCrew made a checked recovery copy before changing its data.'
    expect(
      startOrder(`${checkpointLine}\n${READY_LINE}`, { checkpoint: true, checkpointLine })
        .checkedCopy,
    ).toBe(0)
    expect(() =>
      startOrder(`${READY_LINE}\n${checkpointLine}`, { checkpoint: true, checkpointLine }),
    ).toThrow('before READY')
  })
})

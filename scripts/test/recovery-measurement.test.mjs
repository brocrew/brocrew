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
  cloneMeasurementFile,
  measurementSizes,
  compareMeasurementCopies,
  measurementOrder,
} from '../lib/recovery-measurement.mjs'
import { startOrder, READY_LINE } from '../lib/upgrade-path.mjs'
import { nodeFs } from '../../apps/desktop/src/main/recovery/files.ts'
import { measurementFilesystem } from '../lib/mac-update-test.mjs'

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
        const clone = join(root, 'native-clone.sqlite')
        cloneMeasurementFile(file, clone)
        expect(() => cloneMeasurementFile(file, clone)).toThrowError(
          expect.objectContaining({ code: 'EEXIST' }),
        )
        expect(() =>
          cloneMeasurementFile(join(root, 'absent'), join(root, 'missing-copy')),
        ).toThrowError(expect.objectContaining({ code: 'ENOENT' }))
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
    expect(measurementSize('18000000001')).toBe(18_000_000_001)
    for (const value of ['-1', '1e9', '1.5', '9007199254740992', '', 'NaN'])
      expect(() => measurementSize(value)).toThrow('decimal integer')
  })

  it('budgets live data, recovery copy and migration rebuild above10GB before seeding', () => {
    const facts = { bytes: 18_000_000_000, free: 65_000_000_000, filesystem: 'apfs', cloned: true }
    expect(() => requireMeasurementCapacity(facts)).not.toThrow()
    expect(() => requireMeasurementCapacity({ ...facts, free: 35_000_000_000 })).toThrow(
      'migration-rebuild',
    )
    expect(() => requireMeasurementCapacity({ ...facts, filesystem: 'hfs' })).toThrow('APFS')
    expect(() => requireMeasurementCapacity({ ...facts, cloned: false })).toThrow('FORCE clone')
  })

  it('chooses serial populated sizes only from current space above the10GB floor and actual-copy budget', () => {
    const sizes = measurementSizes(18_000_000_000, 45_000_000_000)
    expect(sizes).toHaveLength(2)
    expect(sizes[0]).toBeLessThan(sizes[1])
    for (const bytes of sizes) {
      expect(bytes).toBeLessThanOrEqual(18_000_000_000)
      expect(() =>
        requireMeasurementCapacity({
          bytes,
          free: 45_000_000_000,
          filesystem: 'apfs',
          cloned: true,
        }),
      ).not.toThrow()
    }
    expect(() => measurementSizes(18_000_000_000, 10_000_000_000)).toThrow('10GB')
    expect(measurementSizes(8 * 1024 * 1024, 45_000_000_000)).toEqual([8 * 1024 * 1024])
  })

  it('resolves actual metadata from the observed device and retains unsuccessful command facts', () => {
    const commands = []
    const invoke = (program, args) => {
      if (program === '/bin/df')
        return {
          status: 0,
          stdout:
            'Filesystem Blocks Used Available Capacity Mounted on\n/dev/disk7s3 10 2 8 20% /owned',
        }
      if (program === '/usr/sbin/diskutil') {
        expect(args).toEqual(['info', '-plist', '/dev/disk7s3'])
        return { status: 0, stdout: 'Fictional plist' }
      }
      return { status: 0, stdout: '{"FilesystemType":"apfs"}' }
    }
    expect(measurementFilesystem('/owned', commands, invoke).FilesystemType).toBe('apfs')
    expect(commands).toHaveLength(3)
    const failed = []
    expect(() =>
      measurementFilesystem('/owned', failed, () => ({
        status: null,
        signal: 'SIGTERM',
        error: { code: 'ETIMEDOUT', errno: -60, message: 'Fictional metadata timeout' },
      })),
    ).toThrow('Filesystem command failed')
    expect(failed[0]).toMatchObject({
      status: null,
      signal: 'SIGTERM',
      error: { code: 'ETIMEDOUT', errno: -60 },
    })
  })

  it('keeps an early publication sample without awarding overlap when the ordinary window is observed later', () => {
    const record = {
      launched: 10,
      responsive: 20,
      absent: 21,
      completed: { at: 15 },
      manifestAbsent: false,
    }
    const options = { background: true, checkpointLine: 'completed', confirmed: 22 }
    expect(
      measurementOrder(`completed\n${READY_LINE}`, record, options).backgroundObservation,
    ).toBe('already-complete-no-overlap-credit')
    expect(record.completed.at).toBe(15)
    expect(() =>
      measurementOrder(`${READY_LINE}\ncompleted`, { ...record, manifestAbsent: true }, options),
    ).toThrow('Responsive ordinary DOM')
  })

  it.runIf(process.platform === 'darwin')(
    'compares the real adapter and portable copy serially with correct bytes and owned cleanup',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'measurement-adapter-test-')),
        file = join(root, 'fixture.sqlite')
      const db = new DatabaseSync(file)
      try {
        seedMeasurementDatabase(db, { journal, sqlOf, bytes: 1024 * 1024 })
      } finally {
        db.close()
      }
      const original = readFileSync(file)
      try {
        const seen = await compareMeasurementCopies({ root, file, fs: nodeFs })
        expect(seen.map(({ path }) => path)).toEqual(['production-adapter', 'portable-copy'])
        expect(seen[0].adapterAdmission).toBe(true)
        for (const one of seen) {
          expect(one.correct).toBe(true)
          expect(one.cleanupVerified).toBe(true)
          expect(one.finished).toBeLessThanOrEqual(one.validationStarted)
          expect(one.afterCopy.free).toBeGreaterThanOrEqual(10_000_000_000)
        }
        const failed = [],
          error = Object.assign(new Error('Fictional copy EIO'), { code: 'EIO' })
        await expect(
          compareMeasurementCopies({
            root,
            file,
            comparisons: failed,
            fs: {
              ...nodeFs,
              cloneFile: async () => {
                throw error
              },
            },
          }),
        ).rejects.toBe(error)
        expect(failed).toHaveLength(1)
        expect(failed[0]).toMatchObject({ error: { code: 'EIO' }, cleanupVerified: true })
        const notCleaned = [],
          cleanup = Object.assign(new Error('Fictional cleanup EACCES'), { code: 'EACCES' })
        await expect(
          compareMeasurementCopies({
            root,
            file,
            comparisons: notCleaned,
            fs: {
              ...nodeFs,
              cloneFile: async () => {
                throw error
              },
              rm: async () => {
                throw cleanup
              },
            },
          }),
        ).rejects.toBe(error)
        expect(notCleaned[0]).toMatchObject({
          error: { code: 'EIO' },
          cleanupError: { code: 'EACCES' },
          cleanupVerified: false,
        })
        expect(readFileSync(file)).toEqual(original)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

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

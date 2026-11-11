import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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
  packagedCopyComparisons,
  measurementStateComparison,
} from '../lib/recovery-measurement.mjs'
import { startOrder, READY_LINE } from '../lib/upgrade-path.mjs'
import { nodeFs } from '../../apps/desktop/src/main/recovery/files.ts'
import { measurementFilesystem, stateBytes } from '../lib/mac-update-test.mjs'

const migrations = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/desktop/src/main/db/migrations',
)
const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
const sqlOf = (tag) => readFileSync(join(migrations, `${tag}.sql`), 'utf8')

function stateFixture() {
  const root = mkdtempSync(join(tmpdir(), 'measurement-state-test-'))
  const db = new DatabaseSync(join(root, 'brobot2.sqlite'))
  db.exec(
    'CREATE TABLE imported_side_file (name TEXT PRIMARY KEY); CREATE TABLE draft (slot TEXT PRIMARY KEY, entry TEXT)',
  )
  const draft = {
    slot: 'session:measurement-oracle',
    text: 'Fictional measurement draft.',
    attached: [],
  }
  writeFileSync(join(root, 'drafts.json'), JSON.stringify({ version: 1, drafts: [draft] }))
  writeFileSync(
    join(root, 'workspace.json'),
    JSON.stringify({ name: 'Fictional measurement workspace' }),
  )
  mkdirSync(join(root, 'skills', 'measurement-support'), { recursive: true })
  writeFileSync(
    join(root, 'skills', 'measurement-support', 'support.txt'),
    'Fictional support data.',
  )
  const before = stateBytes(root),
    names = Object.keys(before)
  const imported = (mark = true, row = draft) => {
    rmSync(join(root, 'drafts.json'))
    if (mark) db.prepare('INSERT INTO imported_side_file VALUES (?)').run('drafts.json')
    if (row) db.prepare('INSERT INTO draft VALUES (?, ?)').run(row.slot, JSON.stringify(row))
  }
  return { root, db, before, names, draft, imported }
}

describe('populated recovery measurement', () => {
  it.each(['file', 'database'])('preserves exact coupled state with drafts in %s', (source) => {
    const fixture = stateFixture()
    try {
      if (source === 'database') fixture.imported()
      const compared = measurementStateComparison(fixture.root, fixture.before, fixture.names)
      expect(compared.lost).toEqual([])
      expect(compared.draftSource).toBe(source)
      expect(compared.draft).toEqual({
        file: source === 'file',
        imported: source === 'database',
        row: source === 'database',
      })
      expect(compared.rewritten).toEqual([])
      expect(compared.appeared).toEqual([])
    } finally {
      fixture.db.close()
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it.each(['marker', 'row', 'text', 'attachments', 'version', 'skills', 'workspace'])(
    'still rejects lost or changed %s after side-file import',
    (changed) => {
      const fixture = stateFixture()
      try {
        const row = { ...fixture.draft }
        if (changed === 'text') row.text = 'Changed fictional text.'
        if (changed === 'attachments') row.attached = [{ path: '/fictional/changed.txt' }]
        fixture.imported(changed !== 'marker', changed === 'row' ? null : row)
        if (changed === 'version')
          fixture.before['drafts.json'] = Buffer.from(
            JSON.stringify({ version: 2, drafts: [fixture.draft] }),
          )
        if (changed === 'skills')
          writeFileSync(
            join(fixture.root, 'skills', 'measurement-support', 'support.txt'),
            'Changed support.',
          )
        if (changed === 'workspace')
          writeFileSync(
            join(fixture.root, 'workspace.json'),
            JSON.stringify({ name: 'Changed workspace' }),
          )
        const compared = measurementStateComparison(fixture.root, fixture.before, fixture.names)
        const lost =
          changed === 'skills'
            ? 'skills:'
            : changed === 'workspace'
              ? 'workspace.json:'
              : 'drafts.json:'
        expect(compared.lost.some((problem) => problem.startsWith(lost))).toBe(true)
        expect(compared.draft.imported).toBe(changed !== 'marker')
        expect(compared.draft.row).toBe(changed !== 'row')
      } finally {
        fixture.db.close()
        rmSync(fixture.root, { recursive: true, force: true })
      }
    },
  )

  it.each(['deadline', 'SIGTERM', 'SIGINT'])(
    'joins an abort-ignoring measurement child on %s and rejects late preflight success',
    async (reason) => {
      vi.useFakeTimers()
      const root = mkdtempSync(join(tmpdir(), 'measurement-child-test-'))
      const child = new EventEmitter(),
        parent = new EventEmitter()
      child.pid = 1234
      let alive = true
      const groupKill = vi.fn(() => {
        if (!alive) throw Object.assign(new Error('group gone'), { code: 'ESRCH' })
      })
      let settled = false
      try {
        const pending = packagedCopyComparisons(
          { root, next: { program: '/fictional/packaged-electron' } },
          { launch: () => child, parent, groupKill, deadlineMs: 100, graceMs: 50 },
        ).then((result) => {
          settled = true
          return result
        })
        if (reason === 'deadline') await vi.advanceTimersByTimeAsync(100)
        else parent.emit(reason)
        expect(groupKill.mock.calls.filter(([, signal]) => signal)).toEqual([[1234, 'SIGTERM']])
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(50)
        expect(groupKill.mock.calls.filter(([, signal]) => signal)).toEqual([
          [1234, 'SIGTERM'],
          [1234, 'SIGKILL'],
        ])
        expect(settled).toBe(false)
        writeFileSync(join(root, 'adapter-comparison.json'), JSON.stringify({ success: true }))
        alive = false
        child.emit('close', 0, null)
        const result = await pending
        expect(result.success).toBe(false)
        expect(result.child).toMatchObject({
          closed: true,
          groupStopped: true,
          code: 0,
          timedOut: reason === 'deadline',
          cancelled: reason === 'deadline' ? null : reason,
        })
        expect(parent.listenerCount('SIGTERM') + parent.listenerCount('SIGINT')).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  it('retains a normally closed preflight success without later stop signals', async () => {
    vi.useFakeTimers()
    const root = mkdtempSync(join(tmpdir(), 'measurement-child-test-'))
    const child = new EventEmitter(),
      parent = new EventEmitter()
    child.pid = 1234
    const groupKill = vi.fn(() => {
      throw Object.assign(new Error('group gone'), { code: 'ESRCH' })
    })
    try {
      const pending = packagedCopyComparisons(
        { root, next: { program: '/fictional/packaged-electron' } },
        { launch: () => child, parent, groupKill, deadlineMs: 100, graceMs: 50 },
      )
      writeFileSync(join(root, 'adapter-comparison.json'), JSON.stringify({ success: true }))
      child.emit('close', 0, null)
      expect(await pending).toMatchObject({ success: true, child: { closed: true, code: 0 } })
      await vi.advanceTimersByTimeAsync(200)
      expect(groupKill.mock.calls.filter(([, signal]) => signal)).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
      expect(parent.listenerCount('SIGTERM') + parent.listenerCount('SIGINT')).toBe(0)
    } finally {
      vi.useRealTimers()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'darwin')(
    'stops a real copy-shaped descendant that outlives its group leader and ignores TERM',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'measurement-descendant-test-'))
      let stopped = false
      const worker =
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.send('ready')"
      const leader = `
        const { spawn } = require('node:child_process');
        const copy = spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        copy.once('message', () => process.stdout.write(String(copy.pid), () => process.exit(0)));
      `
      try {
        const result = await packagedCopyComparisons(
          { root, next: { program: process.execPath } },
          {
            launch: (_program, _args, options) => spawn(process.execPath, ['-e', leader], options),
            deadlineMs: 5000,
            graceMs: 1000,
          },
        )
        stopped = result.child.groupStopped
        expect(result.success).toBe(false)
        expect(result.child).toMatchObject({
          closed: true,
          groupStopped: true,
          code: 0,
          cancelled: 'descendants-after-close',
        })
        expect(result.child.stops.map((one) => one.signal)).toEqual(['SIGTERM', 'SIGKILL'])
        const descendant = Number(result.child.output.trim())
        expect(descendant).toBeGreaterThan(0)
        expect(() => process.kill(descendant, 0)).toThrow(
          expect.objectContaining({ code: 'ESRCH' }),
        )
      } finally {
        if (stopped) rmSync(root, { recursive: true, force: true })
      }
    },
  )

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

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { inspectCompaction } from '../src/main/db/workspace-compaction'
import type { EventTrimResult } from '../src/main/db/event-retention'
import { workspaceCompaction } from '../src/main/storage/workspace-compaction'
import { CheckpointFailed, makeCheckpoint } from '../src/main/recovery/checkpoint'
import { checkTheCopy, verifyInAWorker, type VerifyCopy } from '../src/main/recovery/copy-check'
import { bundleAWorker } from './helpers/bundle-a-worker'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * A recovery copy is checked in a worker, so a long check never holds the main thread; its three
 * outcomes are kept apart, as a checkpoint says and retries them; and the copy is released before
 * anything touches it next. Launch compaction runs off the main thread and installs only its closed output.
 */
describe('the recovery copy is checked off the main thread', () => {
  let folder: string
  let bundle: string
  let checkBundle: string
  let storageBundle: string
  let trimBundle: string
  const roots: string[] = []
  const aRoot = () => {
    const root = mkdtempSync(join(folder, 'root-'))
    roots.push(root)
    return root
  }
  /** A small database, intact. */
  const aCopy = (): string => {
    const file = join(aRoot(), 'copy.sqlite')
    const db = new Database(file)
    db.exec('CREATE TABLE kept (x TEXT); CREATE INDEX kept_x ON kept (x)')
    const insert = db.prepare('INSERT INTO kept VALUES (?)')
    for (let n = 0; n < 50; n++) insert.run(`needle-${String(n).padStart(3, '0')}`)
    db.close()
    return file
  }
  /** The same, with one row changed in its table but not its index: only the full check sees it. */
  const aDamagedCopy = (): string => {
    const file = aCopy()
    const db = new Database(file)
    const { rootpage } = db
      .prepare(`SELECT rootpage FROM sqlite_master WHERE name = 'kept'`)
      .get() as { rootpage: number }
    const pageSize = Number(db.pragma('page_size', { simple: true }))
    db.close()
    const bytes = readFileSync(file)
    const page = bytes.subarray((rootpage - 1) * pageSize, rootpage * pageSize)
    page.write('needle-XYZ', page.indexOf('needle-007'))
    writeFileSync(file, bytes)
    return file
  }
  const inAWorker = (holdMs?: number): VerifyCopy =>
    verifyInAWorker((request) => new Worker(bundle, { workerData: request }), holdMs).verify
  /** The longest gap between ticks of a 10 ms heartbeat while `work` runs. */
  const longestGapDuring = async (work: () => Promise<unknown>): Promise<number> => {
    let last = performance.now()
    let longest = 0
    const beat = setInterval(() => {
      const now = performance.now()
      longest = Math.max(longest, now - last)
      last = now
    }, 10)
    try {
      await work()
      longest = Math.max(longest, performance.now() - last)
    } finally {
      clearInterval(beat)
    }
    return longest
  }

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'fictional-copy-check-'))
    bundle = await bundleAWorker('src/main/recovery-verify.worker.ts', folder, 'verify.cjs')
    checkBundle = await bundleAWorker('src/main/recovery/copy-check.ts', folder, 'check.cjs')
    storageBundle = await bundleAWorker('src/main/storage.worker.ts', folder, 'storage.cjs')
    trimBundle = await bundleAWorker('src/main/db/event-retention.ts', folder, 'trim.cjs')
  }, 120_000)
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  it('a long check in the worker leaves the main thread beating; the same check here does not', async () => {
    const copy = aCopy()
    let inWorker: Promise<number> | undefined
    let checked!: () => void
    const phaseEnded = new Promise<void>((resolve) => {
      checked = resolve
    })
    const verifier = verifyInAWorker((request) => {
      const worker = new Worker(
        `const { parentPort, workerData } = require('node:worker_threads');
        const { checkTheCopy } = require(workerData.checkBundle);
        parentPort.once('message', () => {
          parentPort.postMessage(checkTheCopy(workerData.copy, workerData.holdMs, workerData.readonly));
          parentPort.close();
        });
        parentPort.postMessage('ready');`,
        { eval: true, workerData: { ...request, checkBundle } },
      )
      worker.on('message', (message: unknown) => {
        if (message === 'ready') {
          // Start after module loading; include command delivery, the check and its answer.
          inWorker = longestGapDuring(async () => {
            worker.postMessage('check')
            await phaseEnded
          })
        } else checked()
      })
      worker.once('exit', checked)
      return worker
    }, 400)
    try {
      const answer = await verifier.verify(copy)
      expect(answer).toEqual({ kind: 'ok' })
      expect(inWorker).toBeDefined()
      expect(await inWorker).toBeLessThan(100)
      // The control: run on this thread, the same hold stops the heartbeat for all of it.
      const here = await longestGapDuring(async () => {
        checkTheCopy(copy, 400)
      })
      expect(here).toBeGreaterThanOrEqual(350)
    } finally {
      await verifier.stop()
    }
  })

  it('hashes the private copy in the existing worker and reports failure without a digest', async () => {
    const verifier = verifyInAWorker(
      (request) =>
        new Worker(bundle, {
          workerData: { ...request, hashOnly: true },
        }),
    )
    try {
      const copy = aCopy()
      expect(await verifier.verify(copy)).toEqual({
        kind: 'ok',
        sha256: createHash('sha256').update(readFileSync(copy)).digest('hex'),
      })
      const missing = await verifier.verify(join(aRoot(), 'missing.sqlite'))
      expect(missing.kind).toBe('failed')
      expect('sha256' in missing).toBe(false)
    } finally {
      await verifier.stop()
    }
  })

  it('the worker keeps the three outcomes apart', async () => {
    expect(await inAWorker()(aCopy())).toEqual({ kind: 'ok' })
    const damaged = await inAWorker()(aDamagedCopy())
    expect(damaged.kind).toBe('damaged')
    const missing = await inAWorker()(join(aRoot(), 'none.sqlite'))
    expect(missing.kind).toBe('failed')
  })

  it('a worker that ends without answering, or cannot start, says the check could not run', async () => {
    const silent = verifyInAWorker(() => new Worker('process.exit(0)', { eval: true })).verify
    expect((await silent(aCopy())).kind).toBe('failed')
    const unstarted = verifyInAWorker(() => {
      throw new Error('no worker today')
    }).verify
    expect(await unstarted(aCopy())).toEqual({
      kind: 'failed',
      message: 'its check could not start: no worker today',
    })
  })

  it('the answer is taken only once the worker has exited', async () => {
    const order: string[] = []
    const { verify } = verifyInAWorker((request) => {
      const worker = new Worker(bundle, { workerData: request })
      worker.once('exit', () => order.push('exited'))
      return worker
    })
    await verify(aCopy())
    order.push('answered')
    expect(order).toEqual(['exited', 'answered'])
  })

  it('a quit stops a check under way, and stops only once its worker has exited', async () => {
    const order: string[] = []
    let started = 0
    const verifier = verifyInAWorker((request) => {
      started++
      const worker = new Worker(bundle, { workerData: request })
      worker.once('exit', () => order.push('exited'))
      return worker
    }, 5_000)
    const checking = verifier.verify(aCopy())
    await new Promise((resolve) => setTimeout(resolve, 100))
    const began = performance.now()
    await verifier.stop()
    order.push('stopped')
    expect(performance.now() - began).toBeLessThan(2_000)
    expect(order).toEqual(['exited', 'stopped'])
    expect((await checking).kind).toBe('failed')
    // Once stopped, no check starts a worker.
    expect((await verifier.verify(aCopy())).kind).toBe('failed')
    expect(started).toBe(1)
  })

  it('a quit discards even an ok message received before the worker exits', async () => {
    let worker!: Worker
    let answered!: () => void
    const message = new Promise<void>((resolve) => {
      answered = resolve
    })
    const verifier = verifyInAWorker(() => {
      worker = new Worker(
        `const { parentPort } = require('node:worker_threads');
        parentPort.postMessage({ kind: 'ok' });
        setInterval(() => {}, 1000)`,
        { eval: true },
      )
      worker.once('message', answered)
      return worker
    })
    const checking = verifier.verify(aCopy())
    try {
      await message
      await verifier.stop()
      expect((await checking).kind).toBe('failed')
    } finally {
      await worker.terminate()
    }
  })

  it.each([false, true])(
    'retention waits for a writer, or safely defers a persistent lock: %s',
    async (held) => {
      const file = join(aRoot(), 'busy-trim.sqlite')
      const db = openDatabase(file)
      applyMigrations(db, migrations)
      db.prepare(
        `INSERT INTO provider_session
        (id, provider, cwd, status, created_at, updated_at)
        VALUES ('fictional', 'claude', '/', 'idle', 0, 0)`,
      ).run()
      const insert = db.prepare(`INSERT INTO events
        (id, session_id, ordinal, type, payload, created_at) VALUES (?, 'fictional', ?, ?, ?, 0)`)
      db.transaction(() => {
        for (let n = 0; n < 1002; n++) {
          insert.run(String(n), n, 'thinking', JSON.stringify({ type: 'thinking' }))
        }
        for (const [n, type] of ['user_turn', 'turn'].entries()) {
          insert.run(`protected-${n}`, 1002 + n, type, JSON.stringify({ type }))
        }
      })()
      db.exec('BEGIN IMMEDIATE')
      const worker = new Worker(
        `const { parentPort, workerData } = require('node:worker_threads');
        const { trimOldEvents } = require(workerData.bundle);
        parentPort.postMessage({ starting: true });
        trimOldEvents(workerData.file, () => false).then(
          value => parentPort.postMessage({ value }),
          error => { throw error; });`,
        { eval: true, workerData: { bundle: trimBundle, file } },
      )
      let release: ReturnType<typeof setTimeout> | undefined
      try {
        const result = await new Promise<EventTrimResult>((resolve, reject) => {
          worker.once('error', reject)
          worker.on('message', (message: { starting?: boolean; value?: EventTrimResult }) => {
            if (message.starting && !held) release = setTimeout(() => db.exec('COMMIT'), 500)
            if (message.value) resolve(message.value)
          })
        })
        expect(result.interrupted).toBe(held)
        expect(result.removed).toBe(held ? 0 : 2)
        expect(db.prepare("SELECT count(*) AS n FROM events WHERE type='thinking'").get()).toEqual({
          n: held ? 1002 : 1000,
        })
        expect(
          db.prepare("SELECT count(*) AS n FROM events WHERE type IN ('user_turn','turn')").get(),
        ).toEqual({ n: 2 })
      } finally {
        clearTimeout(release)
        if (db.inTransaction) db.exec('ROLLBACK')
        await worker.terminate()
        db.close()
      }
    },
    15_000,
  )

  describe('a checkpoint says each outcome as it did, and keeps nothing it could not check', () => {
    const aWorkspace = (): string => {
      const userData = join(aRoot(), 'data')
      mkdirSync(userData)
      const db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrations)
      db.close()
      return userData
    }
    const make = (userData: string, verifyCopy: VerifyCopy) =>
      makeCheckpoint({
        userData,
        ownership: 'sole',
        appVersion: '0.1.0',
        build: null,
        reason: 'first-start-of-release',
        log: () => undefined,
        verifyCopy,
      }).catch((error: unknown) => error)

    it('damage is not retried, and the copy is not kept', async () => {
      const userData = aWorkspace()
      const failure = await make(userData, async () => ({
        kind: 'damaged',
        check: 'row 7 missing',
      }))
      expect(failure).toBeInstanceOf(CheckpointFailed)
      expect((failure as CheckpointFailed).canRetry).toBe(false)
      expect((failure as Error).message).toContain(
        "did not pass SQLite's own check (row 7 missing)",
      )
      expect(existsSync(join(userData, 'backups'))).toBe(false)
    })

    it('a check that could not run is retried, and the copy is not kept', async () => {
      const userData = aWorkspace()
      const failure = await make(userData, async () => ({ kind: 'failed', message: 'locked' }))
      expect(failure).toBeInstanceOf(CheckpointFailed)
      expect((failure as CheckpointFailed).canRetry).toBe(true)
      expect((failure as Error).message).toContain('locked')
      expect(existsSync(join(userData, 'backups'))).toBe(false)
    })

    it('a copy the worker passes is kept', async () => {
      const userData = aWorkspace()
      const made = await make(userData, inAWorker())
      expect(made).not.toBeInstanceOf(Error)
    })
  })

  describe('launch compaction', () => {
    /** A database with much free space: rows written, then deleted. */
    const aLooseDatabase = () => {
      const file = join(aRoot(), 'loose.sqlite')
      const db = openDatabase(file)
      db.exec('CREATE TABLE filler (x BLOB)')
      const insert = db.prepare('INSERT INTO filler VALUES (randomblob(4000))')
      db.transaction(() => {
        for (let i = 0; i < 20_000; i++) insert.run()
      })()
      db.exec('DELETE FROM filler')
      db.pragma('wal_checkpoint(TRUNCATE)')
      return { file, db }
    }
    const fileBytes = (db: Database.Database) =>
      Number(db.pragma('page_count', { simple: true })) *
      Number(db.pragma('page_size', { simple: true }))

    it('inspects a large loose file without rewriting it', () => {
      const { file, db } = aLooseDatabase()
      try {
        const before = fileBytes(db)
        const facts = inspectCompaction(file)!
        expect(facts.eligible).toBe(true)
        expect(facts.bytes).toBe(before)
        expect(facts.keptBytes).toBeLessThan(before / 2)
        expect(fileBytes(db)).toBe(before)
      } finally {
        db.close()
      }
    })

    it('joins the production compaction worker before installing and reopening its output', async () => {
      const { file, db } = aLooseDatabase()
      const before = fileBytes(db)
      db.close()
      const maintenance = workspaceCompaction(
        (request) =>
          new Worker(storageBundle, {
            workerData: { maintenance: request },
          }),
      )
      let copied = false
      try {
        const longest = await longestGapDuring(async () => {
          expect(
            await maintenance.run(
              file,
              async () => {},
              async () => {
                copied = true
              },
              () => {},
            ),
          ).toBe(true)
        })
        expect(longest).toBeLessThan(100)
        expect(copied).toBe(true)
        const reopened = openDatabase(file)
        try {
          expect(fileBytes(reopened)).toBeLessThan(before)
          expect(reopened.pragma('auto_vacuum', { simple: true })).toBe(2)
          expect(reopened.prepare('SELECT count(*) AS n FROM filler').get()).toEqual({ n: 0 })
        } finally {
          reopened.close()
        }
      } finally {
        await maintenance.stop()
      }
    })
  })
})

import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { inspectCompaction } from '../src/main/db/workspace-compaction'
import { eventTrimWriter, type EventTrimResult } from '../src/main/db/event-retention'
import { committedChangesOf, type Committed } from '../src/main/db/committed-changes'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { createSessionStore } from '../src/main/db/session-store'
import { rowsUnreadOnce } from '../src/main/db/rows-unread'
import { startEventRetention } from '../src/main/storage/event-retention'
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
  const trimCompletion = <T>() => {
    let done!: (result: T) => void
    let failed!: (error: unknown) => void
    const result = new Promise<T>((resolve, reject) => {
      done = resolve
      failed = reject
    })
    return { result, done, failed }
  }
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

  it('a quit lets a check under way finish unused, and stops only once its worker has exited', async () => {
    const order: string[] = []
    let started = 0
    const verifier = verifyInAWorker((request) => {
      started++
      const worker = new Worker(bundle, { workerData: request })
      worker.once('exit', () => order.push('exited'))
      return worker
    }, 500)
    const checking = verifier.verify(aCopy())
    await new Promise((resolve) => setTimeout(resolve, 100))
    await verifier.stop()
    order.push('stopped')
    expect(order).toEqual(['exited', 'stopped'])
    expect((await checking).kind).toBe('failed')
    // Once stopped, no check starts a worker.
    expect((await verifier.verify(aCopy())).kind).toBe('failed')
    expect(started).toBe(1)
  })

  it('a quit stops a hash under way at its next read', async () => {
    const file = join(aRoot(), 'large-copy.sqlite')
    writeFileSync(file, '')
    truncateSync(file, 1024 ** 3)
    const hashing = () =>
      verifyInAWorker(
        (request) => new Worker(bundle, { workerData: { ...request, hashOnly: true } }),
      )
    const whole = performance.now()
    expect((await hashing().verify(file)).kind).toBe('ok')
    const wholeMs = performance.now() - whole
    const verifier = hashing()
    const began = performance.now()
    const hash = verifier.verify(file)
    await new Promise((resolve) => setTimeout(resolve, wholeMs / 4))
    await verifier.stop()
    expect(performance.now() - began).toBeLessThan((wholeMs * 3) / 4)
    expect((await hash).kind).toBe('failed')
  }, 60_000)

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
        parentPort.on('message', (message) => { if (message.kind === 'stop') process.exit(0) })`,
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

  const aHistory = (file: string, count: number, padding = 0) => {
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
      for (let n = 0; n < count; n++) {
        insert.run(
          String(n),
          n,
          'thinking',
          JSON.stringify({ type: 'thinking', text: 'x'.repeat(padding) }),
        )
      }
      for (const [n, type] of ['user_turn', 'turn'].entries()) {
        insert.run(`protected-${n}`, count + n, type, JSON.stringify({ type }))
      }
    })()
    return db
  }

  it.each([false, true])(
    'retention waits for a writer, or safely defers a persistent lock: %s',
    async (held) => {
      const file = join(aRoot(), 'busy-trim.sqlite')
      const db = aHistory(file, 1002)
      db.exec('BEGIN IMMEDIATE')
      const worker = new Worker(
        `const { parentPort, workerData } = require('node:worker_threads');
        const { trimOldEvents, eventTrimWriter } = require(workerData.bundle);
        const Database = require(workerData.database);
        const writer = new Database(workerData.file);
        const write = eventTrimWriter(writer);
        parentPort.postMessage({ starting: true });
        trimOldEvents(workerData.file, () => false, async batch => write(batch)).finally(() => writer.close()).then(
          value => parentPort.postMessage({ value }),
          error => { throw error; });`,
        {
          eval: true,
          workerData: {
            bundle: trimBundle,
            file,
            database: createRequire(import.meta.url).resolve('better-sqlite3'),
          },
        },
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

  /**
   * ⚠️ **No limit of its own** (396). The sweep's incremental compaction runs 54 steps, each
   * ending in a WAL checkpoint on this thread. On hosted Windows those checkpoints alone took
   * 3–16 s, one step at a time and always moving, so the project's bound for real filesystem
   * work applies here.
   */
  it('worker selections commit on the ordinary writer without a foreign-write resync', async () => {
    const file = join(aRoot(), 'owned-trim.sqlite')
    const db = aHistory(file, 1402, 8192)
    db.prepare(
      `INSERT INTO events (id,session_id,ordinal,type,payload,created_at) VALUES
      ('old-launch','fictional',1404,'launched','{"type":"launched"}',0),
      ('last-launch','fictional',1405,'launched','{"type":"launched"}',0),
      ('cut','fictional',1406,'compaction','{"type":"compaction"}',0)`,
    ).run()
    const store = createSessionStore(db)
    db.prepare(
      `INSERT INTO provider_session (id,provider,cwd,status,created_at,updated_at)
      VALUES ('untouched','claude','/','idle',0,0)`,
    ).run()
    const unread = rowsUnreadOnce()
    const untouched = store.piecesOwnedBy('untouched', unread)
    const changed = store.piecesOwnedBy('fictional', unread)
    const sample = windowWriterSampler(db, () => true)
    const before = sample({ kind: 'routes' })!
    expect(before).not.toBeNull()
    const pages = Number(db.pragma('page_count', { simple: true }))
    const committed = committedChangesOf(db)
    const seen: Committed[] = []
    const unsubscribe = committed.listen((change) => {
      expect(db.inTransaction).toBe(false)
      seen.push(change)
    })
    const version = db.pragma('data_version', { simple: true })
    const batchSizes: number[] = []
    let exited = false
    let ordinaryWrite = false
    const { result: finished, done, failed } = trimCompletion<EventTrimResult>()
    const retention = startEventRetention(
      db,
      () => {
        const worker = new Worker(storageBundle, {
          workerData: { maintenance: { kind: 'trim', file } },
        })
        worker.on('message', (message) => {
          if (message.kind !== 'trim-batch') return
          batchSizes.push(message.batch.ids.length)
          if (batchSizes.length === 1)
            setTimeout(() => {
              db.prepare(
                "INSERT INTO events (id,session_id,ordinal,type,payload,created_at) VALUES ('new-stream','fictional',1407,'thinking','{\"type\":\"thinking\"}',0)",
              ).run()
              ordinaryWrite = true
            }, 0)
        })
        worker.once('exit', () => {
          exited = true
        })
        return worker
      },
      async (result) => {
        done(result)
      },
      failed,
    )
    try {
      retention.firstListAccepted(-600_000)
      const result = await finished
      expect(exited).toBe(true)
      expect(ordinaryWrite).toBe(true)
      expect(batchSizes).toEqual([200, 200, 3])
      expect(result.removed).toBe(403)
      expect(result.batches).toBe(3)
      expect(result.incrementalSteps).toBeGreaterThan(0)
      expect(result.reclaimedPages).toBeGreaterThan(0)
      expect(Number(db.pragma('page_count', { simple: true }))).toBeLessThan(pages)
      const after = sample({ kind: 'routes' })!
      expect(after.foldReset).toBe(before.foldReset)
      expect(sample.changedOwners!(before, after)).toEqual(['fictional'])
      expect(store.piecesOwnedBy('untouched', unread)).toBe(untouched)
      expect(store.piecesOwnedBy('fictional', unread)).not.toBe(changed)
      expect(unread.count).toBe(0)
      expect(result.longestBatchMs).toBeGreaterThan(0)
      expect(
        db.prepare("SELECT count(*) AS n FROM events WHERE type IN ('user_turn','turn')").get(),
      ).toEqual({ n: 2 })
      committed.check()
      expect(db.pragma('data_version', { simple: true })).toBe(version)
      expect(seen.every((change) => !change.resync)).toBe(true)
      expect(seen.flatMap((change) => (change.resync ? [] : [...change.whole]))).toEqual([
        ['fictional', 'trimmed'],
        ['fictional', 'trimmed'],
        ['fictional', 'trimmed'],
      ])
      const foreign = new Database(file)
      try {
        foreign.prepare("UPDATE provider_session SET updated_at=1 WHERE id='fictional'").run()
      } finally {
        foreign.close()
      }
      committed.check()
      expect(seen.at(-1)?.resync).toBe(true)
    } finally {
      await retention.stop()
      unsubscribe()
      db.close()
    }
  })

  it('quitting before a selected batch is applied joins the worker and leaves its rows', async () => {
    const file = join(aRoot(), 'stopped-trim.sqlite')
    const db = aHistory(file, 1002)
    let exited = false
    const { result: stopped, done, failed } = trimCompletion<void>()
    const retention = startEventRetention(
      db,
      () => {
        const worker = new Worker(storageBundle, {
          workerData: { maintenance: { kind: 'trim', file } },
        })
        worker.once('exit', () => {
          exited = true
        })
        worker.once('message', () => {
          void retention.stop().then(done, failed)
        })
        return worker
      },
      async () => {
        failed(new Error('Stopped trim was published'))
      },
      failed,
    )
    try {
      retention.firstListAccepted(-600_000)
      await stopped
      expect(exited).toBe(true)
      expect(db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 1004 })
    } finally {
      await retention.stop()
      db.close()
    }
  }, 15_000)

  it('a quit during one long conversation with nothing to trim is seen at its next read', async () => {
    const file = join(aRoot(), 'long-trim.sqlite')
    const db = openDatabase(file)
    applyMigrations(db, migrations)
    db.prepare(
      `INSERT INTO provider_session (id, provider, cwd, status, created_at, updated_at)
      VALUES ('long', 'claude', '/', 'idle', 0, 0)`,
    ).run()
    const insert = db.prepare(
      `INSERT INTO events (id, session_id, ordinal, type, payload, created_at)
      VALUES (?, 'long', ?, 'activity', ?, ?)`,
    )
    const payload = JSON.stringify({ type: 'activity', text: 'x'.repeat(200) })
    db.transaction(() => {
      for (let n = 0; n < 100_000; n++) insert.run(String(n), n, payload, Date.now())
    })()
    /**
     * ⚠️ **Judged by reads, not by the clock** (404). Both wall-clock totals include starting the
     * worker, opening SQLite and the thread's exit, which a stop cannot shorten. On a loaded
     * Windows runner those costs alone took a stopped sweep past the whole one. So the stop is
     * still asked a quarter of the way through the whole sweep's time, but what is compared is
     * how far each sweep read. The stopped worker's own result is read here, because the app
     * drops it once it has asked the worker to stop.
     */
    const sweep = (stopAfterMs?: number) => {
      const { result, done, failed } = trimCompletion<{ ms: number; trim: EventTrimResult }>()
      const began = performance.now()
      let said: EventTrimResult | undefined
      const retention = startEventRetention(
        db,
        () => {
          const worker = new Worker(storageBundle, {
            workerData: { maintenance: { kind: 'trim', file } },
          })
          worker.on('message', (message: { ok?: boolean; value?: EventTrimResult }) => {
            if (message.ok === true) said = message.value
          })
          return worker
        },
        async (trim) => done({ ms: performance.now() - began, trim }),
        failed,
      )
      retention.firstListAccepted(-600_000)
      if (stopAfterMs !== undefined)
        setTimeout(() => {
          void retention.stop().then(() => {
            if (said === undefined) failed(new Error('the stopped worker reported no result'))
            else done({ ms: performance.now() - began, trim: said })
          }, failed)
        }, stopAfterMs)
      return { result, retention }
    }
    try {
      const whole = sweep()
      const wholeRun = await whole.result
      await whole.retention.stop()
      const stopped = (await sweep(wholeRun.ms / 4).result).trim
      expect(stopped.interrupted).toBe(true)
      expect(stopped.reads).toBeLessThan((wholeRun.trim.reads * 3) / 4)
      expect(db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 100_000 })
    } finally {
      db.close()
    }
  }, 60_000)

  it('a quit during incremental compaction waits for the writer after the worker exits', async () => {
    const file = join(aRoot(), 'compacting-trim.sqlite')
    const db = aHistory(file, 1402, 8192)
    let exited = false
    let compactions = 0
    let stopped!: Promise<void>
    let reached!: () => void
    const compacting = new Promise<void>((resolve) => {
      reached = resolve
    })
    const warnings: unknown[] = []
    const published: EventTrimResult[] = []
    const retention = startEventRetention(
      db,
      () => {
        const worker = new Worker(storageBundle, {
          workerData: { maintenance: { kind: 'trim', file } },
        })
        worker.once('exit', () => {
          exited = true
        })
        return worker
      },
      async (result) => {
        published.push(result)
      },
      (error) => {
        warnings.push(error)
      },
    )
    const pragma = db.pragma.bind(db)
    const spy = vi.spyOn(db, 'pragma').mockImplementation((source, options) => {
      const result = pragma(source, options)
      if (source === 'incremental_vacuum(16)') {
        compactions++
        expect(exited).toBe(true)
        queueMicrotask(() => {
          stopped = retention.stop()
          reached()
        })
      }
      return result
    })
    try {
      retention.firstListAccepted(-600_000)
      await compacting
      await stopped
      expect(compactions).toBe(1)
      expect(db.inTransaction).toBe(false)
      expect(db.open).toBe(true)
      expect(published).toEqual([])
      expect(warnings).toEqual([])
    } finally {
      await retention.stop()
      spy.mockRestore()
      db.close()
    }
  }, 15_000)

  it('a selected batch is deferred when its generation changes or a rebuild starts', () => {
    const db = aHistory(join(aRoot(), 'changed-trim.sqlite'), 1002)
    try {
      const write = eventTrimWriter(db)
      const batch = { session: 'fictional', active: 0, ids: ['0', '1'], before: Date.now() }
      db.prepare(
        "INSERT INTO derived_generation (session_id,active,building,normalizer_version,derived_through,highest,updated_at) VALUES ('fictional',0,1,1,0,1,0)",
      ).run()
      expect(write(batch).changed).toBeNull()
      db.prepare(
        "UPDATE derived_generation SET active=1,building=NULL WHERE session_id='fictional'",
      ).run()
      expect(write(batch).changed).toBeNull()
      expect(db.prepare('SELECT count(*) AS n FROM events').get()).toEqual({ n: 1004 })
    } finally {
      db.close()
    }
  })

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

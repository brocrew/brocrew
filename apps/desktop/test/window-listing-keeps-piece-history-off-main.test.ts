import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { aLibraryHost } from './helpers/files-library-fixture'

it('a window listing reads piece history off the writer connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-listing-history-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  let measuring = false
  const walks: { rows: number; caller: string | undefined }[] = []
  const prepare = db.prepare.bind(db)
  vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.includes("json_remove(payload, '$.sent', '$.given')")) return statement
    const iterate = statement.iterate.bind(statement)
    vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
      const walk = { rows: 0, caller: new Error().stack }
      if (measuring) walks.push(walk)
      for (const row of iterate(...args)) {
        walk.rows++
        yield row
      }
    })
    return statement
  })
  const store = createSessionStore(db)
  store.adopt({
    id: 'holder',
    provider: 'codex',
    sessionId: 'fictional-provider-session',
    cwd: directory,
    profileId: 'fictional',
    createdAt: 1,
    updatedAt: 1,
  })
  store.append(
    'holder',
    0,
    {
      type: 'work_given',
      piece: 'fictional-piece',
      label: 'W1.1',
      parent: 'fictional-root',
      givenBy: 'fictional-giver',
      title: 'Fictional work',
      brief: 'Fictional brief',
    },
    1,
  )
  db.exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 4000)
    INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
    SELECT 'fictional-' || n, 'holder', 0, n, 'status',
           '{"type":"status","state":"idle"}', n + 1 FROM numbers`)
  const engine = new WindowReadEngine(file)
  const queries: string[] = []
  const host = aLibraryHost(directory, {
    store,
    windowReader: {
      read: async (query) => {
        queries.push(query.kind)
        return engine.read(query)
      },
      close: async () => {},
    },
    limitsWriterStamp: limitsWriterSampler(db, () => true),
    windowWriterStamp: windowWriterSampler(db, () => true),
  })
  try {
    const phases: { phase: string; walks: number; rows: number; queries: number }[] = []
    const listing = async (phase: string, title: string | null) => {
      const before = walks.length
      const asked = queries.length
      measuring = true
      const answer = await executeRuntimeCommand(
        host,
        {
          ownerId: 'fictional-window',
          alive: true,
          aPersonIsBehindIt: true,
          send: () => {},
          sendLiveness: () => {},
        },
        { kind: 'listResumable' },
      )
      measuring = false
      phases.push({
        phase,
        walks: walks.length - before,
        rows: walks.slice(before).reduce((sum, walk) => sum + walk.rows, 0),
        queries: queries.length - asked,
      })
      expect(answer).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'holder',
            named: expect.objectContaining({ label: 'W1', title }),
          }),
        ]),
      )
    }
    await listing('cold', null)
    await listing('warm', null)
    const root = store.rootOf('holder')!
    store.append(
      'holder',
      4001,
      {
        type: 'work_retitled',
        piece: root.piece,
        title: 'Changed fictional work',
        by: null,
      },
      4002,
    )
    await listing('after-work-commit', 'Changed fictional work')
    await listing('warm-after-work-commit', 'Changed fictional work')
    console.info(
      JSON.stringify({
        phases,
        queries,
        writerWalks: walks.length,
        writerRows: walks.reduce((sum, walk) => sum + walk.rows, 0),
        callers: walks.map((walk) => walk.caller),
      }),
    )
    expect(walks).toHaveLength(0)
  } finally {
    measuring = false
    await host.closeAll()
    engine.close()
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('the worker reuses unchanged routing folds between committed snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-worker-history-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  store.create({
    id: 'holder',
    provider: 'codex',
    cwd: directory,
    approvalMode: 'ask',
    profileId: 'fictional',
  })
  store.append(
    'holder',
    0,
    {
      type: 'work_given',
      piece: 'fictional-piece',
      label: 'W1.1',
      parent: 'fictional-root',
      givenBy: 'fictional-giver',
      title: 'Fictional work',
      brief: 'Fictional brief',
    },
    1,
  )
  store.append(
    'holder',
    1,
    {
      type: 'request_routed',
      requestId: 'fictional-request',
      to: 'a-person',
    },
    2,
  )
  db.exec(`WITH RECURSIVE numbers(n) AS (SELECT 2 UNION ALL SELECT n + 1 FROM numbers WHERE n < 4001)
    INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
    SELECT 'fictional-' || n, 'holder', 0, n, 'status',
           '{"type":"status","state":"ended"}', n + 1 FROM numbers`)
  const engine = new WindowReadEngine(file)
  const worker = (engine as unknown as { db: AppDatabase }).db
  let walks = 0
  let rows = 0
  const prepare = worker.prepare.bind(worker)
  vi.spyOn(worker, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql)
    if (!sql.includes("json_remove(payload, '$.sent', '$.given')")) return statement
    const iterate = statement.iterate.bind(statement)
    vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
      walks++
      for (const row of iterate(...args)) {
        rows++
        yield row
      }
    })
    return statement
  })
  const readings: { phase: string; walks: number; rows: number; elapsedMs: number }[] = []
  const sample = windowWriterSampler(db, () => true)
  let accepted: { stamp: NonNullable<ReturnType<typeof sample>>; token: string } | undefined
  const read = (phase: string) => {
    const beforeWalks = walks
    const beforeRows = rows
    const started = performance.now()
    const stamp = sample({ kind: 'routes' })!
    const changed = accepted === undefined ? null : sample.changedOwners!(accepted.stamp, stamp)
    const result = engine.read({
      kind: 'routes',
      ...(accepted !== undefined && changed !== null
        ? { reuse: { token: accepted.token, changed: [...changed] } }
        : {}),
    })
    expect(result.kind).toBe('routes')
    if (result.kind === 'routes') accepted = { stamp, token: result.cacheToken! }
    readings.push({
      phase,
      walks: walks - beforeWalks,
      rows: rows - beforeRows,
      elapsedMs: performance.now() - started,
    })
  }
  try {
    read('cold')
    read('unchanged-snapshot')
    store.append(
      'holder',
      4002,
      {
        type: 'work_retitled',
        piece: 'fictional-piece',
        title: 'Changed fictional work',
        by: null,
      },
      4003,
    )
    read('after-work-commit')
    console.info(JSON.stringify({ workerReadings: readings }))
    expect(readings[0]!.rows).toBeGreaterThan(4000)
    expect(readings[1]!.rows).toBe(0)
  } finally {
    engine.close()
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { FakeRuntime } from '@brobot2/runtime'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { bundleAWorker } from './helpers/bundle-a-worker'

const directory = mkdtempSync(join(tmpdir(), 'fictional-kept-files-'))
const db = openDatabase(join(directory, 'fictional.sqlite'))
const root = dirname(fileURLToPath(import.meta.url))
applyMigrations(db, join(root, '../src/main/db/migrations'))
const trace: { sql: string; plan: string[]; returned: number }[] = []
let measuring = false
const counted = new Proxy(db, {
  get(target, key) {
    if (key === 'prepare')
      return (sql: string) => {
        const statement = target.prepare(sql)
        return new Proxy(statement, {
          get(native, method) {
            if (method === 'all' || method === 'get')
              return (...args: unknown[]) => {
                const result = native[method](...args)
                if (measuring)
                  trace.push({
                    sql,
                    plan: (
                      db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args) as { detail: string }[]
                    ).map((row) => row.detail),
                    returned:
                      method === 'all'
                        ? (result as unknown[]).length
                        : result === undefined
                          ? 0
                          : 1,
                  })
                return result
              }
            const value: unknown = Reflect.get(native, method, native)
            return typeof value === 'function' ? value.bind(native) : value
          },
        })
      }
    const value: unknown = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
}) as AppDatabase
const store = createSessionStore(counted)

beforeAll(async () => {
  store.create({
    id: 'fictional-owner',
    provider: 'claude',
    profileId: 'fictional',
    cwd: directory,
    approvalMode: 'ask',
  })
  const parent = store.rootOf('fictional-owner')!
  db.prepare(
    `WITH RECURSIVE noise(n) AS (
    VALUES(0) UNION ALL SELECT n+1 FROM noise WHERE n+1 < 450000
  ) INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
    SELECT 'fictional-event-' || n, 'fictional-owner', 0, n,
      CASE n%3 WHEN 0 THEN 'thinking' WHEN 1 THEN 'activity' ELSE 'unknown' END,
      json_object('type', CASE n%3 WHEN 0 THEN 'thinking' WHEN 1 THEN 'activity' ELSE 'unknown' END), 1
    FROM noise`,
  ).run()
  const piece = 'fictional-piece'
  store.recordGive(
    {
      piece,
      parent: parent.piece,
      number: 1,
      owner: 'fictional-owner',
      givenBy: 'fictional-owner',
      title: 'Original title',
      brief: 'Fictional brief',
      folder: null,
      inputs: [],
    },
    450_000,
    {
      type: 'work_given',
      piece,
      parent: parent.piece,
      label: `${parent.label}.1`,
      givenBy: 'fictional-owner',
      title: 'Original title',
      brief: 'Fictional brief',
    },
    2,
  )
  const input = store.addResource(
    {
      piece,
      role: 'input',
      title: 'Input',
      summary: null,
      name: 'input.md',
      sha256: 'a'.repeat(64),
      bytes: 2,
      addedBy: 'fictional-owner',
    },
    3,
  )
  const result = store.addResource(
    {
      piece,
      role: 'made',
      title: 'Result',
      summary: null,
      name: 'result.md',
      sha256: 'b'.repeat(64),
      bytes: 3,
      addedBy: 'fictional-owner',
    },
    4,
  )
  store.append(
    'fictional-owner',
    450_001,
    {
      type: 'work_replied',
      piece,
      outcome: 'done',
      summary: 'Fictional result',
      resources: [result.resource],
      resultDocument: result.resource,
    },
    5,
  )
  store.append(
    'fictional-owner',
    450_002,
    { type: 'work_retitled', piece, title: 'Current title', by: 'fictional-owner' },
    6,
  )
  store.addResource(
    {
      piece: parent.piece,
      role: 'made',
      title: 'Root file',
      summary: null,
      name: 'root.md',
      sha256: 'c'.repeat(64),
      bytes: 4,
      addedBy: 'fictional-owner',
    },
    7,
  )
  store.create({
    id: 'fictional-other',
    provider: 'codex',
    profileId: 'other',
    cwd: directory,
    approvalMode: 'ask',
  })
  store.addResource(
    {
      piece: store.rootOf('fictional-other')!.piece,
      role: 'made',
      title: 'Outside the tree',
      summary: null,
      name: 'outside.md',
      sha256: 'd'.repeat(64),
      bytes: 1,
      addedBy: 'fictional-owner',
    },
    8,
  )
  await bundleAWorker('src/main/window-reader.worker.ts', directory, 'files-worker.cjs')
  expect(input.resource).not.toBe(result.resource)
}, 60_000)
afterAll(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

it('probes only relevant event types on a 450000-row fictional ledger', () => {
  measuring = true
  trace.length = 0
  const files = store.filesKept({
    scope: 'tree',
    holder: 'fictional-owner',
    givers: ['fictional-owner'],
  })
  measuring = false
  expect(files).toHaveLength(3)
  expect(files.filter((file) => file.label.includes('.')).map((file) => file.pieceTitle)).toEqual([
    'Current title',
    'Current title',
  ])
  const eventReads = trace.filter(({ sql }) => /FROM events\b/.test(sql))
  if (process.env['BROBOT_FILES_EVIDENCE']) console.log(JSON.stringify(eventReads))
  expect(eventReads.length).toBeGreaterThan(2)
  for (const read of eventReads) {
    expect(read.plan.join(' ')).toContain('SEARCH events USING')
    if (read.sql.includes("AND type = 'work_retitled'")) {
      expect(read.plan.join(' ')).toContain(
        'events_kind_owner_idx (type=? AND session_id=? AND generation=?)',
      )
    }
  }
  expect(eventReads.reduce((count, row) => count + row.returned, 0)).toBeLessThan(20)
})

it('the paired worker snapshot equals both original scopes, including files added outside the tree', () => {
  const engine = new WindowReadEngine(join(directory, 'fictional.sqlite'))
  try {
    const paired = engine.read({
      kind: 'files',
      sessionId: 'fictional-owner',
      givers: ['fictional-owner'],
    })
    if (paired.kind !== 'files') throw new Error('wrong worker reply')
    expect(paired.tree).toEqual(
      store.filesKept({ scope: 'tree', holder: 'fictional-owner', givers: ['fictional-owner'] }),
    )
    expect(paired.added).toEqual(
      store.filesKept({ scope: 'conversation', conversation: 'fictional-owner' }),
    )
    expect(paired.tree).toHaveLength(3)
    expect(paired.added).toHaveLength(4)
    expect(paired.tree.some((row) => row.mainResult === true)).toBe(true)
    expect(paired.added.at(-1)?.resource.title).toBe('Outside the tree')
  } finally {
    engine.close()
  }
})

it('the opening IPC uses the native worker and never calls a main-thread file fold', async () => {
  const original = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    createRuntime: () => new FakeRuntime('codex'),
    resolveCwd: () => directory,
    prepareProviderHome: () => directory,
    providerHomePath: () => directory,
    nativeTranscriptPath: () => null,
    exportDirectory: () => directory,
    newSessionId: () => 'fictional-new',
    readProviderConfig: () => ({
      home: directory,
      homeEnv: 'CODEX_HOME',
      model: 'fictional',
      authNote: null,
      files: [],
    }),
  })
  const tree = original.filesKept({ scope: 'tree', conversation: 'fictional-owner' })
  const added = original.filesKept({ scope: 'conversation', conversation: 'fictional-owner' })
  if (!tree.ok || !added.ok) throw new Error('baseline did not answer')
  await original.closeAll()
  const reader = new WindowWorkerReader(
    new Worker(join(directory, 'files-worker.cjs'), {
      workerData: { file: join(directory, 'fictional.sqlite') },
    }),
  )
  const forbidden = vi.fn(() => {
    throw new Error('main-thread file fold')
  })
  const guarded = { ...store, filesKept: forbidden, filesKeptTogether: forbidden }
  const host = new RuntimeHost({
    store: guarded,
    windowReader: reader,
    discoverSessions: NO_DISCOVERY,
    createRuntime: () => new FakeRuntime('codex'),
    resolveCwd: () => directory,
    prepareProviderHome: () => directory,
    providerHomePath: () => directory,
    nativeTranscriptPath: () => null,
    exportDirectory: () => directory,
    newSessionId: () => 'fictional-new',
    readProviderConfig: () => ({
      home: directory,
      homeEnv: 'CODEX_HOME',
      model: 'fictional',
      authNote: null,
      files: [],
    }),
  })
  try {
    const sink = {
      ownerId: 'fictional-window',
      aPersonIsBehindIt: true,
      alive: true,
      send() {},
      sendLiveness() {},
    }
    trace.length = 0
    measuring = true
    const reading = executeRuntimeCommand(host, sink, {
      kind: 'filesKept',
      scope: 'tree',
      conversation: 'fictional-owner',
      withAdded: true,
    })
    measuring = false
    const actual = await reading
    expect(trace.filter(({ sql }) => /FROM events\b/.test(sql))).toEqual([])
    expect(trace.reduce((sum, row) => sum + row.returned, 0)).toBeLessThanOrEqual(1)
    expect(actual).toEqual({ ...tree, added: added.files })
    expect(forbidden).not.toHaveBeenCalled()
    await reader.close()
    await expect(host.filesKeptForWindow('fictional-owner')).rejects.toThrow()
    expect(forbidden).not.toHaveBeenCalled()
  } finally {
    await host.closeAll()
  }
})

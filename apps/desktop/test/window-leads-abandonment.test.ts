import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import {
  WindowReadUnavailable,
  type WindowReadResult,
  WINDOW_READ_BOUNDS,
} from '../src/main/db/window-read-protocol'
import { WindowWorkerReader, WindowReaderLifetime } from '../src/main/db/window-worker-reader'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { bundleAWorker } from './helpers/bundle-a-worker'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ledgerRows = 12_000
let directory: string
let db: AppDatabase
let host: RuntimeHost
let reader: WindowReaderLifetime
let nativeLead: Promise<unknown> | undefined
let leadSignal: AbortSignal | undefined
const pages = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
const sink = {
  ownerId: 'fictional-window',
  alive: true,
  aPersonIsBehindIt: true,
  send: () => {},
  sendLiveness: () => {},
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'fictional-long-leads-'))
  const file = join(directory, 'fixture.sqlite')
  db = openDatabase(file)
  applyMigrations(db, join(root, 'src/main/db/migrations'))
  const store = createSessionStore(db)
  await bundleAWorker('test/fixtures/long-leads.worker.ts', directory, 'long-leads.cjs')
  reader = new WindowReaderLifetime(
    () =>
      new WindowWorkerReader(
        new Worker(join(directory, 'long-leads.cjs'), {
          workerData: { file, pages: pages.buffer },
        }),
      ),
  )
  const runtime = new FakeRuntime('codex', { sessions: new FakeProviderSessions() })
  host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    createRuntime: () => runtime,
    resolveCwd: () => directory,
    prepareProviderHome: () => directory,
    providerHomePath: () => directory,
    nativeTranscriptPath: () => null,
    exportDirectory: () => directory,
    newSessionId: () => 'fictional-reopen',
    windowWriterStamp: windowWriterSampler(db, () => true),
    windowReader: {
      read: (query, signal): Promise<WindowReadResult> => {
        const read = reader.read(query, signal)
        if (query.kind === 'leads') {
          leadSignal = signal
          nativeLead = read.catch((error: unknown) => error)
        }
        return read
      },
      close: () => reader.close(),
    },
    readInstructions: () => ({
      instructions: {
        injected: [],
        agentMemory: [],
        provider: [],
        refused: [],
        note: '',
        recallsReported: false,
        writesReported: true,
        composed: null,
      },
      systemHint: undefined,
      firstTurnLead: 'fictional conversation lead',
    }),
    readProviderConfig: () => ({
      home: directory,
      homeEnv: 'CODEX_HOME',
      model: 'fictional',
      authNote: null,
      files: [],
    }),
  })
  const created = await host.createSession({ provider: 'codex' }, sink)
  await host.close(created.sessionId, sink)
  const from = store.nextOrdinal(created.sessionId)
  const insert = db.prepare(`INSERT INTO events
    (id, session_id, generation, ordinal, type, payload, created_at)
    VALUES (?, ?, 0, ?, 'user_turn', ?, 1000)`)
  db.transaction(() => {
    for (let i = 0; i < ledgerRows; i++)
      insert.run(
        `long-${i}`,
        created.sessionId,
        from + i,
        '{"type":"user_turn","sent":"fictional ordinary words","text":"fictional"}',
      )
  })()
  await reader.read({ kind: 'routes' })
  Atomics.store(pages, 0, 0)
}, 60_000)

afterAll(async () => {
  await host?.closeAll()
  await reader?.close()
  db?.close()
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
})

it('a long-ledger reopen abandons its native scan at the grace and the next window read proceeds', async () => {
  let last = performance.now()
  let mainGapMs = 0
  const heartbeat = setInterval(() => {
    const at = performance.now()
    mainGapMs = Math.max(mainGapMs, at - last)
    last = at
  }, 10)
  try {
    const began = performance.now()
    await host.resumeSession('fictional-reopen', sink)
    const reopenMs = performance.now() - began
    expect(leadSignal?.aborted).toBe(true)
    const pagesAtGrace = Atomics.load(pages, 0)
    expect(pagesAtGrace).toBeGreaterThan(0)
    const queuedAt = performance.now()
    const answer = await reader.read({ kind: 'routes' })
    const queuedMs = performance.now() - queuedAt
    const pagesAfterGrace = Atomics.load(pages, 0) - pagesAtGrace
    expect(answer.kind).toBe('routes')
    expect(await nativeLead).toBeInstanceOf(WindowReadUnavailable)
    expect(pagesAfterGrace).toBeLessThanOrEqual(1)
    expect(reopenMs).toBeGreaterThanOrEqual(950)
    expect(mainGapMs).toBeLessThan(250)
    const result = {
      ledgerRows,
      pageRows: WINDOW_READ_BOUNDS.leadPageRows,
      reopenMs,
      queuedMs,
      mainGapMs,
      pagesAtGrace,
      pagesAfterGrace,
    }
    console.log(JSON.stringify(result))
    const evidence = process.env['BROBOT_LONG_LEADS_MEASUREMENTS']
    if (evidence !== undefined) writeFileSync(evidence, JSON.stringify(result, null, 2) + '\n')
  } finally {
    clearInterval(heartbeat)
  }
}, 30_000)

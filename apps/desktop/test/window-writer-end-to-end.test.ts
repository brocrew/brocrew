import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { slowWindowQueries } from './fixtures/slow-window-queries'
import { bundleAWorker } from './helpers/bundle-a-worker'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const evidence = process.env['BROBOT_WINDOW_END_TO_END']
const baseline = '36a7fed9590bf7816d57eb4abe2bf3865b1e6575'
let directory: string
let Before: typeof RuntimeHost

beforeAll(async () => {
  if (evidence === undefined) return
  directory = mkdtempSync(join(tmpdir(), 'fictional-window-end-to-end-'))
  const baselineHost = join(directory, 'baseline-runtime.ts')
  const baselineRoutes = join(directory, 'baseline-routes.ts')
  for (const [relative, output] of [
    ['src/main/runtime/runtime-host.ts', baselineHost],
    ['src/main/db/window-routing-reads.ts', baselineRoutes],
  ]) {
    if (
      typeof relative !== 'string' ||
      relative.length === 0 ||
      typeof output !== 'string' ||
      output.length === 0
    )
      throw new Error('The baseline source and output paths must be present')
    const source = execFileSync('git', ['show', `${baseline}:apps/desktop/${relative}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
    const absolute = source.replace(
      /\b(from\s+|import\(\s*)['"](\.[^'"]+)['"]/g,
      (_match: string, prefix: string, specifier: string) => {
        const target = resolve(dirname(join(root, relative)), specifier)
        return (
          prefix +
          JSON.stringify(target.endsWith('/db/window-routing-reads') ? baselineRoutes : target)
        )
      },
    )
    writeFileSync(output, absolute)
  }
  for (const [entry, output] of [
    [baselineHost, 'baseline.cjs'],
    [join(root, 'test/fixtures/window-busy-writer.worker.ts'), 'worker.cjs'],
  ]) {
    if (
      typeof entry !== 'string' ||
      entry.length === 0 ||
      typeof output !== 'string' ||
      output.length === 0
    )
      throw new Error('The bundle entry and output paths must be present')
    await bundleAWorker(entry, directory, output)
  }
  Before = (require(join(directory, 'baseline.cjs')) as { RuntimeHost: typeof RuntimeHost })
    .RuntimeHost
}, 60_000)

afterAll(() => {
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
})

it.skipIf(evidence === undefined)(
  'main-thread reads plus live writes cost less at 5/s and 20/s',
  async () => {
    const measurements: {
      rate: number
      mode: string
      mainThreadMs: number
      readsMs: number
      writesMs: number
      rowsWritten: number
      workerReads: number
      fallbacks: number
      elapsedMs: number
    }[] = []
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const restore = slowWindowQueries(() => {}, 700_000)
    try {
      for (const rate of [5, 20])
        for (const mode of ['before', 'after'] as const) {
          const file = join(directory, `${rate}-${mode}.sqlite`)
          const db = openDatabase(file)
          let host: RuntimeHost | undefined
          let reader: WindowWorkerReader | undefined
          let finishedWriting: Promise<void> | undefined
          try {
            applyMigrations(db, join(root, 'src/main/db/migrations'))
            const store = createSessionStore(db)
            store.create({
              id: 'fictional',
              provider: 'codex',
              cwd: directory,
              approvalMode: 'ask',
              profileId: 'fictional',
            })
            const insert = db.prepare(`INSERT INTO events
          (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, 'fictional', 0, ?, ?, ?, 1000)`)
            db.transaction(() => {
              for (let i = 0; i < 5000; i++)
                insert.run(`noise-${i}`, i, 'text', '{"type":"text","text":"fictional noise"}')
            })()
            const ownedReader = new WindowWorkerReader(
              new Worker(join(directory, 'worker.cjs'), { workerData: { file } }),
            )
            reader = ownedReader
            const sample = mode === 'after' ? windowWriterSampler(db, () => true) : undefined
            if (sample !== undefined)
              for (let i = 0; i < 8; i++)
                sample({
                  kind: 'leads',
                  sessionId: 'fictional',
                  before: Number.MAX_SAFE_INTEGER - i,
                  opening: 'fictional',
                  historicalOpening: 'fictional',
                })
            const Constructor = mode === 'before' ? Before : RuntimeHost
            let workerReads = 0
            host = new Constructor({
              store,
              windowReader: {
                read: (query) => {
                  workerReads++
                  return ownedReader.read(query)
                },
                close: () => ownedReader.close(),
              },
              limitsWriterStamp: limitsWriterSampler(db, () => true),
              windowWriterStamp: sample,
              createRuntime: () => new FakeRuntime('codex'),
              discoverSessions: NO_DISCOVERY,
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
            store.append(
              'fictional',
              5000,
              {
                type: 'question_asked',
                requestId: 'question',
                prompt: 'fictional choice',
                questions: [{ id: 'part', prompt: 'fictional choice', options: [] }],
              },
              1000,
            )
            store.append(
              'fictional',
              5001,
              { type: 'request_routed', requestId: 'question', to: 'a-person' },
              1000,
            )
            const expected = host.questionsForAPerson()
            expect(expected.rows).toHaveLength(1)
            await host.readForWindow(() => host!.questionsForAPerson())
            workerReads = 0
            const firstWritten = store.nextOrdinal('fictional')
            warning.mockClear()
            const direct = vi.spyOn(store, 'questionsAPersonMustAnswer')
            let readsMs = 0
            let writesMs = 0
            let rowsWritten = 0
            const began = performance.now()
            const utilization = performance.eventLoopUtilization()
            const due = Array.from({ length: rate * 5 }, (_, i) => 75 + (i * 1000) / rate)
            finishedWriting = new Promise<void>((done) => {
              const writeDue = () => {
                while (rowsWritten < due.length && due[rowsWritten]! <= performance.now() - began) {
                  const start = performance.now()
                  store.append(
                    'fictional',
                    firstWritten + rowsWritten,
                    { type: 'assistant_message', text: 'fictional stream' },
                    2000 + rowsWritten,
                  )
                  writesMs += performance.now() - start
                  rowsWritten++
                }
                if (rowsWritten === due.length) done()
                else
                  setTimeout(writeDue, Math.max(0, due[rowsWritten]! - (performance.now() - began)))
              }
              writeDue()
            })
            for (let i = 0; i < 8; i++) {
              await new Promise<void>((done) =>
                setTimeout(done, Math.max(0, i * 600 - (performance.now() - began))),
              )
              const answer = await host.readForWindow(() => {
                const start = performance.now()
                const result = host!.questionsForAPerson()
                readsMs += performance.now() - start
                return result
              })
              expect(answer).toEqual(expected)
            }
            await finishedWriting
            measurements.push({
              rate,
              mode,
              mainThreadMs: performance.eventLoopUtilization(utilization).active,
              readsMs,
              writesMs,
              rowsWritten,
              workerReads,
              fallbacks: direct.mock.calls.length,
              elapsedMs: performance.now() - began,
            })
            direct.mockRestore()
          } finally {
            await finishedWriting?.catch(() => {})
            await host?.closeAll()
            await reader?.close()
            db.close()
          }
        }
      if (evidence !== undefined)
        writeFileSync(
          evidence,
          JSON.stringify(
            {
              baseline,
              fixtureRows: 5002,
              workerReplyMs: 200,
              mainNativeDelayIterations: 700_000,
              measurements,
            },
            null,
            2,
          ) + '\n',
        )
      for (const rate of [5, 20]) {
        const before = measurements.find((row) => row.rate === rate && row.mode === 'before')!
        const after = measurements.find((row) => row.rate === rate && row.mode === 'after')!
        expect(before.fallbacks).toBeGreaterThan(0)
        expect(after.fallbacks).toBe(0)
        expect(after.rowsWritten).toBe(before.rowsWritten)
        expect(after.mainThreadMs).toBeLessThan(before.mainThreadMs)
      }
    } finally {
      restore()
      warning.mockRestore()
    }
  },
  120_000,
)

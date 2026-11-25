import { heartbeatsDuringRead } from './helpers/heartbeats-during-read'
import { canonicalWindowFacts } from './helpers/canonical-window-facts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { MessageChannel, Worker, type MessagePort } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { LimitsReadEngine } from '../src/main/db/limits-read-engine'
import { LimitsWorkerTransport } from '../src/main/db/limits-worker-transport'
import type { LimitsReadInput } from '../src/main/db/limits-read-protocol'
import { slowWindowQueries, type NativeStatementInterval } from './fixtures/slow-window-queries'
import { bundleAWorker } from './helpers/bundle-a-worker'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const opening = 'Composed by BroCrew for this conversation at this launch:'
const leads = {
  kind: 'leads' as const,
  sessionId: 'fictional',
  opening,
  historicalOpening: opening,
  before: Number.MAX_SAFE_INTEGER,
}

describe('real SQLite window reads leave the caller responsive', () => {
  let directory: string
  let db: AppDatabase
  let file: string
  let windowEngine: WindowReadEngine
  let limitsEngine: LimitsReadEngine
  let windowReader: WindowWorkerReader
  let limitsReader: LimitsWorkerTransport
  const ports: MessagePort[] = []
  const measurements: unknown[] = []
  let recordStatement: ((interval: NativeStatementInterval) => void) | undefined
  let readFinished: (() => void) | undefined
  let operation = 0

  beforeAll(async () => {
    expect(process.versions.node.split('.')[0]).toBe('24')
    directory = mkdtempSync(join(tmpdir(), 'fictional-window-native-'))
    file = join(directory, 'fictional.sqlite')
    db = openDatabase(file)
    applyMigrations(db, join(root, 'src/main/db/migrations'))
    const store = createSessionStore(db)
    store.create({
      id: 'fictional',
      provider: 'codex',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    const at = Date.now()
    const insert = db.prepare(
      'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
    )
    for (const [n, event] of [
      {
        type: 'question_asked',
        requestId: 'fictional-question',
        prompt: 'Which option?',
        questions: [],
      },
      { type: 'request_routed', requestId: 'fictional-question', to: 'a-person' },
      { type: 'user_turn', sent: opening + '\n\nFictional words', text: 'Fictional words' },
      { type: 'error', message: 'claude is rate-limited (five_hour)', fatal: false },
    ].entries())
      insert.run(`fixture-${n}`, 'fictional', n, event.type, JSON.stringify(event), at)
    // Large irrelevant histories make any accidental full-ledger materialization visible.
    const noise = JSON.stringify({ type: 'text', text: 'fictional noise '.repeat(256) })
    db.transaction(() => {
      for (let n = 4; n < 5004; n++) insert.run(`fixture-${n}`, 'fictional', n, 'text', noise, at)
    })()
    windowEngine = new WindowReadEngine(file)
    limitsEngine = new LimitsReadEngine(file)
    await bundleAWorker(
      'test/fixtures/slow-window-native.worker.ts',
      directory,
      'window-native.cjs',
    )
    function worker(reader: string) {
      const channel = new MessageChannel()
      ports.push(channel.port1)
      channel.port1.on('message', (message) => {
        if (message.type === 'native-statement') recordStatement?.(message.interval)
        if (message.type === 'native-read-finished') readFinished?.()
      })
      return new Worker(join(directory, 'window-native.cjs'), {
        workerData: { file, reader, probe: channel.port2 },
        transferList: [channel.port2],
      })
    }
    windowReader = new WindowWorkerReader(worker('window'))
    limitsReader = new LimitsWorkerTransport(worker('limits'))
  }, 60_000)

  afterAll(async () => {
    await windowReader?.close()
    await limitsReader?.stop()
    for (const port of ports) port.close()
    windowEngine?.close()
    limitsEngine?.close()
    db?.close()
    const evidence = process.env['BROBOT_WINDOW_READ_MEASUREMENTS']
    if (evidence !== undefined)
      writeFileSync(evidence, JSON.stringify(measurements, null, 2) + '\n')
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  })

  async function measure<T>(name: string, read: () => T | Promise<T>, inWorker = false) {
    let beats = 0
    const heartbeats: number[] = []
    const statements: NativeStatementInterval[] = []
    recordStatement = (interval) => statements.push(interval)
    const readDone = inWorker
      ? new Promise<void>((resolve) => {
          readFinished = resolve
        })
      : undefined
    const restore = inWorker ? undefined : slowWindowQueries(() => {}, undefined, recordStatement)
    let last = performance.now()
    let longestGap = 0
    const heartbeat = setInterval(() => {
      const now = performance.now()
      heartbeats.push(performance.timeOrigin + now)
      longestGap = Math.max(longestGap, now - last)
      last = now
      beats++
    }, 10)
    const began = performance.now()
    try {
      const result = await read()
      await readDone
      longestGap = Math.max(longestGap, performance.now() - last)
      const elapsed = performance.now() - began
      const evidence = {
        name,
        elapsedMs: elapsed,
        longestGapMs: longestGap,
        beats,
        statements,
        interiorBeats: statements.reduce(
          (total, interval) => total + heartbeatsDuringRead(heartbeats, interval),
          0,
        ),
        fixtureRows: 5004,
      }
      measurements.push(evidence)
      console.log(JSON.stringify(evidence))
      return { result, ...evidence }
    } finally {
      clearInterval(heartbeat)
      restore?.()
      recordStatement = undefined
      readFinished = undefined
    }
  }

  it.each(['routes', 'leads'] as const)(
    '%s: the same canonical answer, with caller progress during native work',
    async (kind) => {
      const query = kind === 'routes' ? { kind } : leads
      const before = await measure(`before-${kind}`, () => windowEngine.read(query))
      const after = await measure(`after-${kind}`, () => windowReader.read(query), true)
      if (kind === 'routes')
        expect(canonicalWindowFacts(after.result)).toEqual(canonicalWindowFacts(before.result))
      else expect(after.result).toEqual(before.result)
      expect(before.statements.length).toBeGreaterThan(0)
      expect(before.interiorBeats).toBe(0)
      expect(after.interiorBeats).toBeGreaterThan(0)
    },
  )

  it('limits: the same canonical walls, without blocking the caller', async () => {
    const input: LimitsReadInput = {
      operation: ++operation,
      databaseEpoch: 1,
      signInEpoch: 1,
      capturedAt: Date.now(),
      signInChangedAt: {},
      usage: {},
    }
    const before = await measure('before-providerLimitsSeen', () => limitsEngine.read(input))
    const after = await measure('after-providerLimitsSeen', () => limitsReader.execute(input), true)
    expect(after.result.canonical).toEqual((before.result as typeof after.result).canonical)
    expect(before.statements.length).toBeGreaterThan(0)
    expect(before.interiorBeats).toBe(0)
    expect(after.interiorBeats).toBeGreaterThan(0)
  })
})

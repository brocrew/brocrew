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
import { slowWindowQueries } from './fixtures/slow-window-queries'
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
  let nativeStart: (() => void) | undefined
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
      channel.port1.on('message', () => nativeStart?.())
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

  async function measure<T>(name: string, read: () => T | Promise<T>, tailMs = 0) {
    let beats = 0
    let inputHandled = false
    let inputTimer: ReturnType<typeof setTimeout> | undefined
    nativeStart = () => {
      inputTimer ??= setTimeout(() => {
        inputHandled = true
      }, 30)
    }
    let last = performance.now()
    let longestGap = 0
    const heartbeat = setInterval(() => {
      const now = performance.now()
      longestGap = Math.max(longestGap, now - last)
      last = now
      beats++
    }, 10)
    const began = performance.now()
    try {
      const result = await read()
      const until = performance.now() + tailMs
      while (performance.now() < until) {
        /* Planted completion work. */
      }
      longestGap = Math.max(longestGap, performance.now() - last)
      const elapsed = performance.now() - began
      const evidence = {
        name,
        elapsedMs: elapsed,
        longestGapMs: longestGap,
        beats,
        inputHandled,
        tailMs,
        fixtureRows: 5004,
      }
      measurements.push(evidence)
      console.log(JSON.stringify(evidence))
      return { result, ...evidence }
    } finally {
      clearInterval(heartbeat)
      clearTimeout(inputTimer)
      nativeStart = undefined
    }
  }

  it.each(['routes', 'leads'] as const)(
    '%s: the same canonical answer, with input handled during native work',
    async (kind) => {
      const query = kind === 'routes' ? { kind } : leads
      const restore = slowWindowQueries(() => nativeStart?.())
      let before: Awaited<ReturnType<typeof measure>>
      try {
        before = await measure(`before-${kind}`, () => windowEngine.read(query))
      } finally {
        restore()
      }
      const after = await measure(`after-${kind}`, () => windowReader.read(query))
      expect(after.result).toEqual(before.result)
      expect(before.longestGapMs).toBeGreaterThan(250)
      expect(before.inputHandled).toBe(false)
      expect(after.longestGapMs).toBeLessThan(250)
      expect(after.beats).toBeGreaterThan(10)
      expect(after.inputHandled).toBe(true)
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
    const restore = slowWindowQueries(() => nativeStart?.())
    let before: Awaited<ReturnType<typeof measure>>
    try {
      before = await measure('before-providerLimitsSeen', () => limitsEngine.read(input))
    } finally {
      restore()
    }
    const after = await measure('after-providerLimitsSeen', () => limitsReader.execute(input))
    expect(after.result.canonical).toEqual((before.result as typeof after.result).canonical)
    expect(before.longestGapMs).toBeGreaterThan(250)
    expect(before.inputHandled).toBe(false)
    expect(after.longestGapMs).toBeLessThan(250)
    expect(after.inputHandled).toBe(true)
    expect(after.beats).toBeGreaterThan(10)
  })

  it('counts reply handling in its gap and detects a planted completion stall', async () => {
    const tailed = await measure('planted-reply-tail', () => windowReader.read(leads), 350)
    expect(tailed.longestGapMs).toBeGreaterThanOrEqual(350)
    const clean = await measure('after-reply-tail-removed', () => windowReader.read(leads))
    expect(clean.longestGapMs).toBeLessThan(250)
  })
})

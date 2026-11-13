import Database from 'better-sqlite3'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { serialize } from 'node:v8'
import { expect, it, vi } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeStatesMessage } from '../src/shared/runtime-ipc'

it('keeps nine live agents responsive through listings and real state notices', async () => {
  const mainHistory: { sql: string; rows: number; caller: string }[] = []
  let measuring = false
  const nativePrepare = Database.prototype.prepare
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (sql: string) {
    const statement = nativePrepare.call(this, sql)
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || !/\bevents\b/i.test(sql) || !/\bpayload\b/i.test(sql))
      return statement
    const record = () => {
      const caller = new Error().stack ?? ''
      const row = { sql, rows: 0, caller }
      if (measuring && /theListing|statesThatMoved|whatWasKept/.test(caller)) mainHistory.push(row)
      return row
    }
    return new Proxy(statement, { get(native, key) {
      if (key === 'iterate') return function* (...args: unknown[]) {
        const read = record()
        for (const row of native.iterate(...args)) { read.rows++; yield row }
      }
      if (key === 'get') return (...args: unknown[]) => {
        const read = record(); const value = native.get(...args)
        read.rows = value === undefined ? 0 : 1; return value
      }
      if (key === 'all') return (...args: unknown[]) => {
        const read = record(); const value = native.all(...args)
        read.rows = value.length; return value
      }
      const value: unknown = Reflect.get(native, key, native)
      return typeof value === 'function' ? value.bind(native) : value
    } })
  })
  const world = aServiceWorld()
  const pushed: RuntimeStatesMessage[] = []
  const readings: { kind: string; queries: number; rows: number; elapsedMs: number; bytes: number }[] = []
  const bundle = await bundleAWorker('test/helpers/measured-window-worker.ts', world.folder, 'measured-window.cjs')
  const worker = new Worker(bundle, { workerData: { file: join(world.folder, 'brobot2.sqlite') },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } })
  worker.on('message', (message) => {
    if (message.type === 'read') readings.push({ kind: message.result.kind,
      ...message.measurement, bytes: serialize(message.result).byteLength })
  })
  const reader = new WindowWorkerReader(worker)
  let release!: () => void
  const ready = new Promise<void>((resolve) => { release = resolve })
  const host = world.aHost({ servicesOn: false,
    windowReader: { read: async (query, signal) => { await ready; return reader.read(query, signal) },
      close: () => reader.close() },
    windowWriterStamp: windowWriterSampler(world.db, () => true),
    limitsWriterStamp: limitsWriterSampler(world.db, () => true),
    statesMoved: (message) => pushed.push(message),
  })
  const gaps: number[] = []
  let last = performance.now()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  try {
    const ids: string[] = []
    for (let n = 0; n < 9; n++) {
      const profile = `fictional-agent-${n}`
      world.anAgent(profile, 'normal')
      ids.push(await world.aPersonOpens(host, profile))
    }
    world.clockStep = 0
    world.db.transaction(() => {
      for (const id of ids) {
        const start = world.store.nextOrdinal(id)
        const root = world.store.rootOf(id)!
        world.store.append(id, start, { type: 'work_given', piece: `${id}-piece`,
          label: `${root.label}.1`, parent: root.piece, givenBy: ids[0]!,
          title: 'Fictional child', brief: 'A large fictional brief. '.repeat(2000) }, world.clock)
        world.db.prepare(`WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 4000)
          INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
          SELECT ? || '-' || value, ?, 0, ? + value, 'status',
            '{"type":"status","state":"idle"}', ? FROM n`).run(`seed-${id}`, id, start, world.clock)
      }
    })()
    readings.length = 0
    measuring = true
    last = performance.now()
    heartbeat = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now }, 5)
    release()
    const phases: { phase: string; elapsedMs: number; reads: number; rows: number }[] = []
    const list = async (phase: string) => {
      const before = readings.length
      const started = performance.now()
      const answer = await executeRuntimeCommand(host, world.window, { kind: 'listResumable' })
      expect(Array.isArray(answer)).toBe(true)
      expect(answer).toHaveLength(9)
      if (phase.includes('commit')) expect(answer).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: ids[0], named: expect.objectContaining({ title: 'Changed fictional title' }) }),
      ]))
      phases.push({ phase, elapsedMs: performance.now() - started, reads: readings.length - before,
        rows: readings.slice(before).reduce((sum, one) => sum + one.rows, 0) })
    }
    await list('cold')
    await list('warm')
    const beforePush = pushed.length
    for (const { handle } of world.handles)
      handle.simulateBackgroundWork({ running: [{ id: 'fictional-job', description: 'Fictional running job' }] })
    await vi.waitFor(() => expect(new Set(pushed.slice(beforePush).flatMap((p) => p.moved.map((m) => m.conversation))).size).toBe(9))
    await list('after-nine-notices')
    const root = world.store.rootOf(ids[0]!)!
    world.store.append(ids[0]!, world.store.nextOrdinal(ids[0]!), {
      type: 'work_retitled', piece: root.piece, title: 'Changed fictional title', by: null,
    }, world.clock)
    await list('after-one-owner-commit')
    await list('warm-after-commit')
    await new Promise((resolve) => setTimeout(resolve, 20))
    console.info(JSON.stringify({ phases, readings, mainHistory, heartbeat: {
      count: gaps.length, maxMs: Math.max(...gaps),
      p95Ms: [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * .95)],
    } }))
    expect(mainHistory).toEqual([])
    expect(gaps.length).toBeGreaterThan(0)
    expect(readings.some((one) => one.kind === 'publication')).toBe(true)
    expect(Math.max(...readings.map((one) => one.bytes))).toBeLessThan(9 * 2000 * 24)
  } finally {
    release()
    measuring = false
    if (heartbeat !== undefined) clearInterval(heartbeat)
    await host.closeAll()
    await reader.close()
    await world.cleanUp()
    vi.restoreAllMocks()
  }
}, 60_000)

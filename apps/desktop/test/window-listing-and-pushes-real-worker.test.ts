import Database from 'better-sqlite3'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { loadavg } from 'node:os'
import { PERSONS_PARTS } from '../src/shared/persons-published'
import { serialize } from 'node:v8'
import { expect, it, vi } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeStatesMessage } from '../src/shared/runtime-ipc'

it('measures window reads with 1960 conversations and nine live agents', async () => {
  const previousStackLimit = Error.stackTraceLimit
  Error.stackTraceLimit = 50
  const mainHistory: { sql: string; rows: number; caller: string }[] = []
  const otherMainHistory: { sql: string; rows: number; caller: string; phase: string }[] = []
  let phase = 'startup'
  let measuring = false
  const nativePrepare = Database.prototype.prepare
  vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (
    this: Database.Database,
    sql: string,
  ) {
    const statement = nativePrepare.call(this, sql) as Database.Statement<unknown[], unknown>
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || !/\bevents\b/i.test(sql) || !/\bpayload\b/i.test(sql))
      return statement
    const record = () => {
      const caller = new Error().stack ?? ''
      const row = { sql, rows: 0, caller, phase }
      if (measuring) {
        if (
          /theListing|statesThatMoved|whatWasKept|personsQueue|ForAPerson/.test(caller) &&
          !/reconciliationReading|reconcileWork/.test(caller)
        )
          mainHistory.push(row)
        else otherMainHistory.push(row)
      }
      return row
    }
    return new Proxy(statement, {
      get(native, key) {
        if (key === 'iterate')
          return function* (...args: unknown[]) {
            const read = record()
            for (const row of native.iterate(...args)) {
              read.rows++
              yield row
            }
          }
        if (key === 'get')
          return (...args: unknown[]) => {
            const read = record()
            const value = native.get(...args)
            read.rows = value === undefined ? 0 : 1
            return value
          }
        if (key === 'all')
          return (...args: unknown[]) => {
            const read = record()
            const value = native.all(...args)
            read.rows = value.length
            return value
          }
        const value: unknown = Reflect.get(native, key, native)
        return typeof value === 'function' ? value.bind(native) : value
      },
    })
  })
  const world = aServiceWorld()
  const pushed: RuntimeStatesMessage[] = []
  const readings: {
    kind: string
    queries: number
    rows: number
    elapsedMs: number
    bytes: number
  }[] = []
  const bundle = await bundleAWorker(
    'test/helpers/measured-window-worker.ts',
    world.folder,
    'measured-window.cjs',
  )
  const worker = new Worker(bundle, {
    workerData: { file: join(world.folder, 'brobot2.sqlite') },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
  })
  const workerReady = new Promise<void>((resolve) =>
    worker.on('message', (message) => {
      if (message.type === 'ready') resolve()
    }),
  )
  worker.on('message', (message) => {
    if (message.type === 'read')
      readings.push({
        kind: message.result.kind,
        ...message.measurement,
        bytes: serialize(message.result).byteLength,
      })
  })
  const reader = new WindowWorkerReader(worker)
  let release!: () => void
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })
  const host = world.aHost({
    servicesOn: false,
    windowReader: {
      read: async (query, signal) => {
        await ready
        return reader.read(query, signal)
      },
      close: () => reader.close(),
    },
    windowWriterStamp: windowWriterSampler(world.db, () => true),
    limitsWriterStamp: limitsWriterSampler(world.db, () => true),
    statesMoved: (message) => pushed.push(message),
  })
  const incidentChecks: unknown[] = []
  const inspected = host as unknown as {
    publicationSeq: number
    windowIncidentsKept?: { stamp: {revision:bigint, schemaVersion?:bigint, dataVersion:bigint} }
    sampleWindowWriter(query: {kind:'incidents'}): {revision:bigint, schemaVersion?:bigint, dataVersion:bigint} | null
    stampedIncidents(): {seq:number}
    personsQueueAssembled(incidents: {seq:number} | null): unknown
    incidentsForWindow(compose:()=>unknown): Promise<unknown>
  }
  const stamp = (one: ReturnType<typeof inspected.sampleWindowWriter> | undefined) => one == null ? null :
    [String(one.revision), String(one.schemaVersion), String(one.dataVersion)]
  const stamped = inspected.stampedIncidents.bind(host)
  inspected.stampedIncidents = () => {
    const result = stamped()
    incidentChecks.push({where:'composed', seq:result.seq, current:inspected.publicationSeq})
    return result
  }
  const assembled = inspected.personsQueueAssembled.bind(host)
  inspected.personsQueueAssembled = (incidents) => {
    const result = assembled(incidents)
    incidentChecks.push({where:'assembled', seq:incidents?.seq, current:inspected.publicationSeq,
      kept:stamp(inspected.windowIncidentsKept?.stamp), currentStamp:stamp(inspected.sampleWindowWriter({kind:'incidents'}))})
    return result
  }
  const incidentsRead = inspected.incidentsForWindow.bind(host)
  inspected.incidentsForWindow = async (compose) => {
    try { return await incidentsRead(compose) } catch(error) {
      incidentChecks.push({where:'read-failed',error:String(error)})
      throw error
    }
  }
  const gaps: number[] = []
  const longGaps: { phase: string; elapsedMs: number }[] = []
  let last = performance.now()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let streaming: ReturnType<typeof setInterval> | undefined
  const laneLoad = loadavg()
  try {
    const ids: string[] = []
    for (let n = 0; n < 9; n++) {
      const profile = `fictional-agent-${n}`
      world.anAgent(profile, 'normal')
      ids.push(await world.aPersonOpens(host, profile))
    }
    const allIds = [...ids]
    world.db.transaction(() => {
      for (let n = ids.length; n < 1960; n++) {
        const id = `fictional-recorded-${n}`
        world.store.create({
          id,
          provider: 'codex',
          profileId: 'fictional-recorded',
          cwd: world.folder,
          approvalMode: 'ask',
        })
        allIds.push(id)
      }
    })()
    world.clockStep = 0
    world.db.transaction(() => {
      for (const id of ids) {
        const start = world.store.nextOrdinal(id)
        const root = world.store.rootOf(id)!
        world.store.append(
          id,
          start,
          {
            type: 'work_given',
            piece: `${id}-piece`,
            label: `${root.label}.1`,
            parent: root.piece,
            givenBy: ids[0]!,
            title: 'Fictional child',
            brief: 'A large fictional brief. '.repeat(2000),
          },
          world.clock,
        )
        world.db
          .prepare(
            `WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 4000)
          INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
          SELECT ? || '-' || value, ?, 0, ? + value, 'status',
            '{"type":"status","state":"idle"}', ? FROM n`,
          )
          .run(`seed-${id}`, id, start, world.clock)
      }
    })()
    world.db.transaction(() => {
      const addWork = world.db.prepare(`INSERT INTO work
        (id, parent_id, number, owner_session_id, given_by_session_id, title, brief, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      for (let n = 0; n < 5108; n++) {
        const owner = allIds[n % allIds.length]!
        const root = world.store.rootOf(owner)!
        const piece = n < 9 ? `${owner}-piece` : `fictional-piece-${n}`
        const number = Math.floor(n / allIds.length) + 1
        addWork.run(
          piece,
          root.piece,
          number,
          owner,
          ids[0],
          'Fictional child',
          'Fictional brief',
          world.clock,
        )
        if (n >= 9) {
          world.store.append(
            owner,
            world.store.nextOrdinal(owner),
            {
              type: 'work_given',
              piece,
              label: `${root.label}.${number}`,
              parent: root.piece,
              givenBy: ids[0]!,
              title: 'Fictional child',
              brief: 'Fictional brief',
            },
            world.clock,
          )
          world.store.append(
            owner,
            world.store.nextOrdinal(owner),
            { type: 'work_closed', piece, by: ids[0]! },
            world.clock,
          )
        }
      }
    })()
    const setupStarted = performance.now()
    for (const { handle } of world.handles)
      handle.simulateThinking({ text: 'Fictional active stream starts', redacted: false })
    // Let the independent startup reconciler finish before measuring the window read boundary.
    await new Promise<void>((resolve) => setImmediate(resolve))
    await workerReady
    const setupSettledMs = performance.now() - setupStarted
    const population = {
      total: allIds.length,
      active: ids.length,
      workRows: (world.db.prepare('SELECT count(*) AS n FROM work').get() as { n: number }).n,
    }
    readings.length = 0
    measuring = true
    last = performance.now()
    heartbeat = setInterval(() => {
      const now = performance.now()
      const elapsedMs = now - last
      gaps.push(Math.max(0, elapsedMs - 10))
      if (elapsedMs > 30) longGaps.push({ phase, elapsedMs })
      last = now
    }, 10)
    release()
    const phases: { phase: string; elapsedMs: number; reads: number; rows: number }[] = []
    const list = async (label: string) => {
      phase = label
      const before = readings.length
      const started = performance.now()
      const answer = await executeRuntimeCommand(host, world.window, { kind: 'listResumable' })
      expect(Array.isArray(answer)).toBe(true)
      expect(answer).toHaveLength(9)
      if (phase.includes('commit'))
        expect(answer).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sessionId: ids[0],
              named: expect.objectContaining({ title: 'Changed fictional title' }),
            }),
          ]),
        )
      phases.push({
        phase,
        elapsedMs: performance.now() - started,
        reads: readings.length - before,
        rows: readings.slice(before).reduce((sum, one) => sum + one.rows, 0),
      })
    }
    await list('cold')
    await list('warm')
    expect(
      await executeRuntimeCommand(host, world.window, { kind: 'listUnresumable' }),
    ).toHaveLength(1951)
    const beforePush = pushed.length
    phase = 'nine-provider-notices'
    for (const { handle } of world.handles)
      handle.simulateBackgroundWork({
        running: [{ id: 'fictional-job', description: 'Fictional running job' }],
      })
    await vi.waitFor(
      () =>
        expect(
          new Set(pushed.slice(beforePush).flatMap((p) => p.moved.map((m) => m.conversation))).size,
        ).toBe(9),
      { timeout: 10_000 },
    )
    await list('after-nine-notices')
    const root = world.store.rootOf(ids[0]!)!
    phase = 'one-owner-write'
    world.store.append(
      ids[0]!,
      world.store.nextOrdinal(ids[0]!),
      {
        type: 'work_retitled',
        piece: root.piece,
        title: 'Changed fictional title',
        by: null,
      },
      world.clock,
    )
    await list('after-one-owner-commit')
    await list('warm-after-commit')
    const failures: string[] = []
    let acceptedListings = 0
    let acceptedQueues = 0
    let streamRounds = 0
    const beforeLoadPush = pushed.length
    streaming = setInterval(() => {
      streamRounds++
      for (const { handle } of world.handles)
        handle.simulateThinking({ text: 'Fictional stream text', redacted: false })
    }, 20)
    phase = 'concurrent-stream-and-work'
    for (let round = 0; round < 6; round++) {
      const { handle } = world.handles[round % world.handles.length]!
      handle.simulateBackgroundWork({
        running: [{ id: `fictional-job-${round}`, description: 'Fictional ordinary work' }],
      })
      await Promise.all([
        executeRuntimeCommand(host, world.window, { kind: 'listResumable' })
          .then((answer) => {
            if (Array.isArray(answer) && answer.length === 9) acceptedListings++
            else failures.push('listing did not answer')
          })
          .catch((error: unknown) => failures.push(`listing: ${String(error)}`)),
        host
          .personsQueue()
          .then((answer) => {
            if ('refused' in answer) failures.push(`queue: ${answer.refused}`)
            else {
              const missing = PERSONS_PARTS.filter((part) => answer[part] === null)
              if (missing.length) failures.push(`queue parts: ${missing.join(', ')}`)
              else acceptedQueues++
            }
          })
          .catch((error: unknown) => failures.push(`queue: ${String(error)}`)),
      ])
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    clearInterval(streaming)
    streaming = undefined
    await new Promise((resolve) => setTimeout(resolve, 40))
    const summarize = (calls: typeof mainHistory) => ({
      queries: calls.length,
      rows: calls.reduce((sum, one) => sum + one.rows, 0),
      examples: [...new Map(calls.map((one) => [one.sql, one])).values()].map((one) => ({
        sql: one.sql,
        caller: one.caller,
      })),
    })
    console.info(
      JSON.stringify({
        phases,
        readings,
        incidentChecks,
        mainHistory: summarize(mainHistory),
        otherMainHistory: summarize(otherMainHistory),
        longGaps,
        laneLoad,
        population,
        setupSettledMs,
        load: {
          acceptedListings,
          acceptedQueues,
          streamRounds,
          pushes: pushed.length - beforeLoadPush,
          failures,
        },
        heartbeat: {
          count: gaps.length,
          maxAddedMs: Math.max(...gaps),
          p95AddedMs: [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)],
        },
      }),
    )
    expect(mainHistory.length).toBe(0)
    expect(gaps.length).toBeGreaterThan(0)
    expect(failures).toEqual([])
    expect(acceptedListings).toBe(6)
    expect(acceptedQueues).toBe(6)
    expect(pushed.length - beforeLoadPush).toBeGreaterThan(0)
    expect([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)]).toBeLessThanOrEqual(25)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(100)
    expect(pushed.length).toBeGreaterThan(0)
    expect(
      Math.max(...readings.filter((one) => one.kind !== 'incidents').map((one) => one.bytes)),
    ).toBeLessThan(4 * 1024 * 1024)
  } finally {
    release()
    measuring = false
    if (streaming !== undefined) clearInterval(streaming)
    if (heartbeat !== undefined) clearInterval(heartbeat)
    await host.closeAll()
    await reader.close()
    await world.cleanUp()
    Error.stackTraceLimit = previousStackLimit
    vi.restoreAllMocks()
  }
}, 60_000)

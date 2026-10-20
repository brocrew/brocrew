import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, rowsUnreadOnce, type SessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowRoutingReads } from '../src/main/db/window-routing-reads'
import {
  WindowReaderLifetime,
  WindowWorkerReader,
  type WindowReadWorker,
} from '../src/main/db/window-worker-reader'
import {
  WINDOW_READ_BOUNDS,
  WindowReadUnavailable,
  type WindowReadQuery,
  type WindowReadResult,
  type WindowStoreReader,
} from '../src/main/db/window-read-protocol'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { joinLiveHosts } from '../src/main/runtime/live-hosts'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const opening = 'Composed by BroCrew for this conversation at this launch:'
const query = {
  kind: 'leads' as const,
  sessionId: 'alpha',
  opening,
  historicalOpening: 'Composed by BroBot for this conversation at this launch:',
  before: Number.MAX_SAFE_INTEGER,
}

describe('canonical window worker folds and independent live-store reads', () => {
  let directory: string
  let db: AppDatabase
  let store: SessionStore
  let engine: WindowReadEngine
  let ordinal: number
  const hosts: RuntimeHost[] = []

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'fictional-window-read-'))
    const file = join(directory, 'fictional.sqlite')
    db = openDatabase(file)
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    ordinal = 0
    for (const id of ['alpha', 'beta'])
      store.create({
        id,
        provider: 'codex',
        cwd: directory,
        approvalMode: 'ask',
        profileId: 'fictional',
      })
    row('alpha', 'question_asked', {
      type: 'question_asked',
      requestId: 'first',
      prompt: 'Which fictional option?',
      questions: [{ id: 'part', prompt: 'Which option?', options: [] }],
    })
    row('alpha', 'request_routed', {
      type: 'request_routed',
      requestId: 'first',
      to: 'the-parent',
      parent: 'beta',
    })
    row('alpha', 'request_escalated', { type: 'request_escalated', requestId: 'first' })
    engine = new WindowReadEngine(file)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    for (const host of hosts.splice(0)) await host.closeAll()
    engine.close()
    vi.restoreAllMocks()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function row(session: string, type: string, payload: object | string, generation = 0) {
    const newest = db
      .prepare('SELECT max(ordinal) AS newest FROM events WHERE session_id = ? AND generation = ?')
      .get(session, generation) as { newest: number | null }
    const n = Math.max(ordinal, (newest.newest ?? -1) + 1)
    ordinal = n + 1
    db.prepare(
      'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      `fictional-${n}`,
      session,
      generation,
      n,
      type,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      1000 + n,
    )
  }

  it('materializes a large routing ledger once inside one read-only snapshot', () => {
    const insert = db.prepare(
      'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
    )
    // Rows the routed read returns: it leaves out the status rows it never acts on.
    db.transaction(() => {
      for (let i = 0; i < 35_000; i++) {
        const n = ordinal++
        insert.run(`fictional-${n}`, 'alpha', n, 'launched', '{"type":"launched"}', 1000 + n)
      }
    })()
    const connection = (engine as unknown as { db: AppDatabase }).db
    const prepare = connection.prepare.bind(connection)
    let routedRows = 0
    vi.spyOn(connection, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql)
      if (!sql.includes("json_remove(payload, '$.sent', '$.given')")) return statement
      return new Proxy(statement, {
        get(native, key) {
          if (key === 'iterate')
            return function* (...args: unknown[]) {
              for (const value of native.iterate(...args)) {
                routedRows++
                yield value
              }
            }
          const value: unknown = Reflect.get(native, key, native)
          return typeof value === 'function' ? value.bind(native) : value
        },
      })
    })
    const result = engine.read({ kind: 'routes' })
    expect(result.kind).toBe('routes')
    expect(routedRows).toBe(35_003)
    routesMatch()
    expect(routedRows).toBe(70_006)
  })

  function routesMatch() {
    const actual = engine.read({ kind: 'routes' })
    if (actual.kind !== 'routes') throw new Error('wrong result')
    const fresh = createSessionStore(db)
    const unread = rowsUnreadOnce()
    expect(actual.questions).toEqual(fresh.questionsAPersonMustAnswer(unread))
    expect(actual.decisions).toEqual(fresh.decisionsAwaitingAPerson(rowsUnreadOnce()))
    for (const row of actual.routes)
      expect(row.requests).toEqual(fresh.routedRequestsOf(row.sessionId, rowsUnreadOnce()))
    return actual
  }

  it('reads incident dependencies canonically, including corrupt rows and changed generations', () => {
    store.ensurePersonalRoot('alpha', 1)
    store.ensurePersonalRoot('beta', 1)
    row('alpha', 'message_queued', {
      type: 'message_queued',
      messageId: 'held',
      kind: 'work',
      text: 'Fictional words.',
    })
    row('alpha', 'message_unqueued', '{')
    row('alpha', 'work_interrupted', '{')
    const compare = () => {
      const actual = engine.read({ kind: 'incidents' })
      if (actual.kind !== 'incidents') throw new Error('wrong incident result')
      expect(actual.owners.map((one) => one.sessionId).sort()).toEqual(['alpha', 'beta'])
      for (const one of actual.owners) {
        const fresh = createSessionStore(db)
        const messages = rowsUnreadOnce()
        const stop = rowsUnreadOnce()
        const pieces = rowsUnreadOnce()
        const routes = rowsUnreadOnce()
        expect(one.pieces).toEqual(fresh.openPiecesOf(one.sessionId, pieces))
        expect(one.work).toEqual(fresh.reconciliationWork(new Set([one.sessionId]), pieces))
        expect(one.routes).toEqual(fresh.routedRequestsOf(one.sessionId, routes))
        expect(one.messages).toEqual(fresh.messagesWaitingIn(one.sessionId, messages))
        expect(one.stop).toEqual(fresh.lastAskToStop(one.sessionId, stop))
        expect(one.messagesSkipped.length).toBe(messages.count + messages.ledgersSkipped)
        expect(one.stopSkipped.length).toBe(stop.count + stop.ledgersSkipped)
        expect(one.piecesSkipped.length).toBe(pieces.count + pieces.ledgersSkipped)
        expect(one.routesSkipped.length).toBe(routes.count + routes.ledgersSkipped)
      }
      return actual
    }
    const first = compare().owners.find((one) => one.sessionId === 'alpha')!
    expect(first.messagesSkipped.length).toBeGreaterThan(0)
    expect(first.stopSkipped.length).toBeGreaterThan(0)
    db.prepare('UPDATE events SET generation = 3 WHERE session_id = ?').run('alpha')
    expect(compare().owners.find((one) => one.sessionId === 'alpha')?.messagesSkipped).toEqual([])
    expect(() => engine.read({ kind: 'incidents' }, () => true)).toThrow(WindowReadUnavailable)
  })

  it('preserves routes, questions, corruption counts, endings and generation changes', () => {
    expect(routesMatch().questions.rows).toHaveLength(1)
    row('alpha', 'request_resolved', '{')
    const corrupted = routesMatch()
    expect(corrupted.questions.rowsUnread).toBe(1)
    expect(corrupted.routes[0]?.skipped).toEqual([ordinal - 1])
    row('alpha', 'request_resolved', { type: 'request_resolved', id: 'first' })
    expect(routesMatch().questions.rows).toHaveLength(0)
    db.prepare('UPDATE events SET generation = 3 WHERE session_id = ?').run('alpha')
    expect(routesMatch().questions.rows).toHaveLength(0)
  })

  it('preserves lead rows, historical prefixes, failed turns, resets and ordinal bounds', () => {
    row('alpha', 'launched', { given: { thisConversation: { text: 'fictional lead' } } })
    row('alpha', 'user_turn', { sent: opening + '\n\nfictional message', lead: { text: 'lead' } })
    row('alpha', 'user_turn', { sent: query.historicalOpening + '\n\nold message' })
    row('alpha', 'turn', { state: 'failed', wordOf: 'this-app' })
    row('alpha', 'conversation_reset', {})
    row('alpha', 'user_turn', '{')
    for (const before of [4, Number.MAX_SAFE_INTEGER]) {
      const actual = engine.read({ ...query, before })
      expect(actual).toEqual({
        kind: 'leads',
        rows: store.threadLeadRows?.('alpha', opening, before, query.historicalOpening),
      })
    }
  })

  it('does not silently return a partial answer when materialization exceeds its bound', () => {
    row('alpha', 'user_turn', { sent: opening + 'x'.repeat(5 * 1024 * 1024) })
    expect(() => engine.read(query)).toThrow(WindowReadUnavailable)
    expect(routesMatch().questions.rows).toHaveLength(1)
  })

  it('pages a long ledger without dropping lead rows, and an abandoned page releases its snapshot', () => {
    db.transaction(() => {
      for (let i = 0; i < 1200; i++)
        row(
          'alpha',
          i % 3 === 0 ? 'user_turn' : 'text',
          i % 3 === 0 ? { sent: opening + '\n\nfictional words' } : { text: 'noise' },
        )
    })()
    expect(engine.read(query)).toEqual({
      kind: 'leads',
      rows: store.threadLeadRows?.('alpha', opening, query.before, query.historicalOpening),
    })
    let checked = 0
    expect(() => engine.read(query, () => ++checked >= 2)).toThrow(WindowReadUnavailable)
    expect(checked).toBe(2)
    expect(routesMatch().questions.rows).toHaveLength(1)
    expect(engine.read(query)).toEqual({
      kind: 'leads',
      rows: store.threadLeadRows?.('alpha', opening, query.before, query.historicalOpening),
    })
  })

  it.each([16_384, 65_536])(
    'streams %i text rows without retaining empty pages from a never-derived session',
    (ledgerRows) => {
      db.prepare('DELETE FROM events WHERE session_id = ?').run('alpha')
      db.prepare('DELETE FROM derived_generation WHERE session_id = ?').run('alpha')
      const insert = db.prepare(
        "INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, 'alpha', 0, ?, 'text', ?, 1000)",
      )
      db.transaction(() => {
        for (let n = 0; n < ledgerRows; n++)
          insert.run(`fictional-text-${n}`, n, '{"type":"text","text":"Fictional noise"}')
      })()
      const NativeMap = Map
      const retained: Map<unknown, unknown>[] = []
      class ObservedMap extends NativeMap<unknown, unknown> {
        override set(key: unknown, value: unknown): this {
          if (
            typeof key === 'string' &&
            key.trimStart().startsWith('SELECT') &&
            value instanceof NativeMap
          )
            retained.push(value)
          return super.set(key, value)
        }
      }
      const connection = (engine as unknown as { db: AppDatabase }).db
      const prepare = connection.prepare.bind(connection)
      let streamed = 0
      vi.spyOn(connection, 'prepare').mockImplementation((sql: string) => {
        const statement = prepare(sql)
        if (!sql.startsWith('SELECT ordinal FROM events')) return statement
        return new Proxy(statement, {
          get(native, key) {
            if (key === 'all')
              return (...args: unknown[]) => {
                const result = native.all(...args)
                streamed += result.length
                return result
              }
            const value: unknown = Reflect.get(native, key, native)
            return typeof value === 'function' ? value.bind(native) : value
          },
        })
      })
      vi.stubGlobal('Map', ObservedMap)
      try {
        expect(engine.read(query)).toEqual({ kind: 'leads', rows: [] })
      } finally {
        vi.unstubAllGlobals()
      }
      expect(streamed).toBe(ledgerRows)
      const entries = retained.reduce((n, map) => n + map.size, 0)
      expect(entries).toBe(0)
      expect(retained).toHaveLength(0)
      console.log(
        'Streamed lead cache',
        JSON.stringify({ ledgerRows, streamed, cacheMaps: retained.length, entries }),
      )
    },
  )

  it('uses one snapshot only during an answer and does not leak it into scheduled work', async () => {
    const snapshot = routesMatch()
    const context = new WindowRoutingReads()
    const original = vi.fn(() => store.routedRequestsOf('alpha'))
    const wrapped = context.store({ ...store, routedRequestsOf: original })
    let later!: Promise<unknown>
    context.run(snapshot, () => {
      expect(wrapped.routedRequestsOf('alpha')).toEqual(snapshot.routes[0]?.requests)
      expect(original).not.toHaveBeenCalled()
      later = new Promise((resolve) =>
        setImmediate(() => resolve(wrapped.routedRequestsOf('alpha'))),
      )
    })
    await later
    expect(original).toHaveBeenCalledOnce()
  })

  function hostWith(
    reader?: WindowStoreReader,
    guarded = false,
    extra: Partial<RuntimeHostDeps> = {},
  ) {
    const writer = guarded
      ? {
          ...store,
          routedRequestsOf: vi.fn(() => {
            throw new Error('routing fold on the writer')
          }),
          questionsAPersonMustAnswer: vi.fn(() => {
            throw new Error('question walk on the writer')
          }),
          decisionsAwaitingAPerson: vi.fn(() => {
            throw new Error('decision walk on the writer')
          }),
        }
      : store
    const host = new RuntimeHost({
      store: writer,
      windowReader: reader,
      limitsWriterStamp: limitsWriterSampler(db, () => true),
      windowWriterStamp: windowWriterSampler(db, () => true),
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
      ...extra,
    })
    hosts.push(host)
    return { host, writer }
  }

  function anotherQuestion() {
    row('alpha', 'question_asked', {
      type: 'question_asked',
      requestId: 'second',
      prompt: 'Another fictional option?',
      questions: [{ id: 'part', prompt: 'Which option?', options: [] }],
    })
    row('alpha', 'request_routed', {
      type: 'request_routed',
      requestId: 'second',
      to: 'the-parent',
      parent: 'beta',
    })
    row('alpha', 'request_escalated', { type: 'request_escalated', requestId: 'second' })
  }

  const sink = {
    ownerId: 'fictional-window',
    alive: true,
    aPersonIsBehindIt: true,
    send: () => {},
    sendLiveness: () => {},
  }

  it('a worker-configured host keeps writer identity and refuses live work before any prefetch', async () => {
    store.append(
      'alpha',
      store.nextOrdinal('alpha'),
      {
        type: 'session',
        state: 'started',
        ref: { provider: 'codex', sessionId: 'fictional-alpha', cwd: directory, rotation: 0 },
      },
      3000,
    )
    const leave = joinLiveHosts({ ledger: store, workInFlight: () => ['alpha'] })
    const read = vi.fn(async (query: WindowReadQuery) => engine.read(query))
    try {
      const { host } = hostWith({ read, close: async () => {} }, false, {
        readInstructions: () => ({
          firstTurnLead: 'fictional conversation lead',
          systemHint: undefined,
          instructions: {
            injected: [],
            agentMemory: [],
            provider: [],
            refused: [],
            note: '',
            recallsReported: true,
            writesReported: true,
            composed: null,
          },
        }),
      })
      expect(host.ledger).toBe(store)
      expect(routesMatch().questions.rows).toHaveLength(1)
      await expect(host.resumeSession('alpha', sink)).rejects.toThrow(
        describeUnavailable('run-by-another-host'),
      )
      expect(read).not.toHaveBeenCalled()
      expect(routesMatch().questions.rows).toHaveLength(1)
    } finally {
      leave()
    }
  })

  it('the actual question IPC composes the same answer without either writer fold', async () => {
    const directHost = hostWith().host
    const { host, writer } = hostWith(
      {
        read: async (query) => engine.read(query),
        close: async () => {},
      },
      true,
    )
    anotherQuestion()
    const direct = directHost.questionsForAPerson()
    expect(direct.rows).toHaveLength(1)
    expect(await executeRuntimeCommand(host, sink, { kind: 'questionsForAPerson' })).toEqual(direct)
    expect(writer.routedRequestsOf).not.toHaveBeenCalled()
    expect(writer.questionsAPersonMustAnswer).not.toHaveBeenCalled()
  })

  it('retries a changed writer and never composes stale routing answers', async () => {
    let calls = 0
    const { host } = hostWith(
      {
        read: async (query: WindowReadQuery) => {
          const answer = engine.read(query)
          if (calls++ === 0)
            row('alpha', 'request_resolved', { type: 'request_resolved', id: 'second' })
          return answer
        },
        close: async () => {},
      },
      true,
    )
    anotherQuestion()
    const answer = await host.readForWindow(() => host.questionsForAPerson())
    expect(calls).toBe(2)
    expect(answer.rows).toHaveLength(0)
  })

  it('ordinary writes after the snapshot do not retry or fall back to the writer', async () => {
    const read = vi.fn(async (input: WindowReadQuery) => {
      const answer = engine.read(input)
      row('alpha', 'text', { type: 'text', text: 'fictional stream' })
      row('beta', 'status', { type: 'status', state: 'working' })
      row('alpha', 'status', { type: 'status', state: 'idle' })
      return answer
    })
    const { host, writer } = hostWith({ read, close: async () => {} }, true)
    anotherQuestion()
    expect((await host.readForWindow(() => host.questionsForAPerson())).rows).toHaveLength(1)
    expect(read).toHaveBeenCalledOnce()
    expect(writer.questionsAPersonMustAnswer).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('writer-moved'))
  })

  it('measures old and relevant-write stamps under the same fictional busy writer', async () => {
    const measurements: object[] = []
    hostWith()
    for (const mode of ['before', 'after'] as const) {
      const floor = ordinal
      let reads = 0
      let writes = 0
      let writeMs = 0
      const read = async (input: WindowReadQuery) => {
        reads++
        const answer = engine.read(input)
        await new Promise<void>((resolve) => setImmediate(resolve))
        const began = performance.now()
        for (let i = 0; i < 5; i++) {
          row('beta', 'text', { type: 'text', text: 'fictional stream ' + i })
          row('beta', 'status', { type: 'status', state: 'working' })
          writes += 2
        }
        writeMs += performance.now() - began
        return answer
      }
      const extra = mode === 'before' ? { windowWriterStamp: undefined } : {}
      const { host } = hostWith({ read, close: async () => {} }, false, extra)
      anotherQuestion()
      const expected = host.questionsForAPerson()
      expect(expected.rows).toHaveLength(1)
      const fixtureRows = db.prepare('SELECT count(*) AS n FROM events').get()
      const direct = vi.spyOn(store, 'questionsAPersonMustAnswer')
      direct.mockClear()
      const began = performance.now()
      for (let i = 0; i < 20; i++)
        expect(await host.readForWindow(() => host.questionsForAPerson())).toEqual(expected)
      const fallbacks = direct.mock.calls.length
      expect(reads).toBe(mode === 'before' ? 40 : 1)
      expect(fallbacks).toBe(mode === 'before' ? 20 : 0)
      measurements.push({
        mode,
        requests: 20,
        reads,
        retries: mode === 'before' ? reads - 20 : 0,
        retainedAnswers: mode === 'after' ? 19 : 0,
        writes,
        fallbacks,
        writeMs,
        writeUsPerRow: (writeMs * 1000) / writes,
        elapsedMs: performance.now() - began,
        fixtureRows,
        finalRows: db.prepare('SELECT count(*) AS n FROM events').get(),
      })
      direct.mockRestore()
      db.prepare('DELETE FROM events WHERE ordinal >= ?').run(floor)
      ordinal = floor
    }
    console.log('fictional busy writer', JSON.stringify(measurements))
    const evidence = process.env['BROBOT_WINDOW_FRESHNESS_MEASUREMENTS']
    if (evidence !== undefined)
      writeFileSync(evidence, JSON.stringify(measurements, null, 2) + '\n')
  })

  it('an unsampled writer answers directly without requesting a worker snapshot', async () => {
    const read = vi.fn(async (input: WindowReadQuery) => engine.read(input))
    const { host } = hostWith({ read, close: async () => {} }, false, {
      windowWriterStamp: undefined,
      limitsWriterStamp: () => null,
    })
    anotherQuestion()
    const expected = host.questionsForAPerson()
    const direct = vi.spyOn(store, 'questionsAPersonMustAnswer')
    direct.mockClear()
    expect(await host.readForWindow(() => host.questionsForAPerson())).toEqual(expected)
    expect(direct).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      'window read answered on the main thread: writer-unsampled (1 since launch)',
    )
  })

  it('answers on the main thread when the writer moves under both tries', async () => {
    const read = vi.fn(async (query: WindowReadQuery) => {
      const answer = engine.read(query)
      row('alpha', 'request_escalated', { type: 'request_escalated', requestId: 'second' })
      return answer
    })
    const { host } = hostWith({ read, close: async () => {} })
    anotherQuestion()
    const direct = vi.spyOn(store, 'questionsAPersonMustAnswer')
    const answer = await host.readForWindow(() => host.questionsForAPerson())
    expect(read).toHaveBeenCalledTimes(2)
    expect(direct).toHaveBeenCalledOnce()
    expect(answer).toEqual(host.questionsForAPerson())
    expect(answer.rows).toHaveLength(1)
    expect(console.warn).toHaveBeenCalledWith(
      'window read answered on the main thread: writer-moved (1 since launch)',
    )
  })

  it('a post-write joiner rejects the shared older snapshot and joins the fresh retry', async () => {
    const reads: {
      answer: WindowReadResult
      finish: (answer: WindowReadResult) => void
    }[] = []
    const { host } = hostWith(
      {
        read: (query) =>
          new Promise((finish) => {
            reads.push({ answer: engine.read(query), finish })
          }),
        close: async () => {},
      },
      true,
    )
    anotherQuestion()
    const first = host.readForWindow(() => host.questionsForAPerson())
    expect(reads).toHaveLength(1)
    row('alpha', 'request_resolved', { type: 'request_resolved', id: 'second' })
    let secondFinished = false
    const second = host
      .readForWindow(() => host.questionsForAPerson())
      .then((answer) => {
        secondFinished = true
        return answer
      })
    expect(reads).toHaveLength(1)
    reads[0]!.finish(reads[0]!.answer)
    await new Promise<void>((resolve) => setImmediate(resolve))
    try {
      expect(secondFinished).toBe(false)
      expect(reads).toHaveLength(2)
    } finally {
      for (const read of reads) read.finish(read.answer)
    }
    const answers = await Promise.all([first, second])
    expect(answers.map((answer) => answer.rows)).toEqual([[], []])
  })

  it('fifty sequential window looks reuse one stamped routing snapshot and refresh after a write', async () => {
    const read = vi.fn(async (query: WindowReadQuery) => engine.read(query))
    const { host } = hostWith({ read, close: async () => {} }, true)
    anotherQuestion()
    const first = await host.readForWindow(() => host.questionsForAPerson())
    expect(first.rows).toHaveLength(1)
    for (let i = 0; i < 50; i++)
      expect(await host.readForWindow(() => host.questionsForAPerson())).toEqual(first)
    expect(read).toHaveBeenCalledOnce()
    row('alpha', 'assistant_delta', { type: 'assistant_delta', text: 'Fictional content' })
    expect(await host.readForWindow(() => host.questionsForAPerson())).toEqual(first)
    expect(read).toHaveBeenCalledOnce()
    row('alpha', 'request_resolved', { type: 'request_resolved', id: 'second' })
    expect((await host.readForWindow(() => host.questionsForAPerson())).rows).toEqual([])
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('drops a retained snapshot after an external same-ordinal rewrite', async () => {
    const read = vi.fn(async (query: WindowReadQuery) => engine.read(query))
    const { host } = hostWith({ read, close: async () => {} }, true)
    anotherQuestion()
    expect((await host.readForWindow(() => host.questionsForAPerson())).rows).toHaveLength(1)
    const other = openDatabase(join(directory, 'fictional.sqlite'))
    try {
      other
        .prepare(
          "UPDATE events SET type = 'request_resolved', payload = ? WHERE type = 'request_escalated' AND json_extract(payload, '$.requestId') = 'second'",
        )
        .run('{"type":"request_resolved","id":"second"}')
      expect((await host.readForWindow(() => host.questionsForAPerson())).rows).toEqual([])
      expect(read).toHaveBeenCalledTimes(2)
    } finally {
      other.close()
    }
  })

  it('retries a failed read instead of retaining a failure', async () => {
    const read = vi.fn(async (query: WindowReadQuery) => engine.read(query))
    read.mockRejectedValueOnce(new WindowReadUnavailable('failed'))
    const { host } = hostWith({ read, close: async () => {} })
    anotherQuestion()
    const first = await host.readForWindow(() => host.questionsForAPerson())
    expect(await host.readForWindow(() => host.questionsForAPerson())).toEqual(first)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('unchanged concurrent subscribers share one canonical read', async () => {
    let finish!: (answer: WindowReadResult) => void
    let pinned!: WindowReadResult
    const read = vi.fn(
      (query: WindowReadQuery) =>
        new Promise<WindowReadResult>((resolve) => {
          pinned = engine.read(query)
          finish = resolve
        }),
    )
    const { host } = hostWith({ read, close: async () => {} }, true)
    anotherQuestion()
    const first = host.readForWindow(() => host.questionsForAPerson())
    const second = host.readForWindow(() => host.questionsForAPerson())
    expect(read).toHaveBeenCalledOnce()
    finish(pinned)
    const answers = await Promise.all([first, second])
    expect(answers[0]).toEqual(answers[1])
    expect(answers[0]?.rows).toHaveLength(1)
    expect(read).toHaveBeenCalledOnce()
  })

  it('composes and stamps the answer in the same continuation that validates its snapshot', async () => {
    let finish!: (answer: WindowReadResult) => void
    let pinned!: WindowReadResult
    const { host } = hostWith(
      {
        read: (query) =>
          new Promise((resolve) => {
            pinned = engine.read(query)
            finish = resolve
          }),
        close: async () => {},
      },
      true,
    )
    anotherQuestion()
    const order: string[] = []
    const asked = host.readForWindow(() => {
      const answer = host.readWorkspace()
      order.push('answer')
      return answer
    })
    finish(pinned)
    queueMicrotask(() => {
      order.push('write')
      row('alpha', 'request_resolved', { type: 'request_resolved', id: 'second' })
    })
    const answer = await asked
    expect(answer.needsYou).toEqual({ counted: 'in-full', count: 1 })
    expect(typeof answer.readAt).toBe('number')
    expect(order).toEqual(['answer', 'write'])
  })

  it.each(['stalledWorkForAPerson', 'waitingOnWhoWroteForAPerson'] as const)(
    '%s still answers while all window snapshot caller permits are held',
    async (kind) => {
      let finish!: (answer: WindowReadResult) => void
      const read = vi.fn(
        () =>
          new Promise<WindowReadResult>((resolve) => {
            finish = resolve
          }),
      )
      const { host } = hostWith({ read, close: async () => {} })
      const expected = host[kind]()
      const callers = Array.from({ length: WINDOW_READ_BOUNDS.callers }, () =>
        host.readForWindow(() => host.questionsForAPerson()),
      )
      try {
        await expect(host.readForWindow(() => host.questionsForAPerson())).resolves.toEqual(
          host.questionsForAPerson(),
        )
        await expect(executeRuntimeCommand(host, sink, { kind })).resolves.toEqual(expected)
        expect(read).toHaveBeenCalledOnce()
      } finally {
        finish(engine.read({ kind: 'routes' }))
        await Promise.all(callers)
      }
    },
  )

  it('bounds shared callers, answers the excess on the main thread, and releases permits', async () => {
    let finish!: (answer: WindowReadResult) => void
    const read = vi.fn(
      () =>
        new Promise<WindowReadResult>((resolve) => {
          finish = resolve
        }),
    )
    const { host } = hostWith({ read, close: async () => {} })
    anotherQuestion()
    const callers = Array.from({ length: WINDOW_READ_BOUNDS.callers }, () =>
      host.readForWindow(() => host.questionsForAPerson()),
    )
    let overflow = 'waiting'
    const excess = host
      .readForWindow(() => host.questionsForAPerson())
      .then(
        (answer) => {
          expect(answer).toEqual(host.questionsForAPerson())
          overflow = 'accepted'
        },
        () => {
          overflow = 'rejected'
        },
      )
    await new Promise<void>((resolve) => setImmediate(resolve))
    try {
      expect(overflow).toBe('accepted')
      expect(read).toHaveBeenCalledOnce()
    } finally {
      finish(engine.read({ kind: 'routes' }))
      await Promise.all([...callers, excess])
    }
    row('alpha', 'request_escalated', { type: 'request_escalated', requestId: 'first' })
    const next = host.readForWindow(() => host.questionsForAPerson())
    expect(read).toHaveBeenCalledTimes(2)
    finish(engine.read({ kind: 'routes' }))
    expect((await next).rows).toHaveLength(1)
  })

  it('releases shared caller permits when the native job fails', async () => {
    let reject!: (error: unknown) => void
    const read = vi.fn(
      () =>
        new Promise<WindowReadResult>((_resolve, failed) => {
          reject = failed
        }),
    )
    const { host } = hostWith({ read, close: async () => {} })
    anotherQuestion()
    const callers = Array.from({ length: WINDOW_READ_BOUNDS.callers }, () =>
      host.readForWindow(() => host.questionsForAPerson()),
    )
    const settled = Promise.allSettled(callers)
    reject(new WindowReadUnavailable())
    const direct = host.questionsForAPerson()
    expect(await settled).toEqual(callers.map(() => ({ status: 'fulfilled', value: direct })))
    read.mockImplementation(async () => engine.read({ kind: 'routes' }))
    expect((await host.readForWindow(() => host.questionsForAPerson())).rows).toHaveLength(1)
    expect(read).toHaveBeenCalledTimes(2)
  })

  describe('a read the worker does not serve is answered on the main thread', () => {
    /** A worker that never answers, until the test finishes it. */
    const aWorkerThatHangs = () => {
      let finish!: (answer: WindowReadResult) => void
      const read = vi.fn(
        () =>
          new Promise<WindowReadResult>((resolve) => {
            finish = resolve
          }),
      )
      return { read, finish: () => finish(engine.read({ kind: 'routes' })) }
    }
    const said = (): string[] => vi.mocked(console.warn).mock.calls.map((call) => String(call[0]))
    const theEightReads = [
      'listResumable',
      'listUnresumable',
      'questionsForAPerson',
      'decisionsForAPerson',
      'readWorkspace',
      'whatIsBeingDone',
      'whatEachConversationIsWaitingOn',
      'theWholeForest',
    ] as const
    /** An answer without the moment it was read, which two reads never share. */
    const unstamped = (answer: unknown): unknown => {
      if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return answer
      return Object.fromEntries(Object.entries(answer).filter(([key]) => key !== 'readAt'))
    }

    it('every caller permit held: the next read answers at once, and the worker is asked once', async () => {
      const worker = aWorkerThatHangs()
      const { host } = hostWith({ read: worker.read, close: async () => {} })
      const callers = Array.from({ length: WINDOW_READ_BOUNDS.callers }, () =>
        host.readForWindow(() => host.questionsForAPerson()),
      )
      try {
        expect(await host.readForWindow(() => host.questionsForAPerson())).toEqual(
          host.questionsForAPerson(),
        )
        expect(worker.read).toHaveBeenCalledOnce()
        expect(said()).toEqual([
          'window read answered on the main thread: callers-full (1 since launch)',
        ])
      } finally {
        worker.finish()
        await Promise.all(callers)
      }
    })

    /**
     * The real reader over a worker that fails every read it is sent, exits on it, or holds it
     * until it is closed.
     */
    const aReaderWhoseWorker = (reply: 'fails' | 'exits' | 'holds'): WindowWorkerReader => {
      class FictionalWorker extends EventEmitter implements WindowReadWorker {
        postMessage(message: unknown): void {
          const { type, id } = message as { type: string; id?: number }
          if (type === 'read' && reply === 'holds') return
          queueMicrotask(() => {
            if (type === 'read' && reply === 'fails') this.emit('message', { type: 'failed', id })
            else this.emit('exit', 1)
          })
        }
        terminate = vi.fn(async () => 0)
      }
      const worker = new FictionalWorker()
      const reader = new WindowWorkerReader(worker)
      worker.emit('message', { type: 'ready' })
      return reader
    }

    it('the worker’s read fails, as when its wait for a lock runs out: it answers', async () => {
      const { host } = hostWith(aReaderWhoseWorker('fails'))
      anotherQuestion()
      const answer = await host.readForWindow(() => host.questionsForAPerson())
      expect(answer).toEqual(host.questionsForAPerson())
      expect(answer.rows).toHaveLength(1)
      expect(said()).toEqual([
        'window read answered on the main thread: worker-read-failed (1 since launch)',
      ])
    })

    it('the worker gone: it answers, and a worker that needs a restart is said apart', async () => {
      const { host } = hostWith(new WindowReaderLifetime(() => aReaderWhoseWorker('exits')))
      anotherQuestion()
      const direct = host.questionsForAPerson()
      for (let one = 0; one < 3; one++)
        expect(await host.readForWindow(() => host.questionsForAPerson())).toEqual(direct)
      expect(said()).toEqual([
        'window read answered on the main thread: worker-gone (1 since launch)',
        'window read answered on the main thread: worker-needs-restart (1 since launch)',
      ])
    })

    it('a read the app’s close cuts off is refused, and not read on the main thread', async () => {
      const { host } = hostWith(aReaderWhoseWorker('holds'))
      const answer = vi.fn(() => host.questionsForAPerson())
      const asked = host.readForWindow(answer)
      const settled = asked.then(
        () => 'answered',
        (error: unknown) => error,
      )
      await host.closeAll()
      expect(await settled).toBeInstanceOf(WindowReadUnavailable)
      expect(answer).not.toHaveBeenCalled()
      await expect(host.readForWindow(answer)).rejects.toThrow(WindowReadUnavailable)
      expect(answer).not.toHaveBeenCalled()
      expect(said()).toEqual([])
    })

    it('a thread’s leads are never read on the main thread: a miss leaves them unread', async () => {
      /** What the host says a Codex thread holds, through the reader both its callers use. */
      const leadsOf = (reader: WindowStoreReader): Promise<unknown> =>
        (
          hostWith(reader).host as unknown as {
            theLeadsItsThreadHolds(
              sessionId: string,
              provider: 'codex',
              recorded: boolean,
              ordinal: number,
            ): Promise<unknown>
          }
        ).theLeadsItsThreadHolds('alpha', 'codex', true, Number.MAX_SAFE_INTEGER - 1)
      const scan = vi.spyOn(store, 'threadLeadRows')
      expect(
        await leadsOf({ read: async (query) => engine.read(query), close: async () => {} }),
      ).not.toBeNull()
      const misses: WindowStoreReader[] = [
        {
          read: async (query) => {
            const answer = engine.read(query)
            row('alpha', 'user_turn', { type: 'user_turn', sent: opening + '\nfictional change' })
            return answer
          },
          close: async () => {},
        },
        aReaderWhoseWorker('fails'),
        aReaderWhoseWorker('exits'),
        new WindowReaderLifetime(() => {
          throw new Error('no worker starts')
        }),
        {
          read: async () => {
            throw new WindowReadUnavailable('restart')
          },
          close: async () => {},
        },
      ]
      for (const reader of misses) expect(await leadsOf(reader)).toBeNull()
      expect(scan).not.toHaveBeenCalled()
      expect(said().some((line) => line.startsWith('window read answered'))).toBe(false)
    })

    it.each(theEightReads)(
      '%s answers on the main thread while the worker is gone',
      async (kind) => {
        const read = vi.fn(async (): Promise<WindowReadResult> => {
          throw new WindowReadUnavailable()
        })
        const { host } = hostWith({ read, close: async () => {} })
        const direct = await executeRuntimeCommand(hostWith().host, sink, { kind })
        expect(unstamped(await executeRuntimeCommand(host, sink, { kind }))).toEqual(
          unstamped(direct),
        )
        expect(read).toHaveBeenCalledOnce()
      },
    )

    it('says each cause with its count at most once a minute, and nothing the answer holds', async () => {
      let clock = 1_000_000
      const read = vi.fn(async (): Promise<WindowReadResult> => {
        throw new WindowReadUnavailable()
      })
      const { host } = hostWith({ read, close: async () => {} }, false, { now: () => clock })
      for (let one = 0; one < 3; one++) await host.readForWindow(() => host.questionsForAPerson())
      clock += 60_000
      await host.readForWindow(() => host.questionsForAPerson())
      expect(said()).toEqual([
        'window read answered on the main thread: worker-gone (1 since launch)',
        'window read answered on the main thread: worker-gone (4 since launch)',
      ])
      expect(said().join('\n')).not.toContain('fictional')
    })

    it('a list read the main thread can’t answer either is still refused, so the list says so', async () => {
      const read = vi.fn(async (): Promise<WindowReadResult> => {
        throw new WindowReadUnavailable()
      })
      const { host } = hostWith({ read, close: async () => {} })
      await expect(executeRuntimeCommand(host, sink, { kind: 'listResumable' })).resolves.toEqual(
        host.resumableSessions(),
      )
      vi.spyOn(store, 'resumable').mockImplementation(() => {
        throw new Error('the database is locked')
      })
      await expect(executeRuntimeCommand(host, sink, { kind: 'listResumable' })).rejects.toThrow(
        'the database is locked',
      )
    })

    it('an answer that fails on the worker’s snapshot is refused, and not read again here', async () => {
      const { host } = hostWith({
        read: async (query) => engine.read(query),
        close: async () => {},
      })
      const answer = vi.fn((): never => {
        throw new Error('the answer could not be composed')
      })
      await expect(host.readForWindow(answer)).rejects.toThrow('the answer could not be composed')
      expect(answer).toHaveBeenCalledOnce()
      expect(said()).toEqual([])
    })
  })
})

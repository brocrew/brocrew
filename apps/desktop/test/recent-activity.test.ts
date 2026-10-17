import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import ts from 'typescript'
import { openDatabase, type AppDatabase, type AppStatement } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import {
  windowReadQuery,
  windowReadResult,
  WINDOW_READ_BOUNDS,
  WindowReadUnavailable,
  type WindowStoreReader,
} from '../src/main/db/window-read-protocol'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { recentActivity } from '../src/main/runtime/recent-activity'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RECENT_ACTIVITY_LINES } from '../src/shared/recent-activity'
import { MAX_DIGEST_SPAN_MS } from '../src/shared/digest'

const here = dirname(fileURLToPath(import.meta.url))
let directory: string
let db: AppDatabase
let store: SessionStore
let engine: WindowReadEngine
let ordinal: number
let piece: string
let label: string
const hosts: RuntimeHost[] = []
const query = { kind: 'activity' as const, from: 100, to: 1000 }

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fictional-recent-activity-'))
  db = openDatabase(join(directory, 'fictional.sqlite'))
  applyMigrations(db, join(here, '../src/main/db/migrations'))
  store = createSessionStore(db)
  store.create({
    id: 'owner',
    provider: 'codex',
    profileId: 'fictional',
    cwd: directory,
    approvalMode: 'ask',
  })
  store.setAgentDisplayName('fictional', 'Ada')
  const parent = store.rootOf('owner')
  if (parent === null) throw new Error('fictional root missing')
  piece = 'fictional-piece'
  label = `${parent.label}.1`
  store.recordGive(
    {
      piece,
      parent: parent.piece,
      number: 1,
      owner: 'owner',
      givenBy: 'owner',
      title: 'Original title',
      brief: 'Private brief must never cross',
      folder: null,
      inputs: [],
    },
    0,
    {
      type: 'work_given',
      piece,
      parent: parent.piece,
      label,
      givenBy: 'owner',
      title: 'Original title',
      brief: 'Private brief must never cross',
    },
    100,
  )
  ordinal = 1
  engine = new WindowReadEngine(join(directory, 'fictional.sqlite'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.closeAll()
  engine.close()
  db.close()
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})
function append(at: number, event: Parameters<SessionStore['append']>[2]) {
  store.append('owner', ordinal++, event, at)
}
function read() {
  const result = engine.read(query)
  if (result.kind !== 'activity') throw new Error('wrong result')
  expect(windowReadResult.safeParse(result).success).toBe(true)
  return result
}

it('maps each per-piece act, preserves claims and sorts newest first without content', () => {
  append(200, {
    type: 'work_replied',
    piece,
    outcome: 'done',
    summary: 'Private report',
    resources: [],
  })
  append(300, {
    type: 'work_replied',
    piece,
    outcome: 'failed',
    summary: 'Private report',
    resources: [],
  })
  append(400, {
    type: 'work_replied',
    piece,
    outcome: 'blocked',
    summary: 'Private report',
    resources: [],
  })
  append(500, { type: 'work_taken_back', piece, by: 'owner' })
  append(600, { type: 'work_closed', piece, by: 'owner' })
  append(700, { type: 'work_retitled', piece, title: 'Current title', by: 'owner' })
  const result = read()
  expect(result.window).toEqual({ from: 100, to: 1000 })
  expect(result.lines.map(({ at, what, register }) => ({ at, what, register }))).toEqual([
    { at: 600, what: 'stopped', register: 'observed' },
    { at: 500, what: 'stopped', register: 'observed' },
    { at: 300, what: 'failed', register: 'claimed' },
    { at: 200, what: 'finished', register: 'claimed' },
    { at: 100, what: 'started', register: 'observed' },
  ])
  expect(new Set(result.lines.map((one) => one.id)).size).toBe(5)
  for (const line of result.lines)
    expect(line).toMatchObject({
      piece: { id: piece, label, title: 'Current title' },
      agent: 'Ada',
      conversation: 'owner',
    })
  expect(JSON.stringify(result)).not.toContain('Private')
  expect(read()).toEqual(result)
})

it('includes a carried-in piece using canonical labels and current titles', () => {
  append(500, { type: 'work_replied', piece, outcome: 'done', summary: 'Private', resources: [] })
  const result = engine.read({ kind: 'activity', from: 400, to: 600 })
  expect(result).toMatchObject({
    lines: [{ at: 500, what: 'finished', piece: { id: piece, label, title: 'Original title' } }],
    capped: false,
  })
})

it('uses a half-open window and only the active generation and placed conversations', () => {
  append(99, { type: 'work_replied', piece, outcome: 'done', summary: 'Before', resources: [] })
  append(999, { type: 'work_replied', piece, outcome: 'failed', summary: 'Inside', resources: [] })
  append(1000, { type: 'work_closed', piece, by: 'owner' })
  db.prepare(
    `INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
    VALUES('old','owner',9,0,'work_replied',?,500)`,
  ).run(
    JSON.stringify({ type: 'work_replied', piece, outcome: 'done', summary: 'Old', resources: [] }),
  )
  store.adopt({
    id: 'unplaced',
    provider: 'codex',
    sessionId: 'fictional-external',
    profileId: null,
    cwd: directory,
    createdAt: 100,
    updatedAt: 500,
  })
  store.append(
    'unplaced',
    0,
    { type: 'work_replied', piece, outcome: 'done', summary: 'Unplaced', resources: [] },
    500,
  )
  expect(read().lines.map((line) => line.at)).toEqual([999, 100])
})

it('caps the newest 200 lines and says when a line is omitted', () => {
  for (let i = 0; i < RECENT_ACTIVITY_LINES; i++)
    append(200 + i, { type: 'work_closed', piece, by: 'owner' })
  const result = read()
  expect(result.lines).toHaveLength(RECENT_ACTIVITY_LINES)
  expect(result.lines[0]?.at).toBe(399)
  expect(result.lines.at(-1)?.at).toBe(200)
  expect(result.capped).toBe(true)
  db.prepare('DELETE FROM events WHERE ordinal = ? AND session_id = ?').run(ordinal - 1, 'owner')
  expect(read().capped).toBe(false)
})

it('keeps unread rows and skipped ledgers distinct from an empty complete answer', () => {
  const empty = engine.read({ kind: 'activity', from: 800, to: 900 })
  expect(empty).toMatchObject({ lines: [], read: { rowsUnread: 0 }, capped: false })
  db.prepare(
    `INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
    VALUES('torn','owner',0,100,'work_replied','{',850)`,
  ).run()
  const torn = engine.read({ kind: 'activity', from: 800, to: 900 })
  expect(torn).toMatchObject({ lines: [], read: { rowsUnread: 1 } })
  append(860, {
    type: 'work_replied',
    piece: 'missing-piece',
    outcome: 'done',
    summary: 'Private',
    resources: [],
  })
  expect(engine.read({ kind: 'activity', from: 800, to: 900 })).toMatchObject({
    lines: [],
    read: { rowsUnread: 1, ledgersSkipped: 1 },
  })
  const skipped = new Proxy(store, {
    get(target, key) {
      if (key === 'activityWindow')
        return () => ({
          rows: [],
          walk: 'one-window-over-every-agents-conversation',
          ledgers: 2,
          rowsUnread: 3,
          ledgersSkipped: 1,
        })
      return Reflect.get(target, key)
    },
  })
  expect(recentActivity(skipped, 800, 900).read).toEqual({
    walk: 'one-window-over-every-agents-conversation',
    ledgers: 2,
    rowsUnread: 3,
    ledgersSkipped: 1,
  })
})

it('executes no INDEXED BY hint and refuses rather than silently truncating the native row bound', () => {
  const connection = (engine as unknown as { db: AppDatabase }).db
  const prepare: (sql: string) => AppStatement = connection.prepare.bind(connection)
  const executed: string[] = []
  vi.spyOn(connection, 'prepare').mockImplementation(
    (sql: string) =>
      new Proxy(prepare(sql), {
        get(native, key) {
          if (key === 'get')
            return (...args: unknown[]) => {
              executed.push(sql)
              return native.get(...args)
            }
          if (key === 'all')
            return (...args: unknown[]) => {
              executed.push(sql)
              return native.all(...args)
            }
          if (key === 'iterate')
            return (...args: unknown[]) => {
              executed.push(sql)
              return native.iterate(...args)
            }
          const value: unknown = Reflect.get(native, key, native)
          return typeof value === 'function' ? value.bind(native) : value
        },
      }),
  )
  expect(read).not.toThrow()
  const complete = read()
  expect(complete.lines).toHaveLength(1)
  expect(complete.read.ledgersSkipped ?? 0).toBe(0)
  expect(executed.some((sql) => /FROM events/.test(sql))).toBe(true)
  expect(executed.filter((sql) => /INDEXED BY/.test(sql))).toEqual([])
  db.prepare(
    `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x < @rows)
    INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
    SELECT 'noise-'||x,'owner',0,100+x,'turn','{"type":"turn","state":"completed"}',500 FROM n`,
  ).run({ rows: WINDOW_READ_BOUNDS.rows })
  expect(() => read()).toThrow(WindowReadUnavailable)
})

it.each([
  { from: 100, to: 100 },
  { from: 200, to: 100 },
  { from: 0, to: MAX_DIGEST_SPAN_MS + 1 },
  { from: -1, to: 200 },
  { from: 1.5, to: 200 },
])('rejects an invalid window %o', (input) => {
  expect(() => engine.read({ kind: 'activity', ...input })).toThrow()
  expect(windowReadQuery.safeParse({ kind: 'activity', ...input }).success).toBe(false)
})

it('the IPC host uses only the worker answer, and never falls back on failure', async () => {
  const expected = read()
  const worker: WindowStoreReader = {
    read: vi.fn(async () => expected),
    close: vi.fn(async () => {}),
  }
  const host = new RuntimeHost({
    store,
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
    windowReader: worker,
  })
  hosts.push(host)
  const scan = vi.spyOn(store, 'activityWindow')
  const oldScan = vi.spyOn(store, 'digestWindow')
  const naming = vi.spyOn(store, 'activityWorkNames')
  const sink = {
    ownerId: 'fictional-window',
    alive: true,
    aPersonIsBehindIt: true,
    send: () => {},
    sendLiveness: () => {},
  }
  const command = runtimeCommandSchema.parse({ kind: 'recentActivity', from: 100, to: 1000 })
  const answer = await executeRuntimeCommand(host, sink, command)
  expect(answer).toEqual({
    window: expected.window,
    read: expected.read,
    lines: expected.lines,
    capped: expected.capped,
  })
  expect(worker.read).toHaveBeenCalledExactlyOnceWith(query)
  expect(scan).not.toHaveBeenCalled()
  expect(oldScan).not.toHaveBeenCalled()
  expect(naming).not.toHaveBeenCalled()
  vi.mocked(worker.read).mockRejectedValue(new WindowReadUnavailable())
  await expect(executeRuntimeCommand(host, sink, command)).rejects.toThrow(WindowReadUnavailable)
  expect(scan).not.toHaveBeenCalled()
  expect(oldScan).not.toHaveBeenCalled()
})

it('the preload forwards exactly the requested window to the dedicated IPC verb', () => {
  const source = readFileSync(join(here, '../src/preload/index.ts'), 'utf8')
  const preload = ts.createSourceFile('preload.ts', source, ts.ScriptTarget.Latest, true)
  const runtime = preload.statements
    .flatMap((statement) =>
      ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
    )
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'runtime')
  const initial = runtime?.initializer
  if (
    initial === undefined ||
    !ts.isCallExpression(initial) ||
    initial.expression.getText(preload) !== 'Object.freeze'
  ) {
    throw new Error('The real preload runtime construction was not found')
  }
  const object = initial.arguments[0]
  if (object === undefined || !ts.isObjectLiteralExpression(object)) {
    throw new Error('The real preload runtime is not an object literal')
  }
  const property = object.properties.find(
    (member) =>
      ts.isPropertyAssignment(member) &&
      ts.isIdentifier(member.name) &&
      member.name.text === 'recentActivity',
  )
  if (
    property === undefined ||
    !ts.isPropertyAssignment(property) ||
    !ts.isArrowFunction(property.initializer)
  ) {
    throw new Error('The real recent activity forwarding function was not found')
  }
  // Run only this forwarding function: no Electron import or preload startup is executed.
  const compiled = ts.transpileModule(`const forward = ${property.initializer.getText(preload)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const result = Promise.resolve({ lines: [] })
  const command = vi.fn(() => result)
  const forward: (input: { from: number; to: number }) => unknown = new Function(
    'command',
    `${compiled}\nreturn forward;`,
  )(command)
  const inputs = [
    Object.freeze({ from: 110, to: 990, extra: 'must not cross the bridge' }),
    Object.freeze({ from: 1234, to: 5678, extra: 'still must not cross the bridge' }),
  ]
  for (const [index, input] of inputs.entries()) {
    expect(forward(input)).toBe(result)
    expect(command).toHaveBeenNthCalledWith(index + 1, {
      kind: 'recentActivity',
      from: input.from,
      to: input.to,
    })
  }
  expect(command).toHaveBeenCalledTimes(inputs.length)
})

it('a sparse historical window ignores many later digest rows', () => {
  db.prepare(
    `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x < @rows)
    INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
    SELECT 'later-'||x,'owner',0,100+x,'turn','{"type":"turn","state":"completed"}',2000 FROM n`,
  ).run({ rows: WINDOW_READ_BOUNDS.rows })
  expect(read).not.toThrow()
  const answer = read()
  expect(answer.lines).toHaveLength(1)
  expect(answer.lines[0]?.what).toBe('started')
  expect(answer.read.rowsUnread).toBe(0)
  expect(answer.capped).toBe(false)
})

it.each([undefined, null, 'surprising'])(
  'an only malformed reply with outcome %s is unread, not complete and empty',
  (outcome) => {
    db.prepare(
      `INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
    VALUES('malformed-only','owner',0,100,'work_replied',?,500)`,
    ).run(
      JSON.stringify({ type: 'work_replied', piece, outcome, summary: 'Fictional', resources: [] }),
    )
    const answer = engine.read({ kind: 'activity', from: 500, to: 501 })
    expect(answer).toMatchObject({ kind: 'activity', lines: [], read: { rowsUnread: 1 } })
  },
)

it('names only the selected 200 pieces and examines each owner retitle once', () => {
  const root = store.rootOf('owner')
  if (root === null) throw new Error('fictional root missing')
  const bulk = 10000
  db.transaction(() => {
    db.prepare(
      `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x+1 < @bulk)
      INSERT INTO work(id,parent_id,number,owner_session_id,given_by_session_id,title,brief,folder,created_at)
      SELECT 'many-'||x,@parent,x+2,'owner','owner','Bulk original','Fictional',null,500 FROM n`,
    ).run({ bulk, parent: root.piece })
    db.prepare(
      `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x+1 < @bulk)
      INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
      SELECT 'given-many-'||x,'owner',0,100+x,'work_given',json_object('type','work_given','piece','many-'||x,
        'parent',@parent,'label',@label||'.'||(x+2),'givenBy','owner','title','Bulk original','brief','Fictional'),500 FROM n`,
    ).run({ bulk, parent: root.piece, label: root.label })
    db.prepare(
      `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x+1 < @bulk)
      INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
      SELECT 'retitle-decoy-'||x,'owner',0,20000+x,'work_retitled',
        json_object('type','work_retitled','piece',@piece,'title','Decoy','by','owner'),1 FROM n`,
    ).run({ bulk, piece })
  })()
  const connection = (engine as unknown as { db: AppDatabase }).db
  let examined = 0
  let workProbes = 0
  connection.function('fictional_visited', (value: unknown) => {
    examined++
    if (typeof value !== 'string') throw new Error('fictional payload must be text')
    return value
  })
  const prepare: (sql: string) => AppStatement = connection.prepare.bind(connection)
  vi.spyOn(connection, 'prepare').mockImplementation((sql: string) => {
    let traced = sql
    if (/SELECT payload(?:, created_at)? FROM events/.test(sql)) {
      traced = traced
        .replace(
          'SELECT payload, created_at',
          'SELECT fictional_visited(payload) AS payload, created_at',
        )
        .replace(
          'SELECT payload FROM events',
          'SELECT fictional_visited(payload) AS payload FROM events',
        )
        .replaceAll('json_valid(payload)', 'json_valid(fictional_visited(payload))')
    }
    const statement = prepare(traced)
    if (!sql.includes('FROM work WHERE id = ?')) return statement
    return new Proxy(statement, {
      get(native, key) {
        if (key === 'get')
          return (...args: unknown[]) => {
            workProbes++
            return native.get(...args)
          }
        const value: unknown = Reflect.get(native, key, native)
        return typeof value === 'function' ? value.bind(native) : value
      },
    })
  })
  const answer = engine.read({ kind: 'activity', from: 500, to: 501 })
  if (answer.kind !== 'activity') throw new Error('wrong answer kind')
  expect(answer.lines).toHaveLength(200)
  expect(answer.capped).toBe(true)
  expect(answer.read.rowsUnread).toBe(0)
  expect(answer.read.ledgersSkipped ?? 0).toBe(0)
  expect(answer.lines.every((line) => line.piece.title === 'Bulk original')).toBe(true)
  console.info(
    'fictional activity naming cost',
    JSON.stringify({ examined, workProbes, lines: answer.lines.length, bulk }),
  )
  expect(examined).toBeGreaterThan(0)
  expect(examined).toBeLessThanOrEqual(bulk)
  expect(workProbes).toBeGreaterThan(0)
  expect(workProbes).toBeLessThanOrEqual(RECENT_ACTIVITY_LINES * 3)
})

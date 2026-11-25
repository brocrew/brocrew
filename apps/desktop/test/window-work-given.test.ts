import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import {
  WINDOW_READ_BOUNDS,
  WindowReadUnavailable,
  type WindowReadResult,
  type WindowStoreReader,
} from '../src/main/db/window-read-protocol'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { aLibraryHost, filesLibraryFixture } from './helpers/files-library-fixture'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { RecordingSink } from './lib/host-fixture'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})

function fixture() {
  const f = filesLibraryFixture()
  cleanup.push(() => f.close())
  for (const id of ['giver', 'holder']) f.owner(id)
  const root = f.store.ensurePersonalRoot('giver', 1)
  f.store.recordGive(
    {
      piece: 'given',
      parent: root.piece,
      number: 1,
      owner: 'holder',
      givenBy: 'giver',
      title: 'Fictional work',
      brief: 'Report the result',
      folder: null,
      inputs: [],
    },
    f.store.nextOrdinal('holder'),
    {
      type: 'work_given',
      piece: 'given',
      label: `${root.label}.1`,
      parent: root.piece,
      givenBy: 'giver',
      title: 'Fictional work',
      brief: 'Report the result',
    },
    2,
  )
  return f
}

function hostWith(f: ReturnType<typeof fixture>, reader?: WindowStoreReader) {
  const mainFold = vi.spyOn(f.store, 'workGivenOutBy').mockImplementation(() => {
    throw new Error('The window folded work on main')
  })
  const host = aLibraryHost(f.directory, {
    store: f.store,
    windowReader: reader,
    windowWriterStamp: windowWriterSampler(f.db, () => true),
  })
  cleanup.push(() => host.closeAll())
  return { host, mainFold }
}

const query = { kind: 'work-given', sessionId: 'giver' } as const

it('carries the full canonical walk across cold reads, malformed rows and an external commit', () => {
  const f = fixture()
  const engine = new WindowReadEngine(f.file)
  cleanup.push(() => engine.close())
  const compare = () => {
    const work = f.store.workGivenOutBy('giver')
    expect(work.rows.map((row) => row.piece)).toEqual(['given'])
    expect(engine.read(query)).toEqual({ kind: 'work-given', work })
    return work
  }
  expect(compare()).toMatchObject({ ledgers: 1, rowsUnread: 0 })
  expect(compare()).toMatchObject({ rowsUnread: 0 })
  const other = openDatabase(f.file)
  try {
    const store = createSessionStore(other)
    store.append(
      'holder',
      store.nextOrdinal('holder'),
      { type: 'work_replied', piece: 'given', outcome: 'done', summary: 'Done', resources: [] },
      3,
    )
  } finally {
    other.close()
  }
  f.store.checkCommitted()
  expect(compare().rows[0]?.state).toBe('answered')
  f.db
    .prepare(
      `INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at)
     VALUES ('bad','holder',0,?,'work_replied','{',4)`,
    )
    .run(f.store.nextOrdinal('holder'))
  f.store.checkCommitted()
  expect(compare().rowsUnread).toBe(1)
  expect(engine.read({ ...query, sessionId: 'unknown' })).toEqual({
    kind: 'work-given',
    work: f.store.workGivenOutBy('unknown'),
  })
})

it.each(['work', 'files'] as const)(
  "reads %s through the worker's kept piece folds, and a rewritten ledger again",
  async (kind) => {
    const f = fixture()
    f.keep('fictional-report', 'given', 'b'.repeat(64), { by: 'holder' })
    f.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<3000)
        INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at)
        SELECT 'status-' || i, 'holder', 0, i+10, 'status', '{"type":"status","state":"idle"}', 2
        FROM n`,
      )
      .run()
    const engine = new WindowReadEngine(f.file)
    const worker = (engine as unknown as { db: AppDatabase }).db
    const prepare = worker.prepare.bind(worker)
    let rows = 0
    vi.spyOn(worker, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql)
      if (sql.includes('json_remove')) {
        const iterate = statement.iterate.bind(statement)
        vi.spyOn(statement, 'iterate').mockImplementation(function* (...args) {
          for (const row of iterate(...args)) yield (rows++, row)
        })
      }
      return statement
    })
    const { host } = hostWith(f, {
      read: async (input) => engine.read(input),
      close: async () => engine.close(),
    })
    const read = () =>
      kind === 'work' ? host.workGivenBy('giver') : host.filesKeptForWindow('giver')
    const cold = await read()
    expect(rows).toBeGreaterThanOrEqual(3000)
    await host.readForWindow(() => undefined, 'listing')
    rows = 0
    for (let i = 0; i < 3; i++) expect(await read()).toEqual(cold)
    expect(rows).toBe(0)
    // An append is carried forward; a rewrite of an existing row reads that ledger again.
    f.db
      .prepare(
        "UPDATE events SET type='work_replied', payload=? WHERE session_id='holder' AND ordinal=3010",
      )
      .run(
        JSON.stringify({
          type: 'work_replied',
          piece: 'given',
          outcome: 'done',
          summary: 'Fictional result',
          resources: ['fictional-report'],
        }),
      )
    const corrected = await read()
    expect(corrected).not.toEqual(cold)
    expect(rows).toBeGreaterThanOrEqual(3000)
  },
)

it('reads Files cold when the writer cannot be sampled during a main-store transaction', async () => {
  const f = fixture()
  const engine = new WindowReadEngine(f.file)
  const { host } = hostWith(f, {
    read: async (input) => engine.read(input),
    close: async () => engine.close(),
  })
  const before = await host.filesKeptForWindow('giver')
  f.db.exec('BEGIN')
  try {
    expect(await host.filesKeptForWindow('giver')).toEqual(before)
  } finally {
    f.db.exec('ROLLBACK')
  }
})

it('reads Work cold after a rewrite overtakes its reused read', async () => {
  const f = fixture()
  const ordinal = f.store.nextOrdinal('holder')
  const reply = {
    type: 'work_replied' as const,
    piece: 'given',
    outcome: 'done' as const,
    summary: 'Fictional result',
    resources: [],
  }
  f.store.append('holder', ordinal, reply, 3)
  const engine = new WindowReadEngine(f.file)
  const asked: boolean[] = []
  const { host } = hostWith(f, {
    read: async (input) => {
      if (input.kind === 'work-given') {
        asked.push('reuse' in input)
        f.db
          .prepare("UPDATE events SET payload=? WHERE session_id='holder' AND ordinal=?")
          .run(
            JSON.stringify({ ...reply, outcome: asked.length === 1 ? 'failed' : 'blocked' }),
            ordinal,
          )
      }
      return engine.read(input)
    },
    close: async () => engine.close(),
  })
  await host.readForWindow(() => undefined, 'listing')
  const answer = await host.workGivenBy('giver')
  expect(asked).toEqual([true, false])
  expect(answer.rows[0]?.outcome).toBe('blocked')
  expect(answer).toEqual(createSessionStore(f.db).workGivenOutBy('giver'))
})

it('executes the window command in a real worker and handles input before its held reply', async () => {
  const f = fixture()
  const bundle = await bundleAWorker('src/main/window-reader.worker.ts', f.directory, 'work.cjs')
  const reader = new WindowWorkerReader(new Worker(bundle, { workerData: { file: f.file } }))
  let release!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  let arrived!: () => void
  const nativeRead = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const { host, mainFold } = hostWith(f, {
    read: async (input, signal) => {
      const result = await reader.read(input, signal)
      if (input.kind === 'work-given') {
        arrived()
        await hold
      }
      return result
    },
    close: () => reader.close(),
  })
  const expected = createSessionStore(f.db).workGivenOutBy('giver')
  let settled = false
  const pending = executeRuntimeCommand(host, new RecordingSink('work-window'), {
    kind: 'workGivenBy',
    sessionId: 'giver',
  }).then((answer) => {
    settled = true
    return answer
  })
  try {
    await nativeRead
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(host.readConversationIdentity('giver')).not.toBeNull()
    expect(settled).toBe(false)
    expect(mainFold).not.toHaveBeenCalled()
  } finally {
    release()
  }
  expect(await pending).toEqual(expected)
  expect(mainFold).not.toHaveBeenCalled()
}, 60_000)

it.each(['missing', 'busy', 'failed'] as const)(
  'refuses a %s reader without folding on main',
  async (failure) => {
    const f = fixture()
    const { host, mainFold } = hostWith(
      f,
      failure === 'missing'
        ? undefined
        : {
            read: async () => {
              throw new WindowReadUnavailable(failure === 'busy' ? 'busy' : 'failed')
            },
            close: async () => {},
          },
    )
    await expect(host.workGivenBy('giver')).rejects.toThrow()
    expect(mainFold).not.toHaveBeenCalled()
  },
)

it('retains the generic two-attempt snapshot rule when a writer overtakes each reply', async () => {
  const f = fixture()
  const engine = new WindowReadEngine(f.file)
  const read = vi.fn(async (input: Parameters<WindowReadEngine['read']>[0]) => {
    const result = engine.read(input)
    if (input.kind === 'work-given')
      f.store.setAgentDisplayName('holder', `Moved ${read.mock.calls.length}`)
    return result
  })
  const { host, mainFold } = hostWith(f, { read, close: async () => engine.close() })
  const before = createSessionStore(f.db).workGivenOutBy('giver')
  expect(await host.workGivenBy('giver')).toEqual(before)
  expect(read.mock.calls.filter(([input]) => input.kind === 'work-given')).toHaveLength(2)
  expect(mainFold).not.toHaveBeenCalled()
})

it('settles a pending read on close and never starts another one', async () => {
  const f = fixture()
  let reject!: (error: Error) => void
  const read = vi.fn(
    () =>
      new Promise<WindowReadResult>((_resolve, failed) => {
        reject = failed
      }),
  )
  const { host, mainFold } = hostWith(f, {
    read,
    close: async () => reject(new WindowReadUnavailable()),
  })
  const pending = host.workGivenBy('giver')
  const refused = expect(pending).rejects.toThrow()
  await host.closeAll()
  await refused
  const calls = read.mock.calls.length
  await expect(host.workGivenBy('giver')).rejects.toThrow()
  expect(read).toHaveBeenCalledTimes(calls)
  expect(mainFold).not.toHaveBeenCalled()
})

it('admits Files and listing while two Work replies still hold their reader permits', async () => {
  const f = fixture()
  const bundle = await bundleAWorker(
    'src/main/window-reader.worker.ts',
    f.directory,
    'headroom.cjs',
  )
  expect(WINDOW_READ_BOUNDS.pending).toBe(16)

  for (const workCount of [4, 2]) {
    const worker = new Worker(bundle, { workerData: { file: f.file } })
    const transport = Object.assign(new EventEmitter(), {
      postMessage: worker.postMessage.bind(worker),
      terminate: worker.terminate.bind(worker),
    })
    const reader = new WindowWorkerReader(transport)
    const held: Array<{ id: number; type: 'read' | 'failed'; result?: WindowReadResult }> = []
    const occupied = 12 + workCount
    let withhold = true
    worker.on('message', (message) => {
      // A delivered reply, not the worker finishing its query, releases the reader permit.
      if (withhold && message.id <= occupied && ['read', 'failed'].includes(message.type))
        held.push(message)
      else transport.emit('message', message)
    })
    worker.on('error', (error) => transport.emit('error', error))
    worker.on('exit', (code) => transport.emit('exit', code))

    const earlier = Promise.allSettled([
      ...Array.from({ length: 12 }, () => reader.read({ kind: 'activity', from: 0, to: 10 })),
      ...Array.from({ length: workCount }, () => reader.read(query)),
    ])
    try {
      const files = reader.read({ kind: 'files', sessionId: 'giver', givers: ['giver'] })
      const listing = reader.read({ kind: 'listing' })
      if (workCount === 4) {
        await Promise.all([
          expect(files).rejects.toMatchObject({ why: 'busy' }),
          expect(listing).rejects.toMatchObject({ why: 'busy' }),
        ])
      } else {
        await Promise.all([
          expect(files).resolves.toMatchObject({ kind: 'files' }),
          expect(listing).resolves.toMatchObject({ kind: 'listing' }),
        ])
        expect(held).toHaveLength(occupied)
        expect(held.filter((reply) => reply.result?.kind === 'work-given')).toHaveLength(2)
      }
    } finally {
      withhold = false
      for (const message of held) transport.emit('message', message)
      await reader.close()
      await earlier
    }
  }
}, 60_000)

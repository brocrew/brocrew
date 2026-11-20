import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import {
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
  f.db.prepare(
    `INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at)
     VALUES ('bad','holder',0,?,'work_replied','{',4)`,
  ).run(f.store.nextOrdinal('holder'))
  f.store.checkCommitted()
  expect(compare().rowsUnread).toBe(1)
  expect(engine.read({ ...query, sessionId: 'unknown' })).toEqual({
    kind: 'work-given',
    work: f.store.workGivenOutBy('unknown'),
  })
})

it('executes the window command in a real worker and handles input before its held reply', async () => {
  const f = fixture()
  const expected = f.store.workGivenOutBy('giver')
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
  const before = f.store.workGivenOutBy('giver')
  const { host, mainFold } = hostWith(f, { read, close: async () => engine.close() })
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

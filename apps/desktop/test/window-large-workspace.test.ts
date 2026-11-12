import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize } from 'node:v8'
import { Worker } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { WindowReadUnavailable, type WindowReadQuery } from '../src/main/db/window-read-protocol'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { aLibraryHost } from './helpers/files-library-fixture'

it('reads a complete W4-sized routing snapshot once across 154 overlapping window requests', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-large-window-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  const expected = new Map<string, string[]>()
  db.transaction(() => {
    for (let i = 0; i < 1893; i++) {
      const session = `fictional-${i}`
      store.create({
        id: session,
        provider: 'codex',
        profileId: 'fictional-reader',
        cwd: directory,
        approvalMode: 'ask',
      })
      const ids = [0, 1].map((n) => `${session}-${n}-${'q'.repeat(1200)}`)
      expected.set(session, ids)
      for (const requestId of ids) {
        store.append(
          session,
          store.nextOrdinal(session),
          {
            type: 'question_asked',
            requestId,
            prompt: 'Fictional question',
            questions: [{ id: 'part', prompt: 'Fictional choice', options: [] }],
          },
          1000 + i,
        )
        store.append(
          session,
          store.nextOrdinal(session),
          {
            type: 'request_routed',
            requestId,
            to: 'the-parent',
            parent: 'fictional-hub',
          },
          1000 + i,
        )
      }
    }
  })()
  const workerFile = await bundleAWorker(
    'src/main/window-reader.worker.ts',
    directory,
    'window.cjs',
  )
  const reader = new WindowWorkerReader(
    new Worker(workerFile, {
      workerData: { file },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    }),
  )
  let replyBytes = 0
  const read = vi.fn(async (query: WindowReadQuery) => {
    try {
      const answer = await reader.read(query)
      if (answer.kind !== 'routes') throw new Error('wrong window reading')
      expect(
        new Map(
          answer.routes.map((route) => [
            route.sessionId,
            route.requests.map((row) => row.requestId),
          ]),
        ),
      ).toEqual(expected)
      replyBytes = serialize(answer).byteLength
      return answer
    } catch (error) {
      console.log(
        'Large window read failure',
        error instanceof WindowReadUnavailable ? error.reason : error,
      )
      throw error
    }
  })
  const named = vi.spyOn(store, 'workThatNamesAndItsWait')
  const onMain = vi.fn(() => {
    throw new Error('routing fold on the main thread')
  })
  const host = aLibraryHost(directory, {
    store: {
      ...store,
      routedRequestsOf: onMain,
      questionsAPersonMustAnswer: onMain,
      decisionsAwaitingAPerson: onMain,
    },
    windowReader: { read, close: () => reader.close() },
    afterFirstWindowLoad: new Promise<void>(() => {}),
    windowWriterStamp: windowWriterSampler(db, () => true),
    limitsWriterStamp: limitsWriterSampler(db, () => true),
  })
  try {
    const answers = await Promise.all(
      Array.from({ length: 154 }, () => host.readForWindow(() => host.unresumableSessions())),
    )
    expect(read).toHaveBeenCalledOnce()
    expect(onMain).not.toHaveBeenCalled()
    for (const answer of answers)
      expect(new Set(answer.map((row) => row.sessionId))).toEqual(new Set(expected.keys()))
    expect(named).toHaveBeenCalledTimes(expected.size)
    expect(replyBytes).toBeGreaterThan(4 * 1024 * 1024)
    console.log(
      'Large window fixture',
      JSON.stringify({
        conversations: expected.size,
        calls: answers.length,
        workerReads: read.mock.calls.length,
        mainReads: onMain.mock.calls.length,
        workReads: named.mock.calls.length,
        replyBytes,
      }),
    )
  } finally {
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 60_000)

it('never recomputes on main during 154 misses at a remembered failed revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-failed-window-'))
  const db = openDatabase(join(directory, 'fictional.sqlite'))
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  const read = vi.fn(async (): Promise<never> => {
    throw new WindowReadUnavailable('failed', 'reply')
  })
  const host = aLibraryHost(directory, {
    store,
    windowReader: { read, close: async () => {} },
    windowWriterStamp: windowWriterSampler(db, () => true),
    limitsWriterStamp: limitsWriterSampler(db, () => true),
  })
  const compose = vi.fn(() => store.questionsAPersonMustAnswer())
  try {
    for (let i = 0; i < 154; i++)
      await expect(host.readForWindow(compose)).rejects.toThrow(WindowReadUnavailable)
    expect(read).toHaveBeenCalledOnce()
    expect(compose).not.toHaveBeenCalled()
    read.mockClear()
    const sink = {
      ownerId: 'fictional-window',
      alive: true,
      aPersonIsBehindIt: true,
      send: () => {},
      sendLiveness: () => {},
    }
    for (let i = 0; i < 154; i++)
      await expect(
        executeRuntimeCommand(host, sink, { kind: 'whatIsBeingDone' }),
      ).resolves.toMatchObject({ conversations: [] })
    expect(read).not.toHaveBeenCalled()
  } finally {
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

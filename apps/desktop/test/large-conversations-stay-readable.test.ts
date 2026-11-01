import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { WINDOW_READ_BOUNDS } from '../src/main/db/window-read-protocol'
import { WindowWorkerReader } from '../src/main/db/window-worker-reader'
import { bundleAWorker } from './helpers/bundle-a-worker'

describe.each([175_930, 297_164])('a fictional %i-event conversation', (count) => {
  let directory: string
  let file: string
  let db: AppDatabase | undefined
  let probeStart: number
  const probe = (phase: string) =>
    process.stdout.write(
      'LEDGER_PHASE ' +
        JSON.stringify({ count, phase, elapsedMs: performance.now() - probeStart }) +
        '\n',
    )
  // Building the fictional ledger has its own budget; the read keeps the project's 60 seconds.
  beforeAll(() => {
    probeStart = performance.now()
    directory = mkdtempSync(join(tmpdir(), 'fictional-large-ledger-'))
    file = join(directory, 'fictional.sqlite')
    db = openDatabase(file)
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    const store = createSessionStore(db)
    store.create({
      id: 'atlas',
      provider: 'codex',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'atlas-reader',
    })
    store.ensurePersonalRoot('atlas', 1)
    if (count === 175_930) {
      const root = store.rootOf('atlas')!
      store.recordGive(
        {
          piece: 'atlas-piece',
          parent: root.piece,
          number: 1,
          owner: 'atlas',
          givenBy: null,
          title: 'Atlas work',
          brief: 'Fictional work',
          folder: null,
          inputs: [],
        },
        1,
        {
          type: 'work_given',
          piece: 'atlas-piece',
          label: `${root.label}.1`,
          parent: root.piece,
          givenBy: null,
          title: 'Atlas work',
          brief: 'Fictional work',
        },
        11,
      )
    }
    probe('database-ready')
    // A connection without the store's fold watch, which would otherwise run for every row.
    const rows = openDatabase(file)
    try {
      const insert = rows.prepare(`INSERT INTO events
        (id, session_id, generation, ordinal, type, payload, created_at)
        VALUES (?, 'atlas', 0, ?, ?, ?, ?)`)
      const payload = JSON.stringify({
        type: count === 175_930 ? 'status' : 'launched',
        state: 'idle',
        padding: count === 175_930 ? 'x'.repeat(2048) : '',
      })
      rows.transaction(() => {
        for (let i = 0; i < count; i++) {
          if (count === 175_930 && i === 1) continue
          const event =
            i === 0
              ? {
                  type: 'request_routed',
                  requestId: 'atlas-question',
                  to: 'a-person',
                  parent: null,
                }
              : i === count - 1
                ? { type: 'request_resolved', id: 'atlas-question' }
                : count === 175_930 && i === count - 2
                  ? { type: 'work_closed', piece: 'atlas-piece', by: 'person' }
                  : null
          const type =
            event?.type ?? (count === 175_930 ? (i > 18_114 ? 'text' : 'status') : 'launched')
          insert.run(
            `atlas-${i}`,
            i,
            type,
            event === null
              ? type === 'text'
                ? '{"type":"text"}'
                : payload
              : JSON.stringify(event),
            i + 10,
          )
        }
      })()
    } finally {
      rows.close()
    }
    probe('fixture-ready')
  }, 60_000)
  afterAll(() => {
    db?.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it(`completely reads a fictional ${count}-event conversation`, () => {
    if (db === undefined) throw new Error('No fictional ledger')
    probeStart = performance.now()
    const engine = new WindowReadEngine(file)
    try {
      for (const kind of ['routes', 'incidents'] as const) {
        const result = engine.read({ kind })
        probe(`${kind}-read`)
        if (result.kind === 'routes') {
          expect(result.routes).toHaveLength(1)
          expect(result.routes[0]?.skipped).toEqual([])
          expect(result.routes[0]?.requests).toMatchObject([
            { requestId: 'atlas-question', state: 'withdrawn' },
          ])
          expect(result.questions.rows).toEqual([])
          expect(result.questions.rowsUnread).toBe(0)
        } else if (result.kind === 'incidents') {
          expect(result.owners).toHaveLength(1)
          expect(result.owners[0]?.routes).toMatchObject([
            { requestId: 'atlas-question', state: 'withdrawn' },
          ])
          expect(result.owners[0]?.routesSkipped).toEqual([])
          expect(result.owners[0]?.piecesSkipped).toEqual([])
          expect(result.owners[0]?.pieces).toEqual([])
        }
      }
      // A new snapshot must see a same-bound rewrite, rather than returning the last success.
      db.prepare(
        'UPDATE events SET payload = \'{"type":"request_stranded","requestId":"atlas-question"}\', type = \'request_stranded\' WHERE ordinal = ?',
      ).run(count - 1)
      const changed = engine.read({ kind: 'routes' })
      probe('rewrite-read')
      if (changed.kind !== 'routes') throw new Error('Wrong result')
      expect(changed.routes[0]?.requests[0]?.state).toBe('stranded')
    } finally {
      engine.close()
    }
  })
})

it.each(['rows', 'bytes', 'reply', 'cancelled', 'unread'] as const)(
  'keeps a closed %s failure and never returns a swallowed partial fold',
  async (reason) => {
    const directory = mkdtempSync(join(tmpdir(), 'fictional-reader-bound-'))
    const file = join(directory, 'fictional.sqlite')
    const db = openDatabase(file)
    let engine: WindowReadEngine | undefined
    let native: WindowWorkerReader | undefined
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      applyMigrations(
        db,
        join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'),
      )
      const store = createSessionStore(db)
      store.create({
        id: 'atlas',
        provider: 'codex',
        cwd: directory,
        approvalMode: 'ask',
        profileId: 'atlas-reader',
      })
      store.ensurePersonalRoot('atlas', 1)
      const insert = db.prepare(`INSERT INTO events
        (id, session_id, generation, ordinal, type, payload, created_at)
        VALUES (?, 'atlas', 0, ?, ?, ?, ?)`)
      const count =
        reason === 'rows' || reason === 'unread'
          ? Math.ceil(WINDOW_READ_BOUNDS.rows / 3) + 2
          : reason === 'cancelled'
            ? 2000
            : 1
      db.transaction(() => {
        for (let i = 0; i < count; i++) {
          const event =
            reason === 'reply'
              ? {
                  type: 'message_queued',
                  messageId: 'atlas-message',
                  text: 'x'.repeat(WINDOW_READ_BOUNDS.replyBytes),
                  kind: 'work',
                }
              : {
                  type: 'request_routed',
                  requestId:
                    reason === 'bytes'
                      ? 'x'.repeat(WINDOW_READ_BOUNDS.bytes)
                      : `atlas-question-${i}`,
                  to: 'a-person',
                  parent: null,
                }
          insert.run(
            `atlas-${i}`,
            i,
            reason === 'unread' && i > 0 ? 'launched' : event.type,
            reason === 'unread' && i > 0 ? '{' : JSON.stringify(event),
            i + 10,
          )
        }
      })()
      engine = new WindowReadEngine(file)
      let polls = 0
      expect(() =>
        engine!.read(
          { kind: reason === 'reply' ? 'incidents' : 'routes' },
          () => reason === 'cancelled' && ++polls > 1024,
        ),
      ).toThrow(
        expect.objectContaining({ why: 'failed', reason: reason === 'unread' ? 'rows' : reason }),
      )
      if (reason === 'cancelled') expect(polls).toBeGreaterThan(WINDOW_READ_BOUNDS.foldPageRows)
      if (reason === 'reply') {
        const workerFile = await bundleAWorker(
          'src/main/window-reader.worker.ts',
          directory,
          'reader.cjs',
        )
        native = new WindowWorkerReader(new Worker(workerFile, { workerData: { file } }))
        await expect(native.read({ kind: 'incidents' })).rejects.toMatchObject({
          why: 'failed',
          reason: 'reply',
        })
      }
      // Failure rolls back its snapshot and does not poison a later successful read.
      db.prepare('DELETE FROM events').run()
      expect(engine.read({ kind: 'routes' })).toMatchObject({ kind: 'routes', routes: [] })
    } finally {
      warning.mockRestore()
      await native?.close()
      engine?.close()
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { windowMemoryHost } from './helpers/window-memory-host'
import { bundleAWorker } from './helpers/bundle-a-worker'

it('lists a large fictional workspace with resolved question history at the production worker heap', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-window-history-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  const store = createSessionStore(db)
  const conversations = 1960
  const questionsPerConversation = 40
  const words =
    'The fictional review compares the recorded task with the proposed implementation. '.repeat(24)
  // Every conversation holds the same history, written for all of them by one statement: a call
  // per row took about half of the fixture's time on macOS.
  const history = Array.from({ length: questionsPerConversation }, (_, q) => {
    const requestId = `question-${q}`
    return [
      {
        type: 'question_asked',
        requestId,
        prompt: words,
        context: words,
        questions: [
          { id: 'choice', prompt: 'Which fictional option?', options: ['Keep', 'Change'] },
        ],
      },
      { type: 'request_routed', requestId, to: 'a-person', parent: null },
      { type: 'request_resolved', id: requestId },
    ]
  })
    .flat()
    .map((event, ordinal) => ({ ordinal, type: event.type, payload: JSON.stringify(event) }))
  // This disposable fixture needs no crash durability while it is built, so its writes skip the
  // disk syncs that took seconds on Linux. It is still written and checkpointed before the reader
  // starts, and the setting is restored then.
  const synchronous = db.pragma('synchronous', { simple: true })
  db.pragma('synchronous = OFF')
  db.transaction(() => {
    for (let owner = 0; owner < conversations; owner++) {
      store.create({
        id: `fictional-history-${owner}`,
        provider: 'codex',
        profileId: 'brobot',
        ...(owner < 8 ? {} : { parentSessionId: `fictional-history-${owner % 8}` }),
        cwd: directory,
        approvalMode: 'ask',
      })
    }
    db.prepare(
      `WITH RECURSIVE owner(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM owner WHERE n < @last),
       event AS (
         SELECT json_extract(value, '$.ordinal') AS ordinal, json_extract(value, '$.type') AS type,
                json_extract(value, '$.payload') AS payload
           FROM json_each(@history)
       )
       INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       SELECT 'fictional-history-' || n || '-' || ordinal, 'fictional-history-' || n, 0, ordinal,
              type, payload, 1000 + ordinal
         FROM owner CROSS JOIN event ORDER BY n, ordinal`,
    ).run({ last: conversations - 1, history: JSON.stringify(history) })
  })()
  db.prepare(
    'UPDATE provider_session SET profile_id = NULL, agent_identity_id = NULL WHERE id = ?',
  ).run('fictional-history-0')
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.pragma(`synchronous = ${synchronous}`)
  console.log(
    'Window history fixture',
    JSON.stringify({
      conversations,
      questionsPerConversation,
      events: conversations * questionsPerConversation * 3,
      databaseBytes: statSync(file).size,
      promptCharacters: words.length,
      contextCharacters: words.length,
    }),
  )
  const workerFile = await bundleAWorker(
    'src/main/window-reader.worker.ts',
    directory,
    'window.cjs',
  )
  const worker = new Worker(workerFile, {
    workerData: { file },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
  })
  worker.on('error', (error) =>
    console.log('Window history worker error', error.name, error.message),
  )
  const { host, onMain } = windowMemoryHost(directory, db, store, worker)
  const sink = {
    ownerId: 'fictional-window',
    alive: true,
    aPersonIsBehindIt: true,
    send: () => {},
    sendLiveness: () => {},
  }
  try {
    expect(worker.resourceLimits?.maxOldGenerationSizeMb).toBe(128)
    const recent = await executeRuntimeCommand(host, sink, { kind: 'listResumable' })
    const remaining = await executeRuntimeCommand(host, sink, { kind: 'listUnresumable' })
    expect(recent).toEqual([])
    expect(remaining).toHaveLength(conversations)
    const selected = await host.listConversations()
    if ('refused' in selected) throw new Error(selected.refused)
    expect(selected.resumable).toEqual([])
    expect(selected.unresumable.map((row) => row.sessionId).sort()).toEqual(
      Array.from({ length: conversations }, (_, n) => `fictional-history-${n}`).sort(),
    )
    expect(selected.unresumable).toEqual(remaining)
    expect(selected.published.covers).toEqual({ population: 'listing', complete: true })
    expect(onMain).not.toHaveBeenCalled()
    console.log(
      'Window history result',
      JSON.stringify({ conversations, mainHistoryReads: onMain.mock.calls.length }),
    )
  } finally {
    await host.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 60_000)

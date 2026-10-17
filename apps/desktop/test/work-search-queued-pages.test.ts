import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WorkSearchEngine } from '../src/main/db/work-search-engine'
import { WorkSearchWorkerReader } from '../src/main/db/work-search-reader'
import { workSearchInWords } from '../src/shared/work-search-words'
import type { WorkSearchResult } from '../src/shared/work-search'
import { bundleAWorker } from './helpers/bundle-a-worker'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = mkdtempSync(join(tmpdir(), 'fictional-work-search-'))
const file = join(directory, 'fictional.sqlite')
const db = openDatabase(file)
applyMigrations(db, join(root, 'src/main/db/migrations'))
const store = createSessionStore(db)

beforeAll(async () => {
  // Separate owners exercise ledger folds as well as the candidate scan.
  for (let i = 0; i < 160; i++) {
    store.create({
      id: `fictional_${i}`,
      provider: 'codex',
      profileId: `profile_${i}`,
      cwd: directory,
      approvalMode: 'ask',
    })
  }
  const identity = store.agentIdentities().find((row) => row.slug === 'profile_1')
  if (identity === undefined) throw new Error('fictional identity missing')
  store.create({
    id: 'fictional_worker',
    provider: 'codex',
    profileId: 'profile_1',
    cwd: directory,
    approvalMode: 'ask',
    parentSessionId: 'fictional_0',
    worker: {
      identity: identity.id,
      identityCreatedAt: identity.createdAt,
      giver: 'fictional_0',
      number: 1,
    },
  })
  store.create({
    id: 'fictional_service',
    provider: 'codex',
    profileId: 'service',
    cwd: directory,
    approvalMode: 'ask',
    service: true,
  })
  await bundleAWorker('src/main/work-search.worker.ts', directory, 'search.cjs')
})
afterAll(() => {
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

it('returns a partial page on a slow large ledger and continues without losing or repeating work', () => {
  let clock = 0
  let slow = true
  const engine = new WorkSearchEngine(file, () => (clock += slow ? 1 : 0))
  const query = { scope: 'all' as const, limit: 50 }
  const checkpoints: WorkSearchResult[] = []
  try {
    const first = engine.read('fictional_0', query, (result) => checkpoints.push(result))
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('fictional first page failed')
    expect(first.page.complete).toBe(false)
    expect(first.page.hits.length).toBeGreaterThan(0)
    expect(first.page.next_cursor).not.toBeNull()
    expect(first.page.searched).toBeLessThan(query.limit)
    expect(workSearchInWords(first.page)).toContain('Older work has not been searched yet.')
    expect(checkpoints[0]).toMatchObject({ ok: true, page: { searched: 0, complete: false } })
    const initial = checkpoints[0]
    if (!initial?.ok || initial.page.next_cursor === null) throw new Error('no initial checkpoint')
    slow = false
    const all = new Set(first.page.hits.map((hit) => hit.piece))
    let cursor = first.page.next_cursor
    for (let page = 0; cursor !== null && page < 10; page++) {
      const next = engine.read('fictional_0', { ...query, cursor })
      if (!next.ok) throw new Error('fictional continuation failed')
      for (const hit of next.page.hits) {
        expect(all.has(hit.piece)).toBe(false)
        all.add(hit.piece)
      }
      cursor = next.page.next_cursor
    }
    expect(cursor).toBeNull()
    expect(all.size).toBe(160)
    // Even a deadline before the first candidate carries a usable, query-bound cursor.
    const restart = engine.read('fictional_0', { ...query, cursor: initial.page.next_cursor })
    expect(restart.ok && restart.page.hits.length).toBe(50)
    expect(
      engine.read('fictional_0', { ...query, words: 'changed', cursor: initial.page.next_cursor }),
    ).toEqual({ ok: false, reason: 'cursor-invalid' })
  } finally {
    engine.close()
  }
})

it('the shipped worker publishes checkpoints and answers five queued callers including a worker and a service', async () => {
  const progress: unknown[] = []
  const reader = new WorkSearchWorkerReader((caller, query) => {
    const worker = new Worker(join(directory, 'search.cjs'), {
      workerData: { file, caller, query },
    })
    worker.on('message', (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'progress'
      )
        progress.push(message)
    })
    return worker
  })
  try {
    expect(store.conversationBinding('fictional_worker')).not.toBeNull()
    expect(store.conversationBinding('fictional_service')).not.toBeNull()
    const pages = await Promise.all(
      ['fictional_0', 'fictional_worker', 'fictional_service', 'fictional_1', 'fictional_2'].map(
        (caller) => reader.read(caller, { scope: 'all', limit: 1 }),
      ),
    )
    expect(pages.every((page) => page.ok)).toBe(true)
    expect(pages.map((page) => page.ok && page.page.hits.map((hit) => hit.piece))).toEqual(
      pages.map(() => pages[0]?.ok && pages[0].page.hits.map((hit) => hit.piece)),
    )
    expect(progress.length).toBeGreaterThanOrEqual(5)
    expect(progress).toContainEqual(
      expect.objectContaining({
        kind: 'progress',
        result: expect.objectContaining({
          page: expect.objectContaining({
            hits: expect.arrayContaining([expect.objectContaining({ piece: expect.any(String) })]),
          }),
        }),
      }),
    )
  } finally {
    await reader.close()
  }
})

it('a real worker read failure refuses instead of inventing an empty page', async () => {
  const reader = new WorkSearchWorkerReader(
    (caller, query) =>
      new Worker(join(directory, 'search.cjs'), {
        workerData: { file: join(directory, 'missing-fictional.sqlite'), caller, query },
      }),
  )
  try {
    expect(await reader.read('fictional_0', { scope: 'all' })).toEqual({
      ok: false,
      reason: 'unavailable',
    })
  } finally {
    await reader.close()
  }
})

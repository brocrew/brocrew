import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { archivedConversationsIn } from '../src/main/archived-file'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { WorkSearchEngine } from '../src/main/db/work-search-engine'
import { WorkSearchWorkerReader } from '../src/main/db/work-search-reader'
import { workSearchInWords } from '../src/shared/work-search-words'
import {
  WORK_SEARCH_BOUNDS,
  workSearchResult,
  type WorkSearchResult,
} from '../src/shared/work-search'
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

it('returns a single conversation row for matching ended and open tasks', () => {
  const owner = 'fictional_0'
  const giver = 'fictional_2'
  const parent = store.rootOf(giver)!
  const address = store.rootOf(owner)!.label
  const at = Date.now()
  const labels: string[] = []
  for (const [index, title] of ['Indexed ended task', 'Indexed open task'].entries()) {
    const piece = `work_indexed_${String(index)}`
    const number = store.numberUnder(parent.piece)
    const given = {
      type: 'work_given' as const,
      piece,
      label: `${parent.label}.${String(number)}`,
      parent: parent.piece,
      givenBy: giver,
      title,
      brief: 'Archive details',
      definitionOfDone: 'Document the sources',
    }
    labels.push(given.label)
    store.recordGive(
      { ...given, number, owner, folder: null, inputs: [] },
      store.nextOrdinal(owner),
      given,
      at + index,
    )
  }
  store.append(
    owner,
    store.nextOrdinal(owner),
    {
      type: 'work_replied',
      piece: 'work_indexed_0',
      outcome: 'done',
      summary: 'Completed that task',
      resources: [],
    },
    at + 2,
  )
  store.append(
    owner,
    store.nextOrdinal(owner),
    { type: 'work_status_set', piece: 'work_indexed_1', line: 'Consult the librarian', by: owner },
    at + 3,
  )
  store.titleConversation(
    owner,
    store.nextOrdinal(owner),
    {
      type: 'titled',
      title: 'Catalogue rebuild',
      author: { kind: 'person' },
    },
    at + 4,
  )
  const engine = new WorkSearchEngine(file)
  try {
    const result = engine.read(giver, { profile: 'profile_0', words: 'Archive details' })
    expect(result).toMatchObject({
      ok: true,
      page: {
        hits: [
          {
            conversation: owner,
            address,
            title: 'Catalogue rebuild',
            profile: 'profile_0',
            matched_tasks: [
              { title: 'Indexed open task' },
              { title: 'Indexed ended task', state: 'answered' },
            ],
          },
        ],
      },
    })
    expect(engine.read(giver, { words: address, profile: 'profile_0' })).toMatchObject({
      ok: true,
      page: { hits: [{ conversation: owner }] },
    })
    expect(
      engine.read(giver, { grouped: true, profile: 'profile_0', words: 'Archive details' }),
    ).toMatchObject({
      ok: true,
      page: {
        grouped: {
          matched: 1,
          groups: [
            {
              matched: 1,
              previews: [
                {
                  conversation: owner,
                  matched_task_labels: [labels[1], labels[0]],
                  tasks_omitted: 0,
                },
              ],
            },
          ],
        },
      },
    })
    const palette = { scope: 'all' as const, profile: 'profile_0' }
    for (const words of [address, 'Archive details', 'Consult the librarian']) {
      expect(engine.read(giver, { ...palette, words })).toMatchObject({
        ok: true,
        page: { hits: [] },
      })
    }
    for (const words of ['Indexed ended', 'Document the sources', 'Completed that task']) {
      expect(engine.read(giver, { ...palette, words })).toMatchObject({
        ok: true,
        page: {
          hits: [
            {
              conversation: owner,
              matched_tasks: expect.arrayContaining([
                expect.objectContaining({ title: 'Indexed ended task' }),
              ]),
            },
          ],
        },
      })
    }
    expect(engine.read(giver, { words: 'Catalogue rebuild', profile: 'profile_0' })).toMatchObject({
      ok: true,
      page: { hits: [{ conversation: owner, matched_tasks: [] }] },
    })
    expect(engine.read(giver, { profile: 'profile_0', from: '2100-01-01' })).toMatchObject({
      ok: true,
      page: { hits: [] },
    })
  } finally {
    engine.close()
  }
})

it('continues all matching tasks for the existing task palette through the same conversation search', () => {
  const owner = 'fictional_3'
  const giver = 'fictional_2'
  const parent = store.rootOf(giver)!
  const at = Date.now()
  const expected: string[] = []
  for (let i = 0; i < 55; i++) {
    const piece = `work_palette_${i}`
    const number = store.numberUnder(parent.piece)
    const given = {
      type: 'work_given' as const,
      piece,
      label: `${parent.label}.${number}`,
      parent: parent.piece,
      givenBy: giver,
      title: `Fictional lift task ${i}`,
      brief: 'Inspect the work area',
      definitionOfDone: 'Palette window placement',
    }
    store.recordGive(
      { ...given, number, owner, folder: null, inputs: [] },
      store.nextOrdinal(owner),
      given,
      at + i,
    )
    expected.unshift(piece)
  }
  const engine = new WorkSearchEngine(file)
  try {
    const agent = engine.read(giver, { profile: 'profile_3', words: 'Palette window placement' })
    expect(agent).toMatchObject({
      ok: true,
      page: {
        hits: [{ conversation: owner, tasks_omitted: expect.any(Number) }],
        next_cursor: null,
      },
    })

    const query = { scope: 'all' as const, profile: 'profile_3', words: 'Palette window placement' }
    const found: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const result = engine.read(giver, { ...query, cursor })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('fictional palette page failed')
      expect(result.page.hits).toHaveLength(1)
      expect(result.page.hits[0]?.conversation).toBe(owner)
      found.push(...result.page.hits.flatMap((row) => row.matched_tasks.map((task) => task.piece)))
      cursor = result.page.next_cursor ?? undefined
      if (cursor === undefined) break
    }
    expect(cursor).toBeUndefined()
    expect(found).toEqual(expected)
  } finally {
    engine.close()
  }
})

it('returns a partial page on a slow large ledger and continues without losing or repeating work', () => {
  let clock = 0
  let slow = true
  const engine = new WorkSearchEngine(file, () => (clock += slow ? 1 : 0))
  const query = { limit: 50 }
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
    const all = new Set(first.page.hits.map((hit) => hit.conversation))
    let cursor = first.page.next_cursor
    for (let page = 0; cursor !== null && page < 10; page++) {
      const next = engine.read('fictional_0', { ...query, cursor })
      if (!next.ok) throw new Error('fictional continuation failed')
      for (const hit of next.page.hits) {
        expect(all.has(hit.conversation)).toBe(false)
        all.add(hit.conversation)
      }
      cursor = next.page.next_cursor
    }
    expect(cursor).toBeNull()
    expect(all.size).toBe(162)
    // Even a deadline before the first candidate carries a usable, query-bound cursor.
    const restart = engine.read('fictional_0', { ...query, cursor: initial.page.next_cursor })
    expect(restart.ok).toBe(true)
    if (!restart.ok) throw new Error('restart failed')
    expect(restart.page.hits.length).toBeGreaterThan(0)
    expect(restart.page.hits.length).toBeLessThanOrEqual(query.limit)
    expect(restart.page.next_cursor).not.toBeNull()
    expect(
      engine.read('fictional_0', { ...query, words: 'changed', cursor: initial.page.next_cursor }),
    ).toEqual({ ok: false, reason: 'cursor-invalid' })
    for (const changed of [
      { scope: 'this-conversation' as const },
      { state: 'working' as const },
      { limit: 1 },
    ])
      expect(
        engine.read('fictional_0', { ...query, ...changed, cursor: initial.page.next_cursor }),
      ).toEqual({ ok: false, reason: 'cursor-invalid' })
    expect(engine.read('fictional_1', { ...query, cursor: initial.page.next_cursor })).toEqual({
      ok: false,
      reason: 'cursor-invalid',
    })
    expect(JSON.parse(Buffer.from(initial.page.next_cursor, 'base64url').toString()).query).toBe(
      JSON.stringify(['fictional_0', null, null, null, null, null, [], query.limit]),
    )
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
    expect(pages.map((page) => page.ok && page.page.hits.map((hit) => hit.conversation))).toEqual(
      pages.map(() => pages[0]?.ok && pages[0].page.hits.map((hit) => hit.conversation)),
    )
    expect(progress.length).toBeGreaterThanOrEqual(5)
    expect(progress).toContainEqual(
      expect.objectContaining({
        kind: 'progress',
        result: expect.objectContaining({
          page: expect.objectContaining({
            hits: expect.arrayContaining([
              expect.objectContaining({ conversation: expect.any(String) }),
            ]),
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

it('stops at 1000 conversation candidates and continues without repeating a page', () => {
  store.atomically(() => {
    for (let index = 0; index < 1005; index++)
      store.create({
        id: `fictional_candidate_${String(index)}`,
        parentSessionId: 'fictional_0',
        profileId: 'profile_0',
        provider: 'claude',
        approvalMode: 'auto',
        cwd: directory,
      })
  })
  const { count: total } = db.prepare('SELECT count(*) AS count FROM provider_session').get() as {
    count: number
  }
  const before = db.prepare('SELECT total_changes() AS count').get()
  const engine = new WorkSearchEngine(file, () => 1)
  try {
    const query = { words: 'no-match-canary' }
    const first = engine.read('fictional_0', query)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('no first page')
    expect(first.page.hits).toEqual([])
    expect(first.page.searched).toBe(1000)
    expect(first.page.next_cursor).not.toBeNull()
    expect(first.page.complete).toBe(false)
    const next = engine.read('fictional_0', { ...query, cursor: first.page.next_cursor! })
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('no continuation')
    expect(next.page.searched).toBe(total - 1000)
    expect(next.page.hits).toEqual([])
    expect(next.page.next_cursor).toBeNull()
    expect(engine.read('fictional_0', { ...query, grouped: true })).toMatchObject({
      ok: true,
      page: { searched: 1000, complete: false, next_cursor: null, grouped: { matched: null } },
    })
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
  } finally {
    engine.close()
  }
})

it('adds recorded metadata only to opted-in conversation pages on the existing worker', async () => {
  const profile = 'search-metadata'
  const older = 'fictional_metadata_older'
  const newer = 'fictional_metadata_newer'
  expect(
    store.createAgentIdentity({ slug: profile, displayName: 'Metadata', provider: 'claude' }, null),
  ).not.toBeNull()
  for (const id of [older, newer]) {
    store.create({
      id,
      provider: 'codex',
      profileId: profile,
      cwd: directory,
      approvalMode: 'ask',
    })
  }
  const archivedAt = Date.now() + 1000
  const author = { kind: 'agent', conversation: 'fictional_0' } as const
  store.titleConversation(
    newer,
    store.nextOrdinal(newer),
    { type: 'titled', title: 'Archived search result', author },
    archivedAt,
  )
  archivedConversationsIn(db).add([newer], archivedAt)

  const reader = new WorkSearchWorkerReader(
    (caller, query) =>
      new Worker(join(directory, 'search.cjs'), { workerData: { file, caller, query } }),
  )
  const caller = 'fictional_0'
  try {
    const regular = await reader.read(caller, { profile })
    if (!regular.ok) throw new Error('default search unavailable')
    expect(regular.page.hits.map(({ conversation }) => conversation)).toEqual([newer, older])
    for (const hit of regular.page.hits) expect(hit).not.toHaveProperty('metadata')

    const query = { profile, limit: 1, includeConversationMetadata: true } as const
    const first = await reader.read(caller, query)
    if (!first.ok || first.page.next_cursor === null) throw new Error('no metadata continuation')
    expect(first.page.hits).toMatchObject([
      {
        conversation: newer,
        title: 'Archived search result',
        metadata: { provider: 'codex', archived_at: archivedAt, title_author: author },
      },
    ])
    const cursor = first.page.next_cursor
    expect(await reader.read(caller, { profile, limit: 1, cursor })).toEqual({
      ok: false,
      reason: 'cursor-invalid',
    })
    expect(await reader.read(caller, { ...query, cursor })).toMatchObject({
      ok: true,
      page: {
        hits: [
          {
            conversation: older,
            title: 'Metadata',
            metadata: { provider: 'codex', archived_at: null, title_author: null },
          },
        ],
        next_cursor: null,
      },
    })
  } finally {
    await reader.close()
  }
})

it('groups distinct conversation matches before selecting the six visible profiles', () => {
  const day = '2080-01-01'
  const at = Date.parse(day)
  const caller = 'fictional_0'
  for (let i = 0; i <= 10; i++) {
    const id = `fictional_group_${String(i).padStart(2, '0')}`
    store.create({
      id,
      provider: 'claude',
      profileId: `profile_${Math.min(7, i)}`,
      approvalMode: 'ask',
      cwd: directory,
    })
    store.titleConversation(
      id,
      store.nextOrdinal(id),
      { type: 'titled', title: 'Group match', author: { kind: 'person' } },
      at,
    )
  }
  db.prepare('UPDATE provider_session SET agent_identity_id = NULL WHERE id = ?').run(
    'fictional_group_00',
  )
  let clock = 0
  const engine = new WorkSearchEngine(file, () => clock)
  const query = { grouped: true, from: day, to: day, words: 'Group match' } as const
  try {
    const first = workSearchResult.parse(engine.read(caller, query))
    if (!first.ok || first.page.next_cursor === null || first.page.grouped === undefined) {
      throw new Error('expected a complete first group page')
    }
    const { grouped, next_cursor: cursor } = first.page
    expect(first.page).toMatchObject({ hits: [], complete: true, searched: 11 })
    expect(grouped.matched).toBe(11)
    expect(grouped.groups.map(({ profile }) => profile)).toEqual([
      'profile_7',
      'profile_6',
      'profile_5',
      'profile_4',
      'profile_3',
      'profile_2',
    ])
    expect(grouped.groups[0]).toMatchObject({
      matched: 4,
      previews: [
        { conversation: 'fictional_group_10', metadata: { provider: 'claude' } },
        { conversation: 'fictional_group_09' },
        { conversation: 'fictional_group_08' },
      ],
    })
    expect(engine.read(caller, { from: day, to: day, words: 'Group match', cursor })).toEqual({
      ok: false,
      reason: 'cursor-invalid',
    })
    expect(engine.read(caller, { ...query, cursor })).toMatchObject({
      ok: true,
      page: {
        complete: true,
        next_cursor: null,
        grouped: {
          matched: 11,
          groups: [
            { profile: 'profile_1', matched: 1 },
            { profile: null, matched: 1 },
          ],
        },
      },
    })
    expect(engine.read(caller, { ...query, profile: 'profile_7' })).toMatchObject({
      ok: true,
      page: { grouped: { matched: 4, groups: [{ profile: 'profile_7', matched: 4 }] } },
    })

    const withinWorkerBudget = engine.read(caller, query, (progress) => {
      if (progress.ok && progress.page.searched > 0) clock = WORK_SEARCH_BOUNDS.pageMs + 1
    })
    expect(withinWorkerBudget).toMatchObject({
      ok: true,
      page: { complete: true, searched: 11, grouped: { matched: 11 } },
    })

    clock = 0
    const cutShort = engine.read(caller, query, (progress) => {
      if (progress.ok && progress.page.searched > 0) clock = WORK_SEARCH_BOUNDS.workerMs
    })
    expect(cutShort).toMatchObject({
      ok: true,
      page: {
        complete: false,
        searched: 1,
        next_cursor: null,
        grouped: { matched: null, groups: [{ matched: null }] },
      },
    })

    clock = 0
    db.prepare(
      "UPDATE events SET payload = 'broken JSON' WHERE session_id = ? AND type = 'titled'",
    ).run('fictional_group_06')
    const torn = engine.read(caller, query)
    expect(torn).toMatchObject({
      ok: true,
      page: { complete: false, rows_unread: 1, next_cursor: null, grouped: { matched: null } },
    })
  } finally {
    engine.close()
  }
})

it('finds all 72 groups and exact totals for 640 conversations in the real worker', async () => {
  const day = '2080-01-02'
  const at = Date.parse(day)
  store.atomically(() => {
    for (let index = 0; index < 640; index++) {
      const id = `grouped_scale_${String(index).padStart(3, '0')}`
      store.create({
        id,
        provider: 'codex',
        profileId: `profile_${index % 72}`,
        cwd: directory,
        approvalMode: 'ask',
      })
      store.titleConversation(
        id,
        store.nextOrdinal(id),
        { type: 'titled', title: 'Scale preview', author: { kind: 'person' } },
        at,
      )
    }
  })

  const reader = new WorkSearchWorkerReader(
    (caller, query) =>
      new Worker(join(directory, 'search.cjs'), { workerData: { file, caller, query } }),
  )
  const query = { grouped: true, from: day, to: day, words: 'Scale preview' } as const
  try {
    let cursor: string | null = null
    for (let offset = 0; offset < 72; offset += 6) {
      const result = await reader.read('fictional_0', { ...query, cursor: cursor ?? undefined })
      if (!result.ok) throw new Error(`grouped search unavailable after ${offset} groups`)
      const page = result.page
      const grouped = page.grouped
      if (grouped === undefined) throw new Error(`missing grouped page after ${offset} groups`)
      expect(page).toMatchObject({ complete: true, searched: 640, grouped: { matched: 640 } })
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(WORK_SEARCH_BOUNDS.responseUnits)
      expect(
        grouped.groups.map(({ profile, matched, previews }) => ({
          profile,
          matched,
          ids: previews.map(({ conversation }) => conversation),
        })),
      ).toEqual(
        Array.from({ length: 6 }, (_, index) => {
          const newest = 639 - offset - index
          return {
            profile: `profile_${newest % 72}`,
            matched: Math.floor(newest / 72) + 1,
            ids: [newest, newest - 72, newest - 144].map(
              (ordinal) => `grouped_scale_${String(ordinal)}`,
            ),
          }
        }),
      )
      cursor = page.next_cursor
      if (offset + 6 < 72) expect(cursor).not.toBeNull()
    }
    expect(cursor).toBeNull()
  } finally {
    await reader.close()
  }
}, 90_000)

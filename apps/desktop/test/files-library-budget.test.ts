import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { FilesLibraryEngine } from '../src/main/db/files-library-engine'
import { FilesLibraryLifetime } from '../src/main/db/files-library-reader'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { FILES_LIBRARY_BOUNDS } from '../src/shared/files-library'
import {
  filesLibraryFixture,
  workspaceQuery,
  libraryContext,
} from './helpers/files-library-fixture'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
it('completes the accepted dense 80-file/86-keep population', () => {
  const f = filesLibraryFixture()
  f.example()
  f.db.transaction(() => {
    for (let i = 1; i <= 64; i++) {
      const text = `# Synthetic density file ${i}\n\nFictional file for the component density check.\n`
      f.keep(`dense-${i}`, 't19', sha(text), {
        name: `density-${i}.md`,
        title: `Synthetic density file ${i}`,
        at: Date.parse('2026-10-25T00:00:00Z') + i,
        by: 'brobot',
      })
    }
  })()
  try {
    const result = f.engine.read(
      { operation: 'query', query: workspaceQuery, size: 100 },
      libraryContext,
    )
    expect(result).toMatchObject({ type: 'files', totalFiles: 80, totalKeeps: 86, next: null })
    if (result.type === 'files') expect(result.files).toHaveLength(80)
  } finally {
    f.close()
  }
})

it('keeps a 10000-placement shared file out of tile replies and pages every retained alias', () => {
  const f = filesLibraryFixture()
  f.owner('fictional')
  const root = f.store.rootOf('fictional')!.piece,
    hash = sha('one shared content')
  f.db.transaction(() => {
    for (let i = 0; i < 10_000; i++)
      f.keep(`keep-${i}`, root, hash, { at: i, name: `alias-${i}.md` })
  })()
  try {
    const result = f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext)
    if (result.type !== 'files') throw new Error(JSON.stringify(result))
    expect([
      result.totalFiles,
      result.totalKeeps,
      result.files.length,
      result.files[0]!.matchingKeeps,
    ]).toEqual([1, 10_000, 1, 10_000])
    expect(JSON.stringify(result).length).toBeLessThan(2_000)
    const seen = new Set<string>()
    let cursor: string | undefined
    do {
      const provenance = f.engine.read(
        {
          operation: 'provenance',
          snapshot: result.snapshot,
          sha256: hash,
          size: 100,
          ...(cursor ? { cursor } : {}),
        },
        libraryContext,
      )
      if (provenance.type !== 'provenance') throw new Error(JSON.stringify(provenance))
      expect([provenance.total, provenance.matching]).toEqual([10_000, 10_000])
      for (const keep of provenance.keeps) seen.add(keep.file.resourceId)
      cursor = provenance.next ?? undefined
    } while (cursor !== undefined)
    expect(seen.size).toBe(10_000)
  } finally {
    f.close()
  }
})

it('completes a fictional 10000-keep snapshot with indexed canonical metadata beside 450000 unrelated events', async () => {
  const f = filesLibraryFixture()
  f.owner('fictional')
  const root = f.store.rootOf('fictional')!.piece
  const expected = new Map<string, string>()
  f.db.transaction(() => {
    f.db
      .prepare(
        `WITH RECURSIVE noise(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM noise WHERE n+1 < 450000)
      INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
      SELECT 'noise-'||n,'fictional',0,n,'thinking','{"type":"thinking"}',1 FROM noise`,
      )
      .run()
    for (let i = 0; i < 128; i++) {
      f.task(
        `task-${i}`,
        i === 0 ? root : `task-${Math.floor((i - 1) / 2)}`,
        i + 1,
        'fictional',
        'fictional',
      )
      f.store.append(
        'fictional',
        450_000 + i,
        { type: 'work_retitled', piece: `task-${i}`, title: `Current task ${i}`, by: 'fictional' },
        2,
      )
    }
    for (let i = 0; i < 10_000; i++) {
      const hash = sha(String(i % 2_500)),
        id = `keep-${i}`
      f.keep(id, `task-${i % 128}`, hash, { name: `alias-${i}.md`, at: i, by: 'fictional' })
      expected.set(hash, id)
    }
  })()
  const plans = new Map<string, string[]>()
  const engine = new FilesLibraryEngine(f.file, Date.now, (sql, bindings) => {
    if (!plans.has(sql))
      plans.set(
        sql,
        (f.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...bindings) as { detail: string }[]).map(
          (row) => row.detail,
        ),
      )
  })
  try {
    const result = engine.read(
      { operation: 'query', query: workspaceQuery, size: 100 },
      libraryContext,
    )
    if (result.type !== 'files') throw new Error(JSON.stringify(result))
    expect([result.totalFiles, result.totalKeeps]).toEqual([2_500, 10_000])
    const actual = [...result.files]
    let next = result.next
    while (next !== null) {
      const page = engine.read({ operation: 'page', cursor: next, size: 100 }, libraryContext)
      if (page.type !== 'files') throw new Error(JSON.stringify(page))
      actual.push(...page.files)
      next = page.next
    }
    expect(actual.map((one) => one.file.resourceId)).toEqual(
      Array.from({ length: 2_500 }, (_, i) => `keep-${9_999 - i}`),
    )
    expect(new Map(actual.map((one) => [one.file.sha256, one.file.resourceId]))).toEqual(expected)
    expect(result.metrics.rows).toBeLessThan(FILES_LIBRARY_BOUNDS.rows)
    expect(result.metrics.bytes).toBeLessThan(FILES_LIBRARY_BOUNDS.bytes)
    expect(result.metrics.cacheBytes).toBeLessThan(FILES_LIBRARY_BOUNDS.bytes)
    expect(result.metrics.elapsedMs).toBeLessThan(FILES_LIBRARY_BOUNDS.deadlineMs)
    const eventPlans = [...plans].filter(([sql]) => sql.includes('FROM events'))
    expect(eventPlans).toHaveLength(1)
    expect(eventPlans[0]![1].join(' ')).toContain('SEARCH events USING INDEX events_kind_owner_idx')
    expect(
      [...plans]
        .filter(([sql]) => sql.includes('FROM work_resource'))
        .every(([, plan]) => plan.join(' ').includes('INTEGER PRIMARY KEY (rowid>?)')),
    ).toBe(true)
    console.log(
      'FILES_LIBRARY_10000',
      JSON.stringify({
        metrics: result.metrics,
        rssBytes: process.memoryUsage().rss,
        plans: [...plans],
      }),
    )
    const bundle = await bundleAWorker(
      'src/main/files-library.worker.ts',
      f.directory,
      'scale-worker.cjs',
    )
    const native = new FilesLibraryLifetime(
      () =>
        new Worker(bundle, {
          workerData: { file: f.file },
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
        }),
    )
    try {
      const worker = await native.read(
        { operation: 'query', query: workspaceQuery, size: 100 },
        libraryContext,
      )
      expect(worker).toMatchObject({ type: 'files', totalFiles: 2_500, totalKeeps: 10_000 })
      if (worker.type === 'files') {
        expect(worker.files).toEqual(result.files)
        expect(worker.metrics.rows).toBe(result.metrics.rows)
        expect(worker.metrics.bytes).toBeLessThan(FILES_LIBRARY_BOUNDS.bytes)
        expect(worker.metrics.cacheBytes).toBeLessThan(FILES_LIBRARY_BOUNDS.bytes)
        console.log('FILES_LIBRARY_NATIVE_10000', JSON.stringify(worker.metrics))
      }
    } finally {
      await native.close()
    }
  } finally {
    engine.close()
    f.close()
  }
})

it('50000 keeps exercise explicit budget coverage without exact totals and the engine can retry', () => {
  const f = filesLibraryFixture()
  f.owner('fictional')
  const root = f.store.rootOf('fictional')!.piece
  f.db.transaction(() => {
    for (let i = 0; i < 50_000; i++) f.keep(`keep-${i}`, root, sha(String(i % 500)), { at: i })
  })()
  try {
    const result = f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext)
    expect(result).toMatchObject({ type: 'unavailable', complete: false, cause: 'budget' })
    expect(result).not.toHaveProperty('totalFiles')
    console.log('FILES_LIBRARY_50000', JSON.stringify(result))
    f.db.prepare('DELETE FROM work_resource WHERE rowid > 80').run()
    expect(
      f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext),
    ).toMatchObject({ type: 'files', totalFiles: 80 })
  } finally {
    f.close()
  }
})

it('reserves the previous complete cache while building its replacement and preserves its old cursor on failure', () => {
  const f = filesLibraryFixture()
  f.owner('fictional')
  const root = f.store.rootOf('fictional')!.piece
  f.db.transaction(() => {
    for (let i = 0; i < 5_000; i++)
      f.keep(`keep-${i}`, root, sha(String(i)), {
        title: 'Long fictional title '.repeat(50) + i,
        at: i,
      })
  })()
  try {
    const first = f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext)
    if (first.type !== 'files') throw new Error(JSON.stringify(first))
    expect(first.metrics.cacheBytes).toBeGreaterThan(8 * 1024 * 1024)
    const replacement = f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext)
    expect(replacement).toMatchObject({ type: 'unavailable', cause: 'budget', complete: false })
    expect(replacement).not.toHaveProperty('totalFiles')
    expect(f.engine.read({ operation: 'page', cursor: first.next! }, libraryContext)).toMatchObject(
      { type: 'files', snapshot: first.snapshot, totalFiles: 5_000 },
    )
  } finally {
    f.close()
  }
})

it('a long retitle ledger and an unretitled task fail coverage instead of silently using the given title', () => {
  const f = filesLibraryFixture()
  f.owner('fictional')
  const root = f.store.rootOf('fictional')!.piece
  f.keep('only', root, sha('only'))
  f.db
    .prepare(
      `WITH RECURSIVE noise(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM noise WHERE n+1 < 100001)
    INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
    SELECT 'retitle-'||n,'fictional',0,n,'work_retitled',
      json_object('type','work_retitled','piece','other','title','A different task'),1 FROM noise`,
    )
    .run()
  try {
    const result = f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext)
    expect(result).toMatchObject({ type: 'unavailable', cause: 'budget', complete: false })
    expect(result).not.toHaveProperty('totalFiles')
    console.log('FILES_LIBRARY_RETITLES', JSON.stringify(result))
  } finally {
    f.close()
  }
})

it('catalogs 10000 empty tasks with complete paging and records the actual parent/title query plans', () => {
  const f = filesLibraryFixture()
  f.owner('fictional')
  const root = f.store.rootOf('fictional')!.piece
  f.db.transaction(() => {
    for (let i = 0; i < 10_000; i++)
      f.task(`catalog-${i}`, root, i + 1, 'fictional', 'fictional', `Catalog task ${i}`)
  })()
  const plans = new Map<string, string[]>()
  const engine = new FilesLibraryEngine(f.file, Date.now, (sql, bindings) => {
    if (!plans.has(sql))
      plans.set(
        sql,
        (f.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...bindings) as { detail: string }[]).map(
          (row) => row.detail,
        ),
      )
  })
  try {
    const roots = engine.read({ operation: 'tasks', query: '', parent: null }, libraryContext)
    expect(roots).toMatchObject({ type: 'tasks', total: 1 })
    if (roots.type === 'tasks') expect(roots.tasks[0]!.children).toBe(10_000)
    const first = engine.read(
      { operation: 'tasks', query: 'Catalog', parent: null, size: 100 },
      libraryContext,
    )
    if (first.type !== 'tasks') throw new Error(JSON.stringify(first))
    expect(first.total).toBe(10_000)
    const ids = first.tasks.map((task) => task.id)
    let next = first.next
    while (next !== null) {
      const page = engine.read(
        { operation: 'tasks', query: 'Catalog', parent: null, size: 100, cursor: next },
        libraryContext,
      )
      if (page.type !== 'tasks') throw new Error(JSON.stringify(page))
      ids.push(...page.tasks.map((task) => task.id))
      next = page.next
    }
    expect(ids).toEqual(Array.from({ length: 10_000 }, (_, i) => `catalog-${i}`))
    const children = engine.read(
      { operation: 'tasks', query: '', parent: root, size: 100 },
      libraryContext,
    )
    expect(children).toMatchObject({ type: 'tasks', total: 10_000 })
    expect(first.metrics.elapsedMs).toBeLessThan(FILES_LIBRARY_BOUNDS.deadlineMs)
    expect(
      [...plans].find(([sql]) => sql === 'SELECT id FROM work WHERE parent_id = ?')![1].join(' '),
    ).toContain('work_parent_number_uq')
    console.log(
      'FILES_LIBRARY_CATALOG_10000',
      JSON.stringify({
        search: first.metrics,
        children: children.type === 'tasks' ? children.metrics : null,
        plans: [...plans],
      }),
    )
  } finally {
    engine.close()
    f.close()
  }
})

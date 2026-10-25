import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { serialize } from 'node:v8'
import {
  filesLibraryFixture,
  libraryContext,
  workspaceQuery,
} from './helpers/files-library-fixture'
import { filesExample } from './fixtures/files-library-example'
import {
  FILES_LIBRARY_BOUNDS,
  filesLibraryRequest,
  compareLibraryFiles,
  type FilesLibraryQuery,
  type FilesLibraryResult,
} from '../src/shared/files-library'

const owned: ReturnType<typeof filesLibraryFixture>[] = []
const fixture = (now?: () => number) => {
  const result = filesLibraryFixture(now)
  owned.push(result)
  return result
}
afterEach(() => {
  for (const one of owned.splice(0)) one.close()
})
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
function files(result: FilesLibraryResult) {
  expect(result.type, JSON.stringify(result)).toBe('files')
  if (result.type !== 'files') throw new Error('no complete library')
  return result
}

it('keeps the accepted workspace/held-given anchor/actual descendant populations exact', () => {
  const f = fixture()
  f.example()
  const global = files(f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext))
  expect([global.totalFiles, global.totalKeeps]).toEqual([16, 22])
  for (const includeSubtasks of [false, true])
    for (const role of ['all', 'input'] as const) {
      const result = files(
        f.engine.read(
          {
            operation: 'query',
            query: {
              ...workspaceQuery,
              role,
              scope: { type: 'conversationWork', id: 'brobot', includeSubtasks },
            },
          },
          { ...libraryContext, givers: ['brobot'] },
        ),
      )
      expect([result.totalFiles, result.totalKeeps]).toEqual(
        role === 'all'
          ? includeSubtasks
            ? [11, 15]
            : [10, 13]
          : includeSubtasks
            ? [4, 5]
            : [3, 3],
      )
      expect(result.files.some((one) => one.file.name === 'unrelated-layout-handover.md')).toBe(
        false,
      )
      expect(result.files.some((one) => one.file.name === 'release-overview.md')).toBe(false)
    }
  const exact = files(
    f.engine.read(
      {
        operation: 'query',
        query: { ...workspaceQuery, scope: { type: 'task', id: 't16', includeSubtasks: false } },
      },
      libraryContext,
    ),
  )
  expect(exact.files.every((one) => one.file.piece === 't16')).toBe(true)
  const tree = files(
    f.engine.read(
      {
        operation: 'query',
        query: { ...workspaceQuery, scope: { type: 'task', id: 't16', includeSubtasks: true } },
      },
      libraryContext,
    ),
  )
  expect(tree.files.some((one) => one.file.piece === 't163')).toBe(true)
  expect(tree.files.some((one) => one.file.piece === 't160')).toBe(false)
})

// This oracle operates on the fictional source records, without the production selectors,
// token helpers, group accumulator, comparator or SQL.
function oracle(query: FilesLibraryQuery) {
  const tasks = filesExample.tasks
  const scope = query.scope
  const selected = new Set(
    tasks
      .filter(
        (task) =>
          scope.type === 'workspace' ||
          (scope.type === 'task'
            ? task.id === scope.id
            : task.holder === scope.id || task.givenBy === scope.id),
      )
      .map((task) => task.id),
  )
  if (scope.type !== 'workspace' && scope.includeSubtasks) {
    let previous = -1
    while (previous !== selected.size) {
      previous = selected.size
      for (const task of tasks)
        if (task.parent !== null && selected.has(task.parent)) selected.add(task.id)
    }
  }
  const breadcrumbs = (id: string): string => {
    const task = tasks.find((one) => one.id === id)!
    return (
      (task.parent === null ? '' : `${breadcrumbs(task.parent)} / `) +
      `${task.label} · ${task.title}`
    )
  }
  const population = filesExample.keeps
    .filter((keep) => selected.has(keep.task))
    .map((keep) => {
      const file = filesExample.files.find((one) => one.id === keep.file)!
      const task = tasks.find((one) => one.id === keep.task)!
      const adder = filesExample.conversations.find((one) => one.id === keep.by)
      const kind = file.name.endsWith('.png') ? 'images' : 'documents'
      const text = [
        file.name,
        file.title,
        task.label,
        breadcrumbs(task.id),
        adder?.agent ?? 'person',
        adder?.id ?? '',
        keep.role,
        kind,
        kind === 'images'
          ? 'image'
          : file.name.endsWith('.pdf')
            ? 'pdf'
            : file.name.endsWith('.html')
              ? 'page'
              : 'markdown',
      ]
        .join('\n')
        .normalize('NFC')
        .toLowerCase()
      return {
        keep,
        file,
        kind,
        matches: query.query
          .normalize('NFC')
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .every((token) => text.includes(token)),
      }
    })
    .filter((row) => row.matches)
  const distinct = (rows: typeof population) => new Set(rows.map((row) => row.file.sha256)).size
  const kindBase = population.filter((row) => query.role === 'all' || row.keep.role === query.role)
  const roleBase = population.filter((row) => query.kind === 'all' || row.kind === query.kind)
  const matching = population.filter(
    (row) =>
      (query.role === 'all' || row.keep.role === query.role) &&
      (query.kind === 'all' || row.kind === query.kind),
  )
  return {
    files: distinct(matching),
    keeps: matching.length,
    facets: {
      kinds: {
        all: distinct(kindBase),
        documents: distinct(kindBase.filter((row) => row.kind === 'documents')),
        images: distinct(kindBase.filter((row) => row.kind === 'images')),
      },
      roles: {
        all: distinct(roleBase),
        made: distinct(roleBase.filter((row) => row.keep.role === 'made')),
        input: distinct(roleBase.filter((row) => row.keep.role === 'input')),
      },
    },
  }
}
it('matches an independent oracle for all scope/kind/role combinations and metadata search', () => {
  const f = fixture()
  f.example()
  const scopes: FilesLibraryQuery['scope'][] = [
    { type: 'workspace' },
    ...[true, false].map((includeSubtasks) => ({
      type: 'conversationWork' as const,
      id: 'brobot',
      includeSubtasks,
    })),
    ...[true, false].map((includeSubtasks) => ({
      type: 'task' as const,
      id: 't16',
      includeSubtasks,
    })),
  ]
  for (const scope of scopes)
    for (const kind of ['all', 'documents', 'images'] as const)
      for (const role of ['all', 'input', 'made'] as const)
        for (const query of ['', 'Windows', 'W19.16 input', 'person', 'BroBot']) {
          const request = { ...workspaceQuery, scope, query, kind, role }
          const expected = oracle(request)
          const result = files(
            f.engine.read(
              { operation: 'query', query: request },
              { ...libraryContext, givers: scope.type === 'conversationWork' ? ['brobot'] : [] },
            ),
          )
          expect([result.totalFiles, result.totalKeeps, result.facets]).toEqual([
            expected.files,
            expected.keeps,
            expected.facets,
          ])
        }
})

it('retains all aliases in snapshot provenance, with outside-view keeps explicitly distinguished', () => {
  const f = fixture()
  f.example()
  const result = files(
    f.engine.read(
      {
        operation: 'query',
        query: {
          ...workspaceQuery,
          scope: { type: 'conversationWork', id: 'brobot', includeSubtasks: true },
        },
      },
      { ...libraryContext, givers: ['brobot'] },
    ),
  )
  const hash = filesExample.files.find((one) => one.id === 'f1')!.sha256
  const group = result.files.find((one) => one.file.sha256 === hash)!
  expect(group.matchingKeeps).toBe(2)
  const provenance = f.engine.read(
    { operation: 'provenance', snapshot: result.snapshot, sha256: hash, size: 1 },
    libraryContext,
  )
  if (provenance.type !== 'provenance') throw new Error(JSON.stringify(provenance))
  expect([provenance.total, provenance.matching, provenance.keeps[0]!.matching]).toEqual([
    3,
    2,
    false,
  ])
  expect(provenance.next).not.toBeNull()
  expect(
    f.engine.read(
      { operation: 'provenance', snapshot: result.snapshot, sha256: sha('foreign') },
      libraryContext,
    ),
  ).toMatchObject({ type: 'unavailable', cause: 'invalid-cursor' })
})

it('filters keeps before grouping and chooses the latest matching keep with an exact ID tie break', () => {
  const f = fixture()
  f.owner('a')
  const root = f.store.rootOf('a')!.piece
  f.keep('a', root, sha('same'), { name: 'old alias.md', title: 'Only %_"\\ Été', at: 1 })
  f.keep('b', root, sha('same'), { name: 'new.md', title: 'newer', role: 'input', at: 2 })
  f.keep('c', root, sha('same'), { name: 'tie.md', title: 'newer', at: 2 })
  f.keep('d', root, sha('different'), { name: 'tie.md', title: 'newer', at: 2 })
  for (const query of ['old alias', '%_', '"\\', 'ÉTÉ']) {
    const result = files(
      f.engine.read({ operation: 'query', query: { ...workspaceQuery, query } }, libraryContext),
    )
    expect(result.files.map((one) => one.file.resourceId)).toEqual(['a'])
  }
  expect(
    files(
      f.engine.read(
        { operation: 'query', query: { ...workspaceQuery, query: 'old newer' } },
        libraryContext,
      ),
    ).totalFiles,
  ).toBe(0)
  const result = files(f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext))
  expect(result.totalFiles).toBe(2)
  expect(result.files.find((one) => one.file.sha256 === sha('same'))!.file.resourceId).toBe('c')
})

it('has deterministic name and time comparison policies', () => {
  const base = { name: 'a.md', title: 'Z', keptAt: 1, sha256: 'a'.repeat(64) }
  expect(compareLibraryFiles(base, { ...base, name: 'b.md', title: 'A' }, 'name')).toBeLessThan(0)
  expect(compareLibraryFiles(base, { ...base, keptAt: 2 }, 'newest')).toBeGreaterThan(0)
  expect(compareLibraryFiles(base, { ...base, keptAt: 2 }, 'oldest')).toBeLessThan(0)
  for (const sort of ['name', 'newest', 'oldest'] as const)
    expect(compareLibraryFiles(base, { ...base, sha256: 'b'.repeat(64) }, sort)).toBeLessThan(0)
  const sorted = ['é.md', 'e.md', 'E.md', '😀.md', '\ue000.md']
    .map((name) => ({ ...base, name }))
    .sort((a, b) => compareLibraryFiles(a, b, 'name'))
    .map((row) => row.name)
  expect(sorted).toEqual(['😀.md', 'e.md', 'E.md', 'é.md', '\ue000.md'])
})

it('pages unique groups across interleaved keeps and preserves an immutable population after writes', () => {
  const f = fixture()
  f.owner('a')
  const root = f.store.rootOf('a')!.piece
  for (let i = 0; i < 250; i++) f.keep(`keep-${i}`, root, sha(String(i % 125)), { at: i })
  const first = files(
    f.engine.read({ operation: 'query', query: workspaceQuery, size: 17 }, libraryContext),
  )
  expect([first.totalFiles, first.totalKeeps]).toEqual([125, 250])
  f.keep('later', root, sha('later'), { at: 999 })
  let page = first
  const seen = first.files.map((one) => one.file.sha256)
  while (page.next !== null) {
    page = files(f.engine.read({ operation: 'page', cursor: page.next, size: 17 }, libraryContext))
    expect(page.stale).toBe(true)
    expect(page.totalFiles).toBe(125)
    seen.push(...page.files.map((one) => one.file.sha256))
  }
  expect(new Set(seen).size).toBe(125)
  expect(seen).toHaveLength(125)
  expect(seen).toEqual(Array.from({ length: 125 }, (_, i) => sha(String(124 - i))))
  expect(
    files(f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext)).totalFiles,
  ).toBe(126)
  expect(f.engine.read({ operation: 'page', cursor: first.next! }, libraryContext)).toMatchObject({
    cause: 'invalid-cursor',
  })
})

it('rejects foreign/invalid/expired cursors and distinguishes missing from valid empty work', () => {
  let now = 1
  const f = fixture(() => now)
  f.example()
  const first = files(
    f.engine.read({ operation: 'query', query: workspaceQuery, size: 1 }, libraryContext),
  )
  expect(
    f.engine.read(
      { operation: 'page', cursor: first.next! },
      { ...libraryContext, workspace: 'other' },
    ),
  ).toMatchObject({ cause: 'invalid-cursor' })
  expect(f.engine.read({ operation: 'page', cursor: 'oops' }, libraryContext)).toMatchObject({
    cause: 'invalid-cursor',
  })
  now += 60_000
  expect(f.engine.read({ operation: 'page', cursor: first.next! }, libraryContext)).toMatchObject({
    cause: 'cursor-expired',
  })
  for (const type of ['task', 'conversationWork'] as const) {
    expect(
      f.engine.read(
        {
          operation: 'query',
          query: { ...workspaceQuery, scope: { type, id: 'missing', includeSubtasks: false } },
        },
        libraryContext,
      ),
    ).toMatchObject({ cause: type === 'task' ? 'missing-task' : 'missing-conversation' })
  }
  expect(
    files(
      f.engine.read(
        {
          operation: 'query',
          query: { ...workspaceQuery, scope: { type: 'task', id: 't21', includeSubtasks: false } },
        },
        libraryContext,
      ),
    ).totalFiles,
  ).toBe(0)
})

it('reads current task titles, empty roots, ended work and actual breadcrumbs independently of files', () => {
  const f = fixture()
  f.example()
  f.store.append(
    'jae',
    0,
    { type: 'work_retitled', piece: 't16', title: 'Current retitle', by: 'jae' },
    1,
  )
  f.store.append('jae', 1, { type: 'work_closed', piece: 't16', by: 'jae' }, 2)
  const root = f.engine.read({ operation: 'tasks', query: '', parent: null }, libraryContext)
  expect(root.type).toBe('tasks')
  if (root.type !== 'tasks') return
  expect(root.tasks.map((one) => one.id)).toContain('t21')
  const result = f.engine.read(
    { operation: 'tasks', query: 'Current retitle', parent: null },
    libraryContext,
  )
  if (result.type !== 'tasks') throw new Error(JSON.stringify(result))
  expect(result.tasks.map((one) => one.id)).toEqual(['t16', 't163'])
  expect(result.tasks[1]!.breadcrumb).toContain('W19.16 · Current retitle / W19.16.3')
  expect(
    files(
      f.engine.read(
        { operation: 'query', query: { ...workspaceQuery, query: 'Current retitle' } },
        libraryContext,
      ),
    ).totalFiles,
  ).toBeGreaterThan(0)
})

it('expands only represented givers and fails duplicate/cyclic or mismatched replacement evidence', () => {
  const f = fixture()
  for (const id of ['oldA', 'oldB', 'new', 'helper']) f.owner(id)
  const oldRoot = f.store.rootOf('oldA')!.piece,
    newRoot = f.store.rootOf('new')!.piece
  f.task('given', newRoot, 1, 'helper', 'oldA')
  f.keep('oldheld', oldRoot, sha('oldheld'))
  f.keep('given', 'given', sha('given'))
  for (const [owner, target] of [
    ['oldA', 'oldB'],
    ['oldB', 'new'],
  ])
    f.store.append(owner!, 0, { type: 'replaced_by', sessionId: target! }, 1)
  const query: FilesLibraryQuery = {
    ...workspaceQuery,
    scope: { type: 'conversationWork', id: 'new', includeSubtasks: false },
  }
  const context = { ...libraryContext, givers: ['oldA', 'oldB', 'new'] }
  expect(
    files(f.engine.read({ operation: 'query', query }, context)).files.map(
      (one) => one.file.resourceId,
    ),
  ).toEqual(['given'])
  expect(
    f.engine.read({ operation: 'query', query }, { ...context, givers: ['new'] }),
  ).toMatchObject({ cause: 'changed' })
  f.store.append('new', 0, { type: 'replaced_by', sessionId: 'oldA' }, 2)
  expect(f.engine.read({ operation: 'query', query }, context)).toMatchObject({
    type: 'unavailable',
    cause: 'metadata',
    complete: false,
  })
})

it('returns honest ancestry/unread coverage failures and remains usable after cancellation', () => {
  const f = fixture()
  f.example()
  expect(
    f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext, () => true),
  ).toMatchObject({ cause: 'cancelled' })
  expect(
    files(f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext)).totalFiles,
  ).toBe(16)
  f.db.prepare("UPDATE work SET parent_id = 't163' WHERE id = 't16'").run()
  expect(
    f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext),
  ).toMatchObject({ cause: 'ancestry', complete: false })
  f.db.prepare("UPDATE work SET parent_id = 't19' WHERE id = 't16'").run()
  f.db
    .prepare(
      "INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES ('bad','jae',0,0,'work_retitled','{',1)",
    )
    .run()
  expect(
    f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext),
  ).toMatchObject({ cause: 'metadata', unread: 1, complete: false })
})

it.each(['parent-first', 'deepest-first'])(
  'checks total ancestry depth even with %s metadata memoization',
  (order) => {
    const f = fixture()
    f.owner('a')
    let parent = f.store.rootOf('a')!.piece
    for (let i = 1; i <= 66; i++) {
      const id = `depth-${i}`
      f.task(id, parent, 1, 'a', 'a')
      if (order === 'parent-first' || i === 66) f.keep(`at-${i}`, id, sha(id))
      parent = id
    }
    expect(
      f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext),
    ).toMatchObject({ type: 'unavailable', cause: 'ancestry', complete: false })
  },
)

it('preserves the complete file and provenance cursors across an independent task catalog snapshot', () => {
  const f = fixture()
  f.example()
  const first = files(
    f.engine.read({ operation: 'query', query: workspaceQuery, size: 1 }, libraryContext),
  )
  expect(
    f.engine.read({ operation: 'tasks', query: '', parent: null, size: 1 }, libraryContext).type,
  ).toBe('tasks')
  const next = files(f.engine.read({ operation: 'page', cursor: first.next! }, libraryContext))
  expect(next.snapshot).toBe(first.snapshot)
  expect(
    f.engine.read(
      { operation: 'provenance', snapshot: first.snapshot, sha256: first.files[0]!.file.sha256 },
      libraryContext,
    ).type,
  ).toBe('provenance')
})

it.each(['duplicate', 'overdeep'])(
  'rejects %s replacement evidence without widening the exact holder',
  (kind) => {
    const f = fixture()
    for (let i = 0; i < (kind === 'overdeep' ? 67 : 2); i++) f.owner(`owner-${i}`)
    for (let i = 0; i < (kind === 'overdeep' ? 66 : 1); i++)
      f.store.append(`owner-${i}`, 0, { type: 'replaced_by', sessionId: `owner-${i + 1}` }, 1)
    if (kind === 'duplicate')
      f.store.append('owner-0', 1, { type: 'replaced_by', sessionId: 'owner-1' }, 2)
    const id = kind === 'overdeep' ? 'owner-66' : 'owner-1'
    expect(
      f.engine.read(
        {
          operation: 'query',
          query: {
            ...workspaceQuery,
            scope: { type: 'conversationWork', id, includeSubtasks: false },
          },
        },
        { ...libraryContext, givers: [id] },
      ),
    ).toMatchObject({ type: 'unavailable', cause: 'metadata', complete: false })
  },
)

it('clips only display fields, searches full stored aliases and honestly rejects native field budgets', () => {
  const f = fixture()
  f.owner('a')
  const root = f.store.rootOf('a')!.piece
  f.keep('long', root, sha('long'), { title: 'x'.repeat(900) + ' needle' })
  const result = files(
    f.engine.read(
      { operation: 'query', query: { ...workspaceQuery, query: 'needle' } },
      libraryContext,
    ),
  )
  expect(result.files[0]!.file).toMatchObject({ title: 'x'.repeat(512), clipped: true })
  expect(serialize(result).byteLength).toBeLessThan(FILES_LIBRARY_BOUNDS.replyBytes)
  f.db
    .prepare('UPDATE work_resource SET title = ?')
    .run('x'.repeat(FILES_LIBRARY_BOUNDS.fieldBytes + 1))
  const failed = f.engine.read({ operation: 'query', query: workspaceQuery }, libraryContext)
  expect(failed).toMatchObject({ type: 'unavailable', cause: 'budget', complete: false })
  expect(failed).not.toHaveProperty('totalFiles')
})

it('rejects a malformed kept date anywhere in the complete population before publishing exact totals', () => {
  const f = fixture()
  f.owner('a')
  const root = f.store.rootOf('a')!.piece
  f.keep('good', root, sha('good'))
  f.keep('bad', root, sha('bad'))
  f.db
    .prepare('UPDATE work_resource SET created_at = ? WHERE id = ?')
    .run(9_000_000_000_000_000, 'bad')
  expect(
    f.engine.read({ operation: 'query', query: workspaceQuery, size: 1 }, libraryContext),
  ).toMatchObject({ type: 'unavailable', cause: 'metadata', complete: false, unread: 1 })
})

it('strictly rejects conflicting scopes, unbounded paging and path/SQL/giver inputs', () => {
  const valid = { operation: 'query', query: workspaceQuery }
  expect(filesLibraryRequest.safeParse(valid).success).toBe(true)
  for (const extra of [
    { path: '/fictional' },
    { sql: 'select 1' },
    { givers: ['a'] },
    { size: 0 },
    { size: 101 },
  ])
    expect(filesLibraryRequest.safeParse({ ...valid, ...extra }).success).toBe(false)
  expect(
    filesLibraryRequest.safeParse({
      ...valid,
      query: { ...workspaceQuery, scope: { type: 'workspace', id: 'a' } },
    }).success,
  ).toBe(false)
  expect(
    filesLibraryRequest.safeParse({
      ...valid,
      query: { ...workspaceQuery, query: 'x '.repeat(21) },
    }).success,
  ).toBe(false)
})

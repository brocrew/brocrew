import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import {
  createFilesLibrary,
  type LibraryApi,
} from '../src/renderer/src/composables/useFilesLibrary'
import {
  libraryUnavailable,
  type FilesLibraryResult,
  type LibraryKeep,
} from '../src/shared/files-library'

const keep: LibraryKeep = {
  resourceId: 'one',
  sha256: 'a'.repeat(64),
  name: 'one.md',
  title: 'One',
  bytes: 1,
  role: 'made',
  form: 'markdown',
  keptAt: 1,
  piece: 'task',
  label: 'W1',
  pieceTitle: 'Work',
  breadcrumb: 'W1 · Work',
  addedBy: null,
  clipped: false,
}
const page = (over = {}): Extract<FilesLibraryResult, { type: 'files' }> => ({
  type: 'files',
  snapshot: 'snapshot',
  readAt: 1,
  stale: false,
  metrics: { rows: 1, bytes: 1, elapsedMs: 1, cacheBytes: 1 },
  files: [{ file: keep, matchingKeeps: 1 }],
  totalFiles: 1,
  totalKeeps: 1,
  scopeKeeps: 1,
  facets: { kinds: { all: 1, documents: 1, images: 0 }, roles: { all: 1, input: 0, made: 1 } },
  next: null,
  ...over,
})
const scopes: ReturnType<typeof effectScope>[] = []
function controller(read: LibraryApi) {
  const scope = effectScope()
  scopes.push(scope)
  const selected = ref({ id: 'a', name: 'First conversation' }),
    workspace = ref<string | null>('workspace')
  const library = scope.run(() =>
    createFilesLibrary({ read, selected: () => selected.value, workspace: () => workspace.value }),
  )!
  return { library, selected, workspace }
}
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
})

it('defaults to the whole workspace and preserves filters/view/sort/depth and a pin across rail selection', async () => {
  const read = vi.fn<LibraryApi>(async () => page())
  const { library, selected } = controller(read)
  await library.refresh()
  expect(read.mock.calls[0]![0]).toMatchObject({
    operation: 'query',
    query: {
      scope: { type: 'workspace' },
      query: '',
      kind: 'all',
      role: 'all',
      sort: 'newest',
    },
  })
  library.state.includeSubtasks = false
  library.pinSelected()
  library.state.query = 'needle'
  library.state.kind = 'images'
  library.state.role = 'input'
  library.state.sort = 'name'
  library.state.view = 'list'
  selected.value = { id: 'b', name: 'Second conversation' }
  await nextTick()
  expect(library.state.scope).toMatchObject({ type: 'conversationWork', id: 'a' })
  expect(library.state.scopeName).toBe('Work in First conversation')
  expect(library.state).toMatchObject({
    query: 'needle',
    kind: 'images',
    role: 'input',
    sort: 'name',
    view: 'list',
    includeSubtasks: false,
  })
  library.pinSelected()
  expect(library.state.scope).toMatchObject({ id: 'b', includeSubtasks: false })
  library.state.scrollTop = 300
  library.reset()
  expect(library.state.scrollTop).toBe(0)
  expect(library.state).toMatchObject({
    scope: { type: 'workspace' },
    query: '',
    kind: 'all',
    role: 'all',
    sort: 'newest',
    view: 'icons',
    includeSubtasks: true,
  })
  expect(selected.value.id).toBe('b')
})

it('sends cloneable plain request values over the preload wire in every scope', async () => {
  const read = vi.fn<LibraryApi>(async (request) => {
    structuredClone(request)
    return page()
  })
  const { library } = controller(read)
  await library.refresh()
  expect(library.error.value).toBeNull()
  expect(library.page.value?.totalFiles).toBe(1)
  library.pinSelected()
  await library.refresh()
  expect(library.error.value).toBeNull()
  library.task({ id: 'task', label: 'W1', title: 'Work' })
  await library.refresh()
  expect(library.error.value).toBeNull()
  library.all()
  await library.refresh()
  expect(library.error.value).toBeNull()
  expect(read).toHaveBeenCalledTimes(4)
})

it('Graph entry is exact task/subtasks off, clears the three filters and preserves view/sort', () => {
  const { library } = controller(async () => page())
  library.state.view = 'list'
  library.state.sort = 'oldest'
  library.state.query = 'needle'
  library.state.kind = 'images'
  library.state.role = 'input'
  library.graphTask('exact-task')
  expect(library.state).toMatchObject({
    scope: { type: 'task', id: 'exact-task' },
    includeSubtasks: false,
    query: '',
    kind: 'all',
    role: 'all',
    view: 'list',
    sort: 'oldest',
  })
})

it('drops late first pages after a filter change and never displays an unread count as zero', async () => {
  let resolve!: (result: FilesLibraryResult) => void
  const read = vi.fn(
    () =>
      new Promise<FilesLibraryResult>((done) => {
        resolve = done
      }),
  )
  const { library } = controller(read)
  const first = library.refresh()
  expect(library.count.value).toBeNull()
  expect(library.busy.value).toBe(true)
  library.state.query = 'new search'
  resolve(page())
  await first
  expect(library.page.value).toBeNull()
  expect(library.count.value).toBeNull()
})

it('retains only complete data for the same query after a failed refresh, visibly stale', async () => {
  const read = vi
    .fn<LibraryApi>()
    .mockResolvedValueOnce(page())
    .mockResolvedValue(libraryUnavailable('budget', 99))
  const { library } = controller(read)
  await library.refresh()
  await library.refresh()
  expect(library.page.value).toMatchObject({ totalFiles: 1, stale: true })
  expect(library.error.value).toMatchObject({ cause: 'budget', visited: 99 })
  library.state.query = 'different'
  await library.refresh()
  expect(library.page.value).toBeNull()
  expect(library.error.value?.cause).toBe('budget')
})

it('drops late pages from another population and refuses duplicate groups from the worker', async () => {
  const read = vi
    .fn<LibraryApi>()
    .mockResolvedValueOnce(page({ totalFiles: 2, totalKeeps: 2, next: 'next' }))
    .mockResolvedValueOnce(page({ totalFiles: 2, totalKeeps: 2 }))
  const { library } = controller(read)
  await library.refresh()
  await library.more()
  expect(library.page.value?.files).toHaveLength(1)
  expect(library.error.value?.cause).toBe('metadata')
  expect(library.page.value?.stale).toBe(true)
})

it('clears cursors, loaded data and popup on workspace changes', async () => {
  const read = vi.fn<LibraryApi>().mockResolvedValue(page())
  const { library, workspace } = controller(read)
  await library.refresh()
  library.open(keep)
  workspace.value = 'other'
  await nextTick()
  expect(library.page.value).toBeNull()
  expect(library.opened.value).toBeNull()
  expect(library.state.scope).toEqual({ type: 'workspace' })
  expect(read).toHaveBeenCalledWith({ operation: 'release' })
})

it('retains popup identity over rail changes and enters exact task from a provenance placement', async () => {
  const read = vi.fn<LibraryApi>().mockResolvedValue(page())
  const { library, selected } = controller(read)
  await library.refresh()
  library.open(keep)
  selected.value = { id: 'b', name: 'Second' }
  await nextTick()
  expect(library.opened.value?.file.resourceId).toBe('one')
  library.navigatePreviewTask(keep)
  expect(library.opened.value).toBeNull()
  expect(library.state.scope).toMatchObject({ type: 'task', id: 'task', includeSubtasks: false })
})

it('honors a worker restart cooldown rather than letting Retry start an immediate loop', async () => {
  vi.useFakeTimers()
  const read = vi.fn<LibraryApi>().mockResolvedValue(libraryUnavailable('busy', 0, 0, 1_000))
  const { library } = controller(read)
  await library.refresh()
  expect(library.canRetry.value).toBe(false)
  await library.refresh()
  expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1_001)
  expect(library.canRetry.value).toBe(true)
  await library.refresh()
  expect(read).toHaveBeenCalledTimes(2)
})

it('starts the first library reading when an initially unread workspace becomes available', async () => {
  const read = vi.fn<LibraryApi>(async (request) =>
    request.operation === 'release' ? { type: 'released' } : page(),
  )
  const { library, workspace } = controller(read)
  workspace.value = null
  await nextTick()
  library.ensure()
  expect(read.mock.calls.filter(([request]) => request.operation === 'query')).toHaveLength(0)
  workspace.value = 'ready-workspace'
  await nextTick()
  await vi.waitFor(() => expect(library.page.value?.totalFiles).toBe(1))
})

it('ignores a late page after a new query has established a different snapshot', async () => {
  let finish!: (result: FilesLibraryResult) => void
  const read = vi
    .fn<LibraryApi>()
    .mockResolvedValueOnce(page({ totalFiles: 2, totalKeeps: 2, next: 'next' }))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue(page({ snapshot: 'new-population' }))
  const { library } = controller(read)
  await library.refresh()
  const older = library.more()
  library.state.query = 'new'
  await library.refresh()
  finish(
    page({
      totalFiles: 2,
      totalKeeps: 2,
      files: [
        { file: { ...keep, resourceId: 'old-page', sha256: 'b'.repeat(64) }, matchingKeeps: 1 },
      ],
    }),
  )
  await older
  expect(library.page.value?.snapshot).toBe('new-population')
  expect(library.page.value?.files.map((group) => group.file.resourceId)).toEqual(['one'])
})

it('ignores late provenance from an earlier opened content hash', async () => {
  const second = { ...keep, resourceId: 'two', sha256: 'b'.repeat(64) }
  const pending = new Map<string, (result: FilesLibraryResult) => void>()
  const read: LibraryApi = async (request) => {
    if (request.operation === 'provenance')
      return new Promise((resolve) => pending.set(request.sha256, resolve))
    return page({
      files: [
        { file: keep, matchingKeeps: 1 },
        { file: second, matchingKeeps: 1 },
      ],
      totalFiles: 2,
      totalKeeps: 2,
    })
  }
  const { library } = controller(read)
  await library.refresh()
  library.open(keep)
  library.open(second)
  const response = (file: LibraryKeep): FilesLibraryResult => ({
    type: 'provenance',
    snapshot: 'snapshot',
    readAt: 1,
    stale: false,
    metrics: { rows: 1, bytes: 1, elapsedMs: 1, cacheBytes: 1 },
    sha256: file.sha256,
    keeps: [{ file, matching: true }],
    total: 1,
    matching: 1,
    next: null,
  })
  pending.get(second.sha256)!(response(second))
  await vi.waitFor(() => expect(library.provenance.value?.sha256).toBe(second.sha256))
  pending.get(keep.sha256)!(response(keep))
  await nextTick()
  expect(library.provenance.value?.sha256).toBe(second.sha256)
})

it('preserves a known mutation across a deferred non-stale page reply', async () => {
  let finish!: (result: FilesLibraryResult) => void
  const read = vi
    .fn<LibraryApi>()
    .mockResolvedValueOnce(page({ totalFiles: 2, totalKeeps: 2, next: 'next' }))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  const { library } = controller(read)
  await library.refresh()
  const pending = library.more()
  library.markStale()
  finish(
    page({
      totalFiles: 2,
      totalKeeps: 2,
      stale: false,
      files: [{ file: { ...keep, resourceId: 'two', sha256: 'b'.repeat(64) }, matchingKeeps: 1 }],
    }),
  )
  await pending
  expect(library.page.value).toMatchObject({ stale: true, totalFiles: 2 })
  expect(library.page.value?.files).toHaveLength(2)
})

it.each([false, true])(
  'preserves a known mutation across deferred provenance (more=%s)',
  async (more) => {
    let finish!: (result: FilesLibraryResult) => void
    const response = (over = {}): FilesLibraryResult => ({
      type: 'provenance',
      snapshot: 'snapshot',
      readAt: 1,
      stale: false,
      metrics: { rows: 1, bytes: 1, elapsedMs: 1, cacheBytes: 1 },
      sha256: keep.sha256,
      keeps: [{ file: keep, matching: true }],
      total: 2,
      matching: 2,
      next: 'next',
      ...over,
    })
    let calls = 0
    const read: LibraryApi = async (request) => {
      if (request.operation !== 'provenance') return page()
      if (more && calls++ === 0) return response()
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    const { library } = controller(read)
    await library.refresh()
    library.open(keep)
    if (more) await vi.waitFor(() => expect(library.provenance.value?.keeps).toHaveLength(1))
    const pending = more ? library.readProvenance(true) : Promise.resolve()
    library.markStale()
    finish(
      response({
        next: null,
        keeps: [{ file: { ...keep, resourceId: 'another-alias' }, matching: true }],
      }),
    )
    await pending
    await vi.waitFor(() => expect(library.provenance.value?.stale).toBe(true))
    expect(library.provenance.value?.keeps.length).toBe(more ? 2 : 1)
  },
)

it('retains visible recovery during cooldown edits and runs only the latest query at expiry', async () => {
  vi.useFakeTimers()
  const read = vi
    .fn<LibraryApi>()
    .mockResolvedValueOnce(libraryUnavailable('busy', 0, 0, 1000))
    .mockResolvedValue(page())
  const { library } = controller(read)
  await library.refresh()
  library.state.query = 'first edit'
  library.state.query = 'latest edit'
  expect(library.error.value?.cause).toBe('busy')
  await vi.advanceTimersByTimeAsync(999)
  expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2)
  expect(read).toHaveBeenCalledTimes(2)
  expect(read.mock.calls[1]![0]).toMatchObject({
    operation: 'query',
    query: { query: 'latest edit' },
  })
  expect(library.page.value?.totalFiles).toBe(1)
  expect(library.error.value).toBeNull()
})

it('exposes recoverable cancellation for current provenance instead of a blank locations panel', async () => {
  let provenanceCalls = 0
  const read: LibraryApi = async (request) => {
    if (request.operation !== 'provenance') return page()
    if (provenanceCalls++ === 0) return libraryUnavailable('cancelled')
    return {
      type: 'provenance',
      snapshot: 'snapshot',
      readAt: 1,
      stale: false,
      metrics: { rows: 1, bytes: 1, elapsedMs: 1, cacheBytes: 1 },
      sha256: keep.sha256,
      keeps: [{ file: keep, matching: true }],
      total: 1,
      matching: 1,
      next: null,
    }
  }
  const { library } = controller(read)
  await library.refresh()
  library.open(keep)
  await vi.waitFor(() => expect(library.provenanceError.value?.cause).toBe('cancelled'))
  await library.readProvenance()
  expect(library.provenance.value?.total).toBe(1)
  expect(library.provenanceError.value).toBeNull()
})

import {
  computed,
  inject,
  onScopeDispose,
  provide,
  reactive,
  shallowRef,
  watch,
  type InjectionKey,
} from 'vue'
import {
  filesLibraryResult,
  libraryUnavailable,
  libraryWords,
  type FilesLibraryQuery,
  type FilesLibraryRequest,
  type FilesLibraryResult,
  type LibraryKeep,
  type LibraryTask,
  type LibraryUnavailable,
} from '../../../shared/files-library'

type FilePage = Extract<FilesLibraryResult, { type: 'files' }>
type Provenance = Extract<FilesLibraryResult, { type: 'provenance' }>
export type LibraryApi = (request: FilesLibraryRequest) => Promise<FilesLibraryResult>
const defaults = (): FilesLibraryQuery => ({
  scope: { type: 'workspace' },
  query: '',
  kind: 'all',
  role: 'all',
  sort: 'newest',
})

export function createFilesLibrary(options: {
  read: LibraryApi
  workspace: () => string | null
  selected: () => { id: string; name: string } | null
}) {
  const state = reactive({
    ...defaults(),
    view: 'icons' as 'icons' | 'list',
    includeSubtasks: true,
    scopeName: 'All workspace',
    scrollTop: 0,
    scrollVersion: 0,
  })
  const page = shallowRef<FilePage | null>(null)
  const error = shallowRef<LibraryUnavailable | null>(null)
  const busy = shallowRef(false),
    paging = shallowRef(false)
  const retryAt = shallowRef(0)
  const opened = shallowRef<{
    file: LibraryKeep
    snapshot: string
    serial: number
    opener: HTMLElement | null
  } | null>(null)
  const provenance = shallowRef<Provenance | null>(null)
  const provenanceError = shallowRef<LibraryUnavailable | null>(null)
  const provenanceBusy = shallowRef(false)
  const searchElement = shallowRef<HTMLInputElement | null>(null)
  const workspaceVersion = shallowRef(0)
  let generation = 0,
    previewGeneration = 0,
    previewSerial = 0,
    dirty = 0
  let answeredSignature: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let enabled = false
  const query = computed<FilesLibraryQuery>(() => ({
    scope:
      state.scope.type === 'workspace'
        ? state.scope
        : { ...state.scope, includeSubtasks: state.includeSubtasks },
    query: state.query,
    kind: state.kind,
    role: state.role,
    sort: state.sort,
  }))
  const signature = computed(() =>
    JSON.stringify({ ...query.value, query: libraryWords(query.value.query).join(' ') }),
  )
  const selected = computed(options.selected)
  const canRetry = computed(() => retryAt.value === 0)
  const count = computed(() => page.value?.totalFiles ?? null)

  async function read(request: FilesLibraryRequest): Promise<FilesLibraryResult> {
    try {
      return filesLibraryResult.parse(await options.read(request))
    } catch {
      return libraryUnavailable('worker')
    }
  }
  function setError(failure: LibraryUnavailable): void {
    if (failure.cause === 'cancelled') return
    error.value = failure
    if (failure.retryAfterMs !== undefined) {
      retryAt.value = Date.now() + failure.retryAfterMs
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => {
        retryAt.value = 0
      }, failure.retryAfterMs)
    }
  }
  async function refresh(): Promise<void> {
    clearTimeout(timer)
    if (disposed || options.workspace() === null || !canRetry.value) return
    enabled = true
    const current = ++generation,
      key = signature.value,
      workspace = options.workspace(),
      before = dirty
    if (answeredSignature !== key) page.value = null
    error.value = null
    busy.value = true
    paging.value = false
    const answer = await read({ operation: 'query', query: query.value })
    if (
      disposed ||
      current !== generation ||
      workspace !== options.workspace() ||
      key !== signature.value
    )
      return
    busy.value = false
    if (answer.type === 'files') {
      page.value = { ...answer, stale: answer.stale || before !== dirty }
      answeredSignature = key
    } else if (answer.type === 'unavailable') {
      if (page.value !== null) page.value = { ...page.value, stale: true }
      setError(answer)
    }
  }
  function ensure(): void {
    enabled = true
    if (page.value === null && !busy.value && error.value === null) void refresh()
  }
  function markStale(): void {
    dirty++
    if (page.value !== null) page.value = { ...page.value, stale: true }
    if (provenance.value !== null) provenance.value = { ...provenance.value, stale: true }
  }
  async function more(): Promise<void> {
    const original = page.value
    if (original?.next === null || original === null || paging.value || busy.value) return
    const current = generation,
      key = signature.value
    paging.value = true
    error.value = null
    const answer = await read({ operation: 'page', cursor: original.next })
    if (
      disposed ||
      current !== generation ||
      key !== signature.value ||
      page.value?.snapshot !== original.snapshot
    )
      return
    paging.value = false
    if (answer.type === 'files' && answer.snapshot === original.snapshot) {
      const seen = new Set(original.files.map((one) => one.file.sha256))
      if (
        answer.files.some((one) => seen.has(one.file.sha256)) ||
        answer.totalFiles !== original.totalFiles ||
        original.files.length + answer.files.length > original.totalFiles
      ) {
        setError(libraryUnavailable('metadata'))
        markStale()
        return
      }
      page.value = {
        ...answer,
        stale: original.stale || answer.stale,
        files: [...original.files, ...answer.files],
      }
    } else if (answer.type === 'unavailable') {
      setError(answer)
      markStale()
    }
  }
  function all(): void {
    state.scope = { type: 'workspace' }
    state.scopeName = 'All workspace'
  }
  function pinSelected(): void {
    if (selected.value === null) return
    state.scope = {
      type: 'conversationWork',
      id: selected.value.id,
      includeSubtasks: state.includeSubtasks,
    }
    state.scopeName = `Work in ${selected.value.name}`
  }
  function task(task: Pick<LibraryTask, 'id' | 'label' | 'title'>, exact = false): void {
    if (exact) state.includeSubtasks = false
    state.scope = { type: 'task', id: task.id, includeSubtasks: state.includeSubtasks }
    state.scopeName = `${task.label}${task.title === null ? '' : ` · ${task.title}`}`
  }
  function graphTask(id: string, label = 'Selected task', title: string | null = null): void {
    state.query = ''
    state.kind = 'all'
    state.role = 'all'
    task({ id, label, title }, true)
    state.scrollTop = 0
    state.scrollVersion++
  }
  function clearFilters(): void {
    state.query = ''
    state.kind = 'all'
    state.role = 'all'
  }
  function reset(): void {
    Object.assign(state, defaults(), {
      view: 'icons',
      includeSubtasks: true,
      scopeName: 'All workspace',
    })
    state.scrollTop = 0
    state.scrollVersion++
  }
  function closePreview(): void {
    previewGeneration++
    opened.value = null
    provenance.value = null
    provenanceError.value = null
    provenanceBusy.value = false
  }
  function open(file: LibraryKeep, opener: HTMLElement | null = null): void {
    if (page.value === null) return
    closePreview()
    opened.value = { file, snapshot: page.value.snapshot, serial: ++previewSerial, opener }
    void readProvenance()
  }
  async function readProvenance(more = false): Promise<void> {
    const preview = opened.value
    if (preview === null || provenanceBusy.value || (more && provenance.value?.next == null)) return
    const current = ++previewGeneration
    provenanceBusy.value = true
    provenanceError.value = null
    const original = provenance.value
    const answer = await read({
      operation: 'provenance',
      snapshot: preview.snapshot,
      sha256: preview.file.sha256,
      ...(more && original?.next ? { cursor: original.next } : {}),
    })
    if (disposed || current !== previewGeneration || preview.serial !== opened.value?.serial) return
    provenanceBusy.value = false
    if (
      answer.type === 'provenance' &&
      answer.snapshot === preview.snapshot &&
      answer.sha256 === preview.file.sha256
    ) {
      provenance.value =
        more && original !== null
          ? { ...answer, keeps: [...original.keeps, ...answer.keeps] }
          : answer
    } else if (answer.type === 'unavailable' && answer.cause !== 'cancelled')
      provenanceError.value = answer
  }
  function navigatePreviewTask(file: LibraryKeep): void {
    closePreview()
    clearFilters()
    task({ id: file.piece, label: file.label, title: file.pieceTitle }, true)
  }
  watch(
    signature,
    () => {
      generation++
      busy.value = false
      paging.value = false
      error.value = null
      if (answeredSignature !== signature.value) page.value = null
      state.scrollTop = 0
      state.scrollVersion++
      clearTimeout(timer)
      if (enabled) timer = setTimeout(() => void refresh(), 140)
    },
    { flush: 'sync' },
  )
  watch(options.workspace, () => {
    workspaceVersion.value++
    const wasEnabled = enabled
    generation++
    closePreview()
    page.value = null
    answeredSignature = null
    busy.value = false
    paging.value = false
    error.value = null
    enabled = false
    reset()
    state.scrollTop = 0
    state.scrollVersion++
    void read({ operation: 'release' })
    if (wasEnabled) {
      enabled = true
      timer = setTimeout(() => void refresh(), 0)
    }
  })
  onScopeDispose(() => {
    disposed = true
    generation++
    closePreview()
    clearTimeout(timer)
    clearTimeout(retryTimer)
    void read({ operation: 'release' })
  })
  return {
    state,
    query,
    page,
    error,
    busy,
    paging,
    selected,
    count,
    canRetry,
    opened,
    provenance,
    provenanceError,
    provenanceBusy,
    searchElement,
    workspaceVersion,
    ensure,
    refresh,
    more,
    markStale,
    all,
    pinSelected,
    task,
    graphTask,
    clearFilters,
    reset,
    open,
    closePreview,
    readProvenance,
    navigatePreviewTask,
    read,
  }
}
export type FilesLibraryController = ReturnType<typeof createFilesLibrary>
const LIBRARY: InjectionKey<FilesLibraryController> = Symbol('workspace files library')
export function provideFilesLibrary(library: FilesLibraryController): void {
  provide(LIBRARY, library)
}
export function useFilesLibrary(): FilesLibraryController | null {
  return inject(LIBRARY, null)
}

export function libraryFailureSays(failure: LibraryUnavailable): string {
  switch (failure.cause) {
    case 'missing-task':
      return 'This task is no longer available. Choose another task or reset the view.'
    case 'missing-conversation':
      return 'The pinned conversation is unavailable. Use selected or reset the view.'
    case 'cursor-expired':
      return 'This reading has expired. Refresh to read the files again.'
    case 'invalid-cursor':
      return 'This page no longer belongs to the current reading. Refresh the files.'
    case 'busy':
      return 'The file reader is busy. Retry will be available shortly.'
    case 'changed':
      return 'The workspace changed during this reading. Refresh to try again.'
    case 'ancestry':
      return 'Some task ancestry could not be read. These files could not be counted.'
    case 'metadata':
      return 'Some file or task details could not be read. These files could not be counted.'
    case 'budget':
      return 'Could not finish reading these files within the reading limit.'
    default:
      return 'Could not finish reading these files.'
  }
}

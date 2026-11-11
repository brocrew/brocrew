import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import StorageSection from '../../src/renderer/src/components/StorageSection.vue'
import {
  STORAGE_PART_IDS,
  type CacheClearState,
  type CacheClearReply,
  type StorageBridge,
  type StorageOverview,
  type StorageDirectory,
} from '../../src/shared/storage'
import { mount, unmountAll } from './harness'
const overview: StorageOverview = {
  totalBytes: 8 * 1024 ** 3,
  freeBytes: 16 * 1024 ** 3,
  measuredAt: 1,
  partial: false,
  parts: STORAGE_PART_IDS.map((id) => ({ id, bytes: 1024 ** 3, partial: false })),
}
const directory: StorageDirectory = {
  location: { part: 'workspace', segments: [] },
  entries: [{ name: 'sample-projects', bytes: 1024, isDirectory: true }],
  smallerCount: 3,
  smallerBytes: 2048,
  totalBytes: 3072,
  partial: false,
}
const settle = async () => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}
function setup(over: Partial<StorageBridge> = {}) {
  const bridge = {
    measure: vi.fn(async () => overview),
    children: vi.fn(async () => directory),
    reveal: vi.fn(async () => ({ ok: true as const })),
    clearCache: vi.fn<StorageBridge['clearCache']>(async () => ({
      ok: true,
      operation: { id: 1, status: 'complete' },
    })),
    watchCacheClear: vi.fn<StorageBridge['watchCacheClear']>((onState) => {
      onState(null)
      return () => {}
    }),
    pruneBackups: vi.fn(async () => ({ ok: true as const })),
    ...over,
  } satisfies StorageBridge
  Reflect.set(window, 'api', { storage: bridge })
  const m = mount(StorageSection, {}, { width: 1100, height: 1000 })
  return { m, bridge }
}
function setupCache(over: Partial<StorageBridge> = {}) {
  let update!: (state: CacheClearState | null) => void
  const view = setup({
    ...over,
    watchCacheClear: (listener) => {
      update = listener
      return () => {}
    },
  })
  return { ...view, update: (state: CacheClearState | null) => update(state) }
}
function setupCacheRefresh(children: StorageBridge['children']) {
  let finishRefresh!: (value: StorageOverview) => void
  const refresh = new Promise<StorageOverview>((resolve) => {
    finishRefresh = resolve
  })
  const measure = vi
    .fn<StorageBridge['measure']>()
    .mockResolvedValueOnce(overview)
    .mockReturnValueOnce(refresh)
  return {
    ...setupCache({ measure, children }),
    measure,
    finishRefresh: (value: StorageOverview) => finishRefresh(value),
  }
}
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})
it('measures on open, shows loading, and uses the returned sizes rather than mock figures', async () => {
  let finish!: (value: StorageOverview) => void
  const read = new Promise<StorageOverview>((resolve) => (finish = resolve))
  const { m, bridge } = setup({ measure: vi.fn(() => read) })
  await nextTick()
  expect(m.all('storage-loading')).toHaveLength(1)
  finish(overview)
  await settle()
  expect(bridge.measure).toHaveBeenCalledTimes(1)
  expect(m.all('storage-loading')).toHaveLength(0)
  expect(m.host.textContent).toContain('8.0 GB')
  expect(m.host.querySelectorAll('[data-part]')).toHaveLength(8)
  const retention = [...m.host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Keep the last 2',
  )!
  expect(retention.disabled).toBe(false)
  expect(m.host.textContent).not.toContain('coming soon')
})

it('Keep the last 2 waits for pruning, refuses repeat clicks, and refreshes only on success', async () => {
  let finish!: (value: { ok: true }) => void
  const { m, bridge } = setup({
    pruneBackups: vi.fn<StorageBridge['pruneBackups']>(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          finish = resolve
        }),
    ),
  })
  await settle()
  m.q('storage-prune-backups').click()
  await settle()
  expect((m.q('storage-prune-backups') as HTMLButtonElement).disabled).toBe(true)
  m.q('storage-prune-backups').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(bridge.pruneBackups).toHaveBeenCalledTimes(1)
  expect(bridge.measure).toHaveBeenCalledTimes(1)
  finish({ ok: true })
  await settle()
  expect(bridge.measure).toHaveBeenCalledTimes(2)
  vi.mocked(bridge.pruneBackups).mockResolvedValueOnce({ ok: false, error: 'unavailable' })
  m.q('storage-prune-backups').click()
  await settle()
  expect(bridge.measure).toHaveBeenCalledTimes(2)
  expect(m.q('storage-message').textContent).toContain('Storage could not be read.')
})
it('drills through typed locations, shows the smaller-item summary, and returns through the breadcrumb', async () => {
  const { m, bridge } = setup()
  await settle()
  m.host.querySelector<HTMLButtonElement>('button[aria-label="Open Workspace"]')!.click()
  await settle()
  expect(bridge.children).toHaveBeenCalledWith({ part: 'workspace', segments: [] })
  expect(m.q('storage-smaller').textContent).toContain('3 smaller items')
  m.host.querySelector<HTMLButtonElement>('button[aria-label="Open sample-projects"]')!.click()
  await settle()
  expect(bridge.children).toHaveBeenLastCalledWith({
    part: 'workspace',
    segments: ['sample-projects'],
  })
  m.host.querySelector<HTMLButtonElement>('.storage-crumbs button')!.click()
  await settle()
  expect(m.host.querySelectorAll('[data-part]')).toHaveLength(8)
})
it('uses the OS reveal bridge and remeasures only after a successful cache clear', async () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
  const { m, bridge } = setup()
  await settle()
  const data = m.host.querySelector<HTMLAnchorElement>(
    'a[aria-label="Show in Explorer: BroCrew data folder"]',
  )!
  expect(data.textContent).toBe('Show in Explorer')
  data.click()
  await settle()
  expect(bridge.reveal).toHaveBeenCalledWith(undefined)
  m.q('storage-clear-cache').click()
  await settle()
  expect(bridge.clearCache).toHaveBeenCalledTimes(1)
  expect(bridge.measure).toHaveBeenCalledTimes(2)
  expect(m.q('storage-message').textContent).toBe('Cache cleared.')
})
it('keeps an unavailable or partial measurement honest and reports cache refusal', async () => {
  const { m, bridge } = setup({
    measure: vi.fn(async () => ({
      ...overview,
      partial: true,
      parts: overview.parts.map((part) =>
        part.id === 'workspace' ? { ...part, bytes: null, partial: true } : part,
      ),
    })),
    clearCache: vi.fn(async () => ({ ok: false as const, error: 'busy' as const })),
  })
  await settle()
  expect(m.host.textContent).toContain('Unavailable')
  expect(m.q('storage-message').textContent).toContain('could not be measured')
  m.q('storage-clear-cache').click()
  await settle()
  expect(bridge.measure).toHaveBeenCalledTimes(1)
  expect(m.q('storage-message').textContent).toContain('Storage is busy')
})
it('discards a stale child reply after returning to the overview', async () => {
  let finish!: (value: StorageDirectory) => void
  const pending = new Promise<StorageDirectory>((resolve) => (finish = resolve))
  const { m } = setup({ children: vi.fn(() => pending) })
  await settle()
  m.host.querySelector<HTMLButtonElement>('button[aria-label="Open Workspace"]')!.click()
  await nextTick()
  m.host.querySelector<HTMLButtonElement>('.storage-crumbs button')!.click()
  await settle()
  finish(directory)
  await settle()
  expect(m.all('storage-directory')).toHaveLength(0)
  expect(m.host.querySelectorAll('[data-part]')).toHaveLength(8)
})

it('names attachments honestly and shows links without a size or follow action', async () => {
  const linkDirectory: StorageDirectory = {
    ...directory,
    entries: [{ name: 'sample-link', bytes: null, isDirectory: false, isLink: true }],
    smallerCount: 0,
  }
  const { m, bridge } = setup({ children: vi.fn(async () => linkDirectory) })
  await settle()
  expect(m.host.textContent).toContain('Attachments')
  expect(m.host.textContent).toContain('Files kept from your conversations')
  m.host.querySelector<HTMLButtonElement>('button[aria-label="Open Workspace"]')!.click()
  await settle()
  const row = m.host.querySelector<HTMLElement>('.drilled-row')!
  expect(row.textContent).toContain('sample-link')
  expect(row.textContent).toContain('Link')
  expect(row.textContent).not.toContain('B')
  expect(row.querySelectorAll('a,button')).toHaveLength(0)
  expect(bridge.reveal).not.toHaveBeenCalled()
})

it('keeps pending cache work busy and applies real completion once despite an older invoke reply', async () => {
  let update!: (state: CacheClearState | null) => void
  let reply!: (value: CacheClearReply) => void
  const unsub = vi.fn()
  const { m, bridge } = setup({
    watchCacheClear: (listener) => {
      update = listener
      return unsub
    },
    clearCache: vi.fn(
      () =>
        new Promise<CacheClearReply>((resolve) => {
          reply = resolve
        }),
    ),
  })
  await settle()
  m.q('storage-clear-cache').click()
  update({ id: 1, status: 'pending' })
  await settle()
  expect(m.q('storage-message').textContent).toBe('Still clearing cache…')
  expect((m.q('storage-prune-backups') as HTMLButtonElement).disabled).toBe(true)
  m.q('storage-clear-cache').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  m.q('storage-prune-backups').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(bridge.clearCache).toHaveBeenCalledTimes(1)
  expect(bridge.pruneBackups).not.toHaveBeenCalled()
  expect(bridge.measure).toHaveBeenCalledTimes(1)
  update({ id: 1, status: 'complete' })
  await settle()
  reply({ ok: true, operation: { id: 1, status: 'pending' } })
  update({ id: 1, status: 'complete' })
  update({ id: 1, status: 'clearing' })
  await settle()
  expect(m.q('storage-message').textContent).toBe('Cache cleared.')
  expect(bridge.measure).toHaveBeenCalledTimes(2)
  expect((m.q('storage-clear-cache') as HTMLButtonElement).disabled).toBe(false)
  m.unmount()
  expect(unsub).toHaveBeenCalledTimes(1)
})

it('shows retained pending and late failure on reopening without applying events to an unmounted Settings page', async () => {
  let current: CacheClearState = { id: 7, status: 'pending' }
  const listeners = new Set<(state: CacheClearState | null) => void>()
  const watch: StorageBridge['watchCacheClear'] = (listener) => {
    listeners.add(listener)
    listener(current)
    return () => {
      listeners.delete(listener)
    }
  }
  const first = setup({ watchCacheClear: watch })
  await settle()
  expect(first.m.q('storage-message').textContent).toBe('Still clearing cache…')
  first.m.unmount()
  expect(listeners.size).toBe(0)
  current = { id: 7, status: 'failed', error: 'unavailable' }
  const reopened = setup({
    watchCacheClear: watch,
    measure: vi.fn(async () => ({ ...overview, partial: true })),
  })
  await settle()
  expect(reopened.m.q('storage-message').textContent).toContain('Storage could not be read.')
  expect((reopened.m.q('storage-clear-cache') as HTMLButtonElement).disabled).toBe(false)
  expect(reopened.bridge.clearCache).not.toHaveBeenCalled()
  expect(reopened.bridge.measure).toHaveBeenCalledTimes(1)
  expect(first.bridge.measure).toHaveBeenCalledTimes(1)
})

it('does not let a delayed old cache snapshot or unmounted completion overwrite a newer operation', async () => {
  const { m, bridge, update } = setupCache()
  await settle()
  update({ id: 2, status: 'pending' })
  update({ id: 1, status: 'failed', error: 'unavailable' })
  update(null)
  await settle()
  expect(m.q('storage-message').textContent).toBe('Still clearing cache…')
  m.unmount()
  update({ id: 2, status: 'complete' })
  await settle()
  expect(bridge.measure).toHaveBeenCalledTimes(1)
})

it('reports a real rejection after the pending invoke has returned without measuring or leaving buttons busy', async () => {
  const { m, bridge, update } = setupCache({
    clearCache: vi.fn<StorageBridge['clearCache']>(async () => ({
      ok: true,
      operation: { id: 1, status: 'pending' },
    })),
  })
  await settle()
  m.q('storage-clear-cache').click()
  await settle()
  expect(m.q('storage-message').textContent).toBe('Still clearing cache…')
  update({ id: 1, status: 'failed', error: 'unavailable' })
  await settle()
  expect(m.q('storage-message').textContent).toContain('Storage could not be read.')
  expect(m.host.textContent).not.toContain('Cache cleared.')
  expect(bridge.measure).toHaveBeenCalledTimes(1)
  expect((m.q('storage-clear-cache') as HTMLButtonElement).disabled).toBe(false)
})

it.each(['missing', 'complete'] as const)(
  'keeps a rejected cache remeasurement visible when the earlier overview is %s',
  async (earlier) => {
    let finishInitial!: (value: StorageOverview) => void
    let rejectRefresh!: (error: Error) => void
    const initial = new Promise<StorageOverview>((resolve) => {
      finishInitial = resolve
    })
    const refresh = new Promise<StorageOverview>((_resolve, reject) => {
      rejectRefresh = reject
    })
    if (earlier === 'complete') finishInitial(overview)
    const measure = vi
      .fn<StorageBridge['measure']>()
      .mockReturnValueOnce(initial)
      .mockReturnValueOnce(refresh)
    const { m, update } = setupCache({
      measure,
    })
    await settle()
    update({ id: 1, status: 'complete' })
    rejectRefresh(new Error('Cache remeasurement failed'))
    await settle()
    expect(m.q('storage-message').textContent).toContain('Cache remeasurement failed')
    expect(m.host.textContent).not.toContain('Cache cleared.')
    finishInitial(overview)
    await settle()
    expect(m.q('storage-message').textContent).toContain('Cache remeasurement failed')
    expect(m.host.textContent).not.toContain('Cache cleared.')
    expect(measure).toHaveBeenCalledTimes(2)
  },
)

it('does not announce cache success after a newer directory request supersedes its refresh', async () => {
  const { m, bridge, update, measure, finishRefresh } = setupCacheRefresh(
    vi.fn(async () => ({ ...directory, partial: true, error: 'invalid-location' as const })),
  )
  await settle()
  update({ id: 1, status: 'pending' })
  await nextTick()
  expect(m.q('storage-message').textContent).toBe('Still clearing cache…')
  update({ id: 1, status: 'complete' })
  await nextTick()
  const drill = m.host.querySelector<HTMLButtonElement>('button[aria-label="Open Workspace"]')!
  expect(drill.disabled).toBe(false)
  drill.click()
  await settle()
  expect(bridge.children).toHaveBeenCalledWith({ part: 'workspace', segments: [] })
  expect(m.q('storage-message').textContent).toContain('This folder is no longer available.')
  finishRefresh(overview)
  await settle()
  expect(m.all('storage-directory')).toHaveLength(1)
  expect(m.q('storage-message').textContent).toContain('This folder is no longer available.')
  expect(m.host.textContent).not.toContain('Cache cleared.')
  expect(measure).toHaveBeenCalledTimes(2)
})

it.each(['partial', 'rejection'] as const)(
  'shows a later largest-folders %s instead of retaining cache success',
  async (outcome) => {
    const children = vi.fn<StorageBridge['children']>()
    if (outcome === 'partial') children.mockResolvedValue({ ...directory, partial: true })
    else children.mockRejectedValue(new Error('Folder measurement failed'))
    const { m, bridge } = setup({ children })
    await settle()
    m.q('storage-clear-cache').click()
    await settle()
    expect(m.q('storage-message').textContent).toBe('Cache cleared.')
    m.host.querySelector<HTMLElement>('details.largest-folders summary')!.click()
    await settle()
    expect(children).toHaveBeenCalledTimes(1)
    expect(m.q('storage-message').textContent).toContain(
      outcome === 'partial' ? 'Some sizes could not be measured.' : 'Folder measurement failed',
    )
    expect(m.host.textContent).not.toContain('Cache cleared.')
    expect(bridge.measure).toHaveBeenCalledTimes(2)
  },
)

it('does not overwrite a folder error that arrives while the accepted cache refresh is still pending', async () => {
  const { m, bridge, update, measure, finishRefresh } = setupCacheRefresh(
    vi.fn(async () => ({ ...directory, partial: true })),
  )
  await settle()
  update({ id: 1, status: 'complete' })
  await nextTick()
  m.host.querySelector<HTMLElement>('details.largest-folders summary')!.click()
  await settle()
  expect(m.q('storage-message').textContent).toBe('Some sizes could not be measured.')
  finishRefresh(overview)
  await settle()
  expect(bridge.children).toHaveBeenCalledTimes(1)
  expect(m.q('storage-message').textContent).toBe('Some sizes could not be measured.')
  expect(m.host.textContent).not.toContain('Cache cleared.')
  expect(measure).toHaveBeenCalledTimes(2)
})

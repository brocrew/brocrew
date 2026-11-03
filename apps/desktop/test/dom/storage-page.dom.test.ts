import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import StorageSection from '../../src/renderer/src/components/StorageSection.vue'
import {
  STORAGE_PART_IDS,
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
    clearCache: vi.fn(async () => ({ ok: true as const })),
    pruneBackups: vi.fn(async () => ({ ok: true as const })),
    ...over,
  } satisfies StorageBridge
  Reflect.set(window, 'api', { storage: bridge })
  const m = mount(StorageSection, {}, { width: 1100, height: 1000 })
  return { m, bridge }
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

import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import FilesLibrary from '../../src/renderer/src/components/FilesLibrary.vue'
import FilesLibraryPreview from '../../src/renderer/src/components/FilesLibraryPreview.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import {
  createFilesLibrary,
  type FilesLibraryController,
  type LibraryApi,
} from '../../src/renderer/src/composables/useFilesLibrary'
import { filesLibraryReplies } from '../fixtures/files-library-replies'
import { libraryUnavailable, type LibraryKeep } from '../../src/shared/files-library'
import type { ResourceReading } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'
import { drawnReady } from './drawn'

afterEach(() => unmountAll())
function stage(dense = false, over?: LibraryApi) {
  const fixture = filesLibraryReplies(dense)
  const selected = ref({ id: 'brobot', name: 'CODEX interim' }),
    workspace = ref('fictional-workspace')
  let library!: FilesLibraryController
  const readResource = vi.fn(async (resourceId: string): Promise<ResourceReading> => {
    const keep = fixture.keeps.find((one) => one.resourceId === resourceId)!
    return {
      ok: true,
      resourceId,
      form: keep.form ?? 'markdown',
      name: keep.name,
      bytes: keep.bytes,
      text:
        keep.form === 'image'
          ? null
          : '# Fictional document\n\nSafe text for the actual component check.',
    }
  })
  const component = defineComponent({
    setup() {
      library = createFilesLibrary({
        read: over ?? fixture.read,
        selected: () => selected.value,
        workspace: () => workspace.value,
      })
      return () =>
        h(
          'div',
          { style: 'display:flex;flex:1;min-width:0;min-height:0;background:var(--panel)' },
          [
            h(IconSprite),
            h(FilesLibrary, { controller: library }),
            h(FilesLibraryPreview, { library, workspace: workspace.value, read: readResource }),
          ],
        )
    },
  })
  return {
    component,
    fixture,
    selected,
    workspace,
    readResource,
    get library() {
      return library
    },
  }
}
const text = (element: Element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
async function ready(dense = false, width = 1180, height = 880, over?: LibraryApi) {
  await page.viewport(width, height)
  const s = stage(dense, over),
    m = mount(s.component, {}, { width, height })
  await vi.waitFor(() => expect(m.all('files-count')).toHaveLength(1))
  await drawnReady()
  return { s, m }
}

it('shows compact Icons by default with visible 13px task/person/kept time, and List preserves IDs/counts/order', async () => {
  const { s, m } = await ready(true, 1440, 1080)
  expect(text(m.q('files-count'))).toBe('80 files · 86 keeps')
  expect(m.all('library-file')).toHaveLength(60)
  const files = m.all('library-file').map((one) => one.dataset.document)
  const first = m.q('library-file')
  for (const element of first.querySelectorAll<HTMLElement>('.file-meta,.kept-time')) {
    expect(parseFloat(getComputedStyle(element).fontSize)).toBeGreaterThanOrEqual(13)
    expect(element.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1)
  }
  expect(first.querySelector('.file-meta')?.textContent).toMatch(/W\d/)
  expect(first.querySelector('time')?.getAttribute('datetime')).toMatch(/^2026-/)
  m.q('files-view-list').click()
  await nextTick()
  expect(m.all('library-file').map((one) => one.dataset.document)).toEqual(files)
  expect(s.library.page.value?.totalFiles).toBe(80)
  m.q('files-more').click()
  await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(80))
  expect(new Set(m.all('library-file').map((one) => one.dataset.document)).size).toBe(80)
})

it('pins held/given conversation work through rail moves and changes only on Use selected', async () => {
  const { s, m } = await ready()
  m.q('files-scope-conversation').click()
  await vi.waitFor(() => expect(text(m.q('files-count'))).toBe('11 files · 15 keeps'))
  m.q('files-depth').click()
  await vi.waitFor(() => expect(text(m.q('files-count'))).toBe('10 files · 13 keeps'))
  s.selected.value = { id: 'promo', name: 'Promotion' }
  await nextTick()
  expect(text(m.q('files-scope-conversation'))).toBe('Work in CODEX interim')
  expect(text(m.q('files-count'))).toBe('10 files · 13 keeps')
  m.q('files-use-selected').click()
  await vi.waitFor(() => expect(text(m.q('files-count'))).toBe('1 files · 1 keeps'))
  expect(s.library.state.includeSubtasks).toBe(false)
})

it('stages task picker choices and depth, supports empty roots and cancels without changing scope', async () => {
  const { s, m } = await ready()
  m.q('files-scope-task').click()
  await vi.waitFor(() => expect(m.all('files-task-option')).toHaveLength(4))
  const empty = m.all('files-task-option').find((element) => element.dataset.task === 't21')!
  empty.click()
  m.q('files-task-depth').click()
  m.q('files-task-cancel').click()
  await nextTick()
  expect(s.library.state.scope.type).toBe('workspace')
  expect(s.library.state.includeSubtasks).toBe(true)
  m.q('files-scope-task').click()
  await vi.waitFor(() => expect(m.all('files-task-option')).toHaveLength(4))
  m.all('files-task-option')
    .find((element) => element.dataset.task === 't21')!
    .click()
  m.q('files-task-depth').click()
  await nextTick()
  m.q('files-task-use').click()
  await vi.waitFor(() => expect(m.all('files-empty')).toHaveLength(1))
  expect(text(m.q('files-empty'))).toContain('No files kept on this work yet.')
  expect(s.library.state.scope).toMatchObject({ type: 'task', id: 't21', includeSubtasks: false })
})

it('filters with complete facets/counts and resets query/kind/role/sort/view/depth without changing the rail', async () => {
  const { s, m } = await ready()
  const search = m.q('files-search') as HTMLInputElement
  search.value = 'no such alias'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await vi.waitFor(() => expect(m.all('files-clear')).toHaveLength(1))
  expect(text(m.q('files-empty'))).toContain('No files match these filters.')
  m.q('files-clear').click()
  await vi.waitFor(() => expect(text(m.q('files-count'))).toBe('16 files · 22 keeps'))
  const role = m.q('files-role') as HTMLSelectElement
  role.value = 'input'
  role.dispatchEvent(new Event('change', { bubbles: true }))
  await vi.waitFor(() => expect(s.library.page.value?.totalKeeps).toBe(8))
  m.q('files-view-list').click()
  m.q('files-reset').click()
  await vi.waitFor(() => expect(text(m.q('files-count'))).toBe('16 files · 22 keeps'))
  expect(s.library.state).toMatchObject({
    view: 'icons',
    sort: 'newest',
    includeSubtasks: true,
    query: '',
    role: 'all',
    kind: 'all',
  })
  expect(s.selected.value.id).toBe('brobot')
})

it('opens the precise representative in the shared safe popup, retains it on rail changes, and shows full provenance', async () => {
  const { s, m } = await ready()
  m.q('files-scope-conversation').click()
  await vi.waitFor(() => expect(s.library.page.value?.totalFiles).toBe(11))
  const group = s.library.page.value!.files.find(
    (one) => one.file.sha256 === s.fixture.source.files[0]!.sha256,
  )!
  const trigger = m
    .all('library-file')
    .find((element) => element.dataset.document === group.file.resourceId)!
  trigger.focus()
  trigger.click()
  await vi.waitFor(() => expect(m.all('canonical-document-viewer')).toHaveLength(1))
  expect(s.readResource).toHaveBeenLastCalledWith(group.file.resourceId)
  expect(m.q('overlay-host').getAttribute('aria-label')).toContain(group.file.title)
  s.selected.value = { id: 'promo', name: 'Promotion' }
  await nextTick()
  expect(m.all('canonical-document-viewer')).toHaveLength(1)
  m.q('files-provenance').querySelector('summary')!.click()
  await nextTick()
  expect(m.all('files-placement')).toHaveLength(3)
  expect(m.all('files-placement').filter((one) => one.dataset.matching === 'false')).toHaveLength(1)
  expect(text(m.q('files-provenance'))).toContain('Outside this view')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await nextTick()
  expect(m.all('canonical-document-viewer')).toHaveLength(0)
  expect(document.activeElement).toBe(trigger)
})

it('keeps required metadata readable at 390px with long names and supports keyboard search outside modals', async () => {
  const { s, m } = await ready(false, 390, 844)
  const file = s.library.page.value!.files[0]!.file
  const long: LibraryKeep = {
    ...file,
    title: 'A long readable title '.repeat(9),
    label: 'W19.16.3.123',
    addedBy: { conversation: 'long', identity: 'long', name: 'اسم طويل لشخص يعمل على المراجعة' },
  }
  s.library.page.value = { ...s.library.page.value!, files: [{ file: long, matchingKeeps: 1 }] }
  await nextTick()
  await drawnReady()
  const first = m.q('library-file')
  expect(first.getAttribute('aria-label')).toContain(long.addedBy!.name)
  for (const element of first.querySelectorAll<HTMLElement>('.file-meta,.kept-time')) {
    expect(parseFloat(getComputedStyle(element).fontSize)).toBeGreaterThanOrEqual(13)
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1)
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
  await nextTick()
  expect(document.activeElement).toBe(m.q('files-search'))
  expect(m.q('files-library').scrollWidth).toBeLessThanOrEqual(390)
})

it('preserves same-query data visibly stale after failure and distinguishes initial failure from empty', async () => {
  const fixture = filesLibraryReplies()
  let fail = false
  const read: LibraryApi = (request) =>
    fail ? Promise.resolve(libraryUnavailable('budget', 90)) : fixture.read(request)
  const { s, m } = await ready(false, 1180, 880, read)
  fail = true
  await s.library.refresh()
  await nextTick()
  expect(m.all('library-file')).toHaveLength(16)
  expect(m.all('files-stale')).toHaveLength(1)
  expect(m.all('files-empty')).toHaveLength(0)
  s.library.state.query = 'new'
  await s.library.refresh()
  await nextTick()
  expect(m.all('files-count')).toHaveLength(0)
  expect(m.all('files-empty')).toHaveLength(0)
  expect(text(m.q('files-error'))).toContain('Could not finish')
})

it('retains the complete count and loaded page after a load-more failure, then refreshes explicitly', async () => {
  const fixture = filesLibraryReplies(true)
  let fail = true
  const read: LibraryApi = (request) =>
    request.operation === 'page' && fail
      ? Promise.resolve(libraryUnavailable('worker'))
      : fixture.read(request)
  const { s, m } = await ready(true, 1180, 880, read)
  m.q('files-more').click()
  await vi.waitFor(() => expect(m.all('files-error')).toHaveLength(1))
  expect(m.all('library-file')).toHaveLength(60)
  expect(s.library.page.value?.totalFiles).toBe(80)
  expect(m.all('files-stale')).toHaveLength(1)
  fail = false
  m.q('files-refresh').click()
  await vi.waitFor(() => expect(m.all('files-stale')).toHaveLength(0))
  m.q('files-more').click()
  await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(80))
})

it('uses latest-open-wins through slow reads and refuses an old workspace popup', async () => {
  const { s, m } = await ready()
  const answers = new Map<string, (reading: ResourceReading) => void>()
  s.readResource.mockImplementation(
    (resourceId) => new Promise<ResourceReading>((resolve) => answers.set(resourceId, resolve)),
  )
  const rows = m
    .all('library-file')
    .filter(
      (element) =>
        s.fixture.keeps.find((keep) => keep.resourceId === element.dataset.document)?.form ===
        'markdown',
    )
  const first = rows[0]!,
    second = rows[1]!,
    a = first.dataset.document!,
    b = second.dataset.document!
  const reading = (resourceId: string): ResourceReading => ({
    ok: true,
    resourceId,
    form: 'markdown',
    name: `${resourceId}.md`,
    bytes: 1,
    text: '# Fictional slow read',
  })
  first.click()
  await vi.waitFor(() => expect(answers.has(a)).toBe(true))
  second.click()
  await vi.waitFor(() => expect(answers.has(b)).toBe(true))
  answers.get(b)!(reading(b))
  await vi.waitFor(() => expect(m.all('canonical-document-viewer')).toHaveLength(1))
  answers.get(a)!(reading(a))
  await nextTick()
  expect(text(m.q('canonical-document-id'))).toBe(b)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await nextTick()
  first.click()
  await vi.waitFor(() => expect(s.readResource).toHaveBeenCalledTimes(3))
  s.workspace.value = 'another-workspace'
  await nextTick()
  answers.get(a)!(reading(a))
  await nextTick()
  await nextTick()
  expect(m.all('canonical-document-viewer')).toHaveLength(0)
  expect(s.library.opened.value).toBeNull()
})

it('traps keyboard focus in the descriptive popup, leaves slash there, and enters an exact task from provenance', async () => {
  const { s, m } = await ready()
  const target = m
    .all('library-file')
    .find(
      (element) =>
        s.fixture.keeps.find((keep) => keep.resourceId === element.dataset.document)?.form ===
        'markdown',
    )!
  target.focus()
  target.click()
  await vi.waitFor(() => expect(m.all('canonical-document-viewer')).toHaveLength(1))
  const overlay = m.q('overlay-host')
  const stops = [
    ...overlay.querySelectorAll<HTMLElement>('button,summary,input,select,[tabindex="0"]'),
  ].filter((element) => element.offsetParent !== null)
  stops[0]!.focus()
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }),
  )
  expect(document.activeElement).toBe(stops.at(-1))
  stops.at(-1)!.focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }))
  expect(document.activeElement).toBe(stops[0])
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }))
  expect(document.activeElement).not.toBe(m.q('files-search'))
  m.q('files-provenance').querySelector('summary')!.click()
  await nextTick()
  const placement = m.q('files-placement'),
    file = s.library.provenance.value!.keeps[0]!.file
  placement.querySelector('button')!.click()
  await vi.waitFor(() => expect(m.all('canonical-document-viewer')).toHaveLength(0))
  expect(s.library.state.scope).toMatchObject({
    type: 'task',
    id: file.piece,
    includeSubtasks: false,
  })
  expect(document.activeElement).toBe(m.q('files-search'))
})

it('gives different content with the same title distinct accessible names and draws unknown forms honestly', async () => {
  const { s, m } = await ready()
  const duplicate = m
    .all('library-file')
    .filter(
      (element) =>
        element.querySelector('.file-title')?.textContent ===
        'Unfinished-session warning and enabled Send',
    )
  expect(duplicate).toHaveLength(2)
  expect(duplicate[0]!.getAttribute('aria-label')).not.toBe(
    duplicate[1]!.getAttribute('aria-label'),
  )
  const original = s.library.page.value!.files[0]!
  s.library.page.value = {
    ...s.library.page.value!,
    files: [{ ...original, file: { ...original.file, form: null, name: 'unknown.data' } }],
  }
  await nextTick()
  expect(m.q('library-file').querySelector('.glyph')?.getAttribute('data-kind')).toBe('unknown')
  expect(text(m.q('library-file').querySelector('.glyph')!)).toBe('?')
})

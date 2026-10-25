import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import FilesLibraryPreview from '../../src/renderer/src/components/FilesLibraryPreview.vue'
import {
  createFilesLibrary,
  provideFilesLibrary,
  type FilesLibraryController,
  type LibraryApi,
} from '../../src/renderer/src/composables/useFilesLibrary'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { filesLibraryReplies } from '../fixtures/files-library-replies'
import type { FilesLibraryResult } from '../../src/shared/files-library'
import { mount, paneProps, record, unmountAll, visible } from './harness'

// Standalone legacy list and work-search checks remain in legacy-kept-file-lists.dom.test.ts.
// This suite exercises the workspace library through the actual conversation pane.
afterEach(() => {
  unmountAll()
  useWhoCalledWhom().treeFiles.value = null
  useWhoCalledWhom().cardFiles.value = null
})

async function pane(read?: LibraryApi) {
  await page.viewport(1180, 880)
  const fixture = filesLibraryReplies()
  const selected = shallowRef({ id: 'brobot', name: 'CODEX interim' })
  const shown = shallowRef(record([], 'brobot'))
  let library!: FilesLibraryController
  const component = defineComponent({
    setup() {
      library = createFilesLibrary({
        read: read ?? fixture.read,
        workspace: () => 'fictional',
        selected: () => selected.value,
      })
      provideFilesLibrary(library)
      return () =>
        h('div', { style: 'display:flex;flex:1;min-width:0;min-height:0' }, [
          h(
            ConversationPane,
            paneProps({
              record: shown.value,
              onReadResource: async (resourceId: string) => ({
                ok: true,
                resourceId,
                form: 'markdown',
                name: 'fictional.md',
                bytes: 1,
                text: '# Fictional document',
              }),
            }),
          ),
          h(FilesLibraryPreview, {
            library,
            workspace: 'fictional',
            read: async (resourceId: string) => ({
              ok: true as const,
              resourceId,
              form: 'markdown' as const,
              name: 'fictional.md',
              bytes: 1,
              text: '# Fictional document',
            }),
          }),
        ])
    },
  })
  const m = mount(component, {}, { width: 1180, height: 880 })
  m.q('main-tab-files').click()
  await nextTick()
  return {
    m,
    selected,
    shown,
    get library() {
      return library
    },
    fixture,
  }
}

it('counts the complete workspace independently of the selected conversation tree', async () => {
  const { m } = await pane()
  await vi.waitFor(() => expect(m.q('main-tab-files-count').textContent).toContain('16'))
  expect(m.all('library-file')).toHaveLength(16)
  useWhoCalledWhom().treeFiles.value = { conversation: 'brobot', files: [], answered: true }
  await nextTick()
  expect(m.q('main-tab-files-count').textContent).toContain('16')
  expect(m.all('library-file')).toHaveLength(16)
})

it('draws no zero count before the first complete worker reading', async () => {
  let resolve!: (result: FilesLibraryResult) => void
  const fixture = filesLibraryReplies()
  const { m } = await pane(
    () =>
      new Promise<FilesLibraryResult>((done) => {
        resolve = done
      }),
  )
  expect(m.all('main-tab-files-count')).toHaveLength(0)
  expect(m.all('files-empty')).toHaveLength(0)
  resolve(
    await fixture.read({
      operation: 'query',
      query: { scope: { type: 'workspace' }, query: '', kind: 'all', role: 'all', sort: 'newest' },
    }),
  )
  await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(16))
  expect(m.q('main-tab-files-count').textContent).toContain('16')
})

it('preserves library filters, loaded files, view and a pinned conversation across rail and tab changes', async () => {
  const { m, library, shown, selected } = await pane()
  await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(16))
  m.q('files-scope-conversation').click()
  await vi.waitFor(() => expect(library.page.value?.totalFiles).toBe(11))
  library.state.view = 'list'
  library.state.role = 'input'
  library.state.includeSubtasks = false
  await vi.waitFor(() => expect(library.page.value?.totalFiles).toBe(3))
  const ids = m.all('library-file').map((one) => one.dataset.document)
  shown.value = record([], 'promo')
  selected.value = { id: 'promo', name: 'Promotion' }
  await nextTick()
  expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
  expect(m.q('files-scope-conversation').textContent).toContain('CODEX interim')
  expect(m.all('library-file').map((one) => one.dataset.document)).toEqual(ids)
  m.q('main-tab-conversation').click()
  await nextTick()
  expect(visible(m.q('conversation-files'))).toBe(false)
  m.q('main-tab-files').click()
  await nextTick()
  expect(library.state).toMatchObject({ view: 'list', role: 'input', includeSubtasks: false })
  expect(m.all('library-file').map((one) => one.dataset.document)).toEqual(ids)
})

it('opens a library representative directly without recovering it from old tree/card arrays', async () => {
  const { m, library, shown, selected } = await pane()
  await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(16))
  expect(useWhoCalledWhom().treeFiles.value).toBeNull()
  expect(useWhoCalledWhom().cardFiles.value).toBeNull()
  const item = m
    .all('library-file')
    .find(
      (one) =>
        library.page.value!.files.find((group) => group.file.resourceId === one.dataset.document)!
          .file.form === 'markdown',
    )!
  const id = item.dataset.document
  item.click()
  await vi.waitFor(() => expect(m.all('canonical-document-viewer')).toHaveLength(1))
  expect(m.q('canonical-document-id').textContent).toBe(id)
  expect(m.q('canonical-document-title').textContent).toBe(library.opened.value!.file.title)
  shown.value = record([], 'promo')
  selected.value = { id: 'promo', name: 'Promotion' }
  await nextTick()
  expect(m.all('canonical-document-viewer')).toHaveLength(1)
})

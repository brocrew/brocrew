import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import {
  createFilesLibrary,
  provideFilesLibrary,
  type FilesLibraryController,
} from '../../src/renderer/src/composables/useFilesLibrary'
import { keptFileLibraryReplies } from '../fixtures/kept-file-library-replies'
import type { KeptFile, AgentIdentity } from '../../src/shared/runtime-ipc'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

afterEach(async () => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.treeFiles.value = null
  cast.goTo.value = null
  await page.viewport(1200, 808)
})

const ID = META.sessionId
const IDS = [
  ['brobot', 'BroBot'],
  ['project-manager', 'Ada'],
  ['inspector', 'Ana'],
  ['dev', 'Arjun'],
].map(([slug, displayName]) => ({
  id: `aid:${slug!}`,
  slug,
  displayName,
})) as unknown as AgentIdentity[]

const FOREST = () =>
  viewOf(
    [
      conv('sess_boss', null, { identity: 'brobot' }),
      conv(ID, 'sess_boss', { identity: 'project-manager' }),
      conv('sess_ana', ID, { identity: 'inspector' }),
      conv('sess_arjun', ID, { identity: 'dev' }),
      task('sess_ana', 'work_1', 'W1.1', 'Inspect the window states', ID),
      task('sess_arjun', 'work_2', 'W1.2', 'Fix the rail row', ID),
    ],
    IDS,
  )

const kept = (resourceId: string, piece: string, label: string, bytes: string): KeptFile => ({
  resourceId,
  title: resourceId,
  name: `${resourceId}.md`,
  form: 'markdown',
  bytes: 10,
  role: 'made',
  keptAt: 1,
  sha256: bytes.repeat(64),
  addedBy: null,
  piece,
  label,
  pieceTitle: null,
})

/** ⚑ W1.1 holds two files and a second copy of one of them: two distinct. W1.2 holds none. */
const FILES = [
  kept('res_a', 'work_1', 'W1.1', 'a'),
  kept('res_b', 'work_1', 'W1.1', 'b'),
  kept('res_b2', 'work_1', 'W1.1', 'b'),
]

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

async function graph(files: readonly KeptFile[] | null, over: Record<string, unknown> = {}) {
  useWhoCalledWhom().treeFiles.value =
    files === null ? null : { conversation: ID, files, answered: true }
  await page.viewport(1200, 808)
  const shown = shallowRef(record([], ID))
  let library!: FilesLibraryController
  const component = defineComponent({
    setup() {
      library = createFilesLibrary({
        read: keptFileLibraryReplies(() => files ?? []),
        workspace: () => 'fictional',
        selected: () => ({ id: shown.value.sessionId, name: 'Selected conversation' }),
      })
      provideFilesLibrary(library)
      return () =>
        h(
          ConversationPane,
          paneProps({
            record: shown.value,
            forest: FOREST(),
            identities: IDS,
            onReadResource: async () => ({ ok: false, reason: 'no-store' }),
            ...over,
          }),
        )
    },
  })
  const m = mount(component, {}, { width: 1200, height: 808 })
  await nextTick()
  m.q('main-tab-graph').click()
  await forestDrawn()
  return Object.assign(m, { library, shown })
}
const line = (m: Mounted, piece: string): HTMLElement => m.q('forest-row-' + piece)

describe('Graph file counts retain their own scope and explicitly enter the workspace library', () => {
  it('🔴 a task line with files shows their distinct count, as a press that says what it opens — one with none shows nothing', async () => {
    const m = await graph(FILES)
    const count = line(m, 'work_1').querySelector<HTMLElement>('[data-cy="forest-task-files"]')!
    expect(count).not.toBeNull()
    expect(count.tagName).toBe('BUTTON')
    expect(read(count)).toBe('2')
    expect(count.getAttribute('title')).toBe('Show the 2 files kept on W1.1')
    expect(count.getAttribute('aria-label')).toBe('Show the 2 files kept on W1.1')
    expect(visible(count)).toBe(true)
    // ⛔ The pair on the same mount: W1.2 holds none, and draws its line with no count.
    const bare = line(m, 'work_2')
    expect(read(bare.querySelector('[data-cy="forest-task-number"]')!)).toBe('W1.2')
    expect(bare.querySelector('[data-cy="forest-task-files"]')).toBeNull()
    // ⛔ The line itself stays words: only the count is a press.
    const words = line(m, 'work_1').querySelector<HTMLElement>('[data-cy="forest-task"]')!
    expect(words.tagName).toBe('SPAN')
    expect(words.closest('button')).toBeNull()
  })
  it('⛔ with the tree not read, no line counts anything — its task lines still draw', async () => {
    const m = await graph(null)
    expect(m.all('forest-task-files')).toHaveLength(0)
    expect(read(line(m, 'work_1').querySelector('[data-cy="forest-task-number"]')!)).toBe('W1.1')
  })

  it('a Graph count enters the exact task with subtasks off and clears query/kind/role while retaining view/sort', async () => {
    const band: string[] = [],
      opened: string[] = []
    useWhoCalledWhom().goTo.value = (id) => opened.push(id)
    const m = await graph([...FILES, kept('res_c', 'work_9', 'W1.9', 'c')], {
      'onUpdate:drawerTab': (tab: string) => band.push(tab),
      onToggleDrawer: () => band.push('toggle'),
    })
    m.library.state.query = 'needle'
    m.library.state.kind = 'images'
    m.library.state.role = 'input'
    m.library.state.view = 'list'
    m.library.state.sort = 'name'
    line(m, 'work_1').querySelector<HTMLElement>('[data-cy=forest-task-files]')!.click()
    await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(2))
    expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
    expect(m.library.state).toMatchObject({
      scope: { type: 'task', id: 'work_1' },
      includeSubtasks: false,
      query: '',
      kind: 'all',
      role: 'all',
      view: 'list',
      sort: 'name',
    })
    expect(m.library.page.value).toMatchObject({ totalFiles: 2, totalKeeps: 3 })
    expect(m.all('library-file').some((el) => el.dataset.document === 'res_c')).toBe(false)
    expect(band).toEqual([])
    expect(opened).toEqual([])
  })
  it('a shared hash kept on another task opens that exact placement and remains pinned across rail and tab changes', async () => {
    const m = await graph([
      kept('res_a', 'work_1', 'W1.1', 'a'),
      { ...kept('res_a2', 'work_2', 'W1.2', 'a'), keptAt: 2 },
    ])
    line(m, 'work_2').querySelector<HTMLElement>('[data-cy=forest-task-files]')!.click()
    await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(1))
    expect(m.q('library-file').dataset.document).toBe('res_a2')
    m.shown.value = record([], 'sess_ana')
    await nextTick()
    expect(m.library.state.scope).toMatchObject({ type: 'task', id: 'work_2' })
    expect(m.q('library-file').dataset.document).toBe('res_a2')
    m.q('main-tab-conversation').click()
    await nextTick()
    m.q('main-tab-files').click()
    await nextTick()
    expect(m.library.state.scope).toMatchObject({ id: 'work_2' })
    expect(m.q('library-file').dataset.document).toBe('res_a2')
  })
  it('the current conversation root keeps its legacy Graph count and enters the exact root task', async () => {
    const m = await graph([kept('res_r', 'work_root', 'W1', 'f'), ...FILES])
    const mine = m.q('forest-row-' + ID).querySelector<HTMLElement>('[data-cy=forest-root-files]')!
    expect(read(mine)).toBe('1')
    expect(mine.title).toBe('Show the file kept on W1')
    expect(m.q('forest-row-sess_boss').querySelector('[data-cy=forest-root-files]')).toBeNull()
    mine.click()
    await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(1))
    expect(m.library.state.scope).toMatchObject({
      type: 'task',
      id: 'work_root',
      includeSubtasks: false,
    })
    expect(m.q('library-file').dataset.document).toBe('res_r')
  })

  it('⛔ the Team page is handed no counts, and draws none — the same forest with counts does', async () => {
    const team = mount(TeamForest, { view: FOREST() }, { width: 1100, height: 700 })
    await forestDrawn()
    expect(read(team.q('forest-row-work_1').querySelector('[data-cy="forest-task-number"]')!)).toBe(
      'W1.1',
    )
    expect(team.all('forest-task-files')).toHaveLength(0)
    unmountAll()
    const counted = mount(
      TeamForest,
      { view: FOREST(), fileCounts: new Map([['work_1', 2]]) },
      { width: 1100, height: 700 },
    )
    await forestDrawn()
    expect(read(counted.q('forest-task-files'))).toBe('2')
  })
})

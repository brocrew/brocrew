import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import ConversationMain from '../../src/renderer/src/components/ConversationMain.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { KeptFile, AgentIdentity } from '../../src/shared/runtime-ipc'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⚑ A piece on the Graph tab counts its files, and the count opens the Files tab there
 *
 * A graph piece with files shows a small count opening the files tab at that piece. Count
 * distinct files in tree scope through `TheCast.treeFiles`.
 *
 * ⚑ **What is pinned here**: a task line with files shows their count, as a press that says what
 * it opens, and one with none shows nothing; the task line itself stays words; a press opens the
 * Files tab on All with that piece's group marked and in view; a tab chosen by hand
 * marks nothing; and the Team page, which is handed no counts, draws none.
 *
 * ⛔ **Every negative here is paired with the same mount one fact over** — a piece with files and
 * one without, the tree read and not — because a graph that drew no count at all would pass.
 */

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

async function graph(
  files: readonly KeptFile[] | null,
  over: Record<string, unknown> = {},
): Promise<Mounted> {
  useWhoCalledWhom().treeFiles.value =
    files === null ? null : { conversation: ID, files, answered: true }
  await page.viewport(1200, 808)
  const m = mount(
    ConversationPane,
    paneProps({
      forest: FOREST(),
      identities: IDS,
      onReadResource: async () => ({ ok: false, reason: 'no-store' }),
      ...over,
    }),
    { width: 1200, height: 808 },
  )
  await nextTick()
  m.q('main-tab-graph').click()
  await forestDrawn()
  return m
}

const line = (m: Mounted, piece: string): HTMLElement => m.q(`forest-row-${piece}`)

describe('a piece on the Graph tab counts its files', () => {
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

  it('🔴 a press opens the Files tab at that piece — its group marked, on All — and is not a card press', async () => {
    const band: string[] = []
    const opened: string[] = []
    useWhoCalledWhom().goTo.value = (conversation) => opened.push(conversation)
    const m = await graph([...FILES, kept('res_c', 'work_9', 'W1.9', 'c')], {
      'onUpdate:drawerTab': (tab: string) => band.push(`tab:${tab}`),
      onToggleDrawer: () => band.push('toggle'),
    })
    // ⚑ The positive on the same mount: a CARD's press selects its agent and shows its card in the
    // right panel — the spies see both.
    m.q('forest-row-sess_ana').querySelector<HTMLElement>('[data-cy="forest-open"]')!.click()
    await nextTick()
    expect(band).toEqual(['tab:open', 'toggle'])
    expect(opened).toEqual(['sess_ana'])
    band.length = 0
    line(m, 'work_1').querySelector<HTMLElement>('[data-cy="forest-task-files"]')!.click()
    await nextTick()
    await nextTick()
    expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
    expect(visible(m.q('conversation-files'))).toBe(true)
    const groups = m.all('tree-file-group')
    const marked = groups.filter((group) => group.classList.contains('marked'))
    expect(marked.map((group) => group.dataset.piece)).toEqual(['work_1'])
    expect(marked[0]!.getAttribute('aria-current')).toBe('location')
    // ⚑ The pair: the other piece's group is drawn, unmarked.
    const other = groups.find((group) => group.dataset.piece === 'work_9')!
    expect(other.classList.contains('marked')).toBe(false)
    expect(other.getAttribute('aria-current')).toBeNull()
    expect(m.q('tree-files-filter-all').getAttribute('aria-pressed')).toBe('true')
    // ⛔ A count is not a card: the right panel was not shown, and no agent is selected.
    expect(band).toEqual([])
    expect(opened).toEqual(['sess_ana'])
  })

  it('🔴 a press on a piece whose files stand on another piece’s row marks its mention there, in view', async () => {
    const opened: unknown[][] = []
    // ⚑ W1.1 and W1.2 kept the same bytes; the row stands on W1.1, which kept them first.
    const m = await graph(
      [
        { ...kept('res_a', 'work_1', 'W1.1', 'a'), keptAt: 1 },
        { ...kept('res_a2', 'work_2', 'W1.2', 'a'), keptAt: 2 },
      ],
      { onOpenConversation: (...args: unknown[]) => opened.push(args) },
    )
    line(m, 'work_2').querySelector<HTMLElement>('[data-cy="forest-task-files"]')!.click()
    await nextTick()
    await nextTick()
    expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
    expect(m.all('tree-file-group').map((group) => group.dataset.piece)).toEqual(['work_1'])
    const mention = m.q('tree-file-also-piece')
    expect(mention.dataset.piece).toBe('work_2')
    expect(mention.classList.contains('marked')).toBe(true)
    expect(mention.getAttribute('aria-current')).toBe('location')
    expect(visible(mention)).toBe(true)
    // ⚑ The pair: a press on W1.1 marks its group, and the mention is no longer marked.
    m.q('main-tab-graph').click()
    await forestDrawn()
    line(m, 'work_1').querySelector<HTMLElement>('[data-cy="forest-task-files"]')!.click()
    await nextTick()
    await nextTick()
    expect(m.q('tree-file-group').classList.contains('marked')).toBe(true)
    expect(m.q('tree-file-also-piece').classList.contains('marked')).toBe(false)
    // ⚑ The mention opens the conversation the forest says holds W1.2, though a person kept it.
    m.q('tree-file-also-piece').click()
    await nextTick()
    expect(opened).toEqual([['sess_arjun', 'W1.2']])
  })

  it('🔴 the files on this conversation’s own root are counted on its card — a root is never a task line', async () => {
    const band: string[] = []
    const opened: string[] = []
    useWhoCalledWhom().goTo.value = (conversation) => opened.push(conversation)
    const m = await graph([kept('res_r', 'work_root', 'W1', 'r'), ...FILES], {
      'onUpdate:drawerTab': (tab: string) => band.push(`tab:${tab}`),
      onToggleDrawer: () => band.push('toggle'),
    })
    const mine = m
      .q(`forest-row-${ID}`)
      .querySelector<HTMLElement>('[data-cy="forest-root-files"]')!
    expect(mine).not.toBeNull()
    expect(read(mine)).toBe('1')
    expect(mine.getAttribute('title')).toBe('Show the file kept on W1')
    // ⛔ The pair on the same mount: another conversation's card draws no root count.
    expect(read(m.q('forest-row-sess_boss').querySelector('[data-cy="forest-name"]')!)).toBe(
      'BroBot',
    )
    expect(m.q('forest-row-sess_boss').querySelector('[data-cy="forest-root-files"]')).toBeNull()
    mine.click()
    await nextTick()
    await nextTick()
    const marked = m.all('tree-file-group').filter((group) => group.classList.contains('marked'))
    expect(marked.map((group) => group.dataset.piece)).toEqual(['work_root'])
    // ⛔ A count is not a card: the right panel was not shown, and no agent is selected.
    expect(band).toEqual([])
    expect(opened).toEqual([])
  })

  it('⚑ a piece marked on one conversation’s work is not marked on the next — the tab stays on Files', async () => {
    const shown = shallowRef({ conversation: ID, files: FILES as readonly KeptFile[] })
    const m = mount(
      defineComponent({
        setup: () => () =>
          h(ConversationMain, {
            conversation: shown.value.conversation,
            forest: FOREST(),
            files: {
              conversation: shown.value.conversation,
              files: shown.value.files,
              answered: true,
            },
            canOpenDocument: true,
          }),
      }),
      {},
      { width: 1200, height: 808 },
    )
    await nextTick()
    m.q('main-tab-graph').click()
    await forestDrawn()
    line(m, 'work_1').querySelector<HTMLElement>('[data-cy="forest-task-files"]')!.click()
    await nextTick()
    await nextTick()
    expect(
      m.all('tree-file-group').filter((group) => group.classList.contains('marked')),
    ).toHaveLength(1)
    // ⚑ Another conversation, whose own tree holds the same piece.
    shown.value = { conversation: 'sess_ana', files: FILES }
    await nextTick()
    await nextTick()
    expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
    expect(m.all('tree-file-group').map((group) => group.dataset.piece)).toEqual(['work_1'])
    expect(
      m.all('tree-file-group').filter((group) => group.classList.contains('marked')),
    ).toHaveLength(0)
  })

  it('🔴 the piece it opens at is brought into view — the tab would otherwise open at its top', async () => {
    // ⚑ Thirty pieces kept above W1.2's in the door's order: its group starts far below the fold.
    const above = Array.from({ length: 30 }, (_, index) =>
      kept(
        `res_f${String(index)}`,
        `work_f${String(index)}`,
        `W1.1.${String(index + 1)}`,
        `${index % 10}`,
      ),
    )
    const m = await graph([...FILES, ...above, kept('res_z', 'work_2', 'W1.2', 'z')])
    line(m, 'work_2').querySelector<HTMLElement>('[data-cy="forest-task-files"]')!.click()
    await nextTick()
    await nextTick()
    await new Promise((done) => requestAnimationFrame(() => done(null)))
    const box = m.q('tree-files').getBoundingClientRect()
    const target = m.all('tree-file-group').find((group) => group.dataset.piece === 'work_2')!
    const at = target.getBoundingClientRect()
    expect(at.top).toBeGreaterThanOrEqual(box.top - 0.5)
    expect(at.bottom).toBeLessThanOrEqual(box.bottom + 0.5)
    // ⚑ The pair on the same mount: the first group has scrolled out above.
    const first = m.all('tree-file-group')[0]!.getBoundingClientRect()
    expect(first.bottom).toBeLessThan(box.top)
  })

  it('⚑ a tab chosen by hand marks nothing — a count pressed again marks its piece again', async () => {
    const m = await graph(FILES)
    line(m, 'work_1').querySelector<HTMLElement>('[data-cy="forest-task-files"]')!.click()
    await nextTick()
    await nextTick()
    expect(
      m.all('tree-file-group').filter((group) => group.classList.contains('marked')),
    ).toHaveLength(1)
    m.q('main-tab-conversation').click()
    await nextTick()
    m.q('main-tab-files').click()
    await nextTick()
    await nextTick()
    const groups = m.all('tree-file-group')
    expect(groups.map((group) => group.dataset.piece)).toEqual(['work_1'])
    expect(groups.filter((group) => group.classList.contains('marked'))).toHaveLength(0)
    m.q('main-tab-graph').click()
    await forestDrawn()
    line(m, 'work_1').querySelector<HTMLElement>('[data-cy="forest-task-files"]')!.click()
    await nextTick()
    await nextTick()
    expect(
      m.all('tree-file-group').filter((group) => group.classList.contains('marked')),
    ).toHaveLength(1)
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

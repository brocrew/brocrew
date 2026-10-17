import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import TreeFiles from '../../src/renderer/src/components/TreeFiles.vue'
import WorkSearchDialog from '../../src/renderer/src/components/WorkSearchDialog.vue'
import type { WorkSearchResult } from '../../src/shared/work-search'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { fullTime } from '../../src/renderer/src/lib/clock'
import { FILES_DID_NOT_ANSWER, NONE_UNDER } from '../../src/renderer/src/lib/files-kept'
import { clockTime } from '../../src/shared/clock'
import type { FilesRead } from '../../src/renderer/src/lib/files-kept'
import type { KeptFile, ResourceReading } from '../../src/shared/runtime-ipc'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⚑ The Files tab lists every file on the work, and on all of it under
 *
 * The Files tab beside Conversation and Graph lists every file in this conversation's tree.
 * The screen reads the filesKept tree scope into TheCast.treeFiles; TreeFiles groups the result
 * by piece in tree order.
 *
 * ⚑ **What is pinned here**: the tab and its count of distinct files; the pieces in tree order,
 * each set in under the one above it; one full row per file — its title, *made* or *input*, who
 * kept it and when, once per set of bytes, with the other pieces that kept them named under it,
 * each opening where it was kept; the All, Made and Inputs filters; a press
 * that opens the file in the pane's one viewer, and plain words where nothing can open one; the
 * tree's files for THIS conversation only; *not read*, a real zero and a kept list, each said;
 * and a title longer than its line cut and told whole.
 *
 * ⛔ **Every negative here is paired with the same mount one fact over** — this conversation's
 * files and another's, a reader and none, a read that answered and none — because a tab that drew
 * nothing at all would pass every absence.
 */

afterEach(async () => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.treeFiles.value = null
  cast.cardFiles.value = null
  cast.reading.value = null
  await page.viewport(1200, 808)
})

const T = (hour: number, minute: number): number => new Date(2026, 8, 30, hour, minute).getTime()

let made = 0
const kept = (
  label: string,
  pieceTitle: string,
  title: string,
  role: 'made' | 'input',
  who: string | null,
  at: number,
  bytes: string,
): KeptFile => ({
  resourceId: `res_${label}_${String(made++)}`,
  title,
  name: `${title.slice(0, 12).replace(/\W+/g, '-').toLowerCase()}.md`,
  form: 'markdown',
  bytes: 2_048,
  role,
  keptAt: at,
  sha256: bytes.repeat(64),
  addedBy: who === null ? null : { conversation: `sess_${who}`, name: who, identity: who },
  piece: `work_${label}`,
  label,
  pieceTitle,
})

/**
 * ⚑ **`07`'s own tree, in the door's order** — seven keeps, five files: BroBot kept W1.3's results
 * again on W1, and Ana's reply handed Ali's findings up from W1.10.1 to W1.10.
 */
const TREE = (): readonly KeptFile[] => {
  made = 0
  return [
    kept(
      'W1',
      'BroBot2: test it from inside',
      'Testing the tree: results',
      'made',
      'BroBot',
      T(19, 50),
      'a',
    ),
    kept(
      'W1.3',
      'Test the tree after the reset',
      'Testing the tree: results',
      'made',
      'BroBot',
      T(19, 44),
      'a',
    ),
    kept('W1.3.1', 'Test 2 and 5', 'Input for test 2 and 5', 'input', 'BroBot', T(19, 34), 'b'),
    kept('W1.3.1', 'Test 2 and 5', 'W1.3.1 result', 'made', 'Ada', T(19, 35), 'c'),
    kept('W1.9', 'List the open findings', 'Open findings', 'made', null, T(2, 27), 'd'),
    kept(
      'W1.10',
      'Have your Ali list the fixed findings',
      'Fixed findings',
      'made',
      'Ana',
      T(2, 29),
      'e',
    ),
    kept('W1.10.1', 'List the fixed findings', 'Fixed findings', 'made', 'Ali', T(2, 28), 'e'),
  ]
}

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ The door ECHOES the id it was asked for, so the viewer says which file the press sent. */
const OPENS = async (resourceId: string): Promise<ResourceReading> => ({
  ok: true,
  form: 'markdown',
  resourceId,
  name: `${resourceId}.md`,
  text: '# Findings',
  bytes: 10,
})

/** ⚑ The pane, with the tree read for `forConversation`, on its Files tab. */
async function pane(
  files: readonly KeptFile[] | null,
  over: Record<string, unknown> = {},
  forConversation: string = META.sessionId,
  answered = true,
): Promise<Mounted> {
  useWhoCalledWhom().treeFiles.value =
    files === null ? null : { conversation: forConversation, files, answered }
  await page.viewport(1200, 808)
  const m = mount(ConversationPane, paneProps({ onReadResource: OPENS, ...over }), {
    width: 1180,
    height: 780,
  })
  m.q('main-tab-files').click()
  await drawnReady()
  return m
}

const groupsOf = (m: Mounted): HTMLElement[] => m.all('tree-file-group')

describe('the Files tab lists every file on the work', () => {
  it('search reads only on a gesture, keeps partial reads visible and opens the existing work', async () => {
    const hit = {
      kind: 'piece' as const,
      piece: 'work_hit',
      label: 'W1.1',
      title: 'Review',
      state: 'answered' as const,
      owner: { conversation: 'sess_worker', name: 'Ada', profile: 'ada' },
      giver: null,
      result: { outcome: 'done' as const, summary: 'Reviewed.' },
      status: null,
      resource_ids: { brief: [], result: [], attachments: [], working: [] },
      clipped: { title: false, result: false, status: false },
      resources_omitted: 0,
    }
    const search = vi.fn().mockResolvedValue({
      ok: true,
      page: {
        hits: [hit],
        searched: 2,
        rows_unread: 1,
        ledgers_skipped: 0,
        complete: false,
        next_cursor: 'next',
      },
    })
    const opened = vi.fn()
    const m = mount(
      WorkSearchDialog,
      { conversation: META.sessionId, search, canOpen: true, onOpenWork: opened },
      { width: 900, height: 700 },
    )
    await drawnReady()
    expect(search).not.toHaveBeenCalled()
    expect(m.all('work-search-empty')).toHaveLength(0)
    m.q('work-search-submit').click()
    await vi.waitFor(() => expect(m.all('work-search-hit')).toHaveLength(1))
    expect(search).toHaveBeenCalledWith({ scope: 'this-conversation', words: '', limit: 20 })
    expect(read(m.q('work-search-unread'))).toBe('Some work could not be read.')
    expect(read(m.q('work-search-older'))).toBe('Older work has not been searched yet.')
    m.q('work-search-more').click()
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(search.mock.calls[1]?.[0]).toMatchObject({ cursor: 'next', scope: 'this-conversation' })
    m.all('work-search-hit')[0]!.click()
    expect(opened).toHaveBeenCalledWith(hit)
  })

  it('keeps hits readable without drawing a press when no work opener is available', async () => {
    await page.viewport(400, 700)
    const hit = {
      kind: 'piece' as const,
      piece: 'work_readonly',
      label: 'W1.2',
      title: 'Read-only hit',
      state: 'answered' as const,
      owner: { conversation: 'sess_worker', name: 'Ada', profile: 'ada' },
      giver: null,
      result: null,
      status: null,
      resource_ids: { brief: [], result: [], attachments: [], working: [] },
      clipped: { title: false, result: false, status: false },
      resources_omitted: 0,
    }
    const search = vi.fn().mockResolvedValue({
      ok: true,
      page: {
        hits: [hit],
        searched: 1,
        rows_unread: 0,
        ledgers_skipped: 0,
        complete: true,
        next_cursor: null,
      },
    })
    const opened = vi.fn()
    const m = mount(
      WorkSearchDialog,
      { conversation: META.sessionId, search, canOpen: false, onOpenWork: opened },
      { width: 380, height: 650 },
    )
    await drawnReady()
    m.q('work-search-submit').click()
    await vi.waitFor(() => expect(m.all('work-search-hit')).toHaveLength(1))
    expect(m.q('work-search-hit').tagName).toBe('DIV')
    expect(read(m.q('work-search-hit'))).toContain('Read-only hit')
    m.q('work-search-hit').click()
    expect(opened).not.toHaveBeenCalled()
    expect(m.q('work-search').scrollWidth).toBeLessThanOrEqual(m.q('work-search').clientWidth)
  })

  it('ignores a search response after the query changes', async () => {
    let answer: ((value: WorkSearchResult) => void) | undefined
    const search = vi.fn(
      () =>
        new Promise<WorkSearchResult>((resolve) => {
          answer = resolve
        }),
    )
    const m = mount(
      WorkSearchDialog,
      { conversation: META.sessionId, search, canOpen: false },
      { width: 900, height: 700 },
    )
    await drawnReady()
    m.q('work-search-submit').click()
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    const input = m.q('work-search-words') as HTMLInputElement
    input.value = 'new words'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    answer!({
      ok: true,
      page: {
        hits: [],
        searched: 1,
        rows_unread: 0,
        ledgers_skipped: 0,
        complete: true,
        next_cursor: null,
      },
    })
    await nextTick()
    expect(m.all('work-search-empty')).toHaveLength(0)
    expect(m.all('work-search-hits')).toHaveLength(0)
    m.q('work-search-submit').click()
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    const fresh = {
      kind: 'piece' as const,
      piece: 'work_fresh',
      label: 'W1.3',
      title: 'Fresh result',
      state: 'answered' as const,
      owner: { conversation: 'sess_worker', name: 'Ada', profile: 'ada' },
      giver: null,
      result: null,
      status: null,
      resource_ids: { brief: [], result: [], attachments: [], working: [] },
      clipped: { title: false, result: false, status: false },
      resources_omitted: 0,
    }
    answer!({
      ok: true,
      page: {
        hits: [fresh],
        searched: 1,
        rows_unread: 0,
        ledgers_skipped: 0,
        complete: true,
        next_cursor: null,
      },
    })
    await vi.waitFor(() => expect(m.all('work-search-hit')).toHaveLength(1))
    expect(m.q('work-search-hit').textContent).toContain('Fresh result')
  })
  it('shows host-supplied sections and a main result, each file once at its main keep', async () => {
    const files: KeptFile[] = [
      { ...kept('W1', 'Review', 'Brief document', 'input', null, 1, 'a'), group: 'brief' },
      { ...kept('W1', 'Review', 'Working copy', 'made', 'Ada', 2, 'a'), group: 'working' },
      {
        ...kept('W1', 'Review', 'Returned document', 'made', 'Ada', 3, 'a'),
        group: 'result',
        mainResult: true,
      },
      {
        ...kept('W1', 'Review', 'Picture', 'made', 'Ada', 4, 'b'),
        form: 'image',
        group: 'attachments',
      },
    ]
    const m = await pane(files)
    expect(m.all('tree-file-section-title').map(read)).toEqual(['Result', 'Attachments'])
    expect(read(m.q('tree-file-main-result'))).toBe('Main result')
    expect(m.all('tree-file').map((row) => read(row.querySelector('.file-title')!))).toEqual([
      'Returned document',
      'Picture',
    ])
    // ⚑ Every keep is on the same piece, so no other piece is named.
    expect(m.all('tree-file-also')).toHaveLength(0)
    m.q('tree-files-filter-input').click()
    await nextTick()
    expect(m.all('tree-file-section-title').map(read)).toEqual(['Brief'])
    expect(read(m.q('tree-file').querySelector('.file-title')!)).toBe('Brief document')
  })

  it('draws a file kept again as one row at text colour, and the pieces that also kept it muted', async () => {
    const files = [
      kept('W1', 'Review', 'Repeated file', 'made', 'Ada', 1, 'a'),
      kept('W1.1', 'Child', 'Repeated file', 'made', 'Ada', 2, 'a'),
    ]
    const m = await pane(files)
    expect(m.all('tree-file')).toHaveLength(1)
    const title = m.q('tree-file').querySelector<HTMLElement>('.file-title')!
    const also = m.q('tree-file-also')
    expect(read(title)).toBe('Repeated file')
    expect(read(also)).toBe('Also kept on W1.1.')
    const probe = document.createElement('span')
    title.parentElement!.append(probe)
    probe.style.color = 'var(--text)'
    expect(getComputedStyle(title).color).toBe(getComputedStyle(probe).color)
    probe.style.color = 'var(--muted)'
    expect(getComputedStyle(also).color).toBe(getComputedStyle(probe).color)
    probe.remove()
  })

  it('keeps the main-result marker visible beside a long title at a narrow width', async () => {
    await page.viewport(400, 700)
    const file: KeptFile = {
      ...kept('W1', 'Review', 'A very long result title '.repeat(10), 'made', 'Ada', 1, 'a'),
      group: 'result',
      mainResult: true,
    }
    const m = mount(
      TreeFiles,
      { read: { conversation: META.sessionId, files: [file], answered: true }, canOpen: true },
      { width: 380, height: 600 },
    )
    await drawnReady()
    assertDrawn(m.q('tree-file-main-result'), 'main result marker', m.host)
    expect(m.q('tree-files').scrollWidth).toBeLessThanOrEqual(m.q('tree-files').clientWidth)
  })

  it('omits an unread group heading without hiding the file, also at a narrow width', async () => {
    await page.viewport(400, 700)
    const file = kept('W1', 'Review', 'Membership unread', 'made', null, 1, 'a')
    const m = mount(
      TreeFiles,
      { read: { conversation: META.sessionId, files: [file], answered: true }, canOpen: true },
      { width: 380, height: 600 },
    )
    await drawnReady()
    expect(m.all('tree-file-section-title')).toHaveLength(0)
    expect(m.all('tree-file')).toHaveLength(1)
    expect(m.q('tree-file').textContent).toContain('Membership unread')
    expect(m.q('tree-files').scrollWidth).toBeLessThanOrEqual(m.q('tree-files').clientWidth)
  })
  it('🔴 a third tab, counted by distinct file — and no count before the tree has been read', async () => {
    const m = await pane(TREE())
    const tabs = [...m.q('main-tabs').querySelectorAll('[role="tab"]')].map((tab) => read(tab))
    expect(tabs).toEqual(['Conversation', 'Graph', 'Files (5)'])
    expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
    expect(visible(m.q('conversation-files'))).toBe(true)
    // ⛔ The conversation is hidden on the Files tab, never unmounted.
    expect(m.all('main-conversation')).toHaveLength(1)
    expect(visible(m.q('main-conversation'))).toBe(false)
    unmountAll()
    const unread = await pane(null)
    expect(read(unread.q('main-tab-files'))).toBe('Files')
    expect(unread.all('main-tab-files-count')).toHaveLength(0)
  })

  it('🔴 the pieces in tree order, each set in under the one above it — one full row per file', async () => {
    const m = await pane(TREE())
    const groups = groupsOf(m)
    // ⚑ W1.3 and W1.10.1 kept only files whose rows stand higher up, so they are not drawn.
    expect(groups.map((group) => read(group.querySelector('.label')!))).toEqual([
      'W1',
      'W1.3.1',
      'W1.9',
      'W1.10',
    ])
    expect(read(groups[1]!.querySelector('.piece-title')!)).toBe('Test 2 and 5')
    const left = (group: HTMLElement): number =>
      group.querySelector('.label')!.getBoundingClientRect().left
    expect(left(groups[1]!)).toBeGreaterThan(left(groups[0]!))
    expect(left(groups[2]!)).toBe(left(groups[1]!))
    expect(left(groups[3]!)).toBe(left(groups[1]!))

    // ⚑ Five files, each drawn in full once.
    const rows = m.all('tree-file')
    expect(rows).toHaveLength(5)
    const result = rows.find((row) => read(row).startsWith('W1.3.1 result'))!
    expect(read(result.querySelector('.file-title')!)).toBe('W1.3.1 result')
    expect(read(result.querySelector('.role')!)).toBe('made')
    expect(read(result.querySelector('.who')!)).toBe('Ada')
    expect(read(result.querySelector('.time')!)).toBe(clockTime(T(19, 35)))
    expect(result.querySelector('.time')!.getAttribute('title')).toBe(fullTime(T(19, 35)))
    const input = rows.find((row) => row.dataset.role === 'input')!
    expect(read(input.querySelector('.role')!)).toBe('input')
    // ⚑ A file a person added is *you*'s.
    const person = rows.find((row) => read(row).startsWith('Open findings'))!
    expect(read(person.querySelector('.who')!)).toBe('You')
    // ⚑ Oldest first within a piece, as the door answers.
    expect(
      [...groups[1]!.querySelectorAll('[data-cy="tree-file"] .file-title')].map((one) => read(one)),
    ).toEqual(['Input for test 2 and 5', 'W1.3.1 result'])
    // ⛔ Each row's own clippers are drawn whole at this width, and nothing runs off the list's edge
    // — a list that scrolls sideways would hide a column no clip sensor sees.
    const list = m.q('tree-files')
    expect(list.scrollWidth, 'the list scrolls sideways').toBeLessThanOrEqual(list.clientWidth)
    for (const row of rows) {
      for (const part of ['.file-title', '.who', '.time']) {
        const el = row.querySelector<HTMLElement>(part)!
        assertDrawn(el, `${part} of ${read(row)}`, m.host)
        expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(
          list.getBoundingClientRect().right + 0.5,
        )
      }
    }
  })

  it('🔴 the same bytes kept on several pieces: one row, naming the others, each opening where it was kept', async () => {
    const opened: unknown[][] = []
    const m = await pane(TREE(), { onOpenConversation: (...args: unknown[]) => opened.push(args) })
    const groups = groupsOf(m)
    const alsos = m.all('tree-file-also')
    expect(alsos.map(read)).toEqual(['Also kept on W1.3.', 'Also kept on W1.10.1.'])
    expect(groups[0]!.contains(alsos[0]!)).toBe(true)
    expect(groups[3]!.contains(alsos[1]!)).toBe(true)
    for (const also of alsos) assertDrawn(also, read(also), m.host)
    // ⚑ The row is the keep higher in the tree, with its own who.
    const fixed = groups[3]!.querySelector<HTMLElement>('[data-cy="tree-file"]')!
    expect(read(fixed.querySelector('.who')!)).toBe('Ana')
    // ⚑ Each piece named opens the conversation that kept the file there, at that piece.
    const piece = alsos[1]!.querySelector<HTMLElement>('[data-cy="tree-file-also-piece"]')!
    expect(piece.tagName).toBe('BUTTON')
    piece.click()
    await nextTick()
    expect(opened).toEqual([['sess_Ali', 'W1.10.1']])
  })

  it('⛔ a piece a person kept the file on is named, and opens nothing', async () => {
    const files = [
      kept('W2', 'Build', 'Shared plan', 'made', 'Ada', 2, 'p'),
      kept('W2.1', 'Part', 'Shared plan', 'input', null, 1, 'p'),
    ]
    const m = await pane(files)
    expect(read(m.q('tree-file-also'))).toBe('Also kept on W2.1.')
    expect(m.q('tree-file-also-piece').tagName).toBe('SPAN')
  })

  it('🔴 the same name with other bytes is another file, with its own row', async () => {
    const files = [
      { ...kept('W4', 'Two drafts', 'Notes', 'made', 'Ada', 1, 'm'), name: 'notes.md' },
      { ...kept('W4.1', 'Second draft', 'Notes', 'made', 'Ada', 2, 'n'), name: 'notes.md' },
    ]
    const m = await pane(files)
    expect(m.all('tree-file')).toHaveLength(2)
    expect(m.all('tree-file-also')).toHaveLength(0)
  })

  it('🔴 Made, Inputs and All — each line by its role, and a piece left with none drops', async () => {
    const m = await pane(TREE())
    m.q('tree-files-filter-input').click()
    await nextTick()
    expect(m.q('tree-files-filter-input').getAttribute('aria-pressed')).toBe('true')
    expect(groupsOf(m).map((group) => read(group.querySelector('.label')!))).toEqual(['W1.3.1'])
    expect(m.all('tree-file').map((row) => read(row.querySelector('.file-title')!))).toEqual([
      'Input for test 2 and 5',
    ])
    m.q('tree-files-filter-made').click()
    await nextTick()
    expect(m.all('tree-file').map((row) => row.dataset.role)).toEqual([
      'made',
      'made',
      'made',
      'made',
    ])
    expect(m.all('tree-file-also')).toHaveLength(2)
    m.q('tree-files-filter-all').click()
    await nextTick()
    expect(m.all('tree-file')).toHaveLength(5)
    expect(m.q('tree-files-filter-all').getAttribute('aria-pressed')).toBe('true')
  })

  it('⛔ a filter that leaves nothing says so under its pills — and the next conversation opens on All', async () => {
    // ⚑ A tree whose files all came back with replies: nothing was handed over as an input.
    const madeOnly = TREE().filter((one) => one.role === 'made')
    const m = await pane(madeOnly)
    m.q('tree-files-filter-input').click()
    await nextTick()
    expect(read(m.q('tree-files-none'))).toBe(NONE_UNDER.input)
    expect(groupsOf(m)).toHaveLength(0)
    expect(visible(m.q('tree-files-filter-all'))).toBe(true)
    // ⚑ The pair on the same mount: back to All, the files and no sentence.
    m.q('tree-files-filter-all').click()
    await nextTick()
    expect(m.all('tree-files-none')).toHaveLength(0)
    expect(m.all('tree-file')).toHaveLength(4)
  })

  it('🔴 a filter that hides the keep a row stands at draws the keep it shows, in full', async () => {
    // ⚑ BroBot made the bytes on W3 and handed them down to Ada's W3.1 as an input.
    const down = [
      kept('W3', 'Build it', 'The plan', 'made', 'BroBot', T(9, 0), 'h'),
      kept('W3.1', 'Do part one', 'The plan', 'input', 'BroBot', T(9, 5), 'h'),
    ]
    const m = mount(
      TreeFiles,
      { read: { conversation: META.sessionId, files: down, answered: true }, canOpen: true },
      { width: 900, height: 600 },
    )
    await drawnReady()
    // ⚑ The pair, same mount: under All the row is W3's, naming W3.1…
    expect(read(m.q('tree-file-also'))).toBe('Also kept on W3.1.')
    expect(m.q('tree-file').dataset.role).toBe('made')
    m.q('tree-files-filter-input').click()
    await nextTick()
    // ⛔ …under Inputs W3 is hidden, so the input is the row, with who and when.
    expect(m.all('tree-file-also')).toHaveLength(0)
    const row = m.q('tree-file')
    expect(row.dataset.role).toBe('input')
    expect(read(row.querySelector('.who')!)).toBe('BroBot')
    expect(read(row.querySelector('.time')!)).toBe(clockTime(T(9, 5)))
  })

  it('🔴 a piece named for an input opens the conversation holding it, never the giver that kept it', async () => {
    // ⚑ BroBot kept the input on Ada's W3.1: BroBot gave it, Ada holds that piece and its brief.
    const down = [
      kept('W3', 'Build it', 'The plan', 'made', 'BroBot', T(9, 0), 'h'),
      kept('W3.1', 'Do part one', 'The plan', 'input', 'BroBot', T(9, 5), 'h'),
    ]
    const blind = mount(
      TreeFiles,
      { read: { conversation: META.sessionId, files: down, answered: true }, canOpen: true },
      { width: 900, height: 600 },
    )
    await drawnReady()
    // ⛔ With no word of who holds W3.1, it is named and opens nothing.
    expect(blind.q('tree-file-also-piece').tagName).toBe('SPAN')
    unmountAll()
    const opened: unknown[][] = []
    const m = mount(
      TreeFiles,
      {
        read: { conversation: META.sessionId, files: down, answered: true },
        canOpen: true,
        holderOf: (piece: string) => (piece === 'work_W3.1' ? 'sess_Ada' : null),
        onOpenConversation: (...args: unknown[]) => opened.push(args),
      },
      { width: 900, height: 600 },
    )
    await drawnReady()
    m.q('tree-file-also-piece').click()
    await nextTick()
    expect(opened).toEqual([['sess_Ada', 'W3.1']])
  })

  it('⚑ a filter chosen on one conversation’s work is not carried to the next — it opens on All', async () => {
    const read = shallowRef<FilesRead>({ conversation: 'sess_a', files: TREE(), answered: true })
    const m = mount(
      defineComponent({ setup: () => () => h(TreeFiles, { read: read.value, canOpen: true }) }),
      {},
      { width: 900, height: 600 },
    )
    await drawnReady()
    m.q('tree-files-filter-input').click()
    await nextTick()
    expect(m.all('tree-file')).toHaveLength(1)
    // ⚑ The same conversation re-read keeps the choice…
    read.value = { conversation: 'sess_a', files: TREE(), answered: true }
    await nextTick()
    expect(m.q('tree-files-filter-input').getAttribute('aria-pressed')).toBe('true')
    // ⚑ …and another conversation's opens on All.
    read.value = { conversation: 'sess_b', files: TREE(), answered: true }
    await nextTick()
    expect(m.q('tree-files-filter-all').getAttribute('aria-pressed')).toBe('true')
    expect(m.all('tree-file')).toHaveLength(5)
  })

  it('🔴 a press opens the row’s own keep in the pane’s viewer — ⛔ and with no reader the rows are words', async () => {
    const m = await pane(TREE())
    const fixed = m.all('tree-file').find((row) => read(row).startsWith('Fixed findings'))!
    expect(fixed.tagName).toBe('BUTTON')
    // ⚑ The row opens its OWN keep — W1.10's, never Ali's on W1.10.1.
    expect(fixed.dataset.document).toBe('res_W1.10_5')
    fixed.click()
    await nextTick()
    await nextTick()
    expect(visible(m.q('canonical-document-viewer'))).toBe(true)
    expect(m.q('canonical-document-name').textContent?.trim()).toBe('res_W1.10_5.md')
    unmountAll()

    const none = await pane(TREE(), { onReadResource: undefined })
    const lines = none.all('tree-file')
    expect(lines).toHaveLength(5)
    for (const line of lines) expect(line.tagName).toBe('DIV')
    expect(read(lines[0]!.querySelector('.file-title')!)).toBe('Testing the tree: results')
    lines[0]!.click()
    await nextTick()
    expect(none.all('canonical-document-viewer')).toHaveLength(0)
  })

  it('⛔ the tree read for another conversation draws *not read* here — the same files read for this one draw', async () => {
    const other = await pane(TREE(), {}, 'sess_someone_else')
    expect(read(other.q('tree-files-unread'))).toBe(
      'Nothing has been read about the files on this work yet.',
    )
    expect(other.all('tree-file')).toHaveLength(0)
    unmountAll()
    const mine = await pane(TREE())
    expect(mine.all('tree-file')).toHaveLength(5)
  })

  it('⛔ not read, a real zero and a kept list each say so — and an answered list says nothing more', async () => {
    const unread = await pane(null)
    expect(visible(unread.q('tree-files-unread'))).toBe(true)
    expect(unread.all('tree-files-filters')).toHaveLength(0)
    unmountAll()
    const none = await pane([])
    expect(read(none.q('tree-files-empty'))).toContain('No files kept yet')
    expect(none.all('tree-files-unread')).toHaveLength(0)
    unmountAll()
    const stale = await pane(TREE(), {}, META.sessionId, false)
    expect(read(stale.q('tree-files-stale'))).toBe(FILES_DID_NOT_ANSWER)
    expect(stale.all('tree-file')).toHaveLength(5)
    unmountAll()
    // ⚠️ An EMPTY list kept from the last read says so too — else *no files* reads as a fact of now.
    const staleNone = await pane([], {}, META.sessionId, false)
    expect(read(staleNone.q('tree-files-stale'))).toBe(FILES_DID_NOT_ANSWER)
    expect(read(staleNone.q('tree-files-empty'))).toContain('No files kept yet')
    unmountAll()
    const freshNone = await pane([])
    expect(freshNone.all('tree-files-stale')).toHaveLength(0)
    expect(read(freshNone.q('tree-files-empty'))).toContain('No files kept yet')
    unmountAll()
    const fresh = await pane(TREE())
    expect(fresh.all('tree-files-stale')).toHaveLength(0)
    expect(fresh.all('tree-file')).toHaveLength(5)
  })

  it('🔴 a title, a piece title or a name longer than its line is cut, and told whole', async () => {
    const long = `Resources in BroBot2: creation, reading, showing, and every place a person could ever look for one`
    const piece = `Investigate resources in BroBot2's source: how they're made, kept, read and shown to a person today`
    const who = 'An agent whose display name a person typed at great length'
    const m = mount(
      TreeFiles,
      {
        read: {
          conversation: META.sessionId,
          answered: true,
          files: [kept('W1.11.1', piece, long, 'made', who, T(3, 39), 'f')],
        },
        canOpen: true,
      },
      { width: 520, height: 300 },
    )
    await drawnReady()
    const row = m.q('tree-file')
    assertClippedButTold(row.querySelector<HTMLElement>('.file-title')!, 'the long title', m.host)
    expect(row.getAttribute('title')).toContain(long)
    assertClippedButTold(
      m.q('tree-file-group').querySelector<HTMLElement>('.piece-title')!,
      'the piece title',
      m.host,
    )
    assertClippedButTold(row.querySelector<HTMLElement>('.who')!, 'the agent’s name', m.host)
    const time = row.querySelector<HTMLElement>('.time')!
    expect(read(time)).toBe(clockTime(T(3, 39)))
    assertDrawn(time, 'the time', m.host)
    const list = m.q('tree-files')
    expect(list.scrollWidth, 'the list scrolls sideways').toBeLessThanOrEqual(list.clientWidth)
    expect(time.getBoundingClientRect().right).toBeLessThanOrEqual(
      list.getBoundingClientRect().right + 0.5,
    )
  })

  it('🔴 the tab follows each new read on screen — a file kept, then another conversation’s tree', async () => {
    const m = await pane(TREE())
    expect(m.all('tree-file')).toHaveLength(5)
    expect(read(m.q('main-tab-files'))).toBe('Files (5)')
    useWhoCalledWhom().treeFiles.value = {
      conversation: META.sessionId,
      answered: true,
      files: [...TREE(), kept('W1.11', 'A late piece', 'Late file', 'made', 'Ana', T(20, 5), 'g')],
    }
    await nextTick()
    expect(m.all('tree-file')).toHaveLength(6)
    expect(m.all('tree-file').some((row) => read(row).startsWith('Late file'))).toBe(true)
    expect(read(m.q('main-tab-files'))).toBe('Files (6)')
    // ⛔ …and a read about another conversation is not this one's: *not read*, and no count.
    useWhoCalledWhom().treeFiles.value = {
      conversation: 'sess_someone_else',
      answered: true,
      files: TREE(),
    }
    await nextTick()
    expect(visible(m.q('tree-files-unread'))).toBe(true)
    expect(m.all('tree-file')).toHaveLength(0)
    expect(m.all('main-tab-files-count')).toHaveLength(0)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import TreeFiles from '../../src/renderer/src/components/TreeFiles.vue'
import WorkSearchDialog from '../../src/renderer/src/components/WorkSearchDialog.vue'
import type { WorkSearchResult } from '../../src/shared/work-search'
import { clockTime } from '../../src/shared/clock'
import type { FilesRead } from '../../src/renderer/src/lib/files-kept'
import type { KeptFile } from '../../src/shared/runtime-ipc'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import { META, mount, unmountAll } from './harness'

afterEach(async () => {
  unmountAll()
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

describe('legacy kept-file list helpers and work search', () => {
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
})

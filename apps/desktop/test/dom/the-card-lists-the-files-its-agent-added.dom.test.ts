import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { fullTime } from '../../src/renderer/src/lib/clock'
import { FILES_DID_NOT_ANSWER } from '../../src/renderer/src/lib/files-kept'
import { clockTime } from '../../src/shared/clock'
import type { KeptFile, ResourceReading } from '../../src/shared/runtime-ipc'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import { META, drawerProps, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⚑ The agent card lists the files its agent added
 *
 * The agent card’s Files box lists files it made and inputs it handed over, grouped by piece,
 * newest first. Use `filesKept` in `conversation` scope, read by the screen into
 * `TheCast.cardFiles`.
 *
 * ⚑ **What is pinned here**: the box, its count and its groups in order; each row's title and its
 * *made* or *input* word with the time it was kept; a press that opens the file by its id where a
 * reader can open one, and a plain row where none can; the files of the agent the card draws — the
 * conversation on screen, the selected agent — and of no other; and a long title cut and told whole
 * on the row's title.
 *
 * ⛔ **Every negative here is paired with the same mount one fact over** — files read for this agent
 * and for another, a reader and none, a read that answered and none — because a box that drew
 * nothing at all would pass every absence.
 */

afterEach(() => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.cardFiles.value = null
  cast.treeFiles.value = null
})

const T0 = new Date(2026, 8, 30, 19, 30).getTime()
const MIN = 60_000

const file = (over: Partial<KeptFile> & Pick<KeptFile, 'resourceId'>): KeptFile => ({
  title: 'Open findings',
  name: 'open-findings.md',
  form: 'markdown',
  bytes: 2_048,
  role: 'made',
  keptAt: T0,
  sha256: 'a'.repeat(64),
  addedBy: { conversation: META.sessionId, name: 'Ali', identity: 'ali' },
  piece: 'work_9',
  label: 'W1.9',
  pieceTitle: 'List the open findings in a small table',
  ...over,
})

/** ⚑ W1.3's results (19:44), W1.3.1's input (19:34) and an older W1.3 draft (19:31). */
const FILES: readonly KeptFile[] = [
  file({
    resourceId: 'res_draft',
    title: 'Draft results',
    name: 'draft.md',
    piece: 'work_3',
    label: 'W1.3',
    pieceTitle: 'Test the tree after the reset',
    keptAt: T0 + 1 * MIN,
  }),
  file({
    resourceId: 'res_results',
    title: 'Testing the tree after the reset (W1.3): results',
    name: 'results.md',
    piece: 'work_3',
    label: 'W1.3',
    pieceTitle: 'Test the tree after the reset',
    keptAt: T0 + 14 * MIN,
  }),
  file({
    resourceId: 'res_input',
    title: 'Input for test 2 and 5 (W1.3)',
    name: 'w1.3.1-input.md',
    role: 'input',
    piece: 'work_31',
    label: 'W1.3.1',
    pieceTitle: 'Test 2 and 5: a helper of your own, and files',
    keptAt: T0 + 4 * MIN,
  }),
]

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

function show(
  files: readonly KeptFile[] | null,
  over: Record<string, unknown> = {},
  forConversation: string = META.sessionId,
  answered = true,
): { m: Mounted; opened: string[] } {
  const opened: string[] = []
  useWhoCalledWhom().cardFiles.value =
    files === null ? null : { conversation: forConversation, files, answered }
  const m = mount(
    SessionDrawer as never,
    drawerProps({
      canOpenDocument: true,
      onOpenDocument: (resourceId: string) => opened.push(resourceId),
      ...over,
    }),
    { width: DRAWER_W_MIN, height: 900 },
  )
  return { m, opened }
}

describe('the agent card lists the files its agent added', () => {
  it('🔴 a Files box, counted: its tiles the newest first, and View all grouped by piece — each row its title, its role and its time', async () => {
    const { m } = show(FILES)
    await drawnReady()
    const box = m.q('card-files')
    expect(visible(box)).toBe(true)
    expect(read(box.querySelector('.title')!)).toBe('Files')
    expect(read(box.querySelector('.count')!)).toBe('(3)')
    // ⚑ The box folds, so its heading wears the fold's chevron where the icon was.
    expect(box.querySelector('.head use')!.getAttribute('href')).toBe('#i-chevron')

    // Draw the four newest files as tiles, each with its piece’s label and title.
    const tiles = m.all('card-file')
    expect(tiles.map((tile) => tile.dataset.document)).toEqual([
      'res_results',
      'res_input',
      'res_draft',
    ])
    expect(read(tiles[0]!.querySelector('.file-tile-name')!)).toBe(
      'Testing the tree after the reset (W1.3): results',
    )
    expect(read(tiles[0]!.querySelector('.file-tile-tag')!)).toBe('W1.3')
    expect(tiles[0]!.querySelector('.file-tile-tag')!.getAttribute('title')).toBe(
      'Test the tree after the reset',
    )
    for (const tile of tiles) assertDrawn(tile, tile.dataset.document ?? 'a tile', m.host)
    // ⚑ The tooltip names the file where its title is not its name.
    expect(tiles[0]!.getAttribute('title')).toBe(
      'Testing the tree after the reset (W1.3): results — results.md',
    )
    expect(read(m.q('card-files-caption'))).toBe('3 of 3 files')

    // “View all” opens the complete collection in a popup, newest first.
    m.q('card-files-all').click()
    await nextTick()
    const dialog = m.q('all-files-dialog')
    const rows = [...dialog.querySelectorAll<HTMLElement>('[data-cy="card-file"]')]
    expect(rows.map((row) => row.dataset.document)).toEqual([
      'res_results',
      'res_input',
      'res_draft',
    ])
    expect(read(dialog.querySelector('[data-cy="all-files-count"]')!)).toBe('3 files')
    expect(read(rows[0]!.querySelector('.file-meta')!)).toBe(
      `W1.3 made · ${clockTime(T0 + 14 * MIN)}`,
    )
    // ⚑ The day is on the time's own title, as every other clock time in the window carries it.
    expect(rows[0]!.querySelector('.file-meta')!.getAttribute('title')).toBe(
      fullTime(T0 + 14 * MIN),
    )
  })

  it('🔴 the filter keeps the files whose name, title or piece label match, and says when none does', async () => {
    const { m } = show(FILES)
    const filter = m.q('card-files-filter') as HTMLInputElement
    filter.value = 'W1.3.1'
    filter.dispatchEvent(new Event('input'))
    await nextTick()
    expect(m.all('card-file').map((tile) => tile.dataset.document)).toEqual(['res_input'])
    expect(read(m.q('card-files-caption'))).toBe('1 of 1 file · 3 in all')
    filter.value = 'nothing like it'
    filter.dispatchEvent(new Event('input'))
    await nextTick()
    expect(m.all('card-file')).toHaveLength(0)
    expect(read(m.q('card-files-why'))).not.toBe('')
  })

  it('🔴 a press opens that file by its id — ⛔ and where nothing can open one, the rows are words', async () => {
    const { m, opened } = show(FILES)
    const row = m.all('card-file').find((one) => one.dataset.document === 'res_input')!
    expect(row.tagName).toBe('BUTTON')
    row.click()
    expect(opened).toEqual(['res_input'])

    unmountAll()
    const plain = show(FILES, { canOpenDocument: false })
    const words = plain.m.all('card-file')
    expect(words.map((one) => one.dataset.document)).toEqual([
      'res_results',
      'res_input',
      'res_draft',
    ])
    for (const one of words) expect(one.tagName).toBe('DIV')
    // ⚑ …and they are still WORDS: a plain tile draws its title.
    expect(read(words[1]!.querySelector('.file-tile-name')!)).toBe('Input for test 2 and 5 (W1.3)')
    words[0]!.click()
    expect(plain.opened).toEqual([])
  })

  it('⛔ files read for another agent draw no box — the same files read for this one do', async () => {
    const other = show(FILES, {}, 'sess_someone_else')
    await drawnReady()
    expect(other.m.all('card-files')).toHaveLength(0)
    // ⚑ The control, the same card one fact over: the read names this conversation.
    expect(visible(other.m.q('card-task'))).toBe(true)
    unmountAll()
    const mine = show(FILES)
    expect(read(mine.m.q('card-files').querySelector('.count')!)).toBe('(3)')
  })

  it('⛔ nothing read, and a real zero, draw no box — one file read draws it', async () => {
    const unread = show(null)
    expect(unread.m.all('card-files')).toHaveLength(0)
    expect(read(unread.m.q('card-task'))).toContain('Current task')
    unmountAll()
    const none = show([])
    expect(none.m.all('card-files')).toHaveLength(0)
    expect(read(none.m.q('card-task'))).toContain('Current task')
    unmountAll()
    const one = show([FILES[0]!])
    expect(one.m.all('card-file').map((row) => row.dataset.document)).toEqual(['res_draft'])
  })

  it('🔴 a title longer than the row is cut, and the row’s title tells it whole', async () => {
    const long =
      'A'.repeat(4) + ' very long title that no row of the agent card could ever hold on one line'
    const { m } = show([file({ resourceId: 'res_long', title: long, name: 'long.md' })])
    await drawnReady()
    const title = m.q('card-file').querySelector<HTMLElement>('.file-tile-name')!
    assertClippedButTold(title, 'the long title', m.host)
    expect(m.q('card-file').getAttribute('title')).toBe(`${long} — long.md`)
  })

  it('🔴 in the pane, a press opens the file in the pane’s viewer — ⛔ and a pane with no reader draws plain rows', async () => {
    // ⚑ The door ECHOES the id it was asked for, so the viewer says which file the press sent.
    const opens = async (resourceId: string): Promise<ResourceReading> => ({
      ok: true,
      form: 'markdown',
      resourceId,
      name: `${resourceId}.md`,
      text: '# Open findings',
      bytes: 15,
    })
    useWhoCalledWhom().cardFiles.value = {
      conversation: META.sessionId,
      files: FILES,
      answered: true,
    }
    await page.viewport(1200, 808)
    const m = mount(
      ConversationPane,
      paneProps({ drawerOpen: true, drawerTab: 'open', onReadResource: opens }),
      { width: 1200, height: 808 },
    )
    await drawnReady()
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
    m.all('card-file')
      .find((row) => row.dataset.document === 'res_input')!
      .click()
    await nextTick()
    await nextTick()
    expect(visible(m.q('canonical-document-viewer'))).toBe(true)
    expect(m.q('canonical-document-name').textContent?.trim()).toBe('res_input.md')
    // ⚑ **The row travels with the press** — the tree is not read on this mount, so the card's own
    // read is where the viewer's header finds its title and where it came from.
    expect(m.q('canonical-document-title').textContent?.trim()).toBe(
      'Input for test 2 and 5 (W1.3)',
    )
    expect(m.q('canonical-document-from').textContent).toContain('Handed over by Ali for W1.3.1')
    unmountAll()

    const none = mount(ConversationPane, paneProps({ drawerOpen: true, drawerTab: 'open' }), {
      width: 1200,
      height: 808,
    })
    await drawnReady()
    const rows = none.all('card-file')
    expect(rows.map((row) => row.dataset.document)).toEqual([
      'res_results',
      'res_input',
      'res_draft',
    ])
    for (const row of rows) expect(row.tagName).toBe('DIV')
    expect(read(rows[0]!.querySelector('.file-tile-name')!)).toBe(
      'Testing the tree after the reset (W1.3): results',
    )
  })

  it('⚠️ a list kept from a read that did not answer says so once — ⛔ an answered list says nothing', async () => {
    const kept = show(FILES, {}, META.sessionId, false)
    await drawnReady()
    expect(read(kept.m.q('card-files-stale'))).toBe(FILES_DID_NOT_ANSWER)
    expect(visible(kept.m.q('card-files-stale'))).toBe(true)
    expect(kept.m.all('card-file')).toHaveLength(3)
    unmountAll()
    const fresh = show(FILES)
    expect(fresh.m.all('card-files-stale')).toHaveLength(0)
    expect(read(fresh.m.q('card-files').querySelector('.count')!)).toBe('(3)')
  })
})

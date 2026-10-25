import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import CanonicalDocumentViewer from '../../src/renderer/src/components/CanonicalDocumentViewer.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import FilesLibraryPreview from '../../src/renderer/src/components/FilesLibraryPreview.vue'
import {
  createFilesLibrary,
  provideFilesLibrary,
} from '../../src/renderer/src/composables/useFilesLibrary'
import { keptFileLibraryReplies } from '../fixtures/kept-file-library-replies'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { fullTime } from '../../src/renderer/src/lib/clock'
import { clockTime } from '../../src/shared/clock'
import type { KeptFile, ResourceReading, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { WorkReport } from '../../src/shared/tasks'
import { assertClippedButTold, assertDrawn, drawnReady } from './drawn'
import {
  META,
  mount,
  paneProps,
  record,
  unmountAll,
  visible,
  type Mounted,
  openWorkReports,
} from './harness'

/**
 * # ⚑ The viewer says what a file is — its title, its kind and size, who, for which piece, when
 *
 * The viewer shows title, filename, kind, size, maker, piece, and time. `readResource`
 * supplies name, form, and size; the pressed row’s `KeptFile` supplies the rest. The pane
 * passes both to `CanonicalDocumentViewer` through its overlay.
 *
 * ⚑ **What is pinned here**: the title first, then the name, the kind and the size, then who made
 * it or handed it over, for which piece and its title, and when; a panel handed no row, or a row
 * for another file, says only what the read says; an agent's words in a title stay words; a press
 * in the pane carries its row to the panel, and one from a place with no row does not invent one;
 * and a title longer than the header is cut and told whole.
 *
 * ⛔ **Every negative here is paired with the same mount one fact over** — a row and none, this
 * file's row and another's — because a header that drew nothing would pass every absence.
 *
 * ⚠️ Drawing images and PDFs, and *Show in Finder* (D-032), are not pinned here.
 */

afterEach(async () => {
  unmountAll()
  useWhoCalledWhom().treeFiles.value = null
  await page.viewport(1200, 808)
})

const AT = new Date(2026, 8, 30, 2, 27).getTime()

const RESULT: ResourceReading = {
  ok: true,
  resourceId: 'res_findings',
  name: 'open-findings.md',
  form: 'markdown',
  text: '# Open findings\n\n| ID | Title |',
  bytes: 2_048,
}

const ROW: KeptFile = {
  resourceId: 'res_findings',
  title: 'Open findings',
  name: 'open-findings.md',
  form: 'markdown',
  bytes: 2_048,
  role: 'made',
  keptAt: AT,
  sha256: 'd'.repeat(64),
  addedBy: { conversation: 'sess_ali', name: 'Ali', identity: 'ali' },
  piece: 'work_9',
  label: 'W1.9',
  pieceTitle: 'List the open findings in a small table',
}

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const viewer = (props: Record<string, unknown>, width = 900): Mounted =>
  mount(CanonicalDocumentViewer, props, { width, height: 600 })

describe('the viewer says what a file is', () => {
  it('wraps the complete unbroken filename and resource id inside a narrow preview', async () => {
    await page.viewport(390, 844)
    const name = `${'x'.repeat(509)}.md`,
      resourceId = `res_${'a'.repeat(124)}`
    const m = viewer({ result: { ...RESULT, name, resourceId } }, 350)
    await drawnReady()
    expect(read(m.q('canonical-document-name'))).toBe(name)
    expect(read(m.q('canonical-document-id'))).toBe(resourceId)
    const frame = m.q('canonical-document-viewer').getBoundingClientRect()
    for (const key of ['canonical-document-name', 'canonical-document-id']) {
      const field = m.q(key)
      expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth + 1)
      expect(field.getBoundingClientRect().right).toBeLessThanOrEqual(frame.right)
      expect(field.getBoundingClientRect().height).toBeGreaterThan(16)
    }
    expect(m.q('document-body').getBoundingClientRect().height).toBeGreaterThan(0)
  })

  it('🔴 the title first, then its name, kind and size, then who made it, for which piece, and when', async () => {
    const m = viewer({ result: RESULT, file: ROW })
    await drawnReady()
    expect(read(m.q('canonical-document-title'))).toBe('Open findings')
    expect(read(m.q('canonical-document-name'))).toBe('open-findings.md')
    expect(read(m.q('canonical-document-kind'))).toBe('Markdown · 2 KB')
    expect(read(m.q('canonical-document-id'))).toBe('res_findings')
    const from = m.q('canonical-document-from')
    expect(read(from)).toBe(
      `Made by Ali for W1.9 · List the open findings in a small table · ${clockTime(AT)}`,
    )
    expect(from.querySelector('span')!.getAttribute('title')).toBe(fullTime(AT))
    // ⚑ In that order, top to bottom.
    const top = (cy: string): number => m.q(cy).getBoundingClientRect().top
    expect(top('canonical-document-title')).toBeLessThan(top('canonical-document-name'))
    expect(top('canonical-document-name')).toBeLessThan(top('canonical-document-from'))
    expect(visible(m.q('document-body'))).toBe(true)
    // ⚑ Drawn whole at this width: the name, and the line that says where it came from.
    assertDrawn(m.q('canonical-document-name'), 'the name', m.host)
    assertDrawn(m.q('canonical-document-from'), 'where it came from', m.host)
  })

  it('⛔ handed no row, or another file’s, it says only what the read says — its name, kind and size', async () => {
    for (const file of [undefined, { ...ROW, resourceId: 'res_someone_else' }]) {
      const m = viewer({ result: RESULT, ...(file === undefined ? {} : { file }) })
      await drawnReady()
      expect(read(m.q('canonical-document-name'))).toBe('open-findings.md')
      expect(read(m.q('canonical-document-kind'))).toBe('Markdown · 2 KB')
      expect(m.all('canonical-document-title')).toHaveLength(0)
      expect(m.all('canonical-document-from')).toHaveLength(0)
      unmountAll()
    }
  })

  it('🔴 an input is *handed over*, a person is *you*, and a piece with no title says its label', async () => {
    const input = viewer({
      result: RESULT,
      file: {
        ...ROW,
        role: 'input',
        addedBy: { conversation: 'sess_b', name: 'BroBot', identity: 'brobot' },
      },
    })
    expect(read(input.q('canonical-document-from'))).toBe(
      `Handed over by BroBot for W1.9 · List the open findings in a small table · ${clockTime(AT)}`,
    )
    unmountAll()
    const person = viewer({
      result: RESULT,
      file: { ...ROW, addedBy: null, label: 'W1', pieceTitle: null },
    })
    expect(read(person.q('canonical-document-from'))).toBe(`Made by you for W1 · ${clockTime(AT)}`)
  })

  it('⛔ an agent’s words in a title stay words — nothing in them is drawn or run', async () => {
    const hostile = '<img src=x onerror="window.__brobot_owned=1"><b>Findings</b>'
    const m = viewer({ result: RESULT, file: { ...ROW, title: hostile } })
    await drawnReady()
    expect(read(m.q('canonical-document-title'))).toBe(hostile)
    expect(m.q('canonical-document-title').querySelector('img, b')).toBeNull()
    expect((window as unknown as Record<string, unknown>).__brobot_owned).toBeUndefined()
  })

  it('🔴 a press in the pane carries its row to the panel — ⛔ the same file opened with no row says only the read', async () => {
    useWhoCalledWhom().treeFiles.value = {
      conversation: META.sessionId,
      files: [ROW],
      answered: true,
    }
    await page.viewport(1200, 808)
    const libraryPane = defineComponent({
      setup() {
        const library = createFilesLibrary({
          read: keptFileLibraryReplies(() => [ROW]),
          workspace: () => 'fictional',
          selected: () => ({ id: META.sessionId, name: 'Fictional conversation' }),
        })
        provideFilesLibrary(library)
        return () =>
          h('div', { style: 'display:flex;flex:1;min-height:0' }, [
            h(ConversationPane, paneProps({ onReadResource: async () => RESULT })),
            h(FilesLibraryPreview, { library, workspace: 'fictional', read: async () => RESULT }),
          ])
      },
    })
    const m = mount(
      libraryPane,
      {},
      {
        width: 1180,
        height: 780,
      },
    )
    m.q('main-tab-files').click()
    await vi.waitFor(() => expect(m.all('library-file')).toHaveLength(1))
    m.q('library-file').click()
    await vi.waitFor(() => expect(m.all('canonical-document-viewer')).toHaveLength(1))
    expect(read(m.q('canonical-document-title'))).toBe('Open findings')
    expect(read(m.q('canonical-document-from'))).toContain('Made by Ali for W1.9')
    unmountAll()
    // ⚑ The pair: the same file, pressed on a reply card whose file the tree has not read — the
    // press the card drew before UI-002 — opens with no row, and the header says only the read.
    useWhoCalledWhom().treeFiles.value = { conversation: META.sessionId, files: [], answered: true }
    const bare = mount(
      ConversationPane,
      paneProps({
        record: record([
          {
            type: 'user_turn',
            attribution: 'app_authored',
            text: 'W1.9 was answered: done.',
            work: {
              piece: 'work_9',
              label: 'W1.9',
              owner: 'sess_ali',
              state: 'answered',
              outcome: 'done',
              resources: ['res_findings'],
            } as WorkReport,
          } as TranscriptEvent,
        ]),
        onReadResource: async () => RESULT,
      }),
      { width: 1180, height: 780 },
    )
    await openWorkReports(bare)
    await drawnReady()
    bare.q('work-report-document').click()
    await nextTick()
    await nextTick()
    expect(read(bare.q('canonical-document-name'))).toBe('open-findings.md')
    expect(bare.all('canonical-document-title')).toHaveLength(0)
    expect(bare.all('canonical-document-from')).toHaveLength(0)
  })

  it('🔴 a title longer than the panel is wide is cut, and told whole', async () => {
    // ⚑ The panel grows with its words up to its own cap (900 px), so the title has to outrun that.
    const long =
      `${'Resources in BroBot2: creation, reading, showing, and every place a person could look for one. '.repeat(3)}`.trim()
    const m = viewer({ result: RESULT, file: { ...ROW, title: long } }, 1180)
    await drawnReady()
    expect(m.q('canonical-document-viewer').getBoundingClientRect().width).toBeLessThanOrEqual(
      900.5,
    )
    assertClippedButTold(m.q('canonical-document-title'), 'the title', m.host)
  })
})

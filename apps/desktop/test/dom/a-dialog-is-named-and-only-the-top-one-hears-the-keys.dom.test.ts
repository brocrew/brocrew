import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import CanonicalDocumentOverlay from '../../src/renderer/src/components/CanonicalDocumentOverlay.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import type { KeptFile, ResourceReading } from '../../src/shared/runtime-ipc'
import { META, drawerProps, mount, unmountAll } from './harness'

/**
 * The shared dialog layer, as a keyboard and a screen reader meet it: every host has a name, only
 * the host on top answers Escape and Tab, and a `<details>` summary is a stop in the focus trap.
 */

const safety = useSpawnSafety()

beforeEach(() => {
  // No stop lane: the trap's last stop is then the last one the test puts in the slot.
  safety.forget()
})

afterEach(() => {
  unmountAll()
  useWhoCalledWhom().cardFiles.value = null
})

/** A key at the window, where `OverlayHost` listens. */
function press(key: 'Escape' | 'Tab', shiftKey = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

const hosts = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-cy="overlay-host"]'),
]

/* ------------------------------------------------------------------------------- the name */

describe('every dialog host has a name', () => {
  it('the host carries the label it is given as its accessible name', async () => {
    mount(
      defineComponent({
        setup: () => () =>
          h(OverlayHost, { label: 'All files' }, { default: () => h('button', 'Close') }),
      }),
      {},
      { width: 10, height: 10 },
    )
    await settle()
    const dialog = page.getByRole('dialog', { name: 'All files' }).element()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.dataset.cy).toBe('overlay-host')
  })

  /** The opening tag of every `<OverlayHost` in `source`, comments stripped. */
  function mountTags(source: string): string[] {
    const bare = source.replace(/<!--[\s\S]*?-->/g, '')
    return [...bare.matchAll(/<OverlayHost[\s>][^>]*>/g)].map((m) => m[0])
  }
  const named = (tag: string): boolean => /\s:?label="[^"]+"/.test(tag)

  it('every mount site in the window passes a label', () => {
    const sources = import.meta.glob('../../src/renderer/src/components/*.vue', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const tags = Object.entries(sources)
      .filter(([file]) => !file.endsWith('/OverlayHost.vue'))
      .flatMap(([file, text]) => mountTags(text).map((tag) => ({ file, tag })))
    // The name and stop censuses cover the same overlay mounts.
    expect(tags).toHaveLength(17)
    expect(tags.filter(({ file }) => file.endsWith('/ProvidersScreen.vue'))).toHaveLength(1)
    for (const { file, tag } of tags) expect(named(tag), `${file}: ${tag}`).toBe(true)
  })

  it('…and the walk refuses a mount site that names nothing', () => {
    const [bare] = mountTags('<template><OverlayHost v-if="open" @close="open = false"></template>')
    const [given] = mountTags('<template><OverlayHost v-if="open" label="Image"></template>')
    expect(named(bare!)).toBe(false)
    expect(named(given!)).toBe(true)
  })
})

/* ---------------------------------------------------------------- the app's own popup */

const T0 = new Date(2026, 8, 30, 19, 30).getTime()

const file = (resourceId: string, title: string): KeptFile => ({
  resourceId,
  title,
  name: `${resourceId}.md`,
  form: 'markdown',
  bytes: 2_048,
  role: 'made',
  keptAt: T0,
  sha256: 'a'.repeat(64),
  addedBy: { conversation: META.sessionId, name: 'Ali', identity: 'ali' },
  piece: 'work_3',
  label: 'W1.3',
  pieceTitle: 'Test the tree after the reset',
})

describe('the agent card’s popup is named in the app’s words', () => {
  it('"View all" opens a dialog a screen reader calls "All files"', async () => {
    useWhoCalledWhom().cardFiles.value = {
      conversation: META.sessionId,
      files: [file('res_results', 'Results')],
      answered: true,
    }
    const m = mount(SessionDrawer as never, drawerProps({ canOpenDocument: true }), {
      width: DRAWER_W_MIN,
      height: 900,
    })
    await settle()
    m.q('card-files-all').click()
    await settle()
    const dialog = page.getByRole('dialog', { name: 'All files' }).element()
    expect(dialog.contains(m.q('all-files-dialog'))).toBe(true)
  })
})

/* ---------------------------------------------------- a dialog opened from a dialog */

const A_DOCUMENT: ResourceReading = {
  ok: true,
  form: 'markdown',
  resourceId: 'res_results',
  name: 'results.md',
  text: '# the results\n',
  bytes: 14,
}

/**
 * A sheet with a button that opens the real document overlay over it, leaving the sheet open: two
 * hosts on screen, the later one on top.
 */
const ASheetThenADocument = defineComponent({
  name: 'ASheetThenADocument',
  setup() {
    const sheet = ref(false)
    const documents = ref<{ open: (resourceId: string) => Promise<void> } | null>(null)
    return () =>
      h('div', [
        h('button', { 'data-cy': 'open-sheet', onClick: () => (sheet.value = true) }, 'Open'),
        sheet.value
          ? h(
              OverlayHost,
              { label: 'A sheet', onClose: () => (sheet.value = false) },
              {
                default: () =>
                  h('div', { 'data-cy': 'the-sheet' }, [
                    h('button', 'First'),
                    h(
                      'button',
                      {
                        'data-cy': 'open-document',
                        onClick: () => void documents.value?.open('res_results'),
                      },
                      'Open the document',
                    ),
                  ]),
              },
            )
          : null,
        h(CanonicalDocumentOverlay as never, { ref: documents, read: async () => A_DOCUMENT }),
      ])
  },
})

describe('only the dialog on top hears the keys', () => {
  async function openBoth(): Promise<{ openSheet: HTMLElement; openDocument: HTMLElement }> {
    const m = mount(ASheetThenADocument, {}, { width: 10, height: 10 })
    await settle()
    const openSheet = m.q('open-sheet')
    openSheet.focus()
    openSheet.click()
    await settle()
    expect(hosts()).toHaveLength(1)

    const openDocument = m.q('open-document')
    openDocument.focus()
    openDocument.click()
    await settle()
    expect(hosts()).toHaveLength(2)
    return { openSheet, openDocument }
  }

  it('the layer on top is named for what it shows', async () => {
    await openBoth()
    expect(page.getByRole('dialog', { name: 'Document' }).element()).toBe(hosts()[1])
  })

  it('one Escape closes the document only and gives focus back to what opened it', async () => {
    const { openSheet, openDocument } = await openBoth()
    const [sheet, documentHost] = hosts()
    expect(documentHost!.contains(document.activeElement)).toBe(true)

    press('Escape')
    await settle()
    // The control: with every host listening, this one press closed the sheet as well.
    expect(hosts()).toEqual([sheet])
    expect(document.activeElement).toBe(openDocument)

    press('Escape')
    await settle()
    expect(hosts()).toHaveLength(0)
    expect(document.activeElement).toBe(openSheet)
  })

  it('Tab and Shift+Tab wrap inside the document, not the sheet under it', async () => {
    await openBoth()
    const [sheet, documentHost] = hosts()
    documentHost!.querySelector<HTMLElement>('[data-cy="close-overlay"]')!.focus()

    press('Tab', true)
    await nextTick()
    expect(documentHost!.contains(document.activeElement)).toBe(true)
    expect(sheet!.contains(document.activeElement)).toBe(false)

    press('Tab')
    await nextTick()
    expect(documentHost!.contains(document.activeElement)).toBe(true)
    expect(sheet!.contains(document.activeElement)).toBe(false)
  })

  it('a host raised inside another host’s panel is the one on top, though it mounted first', async () => {
    const closed: string[] = []
    mount(
      defineComponent({
        setup: () => () =>
          h(
            OverlayHost,
            { label: 'Outer', onClose: () => closed.push('outer') },
            {
              default: () => [
                h('button', 'Outer button'),
                h(
                  OverlayHost,
                  { label: 'Inner', onClose: () => closed.push('inner') },
                  { default: () => h('button', 'Inner button') },
                ),
              ],
            },
          ),
      }),
      {},
      { width: 10, height: 10 },
    )
    await settle()
    press('Escape')
    expect(closed).toEqual(['inner'])
  })
})

/* ----------------------------------------------------------- a summary is a stop in the trap */

describe('a <details> summary is a stop in the focus trap', () => {
  const Sheet = defineComponent({
    name: 'ASheetWithSummaries',
    setup: () => () =>
      h(
        OverlayHost,
        { label: 'A sheet' },
        {
          default: () =>
            h('div', [
              // Not stops: hidden, and inside an inert subtree.
              h('details', { hidden: true }, [h('summary', { 'data-cy': 'hidden-summary' }, 'H')]),
              h('div', { inert: '' }, [
                h('details', [h('summary', { 'data-cy': 'inert-summary' }, 'I')]),
              ]),
              h('details', [h('summary', { 'data-cy': 'summary' }, 'What it was told')]),
              h('button', { 'data-cy': 'middle' }, 'Middle'),
              h('button', { 'data-cy': 'last' }, 'Last'),
              // Not stops either, so "Last" stays the last.
              h('div', { inert: '' }, [h('details', [h('summary', 'J')])]),
              h('details', { style: 'visibility: hidden' }, [h('summary', 'K')]),
            ]),
        },
      ),
  })

  it('the sheet opens with the summary focused, past the hidden and inert ones', async () => {
    const m = mount(Sheet, {}, { width: 10, height: 10 })
    await settle()
    // The control: without summaries among the stops, the opening focus went to "Middle".
    expect(document.activeElement).toBe(m.q('summary'))
  })

  it('Shift+Tab from the summary wraps to the last stop, and Tab from there comes back to it', async () => {
    const m = mount(Sheet, {}, { width: 10, height: 10 })
    await settle()
    m.q('summary').focus()

    press('Tab', true)
    await nextTick()
    expect(document.activeElement).toBe(m.q('last'))

    press('Tab')
    await nextTick()
    expect(document.activeElement).toBe(m.q('summary'))
  })
})

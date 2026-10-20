import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { ForestView } from '../../src/renderer/src/lib/the-forest'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * # ⚑ The Graph is moved by hand, grows with its cards, and is fed by the screen
 *
 * Vue Flow supports scroll panning, button zoom, and Fit. Each generation’s height follows
 * its tallest measured card; the first view is taken once. The Graph tab fills its column
 * while a page uses its own height, and the screen supplies the forest for the on-screen
 * conversation. Neighboring suites cover card content and placement; this suite checks these
 * gestures, row heights, initial-view timing, and screen binding.
 *
 * ## ⛔ Why a DOM file
 *
 * ⚠️ **Every claim here is PIXELS in a real engine**: a zoom is the ratio of one card's width before
 * and after a press, a pan is how far one card's top moved under a wheel, a generation's room is the
 * gap between two cards. The last test reads the screen's source, because nothing mounts the whole
 * screen (`a-view-drawn-from-its-ledger-says-what-the-host-says` §4 does the same).
 *
 * ⚠️ **Each negative below has a positive on the same mount** — the card that did not zoom under the
 * wheel zooms under the button, the row that did not move under a press moves back under *Fit*, the
 * gap that is the same open as closed was first read closed and the card was proved taller opened,
 * and a page's forest is read beside the Graph tab's at the same viewport.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  const cast = useWhoCalledWhom()
  // ⛔ **The channel is a window-level singleton**, so a door left behind would be the next test's.
  cast.goTo.value = null
  cast.railSays.value = null
  cast.forest.value = null
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** ⚑ The forest of the zoom and the wheel: BroBot and two agents it started. */
const THREE = (): ReturnType<typeof viewOf> =>
  viewOf([conv('sess_boss', null), conv('sess_ana', 'sess_boss'), conv('sess_arjun', 'sess_boss')])

const box = (m: Mounted, id: string): DOMRect => m.q(`forest-row-${id}`).getBoundingClientRect()

/** ⚑ **TeamForest alone**, in a sized box, drawn and fitted — a page's forest, as the Team page mounts it. */
async function drawForest(view: ForestView, width = 1100): Promise<Mounted> {
  await page.viewport(width + 100, 1100)
  const m = mount(TeamForest, { view }, { width, height: 1000 })
  // ⚑ Vue Flow draws its cards a frame after the mount, then places the first view once they are
  // measured; two more frames let that land.
  await forestDrawn()
  await forestDrawn()
  return m
}

const press = async (m: Mounted, cy: string): Promise<void> => {
  m.q(cy).click()
  await forestDrawn()
}

describe('the Graph is moved by hand, grows with its cards, and is fed by the screen', () => {
  describe('§1 · the buttons zoom, the wheel pans, Fit brings it back', () => {
    it('🔴 the + and − presses step the zoom by a fifth and Fit brings it back — and each control says what it does', async () => {
      const m = await drawForest(THREE())

      // ⚑ Each control says what it does, in a labelled group — read off the mount, not assumed.
      // (Vue Flow draws a `group` per line too, so the group is the one the zoom-in press sits in.)
      const group = m.q('forest-zoom-in').closest<HTMLElement>('[role="group"]')
      expect(group, 'the zoom press sits in no group').not.toBeNull()
      expect(group!.getAttribute('aria-label')).toBe('Zoom the forest')
      const buttons = [...group!.querySelectorAll<HTMLButtonElement>('button')]
      expect(buttons.map((one) => one.title)).toEqual([
        'Zoom out',
        'Zoom in',
        'Show the whole forest',
      ])
      expect(buttons.map((one) => (one.textContent ?? '').trim())).toEqual(['−', '+', 'Fit'])
      expect(buttons.map((one) => one.dataset.cy)).toEqual([
        'forest-zoom-out',
        'forest-zoom-in',
        'forest-fit',
      ])

      // ⚑ The first view, at zoom 1: three cards, two slots wide, in the page's own box.
      const w0 = box(m, 'sess_ana').width
      expect(w0).toBeGreaterThan(100)

      // ⚑ + grows the card by a fifth …
      await press(m, 'forest-zoom-in')
      const w1 = box(m, 'sess_ana').width
      expect(Math.abs(w1 / w0 - 1.2)).toBeLessThan(0.05)

      // ⚑ … and − twice shrinks the SAME card by a fifth twice, so a swap of the two is red either way.
      await press(m, 'forest-zoom-out')
      await press(m, 'forest-zoom-out')
      const w2 = box(m, 'sess_ana').width
      expect(Math.abs(w2 / w1 - 1 / 1.44)).toBeLessThan(0.05)

      // ⚑ Fit returns the width to the first view — so a width read really tracks the viewport.
      await press(m, 'forest-fit')
      expect(Math.abs(box(m, 'sess_ana').width - w0)).toBeLessThan(0.5)
    })

    it('🔴 a scroll over the drawing pans it by half the scroll and never zooms it — Fit brings it back', async () => {
      const m = await drawForest(THREE())
      const pane = m.host.querySelector<HTMLElement>('.vue-flow__pane')
      expect(pane, 'Vue Flow drew no pane').not.toBeNull()

      const first = box(m, 'sess_ana')
      // ⚑ A wheel of 120 over the pane: it bubbles to the viewport, where Vue Flow listens for it.
      pane!.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
      await forestDrawn()
      const panned = box(m, 'sess_ana')

      // ⚑ Half the scroll, in screen pixels, and the card neither moved sideways nor changed size.
      expect(Math.abs(first.top - panned.top - 60)).toBeLessThan(1)
      expect(Math.abs(panned.left - first.left)).toBeLessThan(0.5)
      expect(Math.abs(panned.width - first.width)).toBeLessThan(0.5)

      // ⚑ The pair on the same mount: the BUTTON zooms what the scroll did not.
      await press(m, 'forest-zoom-in')
      expect(Math.abs(box(m, 'sess_ana').width / first.width - 1.2)).toBeLessThan(0.05)

      // ⚑ …and Fit brings the top back, so the 60px was a pan of the viewport, not a re-layout.
      await press(m, 'forest-fit')
      expect(Math.abs(box(m, 'sess_ana').top - first.top)).toBeLessThan(1)
    })
  })

  describe('§2 · a generation is as tall as its tallest card, and the first view is taken once', () => {
    it('🔴 a card that grows pushes the next generation down — each row is as tall as its tallest card, measured', async () => {
      // ⚑ A holds six pieces, so it draws three and a *3 earlier* press; B holds none and is the
      // shorter card, LAST in its row.
      const m = await drawForest(
        viewOf([
          conv('sess_a', null),
          conv('sess_b', null),
          conv('sess_a1', 'sess_a'),
          conv('sess_b1', 'sess_b'),
          ...[1, 2, 3, 4, 5, 6].map((n) =>
            task('sess_a', `work_${String(n)}`, `W1.${String(n)}`, `Piece ${String(n)}`, null),
          ),
        ]),
      )
      await forestDrawn()
      const a = (): HTMLElement => m.q('forest-row-sess_a')

      // ⚑ Closed: a gap between the generations, one row for the children, and B's row is A's height.
      expect(a().querySelectorAll('[data-cy="forest-task-number"]')).toHaveLength(3)
      const gapClosed = box(m, 'sess_a1').top - box(m, 'sess_a').bottom
      expect(gapClosed).toBeGreaterThan(10)
      expect(Math.abs(box(m, 'sess_a1').top - box(m, 'sess_b1').top)).toBeLessThan(0.5)
      expect(box(m, 'sess_b1').top).toBeGreaterThan(box(m, 'sess_a').bottom)
      const heightClosed = box(m, 'sess_a').height

      // ⚑ Open A's earlier pieces: it grows, and the next generation goes down with it.
      const more = a().querySelector<HTMLElement>('[data-cy="forest-more"]')
      expect(more, 'A drew no earlier-pieces press').not.toBeNull()
      expect((more!.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe('3 earlier')
      more!.click()
      await forestDrawn()
      await forestDrawn()
      expect(a().querySelectorAll('[data-cy="forest-task-number"]')).toHaveLength(6)
      expect((a().querySelector('[data-cy="forest-more"]')!.textContent ?? '').trim()).toBe('Fewer')
      expect(box(m, 'sess_a').height - heightClosed).toBeGreaterThan(20)

      // ⚑ The band between the generations is a constant: the same gap open as closed, one row
      // still, and still below A however tall A is.
      const gapOpen = box(m, 'sess_a1').top - box(m, 'sess_a').bottom
      expect(Math.abs(gapOpen - gapClosed)).toBeLessThan(2)
      expect(Math.abs(box(m, 'sess_a1').top - box(m, 'sess_b1').top)).toBeLessThan(0.5)
      expect(box(m, 'sess_b1').top).toBeGreaterThanOrEqual(box(m, 'sess_a').bottom)
    })

    it('🔴 the first view is taken once — a conversation that arrives in a re-read leaves a person’s zoom alone', async () => {
      await page.viewport(1200, 1100)
      // ⚑ The forest a re-read replaces, as the screen's 30s read does.
      const view = shallowRef(viewOf([conv('sess_root', null), conv('sess_k1', 'sess_root')]))
      const Screen = defineComponent({ setup: () => () => h(TeamForest, { view: view.value }) })
      const m = mount(Screen, {}, { width: 1100, height: 900 })
      await forestDrawn()
      await forestDrawn()

      // ⚑ The first view fitted the whole of the first forest inside the box.
      const drawing = m.q('forest-rows').getBoundingClientRect()
      for (const id of ['sess_root', 'sess_k1']) {
        const one = box(m, id)
        expect(one.left, id).toBeGreaterThanOrEqual(drawing.left)
        expect(one.right, id).toBeLessThanOrEqual(drawing.right)
      }
      const w0 = box(m, 'sess_root').width

      // ⚑ The premise: the person has changed the zoom.
      await press(m, 'forest-zoom-in')
      const w1 = box(m, 'sess_root').width
      expect(Math.abs(w1 / w0 - 1.2)).toBeLessThan(0.05)

      // ⚑ A conversation arrives in the next read.
      view.value = viewOf([
        conv('sess_root', null),
        conv('sess_k1', 'sess_root'),
        conv('sess_k2', 'sess_root'),
      ])
      await forestDrawn()
      await forestDrawn()
      await forestDrawn()

      // ⚑ It was drawn — the re-read really happened — and the zoom the person set survived it.
      expect(m.all('forest-row-sess_k2')).toHaveLength(1)
      expect(Math.abs(box(m, 'sess_root').width - w1)).toBeLessThan(0.5)
    })
  })

  describe('§3 · the Graph tab takes the whole column, and the screen feeds it', () => {
    const identity = (slug: string, displayName: string): AgentIdentity => ({
      id: `aid:${slug}`,
      slug,
      displayName,
      createdAt: 1_700_000_000_000,
      createdBy: null,
      provider: null,
      externalMcpServerIds: [],
      capabilities: { ...DEFAULT_CAPABILITIES },
      chosen: {
        maxDepth: 'default',
        canMessage: 'default',
        canAssignWork: 'default',
        canCreateAgents: 'default',
        canWriteRules: 'default',
      },
    })

    it('🔴 the Graph tab’s drawing takes the whole column — a page’s forest takes only its own height', async () => {
      // ⚑ The viewport is read back, in case the engine caps it: the page's box is `clamp(360, 62vh, 880)`.
      await page.viewport(1200, 2000)
      const clamp = Math.min(880, Math.max(360, 0.62 * window.innerHeight))
      const forest = viewOf(
        [conv('sess_boss', null), conv('sess_ana', 'sess_boss')],
        [identity('brobot', 'BroBot'), identity('inspector', 'Ana')],
      )

      // (a) The conversation pane, on its Graph tab.
      const cast = useWhoCalledWhom()
      cast.goTo.value = () => undefined
      const said = {
        type: 'assistant_message',
        text: 'Checking the graph.',
      } as unknown as TranscriptEvent
      const tab = mount(
        ConversationPane,
        paneProps({
          record: record([said], 'sess_boss'),
          identities: [identity('brobot', 'BroBot'), identity('inspector', 'Ana')],
          drawerOpen: false,
          cwd: '/work/checkout',
          forest,
        }),
        { width: 1200, height: 1900 },
      )
      await nextTick()
      tab.q('main-tab-graph').click()
      await forestDrawn()
      await forestDrawn()

      // ⚑ It is drawn: cards are there, so the heights below are a forest's and not an empty box's.
      expect(tab.all('forest-row-sess_ana')).toHaveLength(1)
      expect(tab.q('forest-rows').getBoundingClientRect().height).toBeGreaterThan(clamp + 150)
      // ⚑ …and it reaches the bottom of the tab: only the tab's own padding is below the coverage lines.
      const column = tab.q('conversation-graph')
      const padding = parseFloat(getComputedStyle(column).paddingBottom)
      expect(
        column.getBoundingClientRect().bottom -
          tab.q('forest-covers').getBoundingClientRect().bottom,
      ).toBeLessThanOrEqual(padding + 2)

      // (b) The control: the same forest on a page, at the same viewport, with the same room.
      const alone = mount(TeamForest, { view: forest }, { width: 1100, height: 1900 })
      await forestDrawn()
      await forestDrawn()
      expect(alone.all('forest-row-sess_ana')).toHaveLength(1)
      expect(Math.abs(alone.q('forest-rows').getBoundingClientRect().height - clamp)).toBeLessThan(
        4,
      )
      // ⚑ A page's forest does not stretch to the room it is given.
      expect(
        alone.host.getBoundingClientRect().bottom -
          alone.q('forest-covers').getBoundingClientRect().bottom,
      ).toBeGreaterThan(300)
    })

    it('🔴 RuntimeScreen hands the conversation pane the Graph tab’s forest, folded off the band’s own read — and the Team page its own', async () => {
      const screen = (
        (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
          default: string
        }
      ).default
      /** From `start` to the first `end` after it; each is asserted found first. */
      const slice = (start: string, end: string): string => {
        const from = screen.indexOf(start)
        expect(from, `nothing starts with ${start}`).toBeGreaterThan(-1)
        const to = screen.indexOf(end, from + start.length)
        expect(to, `nothing ends ${start} with ${end.trim()}`).toBeGreaterThan(from)
        return screen.slice(from, to)
      }

      const pane = slice(
        `<ConversationPane\n            v-else-if="surface === 'conversation' && active?.meta"`,
        '\n          />\n',
      )
      const team = slice(
        `<TeamWorkspace\n            v-else-if="surface === 'team'"`,
        '\n          />\n',
      )
      const graphFold = slice('const conversationForestView = computed(() =>', '\n)\n')
      const teamFold = slice('const theForestView = computed(', '\n')

      // ⚑ The pane is handed the Graph tab's forest, folded off the band's own read: the forest the
      // poll took and what each running conversation was last told.
      expect(pane).toContain(':forest="readConversationForest"')
      expect(screen).toContain('const readConversationForest = () => conversationForestView.value')
      expect(graphFold).toContain(
        'foldTheForest(cast.forest.value, cast.reading.value?.atWork ?? null)',
      )
      // ⚑ The Team page is handed its own, folded off its own read.
      expect(team).toContain(':forest="theForestView"')
      expect(teamFold).toContain('foldTheForest(theForest.value, beingDone.value)')

      // ⛔ The two are not crossed: each declaration reads its own source, beside the containment above.
      expect(graphFold).not.toContain('theForest.value')
      expect(graphFold).not.toContain('beingDone.value')
      expect(teamFold).not.toContain('cast.forest')
      expect(teamFold).not.toContain('cast.reading')
    })
  })
})

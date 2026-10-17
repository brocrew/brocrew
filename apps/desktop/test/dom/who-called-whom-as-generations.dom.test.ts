import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { forestView, type ForestView } from '../../src/renderer/src/lib/the-forest'
import { OPEN_THE_CONVERSATION } from '../../src/renderer/src/lib/taking-over'
import type { AgentFacets, RailSays } from '../../src/renderer/src/lib/agent-state'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { AgentIdentities } from '../../src/shared/runtime-ipc'
import type { ForestNode, TheWholeForest } from '../../src/shared/the-whole-forest'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 668 · *Who called whom*, drawn as generations — on a real screen
 *
 * Draw a vertical graph in generations: all BroBot conversations, then their children, then
 * successive descendants. Clicking a stopped conversation must open it and update its visible
 * state without requiring manual reopen or a navigation round trip.
 *
 * ## ⛔ Why a DOM file
 *
 * ⚠️ **Every layout claim here is PIXELS** — `606`'s rule: a generation is below the one before it,
 * a child sits under its parent, siblings share a row, and the page never scrolls sideways. ⚑ The
 * presses are CLICKS on the real Team page, and the ring is read off the mounted plate after a change
 * that did not remount it.
 */

const NOW = 1_800_000_000_000
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const conv = (id: string, parent: string | null, over: Record<string, unknown> = {}): ForestNode =>
  ({
    node: 'a-conversation',
    conversation: id,
    under: parent === null ? { is: 'the-person' } : { is: 'a-conversation', conversation: parent },
    identity: id.replace('sess_', ''),
    provider: 'claude',
    status: 'idle',
    running: 'not-running',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    ...over,
  }) as ForestNode

const task = (holder: string, id: string, number: number, over: Record<string, unknown> = {}) =>
  ({
    node: 'a-task',
    under: { is: 'a-conversation', conversation: holder },
    givenBy: { is: 'the-person' },
    work: {
      piece: id,
      label: `W1.${String(number)}`,
      title: `the whole title of ${id}, long enough that a card of this width has to cut it`,
      from: null,
      fromIdentity: null,
      to: holder,
      toIdentity: holder.replace('sess_', ''),
      state: 'working',
      givenAt: NOW - 30_000,
      endedAt: null,
      ...over,
    },
  }) as unknown as ForestNode

const forestOf = (rows: readonly ForestNode[]): TheWholeForest =>
  ({
    readAt: NOW,
    nodes: {
      rows,
      walk: 'every-conversation-this-app-placed',
      ledgers: rows.filter((r) => r.node === 'a-conversation').length,
      rowsUnread: 0,
    },
    conversations: rows.filter((r) => r.node === 'a-conversation').length,
    heldByNoAgent: 0,
  }) as unknown as TheWholeForest

const viewOf = (
  rows: readonly ForestNode[],
  held: readonly string[] = [],
  said?: ReadonlyMap<string, RailSays> | null,
): ForestView =>
  forestView({
    forest: forestOf(rows),
    atWork: null,
    waits: null,
    identities: null,
    held: new Set(held),
    ...(said === undefined ? {} : { said }),
  })!

/** Two root conversations; the second has three children, whose third has two children. */
const FAMILY: ForestNode[] = [
  conv('sess_b1', null, { running: 'in-a-window' }),
  conv('sess_b2', null),
  conv('sess_ana', 'sess_b2'),
  conv('sess_anh', 'sess_b2'),
  conv('sess_ada', 'sess_b2'),
  conv('sess_amara', 'sess_ada'),
  conv('sess_ali', 'sess_ada'),
]

const box = (m: Mounted, id: string): DOMRect => m.q(`forest-row-${id}`).getBoundingClientRect()
const centre = (r: DOMRect): number => r.left + r.width / 2

async function drawForest(view: ForestView, width = 1200): Promise<Mounted> {
  await page.viewport(width + 100, 1100)
  const m = mount(TeamForest, { view }, { width, height: 1000 })
  // ⚑ Vue Flow draws its cards a frame after the mount, and places the view once they are measured.
  await nextTick()
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  await nextTick()
  return m
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the layout, in pixels
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('668 · who called whom, as generations', () => {
  describe('§1 · rows top to bottom, each child under its parent', () => {
    it('🔴 every node of generation n+1 is BELOW every node of generation n', async () => {
      const m = await drawForest(viewOf(FAMILY))
      const rows = [
        ['sess_b1', 'sess_b2'],
        ['sess_ana', 'sess_anh', 'sess_ada'],
        ['sess_amara', 'sess_ali'],
      ]
      for (let g = 1; g < rows.length; g += 1) {
        const above = Math.max(...rows[g - 1]!.map((id) => box(m, id).bottom))
        for (const id of rows[g]!) expect(box(m, id).top, id).toBeGreaterThan(above)
      }
    })

    it('⛔ the CONTROL — siblings sit on ONE row, left to right in the order they were started', async () => {
      const m = await drawForest(viewOf(FAMILY))
      const tops = ['sess_ana', 'sess_anh', 'sess_ada'].map((id) => box(m, id).top)
      expect(new Set(tops).size).toBe(1)
      expect(box(m, 'sess_ana').right).toBeLessThanOrEqual(box(m, 'sess_anh').left)
      expect(box(m, 'sess_anh').right).toBeLessThanOrEqual(box(m, 'sess_ada').left)
      expect(box(m, 'sess_b1').top).toBe(box(m, 'sess_b2').top)
    })

    it('🔴 a parent is centred over its children — and an only child is exactly under its parent', async () => {
      const m = await drawForest(viewOf(FAMILY))
      // Ada over Amara and Ali
      const mid = (centre(box(m, 'sess_amara')) + centre(box(m, 'sess_ali'))) / 2
      expect(Math.abs(centre(box(m, 'sess_ada')) - mid)).toBeLessThan(1)
      // the second BroBot over the whole span of its family
      const left = box(m, 'sess_ana').left
      const right = box(m, 'sess_ali').right
      expect(Math.abs(centre(box(m, 'sess_b2')) - (left + right) / 2)).toBeLessThan(1)
      const only = await drawForest(viewOf([conv('sess_p', null), conv('sess_c', 'sess_p')]))
      expect(Math.abs(centre(box(only, 'sess_c')) - centre(box(only, 'sess_p')))).toBeLessThan(1)
    })

    /**
     * ⚑ **2026-09-30 · the lines are Vue Flow's** — an edge per child, drawn from the parent card's
     * bottom centre to the child card's top centre, whatever path it takes between them.
     */
    it('🔴 a line runs from each parent’s card to each child’s — its ends at the two centres', async () => {
      const m = await drawForest(viewOf(FAMILY))
      const edges = [...m.host.querySelectorAll<SVGGElement>('[data-id^="forest-edge-"]')]
      expect(edges).toHaveLength(5)
      for (const edge of edges) {
        const child = edge.dataset.id!.replace('forest-edge-', '')
        const parent = m.q(`forest-row-${child}`).dataset.parent!
        const path = edge.querySelector<SVGPathElement>('path.vue-flow__edge-path')!
        const ctm = path.getScreenCTM()!
        const at = (length: number): DOMPoint =>
          new DOMPoint(
            path.getPointAtLength(length).x,
            path.getPointAtLength(length).y,
          ).matrixTransform(ctm)
        const start = at(0)
        const end = at(path.getTotalLength())
        expect(
          Math.abs(start.x - centre(box(m, parent))),
          `${child}'s line leaves its parent`,
        ).toBeLessThan(2)
        expect(
          Math.abs(start.y - box(m, parent).bottom),
          `${child}'s line leaves its parent`,
        ).toBeLessThan(2)
        expect(Math.abs(end.x - centre(box(m, child))), `${child}'s line reaches it`).toBeLessThan(
          2,
        )
        expect(Math.abs(end.y - box(m, child).top), `${child}'s line reaches it`).toBeLessThan(2)
      }
    })

    /**
     * ⚑ **2026-09-30 · a family wider than the box is PANNED inside it** — Vue Flow's canvas, with a
     * pinch or the buttons to zoom and *Fit* to see all of it. ⛔ The page still never scrolls sideways.
     */
    it('⛔ a family wider than the page is panned INSIDE the graph — the page never scrolls sideways', async () => {
      const wide = [
        conv('sess_root', null),
        ...Array.from({ length: 9 }, (_, i) => conv(`sess_kid${i}`, 'sess_root')),
      ]
      const m = await drawForest(viewOf(wide), 700)
      const section = m.q('team-forest')
      const drawing = m.q('forest-rows').getBoundingClientRect()
      // ⚑ the premise: at a zoom a card can be read at, this family really is wider than the box
      const kids = Array.from({ length: 9 }, (_, i) => box(m, `sess_kid${i}`))
      expect(
        Math.max(...kids.map((kid) => kid.right)) - Math.min(...kids.map((kid) => kid.left)),
      ).toBeGreaterThan(drawing.width)
      // ⛔ and the page does not scroll with it
      expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth)
      expect(m.host.scrollWidth).toBeLessThanOrEqual(m.host.clientWidth)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      )
      // The control family fits this page width: every card lies inside the box.
      const fits = await drawForest(viewOf(FAMILY), 1100)
      const inner = fits.q('forest-rows').getBoundingClientRect()
      for (const id of [
        'sess_b1',
        'sess_b2',
        'sess_ana',
        'sess_anh',
        'sess_ada',
        'sess_amara',
        'sess_ali',
      ]) {
        const card = box(fits, id)
        expect(card.left, id).toBeGreaterThanOrEqual(inner.left)
        expect(card.right, id).toBeLessThanOrEqual(inner.right)
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · every node opens — clicked on the real Team page
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · every node opens — held, not held, nobody watching, stopped', () => {
    const agents = {
      identities: [],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      externalMcpServers: [],
    } as unknown as AgentIdentities
    const store = { renameTo: vi.fn(), remove: vi.fn() } as unknown as AgentStore

    it('🔴 each node raises the ONE act — open it — and another window’s says where it is', async () => {
      // ⚑ **D-017b · one press everywhere**: a conversation opens in its full view whatever it is
      // doing — the four gestures that routed a press by its process (open, take over, reopen or
      // read, none) are gone, and so is the node with no press.
      await page.viewport(1300, 1000)
      const acts: string[] = []
      const view = viewOf(
        [
          conv('sess_closed', null, { running: 'not-running' }),
          conv('sess_unwatched', null, { running: 'unwatched' }),
          conv('sess_mine', null, { running: 'in-a-window' }),
          conv('sess_theirs', null, { running: 'in-a-window' }),
        ],
        ['sess_mine'],
      )
      const m = mount(
        TeamWorkspace,
        {
          agents,
          store,
          forest: view,
          onOpenConversation: (id: string) => acts.push(`open ${id}`),
        },
        { width: 1200, height: 900 },
      )
      m.q('team-tab-forest').click()
      await nextTick()
      const press = (id: string): HTMLElement =>
        m.q(`forest-row-${id}`).querySelector<HTMLElement>('[data-cy="forest-open"]')!
      for (const id of ['sess_closed', 'sess_unwatched', 'sess_mine', 'sess_theirs']) {
        press(id).click()
        await nextTick()
      }
      expect(acts).toEqual([
        'open sess_closed',
        'open sess_unwatched',
        'open sess_mine',
        'open sess_theirs',
      ])
      // ⚑ another window's node is a control like every other — and its words say where it is (a
      // message from here is refused there)
      expect(press('sess_theirs').tagName).toBe('BUTTON')
      expect(press('sess_closed').tagName).toBe('BUTTON')
      expect(
        m.q('forest-row-sess_theirs').querySelector('[data-cy="forest-here"]')?.textContent,
      ).toContain('another window')
      // ⛔ the CONTROL — a node this window holds says nothing about where it is
      expect(m.q('forest-row-sess_mine').querySelector('[data-cy="forest-here"]')).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the ring follows a reopen without a remount
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the person’s dotted ring — measured through his own sequence', () => {
    it('🔴 closed → reopened elsewhere → back on the tab: the ring is the live one, same node, no remount', async () => {
      await page.viewport(1300, 1000)
      // ⚑ **The poll's answer when he came back**: running now, and not yet named by a live reading.
      // Until the screen hands the window's own record, the plate has no DOING to draw.
      const held = ref<readonly string[]>([])
      const said = ref<ReadonlyMap<string, RailSays> | undefined>(undefined)
      const running = ref<'not-running' | 'in-a-window'>('not-running')
      const rows = () => [
        conv('sess_ada', null, { running: running.value }),
        conv('sess_ali', null, { running: 'in-a-window' }),
      ]
      const Screen = defineComponent({
        setup: () => () => h(TeamForest, { view: viewOf(rows(), held.value, said.value) }),
      })
      const m = mount(Screen, {}, { width: 1200, height: 900 })
      await nextTick()
      const plate = (id: string): HTMLElement =>
        m.q(`forest-row-${id}`).querySelector<HTMLElement>('[data-cy="agent-state"]')!
      const node = m.q('forest-row-sess_ada')
      // ⚑ **D-017b · a node nothing runs opens like any other** — the one press, taken here so the
      // end can show it is the same element.
      const pressed = node.querySelector<HTMLElement>('[data-cy="forest-open"]')!
      expect(pressed.tagName).toBe('BUTTON')

      // ⚑ he reopens it by another route and comes back: the forest's next read says it runs, THIS
      // window holds it — and the live reading the poll took has not named it yet
      running.value = 'in-a-window'
      held.value = ['sess_ada']
      await nextTick()
      // ⛔ **his exact state, before 668's fix** — held, but the plate from the poll alone: the dashed
      // ring, while the rail beside it drew the live one
      expect(plate('sess_ada').dataset.doing).toBe('unknown')

      // 🔴 the fix: the screen hands the rail's rows — for what it holds, the window's own record
      // (668), and since UI-004 for every conversation the rail lists
      said.value = new Map([
        ['sess_ada', { facets: { doing: 'idle' } as AgentFacets, word: 'idle' }],
      ])
      await nextTick()
      // 🔴 **the fix** — the rail's row, drawn on the SAME element: no remount happened
      expect(m.q('forest-row-sess_ada')).toBe(node)
      expect(plate('sess_ada').dataset.doing).toBe('idle')
      expect(node.querySelector('[data-cy="forest-says"]')?.textContent?.trim()).toBe('idle')
      expect(node.querySelector('[data-cy="forest-open"]')).toBe(pressed)
      // ⛔ the CONTROL — a conversation the rail does not name is faceless and says no word
      expect(plate('sess_ali').dataset.doing).toBe('unknown')
      expect(m.q('forest-row-sess_ali').querySelector('[data-cy="forest-says"]')).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the pieces stay reachable on the node
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a layout change is not a removal of facts', () => {
    it('🔴 the three newest pieces show, the earlier ones are one press away, and each keeps its whole title', async () => {
      const rows = [
        conv('sess_ada', null),
        ...[1, 2, 3, 4, 5].map((n) => task('sess_ada', `work_${String(n)}`, n)),
      ]
      const m = await drawForest(viewOf(rows))
      const shown = (): string[] =>
        m.all('forest-task-number').map((el) => (el.textContent ?? '').trim())
      // ⚑ the three NEWEST — the fold lists oldest first, and the one an agent is on is the last
      expect(shown()).toEqual(['W1.3', 'W1.4', 'W1.5'])
      const more = m.q('forest-more')
      expect(more.textContent?.trim()).toBe('2 earlier')
      more.click()
      await nextTick()
      expect(shown()).toEqual(['W1.1', 'W1.2', 'W1.3', 'W1.4', 'W1.5'])
      expect(m.q('forest-more').getAttribute('aria-expanded')).toBe('true')
      // ⚑ the whole title, on the line a person points at (D-016: the title is the one-line name,
      // and its own hover)
      expect(
        m.q('forest-row-work_5').querySelector('[data-cy="forest-task"]')!.getAttribute('title'),
      ).toBe('the whole title of work_5, long enough that a card of this width has to cut it')
      // ⛔ the CONTROL — three pieces draw no press at all
      const three = await drawForest(
        viewOf([conv('sess_ali', null), ...[1, 2, 3].map((n) => task('sess_ali', `t${n}`, n))]),
      )
      expect(three.all('forest-more')).toHaveLength(0)
    })

    // ⚑ **D-016 · *why a conversation was started* went with its subject** — there is no spawn
    // reason (a child starts with a give, and the piece's title is the name), so the press's hover
    // is its own words on every node. What a card cuts still carries its own.
    it('🔴 every text a card can cut carries its own — and every press says what it does', async () => {
      const rows = [
        conv('sess_b', null),
        conv('sess_ada', 'sess_b', {
          identity: 'a-very-long-identity-slug-that-a-card-this-narrow-cuts',
        }),
      ]
      const m = await drawForest(viewOf(rows))
      const card = m.q('forest-row-sess_ada')
      // ⚑ D-017b · the one press's words, on a child and on a root alike
      expect(card.querySelector('[data-cy="forest-open"]')!.getAttribute('title')).toBe(
        OPEN_THE_CONVERSATION,
      )
      expect(
        m.q('forest-row-sess_b').querySelector('[data-cy="forest-open"]')!.getAttribute('title'),
      ).toBe(OPEN_THE_CONVERSATION)
      // ⚑ each clipper recovers its own string
      const slug = card.querySelector<HTMLElement>('[data-cy="forest-slug"]')!
      expect(slug.getAttribute('title')).toBe(
        'a-very-long-identity-slug-that-a-card-this-narrow-cuts',
      )
      expect(slug.scrollWidth, 'the premise: this slug IS cut').toBeGreaterThan(slug.clientWidth)
      expect(card.querySelector('[data-cy="forest-name"]')!.getAttribute('title')).toBeTruthy()
    })
  })
})

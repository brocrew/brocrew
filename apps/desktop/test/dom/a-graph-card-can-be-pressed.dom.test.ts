import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import TeamForest from '../../src/renderer/src/components/TeamForest.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { ForestRow } from '../../src/renderer/src/lib/the-forest'
import type { AgentIdentity, KeptFile } from '../../src/shared/runtime-ipc'
import { conv, forestDrawn, task, viewOf } from './forest-fixture'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 UI-005 · a card on the Graph can be pressed — and a press never pans
 *
 * Vue Flow gives a node with no drag, selection, or listener `pointer-events: none`, so a
 * card press can fall through and pan the pane. Dispatching a click ignores `pointer-events`
 * and can falsely pass. Ask `document.elementFromPoint` what a press at the card’s center
 * reaches, read computed `pointer-events`, and click the actual hit target.
 *
 * A card press reaches the card and selects its agent. A count or “N earlier” performs its
 * own action and selects nobody; the card is `nopan`. The Team page’s shared forest is
 * pressable too. A double press is simply two presses, with no separate double-click action.
 *
 * ⛔ **Every negative here is paired with the same mount one fact over** — the pane between cards
 * beside a card, a control on a card beside the card's own body — because a press that reached
 * nothing would pass every absence.
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
  ['project-manager', 'Ada'],
  ['brobot', 'BroBot'],
  ['inspector', 'Ana'],
  ['dev', 'Arjun'],
].map(([slug, displayName]) => ({
  id: `aid:${slug!}`,
  slug,
  displayName,
})) as unknown as AgentIdentity[]

/** ⚑ Ada started this conversation; it started Ana and Arjun, and gave Ana five pieces. */
const ROWS = () => [
  conv('sess_boss', null, { identity: 'project-manager' }),
  conv(ID, 'sess_boss', { identity: 'brobot' }),
  conv('sess_ana', ID, { identity: 'inspector' }),
  conv('sess_arjun', ID, { identity: 'dev' }),
  ...[1, 2, 3, 4, 5].map((n) =>
    task('sess_ana', `work_${String(n)}`, `W1.${String(n)}`, `Piece ${String(n)}`, ID),
  ),
]

const kept = (piece: string, label: string): KeptFile => ({
  resourceId: `res_${piece}`,
  title: piece,
  name: `${piece}.md`,
  form: 'markdown',
  bytes: 10,
  role: 'made',
  keptAt: 1,
  sha256: piece.padEnd(64, '0'),
  addedBy: null,
  piece,
  label,
  pieceTitle: null,
})

const card = (m: Mounted, id: string): HTMLElement => m.q(`forest-row-${id}`)

/** ⚑ What a press at the element's centre really lands on — the engine's own hit test. */
function hit(el: Element): Element {
  const box = el.getBoundingClientRect()
  const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  expect(at, 'a press there lands on nothing').not.toBeNull()
  return at!
}

/** ⚑ A press where a person would press it — a click on whatever the hit test found there. */
async function pressAt(el: Element): Promise<void> {
  hit(el).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await nextTick()
}

/** ⚑ A double press there, as a browser sends it: two clicks, then the double-click. */
async function doubleAt(el: Element): Promise<void> {
  const at = hit(el)
  for (const detail of [1, 2]) {
    at.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }))
    await nextTick()
  }
  at.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
  await nextTick()
}

async function graph(opened: string[] = [], band: string[] = []): Promise<Mounted> {
  const cast = useWhoCalledWhom()
  cast.goTo.value = (conversation) => opened.push(conversation)
  cast.treeFiles.value = {
    conversation: ID,
    files: [kept('work_5', 'W1.5')],
    answered: true,
  }
  await page.viewport(1200, 808)
  const m = mount(
    ConversationPane,
    paneProps({
      forest: viewOf(ROWS(), IDS),
      identities: IDS,
      onReadResource: async () => ({ ok: false, reason: 'no-store' }),
      // ⚑ The right panel shown — what a press on a CARD does, and a count must not.
      'onUpdate:drawerTab': (tab: string) => band.push(`tab:${tab}`),
      onToggleDrawer: () => band.push('toggle'),
    }),
    { width: 1200, height: 808 },
  )
  await nextTick()
  m.q('main-tab-graph').click()
  await forestDrawn()
  await forestDrawn()
  return m
}

describe('a card on the Graph can be pressed', () => {
  it('🔴 a press at a card’s centre lands ON the card — its node takes pointer events, and the card is `nopan`', async () => {
    const m = await graph()
    for (const id of ['sess_boss', ID, 'sess_ana', 'sess_arjun']) {
      const one = card(m, id)
      expect(visible(one)).toBe(true)
      expect(one.contains(hit(one)), `a press on ${id}'s card fell through`).toBe(true)
      const node = one.closest<HTMLElement>('.vue-flow__node')!
      expect(getComputedStyle(node).pointerEvents, `${id}'s node`).toBe('all')
      expect(one.classList.contains('nopan')).toBe(true)
    }
    // ⚑ The pair: in the gap between two sibling cards a press lands on the pane, which is where a
    // drag pans. The graph runs left to right, so siblings are stacked: the gap is between them.
    const ana = card(m, 'sess_ana').getBoundingClientRect()
    const arjun = card(m, 'sess_arjun').getBoundingClientRect()
    const [upper, lower] = ana.top < arjun.top ? [ana, arjun] : [arjun, ana]
    expect(lower.top, 'the two siblings overlap, so there is no gap to press').toBeGreaterThan(
      upper.bottom,
    )
    const gap = document.elementFromPoint(
      (Math.max(upper.left, lower.left) + Math.min(upper.right, lower.right)) / 2,
      (upper.bottom + lower.top) / 2,
    )
    expect(gap?.closest('[data-kind="a-conversation"]')).toBeNull()
    expect(gap?.closest('.vue-flow')).not.toBeNull()
  })

  it('🔴 one click on a card selects that agent — ⛔ a double press is two presses and nothing more', async () => {
    const opened: string[] = []
    const m = await graph(opened)
    const target = card(m, 'sess_ana').querySelector(
      '[data-cy="forest-says"], [data-cy="forest-name"]',
    )!
    await pressAt(target)
    expect(opened).toEqual(['sess_ana'])
    // ⛔ No double-click (F045): the same card pressed twice over selects it twice, and that is all.
    await doubleAt(target)
    expect(opened).toEqual(['sess_ana', 'sess_ana', 'sess_ana'])
    expect(m.q('main-tab-graph').getAttribute('aria-selected')).toBe('true')
  })

  it('⛔ a count or *earlier* on a card does its own thing and selects nobody — the card’s body beside it does', async () => {
    const band: string[] = []
    const opened: string[] = []
    const m = await graph(opened, band)
    const ana = card(m, 'sess_ana')
    // ⚑ *earlier*: opens out Ana's older pieces, and selects no agent.
    const more = ana.querySelector<HTMLElement>('[data-cy="forest-more"]')!
    await pressAt(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(opened).toEqual([])
    // ⚑ The file count: the Files tab, at W1.5, and no agent selected.
    const count = ana.querySelector<HTMLElement>('[data-cy="forest-task-files"]')!
    await pressAt(count)
    expect(m.q('main-tab-files').getAttribute('aria-selected')).toBe('true')
    expect(opened).toEqual([])
    // ⛔ …and neither showed the right panel, as a press on a card does.
    expect(band).toEqual([])
    // ⚑ The pair on the same mount: back on the Graph, the card's own body selects Ana.
    m.q('main-tab-graph').click()
    await forestDrawn()
    await pressAt(card(m, 'sess_ana').querySelector('[data-cy="forest-name"]')!)
    expect(opened).toEqual(['sess_ana'])
    expect(band).toEqual(['tab:open', 'toggle'])
  })
})

describe('the Team page’s forest can be pressed too', () => {
  it('🔴 a press at a card’s centre lands on it and presses it — the Team page opens that conversation', async () => {
    const pressed: ForestRow[] = []
    const m = mount(
      TeamForest,
      { view: viewOf(ROWS(), IDS), onPress: (row: ForestRow) => pressed.push(row) },
      { width: 1100, height: 700 },
    )
    await forestDrawn()
    await forestDrawn()
    const ana = card(m, 'sess_ana')
    const target = hit(ana)
    expect(ana.contains(target)).toBe(true)
    expect(getComputedStyle(ana.closest<HTMLElement>('.vue-flow__node')!).pointerEvents).toBe('all')
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(pressed.map((row) => row.conversation)).toEqual(['sess_ana'])
  })
})

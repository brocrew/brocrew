import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { useRailFold } from '../../src/renderer/src/composables/useRailFold'
import {
  COLLAPSE_THE_MENU,
  EXPAND_THE_MENU,
  RAIL_NARROW_BELOW,
  RAIL_W_COLLAPSED,
} from '../../src/renderer/src/lib/rail-fold'
import { drawnInFull, drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * The left menu collapses to its icons: each destination keeps its icon and its name, and each
 * conversation is its avatar and its work label, with the whole title on hover. The window collapses
 * it by itself below its narrow width, and a person's choice is remembered for a wide window.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const CHOSEN_KEY = 'brobot2.railCollapsed'

const CONVERSATIONS = [
  { id: 'sess_ada', label: 'Ada', title: 'W1.2 · Landing page header', needsYou: false },
  { id: 'sess_ali', label: 'Ali', title: 'W1.3 · Contact form', needsYou: true },
  { id: 'sess_bro', label: 'BroBot', title: null, needsYou: false },
]

afterEach(async () => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

async function rail(collapsed: boolean, width = RAIL_W_COLLAPSED): Promise<Mounted> {
  window.api = {
    runtime: {
      listResumable: async () =>
        CONVERSATIONS.map((one, index) => ({
          sessionId: one.id,
          provider: 'claude',
          cwd: '/work',
          status: 'idle',
          state: { is: one.needsYou ? 'needs-you' : 'idle' },
          label: one.label,
          profileId: 'default',
          named:
            one.title === null
              ? null
              : { label: one.title.split(' · ')[0], title: one.title.split(' · ')[1] },
          updatedAt: Date.now() - index * 60_000,
          createdAt: Date.now() - 3_600_000,
          running: 'unwatched',
          inAnotherWindow: false,
        })),
      listUnresumable: async () => [],
    },
  } as never
  const m = mount(
    SideRail,
    { open: [], activeId: 'sess_ada', place: null, collapsed },
    { width, height: 900 },
  )
  await new Promise((done) => setTimeout(done, 30))
  await nextTick()
  await drawnReady()
  return m
}

const row = (m: Mounted, id: string): HTMLElement => m.q(`open-session-${id}`)

describe('the collapsed menu', () => {
  it('🔴 the toggle says what a press does, and is a button a key reaches', async () => {
    const open = await rail(false, 251.68)
    const press = open.q('rail-fold') as HTMLButtonElement
    expect(press.type).toBe('button')
    expect(press.getAttribute('aria-expanded')).toBe('true')
    expect(press.getAttribute('aria-label')).toBe(COLLAPSE_THE_MENU)
    expect(press.title).toBe(COLLAPSE_THE_MENU)
    press.focus()
    expect(document.activeElement).toBe(press)
    open.unmount()

    const shut = await rail(true)
    const again = shut.q('rail-fold')
    expect(again.getAttribute('aria-expanded')).toBe('false')
    expect(again.getAttribute('aria-label')).toBe(EXPAND_THE_MENU)
    expect(again.title).toBe(EXPAND_THE_MENU)
  })

  it('⛔ every destination keeps its name and its words on hover, and nothing leaves the column', async () => {
    const m = await rail(true)
    // ⚑ The column is the box the app gives the collapsed menu, and the menu stays inside it.
    const column = m.host.getBoundingClientRect()
    expect(Math.round(column.width)).toBe(RAIL_W_COLLAPSED)
    expect(m.q('side-rail').getBoundingClientRect().right).toBeLessThanOrEqual(column.right + 0.5)
    for (const [cy, word] of [
      ['rail-waiting', 'Waiting on you'],
      ['rail-away', 'Recent activity'],
      ['rail-sessions', 'All conversations'],
      ['rail-team', 'Team'],
      ['rail-settings', 'Settings'],
      ['new-conversation', 'New conversation'],
    ] as const) {
      const press = m.q(cy)
      expect(press.textContent, cy).toContain(word)
      expect(press.title, cy).toBe(word)
      const box = press.getBoundingClientRect()
      expect(box.left, cy).toBeGreaterThanOrEqual(column.left - 0.5)
      expect(box.right, cy).toBeLessThanOrEqual(column.right + 0.5)
      // ⚑ Its words are not drawn; its icon is.
      expect(press.querySelector('svg.icon')!.getBoundingClientRect().width, cy).toBeGreaterThan(0)
    }
  })

  it('🔴 a conversation is its avatar and its work label, its whole title on hover, its needs-you mark kept', async () => {
    const m = await rail(true)
    const ali = row(m, 'sess_ali')
    expect(m.q('rail-work-label-sess_ali').textContent?.trim()).toBe('W1.3')
    expect(ali.title).toBe('W1.3 · Contact form')
    expect(ali.getAttribute('aria-label')).toBe('W1.3 · Contact form')
    // ⚑ The avatar draws the needs-you facet, as in the full menu.
    const mark = ali.querySelector<HTMLElement>('[data-cy="agent-needing"]')
    expect(mark, 'the needs-you mark left the avatar').not.toBeNull()
    expect(mark!.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(row(m, 'sess_ada').querySelector('[data-cy="agent-needing"]')).toBeNull()
    // ⚑ A conversation no work names is its avatar alone.
    expect(m.all('rail-work-label-sess_bro')).toHaveLength(0)
    const bro = row(m, 'sess_bro')
    expect(bro.title).not.toBe('')
    expect(bro.title).toBe(bro.getAttribute('aria-label'))
    // …and in the full menu no row draws a work label at all.
    unmountAll()
    const full = await rail(false, 251.68)
    expect(full.all('rail-work-label-sess_ali')).toHaveLength(0)
    expect(row(full, 'sess_ali').title).toBe('')
  })
})

describe('when the menu is collapsed', () => {
  it('🔴 below the narrow width by itself; a press opens it only until the window widens; wide, the choice is remembered', async () => {
    localStorage.removeItem(CHOSEN_KEY)
    await page.viewport(RAIL_NARROW_BELOW - 80, 800)
    const fold = useRailFold()
    const settle = async (): Promise<void> => {
      await new Promise((done) => setTimeout(done, 30))
      await nextTick()
    }
    await settle()
    expect(fold.collapsed.value, 'narrow').toBe(true)
    fold.toggle()
    expect(fold.collapsed.value, 'opened while narrow').toBe(false)
    expect(localStorage.getItem(CHOSEN_KEY)).toBeNull()

    await page.viewport(RAIL_NARROW_BELOW + 120, 800)
    await settle()
    expect(fold.collapsed.value, 'wide, nothing chosen').toBe(false)
    fold.toggle()
    await settle()
    expect(fold.collapsed.value, 'wide, collapsed by a press').toBe(true)
    expect(localStorage.getItem(CHOSEN_KEY)).toBe('true')

    // ⚑ Narrow again: collapsed by itself, and the press made while narrow before is forgotten.
    fold.toggle()
    await settle()
    await page.viewport(RAIL_NARROW_BELOW - 80, 800)
    await settle()
    expect(fold.collapsed.value, 'narrow again').toBe(true)
    localStorage.removeItem(CHOSEN_KEY)
  })
})

describe('the expanded menu’s brand row', () => {
  // ⚑ 208px is the narrowest row it has been drawn in, where the chip and "Control room" wrapped
  // to two lines; the shipped widths have room to spare.
  it.each([208, 251.68, 266.2])(
    '🔴 at %ipx the ⌘K chip and each brand line stay on one line, inside the row',
    async (width) => {
      const m = await rail(false, width)
      const row = m.q('side-rail').querySelector<HTMLElement>('.brand-row')!
      const box = row.getBoundingClientRect()
      const chip = m.q('command-palette')
      // ⚑ One line: the chip is its own 26px, never two stacked glyphs.
      expect(chip.getBoundingClientRect().height).toBeLessThanOrEqual(26.5)
      expect(chip.getClientRects()).toHaveLength(1)
      for (const line of row.querySelectorAll<HTMLElement>(
        '.brand-copy strong, .brand-copy span',
      )) {
        const lineHeight = parseFloat(getComputedStyle(line).lineHeight) || 20
        expect(line.getBoundingClientRect().height, line.textContent ?? '').toBeLessThanOrEqual(
          lineHeight + 1,
        )
      }
      for (const el of [chip, m.q('rail-fold')]) {
        expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(box.right + 0.5)
      }
      // ⚑ The whole name is on the block's title, for when a narrower row cuts it.
      expect(row.querySelector('.brand-copy')!.getAttribute('title')).toBe('BroCrew · Control room')
    },
  )

  it('🔴 a longer name is cut inside the row and never widens the menu', async () => {
    const m = await rail(false, 200)
    const menu = m.q('side-rail')
    const before = menu.getBoundingClientRect().width
    const name = menu.querySelector<HTMLElement>('.brand-copy strong')!
    name.textContent = 'BroCrew '.repeat(12)
    await nextTick()
    expect(menu.getBoundingClientRect().width).toBe(before)
    // ⚑ The control: the name really is longer than its line, so the row had something to cut.
    expect(drawnInFull(name)).toBe(false)
    for (const el of [m.q('command-palette'), m.q('rail-fold')]) {
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(
        menu.querySelector('.brand-row')!.getBoundingClientRect().right + 0.5,
      )
    }
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED_FILE from '../../resources/themes/defined/theme.json'
import {
  openAChildsWork,
  openEverySubAgent,
  pointAtTheWorkflow,
  stackingWindow,
} from './a-window-with-a-workflow-and-nested-agents'
import { unmountAll } from './harness'
import { readsAt, see, shownUnder } from './what-is-painted-under'

/**
 * Three stacks the window paints, each read off the real window: a workflow's head under the
 * pointer, the child-work viewer over the overlay's wash, and a sub-agent nested three deep. Each
 * theme here is refused by the readability check, or accepted, for exactly what the window draws.
 */

const BASE = (() => {
  const read = validateTheme(DEFINED_FILE, {
    assets: new Map(),
    builtIns: new Map(),
    builtIn: true,
  })
  if (!read.ok) throw new Error(JSON.stringify(read.problems))
  return read.theme
})()

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  applyTheme(null)
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const FLAT = { page: 0, tint: 0 }

/** `own` over Defined, as the check reads it, then worn by the window. */
function wear(own: Record<string, unknown>): ReturnType<typeof validateTheme> {
  const file = { format: 1, id: 'stacks', name: 'Stacks', extends: 'defined', ...own }
  const read = validateTheme(file, { assets: new Map(), builtIns: new Map([['defined', BASE]]) })
  applyTheme(resolveTheme(file as never, BASE))
  return read
}

describe('the stacks the window paints', () => {
  it('a workflow’s head under the pointer: its faint status on the second wash over the first', async () => {
    // Faint text that reads on the block's one wash, and not on the head's second wash over it.
    const read = wear({
      shared: FLAT,
      tokens: { content: { faint: '#6e6e6e', 'panel-2': '#ffffff', 'panel-3': '#ffffff' } },
    })
    expect(read.ok, 'the check refuses it').toBe(false)
    // Exactly one refusal, for faint text on the second wash over the first: one wash reads 4.5.
    if (!read.ok)
      expect(read.problems).toEqual([
        expect.objectContaining({
          at: 'content.ink',
          says: expect.stringMatching(
            /^Faint text on the page would be too faint: 4\.4 to 1 against the page,/,
          ),
        }),
      ])
    const m = await stackingWindow()
    const head = await pointAtTheWorkflow(m)
    expect(
      see(getComputedStyle(head).backgroundColor).a,
      'the head takes its wash',
    ).toBeGreaterThan(0)
    const status = head.querySelector('[data-cy="workflow-status"]')
    expect(status, 'the head says how the run stands').not.toBeNull()
    const reading = await readsAt(status!)
    expect(reading.is).toBe('read')
    if (reading.is === 'read') expect(reading.ratio).toBeLessThan(4.5)
  })

  it('the child-work viewer: its part on its panel over the overlay’s wash', async () => {
    const read = wear({
      shared: FLAT,
      tokens: { content: { 'drawer-bg': 'rgb(255 255 255 / 30%)', 'accent-2-text': '#606060' } },
    })
    expect(read.ok, 'the check refuses it').toBe(false)
    // Exactly one refusal, for the viewer's words on its see-through panel over the overlay's wash.
    if (!read.ok)
      expect(read.problems).toEqual([
        expect.objectContaining({
          at: 'tokens.content.accent-2-text',
          says: expect.stringMatching(
            /^Links in the right-hand panel would be too faint: 4\.3 to 1 against the right-hand panel over the page over the page,/,
          ),
        }),
      ])
    const m = await stackingWindow()
    await openAChildsWork(m)
    const part = document.querySelector('[data-cy="child-work-part"]')
    expect(part, 'the viewer is open').not.toBeNull()
    expect(part!.closest('[data-cy="overlay-host"]'), 'inside the overlay').not.toBeNull()
    const reading = await readsAt(part!)
    expect(reading.is).toBe('read')
    if (reading.is === 'read') expect(reading.ratio).toBeLessThan(4.5)
  })

  it('a sub-agent nested three deep stands on the outermost card’s one wash', async () => {
    const read = wear({ shared: FLAT, tokens: { content: { 'accent-2-text': '#6b6b6b' } } })
    expect(read.ok, 'the check accepts it').toBe(true)
    const m = await stackingWindow()
    await openEverySubAgent(m)
    const cards = [...m.host.querySelectorAll<HTMLElement>('.subagent')]
    expect(cards.length, 'three nested cards').toBeGreaterThanOrEqual(3)
    const outer = cards[0]!
    const deepest = cards[cards.length - 1]!
    expect(deepest.parentElement!.closest('.subagent'), 'the last card is nested').not.toBeNull()
    deepest.scrollIntoView({ block: 'center' })
    const deep = await shownUnder(deepest)
    outer.scrollIntoView({ block: 'start' })
    const top = await shownUnder(outer)
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1
    expect(near(deep.r, top.r) && near(deep.g, top.g) && near(deep.b, top.b)).toBe(true)
  })
})

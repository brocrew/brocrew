import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import { definedTheme as BASE } from './defined-theme.fixture'
import {
  openAChildsWork,
  pointAtTheWorkflow,
  stackingWindow,
} from './a-window-with-a-workflow-and-nested-agents'
import { unmountAll } from './harness'
import { readsAt, see } from './what-is-painted-under'



const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  applyTheme(null)
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const FLAT = { page: 0, tint: 0 }

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
    expect(read.ok).toBe(true)
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
    expect(read.ok).toBe(true)
    const m = await stackingWindow()
    await openAChildsWork(m)
    const part = document.querySelector('[data-cy="child-work-part"]')
    expect(part, 'the viewer is open').not.toBeNull()
    expect(part!.closest('[data-cy="overlay-host"]'), 'inside the overlay').not.toBeNull()
    const reading = await readsAt(part!)
    expect(reading.is).toBe('read')
    if (reading.is === 'read') expect(reading.ratio).toBeLessThan(4.5)
  })
})

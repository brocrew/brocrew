import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type Component, type PropType } from 'vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import { assertClippedButTold, assertDrawn, cutsOf, drawnReady, inkRects } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const TITLE_BEFORE = document.title
const FLOOR = 1180
const INFO = {
  name: 'BroCrew',
  version: '0.0.0',
  step: '',
  build: { id: 'e76e7c6', commit: 'e76e7c6'.padEnd(40, '0'), dirty: false },
  db: { migrationsApplied: 24, providerSessionCount: 0 },
}
const FOLDER = 'isolated-bakery-menu-design-review-'.repeat(8).slice(0, 255)

const TheAppFrame = defineComponent({
  props: { info: { type: Object as PropType<Record<string, unknown> | null>, default: null } },
  setup(props) {
    return () =>
      h(
        'div',
        {
          style: {
            display: 'grid',
            width: '100vw',
            height: '100%',
            minWidth: 'var(--app-min-w)',
            gridTemplateRows: 'var(--titlebar-h) 1fr',
          },
        },
        [h(AppTitleBar as Component, { info: props.info, error: null })],
      )
  },
})

async function theBar(info: Record<string, unknown> | null): Promise<Mounted> {
  await page.viewport(FLOOR, 840)
  const m = mount(TheAppFrame, { info }, { width: FLOOR, height: 32 })
  await nextTick()
  await drawnReady()
  expect(Math.round(m.q('app-titlebar').getBoundingClientRect().width)).toBe(FLOOR)
  return m
}

function theName(m: Mounted): HTMLElement {
  const name = m.q('window-title').querySelector<HTMLElement>('strong')
  expect(name).not.toBeNull()
  return name!
}

afterEach(async () => {
  unmountAll()
  document.title = TITLE_BEFORE
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('a window on another data folder', () => {
  it.each([120, 255])(
    'cuts a %i-character folder at the end and keeps its full name on hover',
    async (length) => {
      const whole = `BroCrew — ${FOLDER.slice(0, length)}`
      const m = await theBar({ ...INFO, windowTitle: whole })
      const name = theName(m)
      const title = m.q('window-title').getBoundingClientRect()
      const usage = m.q('app-usage').getBoundingClientRect()
      expect(name.textContent).toBe(whole)
      expect(document.title).toBe(whole)
      expect(m.q('window-title').title).toBe(whole)
      expect(title.left).toBeGreaterThanOrEqual(0)
      expect(title.right).toBeLessThanOrEqual(usage.left + 0.5)
      expect(usage.width).toBeGreaterThan(0)
      expect(Math.min(...inkRects(name).map((rect) => rect.left))).toBeGreaterThanOrEqual(
        name.getBoundingClientRect().left - 0.5,
      )
      assertClippedButTold(name, 'the long data folder title', m.host)
      expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
    },
  )

  it.each(['BroCrew — seat-fe', 'BroCrew — test'])(
    'draws %s whole and updates the OS title',
    async (whole) => {
      const m = await theBar({ ...INFO, windowTitle: whole })
      const name = theName(m)
      expect(name.textContent).toBe(whole)
      expect(document.title).toBe(whole)
      assertDrawn(name, 'the window title', m.host)
      expect(cutsOf(name, m.host)).toEqual([])
      expect(m.q('window-title').getBoundingClientRect().right).toBeLessThanOrEqual(
        m.q('app-usage').getBoundingClientRect().left + 0.5,
      )
    },
  )

  it.each([null, INFO])(
    'uses BroCrew without a tooltip before a window name arrives (%s)',
    async (info) => {
      document.title = 'Previous OS title'
      const m = await theBar(info)
      expect(theName(m).textContent).toBe('BroCrew')
      expect(document.title).toBe('Previous OS title')
      expect(m.q('window-title').hasAttribute('title')).toBe(false)
      assertDrawn(theName(m), 'the fallback title', m.host)
    },
  )
})

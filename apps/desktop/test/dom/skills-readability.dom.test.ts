import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { READABILITY_THEMES } from '../../look/fixtures/readability-themes'
import { settingsWindow } from '../../look/fixtures/settings-window'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { mount, unmountAll } from './harness'
import { paintedReadings } from './what-is-painted-under'
afterEach(() => {
  unmountAll()
  applyTheme(null)
  Reflect.deleteProperty(window, 'api')
})
it.each(READABILITY_THEMES.flatMap((theme) => [760, 1180].map((width) => ({ theme, width }))))(
  'reads the whole simplified Skills window in $theme at $width',
  async ({ theme, width }) => {
    await page.viewport(width, 900)
    const m = mount(settingsWindow('skills', theme), {}, { width, height: 900 })
    await vi.waitFor(() => expect(m.all('skill-row')).toHaveLength(2))
    for (const detail of m.all('skill-detail')) (detail as HTMLDetailsElement).open = true
    const all = await paintedReadings(document.body)
    expect(all.filter((one) => one.reading.is === 'read').length).toBeGreaterThan(10)
    expect(
      all
        .filter(
          ({ node }) =>
            !node.parentElement?.closest(
              ':disabled,[aria-disabled="true"],svg,option,script,style,[hidden]',
            ),
        )
        .filter(
          ({ reading }) =>
            reading.is === 'unread' || (reading.is === 'read' && reading.ratio < 4.5),
        )
        .map(({ node, reading }) => ({ text: node.textContent?.trim(), reading })),
    ).toEqual([])
    expect(m.host.scrollWidth).toBeLessThanOrEqual(width)
    const button = m.q('skill-toggle').getBoundingClientRect()
    expect(button.width).toBeGreaterThan(0)
    expect(button.right).toBeLessThanOrEqual(width)
  },
)

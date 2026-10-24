import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { settingsWindow } from '../../look/fixtures/settings-window'
import { READABILITY_THEMES } from '../../look/fixtures/readability-themes'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { mount, unmountAll } from './harness'
import { paintedReadings, readsAt } from './what-is-painted-under'

afterEach(() => {
  unmountAll()
  applyTheme(null)
  Reflect.deleteProperty(window, 'api')
})
it.each(READABILITY_THEMES)('reads the Providers helper in the whole %s window', async (theme) => {
  await page.viewport(1180, 900)
  const m = mount(settingsWindow('providers', theme), {}, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('provider-row')).toHaveLength(2))
  const helper = m.q('providers-per-workspace')
  expect(helper.textContent?.trim()).not.toBe('')
  const reading = await readsAt(helper)
  expect(reading.is).toBe('read')
  if (reading.is === 'read') expect(reading.ratio).toBeGreaterThanOrEqual(4.5)
  const all = await paintedReadings(document.body)
  expect(all.some(({ node }) => helper.contains(node))).toBe(true)
  const failures = all
    .filter(
      ({ node }) =>
        !node.parentElement?.closest(
          ':disabled, [aria-disabled="true"], svg, option, script, style, [hidden]',
        ),
    )
    .filter(
      ({ reading }) => reading.is === 'unread' || (reading.is === 'read' && reading.ratio < 4.5),
    )
    .map(({ node, reading }) => ({ text: node.textContent?.trim(), reading }))
  expect(failures).toEqual([])
})

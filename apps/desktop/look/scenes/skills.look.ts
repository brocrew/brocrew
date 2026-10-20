import { boxOf, crop, scene } from '../capture'
import { settingsWindow } from '../fixtures/settings-window'
import { settle } from '../fixtures/window'
import { expect, vi } from 'vitest'

scene('skills', async (stage) => {
  const m = stage.mount(settingsWindow('skills', 'classic'), {})
  await vi.waitFor(() => expect(m.all('skill-row')).toHaveLength(2))
  for (const detail of m.all('skill-detail')) (detail as HTMLDetailsElement).open = true
  await settle()
  await crop(`skills-on-${stage.width}`, boxOf(m.q('skills-section')))
  m.q('skill-toggle').click()
  await vi.waitFor(() => expect(m.q('skill-toggle').textContent).toBe('Turn on'))
  await settle()
  await crop(`skills-off-${stage.width}`, boxOf(m.q('skills-section')))
})

import { expect, vi } from 'vitest'
import { scene, crop, boxOf } from '../capture'
import { settingsWindow } from '../fixtures/settings-window'
import { fictionalPlugins } from '../fixtures/plugins'
scene('plugins', async ({ mount, width }) => {
  const f = fictionalPlugins(),
    m = mount(settingsWindow('plugins', 'classic', f.client), {})
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  await crop(`chrome-card-${width}`, boxOf(m.q('plugin-card')))
})

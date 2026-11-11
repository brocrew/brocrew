import { afterEach, expect, it, vi } from 'vitest'
import { mount, unmountAll } from './harness'
import { settingsWindow } from '../../look/fixtures/settings-window'
import { fictionalPlugins } from '../../look/fixtures/plugins'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
afterEach(() => {
  unmountAll()
  applyTheme(null)
  Reflect.deleteProperty(window, 'api')
})
it('shows installed and available versions from fictional plugin cards', async () => {
  const f = fictionalPlugins()
  f.set([
    {
      id: 'fictional-orchid',
      name: 'Fictional Orchid',
      installed: true,
      state: 'Running',
      installedVersion: '1.2.0',
      updateVersion: '1.3.0',
    },
    {
      id: 'fictional-fern',
      name: 'Fictional Fern',
      installed: true,
      state: 'Running',
      installedVersion: '2.4.1',
    },
    { id: 'fictional-moss', name: 'Fictional Moss', installed: false, state: 'Available' },
    { id: 'fictional-lichen', name: 'Fictional Lichen', installed: true, state: 'Unavailable' },
  ])
  const m = mount(settingsWindow('plugins', 'classic', f.client), {}, { width: 1100, height: 720 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(4))
  expect(m.all('plugin-version').map((line) => line.textContent?.trim())).toEqual([
    'Version 1.2.0 · Update available: 1.3.0',
    'Version 2.4.1',
  ])
  expect(f.calls.filter((call) => call.kind === 'list')).toHaveLength(1)
})

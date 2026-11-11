import { expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SettingsScreen from '../src/renderer/src/components/SettingsScreen.vue'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

// These separate Settings features still use browser defaults on this exact base.
vi.mock('../src/renderer/src/composables/useDockLabel', () => ({ useDockLabel: () => ({}) }))
vi.mock('../src/renderer/src/composables/useTranscriptRetention', () => ({
  useTranscriptRetention: () => ({}),
}))
vi.mock('../src/renderer/src/components/ToolsRegister.vue', () => ({
  default: { render: () => null },
}))

it('captures the injected client without reading plugin availability during server rendering', async () => {
  expect(typeof window).toBe('undefined')
  const unused = (): never => {
    throw new Error('No browser reads during Settings server rendering')
  }
  const plugins = vi.fn(unused)
  const client = createDesktopProviderApi(unused, unused, undefined, undefined, undefined, plugins)
  const app = createSSRApp(SettingsScreen, {
    tab: 'tools',
    capabilities: null,
    warnings: null,
    clock: 1,
  }).provide(CLIENT_PROVIDERS, client)
  const html = await renderToString(app)
  expect(html).toContain('Settings')
  expect(plugins).not.toHaveBeenCalled()
})

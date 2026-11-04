import { expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PluginContributions from '../src/renderer/src/components/PluginContributions.vue'

it('renders without a browser window or an injected plugin controller', async () => {
  expect(typeof window).toBe('undefined')
  const html = await renderToString(
    createSSRApp({ render: () => h(PluginContributions, { surface: 'composer' }) }),
  )
  expect(html).not.toContain('plugin-contributions')
})

it('accepts an explicit controller during server rendering without calling it', async () => {
  const request = vi.fn(),
    onChanged = vi.fn()
  const html = await renderToString(
    createSSRApp({
      render: () => h(PluginContributions, { surface: 'composer', client: { request, onChanged } }),
    }),
  )
  expect(html).toContain('plugin-contributions')
  expect(request).not.toHaveBeenCalled()
  expect(onChanged).not.toHaveBeenCalled()
})

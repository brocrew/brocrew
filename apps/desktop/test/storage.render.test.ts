import { expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import StorageSection from '../src/renderer/src/components/StorageSection.vue'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

it('renders storage without a browser window or native reads', async () => {
  expect(typeof window).toBe('undefined')
  const html = await renderToString(createSSRApp(StorageSection))
  expect(html).toContain('Storage')
  expect(html).not.toContain('Measuring storage')
})

it('resolves the injected storage supplier only when the component captures it', async () => {
  const unused = (): never => {
    throw new Error('No native storage calls while server rendering')
  }
  const storage = vi.fn(() => undefined)
  const client = createDesktopProviderApi(
    unused,
    unused,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    storage,
  )
  expect(storage).not.toHaveBeenCalled()
  await renderToString(createSSRApp(StorageSection).provide(CLIENT_PROVIDERS, client))
  expect(storage).toHaveBeenCalledTimes(1)
})

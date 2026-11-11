import { expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ThemesSection from '../src/renderer/src/components/ThemesSection.vue'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

it('renders theme loading without a browser window or native calls', async () => {
  expect(typeof window).toBe('undefined')
  const html = await renderToString(createSSRApp(ThemesSection))
  expect(html).toContain('data-cy="themes-loading"')
})

it('keeps theme construction and server setup lazy', async () => {
  const unused = (): never => {
    throw new Error('No native calls during rendering')
  }
  const themes = vi.fn(() => undefined)
  const client = createDesktopProviderApi(
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    themes,
  )
  expect(themes).not.toHaveBeenCalled()
  await renderToString(createSSRApp(ThemesSection).provide(CLIENT_PROVIDERS, client))
  expect(themes).not.toHaveBeenCalled()
  expect(client.themes).toBeUndefined()
  expect(themes).toHaveBeenCalledTimes(1)
})

import { expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, provide } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'
import KeptRules from '../src/renderer/src/components/KeptRules.vue'

it('captures the injected client without reading its session getter or any rules during window-free setup', async () => {
  expect(typeof window).toBe('undefined')
  const sessions = vi.fn((): never => {
    throw new Error('Session resolution belongs inside the mounted read')
  })
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    sessions,
  )
  const app = createSSRApp(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(KeptRules, { providers: ['claude', 'codex'] })
      },
    }),
  )
  expect(await renderToString(app)).toContain('Kept rules')
  expect(sessions).not.toHaveBeenCalled()
})

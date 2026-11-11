import { expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, provide } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ClientSessionApi } from '../src/shared/client-session-api'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'
import SessionWork from '../src/renderer/src/components/SessionWork.vue'

it.each([false, true])(
  'sets up a window-free injected work view without starting search (present: %s)',
  async (present) => {
    expect(typeof window).toBe('undefined')
    const searchWork = vi.fn<ClientSessionApi['searchWork']>()
    const sessions = vi.fn(() => (present ? ({ searchWork } as ClientSessionApi) : undefined))
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
          return () => h(SessionWork, { conversation: 'fern', reading: null, identities: null })
        },
      }),
    )
    expect(await renderToString(app)).toContain('Search work')
    expect(sessions).toHaveBeenCalledTimes(1)
    expect(searchWork).not.toHaveBeenCalled()
  },
)

import { expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ClientSessionApi } from '../src/shared/client-session-api'
import { sessionClientView } from './lib/session-client-view'
import SessionWork from '../src/renderer/src/components/SessionWork.vue'

it.each([false, true])(
  'sets up a window-free injected work view without starting search (present: %s)',
  async (present) => {
    expect(typeof window).toBe('undefined')
    const searchWork = vi.fn<ClientSessionApi['searchWork']>()
    const transport: Partial<ClientSessionApi> = { searchWork }
    const sessions = vi.fn(() => (present ? (transport as ClientSessionApi) : undefined))
    const app = createSSRApp(
      sessionClientView(sessions, () =>
        h(SessionWork, { conversation: 'fern', reading: null, identities: null }),
      ),
    )
    expect(await renderToString(app)).toContain('Search work')
    expect(sessions).toHaveBeenCalledTimes(1)
    expect(searchWork).not.toHaveBeenCalled()
  },
)

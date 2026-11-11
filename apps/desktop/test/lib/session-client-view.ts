import { defineComponent, provide, type VNode } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'

export function sessionClientView(
  sessions: () => ClientSessionApi | undefined,
  renderInSetup: () => () => VNode,
) {
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    sessions,
  )
  return defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, api)
      return renderInSetup()
    },
  })
}

import { defineComponent, provide, type InjectionKey, type VNode } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { ClientApi } from '../../src/shared/client-api'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'

export function sessionClientView(
  key: InjectionKey<ClientApi>,
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
      provide(key, api)
      return renderInSetup()
    },
  })
}

import { defineComponent, h, provide, type Component } from 'vue'
import type { ClientApi } from '../../src/shared/client-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { mount } from './harness'

export function mountProviderReadSurface(
  component: Component,
  api: ClientApi,
  props: Record<string, unknown>,
) {
  return mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(component, props)
      },
    }),
    {},
    { width: 1100, height: 900 },
  )
}

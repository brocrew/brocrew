import { shallowReadonly, shallowRef } from 'vue'
import type { ProviderDescriptor } from '@brobot2/shared'
import type { ClientProviderApi } from '../../../shared/client-provider-api'
import { readableError } from '../lib/session-record'

type Catalogue =
  | { readonly state: 'loading' }
  | { readonly state: 'answered'; readonly providers: readonly ProviderDescriptor[] }
  | { readonly state: 'unread'; readonly why: string }

const catalogues = new WeakMap<ClientProviderApi, ReturnType<typeof createCatalogue>>()

function createCatalogue(api: ClientProviderApi) {
  const held = shallowRef<Catalogue>({ state: 'loading' })
  let inFlight: Promise<void> | undefined
  function read(): Promise<void> {
    if (inFlight) return inFlight
    if (held.value.state === 'answered') return Promise.resolve()
    held.value = { state: 'loading' }
    const going: Promise<void> = (async () => {
      try {
        held.value = { state: 'answered', providers: await api.providerCatalogue() }
      } catch (error) {
        held.value = { state: 'unread', why: readableError(error) }
      }
    })().finally(() => {
      if (inFlight === going) inFlight = undefined
    })
    inFlight = going
    return going
  }
  return { held: shallowReadonly(held), read }
}

export function providerCatalogue(api: ClientProviderApi) {
  let catalogue = catalogues.get(api)
  if (!catalogue) {
    catalogue = createCatalogue(api)
    catalogues.set(api, catalogue)
  }
  return catalogue
}

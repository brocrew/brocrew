import { hasInjectionContext, inject, type InjectionKey } from 'vue'
import type { ClientProviderApi } from '../../../shared/client-provider-api'
import type { ClientApi } from '../../../shared/client-api'
import { desktopProviderApi } from './window'

export const CLIENT_PROVIDERS: InjectionKey<ClientApi> = Symbol('client providers')

export function useClientApi(): ClientApi {
  return hasInjectionContext() ? inject(CLIENT_PROVIDERS, desktopProviderApi) : desktopProviderApi
}

export function useClientProviders(): ClientProviderApi {
  return useClientApi()
}

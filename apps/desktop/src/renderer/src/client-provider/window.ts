import { createDesktopProviderApi } from './desktop'

export const desktopProviderApi = createDesktopProviderApi(
  () => window.api.runtime,
  () => window.api?.providerSetup,
  () => window.api?.recoveryRetention,
  () => window.api.runtime,
  () => (typeof window === 'undefined' ? undefined : window.api),
  () => window.api?.plugins,
  () => globalThis.window?.api?.logging,
  () => globalThis.window?.api?.dockLabel,
)

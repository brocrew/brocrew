import { createDesktopProviderApi } from './desktop'

export const desktopProviderApi = createDesktopProviderApi(
  () => window.api.runtime,
  () => window.api?.providerSetup,
  () => window.api?.recoveryRetention,
  () => globalThis.window?.api?.runtime,
  () => (typeof window === 'undefined' ? undefined : window.api),
  () => window.api?.plugins,
  () => globalThis.window?.api?.logging,
  () => globalThis.window?.api?.dockLabel,
  () => window.api.runtime,
  () => globalThis.window?.api?.transcriptRetention,
  () => globalThis.window?.api?.storage,
  () => globalThis.window?.api?.workspaces,
  () => globalThis.window?.api?.themes,
)

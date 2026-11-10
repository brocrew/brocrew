import type {
  ProviderModule as PortableModule,
  ProviderModules as PortableModules,
} from '@brobot2/runtime/provider-module'
import type { DesktopProviderValues } from './desktop-values'

export type {
  ProvisionHome,
  ProviderHomePaths,
  HomeAuthOperations,
  ProviderHomeStrategy,
  ProviderConnectionOperations,
  PreparedProviderLaunch,
} from '@brobot2/runtime/provider-module'
export type ProviderModule = PortableModule<DesktopProviderValues>
export type ProviderModules = PortableModules<DesktopProviderValues>

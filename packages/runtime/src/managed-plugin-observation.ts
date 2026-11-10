import type { ManagedPluginMcpServer } from './managed-plugin-mcp'

export interface ManagedPluginDiscovery {
  readonly server: string
  readonly tools?: readonly string[]
  readonly outcome: 'discovered' | 'unavailable' | 'timeout' | 'cancelled' | 'unknown'
  /** Omitted uses legacy mapping; null records name-only evidence; an object owns its snapshot. */
  readonly route?: Pick<ManagedPluginMcpServer, 'name' | 'url' | 'pluginId'> | null
}
export type ManagedPluginObserver = (event: ManagedPluginDiscovery) => void

/** Observers cannot change provider admission, discovery or dispatch. */
export function observeManagedPlugins(
  observer: ManagedPluginObserver | undefined,
  event: ManagedPluginDiscovery,
): void {
  try {
    observer?.(event)
  } catch {
    /* Diagnostic only. */
  }
}

export interface ManagedPluginDiscovery {
  readonly server: string
  readonly tools: readonly string[]
  readonly outcome: 'discovered' | 'unavailable' | 'timeout' | 'cancelled'
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

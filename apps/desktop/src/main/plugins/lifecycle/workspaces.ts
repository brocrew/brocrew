import type { PluginLifecycleController } from './controller'
import type { WorkspaceProjection } from './types'

/** Consumers share canonical workspace receipts, with independent handles and lifetimes. */
export function sharedLifecycleWorkspaces(
  controller: PluginLifecycleController,
): PluginLifecycleController {
  return new Proxy(controller, {
    get(target, key) {
      if (key === 'attach') return (sink: WorkspaceProjection) => target.attach(sink, true)
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

import { recordPluginToolFailure } from '../tool-diagnostics'
import { sharedLifecycleWorkspaces } from './workspaces'
import { createLifecycleAgentBridge } from './agent-bridge'
import { pluginToolRefusalLog } from './chrome-broker'
import { requirePluginAdapter } from './adapters'
import type { PluginSupervisor } from '../supervisor/owner'
import { createSupervisedPluginHost } from '../supervisor/node-host'
import type { createPluginNodeHost, PluginNodeReady } from '../node-host'
import { PluginLifecycleController } from './controller'
import { servePersonPluginControl } from './person-control'
import type { LifecycleOptions } from './types'

/** Called in the exclusive supervisor process, never in a workspace renderer or agent handler. */
export async function createSupervisorLifecycle(options: {
  owner: PluginSupervisor
  host: ReturnType<typeof createPluginNodeHost>
  lifecycle: Omit<LifecycleOptions, 'runtime'>
  personKey: string
  read(pluginId: string, connection: PluginNodeReady): Promise<unknown>
}) {
  const host = createSupervisedPluginHost(options.owner, options.host)
  const consumer: { agents?: ReturnType<typeof createLifecycleAgentBridge> } = {}
  const controller = sharedLifecycleWorkspaces(
    await PluginLifecycleController.open({
      ...options.lifecycle,
      toolsUnavailable: (id) => consumer.agents?.toolsUnavailable(id) ?? false,
      deny(id) {
        consumer.agents?.deny(id)
        options.lifecycle.deny(id)
      },
      onHostExit: (id, runId) => consumer.agents?.hostExited(id, runId),
      runtime: {
        start: (spec) => host.prepare(spec),
        removeCode: (id, digest) => options.host.removePackage(id, digest),
        removeData: (id) => options.host.removeData(id),
        // PluginSupervisor.start refuses every unclean predecessor before it can issue this seam.
        previousOwnerClean: async () => true,
      },
    }),
  )
  const refused = pluginToolRefusalLog(options.lifecycle.root)
  const agents = createLifecycleAgentBridge({
    owner: options.owner,
    controller,
    binding: (view, diagnostic) =>
      requirePluginAdapter(view.installation.pluginId).broker(view, refused, diagnostic),
    diagnostic: (id, reason) => recordPluginToolFailure(options.lifecycle.root, id, reason),
    refused,
    recoverHost: (view, stopped) =>
      controller.restartPluginTools(view.installation.pluginId, view.runId, stopped),
    restartHost: (id) => controller.restartPluginTools(id, undefined, () => {}),
  })
  consumer.agents = agents
  let closing: Promise<void> | undefined
  const bridge = await servePersonPluginControl({
    root: options.lifecycle.root,
    key: options.personKey,
    controller,
    read: options.read,
    restartPlugin: (id) => agents.restartPlugin(id),
  })
  function close(): Promise<void> {
    closing ??= (async () => {
      // Cleanup is attempted independently; only real process handles belong to physical drain.
      bridge.endConsumers()
      await Promise.allSettled([agents.close(), bridge.close(), controller.drain()])
    })()
    return closing
  }
  const lifecycleBridge = { ...agents, close }
  options.owner.bindAgentBridge(lifecycleBridge)
  // Older owners do not call the optional cleanup hook; their physical shutdown still closes UI.
  void options.owner.closed.then(() => close())
  return { controller, path: bridge.path, close }
}

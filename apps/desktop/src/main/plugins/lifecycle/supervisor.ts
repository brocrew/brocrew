import { recordPluginToolFailure, pluginToolRefusalLog } from '../tool-diagnostics'
import { sharedLifecycleWorkspaces } from './workspaces'
import { createLifecycleAgentBridge } from './agent-bridge'
import type { PluginSupervisor } from '../supervisor/owner'
import { createSupervisedPluginHost } from '../supervisor/node-host'
import type { createPluginNodeHost } from '../node-host'
import { PluginLifecycleController } from './controller'
import { servePersonPluginControl } from './person-control'
import { PluginEffectQueue } from './effect-queue'
import type { LifecycleOptions } from './types'

/** Called in the exclusive supervisor process, never in a workspace renderer or agent handler. */
export async function createSupervisorLifecycle(options: {
  owner: PluginSupervisor
  host: ReturnType<typeof createPluginNodeHost>
  lifecycle: Omit<LifecycleOptions, 'runtime'>
  personKey: string
}) {
  const releaseReads = options.lifecycle.state.retainOwnerReadSnapshot()
  void options.owner.closed.then(releaseReads)
  const effectQueue = new PluginEffectQueue()
  options.owner.bindLifecycleEffects(effectQueue)
  const host = createSupervisedPluginHost(options.owner, options.host)
  const consumer: { agents?: ReturnType<typeof createLifecycleAgentBridge> } = {}
  const controller = sharedLifecycleWorkspaces(
    await PluginLifecycleController.open({
      ...options.lifecycle,
      effectQueue,
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
        // The runtime adapter uses the current owner and its captured process handles.
        previousOwnerClean: async () => true,
      },
    }),
  )
  const refused = pluginToolRefusalLog(options.lifecycle.root)
  const agents = createLifecycleAgentBridge({
    owner: options.owner,
    controller,
    diagnostic: (id, reason) => recordPluginToolFailure(options.lifecycle.root, id, reason),
    refused,
    restartHost: (id) => controller.restartPluginTools(id, undefined, () => {}),
  })
  controller.bindGenericTools(agents)
  consumer.agents = agents
  let closing: Promise<void> | undefined
  const bridge = await servePersonPluginControl({
    root: options.lifecycle.root,
    key: options.personKey,
    controller,
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
  return {
    controller,
    tools: {
      listTools: agents.listTools,
      callTool: agents.callTool,
      cancelTool: agents.cancelTool,
    },
    path: bridge.path,
    close,
  }
}

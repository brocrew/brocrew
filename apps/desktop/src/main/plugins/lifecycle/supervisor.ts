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
import { PluginSupervisorError } from '../supervisor/protocol'

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
      deny(id) {
        consumer.agents?.deny(id)
        options.lifecycle.deny(id)
      },
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
    binding: (view) => requirePluginAdapter(view.installation.pluginId).broker(view, refused),
    refused,
  })
  consumer.agents = agents
  options.owner.bindAgentBridge(agents)
  let closed = false
  let closing: Promise<void> | undefined
  let exited!: () => void
  const done = new Promise<void>((resolve) => {
    exited = resolve
  })
  const bridge = await servePersonPluginControl({
    root: options.lifecycle.root,
    key: options.personKey,
    controller,
    read: options.read,
  })
  function close(): Promise<void> {
    closing ??= (async () => {
      // Intent precedes the concurrent host stops in the owner's child drain. Each exact run must
      // still prove exit, and neither a failed consumer nor another child skips the remaining work.
      const drained = controller.drain()
      // Keep one grace budget across crash revocations and the final consumer detach.
      const personClosed = (async () => {
        const timer = setTimeout(
          () => bridge.endConsumers(),
          Math.floor(options.owner.remainingDrainMs() * 0.75),
        )
        try {
          await drained.catch(() => undefined)
          await bridge.close()
        } finally {
          clearTimeout(timer)
        }
      })()
      const results = await Promise.allSettled([agents.close(), personClosed, drained])
      if (results.some((one) => one.status !== 'fulfilled') || !controller.cleanForShutdown())
        throw new PluginSupervisorError('cleanup-pending')
      closed = true
      exited()
    })()
    return closing
  }
  // The owner waits for consumer/UI cleanup along with the real host children at last-lease drain.
  try {
    await options.owner.startChild(async () => ({
      stop: close,
      exited: done,
      descendantsGone: async () => closed,
    }))
  } catch {
    await bridge.close().catch(() => undefined)
    throw new PluginSupervisorError('unavailable')
  }
  return { controller, path: bridge.path, close }
}

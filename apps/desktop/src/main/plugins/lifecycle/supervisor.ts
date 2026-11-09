import { recordPluginToolFailure } from '../tool-diagnostics'
import { recordRouteAdmissionTrace } from '../route-admission-trace'
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
      toolsUnavailable: (id) => consumer.agents?.toolsUnavailable(id) ?? false,
      toolsCause: (id) => consumer.agents?.toolsCause(id),
      toolsPending: (id) => consumer.agents?.toolsPending(id),
      deny(id) {
        consumer.agents?.deny(id)
        options.lifecycle.deny(id)
      },
      onChromeHostExit: (runId) => consumer.agents?.hostExited(runId),
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
    routeTrace: (event) => recordRouteAdmissionTrace(options.lifecycle.root, event),
    controller,
    binding: (view, diagnostic) =>
      requirePluginAdapter(view.installation.pluginId).broker(view, refused, diagnostic),
    diagnostic: (id, reason, detail) =>
      recordPluginToolFailure(options.lifecycle.root, id, reason, detail),
    refused,
    recoverChromeHost: (view, stopped) => controller.restartChromeTools(view.runId, stopped),
    restartChromeHost: () => controller.restartChromeTools(undefined, () => {}),
  })
  consumer.agents = agents
  options.owner.bindAgentBridge(agents)
  let closed = false
  let closing: Promise<void> | undefined
  let exited!: () => void
  let failed!: (error: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    exited = resolve
    failed = reject
  })
  // close() may fail before the owner starts its own drain. Keep the negative witness observed.
  void done.catch(() => undefined)
  const bridge = await servePersonPluginControl({
    root: options.lifecycle.root,
    key: options.personKey,
    controller,
    read: options.read,
    restartChrome: () => agents.restartChrome(),
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
      // Each part that failed is named, with its own error, so a refused shutdown says why.
      const parts = ['agent routes', 'Settings channels', 'plugin runs']
      const causes = results.flatMap((one, index) =>
        one.status === 'rejected'
          ? [new Error(`${parts[index]} did not close`, { cause: one.reason })]
          : [],
      )
      const blockers = controller.shutdownBlockers()
      if (blockers.length)
        causes.push(new Error(`plugins can't shut down cleanly: ${blockers.join('; ')}`))
      if (causes.length)
        throw new PluginSupervisorError('cleanup-pending', {
          cause:
            causes.length === 1 ? causes[0] : new AggregateError(causes, 'plugin shutdown failed'),
        })
      closed = true
      exited()
    })().catch((error: unknown) => {
      // A failed bridge stop is a negative exit witness, not a promise that can never settle.
      // The owner retains its fence as blocked; it must never publish a false clean stop.
      failed(error)
      throw error
    })
    return closing
  }
  // The owner waits for consumer/UI cleanup along with the real host children at last-lease drain.
  try {
    await options.owner.startChild(async () => ({
      inProcess: true,
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

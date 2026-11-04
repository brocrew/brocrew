import { randomUUID } from 'node:crypto'
import type { ManagedPluginMcpServer } from '@brobot2/runtime'
import {
  createPluginToolBroker,
  PluginBrokerError,
  type GenericPluginToolBroker,
  type PluginMcpClient,
  type PluginToolCall,
  type InstanceToolScope,
} from '../tool-broker'
import {
  openManagedPluginRoute,
  pluginProviderNamespace,
  type ManagedPluginRoute,
} from '../managed-transport'
import { reportPluginToolFailure, type PluginToolDiagnostic } from '../tool-diagnostics'
import type { PluginSupervisor, WorkspaceLease } from '../supervisor/owner'
import type { Command } from '../supervisor/protocol'
import type { PluginLifecycleController } from './controller'
import type { LifecycleWorkspace } from './types'
import { pluginMcpClient } from './broker-inventory'

type View = ReturnType<PluginLifecycleController['agentAttachments']>[number]
type Request = Extract<Command, { kind: 'agent-routes' }>
interface Entry {
  view: View
  broker: GenericPluginToolBroker
}
interface Route {
  lease: Readonly<WorkspaceLease>
  workspaceId: string
  incarnation: string
  pluginId: string
  instanceId: string
  current(): boolean
  route: ManagedPluginRoute
}
export type { InstanceToolScope } from '../tool-broker'

/** One production forwarding path for providers, UI actions and other package callbacks. */
export function createLifecycleAgentBridge(options: {
  owner: Pick<PluginSupervisor, 'valid'>
  controller: Pick<PluginLifecycleController, 'agentAttachments' | 'attach' | 'detach'>
  binding?: (view: View, diagnostic: PluginToolDiagnostic) => Promise<PluginMcpClient>
  diagnostic?: (pluginId: string, reason: Parameters<PluginToolDiagnostic>[0]) => void
  refused?: () => void | Promise<void>
  restartHost?: (pluginId: string) => Promise<void>
}) {
  const attachments = new Map<string, Promise<LifecycleWorkspace>>()
  const entries = new Map<string, Promise<Entry>>()
  const entryRuns = new Map<string, string>()
  const routes = new Map<string, Route>()
  const retired = new Set<string>()
  const failures = new Set<string>()
  const pendingCloses = new Set<Promise<unknown>>()
  let closed = false
  const valid = (lease: Readonly<WorkspaceLease>) =>
    !closed && options.owner.valid(lease.id, lease.epoch)
  const diagnostic =
    (id: string): PluginToolDiagnostic =>
    (reason) => {
      try {
        options.diagnostic?.(id, reason)
      } catch {
        /* Diagnostics are observers. */
      }
    }
  function closeRoute(route: ManagedPluginRoute) {
    const work = route.close()
    pendingCloses.add(work)
    void work.finally(() => pendingCloses.delete(work)).catch(() => undefined)
    return work
  }
  function views(workspaceId: string) {
    return closed
      ? []
      : options.controller.agentAttachments(workspaceId).filter((view) => view.current())
  }
  function instance(scope: InstanceToolScope): View {
    const view = views(scope.workspaceId).find(
      (item) => item.installation.pluginId === scope.pluginId && item.runId === scope.instanceId,
    )
    if (!view) throw new PluginBrokerError('disabled')
    return view
  }
  function deny(id: string): Promise<void>[] {
    const entry = entries.get(id)
    entries.delete(id)
    entryRuns.delete(id)
    failures.delete(id)
    if (entry) void entry.then((one) => one.broker.invalidate()).catch(() => undefined)
    const work: Promise<void>[] = []
    for (const [key, route] of routes)
      if (route.pluginId === id) {
        routes.delete(key)
        work.push(closeRoute(route.route))
      }
    return work
  }
  async function entryFor(view: View): Promise<Entry> {
    const id = view.installation.pluginId
    let pending = entries.get(id)
    if (pending && entryRuns.get(id) !== view.runId) {
      await Promise.all(deny(id))
      return entryFor(view)
    }
    if (!pending) {
      const client = Promise.resolve()
        .then(() =>
          options.binding ? options.binding(view, diagnostic(id)) : pluginMcpClient(view),
        )
        .catch((error: unknown) => {
          if (error instanceof PluginBrokerError) throw error
          throw new PluginBrokerError('transport')
        })
      pending = client.then((client) => {
        if (closed || entries.get(id) !== pending) throw new PluginBrokerError('unavailable')
        const broker = createPluginToolBroker({
          binding: { pluginId: id, installId: view.installation.installId, instanceId: view.runId },
          client,
          diagnostic: diagnostic(id),
          isEnabled: (workspaceId) =>
            views(workspaceId).some(
              (one) =>
                one.installation.pluginId === id &&
                one.runId === view.runId &&
                one.installation.installId === view.installation.installId,
            ),
        })
        return { view, broker }
      })
      entries.set(id, pending)
      entryRuns.set(id, view.runId)
      void pending.catch(() => {
        if (entries.get(id) === pending) {
          entries.delete(id)
          entryRuns.delete(id)
          failures.add(id)
        }
        reportPluginToolFailure(diagnostic(id), 'binding-failed')
      })
    }
    return pending
  }
  async function closeWorkspaceRoutes(leaseId: string, pluginId?: string) {
    const closing: Promise<void>[] = []
    for (const [key, route] of routes)
      if (route.lease.id === leaseId && (!pluginId || route.pluginId === pluginId)) {
        routes.delete(key)
        closing.push(closeRoute(route.route))
      }
    await Promise.all(closing)
  }
  function revoke(lease: Readonly<WorkspaceLease>) {
    void closeWorkspaceRoutes(lease.id).catch(() => undefined)
    for (const caller of retired) if (caller.startsWith(lease.id + ':')) retired.delete(caller)
    const attached = attachments.get(lease.id)
    attachments.delete(lease.id)
    if (attached) {
      const work = attached.then((handle) => options.controller.detach(handle))
      pendingCloses.add(work)
      void work.finally(() => pendingCloses.delete(work)).catch(() => undefined)
    }
  }
  async function read(
    lease: Readonly<WorkspaceLease>,
    request: Request,
  ): Promise<ManagedPluginMcpServer[]> {
    if (!valid(lease)) return []
    const caller = `${lease.id}:${request.incarnation}`
    if (request.release) {
      retired.add(caller)
      const closing: Promise<void>[] = []
      for (const [key, route] of routes)
        if (route.lease.id === lease.id && route.incarnation === request.incarnation) {
          routes.delete(key)
          closing.push(closeRoute(route.route))
        }
      await Promise.all(closing)
      return []
    }
    if (retired.has(caller)) return []
    let attached = attachments.get(lease.id)
    if (!attached) {
      attached = options.controller.attach({
        workspaceId: request.workspaceId,
        applied: async () => {},
        reconcile: async () => {},
        revoke: async (id) => {
          await closeWorkspaceRoutes(lease.id, id)
          return true
        },
      })
      attachments.set(lease.id, attached)
      void attached.catch(() => {
        if (attachments.get(lease.id) === attached) attachments.delete(lease.id)
      })
    }
    await attached
    if (!valid(lease)) return []
    const desired = views(request.workspaceId)
    for (const [key, route] of routes)
      if (
        route.lease.id === lease.id &&
        route.incarnation === request.incarnation &&
        (!route.current() ||
          !desired.some(
            (view) =>
              view.installation.pluginId === route.pluginId && view.runId === route.instanceId,
          ))
      ) {
        routes.delete(key)
        await closeRoute(route.route)
      }
    const result: ManagedPluginMcpServer[] = []
    for (const view of desired) {
      const id = view.installation.pluginId
      const key = `${caller}:${id}`
      if (!valid(lease) || !view.current() || retired.has(caller)) continue
      try {
        let cached = routes.get(key)
        const cachedName = cached?.route.server.name.toLowerCase()
        if (
          cached &&
          [...request.occupied, ...result.map((one) => one.name)].some(
            (name) => name.toLowerCase() === cachedName,
          )
        ) {
          routes.delete(key)
          await closeRoute(cached.route)
          cached = undefined
        }
        if (!cached) {
          const entry = await entryFor(view)
          let namespace = pluginProviderNamespace(id)
          const occupied = new Set(
            [...request.occupied, ...result.map((one) => one.name)].map((one) => one.toLowerCase()),
          )
          while (occupied.has(namespace.toLowerCase()))
            namespace = pluginProviderNamespace(`${id}-${randomUUID()}`)
          const current = () =>
            valid(lease) && view.current() && !retired.has(caller) && entries.get(id) !== undefined
          const route = await openManagedPluginRoute(
            entry.broker,
            { workspaceId: request.workspaceId, origin: 'agent', namespace },
            current,
            diagnostic(id),
          )
          if (!valid(lease) || !view.current() || retired.has(caller)) {
            await closeRoute(route)
            continue
          }
          cached = {
            lease: { ...lease },
            workspaceId: request.workspaceId,
            incarnation: request.incarnation,
            pluginId: id,
            instanceId: view.runId,
            current,
            route,
          }
          routes.set(key, cached)
        }
        result.push(cached.route.server)
        failures.delete(id)
      } catch {
        failures.add(id)
        reportPluginToolFailure(diagnostic(id), 'route-open-failed')
        try {
          await options.refused?.()
        } catch {
          /* Diagnostics cannot hide other routes. */
        }
      }
    }
    return result
  }
  let tail: Promise<unknown> = Promise.resolve()
  return {
    deny,
    revoke,
    hostExited(pluginId: string, runId: string) {
      const pending = entries.get(pluginId)
      if (pending)
        void pending
          .then((entry) => {
            if (entry.view.runId === runId) deny(pluginId)
          })
          .catch(() => undefined)
    },
    async restartPlugin(pluginId: string) {
      if (closed || !options.restartHost) throw new PluginBrokerError('unavailable')
      await Promise.all(deny(pluginId))
      await options.restartHost(pluginId)
    },
    async listTools(scope: InstanceToolScope, signal?: AbortSignal) {
      const view = instance(scope)
      const entry = await entryFor(view)
      if (!view.current()) throw new PluginBrokerError('disabled')
      const result = await entry.broker.listTools(scope.workspaceId, signal)
      if (!view.current()) throw new PluginBrokerError('disabled')
      return result
    },
    async callTool(input: InstanceToolScope & Omit<PluginToolCall, 'workspaceId'>) {
      const view = instance(input)
      const entry = await entryFor(view)
      if (!view.current()) throw new PluginBrokerError('disabled')
      const result = await entry.broker.callTool(input)
      if (!view.current()) throw new PluginBrokerError('disabled')
      return result
    },
    async cancelTool(input: InstanceToolScope & { requestId: string | number }) {
      const pending = entries.get(input.pluginId)
      if (!pending) return { cancelled: false, completed: false }
      const entry = await pending
      if (entry.view.runId !== input.instanceId) return { cancelled: false, completed: false }
      return entry.broker.cancelTool(input)
    },
    toolsUnavailable(id: string) {
      return failures.has(id)
    },
    routes(lease: Readonly<WorkspaceLease>, request: Request) {
      const work = tail.then(() => read(lease, request))
      tail = work.catch(() => undefined)
      return work
    },
    async close() {
      closed = true
      for (const id of entries.keys()) deny(id)
      await tail
      await Promise.all([...routes.values()].map((one) => closeRoute(one.route)))
      routes.clear()
      await Promise.all(
        [...attachments.values()].map(async (one) => options.controller.detach(await one)),
      )
      attachments.clear()
      await Promise.all(pendingCloses)
    },
  }
}

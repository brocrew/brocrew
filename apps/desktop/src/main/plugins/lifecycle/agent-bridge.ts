import { randomUUID } from 'node:crypto'
import type { ManagedPluginMcpServer } from '@brobot2/runtime'
import {
  createPluginToolBroker,
  type BrokerOptions,
  type PluginToolBroker,
  type BrokerWorkspace,
} from '../tool-broker'
import { openManagedPluginRoute, type ManagedPluginRoute } from '../managed-transport'
import type { PluginSupervisor, WorkspaceLease } from '../supervisor/owner'
import type { Command } from '../supervisor/protocol'
import type { PluginLifecycleController } from './controller'
import type { LifecycleWorkspace } from './types'

type View = ReturnType<PluginLifecycleController['agentAttachments']>[number]
type Request = Extract<Command, { kind: 'agent-routes' }>
interface Entry {
  readonly identity: string
  readonly broker: PluginToolBroker
  readonly workspaces: Map<string, BrokerWorkspace>
}
interface Route {
  lease: WorkspaceLease
  workspaceId: string
  incarnation: string
  pluginId: string
  identity: string
  route: ManagedPluginRoute
}
/** Lives only in the supervisor. Workspace callers receive scoped routes, never private ports. */
export function createLifecycleAgentBridge(options: {
  owner: Pick<PluginSupervisor, 'valid'>
  controller: Pick<PluginLifecycleController, 'agentAttachments' | 'attach' | 'detach'>
  refused?: () => void | Promise<void>
  binding(
    view: View,
  ): Promise<
    Omit<
      BrokerOptions,
      | 'binding'
      | 'reservedNamespace'
      | 'hostToolNames'
      | 'occupiedNamespaces'
      | 'occupiedQualifiedNames'
    >
  >
}) {
  const attachments = new Map<string, Promise<LifecycleWorkspace>>()
  const closing = new Set<Promise<unknown>>()
  const consumerCleanup = new Set<Promise<unknown>>()
  let cleanupFailed = false
  function closeRoute(route: ManagedPluginRoute) {
    const work = route.close()
    closing.add(work)
    void work
      .finally(() => closing.delete(work))
      .catch(() => {
        cleanupFailed = true
      })
    return work
  }
  const stopping = new Map<string, Promise<Entry>>()
  const entries = new Map<string, Promise<Entry>>()
  const routes = new Map<string, Route>()
  const versions = new Map<string, number>()
  const retired = new Set<string>()
  let closed = false
  const valid = (lease: Readonly<WorkspaceLease>) =>
    !closed && options.owner.valid(lease.id, lease.epoch)
  function deny(id: string): void {
    versions.set(id, (versions.get(id) ?? 0) + 1)
    const entry = entries.get(id)
    entries.delete(id)
    if (entry) {
      stopping.set(id, entry)
      void entry.then((one) => one.broker.owner.invalidate()).catch(() => undefined)
    }
    for (const [key, item] of routes)
      if (item.pluginId === id) {
        routes.delete(key)
        void closeRoute(item.route).catch(() => undefined)
      }
  }
  function revoke(lease: Readonly<WorkspaceLease>): void {
    for (const caller of retired) if (caller.startsWith(lease.id + ':')) retired.delete(caller)
    const attached = attachments.get(lease.id)
    attachments.delete(lease.id)
    if (attached) {
      const work = attached.then((handle) => options.controller.detach(handle))
      consumerCleanup.add(work)
      void work
        .finally(() => consumerCleanup.delete(work))
        .catch(() => {
          cleanupFailed = true
        })
    }
    for (const [key, item] of routes)
      if (item.lease.id === lease.id) {
        routes.delete(key)
        void closeRoute(item.route).catch(() => undefined)
      }
    for (const entry of entries.values())
      void entry
        .then((one) => {
          const workspace = one.workspaces.get(lease.id)
          if (workspace) {
            one.broker.owner.detach(workspace)
            one.workspaces.delete(lease.id)
          }
        })
        .catch(() => undefined)
  }
  let tail = Promise.resolve()
  let waiting = 0
  async function read(
    lease: Readonly<WorkspaceLease>,
    request: Request,
  ): Promise<ManagedPluginMcpServer[]> {
    if (!valid(lease)) return []
    const caller = `${lease.id}:${request.incarnation}`
    if (request.release) {
      retired.add(caller)
      for (const [key, item] of routes)
        if (item.lease.id === lease.id && item.incarnation === request.incarnation) {
          routes.delete(key)
          await closeRoute(item.route)
        }
      return []
    }
    if (retired.has(caller)) return []
    // Only already reconciled live lifecycle projections are authority. Caller labels create none.
    let attached = attachments.get(lease.id)
    if (!attached) {
      attached = options.controller.attach({
        workspaceId: request.workspaceId,
        applied: async () => {},
        reconcile: async () => {},
        revoke: async (id) => {
          const pending = [...routes].filter(
            ([, item]) => item.lease.id === lease.id && item.pluginId === id,
          )
          for (const [key] of pending) routes.delete(key)
          await Promise.all(pending.map(([, item]) => closeRoute(item.route)))
          const entry = await (entries.get(id) ?? stopping.get(id))
          return !entry?.broker.status().awaitingQuiescence
        },
      })
      attachments.set(lease.id, attached)
      void attached.catch(() => {
        if (attachments.get(lease.id) === attached) attachments.delete(lease.id)
      })
    }
    await attached
    if (!valid(lease)) return []
    const views = options.controller.agentAttachments(request.workspaceId)
    const desired = new Set(views.map((view) => view.installation.pluginId))
    for (const [key, item] of routes)
      if (
        item.lease.id === lease.id &&
        item.incarnation === request.incarnation &&
        !desired.has(item.pluginId)
      ) {
        routes.delete(key)
        await closeRoute(item.route)
      }
    const result: ManagedPluginMcpServer[] = []
    for (const view of views) {
      if (!valid(lease) || !view.current()) continue
      const id = view.installation.pluginId
      const identity = `${view.installation.installId}:${view.installation.incarnation}:${view.installation.configRevision}`
      const key = `${caller}:${id}`
      let cached = routes.get(key)
      if (cached?.identity !== identity) {
        if (cached) {
          routes.delete(key)
          await closeRoute(cached.route)
          cached = undefined
        }
        let work = entries.get(id)
        if (work && (await work).identity !== identity) {
          deny(id)
          work = undefined
        }
        if (!work) {
          const version = versions.get(id) ?? 0
          work = options.binding(view).then((binding) => {
            if (!view.current() || closed || (versions.get(id) ?? 0) !== version)
              throw new Error('unavailable')
            const broker = createPluginToolBroker({
              ...binding,
              binding: { pluginId: id, installId: view.installation.installId, epoch: identity },
              reservedNamespace: 'brobot',
              hostToolNames: [],
              occupiedNamespaces: [],
              occupiedQualifiedNames: [],
              isAllowed: (who, use) => {
                const active = options.controller
                  .agentAttachments(who.workspaceId)
                  .some(
                    (item) =>
                      item.installation.installId === view.installation.installId && item.current(),
                  )
                return active && binding.isAllowed(who, use)
              },
            })
            return { identity, broker, workspaces: new Map<string, BrokerWorkspace>() }
          })
          entries.set(id, work)
          void work.catch(() => {
            if (entries.get(id) === work) entries.delete(id)
          })
        }
        try {
          const entry = await work
          if (!valid(lease) || !view.current() || retired.has(caller)) continue
          let workspace = entry.workspaces.get(lease.id)
          if (!workspace) {
            workspace = entry.broker.owner.attach(request.workspaceId)
            entry.workspaces.set(lease.id, workspace)
          }
          const agent = entry.broker.owner.grantAgent(
            workspace,
            `${request.incarnation}:${randomUUID()}`,
          )
          const route = await openManagedPluginRoute(
            entry.broker,
            agent,
            () =>
              valid(lease) && view.current() && !retired.has(caller) && entries.get(id) === work,
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
            identity,
            route,
          }
          routes.set(key, cached)
        } catch {
          if (options.refused) await options.refused()
          else console.warn('Some plugin tools were refused.')
          continue
        }
      }
      if (cached) {
        const collision =
          request.occupied.some(
            (name) => name.toLowerCase() === cached.route.server.name.toLowerCase(),
          ) ||
          result.some((one) => one.name.toLowerCase() === cached.route.server.name.toLowerCase())
        if (collision) {
          routes.delete(key)
          await closeRoute(cached.route)
        } else result.push(cached.route.server)
      }
    }
    return result
  }
  return {
    deny,
    revoke,
    routes(lease: Readonly<WorkspaceLease>, request: Request) {
      if (waiting >= 64 || routes.size >= 1024 || retired.size >= 4096)
        return Promise.reject(new Error('unavailable'))
      waiting++
      const work = tail
        .then(() => read(lease, request))
        .finally(() => {
          waiting--
        })
      tail = work.then(
        () => undefined,
        () => undefined,
      )
      return work
    },
    async close() {
      closed = true
      for (const id of entries.keys()) deny(id)
      await tail
      const detaches = await Promise.allSettled(
        [...attachments.values()].map(async (one) => options.controller.detach(await one)),
      )
      await Promise.allSettled(consumerCleanup)
      if (detaches.some((one) => one.status === 'rejected')) cleanupFailed = true
      attachments.clear()
      await Promise.allSettled([...routes.values()].map((one) => closeRoute(one.route)))
      routes.clear()
      await Promise.all(closing)
      if (cleanupFailed) throw new Error('unavailable')
    },
  }
}

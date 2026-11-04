import { reportPluginToolFailure, type PluginToolDiagnostic } from '../tool-diagnostics'
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
  readonly view: View
  readonly confirmHostExit: () => void
  readonly hostExitProof: Promise<void>
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
  diagnostic?: (pluginId: string, reason: Parameters<PluginToolDiagnostic>[0]) => void
  now?: () => number
  /** Owner-only: callback only after positive exit of view.runId and its descendants. */
  recoverHost?: (view: View, stopped: () => void) => Promise<void>
  /** Person fallback when no broker was bound. */
  restartHost?: (pluginId: string) => Promise<void>
  binding(
    view: View,
    diagnostic: PluginToolDiagnostic,
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
  const liveEntries = new Map<string, Entry>()
  const failedRoutes = new Map<string, string>()
  const overflowFailures = new Set<string>()
  function failRoute(key: string, id: string) {
    if (failedRoutes.size < 1024 || failedRoutes.has(key)) failedRoutes.set(key, id)
    else overflowFailures.add(id) // Bounded and conservative until this installation is revoked.
  }
  const failedAttachments = new Set<string>()
  const diagnostic =
    (id: string): PluginToolDiagnostic =>
    (reason) => {
      try {
        options.diagnostic?.(id, reason)
      } catch {
        /* Observers grant no authority. */
      }
    }
  const routes = new Map<string, Route>()
  const rebuilding = new Set<string>()
  const recoveries = new Map<string, Promise<boolean>>()
  const hostExitNotifications = new WeakMap<Entry, Promise<void>>()
  const versions = new Map<string, number>()
  const retired = new Set<string>()
  let closed = false
  const valid = (lease: Readonly<WorkspaceLease>) =>
    !closed && options.owner.valid(lease.id, lease.epoch)
  function deny(id: string): Promise<void>[] {
    const pending: Promise<void>[] = []
    versions.set(id, (versions.get(id) ?? 0) + 1)
    const entry = entries.get(id)
    entries.delete(id)
    liveEntries.delete(id)
    rebuilding.delete(id)
    overflowFailures.delete(id)
    for (const [key, plugin] of failedRoutes) if (plugin === id) failedRoutes.delete(key)
    if (entry) {
      stopping.set(id, entry)
      void entry.then((one) => one.broker.owner.invalidate()).catch(() => undefined)
    }
    for (const [key, item] of routes)
      if (item.pluginId === id) {
        routes.delete(key)
        const work = closeRoute(item.route)
        pending.push(work)
        void work.catch(() => undefined)
      }
    return pending
  }
  function recoverEntry(entry: Entry, manual = false, hostGone = false): Promise<boolean> {
    const id = entry.view.installation.pluginId
    const prior = recoveries.get(id)
    if (prior) return prior
    if (closed || (!manual && !hostGone && liveEntries.get(id) !== entry))
      return Promise.resolve(false)
    if (!manual && !hostGone && entry.broker.status().available) return Promise.resolve(false)
    const routeOnly = !manual && !hostGone && entry.broker.owner.hasCompletionProof()
    if (!routeOnly && !options.recoverHost) return Promise.resolve(false)
    const work = Promise.resolve()
      .then(async () => {
        if (closed) return false
        if (routeOnly) {
          await Promise.all(deny(id))
          rebuilding.add(id)
          return true
        }
        reportPluginToolFailure(diagnostic(id), 'recovery-host-started')
        await options.recoverHost!(entry.view, () => entry.confirmHostExit())
        reportPluginToolFailure(diagnostic(id), 'recovery-restarted')
        return true
      })
      .catch(() => {
        reportPluginToolFailure(diagnostic(id), 'recovery-restart-failed')
        return false
      })
      .finally(() => {
        if (recoveries.get(id) === work) recoveries.delete(id)
      })
    recoveries.set(id, work)
    return work
  }
  function revoke(lease: Readonly<WorkspaceLease>): void {
    failedAttachments.delete(lease.id)
    for (const key of failedRoutes.keys())
      if (key.startsWith(lease.id + ':')) failedRoutes.delete(key)
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
      for (const key of failedRoutes.keys())
        if (key.startsWith(caller + ':')) failedRoutes.delete(key)
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
    failedAttachments.delete(lease.id)
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
      let version = versions.get(id) ?? 0
      const identity = `${view.installation.installId}:${view.installation.incarnation}:${view.installation.configRevision}`
      const key = `${caller}:${id}`
      let cached = routes.get(key)
      const known = liveEntries.get(id)
      if (known?.identity === identity && !known.broker.status().available) {
        if (!(await recoverEntry(known))) {
          // Keep this route unavailable when its selected process cannot restart.
          if (cached) {
            routes.delete(key)
            await closeRoute(cached.route)
          }
          continue
        }
        // Re-read the new run/projection with this same caller after proven recovery.
        return read(lease, request)
      }
      if (cached?.identity !== identity) {
        if (cached) {
          routes.delete(key)
          await closeRoute(cached.route)
          cached = undefined
        }
        let work = entries.get(id)
        if (work && (await work).identity !== identity) {
          deny(id)
          version = versions.get(id) ?? 0
          work = undefined
        }
        if (!work) {
          const report = diagnostic(id)
          work = options.binding(view, report).then((binding) => {
            if (!view.current() || closed || (versions.get(id) ?? 0) !== version)
              throw new Error('unavailable')
            if (typeof view.exited?.then !== 'function') throw new Error('unavailable')
            let confirmHostExit!: () => void
            const stopped = new Promise<void>((resolve) => {
              confirmHostExit = resolve
            })
            const held: { entry?: Entry } = {}
            const hostExitProof = Promise.any([view.exited, stopped])
            const broker = createPluginToolBroker({
              ...binding,
              hostExited: hostExitProof,
              audit(event) {
                if (event.event === 'unavailable' || event.event === 'refused')
                  reportPluginToolFailure(report, event.reason ?? event.code ?? 'unavailable')
                try {
                  binding.audit?.(event)
                } catch {
                  /* Diagnostic only. */
                }
                if (event.event === 'unavailable' || event.event === 'finished')
                  queueMicrotask(() => {
                    if (held.entry) void recoverEntry(held.entry)
                  })
              },
              binding: {
                pluginId: id,
                installId: view.installation.installId,
                epoch: randomUUID(),
              },
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
            const entry: Entry = {
              identity,
              broker,
              view,
              confirmHostExit,
              hostExitProof,
              workspaces: new Map<string, BrokerWorkspace>(),
            }
            held.entry = entry
            liveEntries.set(id, entry)
            return entry
          })
          entries.set(id, work)
          void work.catch(() => {
            if (entries.get(id) === work) entries.delete(id)
            reportPluginToolFailure(report, 'binding-failed')
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
            diagnostic(id),
          )
          if (
            !valid(lease) ||
            !view.current() ||
            retired.has(caller) ||
            !entry.broker.status().available
          ) {
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
          failedRoutes.delete(key)
          if (liveEntries.get(id) === entry) rebuilding.delete(id)
        } catch {
          // A retired attempt may be diagnosed, but cannot degrade its replacement's health.
          const current = valid(lease) && view.current() && (versions.get(id) ?? 0) === version
          if (current) failRoute(key, id)
          reportPluginToolFailure(diagnostic(id), current ? 'route-open-failed' : 'route-stale')
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
          failRoute(key, id)
          reportPluginToolFailure(diagnostic(id), 'name-collision')
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
    /** The selected run ending only wakes recovery for its own plugin. */
    hostExited(id: string, runId: string): void {
      void (async () => {
        const entry = liveEntries.get(id) ?? (await stopping.get(id))
        if (closed || !entry || entry.view.runId !== runId) return
        let work = hostExitNotifications.get(entry)
        if (!work) {
          work = (async () => {
            await entry.view.exited
            if (!closed) await recoverEntry(entry, false, true)
          })()
          hostExitNotifications.set(entry, work)
        }
        await work
      })().catch(() => reportPluginToolFailure(diagnostic(id), 'recovery-restart-failed'))
    },
    async restartPlugin(id: string): Promise<void> {
      if (closed) throw new Error('unavailable')
      const entry = liveEntries.get(id) ?? (await stopping.get(id))
      if (entry && options.recoverHost) {
        if (!(await recoverEntry(entry, true))) throw new Error('unavailable')
      } else {
        if (!options.restartHost) throw new Error('unavailable')
        await options.restartHost(id)
      }
    },
    toolsUnavailable(id: string): boolean {
      return (
        failedAttachments.size > 0 ||
        rebuilding.has(id) ||
        overflowFailures.has(id) ||
        liveEntries.get(id)?.broker.status().available === false ||
        [...failedRoutes.values()].includes(id)
      )
    },
    routes(lease: Readonly<WorkspaceLease>, request: Request) {
      if (waiting >= 64 || routes.size >= 1024 || retired.size >= 4096) {
        reportPluginToolFailure(diagnostic('host'), 'attachment-capacity')
        return Promise.reject(new Error('unavailable'))
      }
      waiting++
      const work = tail
        .then(() => read(lease, request))
        .catch((error: unknown) => {
          if (valid(lease)) failedAttachments.add(lease.id)
          reportPluginToolFailure(diagnostic('host'), 'attachment-failed')
          throw error
        })
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
      await Promise.allSettled([...recoveries.values()])
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

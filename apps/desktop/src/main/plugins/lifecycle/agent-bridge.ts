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
import type { AgentAttachmentView, AgentScopeEntry, PluginLifecycleController } from './controller'
import type { LifecycleWorkspace } from './types'
import { pluginMcpClient } from './broker-inventory'

type View = AgentAttachmentView
type Request = Extract<Command, { kind: 'agent-routes' }>
interface Entry {
  view: View
  broker: GenericPluginToolBroker
}
/** One served route with the plugin it belongs to: a provider name is never an identity. */
export type AgentRouteServer = ManagedPluginMcpServer & { readonly pluginId: string }
/**
 * One caller's routes from one committed scope: routes complete when the read answered, plugins
 * admitted or starting whose route is not open yet, and plugins committed state says are off.
 * `unknown` means the scope could not be read; only routes already open and current are served.
 */
export interface AgentRoutes {
  readonly servers: readonly AgentRouteServer[]
  readonly pending: readonly string[]
  readonly none: readonly string[]
  readonly unknown: boolean
}
interface Warmup {
  readonly key: string
  readonly caller: string
  readonly pluginId: string
  settled: boolean
  ok: boolean
  cancelled: boolean
  readonly done: Promise<void>
}
/** The bridge always answers before the runtime's own wait (1.5 s) and the owner's (2 s) end. */
export const AGENT_ROUTES_ANSWER_WITHIN_MS = 1_000
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
  controller: Pick<
    PluginLifecycleController,
    'agentAttachments' | 'agentScope' | 'onHostChanged' | 'attach' | 'detach'
  >
  binding?: (view: View, diagnostic: PluginToolDiagnostic) => Promise<PluginMcpClient>
  openRoute?: typeof openManagedPluginRoute
  answerWithinMs?: number
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
  const warmups = new Map<string, Warmup>()
  const reserved = new Map<string, Set<string>>()
  const chains = new Map<string, Promise<unknown>>()
  const openRoute = options.openRoute ?? openManagedPluginRoute
  const answerWithin = options.answerWithinMs ?? AGENT_ROUTES_ANSWER_WITHIN_MS
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
    for (const [key, warmup] of warmups)
      if (warmup.pluginId === id) {
        warmup.cancelled = true
        warmups.delete(key)
      }
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
  function cancelWarmups(callerPrefix: string, pluginId?: string) {
    for (const [key, warmup] of warmups)
      if (warmup.caller.startsWith(callerPrefix) && (!pluginId || warmup.pluginId === pluginId)) {
        warmup.cancelled = true
        warmups.delete(key)
      }
  }
  async function closeWorkspaceRoutes(leaseId: string, pluginId?: string) {
    cancelWarmups(leaseId + ':', pluginId)
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
    for (const caller of reserved.keys())
      if (caller.startsWith(lease.id + ':')) reserved.delete(caller)
    const attached = attachments.get(lease.id)
    attachments.delete(lease.id)
    if (attached) {
      const work = attached.then((handle) => options.controller.detach(handle))
      pendingCloses.add(work)
      void work.finally(() => pendingCloses.delete(work)).catch(() => undefined)
    }
  }
  /** The one route opening for this caller, plugin, installation, run and switch revision. */
  function warm(
    lease: Readonly<WorkspaceLease>,
    request: Request,
    caller: string,
    entry: Extract<AgentScopeEntry, { is: 'admitted' }>,
  ): Warmup {
    const id = entry.pluginId
    const key = [caller, id, entry.installId, entry.runId, entry.switchRevision].join('\u0000')
    const existing = warmups.get(key)
    // A settled warmup stands only while its route does; a swept route opens again.
    if (existing && (!existing.settled || routes.get(`${caller}:${id}`)?.current())) return existing
    if (existing) warmups.delete(key)
    for (const [other, warmup] of warmups)
      if (warmup.caller === caller && warmup.pluginId === id) {
        warmup.cancelled = true
        warmups.delete(other)
      }
    const view = entry.view
    const names = reserved.get(caller) ?? new Set<string>()
    reserved.set(caller, names)
    const warmup: Warmup = {
      key,
      caller,
      pluginId: id,
      settled: false,
      ok: false,
      cancelled: false,
      done: Promise.resolve(),
    }
    const live = () =>
      !warmup.cancelled &&
      warmups.get(key) === warmup &&
      valid(lease) &&
      view.current() &&
      !retired.has(caller)
    let namespace: string | undefined
    ;(warmup as { done: Promise<void> }).done = (async () => {
      try {
        const opened = await entryFor(view)
        if (!live()) return
        const occupied = new Set(
          [
            ...request.occupied,
            ...names,
            ...[...routes.values()]
              .filter((one) => one.lease.id === lease.id && one.incarnation === request.incarnation)
              .map((one) => one.route.server.name),
          ].map((one) => one.toLowerCase()),
        )
        namespace = pluginProviderNamespace(id)
        while (occupied.has(namespace.toLowerCase()))
          namespace = pluginProviderNamespace(`${id}-${randomUUID()}`)
        names.add(namespace)
        const current = () =>
          valid(lease) && view.current() && !retired.has(caller) && entries.get(id) !== undefined
        const route = await openRoute(
          opened.broker,
          { workspaceId: request.workspaceId, origin: 'agent', namespace },
          current,
          diagnostic(id),
        )
        if (!live()) {
          await closeRoute(route)
          return
        }
        const previous = routes.get(`${caller}:${id}`)
        if (previous) void closeRoute(previous.route).catch(() => undefined)
        routes.set(`${caller}:${id}`, {
          lease: { ...lease },
          workspaceId: request.workspaceId,
          incarnation: request.incarnation,
          pluginId: id,
          instanceId: view.runId,
          current,
          route,
        })
        warmup.ok = true
        failures.delete(id)
      } catch {
        if (warmup.cancelled) return
        failures.add(id)
        reportPluginToolFailure(diagnostic(id), 'route-open-failed')
        try {
          await options.refused?.()
        } catch {
          /* Diagnostics cannot hide other routes. */
        }
      } finally {
        if (namespace !== undefined) names.delete(namespace)
        warmup.settled = true
        if (warmups.get(key) === warmup && !warmup.ok) warmups.delete(key)
      }
    })()
    warmups.set(key, warmup)
    return warmup
  }
  function snapshot(caller: string, scope: readonly AgentScopeEntry[] | null): AgentRoutes {
    const servers: AgentRouteServer[] = []
    for (const route of routes.values())
      if (`${route.lease.id}:${route.incarnation}` === caller && route.current())
        servers.push({ ...route.route.server, pluginId: route.pluginId })
    servers.sort((a, b) => a.pluginId.localeCompare(b.pluginId))
    if (scope === null) return { servers, pending: [], none: [], unknown: true }
    const served = new Set(servers.map((one) => one.pluginId))
    const pending: string[] = []
    const none: string[] = []
    for (const entry of scope) {
      if (served.has(entry.pluginId)) continue
      if (entry.is === 'off') none.push(entry.pluginId)
      else if (entry.is === 'pending') pending.push(entry.pluginId)
      else if (
        [...warmups.values()].some(
          (one) => one.caller === caller && one.pluginId === entry.pluginId && !one.settled,
        )
      )
        pending.push(entry.pluginId)
    }
    return { servers, pending, none, unknown: false }
  }
  async function readRoutes(
    lease: Readonly<WorkspaceLease>,
    request: Request,
    asked: number,
  ): Promise<AgentRoutes> {
    const empty: AgentRoutes = { servers: [], pending: [], none: [], unknown: false }
    if (!valid(lease)) return empty
    const caller = `${lease.id}:${request.incarnation}`
    if (request.release) {
      retired.add(caller)
      cancelWarmups(caller)
      reserved.delete(caller)
      const closing: Promise<void>[] = []
      for (const [key, route] of routes)
        if (route.lease.id === lease.id && route.incarnation === request.incarnation) {
          routes.delete(key)
          closing.push(closeRoute(route.route))
        }
      await Promise.all(closing)
      return empty
    }
    if (retired.has(caller)) return empty
    // Measured from when the request arrived, queueing and attaching included.
    const deadline = new Promise<'deadline'>((resolve) => {
      const timer = setTimeout(
        () => resolve('deadline'),
        Math.max(0, answerWithin - (performance.now() - asked)),
      )
      timer.unref?.()
    })
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
    // An attachment that does not settle within the bound leaves the scope unknown.
    if ((await Promise.race([attached.then(() => 'attached' as const), deadline])) === 'deadline')
      return snapshot(caller, null)
    if (!valid(lease)) return empty
    // Subscribed before the first scope, so no committed change between them is missed.
    let woken: () => void = () => {}
    let wake = new Promise<void>((resolve) => (woken = resolve))
    const detach = options.controller.onHostChanged((workspaceId) => {
      if (workspaceId !== request.workspaceId) return
      woken()
      wake = new Promise<void>((resolve) => (woken = resolve))
    })
    const failedHere = new Set<string>()
    // A served name the caller now uses for another server is opened again under a free one.
    const taken = new Set(request.occupied.map((one) => one.toLowerCase()))
    try {
      for (;;) {
        if (!valid(lease) || retired.has(caller)) return empty
        // Taken before the scope, so a change during the sweep below still wakes this pass.
        const woke = wake
        let scope: readonly AgentScopeEntry[]
        try {
          scope = options.controller.agentScope(request.workspaceId).entries
        } catch {
          return snapshot(caller, null)
        }
        for (const [key, route] of routes)
          if (
            route.lease.id === lease.id &&
            route.incarnation === request.incarnation &&
            (!route.current() ||
              taken.has(route.route.server.name.toLowerCase()) ||
              scope.some((one) => one.pluginId === route.pluginId && one.is === 'off'))
          ) {
            routes.delete(key)
            for (const [other, warmup] of warmups)
              if (warmup.caller === caller && warmup.pluginId === route.pluginId && warmup.settled)
                warmups.delete(other)
            // Its authority ended above; closing is tracked and never holds the answer.
            void closeRoute(route.route).catch(() => undefined)
          }
        const warming: Warmup[] = []
        for (const entry of scope) {
          if (entry.is !== 'admitted' || !entry.view.current()) continue
          const open = routes.get(`${caller}:${entry.pluginId}`)
          if (open && open.current() && open.instanceId === entry.runId) continue
          const key = [caller, entry.pluginId, entry.installId, entry.runId, entry.switchRevision]
          // A route whose open failed during this read is retried at the next read, not here.
          if (failedHere.has(key.join('\u0000'))) continue
          const warmup = warm(lease, request, caller, entry)
          if (!warmup.settled) warming.push(warmup)
        }
        const now = snapshot(caller, scope)
        for (const server of now.servers) failures.delete(server.pluginId)
        if (now.servers.length > 0 || now.pending.length === 0) return now
        const next = await Promise.race([
          woke.then(() => 'wake' as const),
          deadline,
          ...warming.map((one) =>
            one.done.then(() => {
              if (!one.ok && !one.cancelled) failedHere.add(one.key)
              return 'settled' as const
            }),
          ),
        ])
        if (next === 'deadline') return snapshot(caller, scope)
      }
    } finally {
      detach()
    }
  }
  function chained<T>(caller: string, work: () => Promise<T>): Promise<T> {
    const run = (chains.get(caller) ?? Promise.resolve()).then(work)
    const settled = run.catch(() => undefined)
    chains.set(caller, settled)
    void settled.then(() => {
      if (chains.get(caller) === settled) chains.delete(caller)
    })
    return run
  }
  /**
   * One read, queued behind this caller's earlier work. A read still queued when its bound passes
   * answers unknown with the routes still open, and never runs; a release always runs.
   */
  function answered(lease: Readonly<WorkspaceLease>, request: Request): Promise<AgentRoutes> {
    const asked = performance.now()
    const caller = `${lease.id}:${request.incarnation}`
    if (request.release) return chained(caller, () => readRoutes(lease, request, asked))
    let expired = false
    let started = false
    const read = chained(caller, () => {
      if (expired) return Promise.resolve(snapshot(caller, null))
      started = true
      return readRoutes(lease, request, asked)
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    // Only the wait in the queue is bounded here; a read that started keeps its own bound.
    const queued = new Promise<AgentRoutes>((resolve) => {
      timer = setTimeout(() => {
        if (started) return
        expired = true
        resolve(snapshot(caller, null))
      }, answerWithin)
      timer.unref?.()
    })
    return Promise.race([read.finally(() => clearTimeout(timer)), queued])
  }
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
    /** One caller's routes; callers never wait on each other. */
    agentRoutes(lease: Readonly<WorkspaceLease>, request: Request) {
      return answered(lease, request)
    },
    /** The served routes alone, for a peer that reads the array reply. */
    async routes(lease: Readonly<WorkspaceLease>, request: Request) {
      const answer = await answered(lease, request)
      return answer.servers.map(({ name, url, capability }) => ({ name, url, capability }))
    },
    async close() {
      // Every current and pending authority ends before the first await.
      closed = true
      const opening = [...warmups.values()]
      for (const id of [...entries.keys()]) deny(id)
      for (const warmup of opening) warmup.cancelled = true
      warmups.clear()
      await Promise.all([...chains.values(), ...opening.map((one) => one.done)])
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

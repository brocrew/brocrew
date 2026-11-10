import { createRouteAdmissionTrace, type RouteAdmissionSink } from '../route-admission-trace'
import {
  reportPluginToolFailure,
  type PluginToolDiagnostic,
  type PluginToolFailureDetail,
  type PluginDiagnosticDetail,
} from '../tool-diagnostics'
import { randomUUID } from 'node:crypto'
import type { ManagedPluginMcpServer } from '@brobot2/runtime/managed-plugin-mcp'
import {
  managedPluginFailure,
  pluginFailureReason,
  type PluginFailureStage,
} from '@brobot2/runtime/plugin-failure'
import {
  createPluginToolBroker,
  type BrokerOptions,
  type PluginToolBroker,
  type BrokerWorkspace,
} from '../tool-broker'
import { openManagedPluginRoute, type ManagedPluginRoute } from '../managed-transport'
import type { PluginSupervisor, WorkspaceLease } from '../supervisor/owner'
import type { Command } from '../supervisor/protocol'
import type { PluginLifecycleController, AgentScopeEntry } from './controller'
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
  current: (check?: (view: View) => boolean) => boolean
}
/** Lives only in the supervisor. Workspace callers receive scoped routes, never private ports. */
export function createLifecycleAgentBridge(options: {
  owner: Pick<PluginSupervisor, 'valid'>
  controller: Pick<
    PluginLifecycleController,
    'agentAttachments' | 'agentScope' | 'withAgentScope' | 'onHostChanged' | 'attach' | 'detach'
  >
  refused?: () => void | Promise<void>
  routeTrace?: RouteAdmissionSink
  diagnostic?: (
    pluginId: string,
    reason: Parameters<PluginToolDiagnostic>[0],
    detail?: PluginDiagnosticDetail,
  ) => void
  now?: () => number
  answerWithinMs?: number
  openRoute?: typeof openManagedPluginRoute
  /** Owner-only: callback only after positive exit of view.runId and its descendants. */
  recoverChromeHost?: (view: View, stopped: () => void) => Promise<void>
  /** Person fallback when no broker was bound. Chrome only, never owner shutdown. */
  restartChromeHost?: () => Promise<void>
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
  const traceFor = createRouteAdmissionTrace(options.routeTrace)
  const sourceTrace = (lease: Readonly<WorkspaceLease>, request: Request) =>
    traceFor({
      workspace: request.workspaceId,
      source: request.incarnation,
      incarnation: request.incarnation,
      lease: lease.id,
      epoch: lease.epoch,
    })
  const answerWithin = options.answerWithinMs ?? 1000
  const openRoute = options.openRoute ?? openManagedPluginRoute
  type Warmup = {
    caller: string
    pluginId: string
    key: string
    identity: string
    failed: boolean
    cancelled: boolean
    settled: boolean
    done: Promise<void>
  }
  type Answer = {
    servers: (ManagedPluginMcpServer & { pluginId: string })[]
    pending: string[]
    none: string[]
    unknown: boolean
  }
  const warmups = new Map<string, Warmup>()
  // The existing route limit covers opens and late cleanup, not just already published routes.
  const reservations = new Set<symbol>()
  const routeReservations = new WeakMap<ManagedPluginRoute, symbol>()
  const opening = new Set<Promise<void>>()
  const chains = new Map<string, Promise<unknown>>()
  const entryIdentities = new Map<string, string>()
  const identityOf = (view: View) =>
    `${view.installation.installId}:${view.installation.incarnation}:${view.installation.configRevision}:${view.runId}`
  function cancelWarmups(test: (warmup: Warmup) => boolean) {
    for (const [key, warmup] of warmups)
      if (test(warmup)) {
        warmup.cancelled = true
        warmups.delete(key)
      }
  }
  const attachments = new Map<string, Promise<LifecycleWorkspace>>()
  const closing = new Set<Promise<unknown>>()
  const consumerCleanup = new Set<Promise<unknown>>()
  let cleanupFailed = false
  function closeRoute(route: ManagedPluginRoute) {
    const work = route.close()
    const reservation = routeReservations.get(route)
    void work.then(
      () => {
        if (reservation) reservations.delete(reservation)
      },
      () => undefined,
    )
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
  const bindingFailures = new WeakMap<Promise<Entry>, PluginToolFailureDetail>()
  const bindingStages = new Map<string, { stage: PluginFailureStage }>()
  const liveEntries = new Map<string, Entry>()
  const failedRoutes = new Map<string, string>()
  const overflowFailures = new Set<string>()
  function failRoute(key: string, id: string) {
    if (failedRoutes.size < 1024 || failedRoutes.has(key)) failedRoutes.set(key, id)
    else overflowFailures.add(id) // Bounded and conservative until this installation is revoked.
  }
  const failedAttachments = new Set<string>()
  // The last known stage and cause behind each plugin's unavailable tools, in fixed words only.
  const lastCause = new Map<string, string>()
  const diagnostic = (
    id: string,
    pending?: (stage: PluginFailureStage) => void,
  ): PluginToolDiagnostic =>
    Object.assign(
      (reason: Parameters<PluginToolDiagnostic>[0], detail?: PluginDiagnosticDetail) => {
        if (detail && !('tool' in detail)) lastCause.set(id, `${detail.stage}: ${detail.cause}`)
        else if (/failed|unproven|rejected|timeout|capacity|collision|rate-limited/.test(reason))
          lastCause.set(id, reason)
        if (lastCause.size > 256) lastCause.delete(lastCause.keys().next().value!)
        try {
          if (detail) options.diagnostic?.(id, reason, detail)
          else options.diagnostic?.(id, reason)
        } catch {
          /* Observers grant no authority. */
        }
      },
      { pending },
    )
  const routes = new Map<string, Route>()
  const rebuilding = new Set<string>()
  const recoveries = new Map<Entry, Promise<boolean>>()
  const hostExitNotifications = new WeakMap<Entry, Promise<void>>()
  const limited = new WeakSet<Entry>()
  const automaticRestarts: number[] = []
  const now = options.now ?? (() => performance.now())
  const versions = new Map<string, number>()
  const retired = new Set<string>()
  let closed = false
  const valid = (lease: Readonly<WorkspaceLease>) =>
    !closed && options.owner.valid(lease.id, lease.epoch)
  function deny(id: string): Promise<void>[] {
    const pending: Promise<void>[] = []
    versions.set(id, (versions.get(id) ?? 0) + 1)
    lastCause.delete(id)
    const entry = entries.get(id)
    entries.delete(id)
    entryIdentities.delete(id)
    bindingStages.delete(id)
    cancelWarmups((one) => one.pluginId === id)
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
    const prior = recoveries.get(entry)
    if (prior) return prior
    if (closed || id !== 'chrome' || (!manual && !hostGone && liveEntries.get(id) !== entry))
      return Promise.resolve(false)
    if (!manual && entry.broker.status().available) return Promise.resolve(false)
    const completed = entry.broker.owner.hasCompletionProof()
    if ((manual || hostGone || !completed) && !options.recoverChromeHost)
      return Promise.resolve(false)
    if (!manual) {
      const at = now()
      while (automaticRestarts.length && automaticRestarts[0]! <= at - 600_000)
        automaticRestarts.shift()
      if (automaticRestarts.length >= 3) {
        if (!limited.has(entry)) reportPluginToolFailure(diagnostic(id), 'recovery-rate-limited')
        limited.add(entry)
        return Promise.resolve(false)
      }
      automaticRestarts.push(at)
    }
    let hostProven = false
    const work = Promise.resolve()
      .then(async () => {
        if (closed || (!manual && !hostGone && liveEntries.get(id) !== entry)) return false
        if (completed && !manual && !hostGone) {
          const closing = deny(id)
          rebuilding.add(id)
          await Promise.all(closing)
          reportPluginToolFailure(diagnostic(id), 'recovery-broker-completed')
        } else {
          reportPluginToolFailure(diagnostic(id), 'recovery-host-started')
          await options.recoverChromeHost!(entry.view, () => {
            hostProven = true
            entry.confirmHostExit()
            reportPluginToolFailure(diagnostic(id), 'recovery-host-proven')
          })
          reportPluginToolFailure(diagnostic(id), 'recovery-restarted')
          const replacement = liveEntries.get(id)
          const usable =
            replacement?.view.current() &&
            replacement.broker.status().available &&
            [...routes.values()].some(
              (route) =>
                route.pluginId === id &&
                route.identity === replacement.identity &&
                valid(route.lease) &&
                !retired.has(`${route.lease.id}:${route.incarnation}`),
            )
          // External install/revoke must not carry an old warning into its replacement.
          if (
            !usable &&
            options.controller
              .agentAttachments(entry.view.workspaceId)
              .some(
                (view) =>
                  view.current() &&
                  view.installation.installId === entry.view.installation.installId &&
                  view.installation.incarnation === entry.view.installation.incarnation &&
                  view.installation.configRevision === entry.view.installation.configRevision,
              )
          )
            rebuilding.add(id)
        }
        return true
      })
      .catch(() => {
        reportPluginToolFailure(
          diagnostic(id),
          completed && !manual && !hostGone
            ? 'recovery-route-close-failed'
            : hostProven
              ? 'recovery-rebind-failed'
              : 'recovery-host-unproven',
        )
        return false
      })
      .finally(() => {
        if (recoveries.get(entry) === work) recoveries.delete(entry)
      })
    recoveries.set(entry, work)
    return work
  }
  function revoke(lease: Readonly<WorkspaceLease>): void {
    cancelWarmups((one) => one.caller.startsWith(lease.id + ':'))
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
  let waiting = 0
  async function openView(
    lease: Readonly<WorkspaceLease>,
    request: Request,
    view: View,
    live: () => boolean,
    track: (route: ManagedPluginRoute) => void,
  ) {
    const caller = `${lease.id}:${request.incarnation}`
    const id = view.installation.pluginId
    let version = versions.get(id) ?? 0
    const identity = identityOf(view)
    const key = `${caller}:${id}`
    let cached = routes.get(key)
    const known = liveEntries.get(id)
    if (known?.identity === identity && !known.broker.status().available) {
      if (!(await recoverEntry(known))) {
        // Keep the failed broker and its proof barrier until positive completion.
        if (cached) {
          routes.delete(key)
          await closeRoute(cached.route)
        }
        return
      }
      // Re-read the new run/projection with this same caller after proven recovery.
      return
    }
    if (cached?.identity !== identity) {
      if (cached) {
        routes.delete(key)
        await closeRoute(cached.route)
      }
      let work = entries.get(id)
      if (work && entryIdentities.get(id) !== identity) {
        deny(id)
        version = versions.get(id) ?? 0
        work = undefined
      }
      if (!work) {
        const progress = { stage: 'binding-connection' as PluginFailureStage }
        bindingStages.set(id, progress)
        const report = diagnostic(id, (stage) => {
          if (bindingStages.get(id) === progress) progress.stage = stage
        })
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
              if (event.call)
                reportPluginToolFailure(report, 'call-state', { ...event.call, hostRun: view.runId })
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
          if (bindingStages.get(id) === progress) bindingStages.delete(id)
          return entry
        })
        entries.set(id, work)
        entryIdentities.set(id, identity)
        const bindingWork = work
        void bindingWork.catch((error) => {
          if (entries.get(id) === bindingWork) entries.delete(id)
          if (bindingStages.get(id) === progress) bindingStages.delete(id)
          const failure = managedPluginFailure(error, 'route-binding')
          const detail = {
            stage: failure.pluginStage,
            cause: failure.pluginCause,
            correlation: randomUUID(),
            reason: pluginFailureReason(error), // Person log only.
          }
          bindingFailures.set(bindingWork, detail)
          reportPluginToolFailure(report, 'binding-failed', detail)
        })
      }
      try {
        const entry = await work
        if (!live()) return
        let workspace = entry.workspaces.get(lease.id)
        if (!workspace) {
          workspace = entry.broker.owner.attach(request.workspaceId)
          entry.workspaces.set(lease.id, workspace)
        }
        const agent = entry.broker.owner.grantAgent(
          workspace,
          `${request.incarnation}:${randomUUID()}`,
        )
        const source = sourceTrace(lease, request)
        const trace = traceFor({
          ...source.context,
          plugin: id,
          hostRun: view.runId,
        })
        const route = await openRoute(entry.broker, agent, diagnostic(id), trace)
        trace.emit('route-issued')
        track(route)
        if (!live() || !entry.broker.status().available) {
          await closeRoute(route)
          return
        }
        cached = {
          lease: { ...lease },
          workspaceId: request.workspaceId,
          incarnation: request.incarnation,
          pluginId: id,
          identity,
          route,
          current: (check = (one) => one.current()) =>
            valid(lease) &&
            check(view) &&
            !retired.has(caller) &&
            entries.get(id) === work &&
            entry.broker.status().available,
        }
        routes.set(key, cached)
        failedRoutes.delete(key)
        if (![...failedRoutes.values()].includes(id)) lastCause.delete(id)
        if (liveEntries.get(id) === entry) rebuilding.delete(id)
      } catch (error) {
        // A retired attempt may be diagnosed, but cannot degrade its replacement's health.
        const current = live() && (versions.get(id) ?? 0) === version
        if (current) failRoute(key, id)
        const failure = managedPluginFailure(error, 'route-open')
        const detail = bindingFailures.get(work) ?? {
          stage: failure.pluginStage,
          cause: failure.pluginCause,
          correlation: randomUUID(),
          reason: pluginFailureReason(error), // Person log only.
        }
        reportPluginToolFailure(
          diagnostic(id),
          current ? 'route-open-failed' : 'route-stale',
          detail,
        )
        try {
          if (options.refused) await options.refused()
          else console.warn('Some plugin tools were refused.')
        } catch {
          /* Diagnostics cannot hide other plugins. */
        }
        return false as const
      }
    }
  }
  function warm(lease: Readonly<WorkspaceLease>, request: Request, view: View): Warmup | undefined {
    const caller = `${lease.id}:${request.incarnation}`
    const id = view.installation.pluginId
    if (entries.has(id) && entryIdentities.get(id) !== identityOf(view)) deny(id)
    const key = `${caller}:${id}:${identityOf(view)}:${versions.get(id) ?? 0}`
    const existing = warmups.get(key)
    if (existing && (!existing.settled || routes.get(`${caller}:${id}`)?.current())) return existing
    cancelWarmups((one) => one.caller === caller && one.pluginId === id)
    if (reservations.size >= 1024) return undefined
    const reservation = Symbol()
    reservations.add(reservation)
    let allocated = false
    const one: Warmup = {
      caller,
      pluginId: id,
      key,
      identity: `${caller}:${id}:${identityOf(view)}`,
      failed: false,
      cancelled: false,
      settled: false,
      done: Promise.resolve(),
    }
    warmups.set(key, one)
    const live = () =>
      !one.cancelled &&
      warmups.get(key) === one &&
      valid(lease) &&
      view.current() &&
      !retired.has(caller)
    one.done = openView(lease, request, view, live, (route) => {
      allocated = true
      routeReservations.set(route, reservation)
    })
      .then((result) => {
        one.failed = result === false
      })
      .finally(() => {
        one.settled = true
        opening.delete(one.done)
        if (!allocated) reservations.delete(reservation)
        if (warmups.get(key) === one && !routes.get(`${caller}:${id}`)?.current())
          warmups.delete(key)
      })
    // A diagnostic or cleanup failure remains observed and cannot reject a sibling's answer.
    void one.done.catch(() => undefined)
    opening.add(one.done)
    return one
  }
  function snapshot(
    lease: Readonly<WorkspaceLease>,
    request: Request,
    scope: readonly AgentScopeEntry[] | null,
    held: ReadonlySet<string> = new Set(),
    check?: (view: View) => boolean,
  ): Answer {
    const caller = `${lease.id}:${request.incarnation}`
    const servers: Answer['servers'] = []
    if (valid(lease) && !retired.has(caller))
      for (const item of routes.values())
        if (
          item.lease.id === lease.id &&
          item.incarnation === request.incarnation &&
          item.current(check) &&
          !request.occupied.some(
            (name) => name.toLowerCase() === item.route.server.name.toLowerCase(),
          )
        )
          servers.push({ ...item.route.server, pluginId: item.pluginId })
    servers.sort((a, b) => a.pluginId.localeCompare(b.pluginId))
    const served = new Set(servers.map((one) => one.pluginId))
    return {
      servers,
      pending:
        scope
          ?.filter(
            (one) =>
              !served.has(one.pluginId) &&
              one.is !== 'off' &&
              (one.is === 'pending' ||
                held.has(one.pluginId) ||
                [...warmups.values()].some(
                  (w) => w.caller === caller && w.pluginId === one.pluginId && !w.settled,
                )),
          )
          .map((one) => one.pluginId) ?? [],
      none:
        scope
          ?.filter((one) => !served.has(one.pluginId) && one.is === 'off')
          .map((one) => one.pluginId) ?? [],
      unknown: scope === null,
    }
  }
  async function read(
    lease: Readonly<WorkspaceLease>,
    request: Request,
    asked: number,
  ): Promise<Answer> {
    const empty: Answer = { servers: [], pending: [], none: [], unknown: false }
    if (!valid(lease)) return empty
    const caller = `${lease.id}:${request.incarnation}`
    if (request.release) {
      retired.add(caller)
      cancelWarmups((one) => one.caller === caller)
      const pending: Promise<void>[] = []
      for (const key of failedRoutes.keys())
        if (key.startsWith(caller + ':')) failedRoutes.delete(key)
      for (const [key, item] of routes)
        if (item.lease.id === lease.id && item.incarnation === request.incarnation) {
          routes.delete(key)
          pending.push(closeRoute(item.route))
        }
      await Promise.all(pending)
      return empty
    }
    if (retired.has(caller)) return empty
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(
        () => resolve('deadline'),
        Math.max(0, answerWithin - (performance.now() - asked)),
      )
      timer.unref?.()
    })
    let attached = attachments.get(lease.id)
    if (!attached) {
      attached = options.controller.attach({
        workspaceId: request.workspaceId,
        revoke: async (id) => {
          const pending = [...routes].filter(
            ([, item]) => item.lease.id === lease.id && item.pluginId === id,
          )
          for (const [key] of pending) routes.delete(key)
          cancelWarmups((one) => one.caller.startsWith(lease.id + ':') && one.pluginId === id)
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
    let detach = () => {}
    try {
      if ((await Promise.race([attached.then(() => 'attached' as const), deadline])) === 'deadline')
        return snapshot(lease, request, null)
      failedAttachments.delete(lease.id)
      if (!failedAttachments.size) lastCause.delete('host')
      let woken: () => void = () => {}
      let wake = new Promise<void>((resolve) => {
        woken = resolve
      })
      detach = options.controller.onHostChanged((workspaceId) => {
        if (workspaceId !== request.workspaceId) return
        woken()
        wake = new Promise<void>((resolve) => {
          woken = resolve
        })
      })
      const failedHere = new Set<string>()
      let capacityReported = false
      // The last scope this read verified. Once it has one, running out of time answers with
      // it; only a read that never got a scope answers unknown.
      let known: { scope: readonly AgentScopeEntry[]; capacity: Set<string> } | undefined
      for (;;) {
        if (!valid(lease) || retired.has(caller)) return empty
        if (performance.now() - asked >= answerWithin)
          return known
            ? snapshot(lease, request, known.scope, known.capacity)
            : snapshot(lease, request, null)
        const woke = wake
        // Plan without effects under one operation-local, byte-verified decision.
        let plan: {
          scope: readonly AgentScopeEntry[]
          discard: Array<[string, Route]>
          views: View[]
        }
        const taken = new Set(request.occupied.map((one) => one.toLowerCase()))
        try {
          plan = options.controller.withAgentScope(request.workspaceId, (scope, current) => ({
            scope: scope.entries,
            discard: [...routes].filter(
              ([, item]) =>
                item.lease.id === lease.id &&
                item.incarnation === request.incarnation &&
                (!item.current(current) ||
                  !scope.entries.some(
                    (one) =>
                      one.pluginId === item.pluginId &&
                      one.is === 'admitted' &&
                      identityOf(one.view) === item.identity,
                  ) ||
                  taken.has(item.route.server.name.toLowerCase())),
            ),
            views: scope.entries.flatMap((one) => {
              if (one.is !== 'admitted' || !current(one.view)) return []
              const key = `${caller}:${one.pluginId}:${identityOf(one.view)}`
              return routes.get(`${caller}:${one.pluginId}`)?.current(current) ||
                failedHere.has(key)
                ? []
                : [one.view]
            }),
          }))
        } catch {
          return snapshot(lease, request, null)
        }
        for (const [key, item] of plan.discard) {
          routes.delete(key)
          if (taken.has(item.route.server.name.toLowerCase())) {
            failedHere.add(`${caller}:${item.pluginId}:${item.identity}`)
            failRoute(key, item.pluginId)
            reportPluginToolFailure(diagnostic(item.pluginId), 'name-collision')
          }
          void closeRoute(item.route).catch(() => undefined)
        }
        const warming: Warmup[] = []
        const capacityPending = new Set<string>()
        for (const view of plan.views) {
          const opening = warm(lease, request, view)
          if (!opening) {
            capacityPending.add(view.installation.pluginId)
            if (!capacityReported) {
              capacityReported = true
              reportPluginToolFailure(diagnostic(view.installation.pluginId), 'attachment-capacity')
            }
          } else if (!opening.settled) warming.push(opening)
        }
        // Effects and async warmup never inherit the planning snapshot. Answer using a
        // new verified decision after those synchronous effects have been started.
        let scope: readonly AgentScopeEntry[], now: Answer
        try {
          const answer = options.controller.withAgentScope(
            request.workspaceId,
            (scope, current) => ({
              entries: scope.entries,
              answer: snapshot(lease, request, scope.entries, capacityPending, current),
            }),
          )
          scope = answer.entries
          now = answer.answer
        } catch {
          return snapshot(lease, request, null)
        }
        if (now.servers.length || !now.pending.length) return now
        known = { scope, capacity: capacityPending }
        const next = await Promise.race([
          woke.then(() => 'wake' as const),
          deadline,
          ...warming.map((one) =>
            one.done
              .catch(() => undefined)
              .then(() => {
                if (
                  one.failed ||
                  (!routes.get(`${caller}:${one.pluginId}`)?.current() && !one.cancelled)
                )
                  failedHere.add(one.identity)
                return 'settled' as const
              }),
          ),
        ])
        if (next === 'deadline') return snapshot(lease, request, scope, capacityPending)
      }
    } finally {
      clearTimeout(timer)
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
  function answered(lease: Readonly<WorkspaceLease>, request: Request): Promise<Answer> {
    const caller = `${lease.id}:${request.incarnation}`
    sourceTrace(lease, request).emit(request.release ? 'release-received' : 'source-refresh')
    if (request.release && valid(lease)) {
      // Release ends authority when requested, even behind a read or cleanup already in flight.
      retired.add(caller)
      sourceTrace(lease, request).emit('source-retired')
      cancelWarmups((one) => one.caller === caller)
      for (const item of routes.values())
        if (item.lease.id === lease.id && item.incarnation === request.incarnation)
          void closeRoute(item.route).catch(() => undefined)
    }
    if (!request.release && (waiting >= 64 || retired.size >= 4096)) {
      reportPluginToolFailure(diagnostic('host'), 'attachment-capacity')
      return Promise.reject(new Error('unavailable'))
    }
    const asked = performance.now()
    waiting++
    let expired = false,
      started = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const work = chained(caller, () => {
      if (expired) return Promise.resolve(snapshot(lease, request, null))
      started = true
      return read(lease, request, asked)
    })
      .catch((error) => {
        if (valid(lease)) failedAttachments.add(lease.id)
        reportPluginToolFailure(diagnostic('host'), 'attachment-failed')
        throw error
      })
      .finally(() => {
        waiting--
        clearTimeout(timer)
      })
    if (request.release) return work
    const queued = new Promise<Answer>((resolve) => {
      timer = setTimeout(() => {
        if (started) return
        expired = true
        resolve(snapshot(lease, request, null))
      }, answerWithin)
      timer.unref?.()
    })
    return Promise.race([work, queued])
  }
  return {
    deny,
    revoke,
    /** A run id is a non-authorizing wakeup, never a substitute for its retained proof. */
    hostExited(runId: string): void {
      void (async () => {
        const entry = liveEntries.get('chrome') ?? (await stopping.get('chrome'))
        if (closed || !entry || entry.view.runId !== runId) return
        let work = hostExitNotifications.get(entry)
        if (!work) {
          work = (async () => {
            await entry.view.exited
            await entry.hostExitProof
            if (closed) return
            const prior = recoveries.get(entry)
            if (prior && (await prior)) return
            if (!closed) await recoverEntry(entry, false, true)
          })()
          hostExitNotifications.set(entry, work)
        }
        await work
      })().catch(() => reportPluginToolFailure(diagnostic('chrome'), 'host-exit-unproven'))
    },
    async restartChrome(): Promise<void> {
      if (closed) throw new Error('unavailable')
      const entry = liveEntries.get('chrome') ?? (await stopping.get('chrome'))
      if (entry && (!entry.broker.owner.hasCompletionProof() || !options.restartChromeHost)) {
        if (!(await recoverEntry(entry, true))) throw new Error('unavailable')
      } else {
        if (!options.restartChromeHost) throw new Error('unavailable')
        reportPluginToolFailure(diagnostic('chrome'), 'recovery-host-started')
        try {
          await options.restartChromeHost()
          reportPluginToolFailure(diagnostic('chrome'), 'recovery-host-proven')
        } catch {
          reportPluginToolFailure(diagnostic('chrome'), 'recovery-restart-failed')
          throw new Error('unavailable')
        }
      }
    },
    toolsUnavailable(id: string): boolean {
      return (
        failedAttachments.size > 0 ||
        rebuilding.has(id) ||
        overflowFailures.has(id) ||
        liveEntries.get(id)?.broker.status().available === false ||
        [...failedRoutes].some(
          ([key, plugin]) =>
            plugin === id &&
            ![...warmups.values()].some(
              (one) => !one.cancelled && !one.settled && `${one.caller}:${id}` === key,
            ),
        )
      )
    },
    toolsPending(id: string): string | undefined {
      const pending = [...warmups.values()].some(
        (one) => one.pluginId === id && !one.cancelled && !one.settled,
      )
      return pending ? (bindingStages.get(id)?.stage ?? 'route-open') : undefined
    },
    /** Why this plugin's tools are unavailable, as `stage: cause` or a fixed reason, if known. */
    toolsCause(id: string): string | undefined {
      return lastCause.get(id) ?? (failedAttachments.size ? lastCause.get('host') : undefined)
    },
    agentRoutes(lease: Readonly<WorkspaceLease>, request: Request) {
      return answered(lease, request)
    },
    async routes(lease: Readonly<WorkspaceLease>, request: Request) {
      return (await answered(lease, request)).servers.map(({ name, url, capability }) => ({
        name,
        url,
        capability,
      }))
    },
    async close() {
      closed = true
      for (const id of entries.keys()) deny(id)
      await Promise.allSettled([...recoveries.values()])
      cancelWarmups(() => true)
      await Promise.allSettled([...chains.values(), ...opening])
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

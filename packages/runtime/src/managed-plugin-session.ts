import { randomUUID } from 'node:crypto'
import type { ManagedPluginDiscovery } from './managed-plugin-observation'
import { TurnInProgress } from './turn-in-progress'
import type { AgentRuntime, ResumeOptions, SessionHandle, StartOptions } from './runtime'
import { ResumeError } from './runtime'
import { wrapUnknown, type RuntimeEvent } from './events'
import type { ManagedPluginMcpServer } from './managed-plugin-mcp'
import { managedPluginHttpServers } from './managed-plugin-mcp'
import { AsyncQueue } from './internal/async-queue'
import { ManagedPluginOwnership } from './managed-plugin-ownership'
import { RejectedSessionLaunch } from './rejected-session-launch'
import {
  ManagedPluginFailure,
  managedPluginFailure,
  type PluginFailureStage,
} from './managed-plugin-failure'

export interface ManagedPluginAttachment {
  readonly revision: string
  readonly servers: readonly ManagedPluginMcpServer[]
  /**
   * Present only when the reply named each plugin: those still starting, those committed state
   * says are off, and whether the scope could be read at all. Without it, `servers` is the
   * complete set. With it, a route already attached for a plugin still starting or unknown stays;
   * only an off plugin, or a new route for it, replaces it. A route attached without a plugin
   * stays until a route is served under its name.
   */
  readonly plugins?: {
    readonly pending: readonly string[]
    readonly none: readonly string[]
    readonly unknown: boolean
  }
}
/** The routes to keep configured: a partial reply keeps what it could not speak for. */
function retained(
  previous: readonly ManagedPluginMcpServer[],
  next: ManagedPluginAttachment,
): readonly ManagedPluginMcpServer[] {
  const plugins = next.plugins
  if (plugins === undefined) return next.servers
  const served = new Set(next.servers.map((one) => one.pluginId))
  const names = new Set(next.servers.map((one) => one.name))
  const off = new Set(plugins.none)
  // Only an explicit off, or a new route for the same plugin, removes an attached route. A route
  // from a reply that named no plugin can be replaced only by a route served under its name.
  const kept = previous.filter((one) =>
    one.pluginId === undefined
      ? !names.has(one.name)
      : !served.has(one.pluginId) && !off.has(one.pluginId),
  )
  return [...next.servers, ...kept.map((one) => ({ ...one, retained: true as const }))]
}
type ManagedPluginLaunchObservation = {
  readonly launch: string
  readonly provider: string
  readonly stage: 'initial-read' | 'before-send-read' | 'provider-discovery' | 'provider-launch'
  readonly outcome:
    'configured' | 'empty' | 'failed' | 'discovered' | 'unavailable' | 'timeout' | 'cancelled'
  readonly servers: readonly Pick<ManagedPluginMcpServer, 'name' | 'url' | 'pluginId'>[]
  readonly pending?: readonly string[]
  readonly off?: readonly string[]
  readonly unknown?: boolean
  readonly failureStage?: PluginFailureStage
  readonly discovery?: ManagedPluginDiscovery
}
export interface ManagedPluginAttachmentSource {
  observe?(event: ManagedPluginLaunchObservation): void
  read(): Promise<ManagedPluginAttachment>
  close(): Promise<void>
}
const signature = (value: ManagedPluginAttachment) =>
  JSON.stringify(
    value.servers
      .map(({ name, url, capability }) => ({ name, url, capability }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  )
export const PLUGIN_ATTACHMENT_WAIT_MS = 1500
export const MANAGED_PLUGIN_REOPEN_WITHIN_MS = 60000
/** A cancelled message must not be redelivered when its handle is retired. */
export class StoppedBeforeSend extends Error {
  constructor() {
    super("Your message wasn't sent. Press Send to try again.")
  }
}
async function bounded<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  within: number = PLUGIN_ATTACHMENT_WAIT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop!: () => void
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        stop = () => reject(new ManagedPluginFailure('wrapper-wait', 'cancelled'))
        timer = setTimeout(
          () => reject(new ManagedPluginFailure('wrapper-wait', 'timeout')),
          within,
        )
        signal?.addEventListener('abort', stop, { once: true })
        if (signal?.aborted) stop()
      }),
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  }
}
/** One attachment source per provider incarnation. No provider-home writes or person surface. */
export function withManagedPluginAttachments(
  runtime: AgentRuntime,
  source: ManagedPluginAttachmentSource,
): AgentRuntime {
  async function open(
    options: StartOptions | ResumeOptions,
    ref?: NonNullable<SessionHandle['ref']>,
  ): Promise<SessionHandle> {
    let launchId = ''
    try {
      launchId = randomUUID().replaceAll('-', '')
    } catch {
      /* A diagnostic identity is not a launch requirement. */
    }
    function observe(event: Omit<ManagedPluginLaunchObservation, 'launch' | 'provider'>) {
      try {
        source.observe?.({ ...event, launch: launchId, provider: runtime.provider })
      } catch {
        /* Observation never changes a launch or send. */
      }
    }
    let unavailable: unknown
    let attachment: ManagedPluginAttachment = { revision: '', servers: [] }
    // At most one source read at a time. One that outlived a send's wait keeps running; the next
    // send does not wait for it again, and adopts its result once it has settled.
    let outstanding:
      { work: Promise<ManagedPluginAttachment>; settled: boolean; outlived: boolean } | undefined
    async function read(
      signal?: AbortSignal,
      within?: number,
      stage: 'initial-read' | 'before-send-read' = 'initial-read',
    ) {
      if (!outstanding) {
        const one = { work: source.read(), settled: false, outlived: false }
        void one.work.then(
          () => (one.settled = true),
          () => (one.settled = true),
        )
        outstanding = one
      }
      const one = outstanding
      let next: ManagedPluginAttachment
      try {
        if (one.outlived && !one.settled)
          throw new ManagedPluginFailure('attachment-read', 'pending')
        next = await bounded(one.work, signal, within)
      } catch (error) {
        if (!one.settled && !signal?.aborted) one.outlived = true
        throw managedPluginFailure(error, 'attachment-read')
      } finally {
        if (one.settled && outstanding === one) outstanding = undefined
      }
      try {
        if (next.revision.length > 256 || next.servers.length > 32)
          throw new ManagedPluginFailure('attachment-schema', 'invalid-reply')
        managedPluginHttpServers(next.servers)
      } catch {
        throw new ManagedPluginFailure('attachment-schema', 'invalid-reply')
      }
      observe({
        stage,
        outcome: next.servers.length ? 'configured' : 'empty',
        servers: next.servers,
        pending: next.plugins?.pending,
        off: next.plugins?.none,
        unknown: next.plugins?.unknown,
      })
      return {
        revision: next.revision,
        servers: retained(attachment.servers, next).map((one) => ({ ...one })),
      }
    }
    try {
      attachment = await read(options.signal)
    } catch (error) {
      unavailable = error
      observe({
        stage: 'initial-read',
        outcome: 'failed',
        servers: [],
        failureStage: managedPluginFailure(error, 'attachment-read').pluginStage,
      })
    }
    const discoveryObserver =
      (servers: readonly ManagedPluginMcpServer[]) => (discovery: ManagedPluginDiscovery) =>
        observe({
          stage: 'provider-discovery',
          outcome: discovery.outcome,
          servers,
          discovery,
        })
    let currentDiscoveryObserver = discoveryObserver(attachment.servers)
    const launch = {
      ...options,
      managedPluginMcp: attachment.servers,
      observeManagedPlugins: (discovery: ManagedPluginDiscovery) =>
        currentDiscoveryObserver(discovery),
    }
    let inner: SessionHandle
    try {
      if (ref) inner = await runtime.resume(ref, launch)
      else if ('cwd' in launch) inner = await runtime.start(launch)
      else throw new Error('Plugin unavailable. Try again.')
    } catch (error) {
      observe({ stage: 'provider-launch', outcome: 'failed', servers: attachment.servers })
      await bounded(source.close()).catch(() => undefined)
      throw error
    }
    const ownership = new ManagedPluginOwnership()
    ownership.track(inner)
    const events = new AsyncQueue<RuntimeEvent>()
    if (source.observe)
      events.push(
        wrapUnknown(
          runtime.provider,
          { method: 'plugin/launch', launch: launchId },
          'lifecycle',
          'plugin/launch',
        ),
      )
    let reported = false
    function noteUnavailable(error?: unknown, stage: PluginFailureStage = 'attachment-read') {
      if (reported) return
      reported = true
      const failure = managedPluginFailure(error, stage)
      events.push(
        wrapUnknown(
          runtime.provider,
          {
            method: 'plugin/attachment',
            outcome: 'unavailable',
            stage: failure.pluginStage,
            cause: failure.pluginCause,
            message: failure.message,
          },
          'lifecycle',
          'plugin/attachment',
        ),
      )
    }
    if (unavailable) noteUnavailable(unavailable)
    let closed = false,
      generation = 0,
      pending: AbortController | undefined
    let pendingSend: Promise<void> | undefined
    let closing: Promise<void> | undefined
    // A plugin refresh still running after the send's wait. It keeps going and is adopted when
    // it settles; later sends neither wait for it again nor start another.
    let refreshing: Promise<void> | undefined
    let dispatched = false,
      providerActive = false,
      freshAttempted = false,
      freshRepairPending = false
    const settings: Record<string, unknown> = {}
    let settingsRevision = 0
    let changingSettings = 0
    const savedSettings = new Map<string, number>()
    function rememberSetting(field: string, value: unknown, revision: number) {
      if (revision < (savedSettings.get(field) ?? 0)) return
      savedSettings.set(field, revision)
      if (field === 'planMode') {
        settings.planMode = true
        settings.planModeEnded = value === false
      } else settings[field] = value
    }
    function listen(handle: SessionHandle) {
      const current = ++generation
      void (async () => {
        try {
          for await (const event of handle.events())
            if (current === generation) {
              if (
                event.type === 'turn' ||
                event.type === 'provider_turn' ||
                event.type === 'assistant_delta' ||
                event.type === 'assistant_message' ||
                event.type === 'tool_call' ||
                event.type === 'tool_result' ||
                event.type === 'thinking' ||
                event.type === 'conversation_reset' ||
                event.type === 'permission_request' ||
                event.type === 'user_input_request' ||
                (event.type === 'status' && event.state === 'working')
              )
                providerActive = true
              events.push(event)
            }
        } catch {
          /* The provider's normalized events own its error reporting. */
        } finally {
          if (current === generation) events.close()
        }
      })()
    }
    listen(inner)
    const seed = { ...options }
    const proxy = new Proxy({} as SessionHandle, {
      get(_target, key) {
        if (key === 'events') return () => events
        if (key === 'awaitProcessExit') return () => ownership.awaitProcessExit()
        if (key === 'status' && pending) return () => 'working'
        if (key === 'send')
          return (...args: Parameters<SessionHandle['send']>) => {
            if (pending) return Promise.reject(new TurnInProgress())
            if (closed || inner.status() !== 'idle') {
              if (freshRepairPending) return Promise.reject(new StoppedBeforeSend())
              dispatched = true
              return inner.send(...args)
            }
            const send = async () => {
              const wait = new AbortController()
              pending = wait
              let repairingUnused = false
              let handedInput = false
              let preparationAbort: AbortController | undefined
              let preparationDeadline: ReturnType<typeof setTimeout> | undefined
              // One shared wait for plugin work before this message goes out. It never refuses:
              // whatever is not ready by then attaches at a later send.
              const until = performance.now() + PLUGIN_ATTACHMENT_WAIT_MS
              const left = () => Math.max(0, until - performance.now())
              try {
                let next: ManagedPluginAttachment | undefined
                try {
                  next = await read(wait.signal, left(), 'before-send-read')
                } catch (error) {
                  observe({
                    stage: 'before-send-read',
                    outcome: 'failed',
                    servers: attachment.servers,
                    failureStage: managedPluginFailure(error, 'attachment-read').pluginStage,
                  })
                  noteUnavailable(error)
                }
                let stale: readonly string[] = []
                // Retained routes stay configured while pending, but their retired endpoints
                // cannot authorize recovery. A newly served exact route is eligible again.
                const health =
                  next?.servers.filter(
                    (one) =>
                      !one.retained &&
                      attachment.servers.some(
                        (old) =>
                          old.name === one.name &&
                          old.url === one.url &&
                          old.capability === one.capability &&
                          old.pluginId === one.pluginId,
                      ),
                  ) ?? []
                if (health.length && inner.managedPluginHealth && !refreshing) {
                  try {
                    const failed = await bounded(
                      inner.managedPluginHealth(health),
                      wait.signal,
                      left(),
                    )
                    // Only names from this handle's admitted routes may authorize recovery.
                    stale = failed?.filter((name) => health.some((one) => one.name === name)) ?? []
                  } catch {
                    // An unreadable or late status is unknown, not a reason to replace a provider.
                  }
                }
                if (closed || wait.signal.aborted)
                  throw new Error('the turn was stopped before its message could be sent')
                if (inner.status() !== 'idle') throw new TurnInProgress()
                if (
                  next &&
                  !refreshing &&
                  (signature(next) !== signature(attachment) || stale.length)
                ) {
                  if (inner.refreshManagedPlugins) {
                    const offered = next
                    let settled = false
                    const applying = (
                      stale.length
                        ? inner.refreshManagedPlugins(offered.servers, stale)
                        : inner.refreshManagedPlugins(offered.servers)
                    ).then(
                      () => {
                        settled = true
                        if (!closed) {
                          attachment = offered
                          currentDiscoveryObserver = discoveryObserver(offered.servers)
                        }
                      },
                      (error: unknown) => {
                        settled = true
                        throw error
                      },
                    )
                    try {
                      await bounded(applying, wait.signal, left())
                    } catch (error) {
                      if (settled) noteUnavailable(error, 'sdk-refresh')
                      else {
                        // Still applying: keep the usable handle, let the refresh finish on its
                        // own and adopt it then. The message goes out (or, after Stop, does not).
                        refreshing = applying
                        void applying
                          .catch((late: unknown) => noteUnavailable(late, 'sdk-refresh'))
                          .finally(() => {
                            if (refreshing === applying) refreshing = undefined
                          })
                        if (wait.signal.aborted && !closed) throw new StoppedBeforeSend()
                      }
                    }
                  } else if (
                    inner.ref &&
                    inner.status() === 'idle' &&
                    (await ownership.mayReopen()) &&
                    changingSettings === 0
                  ) {
                    // Codex has no per-thread MCP configuration update. Reopen only between turns.
                    const saved = inner.ref
                    const preparedSettings = settingsRevision
                    const resume = {
                      ...seed,
                      ...settings,
                      observeManagedPlugins: discoveryObserver(next.servers),
                      managedPluginMcp: next.servers,
                      signal: wait.signal,
                    }
                    const abort = new AbortController()
                    preparationAbort = abort
                    preparationDeadline = setTimeout(
                      () => abort.abort(),
                      MANAGED_PLUGIN_REOPEN_WITHIN_MS,
                    )
                    let freshRepair = false
                    async function reopen(
                      servers: readonly ManagedPluginMcpServer[],
                      fresh = false,
                    ) {
                      let allocated: SessionHandle | undefined
                      try {
                        // Cancellation owns settlement; a deadline never fabricates child exit.
                        const preparing = {
                          ...resume,
                          managedPluginMcp: servers,
                          signal: AbortSignal.any([wait.signal, abort.signal]),
                          onSessionCreated: (handle: SessionHandle) => {
                            allocated = handle
                            ownership.track(handle)
                            options.onSessionCreated?.(handle)
                          },
                        }
                        const handle = fresh
                          ? await runtime.start({ ...preparing, cwd: (seed as StartOptions).cwd })
                          : await runtime.resume(saved, preparing)
                        ownership.track(handle)
                        return handle
                      } catch (error) {
                        if (error instanceof RejectedSessionLaunch) ownership.trackRefused(error)
                        if (allocated) await ownership.retire(allocated).catch(() => undefined)
                        throw error
                      }
                    }
                    let replacement: SessionHandle | undefined
                    try {
                      try {
                        replacement = await reopen(next.servers)
                      } catch (error) {
                        const missingUnusedThread =
                          !ref &&
                          runtime.canRecreateMissingUnusedSession === true &&
                          !dispatched &&
                          !providerActive &&
                          error instanceof ResumeError &&
                          error.noSuchSession &&
                          error.ref.provider === saved.provider &&
                          error.ref.sessionId === saved.sessionId &&
                          error.ref.cwd === saved.cwd &&
                          error.ref.rotation === saved.rotation
                        if (missingUnusedThread) {
                          freshRepair = true
                          repairingUnused = true
                          freshRepairPending = true
                          if (
                            freshAttempted ||
                            closed ||
                            wait.signal.aborted ||
                            abort.signal.aborted ||
                            inner.status() !== 'idle' ||
                            changingSettings !== 0 ||
                            settingsRevision !== preparedSettings ||
                            !(await ownership.mayReopen())
                          )
                            throw new StoppedBeforeSend()
                          // Ownership settles asynchronously; eligibility must still hold now.
                          if (
                            closed ||
                            wait.signal.aborted ||
                            abort.signal.aborted ||
                            dispatched ||
                            providerActive ||
                            inner.status() !== 'idle' ||
                            changingSettings !== 0 ||
                            settingsRevision !== preparedSettings
                          )
                            throw new StoppedBeforeSend()
                          freshAttempted = true
                          replacement = await reopen(next.servers, true)
                        } else {
                          if (closed || wait.signal.aborted) throw error
                          noteUnavailable(error, 'provider-reopen')
                        }
                      }
                    } catch (error) {
                      if (freshRepair) throw new StoppedBeforeSend()
                      throw error
                    }
                    if (!freshRepair) clearTimeout(preparationDeadline)
                    // A setting changed on the live handle must not be replaced by a stale copy.
                    if (
                      replacement &&
                      (changingSettings !== 0 || settingsRevision !== preparedSettings)
                    ) {
                      await ownership.retire(replacement).catch(() => undefined)
                      replacement = undefined
                      noteUnavailable(undefined, 'provider-reopen')
                      if (freshRepair) throw new StoppedBeforeSend()
                    }
                    if (replacement) {
                      if (
                        freshRepair &&
                        (dispatched ||
                          providerActive ||
                          abort.signal.aborted ||
                          replacement.status() !== 'idle')
                      ) {
                        await ownership.retire(replacement).catch(() => undefined)
                        throw new StoppedBeforeSend()
                      }
                      if (inner.status() !== 'idle' && !closed) {
                        await ownership.retire(replacement).catch(() => undefined)
                        throw freshRepair ? new StoppedBeforeSend() : new TurnInProgress()
                      }
                      if (closed || wait.signal.aborted) {
                        await ownership.retire(replacement).catch(() => undefined)
                        if (freshRepair) throw new StoppedBeforeSend()
                        throw new Error('the turn was stopped before its message could be sent')
                      }
                      const previous = inner
                      inner = replacement
                      attachment = next
                      freshRepairPending = false
                      listen(inner)
                      await ownership
                        .retire(previous)
                        .catch((error) => noteUnavailable(error, 'provider-retire'))
                    }
                  } else {
                    noteUnavailable(undefined, 'provider-reopen')
                  }
                }
                if (closed || wait.signal.aborted)
                  throw new Error('the turn was stopped before its message could be sent')
                if (repairingUnused && preparationAbort?.signal.aborted)
                  throw new StoppedBeforeSend()
                // A marker-only change updates what the turn waits on without reopening it.
                if (next && signature(next) === signature(attachment)) attachment = next
                if (next)
                  inner.awaitManagedPlugins?.(
                    next.servers.filter((one) => !one.retained).map((one) => one.name),
                  )
                pending = undefined
                if (freshRepairPending) throw new StoppedBeforeSend()
                dispatched = true
                handedInput = true
                return inner.send(...args)
              } catch (error) {
                if ((repairingUnused || freshRepairPending) && !handedInput)
                  throw new StoppedBeforeSend()
                throw error
              } finally {
                clearTimeout(preparationDeadline)
                if (pending === wait) pending = undefined
              }
            }
            const work = send()
            const settled = work.then(
              () => undefined,
              () => undefined,
            )
            pendingSend = settled
            void settled.then(() => {
              if (pendingSend === settled) pendingSend = undefined
            })
            return work
          }
        if (key === 'interrupt')
          return async (...args: Parameters<SessionHandle['interrupt']>) => {
            pending?.abort()
            return inner.interrupt(...args)
          }
        if (key === 'close')
          return () =>
            (closing ??= (async () => {
              closed = true
              pending?.abort()
              try {
                await ownership.closeAll()
                await pendingSend
                await ownership.closeAll()
              } finally {
                ownership.seal()
                await bounded(source.close()).catch(() => undefined)
                events.close()
              }
            })())
        const value = Reflect.get(inner, key, inner)
        if (typeof value !== 'function') return value
        if (key === 'carryOn' || key === 'compact')
          return (...args: unknown[]) => {
            dispatched = true
            return value.apply(inner, args)
          }
        const fields: Record<string, string> = {
          setModel: 'model',
          setReasoningEffort: 'reasoningEffort',
          setApprovalMode: 'approvalMode',
          setWorkFolders: 'workFolders',
        }
        const field =
          key === 'setPlanMode' ? 'planMode' : typeof key === 'string' ? fields[key] : undefined
        if (field)
          return (...args: unknown[]) => {
            const revision = ++settingsRevision
            const handle = inner
            const setter = Reflect.get(handle, key, handle) as (...args: unknown[]) => unknown
            if (key === 'setWorkFolders') {
              const folders = [...(args[0] as readonly string[])]
              const result = setter.apply(handle, [folders])
              rememberSetting(field, folders, revision)
              return result
            }
            changingSettings++
            return (async () => {
              try {
                const result = await setter.apply(handle, args)
                rememberSetting(field, args[0], revision)
                return result
              } finally {
                changingSettings--
              }
            })()
          }
        return (...args: unknown[]) => value.apply(inner, args)
      },
    })
    return proxy
  }
  return new Proxy(runtime, {
    get(target, key) {
      if (key === 'start') return (options: StartOptions) => open(options)
      if (key === 'resume')
        return (ref: NonNullable<SessionHandle['ref']>, options: ResumeOptions) =>
          open(options, ref)
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

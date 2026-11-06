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
export interface ManagedPluginAttachmentSource {
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
async function bounded<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop!: () => void
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        stop = () => reject(new ManagedPluginFailure('wrapper-wait', 'cancelled'))
        timer = setTimeout(
          () => reject(new ManagedPluginFailure('wrapper-wait', 'timeout')),
          PLUGIN_ATTACHMENT_WAIT_MS,
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
    let unavailable: unknown
    let attachment: ManagedPluginAttachment = { revision: '', servers: [] }
    async function read(signal?: AbortSignal) {
      let next: ManagedPluginAttachment
      try {
        next = await bounded(source.read(), signal)
      } catch (error) {
        throw managedPluginFailure(error, 'attachment-read')
      }
      try {
        if (next.revision.length > 256 || next.servers.length > 32)
          throw new ManagedPluginFailure('attachment-schema', 'invalid-reply')
        managedPluginHttpServers(next.servers)
      } catch {
        throw new ManagedPluginFailure('attachment-schema', 'invalid-reply')
      }
      return {
        revision: next.revision,
        servers: retained(attachment.servers, next).map((one) => ({ ...one })),
      }
    }
    try {
      attachment = await read(options.signal)
    } catch (error) {
      unavailable = error
    }
    const launch = { ...options, managedPluginMcp: attachment.servers }
    let inner: SessionHandle
    try {
      if (ref) inner = await runtime.resume(ref, launch)
      else if ('cwd' in launch) inner = await runtime.start(launch)
      else throw new Error('Plugin unavailable. Try again.')
    } catch (error) {
      await bounded(source.close()).catch(() => undefined)
      throw error
    }
    const ownership = new ManagedPluginOwnership()
    ownership.track(inner)
    const events = new AsyncQueue<RuntimeEvent>()
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
    let refreshRefusal: Error | undefined
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
        if (key === 'status' && refreshRefusal) return () => 'ended'
        if (key === 'status' && pending) return () => 'working'
        if (key === 'send')
          return (...args: Parameters<SessionHandle['send']>) => {
            if (refreshRefusal) return Promise.reject(refreshRefusal)
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
              try {
                let next: ManagedPluginAttachment | undefined
                try {
                  next = await read(wait.signal)
                } catch (error) {
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
                if (health.length && inner.managedPluginHealth) {
                  try {
                    const failed = await bounded(inner.managedPluginHealth(health), wait.signal)
                    // Only names from this handle's admitted routes may authorize recovery.
                    stale = failed?.filter((name) => health.some((one) => one.name === name)) ?? []
                  } catch {
                    // An unreadable or late status is unknown, not a reason to replace a provider.
                  }
                }
                if (closed || wait.signal.aborted)
                  throw new Error('the turn was stopped before its message could be sent')
                if (inner.status() !== 'idle') throw new TurnInProgress()
                if (next && (signature(next) !== signature(attachment) || stale.length)) {
                  if (inner.refreshManagedPlugins) {
                    let settled = false
                    try {
                      const refreshing = (
                        stale.length
                          ? inner.refreshManagedPlugins(next.servers, stale)
                          : inner.refreshManagedPlugins(next.servers)
                      ).then(
                        () => {
                          settled = true
                        },
                        (error: unknown) => {
                          settled = true
                          throw error
                        },
                      )
                      await bounded(refreshing, wait.signal)
                      attachment = next
                    } catch (error) {
                      if (!settled) {
                        refreshRefusal =
                          wait.signal.aborted && !closed
                            ? new StoppedBeforeSend()
                            : new Error("Your message wasn't sent. Press Send to try again.")
                        // The host can retry only after this handle's retirement confirms exit.
                        void proxy.close().catch(() => undefined)
                        throw refreshRefusal
                      }
                      noteUnavailable(error, 'sdk-refresh')
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

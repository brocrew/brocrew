import { TurnInProgress } from './turn-in-progress'
import type { AgentRuntime, ResumeOptions, SessionHandle, StartOptions } from './runtime'
import { wrapUnknown, type RuntimeEvent } from './events'
import type { ManagedPluginMcpServer } from './managed-plugin-mcp'
import { managedPluginHttpServers } from './managed-plugin-mcp'
import { AsyncQueue } from './internal/async-queue'
import { ManagedPluginOwnership } from './managed-plugin-ownership'

export interface ManagedPluginAttachment {
  readonly revision: string
  readonly servers: readonly ManagedPluginMcpServer[]
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
        stop = () => reject(new Error('Plugin unavailable. Try again.'))
        timer = setTimeout(stop, PLUGIN_ATTACHMENT_WAIT_MS)
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
    let unavailable = false
    let attachment: ManagedPluginAttachment = { revision: '', servers: [] }
    async function read(signal?: AbortSignal) {
      const next = await bounded(source.read(), signal)
      if (next.revision.length > 256 || next.servers.length > 32)
        throw new Error('Plugin unavailable. Try again.')
      managedPluginHttpServers(next.servers)
      return { revision: next.revision, servers: next.servers.map((one) => ({ ...one })) }
    }
    try {
      attachment = await read(options.signal)
    } catch {
      unavailable = true
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
    function noteUnavailable() {
      if (reported) return
      reported = true
      events.push(
        wrapUnknown(
          runtime.provider,
          {
            method: 'plugin/attachment',
            outcome: 'unavailable',
            message: 'Plugin unavailable. Try again.',
          },
          'lifecycle',
          'plugin/attachment',
        ),
      )
    }
    if (unavailable) noteUnavailable()
    let closed = false,
      generation = 0,
      pending: AbortController | undefined
    let pendingSend: Promise<void> | undefined
    let closing: Promise<void> | undefined
    let refreshRefusal: Error | undefined
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
          for await (const event of handle.events()) if (current === generation) events.push(event)
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
            if (closed || inner.status() !== 'idle') return inner.send(...args)
            const send = async () => {
              const wait = new AbortController()
              pending = wait
              try {
                let next: ManagedPluginAttachment | undefined
                try {
                  next = await read(wait.signal)
                } catch {
                  noteUnavailable()
                }
                if (closed || wait.signal.aborted)
                  throw new Error('the turn was stopped before its message could be sent')
                if (next && signature(next) !== signature(attachment)) {
                  if (inner.refreshManagedPlugins) {
                    let settled = false
                    try {
                      const refreshing = inner.refreshManagedPlugins(next.servers).then(
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
                    } catch {
                      if (!settled) {
                        refreshRefusal =
                          wait.signal.aborted && !closed
                            ? new StoppedBeforeSend()
                            : new Error("Your message wasn't sent. Press Send to try again.")
                        // The host can retry only after this handle's retirement confirms exit.
                        void proxy.close().catch(() => undefined)
                        throw refreshRefusal
                      }
                      noteUnavailable()
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
                    async function reopen(servers: readonly ManagedPluginMcpServer[]) {
                      const abort = new AbortController()
                      const deadline = setTimeout(
                        () => abort.abort(),
                        MANAGED_PLUGIN_REOPEN_WITHIN_MS,
                      )
                      let allocated: SessionHandle | undefined
                      try {
                        // Cancellation owns settlement; a deadline never fabricates child exit.
                        const handle = await runtime.resume(saved, {
                          ...resume,
                          managedPluginMcp: servers,
                          signal: AbortSignal.any([wait.signal, abort.signal]),
                          onSessionCreated: (handle) => {
                            allocated = handle
                            ownership.track(handle)
                            ;(options as ResumeOptions).onSessionCreated?.(handle)
                          },
                        })
                        ownership.track(handle)
                        return handle
                      } catch (error) {
                        if (allocated) await ownership.retire(allocated).catch(() => undefined)
                        throw error
                      } finally {
                        clearTimeout(deadline)
                      }
                    }
                    let replacement: SessionHandle | undefined
                    try {
                      replacement = await reopen(next.servers)
                    } catch (error) {
                      if (closed || wait.signal.aborted) throw error
                      noteUnavailable()
                    }
                    // A setting changed on the live handle must not be replaced by a stale copy.
                    if (
                      replacement &&
                      (changingSettings !== 0 || settingsRevision !== preparedSettings)
                    ) {
                      await ownership.retire(replacement).catch(() => undefined)
                      replacement = undefined
                      noteUnavailable()
                    }
                    if (replacement) {
                      if (inner.status() !== 'idle' && !closed) {
                        await ownership.retire(replacement).catch(() => undefined)
                        throw new TurnInProgress()
                      }
                      if (closed || wait.signal.aborted) {
                        await ownership.retire(replacement).catch(() => undefined)
                        throw new Error('the turn was stopped before its message could be sent')
                      }
                      const previous = inner
                      inner = replacement
                      attachment = next
                      listen(inner)
                      await ownership.retire(previous).catch(() => noteUnavailable())
                    }
                  } else {
                    noteUnavailable()
                  }
                }
                if (closed || wait.signal.aborted)
                  throw new Error('the turn was stopped before its message could be sent')
                pending = undefined
                return inner.send(...args)
              } finally {
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

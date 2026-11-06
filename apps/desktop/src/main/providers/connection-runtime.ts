import { RejectedSessionLaunch } from '@brobot2/runtime'
import type {
  AgentRuntime,
  ProviderRuntimeContext,
  ResumeOptions,
  SessionHandle,
  StartOptions,
} from '@brobot2/runtime'
import { compatibilityConnectionId, type Provider, type ProviderConnection } from '@brobot2/shared'

/**
 * Bind each child to admitted metadata without changing its credential or state services.
 * `create` is the bound module's concrete adapter factory: its immutable recovery
 * capability must be consistent across instances, including concurrent operations.
 */
export function onProviderConnection(
  provider: Provider,
  create: () => AgentRuntime,
  resolve: (connectionId?: string | null) => ProviderConnection,
  connectionId?: string | null,
  revision: () => number = () => 0,
): AgentRuntime {
  function admit(context: ProviderRuntimeContext): string {
    context.signal?.throwIfAborted()
    const connection = resolve(connectionId)
    const method = connection.authMethod
    if (
      connection.provider !== provider ||
      (method !== 'sign-in' && method !== 'api-key') ||
      connection.id !== compatibilityConnectionId(provider, method) ||
      (connectionId != null && connection.id !== connectionId) ||
      connection.credentialSource !==
        (method === 'api-key' ? 'provider-api-key' : 'provider-sign-in') ||
      connection.baseUrl !== null ||
      connection.enabled !== true ||
      connection.contractVersion !== 1
    )
      throw new Error('The selected connection is unavailable')
    return connection.id
  }

  // The bound module factory always constructs the same concrete adapter, whose
  // capability is immutable. Reading it must not allocate a runtime or authenticate.
  let recoveryCapability: boolean | undefined
  function runtime(): AgentRuntime {
    recoveryCapability = undefined
    const inner = create()
    if (inner.provider !== provider) throw new Error('The selected provider is unavailable')
    recoveryCapability = inner.canRecreateMissingUnusedSession
    return inner
  }

  function attribution(id: string): (handle: SessionHandle) => SessionHandle {
    const wrapped = new WeakMap<SessionHandle, SessionHandle>()
    return (handle) => {
      const prior = wrapped.get(handle)
      if (prior) return prior
      let closing: Promise<void> | undefined
      const proxy = new Proxy(handle, {
        has(target, key) {
          return key === 'connectionId' || Reflect.has(target, key)
        },
        get(target, key) {
          if (key === 'connectionId') return id
          if (key === 'close')
            return () => (closing ??= Promise.resolve().then(() => target.close()))
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      wrapped.set(handle, proxy)
      return proxy
    }
  }

  async function checked(
    handle: SessionHandle,
    id: string,
    context: ProviderRuntimeContext,
    beganAt: number,
  ): Promise<SessionHandle> {
    try {
      assertCurrent(id, context, beganAt)
      return handle
    } catch (error) {
      const closing = Promise.resolve().then(() => handle.close())
      const refused = new RejectedSessionLaunch(error, handle, closing)
      await closing.catch(() => {})
      throw refused
    }
  }

  function assertCurrent(id: string, context: ProviderRuntimeContext, beganAt: number): void {
    if (admit(context) !== id || revision() !== beganAt)
      throw new Error('The selected connection changed during launch')
  }

  async function launchOwned<T extends StartOptions | ResumeOptions>(
    options: T,
    id: string,
    beganAt: number,
    launch: (scoped: T) => Promise<SessionHandle>,
  ): Promise<SessionHandle> {
    const wrap = attribution(id)
    let withheld: SessionHandle | undefined
    const scoped: T = options.onSessionCreated
      ? {
          ...options,
          onSessionCreated: (raw: SessionHandle) => {
            const handle = wrap(raw)
            withheld = handle
            try {
              assertCurrent(id, options, beganAt)
            } catch {
              return
            }
            // The caller owns forwarded allocations; preserve its original typed refusal.
            withheld = undefined
            options.onSessionCreated!(handle)
          },
        }
      : options
    let handle: SessionHandle
    try {
      handle = await launch(scoped)
    } catch (error) {
      if (withheld && !(error instanceof RejectedSessionLaunch)) {
        const closing = Promise.resolve().then(() => withheld!.close())
        const refused = new RejectedSessionLaunch(error, withheld, closing)
        await closing.catch(() => {})
        throw refused
      }
      throw error
    }
    return checked(wrap(handle), id, options, beganAt)
  }

  return {
    provider,
    get canRecreateMissingUnusedSession() {
      return recoveryCapability
    },
    async start(options) {
      const beganAt = revision()
      const id = admit(options)
      return launchOwned(options, id, beganAt, (scoped) => runtime().start(scoped))
    },
    async resume(ref, options) {
      options.signal?.throwIfAborted()
      if (ref.provider !== provider) throw new Error('The recorded provider does not match')
      const beganAt = revision()
      const id = admit(options)
      return launchOwned(options, id, beganAt, (scoped) => runtime().resume(ref, scoped))
    },
    async listModels(context) {
      const beganAt = revision()
      const id = admit(context)
      const models = await runtime().listModels(context)
      assertCurrent(id, context, beganAt)
      return models
    },
  }
}

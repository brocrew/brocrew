import type {
  AgentRuntime,
  ProviderRuntimeContext,
  ResumeOptions,
  SessionHandle,
} from '@brobot2/runtime'
import { compatibilityConnectionId, type Provider, type ProviderConnection } from '@brobot2/shared'

/** Bind each child to admitted metadata without changing its credential or state services. */
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

  function runtime(): AgentRuntime {
    const inner = create()
    if (inner.provider !== provider) throw new Error('The selected provider is unavailable')
    return inner
  }

  function attribution(id: string): (handle: SessionHandle) => SessionHandle {
    const wrapped = new WeakMap<SessionHandle, SessionHandle>()
    return (handle) => {
      const prior = wrapped.get(handle)
      if (prior) return prior
      const proxy = new Proxy(handle, {
        get(target, key) {
          if (key === 'connectionId') return id
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
      await handle.close()
      throw error
    }
  }

  function assertCurrent(id: string, context: ProviderRuntimeContext, beganAt: number): void {
    if (admit(context) !== id || revision() !== beganAt)
      throw new Error('The selected connection changed during launch')
  }

  return {
    provider,
    async start(options) {
      const beganAt = revision()
      const id = admit(options)
      return attribution(id)(await checked(await runtime().start(options), id, options, beganAt))
    },
    async resume(ref, options) {
      options.signal?.throwIfAborted()
      if (ref.provider !== provider) throw new Error('The recorded provider does not match')
      const beganAt = revision()
      const id = admit(options)
      const wrap = attribution(id)
      const scoped: ResumeOptions = options.onSessionCreated
        ? { ...options, onSessionCreated: (handle) => {
          // The delegate retains cleanup ownership until it returns. A changed binding is
          // checked and closed below rather than exposed through the early ownership callback.
          try {
            assertCurrent(id, options, beganAt)
          } catch {
            return
          }
          options.onSessionCreated!(wrap(handle))
        } }
        : options
      return wrap(await checked(await runtime().resume(ref, scoped), id, options, beganAt))
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

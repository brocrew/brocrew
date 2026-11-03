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

  return {
    provider,
    async start(options) {
      const id = admit(options)
      return attribution(id)(await runtime().start(options))
    },
    async resume(ref, options) {
      options.signal?.throwIfAborted()
      if (ref.provider !== provider) throw new Error('The recorded provider does not match')
      const id = admit(options)
      const wrap = attribution(id)
      const scoped: ResumeOptions = options.onSessionCreated
        ? { ...options, onSessionCreated: (handle) => options.onSessionCreated!(wrap(handle)) }
        : options
      return wrap(await runtime().resume(ref, scoped))
    },
    async listModels(context) {
      admit(context)
      return runtime().listModels(context)
    },
  }
}

import { McpError } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { reportPluginToolFailure } from './tool-diagnostics'
import type {
  GenericBrokerOptions,
  GenericPluginToolBroker,
  PluginToolCall,
} from './tool-broker-types'
export type * from './tool-broker-types'

export type PluginCallFailure =
  'disabled' | 'unavailable' | 'cancelled' | 'duplicate-request' | 'transport' | 'protocol'
export class PluginBrokerError extends Error {
  constructor(readonly code: PluginCallFailure) {
    super(`Plugin call failed: ${code}.`)
    this.name = 'PluginBrokerError'
  }
}

/** One running instance, shared by agent and app callbacks. The plugin owns tool semantics. */
export function createPluginToolBroker(options: GenericBrokerOptions): GenericPluginToolBroker {
  const binding = Object.freeze({ ...options.binding })
  let live = true
  const active = new Map<string, AbortController>()
  const key = (workspaceId: string, requestId: string | number) =>
    JSON.stringify([workspaceId, requestId])
  function current(workspaceId: string): void {
    if (!live) throw new PluginBrokerError('unavailable')
    let enabled: boolean
    try {
      enabled = options.isEnabled(workspaceId)
    } catch {
      throw new PluginBrokerError('unavailable')
    }
    if (!enabled) throw new PluginBrokerError('disabled')
  }
  function failure(error: unknown): never {
    if (error instanceof PluginBrokerError) throw error
    // Remote servers may use the same numeric codes as SDK-local close/timeout events.
    // McpError alone has no origin provenance, so retain every protocol payload.
    if (error instanceof McpError) {
      reportPluginToolFailure(options.diagnostic, 'downstream')
      throw error
    }
    reportPluginToolFailure(options.diagnostic, 'transport-call-failed')
    // No raw exception, arguments or result is retained in the diagnostic/error.
    throw new PluginBrokerError('transport')
  }
  return {
    binding,
    async listTools(workspaceId, signal) {
      current(workspaceId)
      const tools: Tool[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      try {
        do {
          if (signal?.aborted) throw new PluginBrokerError('cancelled')
          const page = signal
            ? await options.client.listTools(cursor === undefined ? undefined : { cursor }, {
                signal,
              })
            : await options.client.listTools(cursor === undefined ? undefined : { cursor })
          current(workspaceId)
          tools.push(...page.tools)
          cursor = page.nextCursor
          if (cursor !== undefined && cursors.has(cursor)) throw new PluginBrokerError('protocol')
          if (cursor !== undefined) cursors.add(cursor)
        } while (cursor !== undefined)
        return tools
      } catch (error) {
        if (signal?.aborted) throw new PluginBrokerError('cancelled')
        return failure(error)
      }
    },
    async callTool(input: PluginToolCall) {
      current(input.workspaceId)
      if (input.signal?.aborted) throw new PluginBrokerError('cancelled')
      const id = key(input.workspaceId, input.requestId)
      if (active.has(id)) throw new PluginBrokerError('duplicate-request')
      const controller = new AbortController()
      active.set(id, controller)
      const abort = () => controller.abort()
      input.signal?.addEventListener('abort', abort, { once: true })
      let onCancel!: () => void
      const cancelled = new Promise<never>((_, reject) => {
        onCancel = () => reject(new PluginBrokerError('cancelled'))
        controller.signal.addEventListener('abort', onCancel, { once: true })
      })
      try {
        const result = await Promise.race([
          options.client.callTool(
            {
              name: input.name,
              ...(input.arguments === undefined ? {} : { arguments: input.arguments }),
              _meta: {
                ...input.meta,
                workspaceId: input.workspaceId,
                requestId: input.requestId,
                origin: input.origin,
              },
            },
            undefined,
            { signal: controller.signal },
          ),
          cancelled,
        ])
        current(input.workspaceId)
        if (controller.signal.aborted) throw new PluginBrokerError('cancelled')
        // isError is a valid MCP tool result, not a failed transport or a retry request.
        return result as CallToolResult
      } catch (error) {
        return failure(error)
      } finally {
        controller.signal.removeEventListener('abort', onCancel)
        input.signal?.removeEventListener('abort', abort)
        if (active.get(id) === controller) active.delete(id)
      }
    },
    cancelTool(input) {
      const controller = active.get(key(input.workspaceId, input.requestId))
      controller?.abort()
      return { cancelled: controller !== undefined, completed: false }
    },
    invalidate() {
      live = false
      for (const controller of active.values()) controller.abort()
    },
  }
}

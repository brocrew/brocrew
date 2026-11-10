import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { AgentAttachmentView } from './contracts'
import { managedPluginFailure, type PluginFailureStage } from '@brobot2/runtime/plugin-failure'
import { reportPluginToolFailure, type PluginToolDiagnostic } from '../tool-diagnostics'

export async function admittedPluginTools(
  view: AgentAttachmentView,
  diagnostic?: PluginToolDiagnostic,
) {
  let stage: PluginFailureStage = 'binding-connection'
  const progress = (next: PluginFailureStage) => {
    stage = next
    try {
      diagnostic?.pending?.(stage)
    } catch {
      /* A stage observer cannot fail the binding. */
    }
  }
  const exited =
    view.exited?.then(
      () => {
        throw Object.assign(new Error('Plugin host exited'), { code: 'process-exited' })
      },
      () => new Promise<never>(() => {}),
    ) ?? new Promise<never>(() => {})
  try {
    progress('binding-connection')
    const connection = await Promise.race([view.connection, exited])
    stage = 'binding-current'
    if (!view.current()) throw new Error('unavailable')
    stage = 'binding-endpoint'
    const endpoint = connection.mcp()
    const credential = endpoint.headers.Authorization.slice('Bearer '.length)
    const client = new Client({ name: 'brocrew-plugin-inventory', version: '1' })
    client.onerror = () => undefined
    const outcome = await (async () => {
      progress('binding-connect')
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint.url), {
          requestInit: { headers: endpoint.headers, redirect: 'error' },
        }),
      )
      progress('binding-inventory')
      const signal = AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MSEC)
      const admitted: Tool[] = []
      let cursor: string | undefined
      do {
        const inventory = await client.listTools({ cursor }, { signal })
        admitted.push(...inventory.tools)
        cursor = inventory.nextCursor
      } while (cursor !== undefined)
      stage = 'binding-current'
      if (!view.current()) throw new Error('unavailable')
      return { connection, endpoint, credential, admitted }
    })().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error: managedPluginFailure(error, stage) }),
    )
    try {
      await client.close()
    } catch {
      reportPluginToolFailure(diagnostic, 'transport-close-failed')
    }
    if (!outcome.ok) throw outcome.error
    return outcome.value
  } catch (error) {
    throw managedPluginFailure(error, stage)
  }
}

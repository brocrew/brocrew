import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { PluginLifecycleController } from './controller'
import { managedPluginFailure, type PluginFailureStage } from '@brobot2/runtime/plugin-failure'
import { inventoryFetch } from './inventory-fetch'
import type { PluginToolDiagnostic } from '../tool-diagnostics'

export async function admittedPluginTools(
  view: ReturnType<PluginLifecycleController['agentAttachments']>[number],
  names: ReadonlySet<string>,
  refused: () => void | Promise<void>,
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
  const host = new AbortController()
  let fail!: (error: unknown) => void
  const failed = new Promise<never>((_, reject) => {
    fail = (error) => {
      if (host.signal.aborted) return
      host.abort(error)
      reject(error)
    }
  })
  void view.exited?.then(
    () => {
      const error = Object.assign(new Error('Plugin host exited'), { code: 'process-exited' })
      fail(error)
    },
    () => undefined,
  )
  try {
    progress('binding-connection')
    const connection = await Promise.race([view.connection, failed])
    stage = 'binding-current'
    if (!view.current()) throw new Error('unavailable')
    stage = 'binding-endpoint'
    const endpoint = connection.mcp()
    const credential = endpoint.headers.Authorization.slice('Bearer '.length)
    const client = new Client({ name: 'brocrew-plugin-inventory', version: '1' })
    client.onerror = () => undefined
    const outcome = await Promise.race([(async () => {
      progress('binding-connect')
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint.url), {
          requestInit: { headers: endpoint.headers, redirect: 'error' },
          fetch: inventoryFetch(host.signal, fail),
        }),
      )
      progress('binding-inventory')
      // Keep the SDK's documented default: 1.29 has no public timeout-disable option and
      // Chrome's static tools/list emits no MCP progress. HTTP bytes have their own idle rule.
      const inventory = await client.listTools()
      stage = 'binding-current'
      if (inventory.nextCursor || inventory.tools.length > 256 || !view.current())
        throw new Error('unavailable')
      const admitted = inventory.tools.filter((tool) => names.has(tool.name))
      if (admitted.length !== inventory.tools.length) await refused()
      return { connection, endpoint, credential, admitted }
    })(), failed]).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error: managedPluginFailure(error, stage) }),
    )
    try {
      await client.close()
    } catch (error) {
      // Keep the first failing seam if teardown also fails; neither path admits a binding.
      if (outcome.ok) throw managedPluginFailure(error, 'binding-close')
    }
    if (!outcome.ok) throw outcome.error
    return outcome.value
  } catch (error) {
    throw managedPluginFailure(error, stage)
  } finally {
    host.abort()
  }
}

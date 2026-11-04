import type { PluginLifecycleController } from './controller'
import { PluginBrokerError, type PluginMcpClient } from '../tool-broker'

type View = ReturnType<PluginLifecycleController['agentAttachments']>[number]

/** The process runner owns connection lifetime. Inventory/calls reuse that same MCP client. */
export async function pluginMcpClient(view: View): Promise<PluginMcpClient> {
  try {
    const connection = await view.connection
    if (!view.current()) throw new PluginBrokerError('unavailable')
    const client = (connection as typeof connection & { client: PluginMcpClient }).client
    if (!client) throw new PluginBrokerError('unavailable')
    return client
  } catch (error) {
    if (error instanceof PluginBrokerError) throw error
    throw new PluginBrokerError('transport')
  }
}

/** Compatibility for the old package adapters until their package migration removes them. */
export async function admittedPluginTools(
  view: View,
  _names: ReadonlySet<string>,
  _refused: () => void | Promise<void>,
) {
  void _names
  void _refused
  const connection = await view.connection
  const client = await pluginMcpClient(view)
  const admitted = [] as Awaited<ReturnType<PluginMcpClient['listTools']>>['tools']
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const page = await client.listTools(cursor === undefined ? undefined : { cursor })
    if (!view.current()) throw new Error('Plugin instance is unavailable.')
    admitted.push(...page.tools)
    cursor = page.nextCursor
    if (cursor !== undefined && seen.has(cursor)) throw new Error('Invalid MCP inventory cursor.')
    if (cursor !== undefined) seen.add(cursor)
  } while (cursor !== undefined)
  const endpoint = connection.mcp()
  return {
    connection,
    endpoint,
    admitted,
    credential: endpoint.headers.Authorization.slice('Bearer '.length),
    adminCredential: connection.admin().headers.Authorization.slice('Bearer '.length),
  }
}

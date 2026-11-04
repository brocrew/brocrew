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

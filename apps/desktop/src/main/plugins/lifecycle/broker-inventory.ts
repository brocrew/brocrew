import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { PluginLifecycleController } from './controller'

/**
 * The plugin's tools that a binding may offer: only reviewed names, and none whose definition carries
 * either of the plugin's credentials. Anything else is refused without hiding the reviewed tools.
 */
export async function admittedPluginTools(
  view: ReturnType<PluginLifecycleController['agentAttachments']>[number],
  names: ReadonlySet<string>,
  refused: () => void | Promise<void>,
) {
  const connection = await view.connection
  if (!view.current()) throw new Error('unavailable')
  const endpoint = connection.mcp()
  const credential = endpoint.headers.Authorization.slice('Bearer '.length)
  const adminCredential = connection.admin().headers.Authorization.slice('Bearer '.length)
  const client = new Client({ name: 'brocrew-plugin-inventory', version: '1' })
  client.onerror = () => undefined
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint.url), {
        requestInit: { headers: endpoint.headers, redirect: 'error' },
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            redirect: 'error',
            signal: AbortSignal.timeout(1500),
          }),
      }),
    )
    const inventory = await client.listTools(undefined, { timeout: 1500 })
    if (inventory.nextCursor || inventory.tools.length > 256 || !view.current())
      throw new Error('unavailable')
    const admitted = inventory.tools.filter(
      (tool) =>
        names.has(tool.name) &&
        ![credential, adminCredential].some((one) => JSON.stringify(tool).includes(one)),
    )
    if (admitted.length !== inventory.tools.length) await refused()
    return { connection, endpoint, credential, adminCredential, admitted }
  } finally {
    await client.close()
  }
}

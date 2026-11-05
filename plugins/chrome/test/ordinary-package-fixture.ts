import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** Fictional host input. Tests still pass through the actual bootstrap parser. */
export function bootstrapEnv(dataDirectory: string, extra: Record<string, unknown> = {}) {
  return {
    BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify({
      api: 1,
      pluginId: 'chrome',
      dataDirectory,
      dataSchema: 1,
      ...extra,
    }),
  }
}
export function withBootstrap<T extends { BROCREW_PLUGIN_BOOTSTRAP: string }>(
  env: T,
  patch: Record<string, unknown>,
): T {
  return {
    ...env,
    BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify({
      ...JSON.parse(env.BROCREW_PLUGIN_BOOTSTRAP),
      ...patch,
    }),
  }
}
export const personMetadata = {
  origin: 'settings.page',
  workspaceId: 'fictional-workspace',
  requestId: 'fictional-request',
}
export async function connectPackage(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'fictional-ordinary-package', version: '1' })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    return client
  } catch (error) {
    await client.close()
    throw error
  }
}
export function resultText(result: Pick<CallToolResult, 'content'>): string {
  return result.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
}
export function resultJson(result: Pick<CallToolResult, 'content'>) {
  return JSON.parse(resultText(result))
}

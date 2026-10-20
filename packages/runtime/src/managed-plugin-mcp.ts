import type { JsonValue } from './codex/protocol/serde_json/JsonValue'

/** A per-launch broker capability, never the plugin server's credential. */
export interface ManagedPluginMcpServer {
  readonly name: string
  readonly url: string
  readonly capability: string
}
export function managedPluginHttpServers(servers: readonly ManagedPluginMcpServer[] = []) {
  const result: Record<string, { type: 'http'; url: string; headers: Record<string, string> }> = {}
  for (const server of servers) {
    let url: URL
    try {
      url = new URL(server.url)
    } catch {
      throw new Error('Plugin unavailable. Try again.')
    }
    if (
      !/^plugin-[a-z0-9-]{1,57}$/.test(server.name) ||
      Object.hasOwn(result, server.name) ||
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/mcp' ||
      !/^[a-f0-9]{64}$/.test(server.capability)
    )
      throw new Error('Plugin unavailable. Try again.')
    result[server.name] = {
      type: 'http',
      url: url.href,
      headers: { Authorization: `Bearer ${server.capability}` },
    }
  }
  return result
}
export function withManagedPluginMcp(
  config: { [key: string]: JsonValue | undefined },
  servers: readonly ManagedPluginMcpServer[] = [],
): { [key: string]: JsonValue | undefined } {
  const managed = managedPluginHttpServers(servers)
  if (Object.keys(managed).length === 0) return config
  const existing = config.mcp_servers ?? {}
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing))
    throw new Error('Plugin unavailable. Try again.')
  const merged = { ...existing }
  for (const [name, value] of Object.entries(managed)) {
    if (Object.keys(merged).some((key) => key.toLowerCase() === name.toLowerCase()))
      throw new Error('Plugin unavailable. Try again.')
    merged[name] = { url: value.url, http_headers: value.headers }
  }
  return { ...config, mcp_servers: merged }
}

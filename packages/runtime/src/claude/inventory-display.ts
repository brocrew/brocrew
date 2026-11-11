import type { ToolInventoryEvent } from '../events'
import type { PublishedServer } from '../tool-inventory'

const CONNECTION_KINDS: Readonly<Record<string, string>> = {
  connected: 'ready',
  failed: 'failed',
  'needs-auth': 'sign-in',
  pending: 'connecting',
  disabled: 'disabled',
}

export function publishedServerForDisplay(server: PublishedServer): PublishedServer {
  if (server.connectionKind !== undefined) return server
  const connectionKind = Object.hasOwn(CONNECTION_KINDS, server.status)
    ? CONNECTION_KINDS[server.status]
    : undefined
  return connectionKind === undefined ? server : { ...server, connectionKind }
}

/** Read older inventories without changing their recorded status words. */
export function toolInventoryForDisplay(event: ToolInventoryEvent): ToolInventoryEvent {
  const published = event.published
  if (published === null) return event
  const servers = published.servers.map(publishedServerForDisplay)
  return servers.every((server, at) => server === published.servers[at])
    ? event
    : { ...event, published: { ...published, servers } }
}

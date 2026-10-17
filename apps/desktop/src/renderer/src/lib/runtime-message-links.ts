import type { ResolvedMessageLink } from './message-links'

/** An absent bridge during an upgrade leaves the link readable and inert. */
export async function resolveMessageLink(target: string): Promise<ResolvedMessageLink> {
  const bridge = window.api.runtime
  if (!bridge.resolveLink) throw new Error('Link resolver unavailable')
  return bridge.resolveLink(target)
}

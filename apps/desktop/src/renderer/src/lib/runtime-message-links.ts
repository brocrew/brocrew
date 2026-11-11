import type { ClientSessionApi } from '../../../shared/client-session-api'
import type { ResolveMessageLink } from './message-links'

/** An absent capability leaves the link readable and inert. */
export function createMessageLinkResolver(
  sessions: Pick<ClientSessionApi, 'resolveLink'> | undefined,
): ResolveMessageLink {
  const resolve = sessions?.resolveLink?.bind(sessions)
  return async (target) => {
    if (!resolve) throw new Error('Link resolver unavailable')
    return resolve(target)
  }
}

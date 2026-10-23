import type { LinkResolution } from '../../../shared/runtime-ipc'

export type ResolvedMessageLink = LinkResolution

export type ResolveMessageLink = (target: string) => Promise<ResolvedMessageLink>
export const MESSAGE_LINK_ATTRIBUTE = 'data-brocrew-target'
export const LINK_UNAVAILABLE = 'Unavailable'
export const LINK_FAILED = "Couldn't open this link."

const LINK_DELETED: Record<ResolvedMessageLink['kind'], string> = {
  conversation: 'This conversation was deleted.',
  agent: 'This agent was deleted.',
  piece: 'This work no longer exists.',
}

/** Why a link whose answer cannot be opened failed; only a deleted target is certain, so the rest keep the plain sentence. */
export function linkFailureReason(answer: ResolvedMessageLink): string {
  return answer.state === 'deleted' ? LINK_DELETED[answer.kind] : LINK_FAILED
}

export function internalLinkStart(target: string, escape: (text: string) => string): string {
  const agent = /^brocrew:\/\/agent\//i.test(target)
  return (
    `<button type="button" role="link" class="message-link" data-cy="message-link" title="" ${MESSAGE_LINK_ATTRIBUTE}="${escape(target)}">` +
    `<svg class="icon message-link-indicator" role="img" aria-label="${agent ? 'Agent link' : 'Conversation link'}"><use href="#${agent ? 'i-user' : 'i-chat'}"></use></svg>`
  )
}

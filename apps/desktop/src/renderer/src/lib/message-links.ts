import type { LinkResolution } from '../../../shared/runtime-ipc'

export type ResolvedMessageLink = LinkResolution

export type ResolveMessageLink = (target: string) => Promise<ResolvedMessageLink>
export const MESSAGE_LINK_ATTRIBUTE = 'data-brocrew-target'
export const LINK_UNAVAILABLE = 'Unavailable'
export const LINK_FAILED = "Couldn't open this link."

export function internalLinkStart(target: string, escape: (text: string) => string): string {
  const agent = /^brocrew:\/\/agent\//i.test(target)
  return (
    `<button type="button" role="link" class="message-link" data-cy="message-link" title="" ${MESSAGE_LINK_ATTRIBUTE}="${escape(target)}">` +
    `<svg class="icon message-link-indicator" role="img" aria-label="${agent ? 'Agent link' : 'Conversation link'}"><use href="#${agent ? 'i-user' : 'i-chat'}"></use></svg>`
  )
}

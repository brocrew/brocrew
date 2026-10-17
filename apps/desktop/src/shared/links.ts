export const LINK_TITLE_CHARS = 120
export const NAVIGATION_LINKS_DESCRIPTION =
  'Use the returned navigation links; clicking them does not move work.'

export function linkTargetId(id: string): string {
  return encodeURIComponent(id).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

function escapeLabel(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/\)/g, '\\)')
}

function linkTitle(title: string): string {
  return escapeLabel(Array.from(title).slice(0, LINK_TITLE_CHARS).join(''))
}

export function conversationLink(sessionId: string, title: string): string {
  return `[${linkTitle(title)}](brocrew://conversation/${linkTargetId(sessionId)})`
}

export function agentLink(identityId: string, name: string): string {
  return `[${linkTitle(name)}](brocrew://agent/${linkTargetId(identityId)})`
}

export function pieceLink(pieceId: string, label: string, title: string): string {
  return `[${escapeLabel(label)} · ${linkTitle(title)}](brocrew://piece/${linkTargetId(pieceId)})`
}

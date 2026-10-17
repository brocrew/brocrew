export type LinkKind = 'conversation' | 'agent' | 'piece'

export interface LinkResolution {
  readonly state: 'available' | 'archived' | 'deleted' | 'unavailable'
  readonly kind: LinkKind
  readonly title: string | null
  readonly status: string | null
  readonly opens: { readonly sessionId: string } | { readonly identityId: string } | null
}

export type LinkTarget =
  | { readonly kind: LinkKind; readonly id: string }
  | { readonly kind: 'piece'; readonly label: string }

export const LINK_TARGET_LIMIT = 4096

export function linkKindOf(target: string): LinkKind {
  const scheme = /^brocrew:\/\/(conversation|agent|piece)\//.exec(target)
  return scheme === null ? 'conversation' : (scheme[1] as LinkKind)
}

export function parseLinkTarget(target: string): LinkTarget | null {
  if (target.length === 0 || target.length > LINK_TARGET_LIMIT) return null
  if (/^W[1-9]\d*(?:\.[1-9]\d*)*$/.test(target)) return { kind: 'piece', label: target }
  const match = /^brocrew:\/\/(conversation|agent|piece)\/([^/?#]+)$/.exec(target)
  if (match === null) return null
  try {
    const id = decodeURIComponent(match[2]!)
    if (id.length === 0 || id.length > 512 || id.includes('/') || id.includes('\\')) return null
    for (let at = 0; at < id.length; at++) {
      const point = id.charCodeAt(at)
      if (point < 32 || point === 127) return null
    }
    return { kind: match[1] as LinkKind, id }
  } catch {
    return null
  }
}

export function unavailableLink(kind: LinkKind = 'conversation'): LinkResolution {
  return { state: 'unavailable', kind, title: null, status: null, opens: null }
}

export function deletedLink(kind: LinkKind): LinkResolution {
  return { state: 'deleted', kind, title: null, status: null, opens: null }
}

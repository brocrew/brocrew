import {
  agentName,
  DEFAULT_PROFILE_ID,
  foldProfileName,
  type AgentIdentityName,
} from '../../../shared/runtime-ipc'

/**
 * {@link agentName} for every name one view draws, with the roster read once for the view rather
 * than searched once per name. Built from the roster as it is now, so a later roster is read
 * again by the next view.
 */
export function namingFrom(
  identities: readonly AgentIdentityName[] | null,
): (profileId: string | null) => string {
  const names = new Map<string, string>()
  for (const identity of identities ?? []) {
    const slug = identity.slug
    if (!names.has(slug)) names.set(slug, agentName(slug, [identity]))
  }
  return (profileId) => {
    const slug = foldProfileName(profileId ?? DEFAULT_PROFILE_ID)
    return names.get(slug) ?? agentName(slug, null)
  }
}

import { foldProfileName } from '../../shared/runtime-ipc'
import type { IdentityCreator } from '../../shared/runtime-ipc'

/** The separator. Not in `PATH_SEGMENT_PATTERN`, which is what makes the ids unambiguous. */
const SEP = ':'

export const ROOTS_SCOPE = 'roots'

export function agentIdentityRowId(profileSlug: string): string {
  return `aid${SEP}${foldProfileName(profileSlug)}`
}

export function identityCreatorColumn(creator: IdentityCreator): string {
  return creator.by === 'an-agent' ? agentIdentityRowId(creator.agent) : creator.by
}

export function readIdentityCreator(raw: string | null): IdentityCreator | null {
  if (raw === null) return null
  if (raw === 'a-person' || raw === 'this-app') return { by: raw }
  const prefix = `aid${SEP}`
  if (!raw.startsWith(prefix)) return null
  const agent = raw.slice(prefix.length)
  return agent === '' ? null : { by: 'an-agent', agent }
}

export function ownInstructionsRowId(profileSlug: string, version: number): string {
  return `ins${SEP}${foldProfileName(profileSlug)}${SEP}${String(version)}`
}

/** One immutable version of the profile's own notes, named by its natural key. */
export function ownNotesRowId(profileSlug: string, version: number): string {
  return `notes${SEP}${foldProfileName(profileSlug)}${SEP}${String(version)}`
}

export { foldProfileName }

export function memoryAmendmentRowId(profileSlug: string, seq: number): string {
  return `mem${SEP}${foldProfileName(profileSlug)}${SEP}${String(seq)}`
}

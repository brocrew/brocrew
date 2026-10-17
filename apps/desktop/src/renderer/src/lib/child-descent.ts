import type { LibraryChild } from '../../../shared/runtime-ipc'

/**
 * **How a child row names itself** (111), in one wording used by every surface that can show one.
 *
 * Use the provider's nickname and role when recorded, otherwise say sub-agent. Provider records can establish childhood without a parent id or nickname; do not invent those missing details.
 *
 * ⚑ **It moved out of `SessionLibrary.vue` in 118**, when the reopen list became the second surface
 * that has to say this. Two copies would be two answers to one question, and the one that drifted
 * would be whichever got edited second — the same reason {@link describeDerived} is shared between
 * the library row and the reading pane.
 */
export function childLabel(child: LibraryChild): string {
  if (child.nickname && child.role) return `sub-agent · ${child.nickname} (${child.role})`
  if (child.nickname) return `sub-agent · ${child.nickname}`
  return 'sub-agent'
}

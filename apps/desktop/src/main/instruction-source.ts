import { basename } from 'node:path'
import { readTextFile, realPathOf } from './read-text-file'

/**
 * Read an instruction file on request from the session's provider-reported list. The list contains
 * paths, not file contents, so this reads the file now rather than reproducing the provider's read.
 * The renderer names a row index; the caller supplies the corresponding provider list.
 * Any readable text file can open, regardless of its name or extension. {@link readTextFile}
 * handles file kind, binary content and reported truncation.
 */

/**
 * Limit an on-demand instruction read; truncation reports the original byte count so the viewer
 * can disclose that it is showing only part of the file.
 */
export const MAX_INSTRUCTION_BYTES = 512 * 1024

/** What one instruction file reads as, or why it did not. */
export type InstructionSourceResult =
  | { ok: true; path: string; name: string; text: string; truncated: boolean; bytes: number }
  | { ok: false; reason: 'no-source' | 'gone' | 'not-readable' | 'unreadable' }

/**
 * Read the `index`th file of the list this session's provider reported, or say why not.
 *
 * The caller supplies the provider's list; filesystem reads do not depend on Electron or a session.
 */
export function readInstructionSource(
  /** Paths reported by this conversation's provider, in display order. */
  reported: readonly string[],
  index: number,
): InstructionSourceResult {
  // Missing array entries and empty paths both name no source.
  const path = reported[index]
  if (typeof path !== 'string' || path === '') return { ok: false, reason: 'no-source' }

  // Follow symlinks when reading the file.
  const resolved = realPathOf(path)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  const read = readTextFile(resolved.path, MAX_INSTRUCTION_BYTES)
  if (typeof read === 'string') return { ok: false, reason: read }
  // Keep the provider's spelling so the viewer's path matches the selected row, including symlinks.
  return { ok: true, path, name: basename(path), ...read }
}

import { statSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/**
 * Whether two paths are one folder — the questions a data folder is compared by (`launch-
 * presentation.ts`'s window title, `workspaces.ts`'s list). ⚑ Kept apart from both, with nothing
 * but `node:` imports, so a module that only compares folders loads nothing else.
 */

/** `path` resolved, and case-blind where the system's disks usually are (macOS, Windows). */
function folded(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' || platform === 'darwin' ? resolve(path).toLowerCase() : resolve(path)
}

/** Whether `a` and `b` name one folder by their spelling alone ({@link folded}). ⚑ Touches no disk. */
export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return folded(a, platform) === folded(b, platform)
}

/** Whether `path` is inside `folder` by their spelling alone ({@link folded}). ⚑ Touches no disk. */
export function insideBySpelling(
  path: string,
  folder: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const outer = folded(folder, platform)
  return folded(path, platform).startsWith(outer.endsWith(sep) ? outer : `${outer}${sep}`)
}

/**
 * Whether `a` and `b` are one folder: by identity (device and 64-bit file id), so a symlink, a
 * different case on a case-blind disk or a resolved spelling is the same folder; by their spelling
 * ({@link samePath}) when either is not there, or a disk reports no file id.
 *
 * ⚠️ `bigint`: an NTFS file id is 64 bits, and a JavaScript number keeps 53 — two folders on one
 * drive could read as one.
 */
export function sameFolder(a: string, b: string): boolean {
  const identity = (path: string): string | null => {
    try {
      const seen = statSync(path, { bigint: true })
      return seen.ino === 0n ? null : `${String(seen.dev)}:${String(seen.ino)}`
    } catch {
      return null
    }
  }
  const one = identity(a)
  const two = identity(b)
  if (one !== null && two !== null) return one === two
  return samePath(a, b)
}

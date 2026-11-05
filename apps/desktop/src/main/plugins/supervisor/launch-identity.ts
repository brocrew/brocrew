import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/** Pending-launch key only; preserve native case without changing storage/routing identity. */
export function launchRootKey(selectedRoot: string): string {
  const path = resolve(selectedRoot)
  try {
    return JSON.stringify(['existing', realpathSync.native(path)])
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    // A root removed after storage mkdir is not a proven alias. Recompute on the next selection.
    return JSON.stringify(['missing', path])
  }
}

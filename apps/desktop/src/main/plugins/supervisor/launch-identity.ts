import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/** Baseline selection, equivalent to the existing storage rootIdentity used by launch. */
export function launchRootKey(selectedRoot: string): string {
  let path = resolve(selectedRoot)
  try {
    path = realpathSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
  }
  return process.platform === 'win32' ? path.toLowerCase() : path
}

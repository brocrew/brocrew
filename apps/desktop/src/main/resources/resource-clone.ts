import { execFileSync } from 'node:child_process'
import {
  constants,
  copyFileSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statfsSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

export function prepareResourceClone(
  source: string,
  temporary: string,
  size: number,
  matches: (path: string) => boolean,
): boolean {
  const folder = dirname(temporary)
  let staging: string | undefined
  try {
    // macOS cp falls back to a full copy on other volume types.
    if (process.platform === 'darwin' && statfsSync(folder).type !== statfsSync('/').type)
      return false
    staging = mkdtempSync(join(folder, '.clone-'))
    const pinned = join(staging, 'source')
    const cloned = join(staging, 'copy')
    // A private temporary name keeps a path replacement from putting a FIFO in the clone call.
    linkSync(source, pinned)
    const stat = lstatSync(pinned)
    if (!stat.isFile() || stat.size !== size) return false
    if (process.platform === 'darwin') {
      execFileSync('/bin/cp', ['-c', pinned, cloned], { stdio: 'ignore' })
    } else {
      copyFileSync(pinned, cloned, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE)
    }
    if (!matches(cloned)) return false
    renameSync(cloned, temporary)
    return true
  } catch {
    return false
  } finally {
    if (staging !== undefined) rmSync(staging, { recursive: true, force: true })
  }
}

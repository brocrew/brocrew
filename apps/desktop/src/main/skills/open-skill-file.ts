import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { assertSkillPathsAreReal } from './skill-paths'
import {
  nodeFs,
  recoveryStats,
  type RecoveryFs,
  type RecoveryFileHandle,
  type RecoveryStats,
} from '../recovery/files'

const sameFile = (a: RecoveryStats, b: RecoveryStats) =>
  b.isFile() &&
  !b.isSymbolicLink() &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs

const rejectedStats = (stats: RecoveryStats | undefined) =>
  stats && {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    file: stats.isFile(),
    symbolicLink: stats.isSymbolicLink(),
  }

/** Preserve write access at the OS boundary; refuse links and changed identities before use. */
export async function openWritableSkillFile(
  userData: string,
  path: string,
  fs: RecoveryFs,
  osOpen: typeof open = open,
): Promise<RecoveryFileHandle> {
  await assertSkillPathsAreReal(userData, [path], fs)
  const before = await fs.lstat(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Skills could not be read.')
  const nativeFile =
    fs === nodeFs
      ? await osOpen(
          path,
          constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
        )
      : null
  const file = nativeFile ?? (await fs.open(path, 'r+', undefined, false))
  try {
    await assertSkillPathsAreReal(userData, [path], fs)
    const bound = nativeFile
      ? recoveryStats(await nativeFile.stat({ bigint: true }))
      : await file.stat?.()
    const after = bound && sameFile(before, bound) ? await fs.lstat(path) : undefined
    if (!after || !sameFile(before, after)) {
      console.error('[skills] rejected writable file stats', {
        before: rejectedStats(before),
        bound: rejectedStats(bound),
        after: rejectedStats(after),
      })
      throw new Error('Skills could not be read.')
    }
    return file
  } catch (error) {
    await file.close()
    throw error
  }
}

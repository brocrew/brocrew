import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { assertSkillPathsAreReal } from './skill-paths'
import {
  nodeFs,
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
  const file =
    fs === nodeFs
      ? await osOpen(
          path,
          constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
        )
      : await fs.open(path, 'r+', undefined, false)
  try {
    await assertSkillPathsAreReal(userData, [path], fs)
    const bound = await file.stat?.()
    if (!bound || !sameFile(before, bound) || !sameFile(before, await fs.lstat(path)))
      throw new Error('Skills could not be read.')
    return file
  } catch (error) {
    await file.close()
    throw error
  }
}

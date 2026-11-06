import { openWritableSkillFile } from './open-skill-file'
import { dirname, join, resolve } from 'node:path'
import { assertSkillPathsAreReal } from './skill-paths'
import { errorCode, type RecoveryFs } from '../recovery/files'
import { ordinarySkillTree } from './ordinary-tree'

/** Flush files, their directories and the containing names up to the owned data folder. */
export async function flushSkillTree(
  root: string,
  fs: RecoveryFs,
  platform: NodeJS.Platform,
  userData: string,
): Promise<boolean> {
  await assertSkillPathsAreReal(userData, [root], fs)
  const tree = await ordinarySkillTree(root, fs)
  for (const entry of tree.entries.filter((one) => !one.directory)) {
    const path = join(root, ...entry.path.split('/'))
    const file =
      platform === 'win32'
        ? await openWritableSkillFile(userData, path, fs)
        : await fs.open(path, 'r')
    try {
      if (!(await file.stat?.())?.isFile()) throw new Error(`${path}: not a regular skill file`)
      await file.sync()
    } finally {
      await file.close()
    }
  }
  let directoriesFlushed = true
  const directories = tree.entries
    .filter((one) => one.directory)
    .reverse()
    .map((one) => join(root, ...one.path.split('/')))
  const parents: string[] = []
  let parent = dirname(resolve(root))
  while (true) {
    parents.push(parent)
    if (parent === resolve(userData)) break
    parent = dirname(parent)
  }
  for (const path of [...directories, root, ...parents]) {
    let directory
    try {
      directory = await fs.open(path, 'r')
      await directory.sync()
    } catch (error) {
      if (
        platform !== 'win32' ||
        !['EACCES', 'EPERM', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EBADF'].includes(
          errorCode(error) ?? '',
        )
      )
        throw error
      directoriesFlushed = false
    } finally {
      await directory?.close()
    }
  }
  return directoriesFlushed
}

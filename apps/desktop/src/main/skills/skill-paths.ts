import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { errorCode, nodeFs, type RecoveryFs } from '../recovery/files'

/** Existing ancestors of a skill path are real directories inside this data folder. */
export async function assertSkillPathsAreReal(
  userData: string,
  paths: readonly string[],
  fs: RecoveryFs = nodeFs,
): Promise<void> {
  const root = resolve(userData)
  const top = await fs.lstat(root)
  if (top.isSymbolicLink() || !top.isDirectory()) throw new Error('Skills could not be read.')
  for (const path of paths) {
    const inside = relative(root, resolve(path))
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new Error('Skills could not be read.')
    const parts = inside.split(sep)
    let at = root
    for (const [index, part] of parts.entries()) {
      at = join(at, part)
      try {
        const stat = await fs.lstat(at)
        if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()))
          throw new Error('Skills could not be read.')
      } catch (error) {
        if (errorCode(error) === 'ENOENT') break
        throw error
      }
    }
  }
}

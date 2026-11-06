import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { errorCode, nodeFs, type RecoveryFs } from '../recovery/files'

/** Ordinary path containment for app-managed skill mutations; links are followed. */
export async function assertSkillPathsAreReal(
  userData: string,
  paths: readonly string[],
  fs: RecoveryFs = nodeFs,
): Promise<void> {
  const root = resolve(userData)
  const top = await fs.stat(root)
  if (!top.isDirectory()) throw new Error(`${root}: not a directory`)
  for (const path of paths) {
    const inside = relative(root, resolve(path))
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      throw new Error(`${path}: outside the managed skill folder`)
    const parts = inside.split(sep)
    let at = root
    for (const [index, part] of parts.entries()) {
      at = join(at, part)
      try {
        const stat = await fs.stat(at)
        if (index < parts.length - 1 && !stat.isDirectory())
          throw new Error(`${at}: not a directory`)
      } catch (error) {
        if (errorCode(error) === 'ENOENT') break
        throw error
      }
    }
  }
}

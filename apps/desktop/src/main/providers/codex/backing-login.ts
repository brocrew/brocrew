import { lstatSync, type Stats } from 'node:fs'

/** The computer's copy source, never a key-written managed home; metadata only, without following links. */
export function machineLoginPresence(
  path: string,
  inspect: (path: string) => Pick<Stats, 'isFile' | 'isSymbolicLink'> = lstatSync,
): boolean | undefined {
  try {
    const file = inspect(path)
    return !file.isSymbolicLink() && file.isFile()
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    return code === 'ENOENT' || code === 'ENOTDIR' ? false : undefined
  }
}

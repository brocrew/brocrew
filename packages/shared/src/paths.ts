import { posix, win32 } from 'node:path'
import process from 'node:process'

/** Compare path spellings; macOS and Windows ignore case. No filesystem access. */
export function isInside(
  root: string,
  path: string,
  { orSame = true, platform = process.platform }: { orSame?: boolean; platform?: string } = {},
): boolean {
  const paths = platform === 'win32' ? win32 : posix
  const fold = (value: string): string =>
    platform === 'darwin' || platform === 'win32' ? value.toLowerCase() : value
  const part = paths.relative(fold(paths.resolve(root)), fold(paths.resolve(path)))
  return part === ''
    ? orSame
    : part !== '..' && !part.startsWith(`..${paths.sep}`) && !paths.isAbsolute(part)
}

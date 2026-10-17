import { posix, win32 } from 'node:path'
import { isTheSamePath } from '@brobot2/runtime'

/** Match a returned document without reading or resolving anything through the filesystem. */
export function returnedDocumentIndex(
  folder: string | null,
  returned: readonly string[],
  document: string,
  platform: NodeJS.Platform = process.platform,
): number {
  const path = platform === 'win32' ? win32 : posix
  const ambiguousDrive = (one: string): boolean =>
    platform === 'win32' &&
    /^[A-Za-z]:(?![\\/])/u.test(one) &&
    (folder === null ||
      path.parse(one).root.toLowerCase() !== path.parse(folder).root.slice(0, 2).toLowerCase())
  if (ambiguousDrive(document)) return -1
  const exact = returned.indexOf(document)
  if (exact >= 0 || folder === null) return exact
  const expected = path.resolve(folder, document)
  return returned.findIndex(
    (one) => !ambiguousDrive(one) && isTheSamePath(path.resolve(folder, one), expected, platform),
  )
}

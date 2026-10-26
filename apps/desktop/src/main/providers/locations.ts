import { lstatSync, realpathSync } from 'node:fs'
import { trustProviderHomeAncestry } from '@brobot2/runtime'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Provider } from '@brobot2/shared'
import { isPathSegment } from '../../shared/runtime-ipc'

/** A persisted managed address, portable across workspace moves; never a native-user path. */
function segments(location: string, provider: Provider): string[] {
  const parts = location.split('/')
  if (
    parts.length !== 3 ||
    parts[0] !== 'default' ||
    parts[2] !== provider ||
    !parts.every(isPathSegment) ||
    isAbsolute(location) ||
    location.includes('\\')
  ) {
    throw new Error('Invalid recorded provider location')
  }
  return parts
}

/** Resolve existing ancestors without creating a directory or opening its contents. */
function canonical(path: string): string {
  let current = resolve(path)
  const missing: string[] = []
  for (;;) {
    if (lstatSync(current, { throwIfNoEntry: false }) !== undefined) {
      return resolve(realpathSync.native(current), ...missing.reverse())
    }
    const parent = dirname(current)
    if (parent === current) throw new Error('Provider location has no existing ancestor')
    missing.push(basename(current))
    current = parent
  }
}

function inside(root: string, path: string): boolean {
  const rest = relative(root, path)
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest)
}

/** Validate shape and existing ancestry before a recorded path can reach any reader or preparer. */
export function resolveProviderLocation(
  root: string,
  location: string,
  provider: Provider,
): string {
  const parts = segments(location, provider)
  const path = join(resolve(root), ...parts)
  if (lstatSync(root, { throwIfNoEntry: false }) !== undefined) {
    let existing = root
    for (const part of parts) {
      const candidate = join(existing, part)
      const stat = lstatSync(candidate, { throwIfNoEntry: false })
      if (stat === undefined) break
      if (stat.isSymbolicLink())
        throw new Error('Recorded provider location passes through a symlink')
      if (!stat.isDirectory())
        throw new Error('Recorded provider location passes through a non-directory')
      existing = candidate
    }
    const ancestry = trustProviderHomeAncestry(root, existing, { includeLeaf: true })
    try {
      ancestry.verify()
    } finally {
      ancestry.release()
    }
  }
  if (!inside(canonical(root), canonical(path))) {
    throw new Error('Recorded provider location is outside its managed root')
  }
  return path
}

/** Record the actual prepared home, retaining spelling but excluding the movable workspace root. */
export function recordProviderLocation(root: string, home: string, provider: Provider): string {
  const location = relative(resolve(root), resolve(home)).split(sep).join('/')
  if (resolveProviderLocation(root, location, provider) !== resolve(home)) {
    throw new Error('Prepared provider folder does not match its recorded location')
  }
  return location
}

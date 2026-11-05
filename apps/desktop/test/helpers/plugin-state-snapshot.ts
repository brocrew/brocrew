import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Resolve fixture bytes without using the production selector or decoder. */
export function snapshotFiles(root: string): Array<{
  name: string
  path: string
  ordinal: string
  cursor: string
}> {
  const folder = join(root, 'snapshots')
  if (!existsSync(folder)) return []
  const files = readdirSync(folder).map((name) => {
    const match = /^(\d{16})-c(r|\d{16})\.json$/.exec(name)
    if (!match || match[0] !== name) throw new Error('Unexpected snapshot fixture entry: ' + name)
    return { name, path: join(folder, name), ordinal: match[1]!, cursor: match[2]! }
  })
  return files.sort((a, b) => a.ordinal.localeCompare(b.ordinal))
}

export function snapshotPath(root: string): string {
  return snapshotFiles(root).at(-1)?.path ?? join(root, 'installed-state.json')
}

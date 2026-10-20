import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

export const WORKSPACE_LIST_REFUSAL = "BroCrew couldn't read its list of workspaces."
const MAX_BYTES = 1024 * 1024
const OWNERS = 'packaged-workspace-owners'
const unavailable = (): never => {
  throw new Error(WORKSPACE_LIST_REFUSAL)
}

export function readRoutingFile(file: string): { text: string; value: unknown } | undefined {
  let fd: number | undefined
  try {
    const before = lstatSync(file)
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES) return unavailable()
    fd = openSync(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    )
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
      return unavailable()
    const bytes = Buffer.alloc(MAX_BYTES + 1)
    const length = readSync(fd, bytes, 0, bytes.length, 0)
    if (length > MAX_BYTES) return unavailable()
    const text = bytes.subarray(0, length).toString('utf8')
    return { text, value: JSON.parse(text) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return unavailable()
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function canonicalWorkspacePath(folder: string): string {
  let here = resolve(folder)
  const tail: string[] = []
  for (;;) {
    try {
      return join(realpathSync.native(here), ...tail.reverse())
    } catch {
      const parent = dirname(here)
      if (parent === here) return resolve(folder)
      tail.push(basename(here))
      here = parent
    }
  }
}

function ownerKey(folder: string): string {
  return createHash('sha256')
    .update(process.platform === 'win32' ? folder.toLowerCase() : folder)
    .digest('hex')
}
function ownersRoot(appData: string, create: boolean): string | undefined {
  const root = join(appData, '@brobot2', OWNERS)
  try {
    if (create) mkdirSync(root, { recursive: true, mode: 0o700 })
    const seen = lstatSync(root)
    if (!seen.isDirectory() || seen.isSymbolicLink()) return unavailable()
    return root
  } catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return unavailable()
  }
}
function ownerPath(file: string): string {
  const value = readRoutingFile(file)?.value as { version?: unknown; path?: unknown } | undefined
  if (
    value?.version !== 1 ||
    typeof value.path !== 'string' ||
    value.path.length > 4096 ||
    !isAbsolute(value.path) ||
    basename(file) !== `${ownerKey(value.path)}.json`
  )
    return unavailable()
  return value.path
}

/** Ownership entries are published once and are never replaced by recent-list writers. */
export function claimPackagedWorkspace(appData: string, folder: string): void {
  const root = ownersRoot(appData, true)!
  const path = canonicalWorkspacePath(folder)
  if (!isAbsolute(path) || path.length > 4096) return unavailable()
  const file = join(root, `${ownerKey(path)}.json`)
  if (readRoutingFile(file)) {
    if (ownerKey(ownerPath(file)) !== ownerKey(path)) return unavailable()
    return
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, path }), { flag: 'wx', mode: 0o600 })
    try {
      linkSync(temporary, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (ownerKey(ownerPath(file)) !== ownerKey(path)) return unavailable()
  } catch {
    return unavailable()
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function packagedWorkspaceOwners(appData: string): string[] {
  const root = ownersRoot(appData, false)
  if (!root) return []
  try {
    const names = readdirSync(root).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    if (names.length > 4096) return unavailable()
    return names.map((name) => ownerPath(join(root, name)))
  } catch {
    return unavailable()
  }
}

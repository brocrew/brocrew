import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import {
  isLocalDrivePath,
  isOwnerOnlyDirectory,
  isPrivateEntry,
  isWithinOrSame,
  realPath,
} from './private-files'
import { isSocketFile } from './local-endpoint'
import { refuse } from './supervisor/protocol'

const Slot = z.string().regex(/^[a-z][a-z0-9]{0,5}$/)
const Marker = z.strictObject({ format: z.literal(1), slot: Slot })
const Pins = z.strictObject({
  format: z.literal(1),
  selections: z
    .array(z.strictObject({ workspace: z.string().min(1).max(4096), slot: Slot }))
    .max(256),
})
const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
const identity = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)

/** Read only a bounded, unchanged regular file. Selection never creates or repairs configuration. */
function record(path: string, limit: number): unknown | undefined {
  let before
  try {
    before = lstatSync(path, { bigint: true })
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    !isPrivateEntry(before) ||
    before.size > BigInt(limit)
  )
    refuse()
  if (identity(realPath(dirname(path))) !== identity(dirname(path))) refuse()
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fstatSync(fd, { bigint: true })
    if (opened.dev !== before.dev || opened.ino !== before.ino) refuse()
    const bytes = Buffer.alloc(limit + 1)
    let size = 0
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null)
      if (!count) break
      size += count
    }
    const after = lstatSync(path, { bigint: true }),
      final = fstatSync(fd, { bigint: true })
    if (
      size > limit ||
      after.isSymbolicLink() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      final.size !== before.size ||
      final.mtimeNs !== before.mtimeNs ||
      final.ctimeNs !== before.ctimeNs ||
      after.size !== final.size ||
      after.mtimeNs !== final.mtimeNs ||
      after.ctimeNs !== final.ctimeNs
    )
      refuse()
    return JSON.parse(bytes.subarray(0, size).toString('utf8'))
  } finally {
    closeSync(fd)
  }
}

/** The effective workspace selects a root only with two matching, independently kept records. */
export function workspacePluginRoot(options: {
  appData: string
  workspaceRoot: string
  defaultRoot: string
}): string {
  try {
    if (!isAbsolute(options.workspaceRoot)) refuse()
    const workspace = realpathSync.native(options.workspaceRoot)
    if (!lstatSync(workspace).isDirectory()) refuse()
    const parent = join(realPath(options.appData), '@brobot2')
    const markerValue = record(join(workspace, 'plugin-root.json'), 1024)
    const pinValue = record(join(parent, 'plugin-root-pins.json'), 64 * 1024)
    const pins = pinValue === undefined ? { selections: [] } : Pins.parse(pinValue)
    const folders = new Set<string>(),
      slots = new Set<string>()
    for (const entry of pins.selections) {
      if (
        !isAbsolute(entry.workspace) ||
        !isLocalDrivePath(entry.workspace) ||
        resolve(entry.workspace) !== entry.workspace ||
        folders.has(identity(entry.workspace)) ||
        slots.has(entry.slot)
      )
        refuse()
      folders.add(identity(entry.workspace))
      slots.add(entry.slot)
    }
    const pin = pins.selections.find((entry) => identity(entry.workspace) === identity(workspace))
    if (markerValue === undefined && !pin) return options.defaultRoot
    const marker = Marker.parse(markerValue)
    if (!pin || pin.slot !== marker.slot) refuse()
    if (
      identity(realPath(parent)) !== identity(parent) ||
      !isPrivateEntry(lstatSync(parent), 0o022)
    )
      refuse()
    const root = join(parent, `plugins-${marker.slot}`)
    if (
      isWithinOrSame(workspace, root) ||
      pins.selections.some((entry) => isWithinOrSame(entry.workspace, root))
    )
      refuse()
    if (
      isSocketFile() &&
      [join(root, 'supervisor', 'owner.sock'), join(root, 'person-control', 'person.sock')].some(
        (path) => Buffer.byteLength(path) > 100,
      )
    )
      refuse()
    try {
      const stat = lstatSync(root)
      if (stat.isSymbolicLink() || !stat.isDirectory() || !isOwnerOnlyDirectory(stat)) refuse()
    } catch (error) {
      if (!missing(error)) throw error
    }
    return root
  } catch {
    refuse()
  }
}

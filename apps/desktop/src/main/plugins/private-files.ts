import {
  closeSync,
  constants,
  fstatSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
} from 'node:fs'
import { realpathSync, type BigIntStats, type Stats } from 'node:fs'
import { lstat, open, type FileHandle } from 'node:fs/promises'
import { dirname, isAbsolute, posix, win32 } from 'node:path'
import { windowsAccessLists, type OwnedAccessLists } from '../recovery/windows-privacy'

/**
 * The plugin host's private folders and files, on each platform.
 *
 * Ownership and mode are advisory on macOS and Linux. Own plugin folders are tightened best
 * effort to 0700; privacy failures warn once per entry and do not block plugins. Opens still
 * refuse a link with `O_NOFOLLOW`.
 *
 * A stat on Windows carries no owner and no real mode. There the plugin root's access list is
 * tightened best effort once per folder identity in a process ({@link keepPluginRootPrivate}).
 * Permission failures do not block plugins; entries inside an admitted root pass on their kind.
 * Opens look at the name again once open, since an open there follows a link; a directory is never fsynced, which Windows refuses (NTFS journals the
 * folder's own changes).
 */

type Platform = NodeJS.Platform
type AnyStats = Stats | BigIntStats

/** Permission diagnostics are bounded by physical identity, never used for admission. */
const warnedPermissions = new Set<string>()
export function warnPluginPermissions(stat: AnyStats): void {
  const identity = `${stat.dev}:${stat.ino}`
  if (warnedPermissions.has(identity)) return
  warnedPermissions.add(identity)
  console.warn('Could not tighten plugin folder permissions; continuing.')
}

/** Observes privacy without refusing a plugin because of its owner or mode. */
export function isPrivateEntry(
  stat: AnyStats,
  mask = 0o077,
  platform: Platform = process.platform,
): boolean {
  if (
    platform !== 'win32' &&
    (Number(stat.uid) !== process.getuid?.() || (Number(stat.mode) & mask) !== 0)
  )
    warnPluginPermissions(stat)
  return true
}

/** Tightens only a caller-identified own plugin folder, through its pinned descriptor. */
export function tightenPluginDirectory(path: string, platform: Platform = process.platform): void {
  if (platform === 'win32') return
  const fd = openDirectoryNotThroughALink(path, platform)
  try {
    try {
      fchmodSync(fd, 0o700)
    } catch {
      warnPluginPermissions(fstatSync(fd))
    }
    isPrivateEntry(fstatSync(fd), 0o077, platform)
  } finally {
    closeSync(fd)
  }
}

/**
 * The mode a file the host keeps unchanged is made with. On Windows it stays writable: Windows will
 * not rename a file over a read-only one, which the host's pointer and floor updates need, so there
 * such a file is held to its exact bytes alone.
 */
export function immutableMode(executable: boolean, platform: Platform = process.platform): number {
  if (platform === 'win32') return 0o600
  return executable ? 0o500 : 0o400
}

/** Whether `stat` is a file kept unchanged: mode 0400 or 0500; on Windows, any ({@link immutableMode}). */
export function isImmutableFile(stat: AnyStats, platform: Platform = process.platform): boolean {
  return platform === 'win32' || (Number(stat.mode) & 0o277) === 0
}

/** Observes the directory's privacy without making it an admission requirement. */
export function isOwnerOnlyDirectory(
  stat: AnyStats,
  platform: Platform = process.platform,
): boolean {
  if (
    platform !== 'win32' &&
    (Number(stat.uid) !== process.getuid?.() || (Number(stat.mode) & 0o7777) !== 0o700)
  )
    warnPluginPermissions(stat)
  return true
}

/** Makes a directory durable where the platform allows it; Windows refuses a directory fsync. */
export function syncDirectory(fd: number, platform: Platform = process.platform): void {
  if (platform !== 'win32') fsyncSync(fd)
}

/** Makes the directory at `path` durable where the platform allows it. */
export async function syncDirectoryAt(
  path: string,
  platform: Platform = process.platform,
): Promise<void> {
  if (platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Opens the directory at `path` to pin it, never through a link at its name. */
export function openDirectoryNotThroughALink(
  path: string,
  platform: Platform = process.platform,
): number {
  if (platform !== 'win32')
    return openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  const before = lstatSync(path, { bigint: true })
  if (!before.isDirectory() || before.isSymbolicLink()) throw linked(path)
  const fd = openSync(path, constants.O_RDONLY)
  const opened = fstatSync(fd, { bigint: true })
  const after = lstatSync(path, { bigint: true })
  if (
    opened.isDirectory() &&
    !after.isSymbolicLink() &&
    opened.dev === before.dev &&
    opened.ino === before.ino &&
    after.dev === before.dev &&
    after.ino === before.ino
  )
    return fd
  closeSync(fd)
  throw linked(path)
}

/** A directory held open, so that it can be told apart from one put in its place. */
export interface DirectoryPin {
  /** What the held directory is now, by its descriptor. */
  held(): BigIntStats
  sync(): void
  close(): void
}

/** Holds the directory at `path` open, never opened through a link at its name. */
export function pinDirectory(path: string, platform: Platform = process.platform): DirectoryPin {
  const fd = openDirectoryNotThroughALink(path, platform)
  return {
    held: () => fstatSync(fd, { bigint: true }),
    sync: () => syncDirectory(fd, platform),
    close: () => closeSync(fd),
  }
}

/**
 * Opens the file at `path` with `flags`, never through a link at its name: `O_NOFOLLOW` where there
 * is one; elsewhere (Windows) the name, looked at once the file is open, must be the file opened.
 */
export async function openFileNotThroughALink(path: string, flags: number): Promise<FileHandle> {
  const noFollow = constants.O_NOFOLLOW as number | undefined
  if (noFollow !== undefined) return open(path, flags | noFollow)
  const handle = await open(path, flags)
  const [opened, now] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(path, { bigint: true }).catch(() => null),
  ])
  if (now?.isFile() && !now.isSymbolicLink() && now.dev === opened.dev && now.ino === opened.ino)
    return handle
  await handle.close()
  throw linked(path)
}

/**
 * Makes `path` a new file and opens it to write, refusing anything already at its name, a link
 * included. Without `O_NOFOLLOW` (Windows) an exclusive create follows a link left at the name, so
 * the name must be empty first and, once open, be the only name of the file made.
 */
export async function createFileNotThroughALink(path: string, mode: number): Promise<FileHandle> {
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
  const noFollow = constants.O_NOFOLLOW as number | undefined
  if (noFollow !== undefined) return open(path, flags | noFollow, mode)
  if (
    await lstat(path).then(
      () => true,
      () => false,
    )
  )
    throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST', path })
  const handle = await open(path, flags, mode)
  const [opened, now] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(path, { bigint: true }).catch(() => null),
  ])
  if (now?.isFile() && opened.nlink === 1n && now.dev === opened.dev && now.ino === opened.ino)
    return handle
  await handle.close()
  throw linked(path)
}

function linked(path: string): Error {
  return Object.assign(new Error(`ELOOP: ${path} is not the directory looked at`), {
    code: 'ELOOP',
    path,
  })
}

/** Where `path` really is: on Windows by its long name, which the JS realpath leaves short (8.3). */
export function realPath(path: string, platform: Platform = process.platform): string {
  return platform === 'win32' ? realpathSync.native(path) : realpathSync(path)
}

/**
 * Whether `child` is `parent` or inside it, both already canonical. Windows compares without case
 * and by its own separator; a path on another drive is never inside.
 */
export function isWithinOrSame(
  parent: string,
  child: string,
  platform: Platform = process.platform,
): boolean {
  const paths = platform === 'win32' ? win32 : posix
  const below =
    platform === 'win32'
      ? win32.relative(parent.toLowerCase(), child.toLowerCase())
      : posix.relative(parent, child)
  return (
    below === '' ||
    (below !== '..' && !below.startsWith(`..${paths.sep}`) && !paths.isAbsolute(below))
  )
}

/** Whether `path` names a drive-letter path, not a share (`\\server\…`) or a device (`\\?\…`). */
export function isLocalDrivePath(path: string, platform: Platform = process.platform): boolean {
  return platform !== 'win32' || /^[A-Za-z]:\\/.test(path)
}

/** Structurally admitted plugin roots, by canonical path, with their folder identity. */
const checkedRoots = new Map<string, { dev: bigint; ino: bigint }>()
const rootTightenings = new Map<string, Promise<void>>()

/**
 * On Windows, admits a plain local plugin folder and attempts once per identity to grant this
 * user, SYSTEM and Administrators access without inheritance. ACL and owner observations never
 * gate plugins. Only this folder is tightened; parent and workspace permissions are untouched.
 * On POSIX, the own root is tightened best effort to 0700 with the same admission policy.
 */
export async function keepPluginRootPrivate(
  root: string,
  options: { platform?: Platform; lists?: OwnedAccessLists } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform
  if (!isAbsolute(root) || !isLocalDrivePath(root, platform)) throw new Error('unsafe-path')
  const parent = realPath(dirname(root), platform)
  if (
    platform === 'win32'
      ? parent.toLowerCase() !== dirname(root).toLowerCase()
      : parent !== dirname(root)
  )
    throw new Error('unsafe-path')
  if (platform !== 'win32') {
    try {
      mkdirSync(root, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    tightenPluginDirectory(root, platform)
    return
  }
  const lists = options.lists ?? windowsAccessLists
  try {
    mkdirSync(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const stat = lstatSync(root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe-path')
  const canonical = realPath(root, platform).toLowerCase()
  const checked = checkedRoots.get(canonical)
  if (checked?.dev === stat.dev && checked.ino === stat.ino) return
  const identity = `${canonical}:${stat.dev}:${stat.ino}`
  let tightening = rootTightenings.get(identity)
  if (!tightening) {
    tightening = Promise.resolve().then(async () => {
      try {
        const user = await lists.userSid()
        await lists.restrict(root, user, [])
      } catch {
        warnPluginPermissions(stat)
      }
    })
    rootTightenings.set(identity, tightening)
  }
  await tightening
  const again = lstatSync(root, { bigint: true })
  if (
    !again.isDirectory() ||
    again.isSymbolicLink() ||
    again.dev !== stat.dev ||
    again.ino !== stat.ino
  )
    throw new Error('unsafe-path')
  checkedRoots.set(canonical, { dev: stat.dev, ino: stat.ino })
}

/**
 * Whether `path` (canonical) is a root {@link keepPluginRootPrivate} admitted in this process, or
 * inside one that is still the folder it admitted. Always true off Windows.
 */
export function isInsideCheckedRoot(path: string, platform: Platform = process.platform): boolean {
  if (platform !== 'win32') return true
  for (const [root, identity] of checkedRoots) {
    if (!isWithinOrSame(root, path, platform)) continue
    try {
      const now = lstatSync(root, { bigint: true })
      if (!now.isSymbolicLink() && now.dev === identity.dev && now.ino === identity.ino) return true
    } catch {
      /* A root gone since its check holds nothing. */
    }
  }
  return false
}

import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync } from 'node:fs'
import { realpathSync, type BigIntStats } from 'node:fs'
import { lstat, open, type FileHandle } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

type Platform = NodeJS.Platform

/** New package files stay writable; executable files must remain runnable. */
export function immutableMode(executable: boolean, platform: Platform = process.platform): number {
  return executable && platform !== 'win32' ? 0o755 : 0o666
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

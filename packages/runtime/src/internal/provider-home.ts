import {
  type BigIntStats,
  type Stats,
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** Bound the wait for the per-home provisioning lock, then fail closed rather than hang. */
const LOCK_TIMEOUT_MS = 10_000
const LOCK_POLL_MS = 25

/**
 * A lockfile with no readable owner older than this is treated as abandoned: a live holder stamps it
 * within microseconds, and a released lock is truncated to empty (see {@link releaseLock}).
 */
const LOCK_UNSTAMPED_GRACE_MS = 2_000

/** Cap on stale-lock breaks per acquisition, so two processes breaking each other end in a timeout, not a livelock. */
const MAX_LOCK_STEALS = 3

/** Serial for this process's steal filenames, so two concurrent breaks cannot collide. */
let stealCounter = 0

/** Who holds a lockfile, as it wrote itself down. `null` when the file says nothing readable. */
interface LockOwner {
  readonly host: string
  readonly pid: number
}

/**
 * A lockfile as it was judged, identified by device, inode, size, mtime and bytes. A break destroys
 * only the file it judged: inode numbers can be reused once a corpse is unlinked, so size, mtime and
 * bytes must match too. All fields are read through one descriptor so they describe one file.
 */
interface LockSnapshot {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  /** When it was last written, to the nanosecond: what tells the file apart. */
  readonly mtimeNs: bigint
  /** The same, in milliseconds: what its age is judged by. */
  readonly mtimeMs: number
  /** The exact bytes, so a break can verify it is destroying the file it judged. */
  readonly text: string
  readonly owner: LockOwner | null
}

/** `<hostname>\n<pid>\n<iso>` — the same decidable shape Chromium's `SingletonLock` symlink carries. */
function ownerStamp(): string {
  return `${hostname()}\n${process.pid}\n${new Date().toISOString()}\n`
}

function ownerOf(text: string): LockOwner | null {
  const [host, pid] = text.split('\n')
  const numeric = Number(pid)
  if (!host || !Number.isInteger(numeric) || numeric <= 0) return null
  return { host, pid: numeric }
}

/**
 * Everything one judgement needs, from one descriptor; `null` only when nothing exists at the path.
 * A file that cannot be opened (a directory, mode 0000, a dangling symlink) is still identified by
 * `lstat`, with empty `text`, so it is broken by age instead of timing out forever.
 */
function readLockSnapshot(path: string): LockSnapshot | null {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    const stat = exactLstatOrNull(path)
    if (stat === null) return null // it is not there at all — nothing to judge, and nothing to break
    return {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
      mtimeMs: Number(stat.mtimeMs),
      text: '',
      owner: null,
    }
  }
  try {
    const stat = fstatSync(fd, { bigint: true })
    let text = ''
    try {
      text = readFileSync(fd, 'utf8')
    } catch {
      // unreadable: identified by its inode all the same, and judged by age like any unstamped lock
    }
    return {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
      mtimeMs: Number(stat.mtimeMs),
      text,
      owner: ownerOf(text),
    }
  } catch {
    return null
  } finally {
    try {
      closeSync(fd)
    } catch {
      // the descriptor is going out of scope either way
    }
  }
}

/** Is this the very file that was judged — same inode, same size, same mtime, same bytes? */
function isSameFile(moved: LockSnapshot, judged: LockSnapshot): boolean {
  return (
    isTheSameFile(moved, judged) &&
    moved.size === judged.size &&
    moved.mtimeNs === judged.mtimeNs &&
    moved.text === judged.text
  )
}

/**
 * Is the process that stamped this lockfile gone? A live pid on this host holds it; a pid on another
 * host cannot be judged, so the caller keeps waiting; an unstamped file is judged by the snapshot's
 * age. `process.kill(pid, 0)` cannot tell a reused pid from ours, which errs towards waiting rather
 * than breaking a live lock.
 */
function ownerIsGone(judged: LockSnapshot): boolean {
  const owner = judged.owner
  if (owner === null) {
    const age = Date.now() - judged.mtimeMs
    return age > LOCK_UNSTAMPED_GRACE_MS
  }
  if (owner.host !== hostname()) return false
  if (owner.pid === process.pid) return false // our own re-entrant hold; wait, do not break
  try {
    process.kill(owner.pid, 0)
    return false
  } catch (error) {
    // EPERM means a process with that pid exists and belongs to somebody else — alive, so wait.
    return errno(error) !== 'EPERM'
  }
}

/**
 * Move a stale lockfile aside atomically, and only the one that was judged. `rename` gives the file
 * to exactly one racer. The moved file is re-identified; if it is not the judged one it is put back
 * with `link` (never `rename`, which would overwrite a new holder).
 *
 * Two windows remain between the rename and the link: if a third process creates a lock meanwhile,
 * the restore fails and the displaced holder silently loses its lock; and a restored lock whose
 * holder already finished is empty (see {@link releaseLock}), so it clears after
 * {@link LOCK_UNSTAMPED_GRACE_MS}.
 */
function breakStaleLock(lockPath: string, judged: LockSnapshot): void {
  const stolen = `${lockPath}.stale-${process.pid}-${stealCounter++}`
  try {
    renameSync(lockPath, stolen)
  } catch {
    return // somebody else broke it first, or it released itself — retry the open
  }
  // A file that cannot be identified is put back, same as a different one.
  const moved = readLockSnapshot(stolen)
  if (moved === null || !isSameFile(moved, judged)) {
    try {
      linkSync(stolen, lockPath) // only if the path is free — never clobber a live holder
    } catch {
      // the path is taken again; the live holder is whoever has it now, and it is not this file
    }
  }
  try {
    unlinkSync(stolen)
  } catch {
    // A directory at the lock path makes unlink fail with EPERM; rmdir removes only an empty one.
    try {
      rmdirSync(stolen)
    } catch {
      // best-effort: the restore above may have been the last name for it
    }
  }
}

/**
 * Release our own lock and no other file. First truncate through our descriptor, so a lockfile
 * restored by a racing break is empty and ages out instead of naming a live pid forever. Then unlink
 * only if the path still has our inode: comparing dev and ino is sound here because the open
 * descriptor pins the inode. A small window between the `lstat` and the `unlink` remains; Node has no
 * unlink-by-inode.
 */
function releaseLock(fd: number, lockPath: string): void {
  try {
    ftruncateSync(fd, 0)
  } catch {
    // an unwritable descriptor still gets unlinked below; the stamp is a diagnostic, not the lock
  }
  // Taken while still open, which is what makes the inode ours to name.
  const ours = exactFstatOrNull(fd)
  try {
    closeSync(fd)
  } catch {
    // the descriptor is going out of scope either way
  }
  const atPath = exactLstatOrNull(lockPath)
  if (ours === null || atPath === null) return // nothing to identify, or nothing there to remove
  if (!isTheSameFile(atPath, ours)) return // not ours — somebody else's lock
  try {
    unlinkSync(lockPath)
  } catch {
    // best-effort release
  }
}

/** `lstat` or null (path missing) — never throws for a missing path. */
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/**
 * A file's identity on its disk: the device and the number there, as exact integers. Never JavaScript
 * numbers: on Windows a file number is 64 bits wide and two files can round to the same value.
 */
export interface FileIdentity {
  readonly dev: bigint
  readonly ino: bigint
}

/** Whether two looks found the same file. */
export function isTheSameFile(one: FileIdentity, other: FileIdentity): boolean {
  return one.dev === other.dev && one.ino === other.ino
}

/** `lstat` with exact numbers, or null when nothing is at `path`. */
export function exactLstatOrNull(path: string): BigIntStats | null {
  try {
    return lstatSync(path, { bigint: true })
  } catch {
    return null
  }
}

/** `stat` (it follows a link) with exact numbers, or null. */
export function exactStatOrNull(path: string): BigIntStats | null {
  try {
    return statSync(path, { bigint: true })
  } catch {
    return null
  }
}

/** `fstat` with exact numbers, or null. */
export function exactFstatOrNull(fd: number): BigIntStats | null {
  try {
    return fstatSync(fd, { bigint: true })
  } catch {
    return null
  }
}

/**
 * Whether `path`, looked at again, is the regular file the descriptor `fd` holds, and not a link.
 * Windows has no `O_NOFOLLOW`: an open there follows a link put at the path, so a read that must not
 * follow one asks this once the file is open.
 */
export function isStillTheFileOpened(path: string, fd: number): boolean {
  const now = exactLstatOrNull(path)
  const opened = exactFstatOrNull(fd)
  return now !== null && opened !== null && now.isFile() && isTheSameFile(now, opened)
}

/**
 * Opens `path` to read with `flags`, never through a link at its name, as `O_NOFOLLOW` does on
 * macOS and Linux, where that is the whole of it. Where there is no `O_NOFOLLOW` (Windows), the open
 * follows a link; there the name, looked at once the file is open, must still be the regular file
 * opened ({@link isStillTheFileOpened}), or the file is closed unread, as `ELOOP`.
 */
export function openNotThroughALink(path: string, flags: number): number {
  const noFollow = constants.O_NOFOLLOW as number | undefined
  if (noFollow !== undefined) return openSync(path, flags | noFollow)
  const fd = openSync(path, flags)
  if (isStillTheFileOpened(path, fd)) return fd
  closeQuietly(fd)
  const error = new Error(`ELOOP: ${path} is a link, so it was not read`)
  throw Object.assign(error, { code: 'ELOOP', path, syscall: 'open' })
}

/**
 * A name for a file staged beside `path`, which nobody can know before it is made, and so nobody can
 * leave a link at: `<path>.brobot-<24 hex digits>`.
 */
export function aStagingName(path: string): string {
  return `${path}.brobot-${randomBytes(12).toString('hex')}`
}

/**
 * Makes `path` a new file and opens it to write, refusing anything already at the name, a link
 * included, as `O_CREAT | O_EXCL` does on macOS and Linux.
 *
 * Where there is no `O_NOFOLLOW` (Windows), an exclusive create follows a link left at the name
 * and makes the file wherever it points. There, anything already at the name is refused first, as
 * `EEXIST`; and once the file is open, it must be the only name of the file opened
 * ({@link isTheOnlyNameOf}), or it is closed before a byte is written, as `ELOOP`. A link put there
 * in that moment leaves an empty file where it points.
 */
export function createFreshFile(path: string, mode = 0o600): number {
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
  const noFollow = constants.O_NOFOLLOW as number | undefined
  if (noFollow !== undefined) return openSync(path, flags | noFollow, mode)
  if (exactLstatOrNull(path) !== null) throw notMade('EEXIST', path)
  const fd = openSync(path, flags, mode)
  if (isTheOnlyNameOf(path, fd)) return fd
  closeQuietly(fd)
  throw notMade('ELOOP', path)
}

/**
 * Whether `path` is the one name of the regular file `fd` holds: the name is looked at, then the
 * file is asked how many names it has, then the name is looked at again. A link put at the name
 * and traded for a second name of the file it made (a hard link) is the same file at the name, but
 * a file of two names. Taking one of its names away and giving it back between the looks would
 * pass; these are three looks, not one.
 */
function isTheOnlyNameOf(path: string, fd: number): boolean {
  const before = exactLstatOrNull(path)
  const opened = exactFstatOrNull(fd)
  const after = exactLstatOrNull(path)
  return (
    before !== null &&
    opened !== null &&
    after !== null &&
    before.isFile() &&
    after.isFile() &&
    opened.nlink === 1n &&
    isTheSameFile(before, opened) &&
    isTheSameFile(after, opened)
  )
}

function notMade(code: 'EEXIST' | 'ELOOP', path: string): NodeJS.ErrnoException {
  const why = code === 'EEXIST' ? 'something is already at' : 'a link was put at'
  return Object.assign(new Error(`${code}: ${why} ${path}, so nothing was written there`), {
    code,
    path,
    syscall: 'open',
  })
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd)
  } catch {
    // the descriptor is going out of scope either way
  }
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

/**
 * `O_RDONLY|O_DIRECTORY[|O_NOFOLLOW]`, or `null` where the platform lacks them (Windows). `@types/node`
 * declares both as plain `number`, so they are looked up by name. Without them a pin is identity-only;
 * see {@link TrustedDir}.
 */
function directoryFlags(noFollow: boolean): number | null {
  const named = constants as unknown as Record<string, number | undefined>
  const directory = named.O_DIRECTORY
  const nofollow = named.O_NOFOLLOW
  if (directory === undefined) return null
  if (noFollow && nofollow === undefined) return null
  return (named.O_RDONLY ?? 0) | directory | (noFollow ? nofollow! : 0)
}

/**
 * A directory the ancestry walk proved is contained, pinned so the proof can be made again. The walk
 * rejects symlinks, but the lock wait yields, and another process may swap an ancestor for a symlink
 * meanwhile; later syscalls would then follow it out of the managed root. Each pin keeps:
 *
 *  - an identity (`dev`+`ino`), which catches a rename-and-replace by a symlink or another directory;
 *  - an open `O_DIRECTORY|O_NOFOLLOW` descriptor, which pins the inode so a reused inode number
 *    cannot pass. Without those flags the pin is identity-only.
 *
 * Node has no `openat`/`mkdirat`, so the leaf is still created by path; verifying on both sides of
 * that create leaves only a swap-and-swap-back inside it.
 */
interface TrustedDir {
  /** The path the later syscalls will take — the LEXICAL one, not the walk's resolved twin. */
  readonly path: string
  /**
   * True only for the managed root, whose last component may be a symlink (macOS `/tmp`). Its identity
   * is the resolved directory's, checked with `stat` rather than `lstat`.
   */
  readonly resolved: boolean
  readonly fd: number | null
  readonly dev: bigint
  readonly ino: bigint
}

function pinTrustedDir(path: string, resolved: boolean): TrustedDir {
  const stat = resolved ? exactStatOrNull(path) : exactLstatOrNull(path)
  if (stat === null) throw new Error(`providerHome ancestor is missing: ${path}`)
  if (!resolved && stat.isSymbolicLink()) {
    throw new Error(`providerHome path passes through a symlink: ${path}`)
  }
  if (!stat.isDirectory()) throw new Error(`providerHome ancestor is not a directory: ${path}`)
  const flags = directoryFlags(!resolved)
  let fd = flags === null ? null : openDirectoryOrNull(path, flags)
  if (fd !== null) {
    const held = exactFstatOrNull(fd)
    if (held === null) {
      closeQuietly(fd)
      fd = null // no descriptor to hold; the identity below still stands
    } else if (!isTheSameFile(held, stat)) {
      closeQuietly(fd)
      throw new Error(`providerHome ancestor was replaced while it was being checked: ${path}`)
    }
  }
  return { path, resolved, fd, dev: stat.dev, ino: stat.ino }
}

function openDirectoryOrNull(path: string, flags: number): number | null {
  try {
    return openSync(path, flags)
  } catch {
    return null // ELOOP (it is a symlink now), or a platform that will not open a directory
  }
}

/** Is this still the directory that was pinned — by name, by kind, by identity, and by descriptor? */
function verifyTrustedDir(pin: TrustedDir): void {
  const now = pin.resolved ? exactStatOrNull(pin.path) : exactLstatOrNull(pin.path)
  if (now === null) {
    throw new Error(`providerHome ancestor disappeared after it was checked: ${pin.path}`)
  }
  if (!pin.resolved && now.isSymbolicLink()) {
    throw new Error(`providerHome path passes through a symlink: ${pin.path}`)
  }
  if (!now.isDirectory()) throw new Error(`providerHome ancestor is not a directory: ${pin.path}`)
  if (!isTheSameFile(now, pin)) {
    throw new Error(`providerHome ancestor was replaced after it was checked: ${pin.path}`)
  }
  if (pin.fd === null) return
  const held = exactFstatOrNull(pin.fd)
  if (held === null || !isTheSameFile(held, pin)) {
    throw new Error(
      `providerHome ancestor is no longer the directory that was checked: ${pin.path}`,
    )
  }
}

/**
 * The trusted ancestry of one provider home. `release` is required: each pin may hold a descriptor,
 * so callers wrap the whole use in `try/finally`.
 */
export interface TrustedAncestry {
  /** Re-prove every ancestor. Throws — fail closed — the moment one is not what it was. */
  readonly verify: () => void
  /** Drop the descriptors. Safe to call more than once. */
  readonly release: () => void
}

/**
 * Validate `providerHome`'s ancestry under `managedRoot` (lexical containment, `realpath` of the root,
 * no symlink or non-directory component) and pin it. See {@link TrustedDir}.
 *
 *  - `create` makes missing ancestors at `0700` (provisioning). Without it a missing ancestor is a
 *    refusal, which is what a credential writer wants.
 *  - `includeLeaf` pins `providerHome` itself too. Off for {@link provisionProviderHome}, which creates
 *    the leaf under the lock; on for {@link provisionCodexAuth}, where the home must already exist.
 */
export function trustProviderHomeAncestry(
  managedRoot: string,
  providerHome: string,
  opts: { create?: boolean; includeLeaf?: boolean } = {},
): TrustedAncestry {
  const create = opts.create ?? false
  const includeLeaf = opts.includeLeaf ?? false
  const rootLexical = resolve(managedRoot)
  const home = resolve(providerHome)

  // Lexical containment first: a fast reject of an obvious escape (`..`, other root).
  if (home !== rootLexical && !home.startsWith(rootLexical + sep)) {
    throw new Error(`providerHome ${home} is not under the managed root ${rootLexical}`)
  }

  // Materialize the trusted managed root, then resolve it (a legitimately symlinked
  // prefix like macOS /tmp → /private/tmp is fine).
  if (create) mkdirSync(rootLexical, { recursive: true, mode: 0o700 })
  const realRoot = realpathSync(rootLexical)

  const pins: TrustedDir[] = []
  const release = (): void => {
    for (const pin of pins) if (pin.fd !== null) closeQuietly(pin.fd)
    pins.length = 0
  }
  try {
    pins.push(pinTrustedDir(rootLexical, true))
    // Walk root → home, rejecting any symlink component and any non-directory ancestor.
    // Create missing ANCESTORS at 0700; the home LEAF is the caller's business.
    const parts = relative(rootLexical, home)
      .split(sep)
      .filter((p) => p.length > 0)
    let current = realRoot
    let lexical = rootLexical
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]!)
      lexical = join(lexical, parts[i]!)
      const isLeaf = i === parts.length - 1
      const stat = lstatOrNull(current)
      if (stat?.isSymbolicLink()) {
        throw new Error(`providerHome path passes through a symlink: ${current}`)
      }
      if (isLeaf && !includeLeaf) break // the leaf is the caller's, under its own lock
      if (!stat) {
        if (!create) throw new Error(`providerHome ancestor is missing: ${current}`)
        try {
          mkdirSync(current, { mode: 0o700 })
        } catch (error) {
          if (errno(error) !== 'EEXIST') throw error // a benign concurrent create is fine
        }
      } else if (!stat.isDirectory()) {
        throw new Error(`providerHome ancestor is not a directory: ${current}`)
      }
      pins.push(pinTrustedDir(lexical, false))
    }
  } catch (error) {
    release() // a refusal must not leak the descriptors it opened on its way to refusing
    throw error
  }

  return {
    verify: () => {
      for (const pin of pins) verifyTrustedDir(pin)
    },
    release,
  }
}

/**
 * Wait `ms` without blocking the thread. Not `unref`'d: a provisioning in flight must keep the
 * process alive.
 */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `fn` holding an exclusive cross-process lock for `providerHome`: an `O_EXCL` sidecar
 * `<home>.lock` stamped with `<host>\n<pid>\n<iso>`. The wait is bounded and fails closed; the lock
 * is released in `finally`.
 *
 *  - A lock whose owner is gone (dead pid on this host, or unstamped and past the grace period) is
 *    broken rather than honoured; see {@link breakStaleLock}.
 *  - The wait is asynchronous so it does not block the Electron main thread; the rest (`mkdirSync`,
 *    lockfile I/O, snapshots, release) is synchronous `fs`.
 *  - Do not nest: an inner acquisition cannot break our own pid's lock and times out.
 *  - While a contended provision waits, a profile directory can exist before its provider leaf does.
 *  - `verify` runs before each attempt and once with the lock held, so a swapped ancestor is caught
 *    across the wait.
 */
export async function withProviderHomeLock<T>(
  providerHome: string,
  fn: () => T | Promise<T>,
  opts: { timeoutMs?: number; pollMs?: number; verify?: () => void } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS
  const pollMs = opts.pollMs ?? LOCK_POLL_MS
  const verify = opts.verify ?? (() => {})
  const home = resolve(providerHome)
  const lockPath = `${home}.lock`
  // Before anything is created at a path derived from `providerHome`: the `mkdir` below would
  // otherwise materialize the ancestors of an escaped path, and the lockfile lands beside the home.
  verify()
  // The lock's parent must exist for the lockfile; in the real flows the caller already made it.
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })

  const start = Date.now()
  let steals = 0
  let fd: number
  for (;;) {
    // Every attempt, because the `await` below is where the path can stop being the path. Outside
    // the `try` so a refusal is not mistaken for a lock error.
    verify()
    try {
      fd = createFreshFile(lockPath) // O_CREAT|O_EXCL|O_WRONLY — fails EEXIST if held
      // Stamp at once with the fd the create returned, to keep the undecidable interval tiny. A
      // failed stamp is ignored: the lock is held either way.
      try {
        writeSync(fd, ownerStamp())
      } catch {
        // an unstamped lock is decided by age instead — see LOCK_UNSTAMPED_GRACE_MS
      }
      break
    } catch (error) {
      if (errno(error) !== 'EEXIST') throw error
      // One snapshot per attempt; every decision below uses it.
      const judged = readLockSnapshot(lockPath)
      // Every attempt is counted, even a failed break, so an unbreakable path cannot spin here forever.
      if (judged !== null && steals < MAX_LOCK_STEALS && ownerIsGone(judged)) {
        steals++
        breakStaleLock(lockPath, judged)
        continue // retry at once: a corpse costs one syscall, not one poll
      }
      if (Date.now() - start > timeoutMs) {
        const owner = judged?.owner ?? null
        const held =
          owner === null
            ? 'the lockfile names no owner'
            : `held by pid ${owner.pid} on ${owner.host}`
        throw new Error(`timed out acquiring provisioning lock for ${home} (${held})`, {
          cause: error,
        })
      }
      await delay(pollMs)
    }
  }
  try {
    // Once more with the lock held: the acquisition is the last thing that can have waited.
    verify()
    // Awaited so a body returning a promise stays under the lock until it settles.
    return await fn()
  } finally {
    releaseLock(fd, lockPath)
  }
}

/**
 * Ensure the app-owned provider home exists as a real directory under a validated `managedRoot`.
 * Fail-closed:
 *  - rejects a path escape or a symlink component that would redirect out of the root;
 *  - rejects an existing regular file (or any non-directory) at the home path;
 *  - leaves an existing directory's permissions unchanged;
 *  - takes a per-home cross-process lock around the leaf create so concurrent provisioning of the
 *    same home cannot race.
 *
 * Deriving the `<userData>/provider-homes/default/<profile>/…` path is the caller's job; this accepts
 * an absolute `providerHome`. It never falls back to a personal provider home. The ancestry check is
 * pinned and re-verified across the lock wait; see {@link TrustedDir}.
 */
export async function provisionProviderHome(
  managedRoot: string,
  providerHome: string,
): Promise<void> {
  const home = resolve(providerHome)
  // Kept so the walk's result outlives the `await` below.
  const ancestry = trustProviderHomeAncestry(managedRoot, providerHome, { create: true })
  try {
    // The home leaf: create if missing, else require a real directory.
    await withProviderHomeLock(
      home,
      () => {
        ancestry.verify()
        const stat = lstatOrNull(home)
        if (!stat) {
          mkdirSync(home, { mode: 0o700 })
          // Verified again after the create: Node has no `mkdirat`, so it is made by path.
          ancestry.verify()
          return
        }
        if (stat.isSymbolicLink()) {
          throw new Error(`providerHome is a symlink: ${home}`)
        }
        if (!stat.isDirectory()) {
          throw new Error(`providerHome exists but is not a directory: ${home}`)
        }
      },
      { verify: ancestry.verify },
    )
  } finally {
    ancestry.release()
  }
}

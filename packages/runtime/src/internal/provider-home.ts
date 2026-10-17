import {
  type BigIntStats,
  type Stats,
  chmodSync,
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
 * How long a lockfile carrying no owner may sit before it is treated as a corpse.
 *
 * The stamp is written with the same `fd` the create returned, on the next statement — so a live
 * holder has one within microseconds. A lockfile with none is therefore either a crash in that
 * window, or a lock written by a build from before {@link withProviderHomeLock} stamped anything.
 * Two seconds is orders of magnitude above the window and well below a plausible hold.
 *
 * ⚑ **A third meaning since 240, and it is what makes that dispatch's repair work**: a lock whose
 * holder has RELEASED it. {@link releaseLock} retracts the stamp before it unlinks, so a file that
 * survives its own release — restored by a contender that renamed it away first — is empty rather
 * than signed by a live pid, and this grace is what eventually clears it. All three meanings are the
 * same fact: no process is holding this.
 */
const LOCK_UNSTAMPED_GRACE_MS = 2_000

/**
 * How many times one acquisition may break a stale lock before giving up on the home.
 *
 * ⚠️ **A backstop against ping-pong, not a policy.** Two processes that each keep breaking and
 * losing would otherwise spin until the timeout with nobody making progress; three attempts is more
 * than any real sequence needs and small enough that a pathological one still ends in the honest
 * "timed out" rather than in a livelock.
 */
const MAX_LOCK_STEALS = 3

/** Serial for this process's steal filenames, so two concurrent breaks cannot collide. */
let stealCounter = 0

/** Who holds a lockfile, as it wrote itself down. `null` when the file says nothing readable. */
interface LockOwner {
  readonly host: string
  readonly pid: number
}

/**
 * 🔴 **What a lockfile WAS when it was judged** (238, from 208 M1).
 *
 * ## ⛔ The finding: a judgement that could not be checked
 *
 * A break used to carry the judged file's BYTES and nothing else, and restored the file it moved
 * only when those bytes were non-empty and had changed. So two contenders that both snapshotted the
 * same *empty* pre-{@link LOCK_UNSTAMPED_GRACE_MS} sidecar as a corpse — an aged crash between the
 * create and the stamp, or a lockfile from a build before 202 — each judged with `owner = null`,
 * i.e. with **no bytes to compare**. The first broke it and took the lock; the second then renamed
 * away the *live* lock the first had just stamped, could not tell (empty is empty), skipped the
 * restore, unlinked the winner's inode and entered the critical section beside it. Both ran, and
 * the first one's unconditional release then removed the second one's lock for a third.
 *
 * ⚑ **So the judgement carries an IDENTITY, not a value** — all five fields 208 named, and every one
 * of them is load-bearing. ⚠️ **`dev`+`ino` are NOT sufficient on their own, and the first draft of
 * this comment claimed they were** (review). The reasoning was circular: it argued the judged inode
 * cannot have been recycled because the file is still linked at the steal path — which is true only
 * in the case where the answer is already *"same file"*. In the case this check exists for, a faster
 * contender has already unlinked the corpse, so its inode number IS free, and a filesystem that
 * reuses them (ext4 does; APFS hands out monotonically increasing ids, which is why the race test
 * cannot see it) can hand exactly that number to the winner's fresh lock. There the comparison is
 * carried entirely by `size`, `mtimeNs` and the bytes — an aged empty file against a freshly stamped
 * one — and they also catch the one thing an inode number never could: the same file MODIFIED in
 * place between the judgement and the rename.
 *
 * ⚠️ **Read through ONE descriptor.** A `readFileSync(path)` followed by an `lstat(path)` are two
 * different files whenever the second contender is quick, and a judgement assembled out of two files
 * is exactly what could not be checked afterwards. `open` once, `fstat` and read that fd.
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
 * Everything one judgement needs, from one descriptor. `null` only when there is nothing at the path
 * to judge at all.
 *
 * ⛔ **Anything that EXISTS gets a judgement, however little it will say about itself** (238,
 * review). Before 238, `readLockOwner` returned null for every shape it could not read and
 * `ownerIsGone` fell through to `mtime` — so a directory at the lock path, a file at mode `0000`
 * left by a run under another uid, or a dangling symlink was broken by AGE like any other corpse. A
 * version of this function that answered "no judgement" for those shapes made them **unbreakable**,
 * and every later provisioning of that home time out forever: 191 M5's *"fails forever"*, arriving
 * as the fix for a different finding. Measured against `cb7b7e4` on all three shapes before this
 * paragraph existed.
 *
 * ⚑ So there are two ways to answer, and only a path that does not exist gets neither: the
 * descriptor when the file opens, and `lstat` when it does not. Both give the same four identity
 * fields, `text` is empty in the second case because nothing was read — and `rename` needs write on
 * the DIRECTORY rather than read on the file, so breaking it was always possible.
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
 * Is the process that stamped this lockfile gone?
 *
 * ⛔ **Three answers, and only one of them breaks the lock.** A live pid on this host holds it. A pid
 * on ANOTHER host is not ours to judge — nothing here can ask that machine, so the honest answer is
 * to keep waiting and time out as before. A lockfile with no readable owner is decided by age
 * ({@link LOCK_UNSTAMPED_GRACE_MS}) rather than by content, because a live holder always has one.
 *
 * ⚠️ **The age is the SNAPSHOT's**, taken from the same descriptor the bytes came from, so "this
 * file said nothing and this file is old" are two facts about one file rather than about whatever
 * happened to be at the path at each moment.
 *
 * ⚠️ **`process.kill(pid, 0)` answers "is there a process with this pid", not "is it OURS".** After
 * a reboot or a long uptime a pid can be reused, and this would then read a stranger's process as
 * our live holder — which errs towards WAITING, i.e. towards the old behaviour, and times out. The
 * opposite error (breaking a live lock) is the one worth avoiding, so the asymmetry is deliberate.
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
 * Take a stale lockfile out of the way — atomically, and only the one that was judged.
 *
 * ⛔ **`rename` rather than `unlink`, and that is the whole of the race handling.** Two processes
 * that both judge a corpse both try to move it; POSIX gives the file to exactly one of them and the
 * other gets `ENOENT`, so only one break happens however many racers there are.
 *
 * ⚠️ **And the file is re-identified afterwards**, because another process could have broken this
 * lock and taken it in the window between the judgement and the rename — in which case what was
 * moved is a LIVE lock. `link` puts it back (never `rename`, which would silently overwrite whatever
 * now holds the path), and this attempt goes back to waiting.
 *
 * ⛔ **Against the judged file's IDENTITY, not against its bytes** (238, from 208 M1). The check used
 * to be `judged !== null && moved !== judged`, and *both* of those conditions failed on the case
 * that mattered: a lockfile with no readable owner has no `judged` bytes to carry, so a contender
 * that broke an aged empty sidecar skipped the restore **unconditionally** — including when the file
 * it had just renamed away was the fresh, stamped, live lock a faster contender had taken in the
 * meantime. It unlinked that live inode, took the path, and both processes ran `fn()` over one home.
 * See {@link LockSnapshot}. An empty file and a stamped file are now different files.
 *
 * ⛔ **TWO residual windows, named rather than claimed away.** Both live in the few syscalls between
 * the rename and the link, and both need a coincidence inside them:
 *
 *  1. **The `link` FAILS** — some further process has created a lock at the path since the rename,
 *     so the file being restored is destroyed instead; its holder still has it open by fd and will
 *     unlink the path in its own `finally`, removing a lock that is no longer theirs. That needs a
 *     *third* takeover, where before 238 an ordinary second contender was enough.
 *  2. ⚑ **The `link` SUCCEEDS onto a lock whose holder has already finished** (238, review) —
 *     **closed in 240, and by the release rather than by this** (240 §2). If the holder's `finally`
 *     ran between our rename and our link, its `unlink` hit `ENOENT` and the file we put back had
 *     nobody left to remove it; its stamp named a live pid, so every later contender waited it out
 *     for the life of that process. {@link releaseLock} now retracts the stamp through the holder's
 *     own descriptor before it unlinks, so what gets restored is an EMPTY lockfile — decided by
 *     {@link LOCK_UNSTAMPED_GRACE_MS} like any other unstamped corpse. ⚠️ **The window itself is not
 *     gone**: a home can still be locked by a file nobody holds. It now costs two seconds instead of
 *     the rest of the run, which is the same trade 202 made for a crashed holder.
 *
 * ⚑ **The cost of window 1 is one unserialized `mkdir`/`chmod` of a directory that already exists;
 * the cost of not breaking stale locks at all was the whole of 202's finding.** It is written down
 * because a comment that stopped at "atomic" would be claiming more than the code does.
 */
function breakStaleLock(lockPath: string, judged: LockSnapshot): void {
  const stolen = `${lockPath}.stale-${process.pid}-${stealCounter++}`
  try {
    renameSync(lockPath, stolen)
  } catch {
    return // somebody else broke it first, or it released itself — retry the open
  }
  // ⚠️ `null` here is "this is not a file I can identify", which is not the same as "this is the
  // corpse I judged" — a judgement that cannot be confirmed puts the file back and waits.
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
    // ⚠️ A DIRECTORY at the lock path raises EPERM here, and the steal name would then sit in the
    // managed root for ever (238, review — measured as `profile.lock.stale-<pid>-0` surviving the
    // run). `rmdir` only removes an EMPTY one, so this cleans up the pathological shape without
    // ever recursing into something somebody meant to keep.
    try {
      rmdirSync(stolen)
    } catch {
      // best-effort: the restore above may have been the last name for it
    }
  }
}

/**
 * 🔴 **Let go of the lock — of OUR lock, and of no other file** (240, closing 238 §3's residual).
 *
 * ## ⛔ The finding: the release was the one operation that never checked anything
 *
 * `238` taught the BREAK to identify what it moves. The release beneath it still did
 * `unlinkSync(lockPath)` unconditionally, which is two different defects wearing one line:
 *
 *  1. ⛔ **It could delete somebody else's live lock.** A contender that judges an unstamped, aged
 *     lock breaks it and takes the home while its holder is still inside `fn()`; when that holder
 *     finishes, its `finally` removes the lock the contender is now holding, and a third process
 *     walks in. ⚑ **238's own `LockSnapshot` comment describes this happening** — *"the first one's
 *     unconditional release then removed the second one's lock for a third"* — as the tail of the
 *     M1 story. Fixing the break left the tail where it was.
 *  2. ⛔ **And it could leave a lock that nothing would ever break.** `238` §3 named it: if the
 *     holder's `unlink` lands between a contender's `rename` and its `link`, the unlink hits
 *     `ENOENT` and the contender then restores a lockfile **whose holder has already finished**.
 *     Its stamp names a live pid, so `ownerIsGone` says no for ever. ⚠️ **Worse in the common case
 *     than that sentence suggests: the pid it names is usually OURS**, and `withProviderHomeLock`
 *     refuses to break its own hold (`owner.pid === process.pid`) — so the app wedges that home for
 *     itself, for the rest of the run, on the next launch that provisions it.
 *
 * ## ⚑ Two steps, and the order is the argument
 *
 * **1 · Retract the stamp through our own descriptor.** `ftruncate(fd, 0)` names the inode we have
 * open, whatever the path now holds and whatever anybody renamed it to — so it cannot touch another
 * process's file even in principle. A restored corpse is then EMPTY, which is decided by
 * {@link LOCK_UNSTAMPED_GRACE_MS} like any other unstamped lock: breakable in two seconds instead of
 * never. ⚑ It is also the safety net for step 2 — every way the identity check can fail leaves a
 * file that is already harmless.
 *
 * **2 · Unlink only if the path still names our file.** `fstat` on the held descriptor against
 * `lstat` of the path. ⚑ **`dev`+`ino` alone are sound HERE, and 238's `LockSnapshot` explains why
 * they were not there**: that comparison is made after a corpse may have been unlinked, so its inode
 * number is free to be reused. This one is made while we still hold the file OPEN — an open
 * descriptor pins the inode, so no other file on that device can be wearing its number. Different
 * question, different guarantee, and the difference is worth a sentence because the first draft of
 * 238's got it wrong in the other direction.
 *
 * ⚠️ **One window remains and is not claimed away**: between the `lstat` and the `unlink`, another
 * process could break our lock and put its own there, and we would remove it. POSIX has no
 * "unlink this inode" — `unlinkat` takes a path too — so closing it needs a different lock design
 * rather than a different call. It is orders of magnitude narrower than the unconditional unlink it
 * replaces, which had no window because it never asked.
 */
function releaseLock(fd: number, lockPath: string): void {
  try {
    ftruncateSync(fd, 0)
  } catch {
    // an unwritable descriptor still gets unlinked below; the stamp is a diagnostic, not the lock
  }
  // While it is still open, which is what makes the inode ours to name.
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
 * A file's identity on its disk: the device it is on and its number there, as the exact integers
 * the system gives. ⛔ Never as JavaScript numbers: on Windows a file's number is 64 bits wide, and
 * above 2^53 two different files can round to the same number.
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
 * ⚠️ Where there is no `O_NOFOLLOW` (Windows), an exclusive create follows a link left at the name
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
 * a file of two names. ⚠️ Taking one of its names away and giving it back between the looks would
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
 * `O_RDONLY|O_DIRECTORY[|O_NOFOLLOW]`, or `null` where this platform has no such flags.
 *
 * ⚠️ **`@types/node` declares both as plain `number`, and on Windows they do not exist at
 * runtime** — so the lookup is by name through an index signature rather than a comparison
 * TypeScript would call unintentional. A platform without them gets identity-only pinning; see
 * {@link TrustedDir}.
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
 * 🔴 **A directory the walk proved is contained, PINNED so the proof can be made again** (293 §1,
 * from 289 rank 1).
 *
 * ## ⛔ The finding: the containment check stopped protecting the path it had checked
 *
 * {@link provisionProviderHome} walked root → home rejecting every symlink component, and then
 * **awaited** {@link withProviderHomeLock}. A contested lock yields; the `openSync` of the lockfile
 * and the leaf `lstat`/`mkdir` afterwards then used **the original string path again**. 289's
 * reviewer reproduced it in a disposable tree: process A waits behind a live `codex.lock`; while it
 * sleeps, B renames the already-validated profile ancestor away and puts a symlink to an outside
 * directory in its place; A retries through the symlink, creates `outside/codex` and returns
 * **success** — `{"escapedHomeCreated":true,"managedHomeIsSymlink":true}`. The ordinary Codex path
 * then copies `auth.json` into it. ⛔ **A credential leaves the managed root through the function
 * whose advertised guarantee is that it cannot.**
 *
 * ⚠️ **NOT a 243 regression, and the first draft of the brief said it was.** Verified against the
 * pre-243 source: the ordering is identical, `withProviderHomeLock` waited up to ten seconds in both
 * versions, and the attack is CROSS-PROCESS — another OS process renames the ancestor while this one
 * waits, which a synchronous `Atomics.wait` does nothing to prevent. The window has existed since
 * the lock arrived in 027. ⚑ What 243 did add is a second, *in-process* way to reach the same
 * window, because an async wait also yields to other work in this process.
 *
 * ## ⚑ Two facts per ancestor, and neither alone is enough
 *
 *  - **An identity** (`dev`+`ino`) taken when the ancestor was validated. A rename-and-replace is a
 *    different inode whether the replacement is a symlink or a real directory, so this catches the
 *    swap that an `lstat`-for-symlink test alone would miss.
 *  - ⛔ **An open descriptor on that very directory**, kept for the life of the provisioning. An
 *    identity on its own can be defeated by inode reuse — free the inode, and a filesystem that
 *    recycles numbers (ext4 does) can hand the same one back to the attacker's directory. An open
 *    fd pins the inode, so no other file on that device can be wearing its number, and `fstat` on it
 *    answers *"the thing I validated is still alive and is still this"*. Same argument
 *    {@link releaseLock} makes for its own comparison, and the same reason 238's could not make it.
 *
 * ⚠️ **The descriptor is opened `O_DIRECTORY|O_NOFOLLOW`, which is a third check at the moment of
 * opening** — and where the platform has no such flags ({@link directoryFlags}) the pin degrades to
 * identity-only rather than refusing to work. Said out loud because a fallback that is silently
 * weaker is how a guarantee becomes a comment.
 *
 * ⛔ **What this does NOT do, named rather than claimed away.** Node exposes no `openat`/`mkdirat`,
 * so the leaf is still created by PATH. The residual is the few microseconds between the last
 * {@link verifyTrustedDir} and the `mkdirSync` that follows it, and closing it properly needs a
 * syscall this runtime does not have. {@link provisionProviderHome} verifies on both sides of that
 * create, so reaching it needs an attacker to swap the ancestor and swap it back inside that window.
 */
interface TrustedDir {
  /** The path the later syscalls will take — the LEXICAL one, not the walk's resolved twin. */
  readonly path: string
  /**
   * ⚠️ **True only for the managed root**, whose last component may legitimately be a symlink
   * (macOS `/tmp` → `/private/tmp`, and `os.tmpdir()` under every test in this file). Its identity
   * is therefore the RESOLVED directory's, checked with `stat` rather than `lstat` — which is also
   * what catches somebody swapping the root's own last component after `realpath` read it.
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
 * The trusted ancestry of one provider home: **check it again, and let go of it** (293 §1).
 *
 * ⚠️ **`release` is not optional and there is no finalizer.** Every pin may hold a descriptor, so a
 * caller that forgets leaks one per provisioning. Both callers wrap the whole use in `try/finally`.
 */
export interface TrustedAncestry {
  /** Re-prove every ancestor. Throws — fail closed — the moment one is not what it was. */
  readonly verify: () => void
  /** Drop the descriptors. Safe to call more than once. */
  readonly release: () => void
}

/**
 * Validate `providerHome`'s ancestry under `managedRoot` and **pin it** (293 §1).
 *
 * This is the walk {@link provisionProviderHome} always did — lexical containment, `realpath` of the
 * root, reject a symlink component, reject a non-directory ancestor — with the result kept rather
 * than thrown away at the first `await`. See {@link TrustedDir} for what a pin is and what it cannot
 * do.
 *
 *  - `create` — make missing ancestors at `0700` (the provisioning path). Without it a missing
 *    ancestor is a refusal, which is what a credential WRITER wants: it is not the thing that
 *    brings homes into existence.
 *  - `includeLeaf` — pin `providerHome` itself as well. ⛔ Off for
 *    {@link provisionProviderHome}, whose leaf is the thing it is about to create under the lock;
 *    on for {@link provisionCodexAuth}, where the home must already be there and is the directory
 *    the credential lands in.
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

  // Lexical containment first — fast reject of an obvious escape (`..`, other root).
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
 * Wait `ms` without stopping the thread (243).
 *
 * ⛔ **This replaced `sleepSync`, whose comment said *"Atomics.wait on an un-notified location —
 * Node main thread OK"*.** True of a Node CLI, false of Electron, where that thread is the main
 * process and also the one that pumps the window. Measured before the change with a real second
 * process holding a real lock: a 2 000 ms contended acquisition ran **0 of an expected 200 timer
 * ticks**, and the longest interval in which the thread executed nothing was **2 005 ms**. See
 * `smoke/main-thread-block-probe.smoke.ts`.
 *
 * ⚠️ **Deliberately NOT `unref`'d.** `Atomics.wait` held the process open for the whole wait, and a
 * provisioning in flight is work the process owes somebody; a timer that let the loop drain would be
 * a behaviour change smuggled in beside a latency fix.
 */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Run `fn` holding an **exclusive, cross-process** lock for `providerHome` (027,
 * fixing 023 P1-H). The lock is an `O_EXCL` sidecar lockfile (`<home>.lock`) so
 * concurrent provisioning / auth writes of the SAME home serialize instead of
 * racing and corrupting each other. Bounded wait → fail closed on a stuck lock.
 * The lockfile is unlinked in `finally`, so a thrown `fn` still releases it.
 *
 * ## ⛔ A dead owner's lock is BROKEN, not honoured (202, from 191 M5 by way of 198's ranking)
 *
 * *"The most likely way to brick the app"* — `198`'s words about this function. The lockfile carried
 * **no owner at all**, so a hard death while holding it (SIGKILL, a power cut, a crash between the
 * create and the release) left a file that nothing could ever decide was dead. Every later
 * provisioning of that home then spent ten seconds of `Atomics.wait` and threw, **forever**, and the
 * only repair was to delete a file by hand that nothing in the product mentions.
 *
 * ⚑ **`198` measured Chromium doing the opposite three feet away**, in the same `userData`: its
 * `SingletonLock` is a symlink whose target is `<hostname>-<pid>`, so staleness is *decidable*, and
 * a successor onto a SIGKILLed instance's directory takes the lock cleanly. This function now
 * carries the same two facts in the file it already writes, and answers the same way.
 *
 * ## ⛔ …and two contenders may not BOTH decide it (238, from 208 M1)
 *
 * The repair above judges a lockfile and then moves it, and until 238 nothing checked that the file
 * it moved was the file it judged. Two processes meeting the same aged, unstamped sidecar — 202's
 * own `held('')` fixture, arriving twice — both judged `owner = null`, and the second renamed away
 * the LIVE lock the first had just stamped. See {@link LockSnapshot} and {@link breakStaleLock}: a
 * judgement now carries the file's identity, and a break that moved something else puts it back.
 *
 * ## ⛔ …and a release lets go of ITS OWN lock (240 §2, closing 238 §3)
 *
 * The two paragraphs above are both about deciding a file before destroying it, and until 240 the
 * `finally` below did neither: it unlinked whatever was at the path. See {@link releaseLock} for the
 * two defects that were one line, and for why an inode comparison is sound there and was not in
 * {@link breakStaleLock}.
 *
 * ## 🔴 …and the WAIT no longer stops the thread that asked for it (243)
 *
 * ⛔ **This function used to say, right here, that it did.** *"The wait is still synchronous
 * (`Atomics.wait` on the Electron main thread) and a genuinely LIVE holder can still block it for
 * the full timeout."* It cost a whole mechanism: `codex/home-boot.ts` built a SECOND, in-process
 * gate — its own key, its own fail-open, its own bugs — because *"the cross-process lock that WOULD
 * cover it … is synchronous"*, and `180` said in as many words that the in-process one cannot cover
 * two BroBot instances.
 *
 * ⚑ **Measured before and after, with a real second process holding a real lock on a real home**
 * (`smoke/main-thread-block-probe.smoke.ts`). The instrument is a 10 ms `setInterval` armed before
 * the acquisition — a promise resolving proves nothing about a thread, because `Atomics.wait` blocks
 * the thread and every promise resolves afterwards looking healthy:
 *
 * | contended wait | ticks the thread ran / expected | longest interval running nothing |
 * |---|---|---|
 * | 500 ms, before | **0 / 50** | **502 ms** |
 * | 500 ms, after | 47 / 51 | **12 ms** |
 * | 2 000 ms, before | **0 / 200** | **2 005 ms** |
 * | 2 000 ms, after | 187 / 201 | **12 ms** |
 * | timing out at 1 s, before | **0 / 101** | **1 015 ms** |
 * | timing out at 1 s, after | 93 / 100 | **12 ms** |
 *
 * ⚑ **The last pair is the worst case the product can actually reach**, and it is the one the two
 * sentences this paragraph replaced were describing: `LOCK_TIMEOUT_MS` is ten seconds, so a live
 * holder used to be worth ten seconds of dead window before the app even got to say no.
 *
 * ⚠️ **The claim is exactly "a CONTENDED WAIT no longer blocks the window", and no more than that.**
 * Everything else on this path is still synchronous `fs` on the calling thread — the `mkdirSync`
 * below, the `openSync`/`writeSync` of the lockfile, {@link readLockSnapshot} per attempt,
 * {@link releaseLock}, and the guarded body itself. On a slow or network-backed `userData` those
 * syscalls are the freeze, and 243 does not touch one of them. The `uncontended` row of that probe
 * is the guard on the common case: **1 ms before, 1 ms after.**
 *
 * ## ⚠️ What the `await` newly ALLOWS, named rather than left to be discovered
 *
 * While the wait was `Atomics.wait` this lock was non-reentrant **by construction**: one thread, one
 * blocking call, so a process could not be inside two acquisitions of one home at once. It can now.
 * Three consequences, all three MEASURED rather than reasoned about, because the obvious fear turned
 * out to be wrong and two less obvious things turned out to be true:
 *
 *  1. ⚑ **Two SIBLING acquisitions do not deadlock.** {@link ownerIsGone} refuses to break a
 *     lockfile stamped with our OWN pid, so the natural conclusion is that the second waits out the
 *     whole timeout. It does not: it polls, the first release arrives, and it takes the lock — the
 *     same way a second process would. Measured at 65 ms for two 60 ms bodies. ⚠️ **A draft of 243
 *     added an in-process queue to prevent that deadlock and it was removed when no test could be
 *     made to fail without it.**
 *  2. ⛔ **A NESTED acquisition DOES wait out the whole timeout, and then throws naming our own
 *     pid.** `await withProviderHomeLock(home, async () => { await provisionCodexAuth(home) })`
 *     type-checks and reads correctly since this signature took `() => T | Promise<T>` — and
 *     measured at `timeoutMs: 1_000` it takes 1 018 ms and fails with *"held by pid <ours>"*, which
 *     is the least actionable sentence this app can print. ⚠️ **Do not nest this lock.** It is the
 *     one thing the new signature makes easy and must not be done; there is no re-entrant grant,
 *     deliberately, because a grant would let an inner body run outside the exclusion the outer one
 *     was promised.
 *  3. ⚠️ **A CONTENDED provisioning is now interleavable, and a half-made profile is briefly
 *     visible.** {@link provisionProviderHome} creates `default/<profile>/` in its synchronous
 *     ancestor walk and the `<provider>` leaf inside this lock — and `listProviderHomes` only counts
 *     a home once the leaf exists. Before 243 that interval could not be observed in-process at all;
 *     now the loop yields every `pollMs` for up to {@link LOCK_TIMEOUT_MS}, so a command arriving in
 *     that window reads a profile directory that is not yet a profile. ⛔ **Measured**: 300 ms into a
 *     contended provision, `{profileDirExists: true, leafExists: false, listProfileIds: ["default"]}`.
 *     ⚑ It needs a second process holding that lockfile to be reachable at all — the uncontended
 *     cascade completes in one microtask drain, with no interleaving whatever — and it is left
 *     NAMED rather than fixed, because hoisting the leaf create out of the lock is a change to what
 *     this lock protects and 243 is a change to how a caller waits.
 *
 * ⛔ **What did NOT become redundant: `180`'s in-process boot gate.** Its critical section runs to
 * `initialize` having answered, and that request is **unbounded** — `codex-runtime.ts`'s
 * `await this.transport.request('initialize', initializeParams())`, with no bound around it, as its
 * `thread/start` and `thread/resume` neighbours also have none. Expressed with this lock, a
 * wedged-but-alive app-server would hold `<home>.lock` stamped with a live pid — and
 * {@link ownerIsGone} refuses to break our own pid's hold — which is 191 M5's *"fails forever"*
 * rebuilt, now also wedging every {@link provisionProviderHome} of that home. It fails OPEN at 15 s
 * where this fails CLOSED at 10; it hands out a release token that is dropped mid-launch rather than
 * wrapping a callback; and it takes an `AbortSignal`, which this has nowhere to accept. ⚑ **Four
 * reasons, and the first alone would be enough** — the other three are listed because a single
 * reason for keeping a mechanism is a reason somebody will try to design around. The comment in
 * `home-boot.ts` that named this function's synchronicity has been corrected, and nothing else there
 * changed.
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
  // ⛔ **Before anything is CREATED at a path derived from `providerHome`** (293 §1). The recursive
  // `mkdir` below would otherwise materialize the ancestors of an escaped path, and the lockfile
  // itself lands beside the home — so a swapped ancestor takes the sidecar outside the root too.
  verify()
  // The lock's parent must exist to create the lockfile. In the real flows the parent
  // is already there (provisioned/validated by the caller), so this is a no-op — no
  // symlink-follow risk because there is nothing to create.
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 })

  const start = Date.now()
  let steals = 0
  let fd: number
  for (;;) {
    // ⛔ **Every attempt, because the `await` below is where the path can stop being the path**
    // (293 §1, from 289 rank 1). Outside the `try`: a refusal here is not a lock error, nothing is
    // held yet, and routing it through the `EEXIST` branch would be a way to lose it.
    verify()
    try {
      fd = createFreshFile(lockPath) // O_CREAT|O_EXCL|O_WRONLY — fails EEXIST if held
      // ⛔ **Immediately, with the fd the create just returned.** The gap between holding the lock
      // and saying who holds it is the only interval in which this file is undecidable, and writing
      // on the next statement is what keeps that interval microseconds wide. A failure to stamp is
      // swallowed: the lock is genuinely held either way, and refusing to proceed because the
      // diagnostics did not land would be a new way to fail closed on nothing.
      try {
        writeSync(fd, ownerStamp())
      } catch {
        // an unstamped lock is decided by age instead — see LOCK_UNSTAMPED_GRACE_MS
      }
      break
    } catch (error) {
      if (errno(error) !== 'EEXIST') throw error
      // ⚠️ ONE snapshot per attempt, and every decision below is made from it. Reading the path
      // again for the age, or again for the message, would be reading a different file each time.
      const judged = readLockSnapshot(lockPath)
      // ⛔ **The attempt is counted whether or not it broke anything.** `continue` skips both the
      // timeout check and the sleep, so an unbreakable-but-stale-looking path would spin here
      // forever if only successful breaks were charged; {@link MAX_LOCK_STEALS} is what bounds it.
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
    // ⛔ **Once more with the lock HELD** (293 §1). The acquisition is the last thing that can have
    // waited, and a body that runs on a path last proved before that wait is the whole finding.
    verify()
    // ⚑ **`await`ed, so a body that returns a promise is HELD rather than silently let go.** The
    // signature admits one now — `() => T | Promise<T>` — and the alternative was a call that
    // type-checks, reads correctly and releases the lock before its own body has finished.
    return await fn()
  } finally {
    releaseLock(fd, lockPath)
  }
}

/**
 * Ensure the app-owned provider home exists as a **real directory at mode `0700`**
 * under a validated `managedRoot` (015 lifecycle; hardened in 027, fixing 023 P1-H).
 * Fail-closed:
 *  - **rejects a path escape or a symlink component** that would redirect out of the root;
 *  - **rejects an existing regular file** (or any non-directory) at the home path;
 *  - **enforces `0700`** on an existing home directory (repairs a `0755`);
 *  - takes a **per-home cross-process lock** around the leaf create/repair so concurrent
 *    provisioning of the same home can't race.
 *
 * The `<userData>/provider-homes/default/<profile>/…` path *derivation* (`default` is the app's
 * `HOME_FOLDER`) is the app/orchestration layer's job; this accepts an absolute `providerHome` and
 * provisions it safely. It never falls back to a personal provider home.
 *
 * ⚠️ **Asynchronous since 243, and only because of the lock.** Everything above the leaf — the
 * containment check, the ancestor walk, the symlink refusals — is the same synchronous code it was;
 * what changed is that waiting for another process's leaf create no longer stops this one's thread.
 * See {@link withProviderHomeLock}.
 *
 * 🔴 **…and since 293 the check SURVIVES that wait.** Until then the walk proved a path and the lock
 * then used the string again, so a process that renamed the validated ancestor away and left a
 * symlink in its place got a "managed" home materialized outside the managed root — with the Codex
 * credential copied into it on the next step. See {@link TrustedDir} for the reproduction and for
 * what pinning can and cannot do.
 */
export async function provisionProviderHome(
  managedRoot: string,
  providerHome: string,
): Promise<void> {
  const home = resolve(providerHome)
  // ⛔ **The walk, KEPT** (293 §1). It is the same containment check it always was; what changed is
  // that its result outlives the `await` below instead of being a fact about a moment.
  const ancestry = trustProviderHomeAncestry(managedRoot, providerHome, { create: true })
  try {
    // The home leaf: create if missing, else REQUIRE a real directory and repair 0700.
    await withProviderHomeLock(
      home,
      () => {
        ancestry.verify()
        const stat = lstatOrNull(home)
        if (!stat) {
          mkdirSync(home, { mode: 0o700 })
          // ⚠️ **And again on the far side of the create.** Node has no `mkdirat`, so this is made
          // by path; verifying both sides means an escape needs the ancestor swapped AND swapped
          // back inside those microseconds. Named in {@link TrustedDir} rather than claimed away.
          ancestry.verify()
          return
        }
        if (stat.isSymbolicLink()) {
          throw new Error(`providerHome is a symlink: ${home}`)
        }
        if (!stat.isDirectory()) {
          throw new Error(`providerHome exists but is not a directory: ${home}`)
        }
        if ((stat.mode & 0o777) !== 0o700) {
          chmodSync(home, 0o700) // repair a loose mode (e.g. 0755) — fail-closed to owner-only
          // On Windows a mode is only a read-only flag: there the folder is kept to its owner by the
          // access list it inherits from the person's own profile folder.
        }
      },
      { verify: ancestry.verify },
    )
  } finally {
    ancestry.release()
  }
}

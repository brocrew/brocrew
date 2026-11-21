import { lstatSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'

/**
 * Validate each path component from a real anchor before removal: `lstat`, refuse symlinks
 * and non-directories, pin dev+ino and recheck beside the operation. Validate children during
 * recursive traversal too; a prefix allowed for ordinary path resolution is not deletion
 * authority across an alias into another tree.
 *
 * Provider-home ancestry helpers are not a substitute: they can create paths while checking,
 * skip leaf-kind validation and do not cover descendants. Their releasable descriptor handle
 * also has a different contract from a deletion verdict.
 *
 * Node lacks descriptor-relative `openat`/`unlinkat` tree operations. Fresh anchor pins and
 * per-entry checks narrow the check-to-syscall race but cannot eliminate it.
 */

/**
 * What a target is allowed to be:
 *
 *  - `file` — a regular file, and nothing else passes;
 *  - `dir` — a real directory; a symlink to one is refused;
 *  - `unlink` — remove the NAME, whatever is behind it, as long as it is not a directory.
 *
 * `unlink` is why there is no `any`. Unlinking a name never touches what it points at, so it is the
 * only honest verb for the things in a `userData` directory whose kind is not ours to predict: the
 * gate's unix socket, the three `Singleton*` symlinks Chromium leaves while live, and a lock
 * remnant that a `rename` may have left as either. A symlink is removable only where the manifest
 * expects an unlink-only leaf, and the target is never followed.
 */
const KINDS = Object.freeze(['file', 'dir', 'unlink'])

/** Is `parent` a strict ancestor of `child`? Separator-appended, so `/a/b` is not under `/a/bc`. */
export function isAncestor(parent, child) {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/**
 * The directories a reset must never be pointed at, whatever the caller typed: `$HOME` and every
 * ancestor of it (so `--dir ~` and `--dir /Users` are refused), the conventional and redirected
 * provider homes BroBot reads for adoption, and the repository itself. Compared by what each
 * folder IS, never by how it is spelled ({@link whereItStands}).
 */
export function forbiddenRoots({ home = homedir(), env = process.env, repoRoot = null } = {}) {
  const roots = [
    // `inside: false` is the load-bearing exception. The userData this reset exists to empty is
    // `~/Library/Application Support/@brobot2/desktop`, INSIDE `$HOME` by construction, so refusing
    // everything under `$HOME` would refuse every ordinary run.
    { path: home, why: 'your home directory', inside: false },
    { path: join(home, '.codex'), why: "the machine's conventional Codex home", inside: true },
    { path: join(home, '.claude'), why: "the machine's conventional Claude home", inside: true },
  ]
  if (typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim() !== '') {
    roots.push({
      path: env.CODEX_HOME,
      why: 'the CODEX_HOME this shell redirects to',
      inside: true,
    })
  }
  if (typeof env.CLAUDE_CONFIG_DIR === 'string' && env.CLAUDE_CONFIG_DIR.trim() !== '') {
    roots.push({
      path: env.CLAUDE_CONFIG_DIR,
      why: 'the CLAUDE_CONFIG_DIR this shell redirects to',
      inside: true,
    })
  }
  if (typeof repoRoot === 'string' && repoRoot !== '') {
    roots.push({
      path: repoRoot,
      why: 'the BroBot2 checkout this script is running from',
      inside: true,
    })
  }
  return roots
}

/**
 * `realpathSync.native`, because plain `realpathSync` resolves symlinks but does NOT canonicalise
 * CASE. macOS's default APFS volume is case-insensitive, so two spellings name one directory and
 * the JS version hands back whichever it was given. Measured (home folder shown as `alex`):
 *
 * ```
 *   realpathSync('/users/alex')         → '/users/alex'
 *   realpathSync.native('/users/alex')  → '/Users/alex'
 *   lstat(both).ino                     → equal
 * ```
 *
 * The `.native` binding asks the kernel and returns the spelling on disk. The forbidden-root checks
 * compare what the folders ARE ({@link whereItStands}), since even the on-disk spelling is not
 * unique: a firmlink's comes back as given. The spelling still matters where a spelling is all
 * there is to compare: a running BroBot is looked for by the target's spellings in its command line
 * (`brobot-liveness.mjs`), and every refusal names the folder by it.
 *
 * Three answers: `null` is "not there", `undefined` is "could not ask", and a string is an answer.
 * A caller that collapses the last two drops a guard on its own bad day.
 */
function realOrNull(path) {
  try {
    return realpathSync.native(path)
  } catch (error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? null : undefined
  }
}

/**
 * What is at a path, by what it IS: its device and inode, the same whichever spelling, link or
 * firmlink reaches it. `bigint`, because a Windows file id is 64 bits and a Number would round two
 * folders into one. Three answers as in {@link realOrNull}: `null` is "nothing is there",
 * `undefined` is "could not ask".
 */
export function identityOf(path) {
  try {
    const stat = statSync(path, { bigint: true })
    return `${String(stat.dev)}:${String(stat.ino)}`
  } catch (error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? null : undefined
  }
}

/**
 * macOS's second spelling of a folder. The Data volume, which holds every folder a person owns, is
 * mounted at `/System/Volumes/Data`, and firmlinks show its folders at `/` as well: `/Users/alex`
 * IS `/System/Volumes/Data/Users/alex`, and `realpath(3)` returns either spelling as given.
 *
 * Their parents are not all one folder: walking up from `/Users/alex` never meets
 * `/System/Volumes/Data` (`/Users/..` is `/`, which is not it). So a folder's parents are read in
 * both spellings.
 */
const DATA_VOLUME = '/System/Volumes/Data'

/**
 * Every spelling of one real path that names the same thing — itself, and macOS's other one when
 * that is the same thing too — or `undefined` when the other could not be asked about on a machine
 * that has one. Checked, never assumed: elsewhere there is no other spelling.
 */
function spellingsOf(real) {
  const here = identityOf(real)
  if (here === null || here === undefined) return [real]
  const other = isAncestor(DATA_VOLUME, real)
    ? real.slice(DATA_VOLUME.length)
    : join(DATA_VOLUME, real)
  const there = identityOf(other)
  if (there === here) return [real, other]
  return there === undefined && identityOf(DATA_VOLUME) !== null ? undefined : [real]
}

/**
 * The identities of every folder above a path, in each of its spellings — or `undefined` when one
 * of them could not be read, so nothing above it is known.
 */
function foldersAbove(path) {
  const spellings = spellingsOf(path)
  if (spellings === undefined) return undefined
  const above = new Set()
  for (const spelling of spellings) {
    for (let at = dirname(spelling); ; at = dirname(at)) {
      const folder = identityOf(at)
      if (folder === undefined) return undefined
      if (folder !== null) above.add(folder)
      if (dirname(at) === at) break
    }
  }
  return above
}

/**
 * Where one path stands against a folder, asked of what they ARE: `'is'` that folder, `'inside'`
 * it, `'holds'` it, `null` for none of those, or `undefined` when a folder it needed could not be
 * read.
 *
 * Never by spelling: a link, a case, or the firmlink spelling `/System/Volumes/Data/...` names the
 * same folder, and a string comparison passed each as some other folder (`trustedAnchor` trusted
 * the Data-volume spelling of `~`, `~/.claude` and `~/.codex`, and folders inside, holding, or
 * linked to them).
 *
 * Both paths are real ({@link realOrNull}). `path` need not exist yet, since a folder above it can
 * still be `folder` (`'inside'`), and `folder` need not be a folder: whatever holds it, holds it.
 */
export function whereItStands(path, folder) {
  const it = identityOf(path)
  const that = identityOf(folder)
  if (it === undefined || that === undefined) return undefined
  if (that === null) return null
  if (it === that) return 'is'
  // 'holds' before 'inside': where folders loop (a folder mounted again inside itself) one path can
  // be both, and holding is the one that takes the folder with it.
  if (it !== null) {
    const aboveThat = foldersAbove(folder)
    if (aboveThat === undefined) return undefined
    if (aboveThat.has(it)) return 'holds'
  }
  const aboveIt = foldersAbove(path)
  if (aboveIt === undefined) return undefined
  return aboveIt.has(that) ? 'inside' : null
}

/**
 * Establish the one directory everything else is proved against.
 *
 * @returns {{ kind: 'trusted', lexical: string, real: string, dev: number, ino: number }
 *   | { kind: 'absent', lexical: string } | { kind: 'refused', why: string }}
 */
export function trustedAnchor(target, options = {}) {
  const {
    home = homedir(),
    cwd = process.cwd(),
    env = process.env,
    repoRoot = null,
    // A seam, so the ownership rule is a rule and not a comment: `process.getuid()` is the only value
    // in this module a test cannot vary. It defaults to the real one on every call the script makes.
    uid = typeof process.getuid === 'function' ? process.getuid() : null,
  } = options
  if (typeof target !== 'string' || target.trim() === '') {
    return { kind: 'refused', why: 'the target is empty' }
  }
  if (!isAbsolute(target)) {
    return { kind: 'refused', why: `the target is not absolute: ${target}` }
  }
  const lexical = normalize(resolve(target))
  const real = realOrNull(lexical)
  if (real === null) return { kind: 'absent', lexical }
  if (real === undefined) {
    return { kind: 'refused', why: `the target could not be resolved: ${lexical}` }
  }
  if (real === sep) return { kind: 'refused', why: 'the target resolves to the filesystem root' }

  for (const forbidden of forbiddenRoots({ home, env, repoRoot })) {
    const forbiddenReal = realOrNull(forbidden.path)
    // `undefined` is a root we could not resolve, and dropping it drops the guard. `null` is the
    // ordinary case: a machine with no `~/.codex` has nothing there to protect.
    if (forbiddenReal === undefined) {
      return { kind: 'refused', why: `${forbidden.why} (${forbidden.path}) could not be resolved` }
    }
    if (forbiddenReal === null) continue
    // Asked of the folders, never of their spellings ({@link whereItStands}): `realpath(3)` returns
    // the firmlink spelling as given, so `/System/Volumes/Data/Users/alex/.claude` would not equal
    // `~/.claude` as a string and a reset anchored on it would be trusted.
    const where = whereItStands(real, forbiddenReal)
    // Could not compare: the guard is not dropped, per the rule above.
    if (where === undefined) {
      return {
        kind: 'refused',
        why: `${real} could not be compared with ${forbidden.why} (${forbiddenReal})`,
      }
    }
    if (where === 'is') {
      return { kind: 'refused', why: `${real} is ${forbidden.why}` }
    }
    // The second direction: a target that CONTAINS a never-touch root would take it with the tree.
    // `~/Library` is not `$HOME`, and removing it removes the conventional homes underneath.
    if (where === 'holds') {
      return { kind: 'refused', why: `${real} contains ${forbidden.why} (${forbiddenReal})` }
    }
    // And the third: `--dir ~/.claude/projects` is not `~/.claude` and does not contain it, it is
    // INSIDE it, which is what a person reaching for a subdirectory types. Per-root:
    // {@link forbiddenRoots} says why being inside `$HOME` is the ordinary case, not a refusal.
    if (forbidden.inside && where === 'inside') {
      return { kind: 'refused', why: `${real} is inside ${forbidden.why} (${forbiddenReal})` }
    }
  }
  const cwdReal = realOrNull(cwd)
  if (cwdReal === undefined) {
    return { kind: 'refused', why: `the working directory (${cwd}) could not be resolved` }
  }
  // The working directory too, by what it is: typed one way and run from the other.
  const fromHere = cwdReal === null ? null : whereItStands(real, cwdReal)
  if (fromHere === undefined) {
    return {
      kind: 'refused',
      why: `${real} could not be compared with the directory this was run from (${cwdReal})`,
    }
  }
  if (fromHere === 'is' || fromHere === 'holds') {
    return { kind: 'refused', why: `${real} is, or contains, the directory this was run from` }
  }

  let pin
  try {
    pin = lstatSync(real)
  } catch (error) {
    return { kind: 'refused', why: `the target could not be stat'd: ${error?.code ?? 'unknown'}` }
  }
  if (!pin.isDirectory()) return { kind: 'refused', why: `${real} is not a directory` }
  if (uid !== null && pin.uid !== uid) {
    return {
      kind: 'refused',
      why: `${real} is owned by uid ${String(pin.uid)}, not by uid ${String(uid)}`,
    }
  }
  return { kind: 'trusted', lexical, real, dev: pin.dev, ino: pin.ino }
}

/**
 * Walk from a trusted anchor to a leaf, `lstat`-ing every component on the way.
 *
 * No component may be a symlink and none may be a non-directory, which is why the return carries a
 * real `parent` the caller may then trust.
 *
 * @returns {{ kind: 'ok', parent: string, path: string } | { kind: 'absent', path: string }
 *   | { kind: 'refused', why: string }}
 */
export function descend(anchor, relative) {
  const parts = String(relative)
    .split('/')
    .filter((part) => part !== '')
  if (parts.length === 0) return { kind: 'refused', why: 'an empty relative path' }
  if (parts.some((part) => part === '.' || part === '..')) {
    return { kind: 'refused', why: `a relative path with a traversal segment: ${relative}` }
  }
  let dir = anchor
  for (const part of parts.slice(0, -1)) {
    const next = join(dir, part)
    let stat
    try {
      stat = lstatSync(next)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        return { kind: 'absent', path: join(anchor, ...parts) }
      }
      return { kind: 'refused', why: `${next} could not be stat'd: ${error?.code ?? 'unknown'}` }
    }
    if (stat.isSymbolicLink()) {
      return { kind: 'refused', why: `${next} is a symlink, and this walk never follows one` }
    }
    if (!stat.isDirectory()) return { kind: 'refused', why: `${next} is not a directory` }
    dir = next
  }
  return { kind: 'ok', parent: dir, path: join(dir, parts[parts.length - 1]) }
}

/**
 * The predicate: may this exact path be removed?
 *
 * @returns {{ kind: 'ok', path: string, parent: string, stat: import('node:fs').Stats }
 *   | { kind: 'absent', path: string } | { kind: 'refused', why: string }}
 */
export function mayRemove(
  anchor,
  relative,
  { expect = null, uid = typeof process.getuid === 'function' ? process.getuid() : null } = {},
) {
  // No default kind: a caller that forgot the option should get a refusal, not a guess. There is no
  // safe default, and the call site that forgot to think is the one that would get it.
  if (!KINDS.includes(expect)) {
    return {
      kind: 'refused',
      why: `${relative}: every removal must name what it expects to find (${KINDS.join(', ')}), and this one said ${JSON.stringify(expect)}`,
    }
  }
  // The anchor pin, re-read: the one directory every path below is proved against has to still be
  // that directory.
  const anchorNow = anchorIdentity(anchor.real)
  if (anchorNow === null || anchorNow.dev !== anchor.dev || anchorNow.ino !== anchor.ino) {
    return {
      kind: 'refused',
      why: `${anchor.real} is no longer the directory that was checked — it was replaced under the walk`,
    }
  }
  const walked = descend(anchor.real, relative)
  if (walked.kind !== 'ok') return walked

  let stat
  try {
    stat = lstatSync(walked.path)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { kind: 'absent', path: walked.path }
    }
    return {
      kind: 'refused',
      why: `${walked.path} could not be stat'd: ${error?.code ?? 'unknown'}`,
    }
  }
  const actual = stat.isSymbolicLink()
    ? 'symlink'
    : stat.isDirectory()
      ? 'dir'
      : stat.isFile()
        ? 'file'
        : stat.isSocket()
          ? 'socket'
          : 'something else'
  const allowed = expect === 'unlink' ? actual !== 'dir' : actual === expect
  if (!allowed) {
    return {
      kind: 'refused',
      why: `${walked.path} is a ${actual} where the manifest expects ${expect}`,
    }
  }
  if (uid !== null && stat.uid !== uid) {
    return {
      kind: 'refused',
      why: `${walked.path} is owned by uid ${String(stat.uid)}, not by uid ${String(uid)}`,
    }
  }
  // The parent is walked, so it is already real by construction; this asks the filesystem to agree,
  // which catches a component swapped inside the walk.
  const parentReal = realOrNull(walked.parent)
  if (parentReal !== walked.parent) {
    return {
      kind: 'refused',
      why: `${walked.parent} resolves to ${String(parentReal)} — it changed under the walk`,
    }
  }
  return { kind: 'ok', path: walked.path, parent: walked.parent, stat }
}

/** The anchor's own identity, or `null` if it cannot be read at all. */
function anchorIdentity(path) {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() ? { dev: stat.dev, ino: stat.ino } : null
  } catch {
    // Gone, or unreadable: either way it is not the directory that was checked.
    return null
  }
}

/** Has the thing we checked stayed the thing we checked? Taken beside the syscall, never before it. */
function stillTheSame(path, pinned) {
  let now
  try {
    now = lstatSync(path)
  } catch (error) {
    // `ENOENT` is the only failure that means it went away. A bare catch would let `EACCES`, `ELOOP`
    // and `EIO` read as "gone", which the caller would report as a clean removal of something still on
    // disk.
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'gone'
    return 'unreadable'
  }
  return now.dev === pinned.dev && now.ino === pinned.ino ? 'same' : 'replaced'
}

/**
 * Remove one checked path, recursing with `lstat` per entry and never through a symlink.
 *
 * `rmSync({ recursive: true })` would traverse correctly, but it will not count, keep, or recheck:
 * this reset has to report what it removed, keep an exact `auth.json` inside a tree it is otherwise
 * emptying, and refuse a directory that turned into something else mid-walk.
 *
 * `apply: false` is the dry run and it is the SAME walk: every `lstat`, every `keep`, every entry
 * the real run would reach, except no `unlink` or `rmdir`. A dry run that cannot READ a directory
 * reports that.
 *
 * The counts a dry run prints equal a real run's only when every removal succeeds: the call that
 * would throw `EACCES` is never made, so that entry and every ancestor directory count as removed.
 * There is no honest way to close that (`access(W_OK)` would be a second predicate that can be
 * wrong the other way); the real run reports what happened under `left in place` and in its exit
 * code.
 *
 * @param {string} path a path {@link mayRemove} has already returned `ok` for
 * @param {import('node:fs').Stats} pinned that call's `stat`
 * @param {{ keep?: (relative: string) => boolean, removeRoot?: boolean, apply?: boolean }} [options]
 * @returns {{ files: number, directories: number, links: number, bytes: number, kept: string[], failed: {path:string,why:string}[], rootRemoved: boolean }}
 */
export function removeChecked(path, pinned, options = {}) {
  const keep = options.keep ?? (() => false)
  const removeRoot = options.removeRoot ?? true
  const apply = options.apply ?? true
  const out = {
    files: 0,
    directories: 0,
    links: 0,
    bytes: 0,
    kept: [],
    failed: [],
    rootRemoved: false,
  }
  const same = stillTheSame(path, pinned)
  if (same === 'gone') return out
  if (same !== 'same') {
    out.failed.push({
      path,
      why:
        same === 'replaced'
          ? 'it was replaced between the check and the removal'
          : 'it could not be read between the check and the removal',
    })
    return out
  }

  const unlink = (target, counter) => {
    try {
      if (apply) unlinkSync(target)
      out[counter] += 1
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return true
      out.failed.push({ path: target, why: `unlink failed: ${error?.code ?? 'unknown'}` })
      return false
    }
  }

  /** @returns {boolean} whether the directory ended up empty enough to remove */
  const walk = (dir, relative) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      out.failed.push({ path: dir, why: `could not be listed: ${error?.code ?? 'unknown'}` })
      return false
    }
    let emptied = true
    for (const entry of entries) {
      const child = join(dir, entry.name)
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (keep(childRelative)) {
        out.kept.push(childRelative)
        emptied = false
        continue
      }
      let stat
      try {
        stat = lstatSync(child)
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        out.failed.push({ path: child, why: `could not be stat'd: ${error?.code ?? 'unknown'}` })
        emptied = false
        continue
      }
      // A symlink is UNLINKED, never descended into: this keeps a link planted inside the tree from
      // turning a bounded removal into an unbounded one.
      if (stat.isSymbolicLink()) {
        if (unlink(child, 'links')) continue
        emptied = false
        continue
      }
      if (stat.isDirectory()) {
        const childEmptied = walk(child, childRelative)
        if (!childEmptied) {
          emptied = false
          continue
        }
        try {
          if (apply) rmdirSync(child)
          out.directories += 1
        } catch (error) {
          out.failed.push({ path: child, why: `rmdir failed: ${error?.code ?? 'unknown'}` })
          emptied = false
        }
        continue
      }
      // Counted only on success, so a file listed under "left in place" is not also inside the
      // "removed · N MB" total.
      if (unlink(child, 'files')) {
        if (stat.isFile()) out.bytes += stat.size
      } else {
        emptied = false
      }
    }
    return emptied
  }

  if (pinned.isDirectory()) {
    const emptied = walk(path, '')
    if (emptied && removeRoot && stillTheSame(path, pinned) === 'same') {
      try {
        if (apply) rmdirSync(path)
        out.directories += 1
        out.rootRemoved = true
      } catch (error) {
        out.failed.push({ path, why: `rmdir failed: ${error?.code ?? 'unknown'}` })
      }
    }
    return out
  }
  if (unlink(path, pinned.isSymbolicLink() ? 'links' : 'files')) {
    out.rootRemoved = true
    if (pinned.isFile()) out.bytes += pinned.size
  }
  return out
}

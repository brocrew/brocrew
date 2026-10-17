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
 * What a target is allowed to be, and the vocabulary is deliberately three words.
 *
 *  - `file` — a regular file, and nothing else passes;
 *  - `dir` — a real directory. ⛔ A symlink to one is refused, which is the whole of `170` §3;
 *  - `unlink` — ⚑ **remove the NAME, whatever is behind it, as long as it is not a directory.**
 *
 * ⚠️ **`unlink` is not a loophole and it is why there is no `any`.** Unlinking a name never touches
 * what it points at, so it is the only honest verb for the four things in a `userData` directory
 * whose kind is not ours to predict: the gate's unix SOCKET, the three `Singleton*` symlinks
 * Chromium leaves while it is live, and a lock remnant that a `rename` may have left as either.
 * `350` asks for exactly this: *"A symlink is removable only where the manifest explicitly expects
 * an unlink-only leaf … never resolve/follow the target."*
 */
const KINDS = Object.freeze(['file', 'dir', 'unlink'])

/** Is `parent` a strict ancestor of `child`? Separator-appended, so `/a/b` is not under `/a/bc`. */
export function isAncestor(parent, child) {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/**
 * The directories a reset must never be pointed at, whatever the caller typed.
 *
 * ⚠️ **`$HOME` and every ancestor of it**, so `--dir ~` and `--dir /Users` are refused rather than
 * merely unlikely. ⚠️ **The conventional and redirected provider homes**, which `350` §3 lists as
 * never-touch and which BroBot reads for adoption. ⚠️ **The repository**, so a mistyped `--dir .`
 * cannot delete the checkout. ⛔ The list is compared by what each folder IS, never by how it is
 * spelled ({@link whereItStands}): a symlink to `$HOME` is `$HOME`, and so is its other spelling.
 */
export function forbiddenRoots({ home = homedir(), env = process.env, repoRoot = null } = {}) {
  const roots = [
    // ⚑ **`inside: false` here, and it is the load-bearing exception.** The userData this reset
    // exists to empty is `~/Library/Application Support/@brobot2/desktop` — INSIDE `$HOME` by
    // construction. A rule that refused everything under it would refuse every ordinary run,
    // which is exactly how the third-direction check below was written before a review caught it.
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
 * 🔴 **`realpathSync.native`, and the difference is a home directory** (351 review).
 *
 * ⛔ **JavaScript's `realpathSync` resolves symlinks and does NOT canonicalise CASE.** macOS's
 * default APFS volume is case-INSENSITIVE, so two spellings name one directory and this function
 * hands back whichever one it was given. Measured on a Mac (home folder shown as `alex`):
 *
 * ```
 *   realpathSync('/users/alex')         → '/users/alex'
 *   realpathSync.native('/users/alex')  → '/Users/alex'
 *   lstat(both).ino                     → equal
 * ```
 *
 * ⛔ **Every forbidden-root check below was a string comparison**, so with the JS version
 * `--dir /users/alex` resolved to a string that equalled no forbidden root, the anchor was
 * TRUSTED, and the next thing the reset did was empty a home directory. The `.native` binding asks
 * the kernel and returns the spelling on disk. ⚑ **W4.124 · those checks now compare what the
 * folders ARE** ({@link whereItStands}), because even the spelling on disk is not one spelling: a
 * firmlink's comes back exactly as given. ⚠️ The spelling on disk still matters where a spelling is
 * all there is to compare: a running BroBot is looked for by the target's spellings in its command
 * line (`brobot-liveness.mjs`), and every refusal names the folder by it.
 *
 * ⚠️ Three answers, not two: `null` is *it is not there*, `undefined` is *I could not ask*, and a
 * string is an answer. A caller that collapses the last two drops a guard on its own bad day.
 */
function realOrNull(path) {
  try {
    return realpathSync.native(path)
  } catch (error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? null : undefined
  }
}

/**
 * 🔴 **W4.124 · what is at a path, by what it IS: its device and inode** — the same whichever
 * spelling, link or firmlink reaches it. ⚠️ `bigint`, because a Windows file id is 64 bits and a
 * Number would round two folders into one. ⚠️ {@link realOrNull}'s three answers: `null` is *nothing
 * is there*, `undefined` is *I could not ask*.
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
 * ⚑ **W4.124 · macOS's second spelling of a folder.** The Data volume, which holds every folder a
 * person owns, is mounted at `/System/Volumes/Data`, and firmlinks show its folders at `/` as well:
 * `/Users/alex` IS `/System/Volumes/Data/Users/alex` — one folder, and `realpath(3)` hands back
 * either spelling exactly as it was given (measured).
 *
 * ⛔ **Their parents are not all one folder.** `/System/Volumes/Data` holds every folder on that
 * volume, yet walking up from `/Users/alex` never meets it: `/Users/..` is `/`, and `/` is not
 * `/System/Volumes/Data` (both measured). So a folder's parents are read in both spellings.
 */
const DATA_VOLUME = '/System/Volumes/Data'

/**
 * Every spelling of one real path that names the same thing — itself, and macOS's other one when
 * that is the same thing too — or `undefined` when the other could not be asked about on a machine
 * that has one. ⚠️ Checked, never assumed: elsewhere there is no other spelling.
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
 * 🔴 **W4.124 · where one path stands against a folder, asked of what they ARE**: `'is'` that
 * folder, `'inside'` it, `'holds'` it — `null`, none of those — or `undefined`: a folder it needed
 * could not be read, so it cannot say.
 *
 * ⛔ **Never by how they are spelled.** A link, a case, or the firmlink spelling `/System/Volumes/Data/…`
 * names the same folder, and a string comparison passed each as some other folder: measured,
 * `trustedAnchor` trusted the Data-volume spelling of `~`, `~/.claude` and `~/.codex`, of a folder
 * inside one, of one holding one, and of a link to one.
 *
 * ⚑ Both paths are real ({@link realOrNull}). `path` need not exist yet — a folder above it can still
 * be `folder`, which is `'inside'` — and `folder` need not be a folder: whatever holds it, holds it.
 */
export function whereItStands(path, folder) {
  const it = identityOf(path)
  const that = identityOf(folder)
  if (it === undefined || that === undefined) return undefined
  if (that === null) return null
  if (it === that) return 'is'
  // ⚠️ 'holds' before 'inside': where folders loop — a folder mounted again inside itself — one
  // path can be both, and holding is the one that takes the folder with it.
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
 * 🔴 **Establish the one directory everything else is proved against.**
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
    // ⚑ **A seam, so the ownership rule is a rule and not a comment.** `process.getuid()` is the
    // only value in this module a test cannot vary, and a check nothing can turn red is a check
    // nobody knows is still there. It defaults to the real one on every call the script makes.
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
    // ⛔ **`undefined` is a root we could not resolve, and dropping it drops the guard** (351
    // review). `null` is different and is the ordinary case: a machine with no `~/.codex` has
    // nothing there to protect.
    if (forbiddenReal === undefined) {
      return { kind: 'refused', why: `${forbidden.why} (${forbidden.path}) could not be resolved` }
    }
    if (forbiddenReal === null) continue
    // 🔴 **W4.124 · asked of the folders, never of their spellings** ({@link whereItStands}).
    // ⛔ These were string comparisons of real paths, and `realpath(3)` returns the firmlink
    // spelling as given: `/System/Volumes/Data/Users/alex/.claude` was not `~/.claude`, and a
    // reset anchored on it was TRUSTED (measured, with a scratch home).
    const where = whereItStands(real, forbiddenReal)
    // ⛔ Could not compare: the guard is not dropped — the line above's own rule.
    if (where === undefined) {
      return {
        kind: 'refused',
        why: `${real} could not be compared with ${forbidden.why} (${forbiddenReal})`,
      }
    }
    if (where === 'is') {
      return { kind: 'refused', why: `${real} is ${forbidden.why}` }
    }
    // ⛔ The second direction: a target that CONTAINS a never-touch root would take it with the
    // tree. `~/Library` is not `$HOME` and removing it removes the conventional homes underneath.
    if (where === 'holds') {
      return { kind: 'refused', why: `${real} contains ${forbidden.why} (${forbiddenReal})` }
    }
    // ⛔ **And the third, which the first draft did not have** (351 review). `--dir ~/.claude/projects`
    // is not `~/.claude` and does not contain it — it is INSIDE it, which is the spelling a person
    // reaching for a subdirectory actually types. ⚠️ Per-root: {@link forbiddenRoots} says why
    // being inside `$HOME` is the ordinary case rather than a refusal.
    if (forbidden.inside && where === 'inside') {
      return { kind: 'refused', why: `${real} is inside ${forbidden.why} (${forbiddenReal})` }
    }
  }
  const cwdReal = realOrNull(cwd)
  if (cwdReal === undefined) {
    return { kind: 'refused', why: `the working directory (${cwd}) could not be resolved` }
  }
  // ⚑ **W4.124 · the working directory too, by what it is** — typed one way and run from the other.
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
 * ⛔ **No component may be a symlink and none may be a non-directory.** That is the check `170` §3
 * cost us, and it is why the return carries a real `parent` the caller may then trust.
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
 * 🔴 **The predicate**: may this exact path be removed?
 *
 * @returns {{ kind: 'ok', path: string, parent: string, stat: import('node:fs').Stats }
 *   | { kind: 'absent', path: string } | { kind: 'refused', why: string }}
 */
export function mayRemove(
  anchor,
  relative,
  { expect = null, uid = typeof process.getuid === 'function' ? process.getuid() : null } = {},
) {
  // ⛔ **No default kind.** `expect` used to default to `'any'`, a word that left the vocabulary
  // when `unlink` replaced it — so a caller that forgot the option got a refusal reading
  // `unknown expected kind: any`, which is true and says nothing. There is no safe default here:
  // whatever one is chosen, the call site that forgot to think is the one that gets it.
  if (!KINDS.includes(expect)) {
    return {
      kind: 'refused',
      why: `${relative}: every removal must name what it expects to find (${KINDS.join(', ')}), and this one said ${JSON.stringify(expect)}`,
    }
  }
  // ⛔ **The anchor pin, re-read** (351 review). `trustedAnchor` collected `dev` and `ino` and
  // nothing used them, so the header's claim that the window is "narrowed by taking the anchor's
  // dev+ino pin immediately before the walk" described code that did not exist. It does now: the
  // one directory every path below is proved against has to still be that directory.
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
  // ⚠️ The parent is walked, so it is already real by construction — this asks the filesystem to
  // agree, which is the one check that catches a component swapped inside the walk.
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
    // ⛔ **`ENOENT` is the only failure that means it went away** (351 review). A bare catch made
    // `EACCES`, `ELOOP` and `EIO` all read as "gone", which the caller then reports as a clean
    // removal of something still on disk — the one outcome this whole design exists to prevent.
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'gone'
    return 'unreadable'
  }
  return now.dev === pinned.dev && now.ino === pinned.ino ? 'same' : 'replaced'
}

/**
 * 🔴 **Remove one checked path**, recursing with `lstat` per entry and never through a symlink.
 *
 * ⚠️ **`rmSync({ recursive: true })` would do the traversal correctly** — Node's own implementation
 * `lstat`s and unlinks rather than following. What it will not do is COUNT, keep, or recheck: this
 * reset has to report what it removed (`351` §3.2), has to keep an exact `auth.json` inside a tree
 * it is otherwise emptying, and has to refuse a directory that turned into something else while it
 * was being walked.
 *
 * ⚑ **`apply: false` is the dry run, and it is the SAME walk.** A preview computed a different way
 * from the removal is a preview of a different program; this one takes every `lstat`, follows every
 * `keep`, and reaches every entry the real run would reach — it simply does not call `unlink` or
 * `rmdir`. A dry run that cannot READ a directory reports that, because the `readdir` and the
 * `lstat` really happen.
 *
 * ⚠️ **The bound on that, stated rather than claimed away** (352 review). The counts a dry run
 * prints are the counts a real run produces **when every removal succeeds**. The one thing this walk
 * cannot learn without doing it is whether an `unlink` or an `rmdir` would be REFUSED: with
 * `apply: false` the call that would throw `EACCES` is never made, so the entry counts as removed
 * and so does every ancestor directory above it. ⛔ **There is no honest way to close that** — a
 * permission model is not a prediction, and asking `access(W_OK)` would be a second predicate that
 * can be wrong in the other direction. The real run says what actually happened, under `left in
 * place` and in its exit code; the preview is a preview.
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
      // ⛔ A symlink is UNLINKED, never descended into. This is the line that keeps a link planted
      // inside the tree from turning a bounded removal into an unbounded one.
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
      // ⚠️ Counted only on success, so a file listed under "left in place" is not also inside the
      // "removed · N MB" total (351 review).
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

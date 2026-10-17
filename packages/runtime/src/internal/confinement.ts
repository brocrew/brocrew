import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { realResolve } from './real-path'

/**
 * The path predicates the Claude memory LABEL rests on — and, until `726` and `728`, the refusal and
 * the allowances that gave this module its name.
 *
 * The app adds no file- or folder-access scan above provider permissions. A path-bearing tool call reaches the provider's flow and selected `ask` or `auto` mode without app-specific protected-root, handed-file or placement refusals.
 *
 * ⚑ **What stays, and why none of it is a restriction by location:**
 *
 *  - ⛔ **not the allowances any more** — `728` (R93) removed plan mode's plan-file exemption and the
 *    memory directory's cardless write, and `writesOnlyWithin` and `plansDirectory` with them: the
 *    CLI's own engine decides both, as it does in the CLI.
 *  - {@link attestedRoot}, {@link namesATarget} and {@link isWithin} — what `ClaudeMemoryStore`'s
 *    label stands on: which file in the provider's memory a row names.
 */

/**
 * The two directories a Claude session is keyed on: its working directory and its own provider home
 * (where the CLI writes its plan documents and its memory).
 *
 * ⚑ **`726` · R92: nothing here restricts a path any more.** It carried the app's protected roots,
 * the files a conversation was handed and the folder the CLI said it was running in, for the scan
 * this module no longer has.
 */
export interface SessionConfinement {
  /** The session's working directory. */
  readonly cwd: string
  /** This session's own provider home — the plans and memory directories live under it. */
  readonly providerHome: string
}

/**
 * Is `path` at or inside `root`?
 *
 * ⚠️ **Equality counts here**: the root itself is inside it. (Until `726` · R92 two other copies of
 * this idiom — `asset-protocol.ts` and `generated-image.ts`, each asking "is this file inside the
 * directory I serve" — deliberately left equality out; R92 removed both of those roots.)
 *
 * `relative` rather than `startsWith`, for the reason every copy recorded: `/a/b-evil` has `/a/b`
 * as a string prefix and is somewhere else entirely.
 *
 * ⚠️ **Exported since 330, and what travels with it is the COMPARISON and not a ruling.**
 * `ClaudeMemoryStore` asks the same question of the same kind of pair — does this resolved path fall
 * inside this resolved root — to decide what a row SAYS rather than what a call may do.
 * ⛔ **`writesOnlyWithin` (removed by `728`) was deliberately not what it reused**: that predicate
 * carried one caller's policy (refuse on any stray string, grant only on a declared target, a scan
 * cap), and a label built on it would have inherited a permission's fail-closed edges as claims
 * about memory.
 */
export function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Longest string worth testing as a path. macOS `PATH_MAX` is 1024; this is generous of it. */
const LONGEST_PLAUSIBLE_PATH = 4096

/**
 * The fields the pinned SDK declares as a file tool's TARGET — the only ones whose value may be what
 * a label names ({@link namesATarget}; 188 §1, from 168 L3).
 *
 * ⛔ **Read as a list of what a TARGET is, never of what a path is not**: a field name is evidence
 * that something IS a path, never evidence that it is not. (Until `728` it was also the grant list of
 * the memory and plan-file allowances R93 removed.)
 *
 * ⚑ **Taken from the schemas, not from the shape of the calls we happen to have seen**:
 * `sdk-tools.d.ts:842`/`:860`/`:878` name `file_path` for `Read`, `Edit` and `Write`, and `:985`
 * names `notebook_path` for `NotebookEdit`. `MultiEdit` carries `file_path` beside an `edits` array
 * whose members declare no path at all.
 *
 * ⚠️ **A tool that grows a new path field is simply not labelled until it is added here** — a row
 * that says nothing, never one that names the wrong file.
 */
const PATH_FIELDS = new Set(['file_path', 'notebook_path'])

/**
 * Could this string name a file at all?
 *
 * ⛔ **A NEWLINE IS A LEGAL FILENAME and this predicate used to say it was not** (153, from 152
 * §4.5). The comment here claimed *"a newline or a NUL cannot appear in a path any process on this
 * machine can open"*, and half of that is false: POSIX and macOS forbid exactly two bytes in a
 * filename, **NUL and `/`**, and everything else — including `\n` — is a name the filesystem will
 * accept and Node will happily open. `touch $'/tmp/out\n'` creates a file; `writeFileSync` writes
 * to it. So `\n` was a **skip that a path could be spelled into** — the shape of hole that mattered
 * most in `writesOnlyWithin`, where a skip was read as a permission (removed by `728`).
 *
 * What remains here is only what is true:
 *
 *  - **NUL** — `fs` throws `ERR_INVALID_ARG_VALUE` before it reaches a syscall, so no string
 *    carrying one names a file that any tool could write to or read from.
 *  - **Longer than {@link LONGEST_PLAUSIBLE_PATH}** — `PATH_MAX` is 1024 on macOS and 4096 on
 *    Linux, so a string four times the larger of those is refused by the kernel with
 *    `ENAMETOOLONG` whatever it is pointed at. This bound is also what keeps an ordinary plan
 *    document — thousands of characters of prose — from being resolved as a path on every write.
 *  - **Empty** — resolves to the directory it is measured against and names no file in it.
 *
 * ⚠️ **Both remaining exclusions are safe, and that is the property the newline one did not
 * have.** A string that cannot name a file cannot be the file a write lands on, so a label that
 * skips it names nothing false. (It was also safe for the protected-roots scan `726` · R92 removed,
 * and for the allowances `728` · R93 removed.)
 */
function canNameAFile(value: string): boolean {
  return value.length > 0 && value.length <= LONGEST_PLAUSIBLE_PATH && !value.includes('\0')
}

/**
 * 🔴 **The ONE test for "this string is a file the call would write to"** (197 §1, from 190 H1).
 *
 * ## ⛔ What was wrong: one fact, two classifiers
 *
 * `memory-bound.ts` asked `isAbsolute(node)` and nothing else, while this module asked
 * {@link canNameAFile} — and a string can satisfy one and fail the other. The PM's input was an
 * ordinary schema-valid `Write`:
 *
 * ```ts
 * { file_path: "<providerHome>/memory/big.md", content: "/" + "x".repeat(MEMORY_FILE_CAP + 1) }
 * ```
 *
 * Prose. It just happens to start with `/` and run past {@link LONGEST_PLAUSIBLE_PATH}. So:
 *
 *  - **Confinement**: too long to name a file ⇒ it is CONTENT, skipped, and the write is granted on
 *    the strength of its real `file_path`. Correct.
 *  - **The byte bound**: absolute ⇒ it is a PATH ⇒ it spends **zero payload bytes**, and it was then
 *    counted as a TARGET whose `statSync` fails `ENAMETOOLONG` and whose size was read as `0`.
 *
 * ⛔ **Both comparisons therefore saw no proposed growth, the hook returned `allow`, and 256 KiB of
 * content went to disk with no card.** Repeating it walks past the 64 MiB aggregate the same way.
 *
 * ⚑ **This is 168 L3/L4 inverted.** There, counting content as a path CARDED a valid write; here,
 * counting content as a path DEFEATED the bound. ⚠️ **One fact must have one classifier**, and this
 * is it: every caller that has to decide *"is this string the file being written?"* calls this
 * function, so the grant and the accounting cannot answer differently about the same string.
 *
 * The three conditions, and why each is part of the same question:
 *
 *  - **{@link canNameAFile}** — a string the kernel would refuse (`ENAMETOOLONG`, a NUL) is not a
 *    file anything can write to, whatever it starts with.
 *  - **Absolute** — the pinned SDK requires it in the tool schema itself (*"must be absolute, not
 *    relative"*, `sdk-tools.d.ts:876`), so a relative string in one of these inputs is never the
 *    file that gets written.
 *  - **Under a declared {@link PATH_FIELDS} key** — 168 L3, closed by 188 for the grant and left
 *    open here: a `content` string that happens to be absolute is not the call's target, and
 *    treating it as one is exactly how the bound above was defeated.
 *
 * ⚠️ **One caller now** — `ClaudeMemoryStore`'s label: a string this returns `false` for is CONTENT,
 * and the row names no file for it. (Until `728` it had two more: `writesOnlyWithin` would not grant
 * on such a string and the memory bound charged it; R93 removed both.)
 */
export function namesATarget(value: string, key: string | null): boolean {
  return canNameAFile(value) && isAbsolute(value) && key !== null && PATH_FIELDS.has(key)
}

/**
 * 🔴 **An exemption root the filesystem still agrees with** (170 §1, from 168 H2).
 *
 * ⛔ **`O_NOFOLLOW` protects only the FINAL path component, and every guard written since 153 reads
 * as if it protected the path.** `writesOnlyWithin` (removed by `728`) resolved its root and compared
 * both spellings, which stops a symlink *inside* the root from carrying a write out of it — and does
 * nothing at all about the root ITSELF being one, because a redirected root passes both halves by
 * definition. `<providerHome>/memory -> <providerHome>` therefore turned 166's cardless memory
 * exemption into an exemption for the whole profile home: `Write <providerHome>/memory/CLAUDE.md` is
 * lexically inside `memory` and really inside `memory`'s real root, so the hook returned `allow` and
 * the profile's own instructions were overwritten with no card.
 *
 * ⚠️ **A root link pointing OUT of the home is not attested either** — its last component
 * redirects, which is the rule below. (Until `726` the protected-roots scan also refused such a
 * path first; R92 removed the scan, and this is what still keeps the ALLOWANCE from following it.)
 *
 * **The rule: the parents are resolved and kept, and the root's own last component may not
 * redirect.** The parents must resolve — a provider home under macOS's `/var/folders/…` really lives
 * at `/private/var/folders/…`, and refusing that would refuse every temporary home this app makes.
 * The last component is the one the agent can replace, because the directory holding it is the one
 * directory this app hands it.
 *
 * ⛔ **`null` means NOT ATTESTED, and every caller must read it as "no exemption"** — a card, or a
 * plan refusal. An exemption is a grant, and a grant nobody can attest is not one.
 *
 * ⚑ **A root that does not exist yet IS attested**, which is the ordinary first case for both
 * callers: {@link realResolve} climbs to the deepest existing ancestor, so a `memory/` the agent has
 * never written resolves to exactly the derived path and its first write is still cardless.
 *
 * ⛔ **…and a root that is a DANGLING link was attested too, until 183** (182 H1). It is the same
 * ambiguity one level up from the one {@link realResolve} fixes: `memory -> <home>/CLAUDE.md` with
 * the target not yet created threw from `realpathSync` exactly like a `memory/` that was never
 * made, so the climb answered with the derived path, the two sides agreed, and the exemption was
 * granted for a directory that is really a link to the profile's instruction file. **The two cases
 * are now told apart where they differ — at the filesystem — and only one of them is attested.**
 */
export function attestedRoot(derived: string): string | null {
  const absolute = resolve(derived)
  const parent = realResolve(dirname(absolute))
  const real = realResolve(absolute)
  if (parent === null || real === null) return null
  return real === join(parent, basename(absolute)) ? absolute : null
}

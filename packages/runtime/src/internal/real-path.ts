import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * 🔴 **`realpath` as far down as the path HONESTLY goes — or an admission that it does not** (183,
 * from 182 H1).
 *
 * A plain `realpathSync` throws for a file that does not exist yet, and a `Write` names one every
 * time — so falling back to the lexical path would let a symlinked *directory* carry a write out of
 * the directory an allowance covers (the plan file's, the memory's). Climbing to the deepest
 * existing ancestor resolves the symlinks that are actually there and leaves the rest alone.
 *
 * ## ⛔ …and for five dispatches the climb treated EVERY failure as an absent component
 *
 * That is right for an ordinary missing child and wrong for **a symlink whose target is missing**.
 * `<cwd>/bait -> <userData>/not-created-yet` throws from `realpathSync` exactly like a file that is
 * not there, so the climb re-appended `bait` to the workspace and answered with the WORKSPACE
 * spelling. Every guard downstream then compared the wrong path: `bait` is inside the session's own
 * cwd under both spellings, so it was `own`, and the protected root was never consulted. `open` with
 * `O_CREAT` follows the link and creates the file under `userData`. (The protected root went with
 * `726` · R92; the same climb still decides the plan-file and memory allowances.)
 *
 * ⚠️ **`O_NOFOLLOW` is not the answer and 170 is why: it guards only the FINAL component.** The
 * same bait one level in (`<home>/memory/x -> <home>/CLAUDE.md`) turned 166's cardless memory
 * exemption into a cardless write to the profile's own instruction file.
 *
 * ## The rule, and it is the whole fix
 *
 * ⛔ **Only the filesystem may say "absent", and it says it with `lstat`.** `lstat` does not follow
 * the final component, so it answers the one question that matters — *"is this component something
 * we could not follow, or is it genuinely not there?"* — without resolving anything.
 *
 *  - **`ENOENT` / `ENOTDIR` / `ENAMETOOLONG`** — nothing is there and nothing could be. Climb,
 *    exactly as before. **This is the case the function exists for.**
 *  - **anything else** — the component IS there and we could not follow it: a dangling symlink, a
 *    symlink loop (`ELOOP`), a directory we may not traverse. ⛔ **`null`. There is no answer to
 *    give, and inventing the lexical one is what the finding was.**
 *
 * ⛔ **`ENAMETOOLONG` belongs with the absences, and 183's own live run is what proved it.** The
 * first version of this rule kept only `ENOENT`/`ENOTDIR` and refused everything else, which reads
 * well and broke two real things within the hour: `smoke:ui` step `41` denied an ordinary 272-byte
 * `Bash` command, and step `66` put a card on every memory write. **`NAME_MAX` is 255**, every guard
 * here resolves EVERY string in a tool input against a root, and ordinary prose — a shell command, a
 * paragraph of memory — is one component far past that. ⚑ **The reasoning that admits it is the same
 * one `canNameAFile` already uses for its own bound**: a name the kernel refuses outright cannot
 * exist, so it cannot be a symlink, so there is nothing to follow and nothing to be wrong about.
 *
 * ⚑ **This is not 153's path resolver by another name.** 153 refused to make a guard follow links
 * and decide about their targets; that refusal stands. The question here is only *"could this be
 * resolved at all"*, which `lstat` answers without following anything.
 *
 * ⚠️ **The false positive, named rather than discovered later** (this module's neighbours document
 * theirs the same way). A path inside a directory this process may not traverse resolves to `null`
 * and gets no allowance from any caller, even though nothing about it is a link. It is the
 * fail-closed direction, it is visible in the message the caller produces, and the alternative is
 * the lexical guess this function was written to stop making.
 */
export function realResolve(path: string): string | null {
  const absolute = resolve(path)
  let head = absolute
  const tail: string[] = []
  for (;;) {
    try {
      // `native` is the filesystem identity spelling: unlike the portable wrapper it does not
      // preserve a caller's case/normalisation alias on APFS before downstream containment compares.
      return join(realpathSync.native(head), ...[...tail].reverse())
    } catch {
      // ⛔ `realpathSync` failing says nothing about WHY. Ask the filesystem the narrow question.
      if (!isAbsentComponent(head)) return null
      const parent = dirname(head)
      // The root itself did not resolve — nothing on this path exists; the lexical answer is all
      // there is, and it is still compared against roots resolved the same way.
      if (parent === head) return absolute
      tail.push(basename(head))
      head = parent
    }
  }
}

/**
 * Is this component genuinely not there — and could nothing be?
 *
 * ⚠️ **`lstat`, never `stat`** — `stat` follows the final component, so a dangling symlink would
 * report `ENOENT` through it and the distinction this whole module turns on would be erased.
 */
function isAbsentComponent(path: string): boolean {
  try {
    lstatSync(path)
    // It is there. Something that EXISTS made `realpathSync` fail, which is not an absence.
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // ⛔ `ENAMETOOLONG` is an absence the kernel will never let anyone fill — see the note above,
    // and 183's step 41/66 for what leaving it out of this list actually costs.
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'
  }
}

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { realResolve } from '../src/internal/real-path'

/**
 * ⛔ **The one predicate 182 H1 turns on, tested on its own** (183).
 *
 * Every guard in `confinement.ts` and the Codex `sqlite_home` attestation compare paths this
 * function produced, and for five dispatches it answered the same way for two situations that are
 * not the same: **a component that is not there** and **a component that is there and cannot be
 * followed**. The tests below are the two halves of that distinction and nothing else — the
 * consequences live beside the guards that draw them.
 *
 * ⚠️ **Built on disk, in a decoy tree under `tmpdir()`.** The question is what the filesystem says;
 * a test with invented paths would be testing string arithmetic.
 */
describe('realResolve — absent is not dangling (183, from 182 H1)', () => {
  let root: string

  beforeEach(() => {
    // Resolved, because macOS hides `tmpdir()` behind `/var` → `/private/var` and every expectation
    // below is a path equality.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-realpath-')))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('⚑ the case it exists for: a file that does not exist YET still resolves', () => {
    // The positive that every negative below has to be read against. A `Write` names a file that is
    // not there every single time, so a predicate that refused this would refuse the ordinary call.
    expect(realResolve(join(root, 'brand-new.txt'))).toBe(join(root, 'brand-new.txt'))
    // …at depth, and through a directory that IS a link: the climb resolves what is really there
    // and leaves the rest verbatim.
    const real = join(root, 'real')
    mkdirSync(real)
    symlinkSync(real, join(root, 'via'))
    expect(realResolve(join(root, 'via', 'a', 'b.txt'))).toBe(join(real, 'a', 'b.txt'))
  })

  it('⛔ …and a DANGLING link is not that case — it answers `null`', () => {
    // `realpathSync` throws ENOENT here exactly as it does for `brand-new.txt` above, which is the
    // whole finding: the failure was read as "nothing is there" when a link IS there.
    symlinkSync(join(root, 'not-created-yet'), join(root, 'bait'))
    expect(realResolve(join(root, 'bait'))).toBeNull()
    // ⚠️ **`lstat`, not `stat`.** `stat` follows the final component and would report ENOENT for
    // the link too, erasing the distinction this function is made of.
    expect(realResolve(join(root, 'not-created-yet'))).toBe(join(root, 'not-created-yet'))
  })

  it('⛔ …one level in as well, which is where `O_NOFOLLOW` stops looking (170)', () => {
    // `O_NOFOLLOW` guards the FINAL component. 182 H1's second exploit puts the bait one level up
    // from the file being written, so the climb is the only thing that can see it.
    symlinkSync(join(root, 'not-created-yet'), join(root, 'bait'))
    expect(realResolve(join(root, 'bait', 'child.txt'))).toBeNull()
    expect(realResolve(join(root, 'bait', 'a', 'deep', 'child.txt'))).toBeNull()
  })

  it('a symlink LOOP is unresolvable too, and for the same reason', () => {
    // ELOOP rather than ENOENT, and the old climb treated every failure alike — so a loop also
    // canonicalized to its lexical spelling.
    symlinkSync(join(root, 'b'), join(root, 'a'))
    symlinkSync(join(root, 'a'), join(root, 'b'))
    expect(realResolve(join(root, 'a'))).toBeNull()
  })

  it('a link whose target EXISTS resolves to the target — nothing here refuses links', () => {
    // ⚠️ Non-vacuity for all three negatives above: this function did not become "refuse symlinks".
    // 153's refusal to make a guard follow links and judge their targets is untouched; the only
    // question asked is whether there is an answer at all.
    const target = join(root, 'target')
    mkdirSync(target)
    writeFileSync(join(target, 'file.txt'), 'x')
    symlinkSync(target, join(root, 'link'))
    expect(realResolve(join(root, 'link', 'file.txt'))).toBe(join(target, 'file.txt'))
    expect(realResolve(join(root, 'link', 'not-yet.txt'))).toBe(join(target, 'not-yet.txt'))
  })

  it('a component under a plain FILE is absent, not unresolvable (ENOTDIR)', () => {
    // The other error the kernel gives for "there is nothing at this path". A regular file with a
    // path spelled through it is a missing child, not something we failed to follow.
    writeFileSync(join(root, 'plain.txt'), 'x')
    expect(realResolve(join(root, 'plain.txt', 'child'))).toBe(join(root, 'plain.txt', 'child'))
  })

  it('⛔ a component past `NAME_MAX` is an ABSENCE — 183 shipped this wrong and measured it', () => {
    // ⛔ **The first version of this predicate refused everything that was not `ENOENT`/`ENOTDIR`,
    // and `smoke:ui` failed twice within the hour.** `NAME_MAX` is 255 on macOS, and every guard
    // built on this function resolves EVERY STRING in a tool input against a root — so ordinary
    // prose becomes one component far past that:
    //
    //   * step 41 — a 272-byte `Bash` command resolved to `<cwd>/echo "padding …"`, `lstat` said
    //     `ENAMETOOLONG`, the path was called unplaceable and the hook DENIED the call. No card
    //     ever appeared.
    //   * step 66 — a paragraph of memory `content` did the same, and every memory write got a card
    //     instead of the exemption.
    //
    // ⚑ **The reasoning that admits it is `canNameAFile`'s own**: a name the kernel refuses cannot
    // exist, so it cannot be a symlink, so there is nothing to follow and nothing to be wrong about.
    const longName = 'x'.repeat(300)
    expect(realResolve(join(root, longName))).toBe(join(root, longName))
    // …the two live shapes, verbatim.
    const command = `echo "${'padding '.repeat(30)}" && echo BROBOT2-TAIL-071`
    expect(command.length).toBeGreaterThan(255)
    expect(realResolve(join(root, command))).toBe(join(root, command))
    // ⚠️ **Non-vacuity, in the same test**: this is a widening of what counts as absent, and it must
    // not have widened past the two dangling cases above.
    symlinkSync(join(root, 'nowhere'), join(root, 'bait'))
    expect(realResolve(join(root, 'bait'))).toBeNull()
  })
})

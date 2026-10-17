import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFreshFile } from '@brobot2/runtime'
import { keepResource, resourcesRoot, sha256Hex } from '../src/main/resources/resources'

/**
 * # 🔴 521 · nothing is built outside the tree
 *
 * ⛔ **The resource writer (`main/resources/resources.ts`, `keepResource`) rests on two facts about
 * this machine**, and a safety sentence with no test is a comment (standing rule 5):
 *
 *  - `mkdirSync(…, { recursive: true })` BUILDS through a component that is a symlink, so a
 *    directory can be made outside the tree before any byte is written. ⚑ That is why the writer
 *    makes the `<sha256>` folder on its own and asks it with `lstat` before anything is renamed
 *    into it: a symlink standing there would carry the rename out of the tree.
 *  - {@link createFreshFile} refuses a symlinked LEAF, so the bytes themselves cannot be written
 *    through a planted link. ⚑ That is why the temporary name is made with it. `O_CREAT | O_EXCL`
 *    alone refuses one on macOS and Linux; on Windows, which has no `O_NOFOLLOW`, it follows the
 *    link, and the helper looks at the name before and after the create.
 *
 * ⚠️ **Neither is about this app's code.** If a Node upgrade changed either answer, the reasoning
 * behind the writer's order would need re-taking, and this is what would say so.
 *
 * ## 🔴 What each section measures
 *
 *  - **§0 · the platform, measured** — the two facts above, and the dangling-link one beside them.
 *  - **§1 · the writer's own guard** — a link standing at `<root>/<sha256>` is refused before
 *    anything is renamed into it, so nothing is built through it; a real folder there is written
 *    into, in the same sample.
 *  - **§2 · never replaced** — something else already at the kept name is refused, and its bytes are
 *    left as they were; the same bytes there is a success.
 *
 * ⚑ **Every refusal below is paired with an admission in the SAME sample** — `517`'s rule: a guard
 * that refuses everything passes a suite that only ever plants hazards.
 */
describe('521 · nothing is built outside the tree', () => {
  let userData: string
  let outside: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-521-'))
    outside = mkdtempSync(join(tmpdir(), 'brobot2-521-outside-'))
  })

  afterEach(() => {
    for (const dir of [userData, outside]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⚑ A file as `readOfferedResource` hands it on: its bytes, their hash and its own name. */
  const anOffer = (
    text: string,
    name = 'r.md',
  ): { bytes: Buffer; sha256: string; name: string } => {
    const bytes = Buffer.from(text, 'utf8')
    return { bytes, sha256: sha256Hex(bytes), name }
  }

  describe('§0 · the platform, measured — the two facts the writer’s order rests on', () => {
    it('🔴 `mkdirSync` recursive BUILDS through a component that is a symlink to somewhere outside', () => {
      const tree = join(userData, 'plain-tree')
      mkdirSync(tree, { recursive: true })
      symlinkSync(outside, join(tree, 'proj'))

      mkdirSync(join(tree, 'proj', '.staging'), { recursive: true, mode: 0o700 })

      // ⛔ **This is the hole.** It is not a read outside the tree; it is a directory made there.
      expect(existsSync(join(outside, '.staging'))).toBe(true)
    })

    it('⚑ …and the LEAF was already closed — the writer’s create refuses a symlink, on every system', () => {
      const tree = join(userData, 'leaf-tree')
      mkdirSync(tree, { recursive: true })
      symlinkSync(join(outside, 'stolen.md'), join(tree, 'leaf.md'))

      expect(() => closeSync(createFreshFile(join(tree, 'leaf.md')))).toThrow(/EEXIST/)
      // ⚑ **No byte left the tree**, which is why the guard is not in front of the write.
      expect(existsSync(join(outside, 'stolen.md'))).toBe(false)
    })

    it('⚠️ a DANGLING symlink component makes recursive `mkdir` raise rather than build', () => {
      const tree = join(userData, 'dangling-tree')
      mkdirSync(tree, { recursive: true })
      symlinkSync(join(userData, 'nowhere-at-all'), join(tree, 'proj'))

      expect(() => mkdirSync(join(tree, 'proj', '.staging'), { recursive: true })).toThrow(/ENOENT/)
      expect(existsSync(join(userData, 'nowhere-at-all'))).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the writer refuses a link standing where it would build
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the writer refuses a link standing where it would build', () => {
    /**
     * 🔴 **The measured hole, on the path the code walks.** `keepResource` makes `<root>/<sha256>`
     * with a non-recursive `mkdir`, which answers `EEXIST` about a symlink standing there and says
     * nothing else — and a rename into it would then land wherever the link points. ⛔ So the writer
     * asks the name with `lstat` before anything is renamed into it.
     */
    it('🔴 a symlinked hash directory — nothing is built through the link, and a real folder there is written into', () => {
      const root = resourcesRoot(userData)
      const offered = anOffer('the answer\n')
      mkdirSync(root, { recursive: true })
      symlinkSync(outside, join(root, offered.sha256))
      // ⚑ **Premise asserted**: the name is the one the writer builds, spelled as it spells it, so a
      // lexical guard admits it and only the `lstat` can see the link.
      expect(lstatSync(join(root, offered.sha256)).isSymbolicLink()).toBe(true)

      expect(keepResource(root, offered)).toEqual({
        ok: false,
        problem: 'something-else-is-at-that-name',
      })
      // ⛔ **Nothing was built through the link** — neither the kept file nor its temporary name.
      expect(readdirSync(outside)).toEqual([])
      expect(readdirSync(root)).toEqual([offered.sha256])

      // ⚠️ **A link that points INSIDE the tree is refused too**: the writer does not resolve what
      // stands at the name, it refuses any link there — so the control below is a real folder, which
      // is trapped the same way (the `mkdir` answers `EEXIST` about it as it did about the link).
      unlinkSync(join(root, offered.sha256))
      mkdirSync(join(root, 'real-folder'))
      symlinkSync(join(root, 'real-folder'), join(root, offered.sha256))
      expect(keepResource(root, offered)).toEqual({
        ok: false,
        problem: 'something-else-is-at-that-name',
      })
      expect(readdirSync(join(root, 'real-folder'))).toEqual([])

      // ⚑ **THE CONTROL, in the same sample** — the same name, the same bytes, a real folder already
      // standing there. A guard that refused everything would pass every assertion above.
      unlinkSync(join(root, offered.sha256))
      mkdirSync(join(root, offered.sha256), { mode: 0o700 })
      expect(keepResource(root, offered)).toEqual({ ok: true })
      expect(readFileSync(join(root, offered.sha256, offered.name), 'utf8')).toBe('the answer\n')
      expect(readdirSync(outside)).toEqual([])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · something else at the kept name is never replaced
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · something else at the kept name is never replaced', () => {
    /**
     * ⚠️ **A file this app did not write is exactly what a person has to look at** — and a kept
     * file is an identity other rows point at, so replacing it would change what they name.
     */
    it('⚠️ a kept name somebody else is standing on is refused, and its bytes are untouched', () => {
      const root = resourcesRoot(userData)
      const offered = anOffer('the answer\n')
      mkdirSync(join(root, offered.sha256), { recursive: true })
      writeFileSync(join(root, offered.sha256, offered.name), 'somebody else wrote this\n')

      expect(keepResource(root, offered)).toEqual({
        ok: false,
        problem: 'something-else-is-at-that-name',
      })
      // ⛔ Not adopted and not overwritten, and no temporary file left beside it.
      expect(readFileSync(join(root, offered.sha256, offered.name), 'utf8')).toBe(
        'somebody else wrote this\n',
      )
      expect(readdirSync(root)).toEqual([offered.sha256])

      // ⚑ **The control, one fact over**: the SAME bytes already at that name is a success — two
      // replies handing in one file keep one copy.
      writeFileSync(join(root, offered.sha256, offered.name), 'the answer\n')
      expect(keepResource(root, offered)).toEqual({ ok: true })
      expect(readdirSync(join(root, offered.sha256))).toEqual([offered.name])
    })
  })
})

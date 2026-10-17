import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkSessionCwd, resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { brobotWorkspace } from '../src/main/runtime/workspace'

/**
 * **A project that is more than a slug** (Slice 3 · 339, HO-005 §4).
 *
 * `project` has held `id`, `slug`, `display_name` and `created_at` since 204, and one row is
 * pinned — so the app has had a project since Slice 2 and no way for a person to see it. This
 * dispatch gives it the two facts HO-005 §4 names: what it IS, and WHERE its work happens.
 *
 * ⛔ **The `cwd` is the one with a rule, and the rule is not a new one.** HO-005 criterion 11 asks
 * that a folder be *"resolved and verified in OUR code, before create"*, with an error that **names
 * the directory** — because `303` C measured what happens otherwise: with the directory renamed,
 * Codex reported `ENOENT` about the **executable** and Claude returned a healthy-looking resumed
 * handle and then fatalled about a **libc mismatch**. Neither names the cause.
 *
 * ⚑ **The brief asked for a function this dispatch owns and exports. It already existed.**
 * `checkSessionCwd` (076 §3, 071) resolves, verifies and names the directory, and asked of a project
 * folder the predicate is identical term for term. 169 §1 — one rule spelled in two places drifts —
 * is the whole argument for not writing a second one. ⛔ **What it was missing is the half criterion
 * 11 actually needs**, which §"the half that was missing" below measures: `statSync` answers about
 * the PARENT's permissions, so a directory no process can enter passed as `ok`.
 *
 * ⚑ **D-016 · the project is gone** — `host.project`, `saveProject` and their IPC doors went with
 * projects, and the `project` table went with the migration history (the database is ONE migration,
 * `0000_the_tree.sql`), so the sections that read and wrote the row, and the one that measured the
 * migration adding its two columns, went too. ⚑ What stays is what still exists: the half of the cwd
 * rule every launch still asks.
 */

describe('339 · the half of the cwd rule that was missing (HO-005 criterion 11)', () => {
  let userData: string
  let root: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-project-cwd-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-project-folders-'))
  })
  afterEach(() => {
    // ⚠️ Modes back to something removable before the tree goes, or `rmSync` cannot descend.
    for (const name of ['locked', 'x-only', 'r-only']) {
      try {
        chmodSync(join(root, name), 0o700)
      } catch {
        // The case never made it that far. Nothing to restore.
      }
    }
    rmSync(userData, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  /**
   * 🔴 **`statSync` answers about the PARENT, so "it exists and is a directory" is not "a child can
   * be started in it".**
   *
   * The three modes are the measurement this rule was written from, run here rather than quoted:
   * `000` and `444` both pass `statSync().isDirectory()` and both fail `spawn`, and `111` — search
   * without read — passes both. ⛔ **That last row is why the probe is `X_OK` and not `R_OK`**:
   * asking for readability would refuse a directory that works.
   */
  it('🔴 a directory that exists but cannot be entered is refused, and spawn agrees', () => {
    const cases = [
      { name: 'locked', mode: 0o000, entered: false },
      { name: 'x-only', mode: 0o111, entered: true },
      { name: 'r-only', mode: 0o444, entered: false },
    ]
    for (const { name, mode, entered } of cases) {
      const path = join(root, name)
      mkdirSync(path)
      chmodSync(path, mode)

      // The ground truth: does a real child process start in it? This is the fact the verdict has
      // to agree with, and it is measured rather than assumed — 303 C's whole finding is that the
      // error a provider gives for this names the wrong thing.
      const spawned = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { cwd: path })
      expect(spawned.error === undefined, `${name} spawn`).toBe(entered)

      const verdict = checkSessionCwd(path)
      expect(verdict.ok, `${name} verdict`).toBe(entered)
      if (!verdict.ok) {
        // ⛔ **Criterion 11's actual requirement: our own error, NAMING THE DIRECTORY.** Codex's is
        // `ENOENT` about the executable; Node's here is `spawnSync <path-to-node> EACCES`, which
        // also names the binary about a fault in the folder.
        expect(verdict.reason, `${name} names the folder`).toContain(path)
        expect(verdict.reason).toContain('cannot be opened')
      }
    }
  })

  it('⚑ and the launch refuses it with exactly the same sentence', () => {
    const path = join(root, 'locked')
    mkdirSync(path)
    chmodSync(path, 0o000)
    const verdict = checkSessionCwd(path)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    let thrown = ''
    try {
      resolveSessionCwd(userData, 'sess_1', path)
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error)
    }
    // One rule, one wording — 076 §3's rule, extended to the clause 339 added rather than beside it.
    expect(thrown).toBe(verdict.reason)
  })

  it('⚠️ an ordinary directory still passes — the pair that stops this being a check that always says no', () => {
    const path = join(root, 'ordinary')
    mkdirSync(path)
    const verdict = checkSessionCwd(path)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('unreachable')
    expect(verdict.path).toBe(path)
    // …and so does the app's own workspace. A reachability clause that refused it would make the
    // default folder unchoosable. (`726` · R92: it was the one carve-out inside `userData` (071)
    // until the wall around `userData` went; it is now simply a directory, like any other.)
    const workspace = brobotWorkspace(userData)
    mkdirSync(workspace, { recursive: true })
    expect(checkSessionCwd(workspace).ok).toBe(true)
  })
})

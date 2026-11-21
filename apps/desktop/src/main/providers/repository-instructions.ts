import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isHomeOrAbove, realPath, safeStat } from './instruction-io'

export const AGENTS_OVERRIDE_FILENAME = 'AGENTS.override.md'

export const AGENTS_FILENAME = 'AGENTS.md'

/**
 * The repository's `AGENTS` layer, selected the way Codex selects it, bridged to Claude only.
 *
 * Repositories may supply `AGENTS.md` without `CLAUDE.md`; this bridges their conventions to Claude
 * so both providers receive the same repository rules. It is not a Claude setting source: enabling
 * one imports permissions, hooks, environment mutation and plugins (a `SessionStart` shell hook ran
 * before any prompt), and no Claude setting source reads `AGENTS.md` anyway.
 *
 * The bytes go to Claude only. Codex already reads `AGENTS.md` natively, so its branch of this reader
 * injects nothing of these bytes (it composes only this conversation's own text). Two routes are
 * declined for different reasons:
 *
 *  - Codex's global override serves every project from one home, so project A's conventions would be
 *    read by project B. That is a confidentiality cost, enforced by this branch.
 *  - `developerInstructions` is per-thread and leaks nothing, but costs context next to a native
 *    read, and a Codex `collaborationMode` update takes precedence over it, so a layer sent there
 *    stops applying at the first mode switch (see `collaborationModeFor` in
 *    `packages/runtime/src/codex/codex-runtime.ts`).
 *
 * Selection: the nearest `.git` root through the cwd (no root means the cwd alone), at most one file
 * per directory (`AGENTS.override.md` before `AGENTS.md`), outermost to innermost. An override that
 * exists shadows the ordinary file in its directory even when empty, because the candidate is chosen
 * before its content is read; the profile-global pair is first-nonempty instead.
 *
 * The home boundary is the same one {@link projectInstructionChain} uses: a `.git` at or above
 * `$HOME` must not open a door that walk closed, so the result is filtered by {@link isHomeOrAbove}
 * on both spellings and a home that is itself a repository yields only the directories below it.
 */
export function repositoryConventionChain(cwd: string, home = homedir()): string[] {
  const homeResolved = resolve(home)
  const homeReal = realPath(homeResolved)
  const start = resolve(cwd)
  // 1. The nearest `.git`, walking up. `.git` is a FILE in a worktree and a directory in an
  // ordinary clone, so existence is the test rather than `isDirectory()`: a directory test finds no
  // root inside a worktree.
  let root: string | null = null
  for (let dir = start; ;) {
    if (safeStat(join(dir, '.git')) !== null) {
      root = dir
      break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // 2. Root through cwd, outermost first — or the cwd alone when there is no root.
  const chain: string[] = []
  for (let dir = start; ;) {
    chain.unshift(dir)
    if (root === null || dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return chain.filter(
    (dir) => !isHomeOrAbove(dir, homeResolved) && !isHomeOrAbove(realPath(dir), homeReal),
  )
}

export function conventionFileIn(dir: string): string | null {
  const override = join(dir, AGENTS_OVERRIDE_FILENAME)
  if (safeStat(override) !== null) return override
  const plain = join(dir, AGENTS_FILENAME)
  return safeStat(plain) === null ? null : plain
}

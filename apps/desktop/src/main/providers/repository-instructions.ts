import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isHomeOrAbove, realPath, safeStat } from './instruction-io'

export const AGENTS_OVERRIDE_FILENAME = 'AGENTS.override.md'

export const AGENTS_FILENAME = 'AGENTS.md'

export function repositoryConventionChain(cwd: string, home = homedir()): string[] {
  const homeResolved = resolve(home)
  const homeReal = realPath(homeResolved)
  const start = resolve(cwd)
  // 1 · The nearest `.git`, walking up. ⚠️ `.git` is a FILE in a worktree and a directory in an
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
  // 2 · Root through cwd, outermost first — or the cwd alone when there is no root.
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

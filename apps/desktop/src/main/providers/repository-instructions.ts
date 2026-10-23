import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isHomeOrAbove, realPath, safeStat } from './instruction-io'

export const AGENTS_OVERRIDE_FILENAME = 'AGENTS.override.md'

export const AGENTS_FILENAME = 'AGENTS.md'

/**
 * 🔴 **The repository's `AGENTS` layer, selected the way CODEX selects it** (377, HO-012 §3 as
 * `377` §6 cites it; the mechanism is `364` §2.3 and the price is its `+1.5 days / 5 places`).
 *
 * ## ⛔ Why this walk exists at all, and why it is Claude-only
 *
 * Repositories such as `sample-api` may supply `AGENTS.md` without `CLAUDE.md`.
 * Bridge their conventions to Claude so both providers receive the same repository rules.
 *
 * ⛔ **The fix is a Claude-only bridge and NOT a Claude setting source.** `364` §2.2 exercised a real
 * `2.1.218` child across `[]`, User, Project and User+Project: enabling a source imports permissions,
 * hooks, environment mutation, plugins and helpers — and **both harmless `SessionStart` shell hooks
 * executed before any prompt or model turn.** ⚑ It also would not have worked: no Claude setting
 * source reads `AGENTS.md` at all.
 *
 * ⛔ **And the bytes go to Claude ONLY.** `364` §2.3: putting repo bytes in Codex's global override,
 * or echoing them through `developerInstructions`, gives Codex the copy AND its own native read.
 * **The Codex branch of this reader still injects nothing, and that is a DECISION rather than an
 * omission** — of these bytes: what it does compose is this conversation's own text (D-024 · R1),
 * which no file carries. The two routes it declines are declined for different reasons, and `555`
 * split them because one word was carrying both:
 *
 *  - ⛔ **The global override is the one with a confidentiality cost.** One home serves every
 *    project, so project A's conventions written there are read by project B. ⚑ **That half is a
 *    rail** — it is this branch, in code — and it is what HO-062 §2 means by *safety lives in the
 *    rails*.
 *  - ⚠️ **`developerInstructions` is per-thread and leaks across nothing.** Its cost is context on
 *    every request, next to a native read that already happened. 🔴 **And since `552` it carries a
 *    second one**: a Codex `collaborationMode` update takes precedence over that field, so a layer
 *    sent there stops being in force from the first mode switch onwards — see `collaborationModeFor`
 *    in `packages/runtime/src/codex/codex-runtime.ts`. ⛔ **Whoever reaches for this route reaches
 *    for a layer with a stated limit**, which is the fact this paragraph exists to hand them.
 *
 * ⚑ **`HO-023` §7 called an arrangement like this one *"a safety property, not a convenience"* and
 * HO-062 §2 withdrew that framing.** The word is spent here on the half that is enforced by a
 * branch, and not on the half that is a judgement about cost.
 *
 * ## ⚑ The selection, exactly
 *
 * Nearest `.git` root through the cwd; **no root means the cwd alone**; at most ONE file per
 * directory — `AGENTS.override.md` before `AGENTS.md` — outermost to innermost. ⚠️ **An override
 * that EXISTS shadows the ordinary file in its directory even when it is empty**, which is `362`
 * §2's live matrix: at a project directory the candidate is chosen before its content is read. That
 * is the opposite of the profile-global pair, which is first-NONEMPTY, and conflating the two is the
 * mistake `362` was written to correct.
 *
 * ## 🔒 The home boundary is the SAME one, and it had to be said out loud
 *
 * ⛔ **A `.git` at or above `$HOME` does not open a door 170 §4 closed.** That dispatch found BroBot
 * reading a person's own `~/.claude/CLAUDE.md` into a prompt through a symlinked parent, and
 * {@link projectInstructionChain} has excluded home and its ancestors ever since. A second walk with
 * its own stopping rule would be a second answer to the same question — so this one is filtered by
 * {@link isHomeOrAbove} on both spellings, and a person whose home is itself a repository gets the
 * directories below it and not `~/AGENTS.md`.
 */
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

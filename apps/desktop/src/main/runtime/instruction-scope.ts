import { dirname, resolve, sep } from 'node:path'
import type { InstructionScope } from '../../shared/runtime-ipc'

/**
 * 🔴 **Which layer a provider-reported instruction file belongs to** (356 §3, from 357's verdict).
 *
 * 357 asked one question — *"is the `AGENTS.md` this panel shows the profile's own?"* — and answered
 * it: **no.** BroBot pins `CODEX_HOME` at the selected profile's home and the provider does look
 * there first, but BroBot **authors no instruction leaf**, so that layer is empty and every path the
 * provider reports comes off the cwd chain. Its ruling for this panel is one sentence:
 *
 * > *"A CWD `AGENTS.md` row must say project; it must never be presented as proof that the selected
 * > profile owns it."*
 *
 * ## ⛔ Why this is in MAIN and cannot be in the renderer
 *
 * 357 §4 is explicit: *"The renderer must not derive scope from path strings."* The renderer is
 * handed `session.cwd` and `config.home` and could compare prefixes itself — and that is exactly the
 * trap. Those two fields exist to be **displayed**; the day either becomes a shortened or decorated
 * form of the real path, a renderer-side comparison starts answering `unknown` for every row and
 * nothing on screen looks wrong. Main holds the values the session was actually launched with.
 *
 * ## ⚠️ What this is NOT
 *
 * ⛔ **Not a second source, and not a read.** Nothing here opens a file, stats one, or asks whether
 * one exists. It is this session's own `providerHome` and `cwd` applied to a string the provider
 * already gave us — the panel's §3 change is *a label, not a path* (356 §3), and this is the label.
 */

/**
 * ⚠️ **Case is compared exactly, and on APFS that is the SAFE direction.**
 *
 * `realpathSync` does not canonicalise case, so a home recorded as `/Users/Alex/…` and a provider
 * path spelled `/users/alex/…` name one directory and differ as strings. Case-folding them would
 * make this function claim a layer on a machine where the filesystem happens to be insensitive and
 * lose that claim on one where it is not — a label that depends on the volume. Comparing exactly
 * fails toward {@link InstructionScope} `unknown`, which is a sentence the panel can print honestly.
 */
function inside(path: string, root: string): boolean {
  if (root === '') return false
  const base = resolve(root)
  // `resolve('/')` is `/`, which already ends in the separator; every other base needs one so that
  // `/homes/codex-old/AGENTS.md` is not read as living inside `/homes/codex`.
  return resolve(path).startsWith(base.endsWith(sep) ? base : base + sep)
}

/**
 * Whether `directory` is `cwd` or one of its ancestors — the project chain, which is the set of
 * directories a provider walks root-to-cwd looking for instruction files.
 *
 * ⚠️ **An ancestor, not merely a prefix.** `<cwd>/sub/AGENTS.md` shares every character of `cwd` and
 * is NOT on the chain: nothing walks downward. A prefix test would label a file below the working
 * directory as project instructions that apply here, which is the same class of overclaim 357 found.
 */
function onTheProjectChain(directory: string, cwd: string): boolean {
  if (cwd === '') return false
  let at = resolve(cwd)
  for (;;) {
    if (at === directory) return true
    const up = dirname(at)
    // `dirname('/')` is `/` — the fixed point that ends the walk at the filesystem root.
    if (up === at) return false
    at = up
  }
}

/** The two facts a session was launched with, and the only two this decision may use. */
export interface InstructionScopeContext {
  /** The app-owned per-profile provider home — the *who*. */
  providerHome: string
  /** The working directory the session actually runs in — the *what*. */
  cwd: string
}

/**
 * The layer `path` belongs to for a session launched in `context`.
 *
 * ⛔ **The profile home wins when the two overlap**, and the case is real rather than theoretical: a
 * provider home nested under the working directory would put every file in it on the project chain
 * as well, and the more specific answer is the true one — a file in the home is the profile's
 * however the directories happen to be arranged.
 */
export function instructionScope(path: string, context: InstructionScopeContext): InstructionScope {
  if (path === '') return 'unknown'
  if (inside(path, context.providerHome)) return 'profile'
  if (onTheProjectChain(dirname(resolve(path)), context.cwd)) return 'project'
  return 'unknown'
}

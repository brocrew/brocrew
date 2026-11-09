import { isInside } from '@brobot2/shared/paths'
import type { InstructionScope } from '../../shared/instruction-contracts'
import { dirname, resolve } from 'node:path'

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

/** The two facts a session was launched with, and the only two this decision may use. */
export interface InstructionScopeContext {
  /** The app-owned per-profile provider home — the *who*. */
  providerHome: string
  /** The working directory the session actually runs in — the *what*. */
  cwd: string
}

/** Profile home takes precedence when it overlaps the project chain. */
export function instructionScope(path: string, context: InstructionScopeContext): InstructionScope {
  if (path === '') return 'unknown'
  if (context.providerHome !== '' && isInside(context.providerHome, path, { orSame: false }))
    return 'profile'
  if (context.cwd !== '' && isInside(dirname(resolve(path)), context.cwd)) return 'project'
  return 'unknown'
}

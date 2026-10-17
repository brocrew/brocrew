import type { ProviderCapabilityMap } from '../src/shared/runtime-ipc'

/**
 * ⛔ **Claude's three declarations that reach a drawer tab, as bytes a browser test can import.**
 *
 * ⚠️ **`capabilitiesFor` is not reachable from the dom project.** `@brobot2/runtime` pulls
 * `node:fs` in through `internal/real-path.ts`, and Vite externalises it — so a browser test that
 * imports the real map fails to load at all. ⛔ The alternative to a fixture was inventing two
 * sentences, and `525`'s measurement of the Dropped tab is a measurement of THESE: the deferred
 * foot's reason was that tab's longest string at **341 characters** (340 since 680), and a fixture of a different
 * length would make every `529` number incomparable with the one it repairs.
 *
 * 🔴 **713 changed which sentence that is.** Both providers declare `requestCompaction`
 * `available` now (`R59`, `R60`), so the foot composes the `available` branch around each adapter's
 * `note` — pasted below, Codex's with it — and the 340-character absence is history.
 *
 * ⚑ **`541` added the third for the same reason.** The Changes tab's own deferred foot composes
 * `rewind.reason` into **416 characters** — the longest string on that tab, and the subject of
 * that dispatch — so the argument applies to it exactly.
 *
 * 🔴 **So the copy is checked rather than trusted.** `press-read-and-a-word.test.ts` asserts these
 * strings equal what `capabilitiesFor('claude')` actually declares, in the node project where the
 * real module loads — *a fixture must plant what the subject eats*. ⚑ If an adapter reworded any
 * of them, that test reddens here rather than a measurement drifting silently.
 */
export const CLAUDE_APPROVALS_NOTE =
  'On Claude nothing is sandboxed in either mode. What this mode removes is the card, except while Claude is planning: its own plan mode still asks, as the CLI’s does.'

/** ⚑ **713** — what the Dropped tab's foot composes on Claude now: the road, not an absence. */
export const CLAUDE_COMPACTION_NOTE =
  'by /compact, which BroCrew sends to Claude exactly as you type it, instructions and all'

/** ⚑ **713** — and on Codex, whose road takes no instructions (`R59`). */
export const CODEX_COMPACTION_NOTE =
  'by /compact, which BroCrew turns into Codex’s own compaction request — Codex takes no instructions for one'

/**
 * ⚑ **What `541` measured, and the sentence `HO-050` §1.2 rules must stay beside the press.** The
 * Changes tab draws `Deferred. Rewind writes to your files — more than compaction, which only
 * forgets. ${this}` — 416 characters, at 8 px until `541`.
 */
export const CLAUDE_REWIND_REASON =
  'Claude can do this — `enableFileCheckpointing` plus `rewindFiles()`, both declared in the pinned SDK. It is not wired because rewind writes to your files: it needs a confirm step, a defined scope (one file, the turn, the conversation), and an answer for edits you made by hand since. Compaction only forgets and was deferred for less.'

/**
 * ⚠️ **Partial and cast, which is this repo's own idiom for a capability fixture** — see
 * `a-server-the-workspace-has.dom.test.ts` and `provider-capabilities.render.test.ts`. A surface
 * indexes the map by provider and renders what comes back; nothing below is branched on by name.
 */
export const CAPABILITY_FIXTURE = {
  claude: {
    mark: { state: 'available', kind: 'letter' },
    approvals: { state: 'available', note: CLAUDE_APPROVALS_NOTE },
    requestCompaction: { state: 'available', note: CLAUDE_COMPACTION_NOTE },
    rewind: { state: 'unwired', reason: CLAUDE_REWIND_REASON },
    signIn: { state: 'available', note: 'Claude can be signed in from here.' },
    reprovisionAuth: { state: 'available', note: 'The credential can be copied in again.' },
  },
  codex: {
    mark: { state: 'available', kind: 'blossom' },
    approvals: {
      state: 'available',
      note: 'On Codex the mode also widens what a command may touch.',
    },
    requestCompaction: { state: 'available', note: CODEX_COMPACTION_NOTE },
    signIn: { state: 'available', note: 'Codex can be signed in from here.' },
    reprovisionAuth: { state: 'available', note: 'The credential can be copied in again.' },
  },
} as unknown as ProviderCapabilityMap

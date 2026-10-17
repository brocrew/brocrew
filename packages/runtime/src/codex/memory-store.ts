import { join } from 'node:path'

/**
 * **Where Codex keeps the memory 314 switched on** — the tree, as 312 measured it on a real
 * 0.146.0 child, and nothing about what to do with it.
 *
 * ## ⚠️ Why this is a module and not four `join`s at the call site
 *
 * 032's rule about second copies applies to path rules as much as to tool names, and
 * `claude/auto-memory.ts` is the precedent one directory over: *"this lives in the runtime package,
 * beside the adapter, because it is a fact about CLAUDE — the desktop reader that displays the file
 * has no business knowing the provider's directory scheme."* Same argument, other provider.
 *
 * ⛔ **The DISPLAY ruling is not here.** Which of these files belong on the instructions panel, and
 * why the rest do not, is `instructions.ts`'s call (317 §2.1) — this module only says what exists
 * and which of it reaches the model without being asked for.
 *
 * ## 🔴 The tree, measured rather than read off a README (312 §5)
 *
 * A Codex home with memory on and a completed background pipeline held:
 *
 * ```text
 * memories/memory_summary.md                        ⚑ injected into every request
 * memories/MEMORY.md                                the consolidated handbook
 * memories/extensions/ad_hoc/notes/<stamp>-<slug>.md  ⛔ the ones a person ASKED for
 * memories/raw_memories.md                          stage 1's own dump
 * memories/rollout_summaries/<stamp>-<slug>.md      one per extracted conversation
 * ```
 *
 * ⚠️ **`memory_summary.md` is the only one that arrives unasked.** 312's eight-arm wire matrix
 * captured it inside the model request whenever `use_memories` was effectively true, and captured
 * nothing else from this tree. Everything else is reachable — the four `memories__*` tools can list,
 * read and search the whole directory — but only if the model decides to, in a turn, with the user
 * watching the transcript. ⛔ **That distinction is the whole of 317 §2.2** and the reason
 * {@link CodexMemoryReach} exists.
 *
 * ## ⚠️ The ad-hoc filename convention, and why order comes off the NAME
 *
 * 312 read the tool signature out of the child's own `exec` description: `filename` must be
 * `YYYY-MM-DDTHH-MM-SS-<slug>.md`, the slug lowercase ASCII letters, digits and hyphens. A
 * fixed-width leading timestamp means **byte order is chronological order**, so a caller that wants
 * the newest notes sorts the names descending and needs no `stat` at all.
 *
 * ⚑ **And the name is the more honest key anyway**: it is the timestamp the AGENT declared and the
 * one the user sees in the path, where an `mtime` is whatever last touched the file. A name that
 * does not follow the convention sorts by its bytes, which is the only order it has.
 */

/** `$CODEX_HOME/memories` — the whole store, and the directory every path below is under. */
export function codexMemoryDir(providerHome: string): string {
  return join(providerHome, 'memories')
}

/** The compressed summary Codex injects into every request. 312 captured it on the wire. */
export const CODEX_MEMORY_SUMMARY = 'memory_summary.md'

/** The consolidated handbook the agent searches. Same name as Claude's index, different door. */
export const CODEX_MEMORY_INDEX = 'MEMORY.md'

/** `raw_memories.md` — stage 1's dump, which phase 2 consolidates into the two files above. */
export const CODEX_RAW_MEMORIES = 'raw_memories.md'

/** `rollout_summaries/` — one machine-written summary per conversation the extractor ate. */
export const CODEX_ROLLOUT_SUMMARIES = 'rollout_summaries'

/** Where `memories__add_ad_hoc_note` puts a note, relative to {@link codexMemoryDir}. */
export const CODEX_AD_HOC_NOTES = ['extensions', 'ad_hoc', 'notes'] as const

export function codexMemorySummary(providerHome: string): string {
  return join(codexMemoryDir(providerHome), CODEX_MEMORY_SUMMARY)
}

export function codexMemoryIndex(providerHome: string): string {
  return join(codexMemoryDir(providerHome), CODEX_MEMORY_INDEX)
}

export function codexAdHocNotesDir(providerHome: string): string {
  return join(codexMemoryDir(providerHome), ...CODEX_AD_HOC_NOTES)
}

/**
 * ⛔ **Whether this text is in the prompt, or merely on disk** (317 §2.2) — the one fact a panel
 * about memory must not get wrong.
 *
 * `'prompt'` means the provider put it in front of the model before anyone asked a question.
 * `'on-request'` means it is in the store and the agent reads it **if it chooses to** — which is a
 * claim about availability, never about what the model has read. 009's rule and 305's defect: a
 * disclosure that says the model knows something it has not been told is worse than no disclosure.
 */
export type CodexMemoryReach = 'prompt' | 'on-request'

/** One file in the store, with what it is and how it reaches the model. */
export interface CodexMemoryStoreFile {
  /** Path segments below {@link codexMemoryDir}. */
  readonly at: readonly string[]
  readonly reach: CodexMemoryReach
  /** What the file is, in the words a person reading a panel would need. */
  readonly what: string
}

/**
 * ⚑ **The two fixed files, in the order the model meets them.** The ad-hoc notes are a directory
 * rather than a fixed name, so they are not on this list — see {@link codexAdHocNotesDir}.
 */
export const CODEX_MEMORY_STORE_FILES: readonly CodexMemoryStoreFile[] = [
  {
    at: [CODEX_MEMORY_SUMMARY],
    reach: 'prompt',
    what: 'the compressed summary Codex puts in front of the model on every turn',
  },
  {
    at: [CODEX_MEMORY_INDEX],
    reach: 'on-request',
    what: 'the consolidated handbook, which the agent searches when it chooses to',
  },
]

/**
 * 🔴 **The pipeline's own working material** — named here so that a reader who declines to show it
 * can say WHAT it declined rather than leaving the store looking three files deep (317 §2.1).
 *
 * ⚠️ **Not "the model cannot see these".** It can: `memories__list`/`read`/`search` reach the whole
 * directory. The reason they are the pipeline's rather than the memory is that phase 2 rewrites
 * them, and a person who edited one would be editing an input.
 */
export const CODEX_MEMORY_PIPELINE_FILES: readonly string[] = [
  CODEX_RAW_MEMORIES,
  `${CODEX_ROLLOUT_SUMMARIES}/`,
]

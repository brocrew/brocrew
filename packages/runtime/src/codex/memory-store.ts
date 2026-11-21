import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'

/**
 * Where Codex keeps its memory tree, and which files reach the model unasked. Display decisions
 * live in `instructions.ts`. Paths live here, beside the adapter, because the directory scheme is a
 * fact about Codex.
 *
 * Memory v1 holds `memory_summary.md` (injected into every request), `MEMORY.md` (consolidated
 * handbook), `raw_memories.md`, `rollout_summaries/` and ad-hoc notes under
 * `extensions/ad_hoc/notes/`. Memory v2 keeps the summary, notes and rollout summaries in
 * `memories_v2/` with no `MEMORY.md` or `raw_memories.md`; {@link codexMemoryDir} picks the folder.
 *
 * Only `memory_summary.md` arrives unasked; the rest is reachable through the `memories__*` tools
 * if the model chooses, which is why {@link CodexMemoryReach} exists.
 *
 * Ad-hoc note filenames are `YYYY-MM-DDTHH-MM-SS-<slug>.md` (slug: lowercase ASCII letters, digits,
 * hyphens), so byte order is chronological order and the name is a better sort key than `mtime`.
 */

/**
 * The memory folder Codex uses in this home, chosen the way Codex chooses it: the folder of the
 * `[memories] version` that config.toml names; otherwise `memories_v2` for a home with no
 * `memories` folder yet (unless `dual_write = false`), and `memories` for a home that has one.
 * Every path below is under it.
 */
export function codexMemoryDir(providerHome: string): string {
  const configured = configuredMemories(providerHome)
  const v1 = join(providerHome, 'memories')
  const v2 = join(providerHome, 'memories_v2')
  if (configured['version'] === 'v1') return v1
  if (configured['version'] === 'v2') return v2
  return configured['dual_write'] !== false && !existsSync(v1) ? v2 : v1
}

/** This home's `[memories]` table, or an empty one when config.toml has none or is unreadable. */
function configuredMemories(providerHome: string): Record<string, unknown> {
  try {
    const table = parseToml(readFileSync(join(providerHome, 'config.toml'), 'utf8'))['memories']
    return typeof table === 'object' && table !== null && !Array.isArray(table)
      ? (table as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** The compressed summary Codex injects into every request. */
export const CODEX_MEMORY_SUMMARY = 'memory_summary.md'

/** Memory v1's consolidated handbook the agent searches. Claude's index has the same name. */
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
 * Whether a file is in the prompt or merely on disk. `'on-request'` is a claim about availability,
 * never about what the model has read.
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

/** The two fixed files, in the order the model meets them. Ad-hoc notes are a directory; see {@link codexAdHocNotesDir}. */
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
 * The pipeline's working material, named so a reader that hides it can say what it hid. The model
 * can still reach these through `memories__list`/`read`/`search`; they are the pipeline's because
 * phase 2 rewrites them.
 */
export const CODEX_MEMORY_PIPELINE_FILES: readonly string[] = [
  CODEX_RAW_MEMORIES,
  `${CODEX_ROLLOUT_SUMMARIES}/`,
]

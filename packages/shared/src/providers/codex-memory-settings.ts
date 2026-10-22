/**
 * One key BroBot writes, and the reason it is written rather than left to a default.
 *
 * ⚑ **This table is the single source.** The file's comments are rendered from it, the merge reads
 * it, and the desktop's provider-config disclosure derives its sentence from it — so the sentence a
 * user reads cannot drift from the keys the app writes. 306's shape: state the rule once.
 */
export interface CodexMemorySetting {
  /** The TOML table the key lives in. */
  readonly table: string
  /** The key inside it. */
  readonly key: string
  /** What we write. All four are `true`; the type keeps that visible rather than implied. */
  readonly value: boolean
  /** One line, for the person who opens this file by hand. */
  readonly why: string
}

/**
 * 🔴 **312's measured positive, and the two switches it corrected.**
 *
 * The exact configuration that put `memories__list`, `memories__read`, `memories__search` and
 * `memories__add_ad_hoc_note` into a real child's inventory was the first two rows; the last two are
 * written because their defaults are opinions we should be stating, not inheriting.
 */
export const CODEX_MEMORY_SETTINGS: readonly CodexMemorySetting[] = [
  {
    table: 'features',
    key: 'memories',
    value: true,
    why: 'the feature gate; without it this profile has no memory at all',
  },
  {
    table: 'memories',
    key: 'dedicated_tools',
    value: true,
    why: 'the tool gate, and it defaults FALSE; without it nothing can read or write memory',
  },
  {
    table: 'memories',
    key: 'use_memories',
    value: true,
    why: 'the whole surface; false removes the memory summary and all four tools',
  },
  {
    table: 'memories',
    key: 'generate_memories',
    value: true,
    why: 'whether a new conversation may feed the background extractor',
  },
]

export interface CodexMemorySetting {
  /** The TOML table the key lives in. */
  readonly table: string
  /** The key inside it. */
  readonly key: string
  /** What the provider home's config declares. */
  readonly value: boolean | 'v1'
  /** One line, for the person who opens this file by hand. */
  readonly why: string
}

export const CODEX_MEMORY_SETTINGS: readonly CodexMemorySetting[] = [
  {
    table: 'features',
    key: 'memories',
    value: true,
    why: 'the feature gate; without it this profile has no memory at all',
  },
  {
    table: 'memories',
    key: 'version',
    value: 'v1',
    why: 'keep the memories/ layout this adapter reads; fresh Codex profiles otherwise select v2',
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

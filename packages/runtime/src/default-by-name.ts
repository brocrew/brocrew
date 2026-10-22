import { providerValue, type Provider } from '@brobot2/shared'
import { CLAUDE_DEFAULT_BY_NAME } from './claude/default-by-name'

/** ⚑ **D-042 · a model and the effort it runs at, both named.** */
export interface ModelByName {
  readonly model: string
  readonly effort: string
}

/**
 * 🔴 **D-042 · R1 — a provider's own default, BY NAME, when it can be named without asking** —
 * Claude's {@link CLAUDE_DEFAULT_BY_NAME}; `null` for Codex, whose default is the row its
 * `model/list` marks `isDefault` (`ModelChoice.isDefault`), with that row's own default effort.
 * ⛔ `null` is *read the list*, never *send nothing*.
 */
export function theDefaultByName(provider: Provider): ModelByName | null {
  return providerValue(provider, { claude: CLAUDE_DEFAULT_BY_NAME, codex: null })
}

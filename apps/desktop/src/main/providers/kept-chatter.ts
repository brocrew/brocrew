import type { KeptChatter, KeptChatterTable, RepeatingWarning } from './kept-chatter-shape'
import {
  CLAUDE_KEPT_CHATTER,
  CLAUDE_REPEATING_WARNINGS,
  CODEX_KEPT_CHATTER,
  CODEX_REPEATING_WARNINGS,
} from './worker-safe'

export type { KeptChatter } from './kept-chatter-shape'

/** Chatter this app writes for either provider. */
const APP_KEPT_CHATTER: KeptChatterTable = {
  'plugin/launch': { category: 'lifecycle', newest: 0 },
}

const BY_PROVIDER: Readonly<Record<string, KeptChatterTable>> = {
  claude: CLAUDE_KEPT_CHATTER,
  codex: CODEX_KEPT_CHATTER,
}

const own = (table: KeptChatterTable | undefined, key: string): KeptChatter | undefined =>
  table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined

export function keptChatter(provider: string, category: string, label: string): KeptChatter | null {
  const table = Object.hasOwn(BY_PROVIDER, provider) ? BY_PROVIDER[provider] : undefined
  const rule = own(table, label) ?? own(APP_KEPT_CHATTER, label)
  return rule !== undefined && rule.category === category ? rule : null
}

const WARNINGS: readonly RepeatingWarning[] = [
  ...CLAUDE_REPEATING_WARNINGS,
  ...CODEX_REPEATING_WARNINGS,
]

/**
 * A warning that describes a passing state and repeats — usage close to its limit, still working,
 * reconnecting — of which history keeps only the newest per conversation (W26). Null for any other
 * error, and for any fatal one, which history keeps.
 */
export function repeatingWarning(message: unknown, stall: boolean, fatal: boolean): string | null {
  if (fatal) return null
  // The stall watchdog is the runtime's own, provider-neutral notice.
  if (stall) return 'still working'
  if (typeof message !== 'string') return null
  return WARNINGS.find((warning) => warning.said(message))?.kind ?? null
}

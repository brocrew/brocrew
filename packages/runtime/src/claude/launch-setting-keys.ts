/** Claude launch keys, including those retained in older records. */
export const CLAUDE_LAUNCH_SETTING_KEYS = [
  /** Which settings files it reads: `[]`, none. */
  'settings-sources',
  /** The folder its memory is kept in. */
  'memory-folder',
  /** The built-in tools it is given beyond its own default set. */
  'built-in-tools',
  /** The tool names it is told it may not use. */
  'denied-tools',
  /** Its permission mode: `default`, or `plan`. */
  'mode',
  /** Whether the account's claude.ai connectors are on. */
  'connectors',
  /** Who decides the commit attribution it adds: `provider-default`, its own. */
  'attribution',
] as const

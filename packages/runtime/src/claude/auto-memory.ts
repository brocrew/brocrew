import { join } from 'node:path'

/**
 * Where the agent's own memory lives: one directory per profile ({@link claudeAutoMemoryDir}), not the
 * CLI's cwd-scoped `<providerHome>/projects/<sanitized-cwd>/memory/`, so a profile remembers across
 * projects. It sits beside `<providerHome>/CLAUDE.md` and `<providerHome>/plans/`, and the CLI keeps
 * no `memory/` of its own at that level. It lives in the runtime package because the directory scheme
 * is a fact about Claude that the desktop reader should not duplicate.
 */

/**
 * The auto-memory directory this app sends: one per profile, derived from nothing about the session.
 *
 * It is set through `Settings.autoMemoryDirectory` in `Options.settings` (the flag-settings layer,
 * which ranks above user, project and local settings); `smoke/auto-memory-probe.smoke.ts` checks that
 * it moves a real session's memory directory. `settingSources: []` means the agent cannot override it
 * from a `.claude/settings.json` it writes into its cwd.
 *
 * The CLI only accepts an absolute path of at least three characters with no NUL or UNC prefix. A
 * provider home satisfies that, and the adapter refuses an empty one (`childEnvAdditions`), so the
 * value is never silently dropped back to the default.
 */
export function claudeAutoMemoryDir(providerHome: string): string {
  return join(providerHome, 'memory')
}

/** The index file the provider loads into the prompt, and the agent maintains. */
export const AUTO_MEMORY_INDEX = 'MEMORY.md'

/** The full path of that index, as the drawer shows it. */
export function claudeAutoMemoryIndex(providerHome: string): string {
  return join(claudeAutoMemoryDir(providerHome), AUTO_MEMORY_INDEX)
}

/**
 * Whether a file name in the memory directory is a memory topic. `MEMORY.md` is only an index; each
 * memory is its own file beside it.
 *
 * Only the index is loaded into the CLI's system prompt (`smoke/claude-memory-topics.smoke.ts` checks
 * both halves); a topic file reaches the model only when it reads it with an ordinary file tool, so
 * topics are `'on-request'`. The CLI can attach up to five memory files per turn when a server-side
 * flag that defaults off is on, or when its own environment variable is set; if so `'on-request'`
 * understates it, which is the safe direction (never claim the model has read something).
 */
export function isClaudeMemoryTopic(name: string): boolean {
  // The index is injected by the provider and listed on its own row, so it is not one of its entries.
  if (name === AUTO_MEMORY_INDEX) return false
  // `.md`: the provider dictates Markdown frontmatter for memory files; anything else was not
  // written by the memory instructions.
  return name.endsWith('.md')
}

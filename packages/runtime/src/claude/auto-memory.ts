import { join } from 'node:path'

/**
 * **Where the agent's own memory lives** — 165 derived the provider's default, 166 replaced it.
 *
 * ## Override the provider's cwd-scoped memory with profile-scoped memory
 *
 * > ⚑ *"'developer' profile has one HOME. But each 'developer' session might have a different
 * > project/CWD. The developer will 'remember' things from past work as a developer, and it might be
 * > working on different projects."*
 *
 * 165 shipped the CLI's own two-axis path, `<providerHome>/projects/<sanitized-cwd>/memory/`, and
 * proved it live: same profile + different cwd remembered **nothing**. That is exactly the case the
 * ticket says must remember. ⛔ **So the second axis goes**, and the directory becomes
 * {@link claudeAutoMemoryDir} — one memory per profile, whatever the session is working on.
 *
 * ⚑ **It sits beside the other two things a profile home already holds**: `<providerHome>/CLAUDE.md`
 * (158's profile memory, the file the user writes) and `<providerHome>/plans/` (150's plan
 * documents). Same axis, same home, and the CLI keeps no `memory/` of its own at that level for
 * it to collide with — `~/.claude` holds `projects/`, `plans/`, `todos/`, `settings.json` and no
 * `memory`.
 *
 * ⚠️ **This lives in the runtime package, beside the adapter, because it is a fact about CLAUDE** —
 * the desktop reader that displays the file has no business knowing the provider's directory scheme,
 * and 032's rule about second copies applies to path rules as much as to tool names.
 */

/**
 * 🔴 **The auto-memory directory this app SENDS** (166) — one per profile, and no cwd in it.
 *
 * ⛔ **Nothing here is derived from the session**: not the working directory, not the project, not
 * the conversation. That is the whole change. A developer who learned something in one repository
 * carries it into the next one, because the memory belongs to the identity rather than to the
 * checkout — which is what a profile has meant since 021.
 *
 * ⚑ **The lever is `Settings.autoMemoryDirectory`** (`sdk.d.ts:8852`), reached through
 * `Options.settings` — the flag-settings layer, which sits below managed policy settings and above
 * user, project and local settings (`sdk.d.ts`, `Query.applyFlagSettings`).
 * `packages/runtime/smoke/auto-memory-probe.smoke.ts` measures that it moves a real session's
 * memory directory.
 *
 * 🔒 **Everything below the flag layer is already unreachable here**, which is the property that
 * makes this safe to set rather than merely effective: `settingSources: []` means user, project and
 * local settings are never read at all, so the agent cannot answer this question from a
 * `.claude/settings.json` it writes into its own cwd. The SDK's own note — *"Ignored if set in
 * projectSettings … for security"* — is a guarantee this app does not have to rely on.
 *
 * ⚠️ **The value must pass the CLI's own check on the path**: absolute, at least three
 * characters, no NUL, no UNC prefix. A provider home is all of those, and the adapter refuses an
 * empty one outright (`childEnvAdditions`), so there is no path here that reaches the CLI and is
 * silently dropped back to the default.
 */
export function claudeAutoMemoryDir(providerHome: string): string {
  return join(providerHome, 'memory')
}

/** The index file the provider loads into the prompt, and the agent maintains. */
export const AUTO_MEMORY_INDEX = 'MEMORY.md'

/** The full path of that index — what the drawer shows, and what 166 asserts against. */
export function claudeAutoMemoryIndex(providerHome: string): string {
  return join(claudeAutoMemoryDir(providerHome), AUTO_MEMORY_INDEX)
}

/**
 * 🔴 **The other half of the store: one memory per file, and the provider puts none of them in the
 * prompt** (322 §3.1).
 *
 * ⛔ **The panel listed `MEMORY.md` and nothing else, and for two years' worth of dispatches that
 * looked complete** — because Codex's store was the one being read and Claude's was assumed to be
 * one file. It is not. `MEMORY.md` is an INDEX and the memories are beside it, one per file, and a
 * real profile on this machine held three files of which the panel named one.
 *
 * ## ⚑ Only the index reaches the prompt
 *
 * The CLI reads one file of the memory directory, `MEMORY.md`, into its own system prompt. It opens
 * no other file there, so a topic file reaches the model only when the model reads it with an
 * ordinary file tool. `packages/runtime/smoke/claude-memory-topics.smoke.ts` measures both halves
 * against a real session: a token only in the index is answered with no tool call, and a token only
 * in a topic file is answered only after a file read.
 *
 * ⚠️ **The prompt it builds says the same thing in its own words** (captured on a loopback by
 * `apps/desktop/smoke/provider-snapshots.smoke.ts`), which is the second reading of
 * one fact rather than a second fact: *"`MEMORY.md` is always loaded into your conversation context
 * — lines after 200 will be truncated, so keep the index concise"*, and *"**Step 1** — write the
 * memory to its own file … **Step 2** — add a pointer to that file in `MEMORY.md`. `MEMORY.md` is an
 * index, not a memory … Never write memory content directly into `MEMORY.md`."*
 *
 * ## ⚠️ The one mechanism that could have moved this boundary, and why it does not
 *
 * The CLI can attach up to five memory files to a turn automatically, which would make a topic file
 * `'prompt'` rather than `'on-request'`. ⛔ **It cannot fire in this app**: it runs only when a
 * server-side feature flag that defaults off is on, or when an environment variable of its own is
 * set. `buildChildEnv`'s allow-list does not carry that variable and `childEnvAdditions` does not
 * add it, so the child never sees one.
 *
 * ⚠️ **A flag is a boundary that can move**, and this is the honest weakness in the ruling rather
 * than a footnote: the day that flag turns on for this account, a topic file could reach the model
 * unasked and `'on-request'` would be understating it. That direction of error is the safe one
 * (009: never claim the model has read something), and `probe:claude-memory-topics` is what
 * re-measures it against a real child rather than against this comment.
 */
export function isClaudeMemoryTopic(name: string): boolean {
  // ⛔ **The index is not one of its own entries.** It is the file the provider injects, it is
  // listed on its own row, and counting it here would report a store of one memory as two.
  if (name === AUTO_MEMORY_INDEX) return false
  // ⚠️ **`.md`, because the frontmatter format the provider dictates is Markdown** — *"write each
  // memory to its own file (e.g. `user_role.md`, `feedback_testing.md`) using this frontmatter
  // format"*. Anything else in this directory was put there by something other than the memory
  // instructions, and a panel that showed it would be reporting a memory nobody wrote.
  return name.endsWith('.md')
}

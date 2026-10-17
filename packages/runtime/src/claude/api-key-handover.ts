/**
 * 🔒 **How a person's Anthropic API key reaches the Claude CLI, and nothing the CLI runs.**
 *
 * Imports nothing, so `scripts/windows-packaged-check.mjs` runs this same decision on GitHub's
 * Windows runner, against the packaged `claude.exe` (Node runs the TypeScript as it is).
 *
 * ## On macOS and Linux: a pipe
 *
 * The spawn writes the key into a fourth pipe, descriptor {@link API_KEY_DESCRIPTOR}, and closes it;
 * the environment carries only `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`, the descriptor's number. The
 * CLI reads the key to the newline, deletes the variable, and writes nothing to disk. So the key is
 * in no environment (not even the CLI's own, which `ps -E` shows to any process of the same user)
 * and in no file, and the descriptor is not inherited by what the CLI runs. `probe:token-reach`
 * measures it.
 *
 * ## ⛔ On Windows the pipe carries nothing
 *
 * The CLI reads that descriptor only when it is a SOCKET, and gives up on anything else. Node's
 * stdio pipes are socket pairs on macOS and Linux but named pipes on Windows, and libuv cannot hand a
 * Windows child a socket as one of its stdio. Measured on GitHub's `windows-2022` runner: the CLI
 * sent no key and said *Not logged in*.
 *
 * ## On Windows: the environment, with the CLI told the host provides it
 *
 * The key travels as `ANTHROPIC_API_KEY`, which the CLI reads first when it runs without a person at
 * a terminal, beside `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`. The second is the switch Claude Code
 * documents for *"host platforms that embed Claude Code and manage model provider routing on its
 * behalf"* (https://code.claude.com/docs/en/env-vars), which BroBot is. ⚑ With it set, the CLI
 * removes `ANTHROPIC_API_KEY`, by name and case-blind, from the environment of its Bash and
 * PowerShell tools, its hooks and its stdio MCP servers, and from any `${VAR}` it expands in an MCP
 * server's config. Without it, `ANTHROPIC_API_KEY` reaches all of them. That removal is not
 * documented, so `probe:token-reach` measures it on its Windows-route
 * arms, and the packaged check measures one shell command on Windows itself.
 *
 * ⚠️ **What else the switch does**: the CLI takes BroBot's word for the
 * provider and credential over what a settings file says, managed (organisation) settings included.
 * So on Windows a key session runs even where an organisation's managed settings force a sign-in
 * method or an organisation, which on macOS stop it; and proxy, certificate, provider and model
 * variables set in any settings file's `env` are ignored. BroBot's own proxy and certificate
 * variables come from its environment (`buildChildEnv`) and still apply. A 401 fails at once rather
 * than being retried. ⚑ The switch itself is not removed from what the CLI runs, so a `claude` an
 * agent starts in its shell is host-managed too, without the key.
 *
 * ⚠️ **What it does not protect.** The key sits in the CLI's own environment, and on Windows any
 * process of the same user can read another's environment and memory, so a command an agent runs
 * could still dig it out of the CLI that started it. That is true of every route on Windows: the key
 * is in the CLI's memory whichever way it arrived.
 */
export interface ApiKeyHandover {
  /** The variables the launch's environment carries for the key. */
  readonly env: Readonly<Record<string, string>>
  /** What the spawn writes into descriptor {@link API_KEY_DESCRIPTOR}, or null when no pipe is opened. */
  readonly descriptor: string | null
}

/**
 * 🔒 **The descriptor the CLI reads a person's API key from** — the one named by the
 * `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR` the launch's env carries. Three is the first after stdio.
 */
export const API_KEY_DESCRIPTOR = 3

/** How `apiKey` reaches a Claude CLI started on `platform`. See the file's own note. */
export function handOverApiKey(apiKey: string, platform: NodeJS.Platform): ApiKeyHandover {
  if (platform === 'win32') {
    return {
      env: { ANTHROPIC_API_KEY: apiKey, CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' },
      descriptor: null,
    }
  }
  return {
    env: { CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: String(API_KEY_DESCRIPTOR) },
    descriptor: apiKey,
  }
}

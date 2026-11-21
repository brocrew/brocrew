import type { ProviderCapabilities } from '../provider-capabilities'

/**
 * What the Claude adapter can do. See `../provider-capabilities.ts` for the rule: the renderer never
 * knows which provider it talks to, so every provider-specific fact arrives from here.
 * Each entry names what it was checked against.
 */
export const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  mark: { state: 'available', kind: 'letter' },
  /** `claude/login-renewal.ts` renews an expired login with its one-message request. */
  loginRenewalMessage: { state: 'available' },
  /**
   * Wired through `Options.permissionMode: 'plan'` in `ClaudeRuntime.optionsFor`; it takes precedence over yolo
   * because `permissionMode` is one field. The model calls `ExitPlanMode` with the plan in its input, the adapter
   * reads it in `planDocument` and surfaces it as a user-input request, and approving that request lets the
   * session carry on and do the work. The session does not end at `ExitPlanMode`.
   */
  planMode: {
    state: 'available',
    // Claude ends planning when the model asks and the person approves. Codex has an app-side switch instead,
    // so the two stay separate notes. The last sentence is Claude's own plan mode: it asks before changing
    // files, running a command it cannot tell is harmless, or using an MCP tool, even in a conversation that
    // does not otherwise ask.
    note:
      'It proposes a plan, waits for your approval, and then carries it out in this conversation. ' +
      'While it is planning, Claude’s own plan mode governs what it does: it asks you before it ' +
      'changes your files, runs a command it cannot tell is harmless, or uses a server’s tool, even ' +
      'in a conversation that does not otherwise ask you first.',
  },
  /**
   * A token estimate, never the words. The SDK sends a `thinking_tokens` system message (read in `normalize.ts`)
   * and the adapter sets no `Options.thinking`. Thinking deltas arrive empty, so the adapter fills `tokens` and
   * `redacted` and leaves `text` absent.
   */
  thinking: {
    state: 'available',
    note: 'How much it thought — the provider redacts the reasoning itself, so the words are never sent.',
  },
  /** The SDK's `Task` tool. */
  subAgents: { state: 'available' },
  /**
   * Through the CLI's own `/compact`, sent exactly as a person types it. The SDK has no compaction method;
   * only a person's `/compact` compacts. An agent's `/compact` is framed words and does nothing. This
   * state is half of what enables the Dropped tab's control; the other half is the conversation's send facts.
   */
  requestCompaction: {
    state: 'available',
    note: 'by /compact, which BroCrew sends to Claude exactly as you type it, instructions and all',
  },
  /**
   * `unwired`: the SDK offers `enableFileCheckpointing` and `rewindFiles()`, and nothing in this repo calls them.
   */
  rewind: {
    state: 'unwired',
    reason:
      'Claude can do this — `enableFileCheckpointing` plus `rewindFiles()`, both declared in the pinned SDK. It is not wired because rewind writes to your files: it needs a confirm step, a defined scope (one file, the turn, the conversation), and an answer for edits you made by hand since. Compaction only forgets and was deferred for less.',
  },
  /**
   * `absent`: the SDK has no login verb (`Query` exposes only `accountInfo()`), and a Claude profile home holds
   * no credential. `claudeKeychainTokenProvider` re-reads the machine Keychain on every launch and injects the
   * token for that run, so a profile is never out of date and there is nothing to renew.
   */
  signIn: {
    state: 'absent',
    reason:
      'Claude sessions run on the API key saved under “API key” on the Claude card in Providers, or, with none saved, on your machine login directly — there is no separate sign-in here to renew. Without a saved key, switching profiles on your machine is picked up the next time you start a conversation.',
    checkedAgainst:
      'Claude Agent SDK 0.3.281 (exact-pinned): `Query` declares `accountInfo()` (sdk.d.ts:2971) and no login/authenticate verb anywhere in the declaration file; `forceLoginMethod`/`forceLoginOrgUUID` are settings the CLI reads, not methods we can call. And `claude/auth.ts` copies no Claude credential into the profile home (015), so there is none to renew.',
  },
  /**
   * `absent`: there is nothing to copy into. No Claude credential is ever written to a profile home, so a
   * "copy my machine sign-in" gesture has no destination. Starting a Claude conversation renews an expired login.
   */
  reprovisionAuth: {
    state: 'absent',
    reason:
      'There is nothing to copy — with no API key saved, Claude sessions read your machine login directly. If it has expired, starting a Claude conversation renews it.',
    checkedAgainst:
      '`codex/auth.ts` (015): `provisionCodexAuth` copies ONLY the Codex `auth.json`; the Claude bridge is `claudeKeychainTokenProvider`, which re-reads the macOS Keychain on every launch and persists nothing. Verified on this machine with `security find-generic-password`: exactly one `Claude Code-credentials` item, machine-wide, and no Claude credential file in any profile folder we provision.',
  },
  /**
   * `absent` is the reassurance here: Claude writes no credential into a profile folder, while a Codex profile
   * folder starts with a copy of the machine's login. The launcher says so per provider.
   */
  homeCredential: {
    state: 'absent',
    // Scoped to Claude: the same profile name can hold a Codex credential, so the sentence must not say that
    // nothing is written into the profile.
    reason:
      'Claude writes nothing of your sign-in into this profile. Claude sessions read the saved API key, or with none your machine login, at the moment they start and pass it to the agent for that run only, so there is no Claude copy here to go stale.',
    checkedAgainst:
      '`provider-homes.ts`: `prepareProviderHome`’s Claude branch calls `claudeAuthHealth` and writes no file — `provisionCodexAuth` is the only writer of a credential into a folder we provision, and it is reached only when `identity.provider === "codex"`. The token comes from `claudeKeychainTokenProvider` (re-read per call, deliberately: the macOS Keychain item, or on Windows Claude Code’s own `.credentials.json`) and reaches the child through `internal/child-env.ts` alone. `credential-disclosure.test.ts` runs both branches against a temp home and asserts this one leaves nothing behind.',
  },
  childInput: {
    state: 'absent',
    reason:
      'A Claude sub-agent is a record, not a conversation you can join. The SDK writes its ' +
      'transcript to `subagents/agent-<id>.jsonl` as it works — BroCrew follows that file live — ' +
      'and offers a reader keyed by agent id, `getSubagentMessages(sessionId, agentId)`. There is ' +
      'nothing in the other direction: the parent model dispatches the child and reads its report, ' +
      'and no one else gets a word in.',
    checkedAgainst:
      '@anthropic-ai/claude-agent-sdk 0.3.281 `sdk.d.ts` — all 70 distinct `subtype` literals on ' +
      'the client↔CLI control channel (`api_retry` through `worker_shutting_down`), every method ' +
      'on `Query`, and every exported function taking an agent id. Exactly one takes one: ' +
      '`getSubagentMessages`, and it reads.',
  },
  agentCommands: {
    state: 'available',
    note: "Claude's own — its built-in commands and its skills in one list, typed with a leading slash. Claude pushes a fresh list whenever it changes.",
  },
  /**
   * Set through `Options.settings` at launch. The CLI accepts the setting without validating it and
   * reports nothing back, so the note says "asked for", never "on".
   */
  ultracode: {
    state: 'available',
    note: 'Asks Claude to organise multi-agent work on its own, at whatever effort the conversation runs. Fixed when the conversation starts, for that run only — Claude never reports back whether it took — and it needs Workflows enabled on your account and a model that supports it.',
  },
  /**
   * `absent` for a foreground command: the output arrives with the result. A running task's output is read by a
   * tool the model calls, so the bytes go to the agent's context and there is no host channel. The SDK's
   * `get_task_output` control request reads background commands only, and BroCrew does not use it.
   */
  commandOutput: {
    state: 'absent',
    reason:
      'Claude does not report a command’s output until the command finishes — the whole of it ' +
      'arrives at once, in the result.',
    checkedAgainst:
      '@anthropic-ai/claude-agent-sdk 0.3.281 `sdk.d.ts` — every method on `Query` (`stopTask` and ' +
      '`backgroundTasks` are the two that name a task; neither reads one) and every `system` ' +
      'subtype on the control channel. Then a live turn: `probe:command-output` row C, a 12-second ' +
      'command printing a per-process nonce, 45 frames captured with `includePartialMessages`, ' +
      'none carrying the output before the `tool_result`. 0.3.287 adds the `get_task_output` ' +
      'control request: the last 8 KiB of a background shell or Monitor task, on request — ' +
      'nothing for a foreground command, which is what this entry is about.',
  },
  /**
   * `unwired`: `get_task_output` returns the last 8 KiB of a running background shell or Monitor task. Showing it
   * live is a product decision that is still open.
   */
  backgroundCommandOutput: {
    state: 'unwired',
    reason:
      'Claude can hand over the last part of a background command’s output while it runs, but BroCrew does not ask for it yet.',
  },
  /**
   * Claude has no sandbox to come off. `permissionModeFor` uses `default` outside planning, and `handleCanUseTool`
   * and `promptGuardHooks` allow without a card in automatic mode except while planning, where the CLI's own flow
   * still asks. The app adds no protected-folder refusal above that flow. Automatic mode removes only the card.
   */
  approvals: {
    state: 'available',
    note: 'On Claude nothing is sandboxed in either mode. What this mode removes is the card, except while Claude is planning: its own plan mode still asks, as the CLI’s does.',
  },
  /**
   * `Options.mcpServers` accepts `{type: 'http', url}`. An external server's tool reaches `canUseTool`, so in `ask`
   * each call asks, whatever the server says about the tool. A server's own form reaches the person through
   * `ClaudeSessionHandle.handleElicitation`.
   */
  externalMcpServers: {
    state: 'available',
    note: 'A server this identity may use is passed to the session as a known MCP server. In a conversation that asks you first, each of its tool calls asks you before it runs, whatever the server says about the tool — unless you allowed that tool for the conversation or kept a rule that allows it — and a form the server sends reaches you to answer.',
  },
  /**
   * An unattributed turn fails closed at the CLI's strict human-trust gates. A `peer` stamp changes nothing in what
   * the model is handed. See `claudeOriginOf` in `claude-runtime.ts`.
   */
  // A backgrounded command, a scheduled job and a background sub-agent each wake the session after its turn
  // ended: the CLI queues a `task-notification` and runs a turn for it.
  backgroundWake: {
    state: 'available',
    note: 'A command or a sub-agent left running in the background, or a scheduled wake-up, runs Claude again when it ends or fires, with nobody sending a message. So work whose turn ended with one pending reads as working in the background, not as stalled.',
  },
  turnProvenance: {
    state: 'available',
    note: 'What you type in the composer is marked as typed by a person, which Claude needs before a keyword such as `ultracode` in it takes effect. A message another agent sends is marked with that agent, a mark this Claude version does not keep. The app’s own messages carry no mark, including the ones that pass on an answer or a reply.',
  },
}

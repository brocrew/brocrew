import type { ProviderCapabilities } from '../provider-capabilities'

/**
 * What the Codex adapter can do. See `../provider-capabilities.ts` for the rule. Each entry names what it was
 * checked against: the vendored protocol in `packages/runtime/src/codex/protocol/` (held to the bundled binary by
 * `protocol:check`) or a live probe against the bundled binary.
 */
export const CODEX_CAPABILITIES: ProviderCapabilities = {
  mark: { state: 'available', kind: 'blossom' },
  loginRenewalMessage: {
    state: 'absent',
    reason: 'Starting a conversation does not send a message to renew its login.',
    checkedAgainst:
      '`codex/codex-runtime.ts`: `CodexRuntime.start` opens a thread without a separate login-renewal message.',
  },
  /**
   * Plan mode is the server's `collaborationMode: plan`, sent per turn in `TurnStartParams.collaborationMode`
   * (`collaborationModeFor` holds the accepted shape). It is not a safety gate: a planning turn still runs read
   * commands, but the agent proposes a plan instead of patching. The server keeps a thread planning until this app
   * switches the turn's mode back to `default`, so ending it is the app's gesture, not the model's.
   */
  planMode: {
    state: 'available',
    // Worded around what the person does, not around a limit: a planning Codex turn can still run shell
    // commands, so no copy may suggest the agent was forbidden to act.
    note: 'The agent researches and proposes first. You give the go-ahead, and it gets to work in the same conversation.',
  },
  /**
   * A written summary, and only because the adapter asks for one: `summary: REASONING_SUMMARY` (`'detailed'`) in
   * `runtime-parts/request-params.ts`. Without it `reasoning` items arrive empty. The server never delivers the
   * raw `content`, so what shows is a summary of the reasoning.
   */
  thinking: {
    state: 'available',
    note: 'A summary the model writes of its own reasoning — not the reasoning itself.',
  },
  /**
   * Sub-agents are parallel threads related by `parentThreadId`; there is no spawn RPC.
   */
  subAgents: { state: 'available' },
  /**
   * Through Codex's own `thread/compact/start`, which takes only `{ threadId }` and no instructions. The host
   * refuses `/compact <instructions>` in words rather than dropping them.
   */
  requestCompaction: {
    state: 'available',
    note: 'by /compact, which BroCrew turns into Codex’s own compaction request — Codex takes no instructions for one',
  },
  /**
   * `unwired`: Codex has `thread/revert` (history only, it does not revert local file changes) and nothing here calls
   * it. The `rollback(...)` calls in `codex-runtime.ts` are an unrelated in-memory helper from `next-turn.ts`.
   */
  rewind: {
    state: 'unwired',
    reason:
      'Codex can rewind a conversation’s history, but not the files its agent changed — it says itself that those are left as they are. It is not wired because rewind writes to your files where compaction only forgets: it needs a confirm step and a defined scope, and on Codex BroCrew would have to undo the file changes itself.',
  },
  /**
   * `account/login/start` with `type: 'chatgpt'` returns an `authUrl` and `account/login/cancel` cancels it, both
   * run against the bundled binary. The sign-in becomes its account's one sign-in (`codex/shared-sign-in.ts`).
   */
  signIn: {
    state: 'available',
    note: 'Signs in every Codex agent in this workspace.',
  },
  /**
   * `absent`: a Codex sign-in is never copied, from the codex CLI or from another profile. A copy shares its
   * renewal key with the file it came from, and whichever renews first spends the other's.
   */
  reprovisionAuth: {
    state: 'absent',
    reason: 'Codex agents share one sign-in per workspace, so there is nothing to copy.',
    checkedAgainst:
      '`codex/shared-sign-in.ts`: every Codex home links to its account’s one `auth.json`, which Codex 0.167.1 renews in place through the link (`login/src/auth/storage_file.rs`).',
  },
  /**
   * `prepareProviderHome` puts every Codex home on its account's one sign-in (`shareCodexSignIn`): the home's
   * `auth.json` is a link to `codex-sign-ins/<account>/auth.json` under the managed root.
   */
  homeCredential: {
    state: 'available',
    note: 'Every Codex agent in this workspace uses the one sign-in on the Codex card in Providers, or the API key saved there.',
  },
  /**
   * `absent`: Codex folded proactive multi-agent behaviour into the reasoning axis. `multiAgentMode` is deprecated
   * in the protocol in favour of `effort: 'ultra'`, which arrives per model from `model/list` as
   * `ModelChoice.efforts`. A second control would duplicate a level the reasoning menu already has.
   */
  ultracode: {
    state: 'absent',
    reason:
      'Codex has no separate switch for this — it folded proactive multi-agent work into the reasoning levels. Pick `ultra` under reasoning instead.',
    checkedAgainst:
      'The vendored Codex protocol at the pinned 0.160.0: `ReasoningEffort` is an open string with `ultra` supplied per model by `model/list` (`Model.supportedReasoningEfforts`), and the ONE field that was a separate mode — `multiAgentMode`, on both `TurnStartParams` and `ThreadSettingsUpdateParams` — is deprecated in the protocol itself with "Ignored. Use `effort: \'ultra\'` for proactive multi-agent behavior." No settings/orchestration field remains: `workflow`, `orchestrat` and `ultracode` appear nowhere in `src/codex/protocol/`.',
  },
  /**
   * Codex publishes skills and no slash commands: `skills/list` answers, and the app-server has no slash-command
   * concept (`/compact`, `/model`, `/usage` are CLI features). The `$` prefix is the provider's own.
   */
  childInput: {
    state: 'available',
    note:
      'A Codex sub-agent is a real thread with its own id, its own status and its own turns, and ' +
      'the app-server accepts direct input for it — measured live at 0.146.0. ⛔ Only while it is ' +
      'IDLE. A message sent to a child that is still working does not open a new turn: it joins ' +
      'the one in progress, ends it early, and the command that turn was running keeps going past ' +
      'its own reported completion. So BroCrew waits for the child to finish rather than talking ' +
      'over it, and says which of the two it is looking at.',
  },
  agentCommands: {
    state: 'available',
    note: "Codex's own skills, typed with a leading $. Codex publishes no slash commands over its app-server, so this list is skills and nothing else. /compact still works here: BroCrew turns it into Codex's own compaction request.",
  },
  /**
   * Codex streams `item/commandExecution/outputDelta` while a command runs, and a detached command keeps
   * emitting after `turn/completed`. The tail is an adapter buffer, so it lasts as long as the open
   * conversation; a conversation reopened from its ledger has the `tool_result` and no tail.
   */
  commandOutput: {
    state: 'available',
    note: 'Codex streams a command’s output as it runs, and keeps streaming after the turn ends — so a long command can be watched from the card that started it, while the conversation is open.',
  },
  /** The same stream continues after the turn ends. */
  backgroundCommandOutput: {
    state: 'available',
    note: 'Codex streams a background command’s output the same way, so it can be watched from its card while the conversation is open.',
  },
  /**
   * Read from `APPROVAL_PROFILES` in `runtime-parts/request-params.ts`: `ask` is `on-request` with
   * `workspace-write`, which is the Codex CLI's default preset (it writes in the folder and the temporary
   * folders without a card and asks for anything outside); `auto` is `never` with `danger-full-access`, which is
   * no sandbox at all, not a wide one. Both sandbox modes let the agent read the whole filesystem, so `ask`
   * buys consent, not reach, and the note says so once at the end. It leaves out what is true of both providers.
   */
  approvals: {
    state: 'available',
    note: 'On Codex this mode takes the sandbox off: with approvals on it writes in your folder and the temporary folders without asking, and cannot write anywhere else or reach the network unless you approve it or the config.toml of this identity opens it; with them off it runs danger-full-access, which applies no sandbox at all. Neither mode limits what it can read.',
  },
  /**
   * A granted server is declared through `ThreadStartParams.config` (`codexExternalMcpConfig`) and its tools reach
   * the agent through code mode; they are not enumerated in the model's developer message, so `available` means
   * the conversation is handed the server, not that the agent is handed a catalogue. A server's own elicitation
   * names the server and not the call (`handleExternalMcpElicitation`). In `auto` the app-server declines the
   * elicitation itself and nothing reaches this app. Codex has no deny vocabulary for a tool name.
   */
  externalMcpServers: {
    state: 'available',
    // Codex asks before a model's MCP call unless the server marks the tool read-only, or destructive-false with
    // open-world false, or the person chose to always allow it; in a conversation that does not ask it asks
    // nothing. All of it is said so nobody reads the first half as "every call is asked about". The key clauses
    // are pinned by name in `one-local-server-one-identity.test.ts`.
    note:
      'A server this identity may use is declared to the conversation, and its tools reach the ' +
      "agent through Codex's own code mode. In a conversation that asks you first, Codex asks " +
      'before one of them runs, naming the server, the tool and what it is given — except a tool ' +
      'the server itself marks as only reading, or as destroying nothing and reaching nothing ' +
      'outside, or one you chose to always allow, which Codex runs without asking, as it runs ' +
      'every tool in a conversation that does not ask. A request the server makes of its own ' +
      'names the server and not the call.',
  },
  /**
   * `absent`: a background terminal is never named by the stream and no `item/completed` arrives for it.
   */
  backgroundWake: {
    state: 'absent',
    reason:
      'A command Codex leaves running in the background never reaches the model again when it ends, so it drives nothing: work whose turn ended over one is stalled, as any other.',
    checkedAgainst:
      '`smoke/codex-background-probe.smoke.ts` against the bundled codex-cli 0.146.0 (`275`): no `item/completed` ever arrives for a background terminal, the stream names none, and `turn/completed` does not wait for it.',
  },
  /**
   * `absent`: no field of `TurnStartParams` or any `UserInput` variant names who sent a message.
   */
  turnProvenance: {
    state: 'absent',
    reason:
      'Codex has no field for who wrote a message, so every message reaches it the same way, whoever sent it.',
    checkedAgainst:
      'The vendored Codex protocol at the pinned 0.160.0: `TurnStartParams` and every `UserInput` variant (`text`, `image`, `localImage`, `audio`, `localAudio`, `skill`, `mention`) carry no sender, author or origin. `responsesapiClientMetadata` is request metadata for the Responses API, `additionalContext` is content keyed by an opaque source, and `turnTrigger` is an opaque "source classification for the caller that starts this turn" that names no author, and none of them says who wrote the turn. `origin` appears in `src/codex/protocol/` only as a git remote (`GitInfo.originUrl`), as where a config layer came from (`ConfigReadResponse.origins`), and as which client created a whole thread (`Thread.source`, `Thread.originator`), none of them per turn.',
  },
}

import type { ProviderCapabilities } from '../provider-capabilities'

/**
 * What the Claude adapter can do, declared in the shared provider registry (039).
 *
 * Read the rule in `../provider-capabilities.ts` before adding to this: the renderer is not allowed to know
 * which provider it is talking to, so every "Claude can, Codex cannot" fact in the product has to
 * arrive from here. Each entry names the artefact it was measured from — the pinned SDK is
 * `@anthropic-ai/claude-agent-sdk` 0.3.281 (680), and `apps/desktop/test/sdk-pin.test.ts` holds the
 * app and this package to one exact version. ⚠️ (Until 680 this said `check-protocol` held us to it;
 * that script checks the vendored CODEX protocol and has never read this SDK.)
 */
export const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  mark: { state: 'available', kind: 'letter' },
  /** `internal/claude-login-renewal.ts` renews an expired login with its one-message request. */
  loginRenewalMessage: { state: 'available' },
  /**
   * Wired through `Options.permissionMode: 'plan'` in `ClaudeRuntime.optionsFor`, where it also
   * takes precedence over yolo, because `permissionMode` is one field and cannot be both. Named by
   * SYMBOL and not by line: the number that used to be here pointed 150 lines wide of it, which is
   * what a reference maintained by hand is worth after a few dispatches.
   *
   * What happens then is that the MODEL calls `ExitPlanMode` as a tool, carrying the plan in its
   * input; the adapter reads it in `planDocument` and surfaces it as a user-input request, and
   * answering that request approves the plan. The session does not end there — it carries on and
   * does the work. Said precisely because the loose version ("it finishes by calling ExitPlanMode")
   * points a reader at the wrong surface when they come to wire Codex's.
   *
   * **The whole shape, as our own ledger recorded it** (056, `sess_423479cd…`, 2026-08-03):
   * `EnterPlanMode` → assistant prose → a `Write` of the plan file under the session's plans
   * directory → `ExitPlanMode{plan, planFilePath}` → the plan document, then the card. Two of those
   * are new since 030 and neither replaces `ExitPlanMode`: `EnterPlanMode` carries no plan at all
   * (its input is `{}`), and the file is a second copy of what is already on the wire.
   */
  planMode: {
    state: 'available',
    /**
     * The ENDING, which is the half the two providers do not share (057). It used to live in the
     * launcher's shared tooltip — "proposes a plan and waits for your approval before carrying it
     * out" — where it was Claude's behaviour stated as plan mode's. Codex's server keeps a
     * conversation planning until a client-side switch ends it, so that sentence promised an
     * ending that provider never reaches. It is a per-provider fact and it says so here.
     *
     * "…in this conversation" is the measured half and the reason this note is not just "waits for
     * your approval": the entry doc above records that the session does NOT end at `ExitPlanMode` —
     * it carries on and does the work — which is what a reader wiring the other provider needs to
     * know, and what the Codex note now has to contradict.
     *
     * ⚠️ **Still a separate note after 060, and deliberately so.** Both providers now finish a plan
     * with an approval and then get to work, which makes the two sentences read almost alike — but
     * what is being approved is not the same thing. Here the MODEL asks, on its own schedule,
     * through its own card; there the app offers a switch and the model never asks at all. Merging
     * them back into one shared line would re-make 057's mistake with the merge running the other
     * way.
     *
     * ⛔ **The second sentence was 140's — *"brobot2 refuses every tool that would change anything"*
     * — and `728` (R93) removed the floor it described.** ⚑ **Measured instead** (`probe:tool-calls-
     * as-the-cli`, bundled CLI, loopback, this app's hook out): the CLI's own plan mode asked before a
     * `Write`, an `rm` and an MCP tool, and ran `ls` and `wc -l` without asking. So the note says only
     * that. ⛔ It does NOT say *"before any tool that would change something"* or *"before it writes a
     * file"* (`728`'s review): the CLI writes its own memory and its own plan file unasked, so the note
     * says *your files*. ⚑ **"even in a conversation that does not otherwise ask you first"** is
     * measured on the flow a person has (`enter-plan-*-auto`): a session that may skip permissions,
     * the model's own `EnterPlanMode`, then the call — the CLI still asked before the `Write`, the
     * `rm` and the MCP tool, and this app's `auto` leaves those asks to the person
     * (`handleCanUseTool`).
     */
    note:
      'It proposes a plan, waits for your approval, and then carries it out in this conversation. ' +
      'While it is planning, Claude’s own plan mode governs what it does: it asks you before it ' +
      'changes your files, runs a command it cannot tell is harmless, or uses a server’s tool, even ' +
      'in a conversation that does not otherwise ask you first.',
  },
  /**
   * A token ESTIMATE, never the words.
   *
   * The estimate arrives on its own: the SDK sends a `thinking_tokens` system message, caught at
   * `normalize.ts:168`, and **the adapter sets no `Options.thinking` at all** — worth stating, since
   * 027's measurement note mentions that option and it is easy to read as our mechanism. What 027
   * measured is why there is no text to show: every `thinking_delta` captured live carried
   * `thinking:""`, 20 of 20, and switching the option on yields a block that is empty but signed. So
   * the adapter populates `tokens` and sets `redacted`, and `text` stays absent.
   *
   * The note is worded as what the user GETS, because the alternative wording ("no thinking text")
   * reads as the model not thinking.
   */
  thinking: {
    state: 'available',
    note: 'How much it thought — the provider redacts the reasoning itself, so the words are never sent.',
  },
  /** The SDK's `Task` tool; 035 governs what we are willing to claim about what they did. */
  subAgents: { state: 'available' },
  /**
   * 🔴 **713 · `available` — through the CLI's own `/compact`, sent exactly as a person types it.**
   *
   * ⛔ **It was `absent` from 087 until 713, and the reason given was true of the SDK and false of
   * the product.** *"Claude announces a compaction but has no method to request one"* — checked
   * against the 39 control-request subtypes of Agent SDK 0.3.281 (40 at 0.3.287, the new one
   * `get_task_output`), none of which compacts. ⚑ **But
   * the CLI the SDK drives compacts on its own `/compact`**, and since `708` (`R42`) a person's
   * `/compact` reaches it as typed rather than inside a frame that made it words: `smoke:ui` step 62
   * measured a real `compact_boundary` from a person's `/compact`, and the CLI's own transcript
   * recorded it as a command. `R60` rules that *"Compact now…"* goes the same road — the person's
   * `/compact`, stamped `person`.
   *
   * ⚠️ **So "can be asked" is a claim about the PERSON'S command, and nothing else.** An agent's
   * `/compact` is framed words and compacts nothing (`R42`'s *"a person's only"*); there is still no
   * SDK method, and the `checkedAgainst` that said so is what this note replaces.
   *
   * ⚑ **`available` is one half of what lights the Dropped tab's control** (`R60`, built by `718`):
   * the other is the conversation's own send facts, and the press asks a confirm before the
   * person's `/compact` goes (`compaction-offer.ts`).
   */
  requestCompaction: {
    state: 'available',
    note: 'by /compact, which BroCrew sends to Claude exactly as you type it, instructions and all',
  },
  /**
   * **Rewind** (096, ruled in 092) — ⚠️ **`unwired` rather than `absent`, and the reason is what
   * `absent` requires.** (It used to point at the entry above, then an `absent` with a place it had
   * looked; 713 made that one `available`, so the contrast now lives in `CapabilityStatus`'s
   * `absent` arm and its `checkedAgainst`.)
   *
   * 092 filed it as absent, quoting *"they appear in zero source… the doc has been wrong twice"*.
   * That is true of **our** source and false of the SDK: `enableFileCheckpointing` is declared at
   * `sdk.d.ts:1629`, `rewindFiles(userMessageId, {dryRun})` at `:2980`, returning `RewindFilesResult`
   * at `:3203` — read at the pinned version, not inferred from a doc. `absent` requires
   * `checkedAgainst`, and there is no honest sentence to put there: the API exists.
   *
   * So the true statement is that we have not wired it, and the reason is not availability.
   */
  rewind: {
    state: 'unwired',
    reason:
      'Claude can do this — `enableFileCheckpointing` plus `rewindFiles()`, both declared in the pinned SDK. It is not wired because rewind writes to your files: it needs a confirm step, a defined scope (one file, the turn, the conversation), and an answer for edits you made by hand since. Compaction only forgets and was deferred for less.',
  },
  /**
   * **`absent`, for two independent reasons, and the second one is the interesting one** (098).
   *
   * The obvious reason is that the SDK has no verb: `Query` exposes `accountInfo()` — a "who am I",
   * which is the half of this that Claude *does* have — and declares nothing that starts a login.
   *
   * ⚠️ The reason that matters more is that there would be **nothing to sign in to**. Codex needs
   * this because its credential is a COPY that can drift from the machine's and go stale; Claude's
   * profile home holds no credential at all. `claudeKeychainTokenProvider` re-reads the machine
   * Keychain on every launch and injects the access token transiently, and macOS holds exactly one
   * `Claude Code-credentials` item — so a Claude profile home is never out of date, and switching
   * machine profiles is picked up on the next launch with no gesture at all.
   *
   * A future reader who sees `absent` and reaches for a login verb should read that paragraph first:
   * adding one would give this app a second Claude credential to keep in sync, which is the problem
   * 098 exists to remove from the other provider.
   */
  signIn: {
    state: 'absent',
    reason:
      'Claude sessions run on the API key saved under “API key” on the Claude card in Providers, or, with none saved, on your machine login directly — there is no separate sign-in here to renew. Without a saved key, switching profiles on your machine is picked up the next time you start a conversation.',
    checkedAgainst:
      'Claude Agent SDK 0.3.281 (exact-pinned): `Query` declares `accountInfo()` (sdk.d.ts:2971) and no login/authenticate verb anywhere in the declaration file; `forceLoginMethod`/`forceLoginOrgUUID` are settings the CLI reads, not methods we can call. And `internal/auth.ts` copies no Claude credential into the profile home (015), so there is none to renew.',
  },
  /**
   * `absent` for the second half of the same fact, and it needs saying separately: there is nothing
   * to copy INTO. 015's hard rule is that no Claude credential is ever written to the profile home —
   * the machine Keychain is re-read per launch and the access token injected transiently — so a
   * "copy my machine sign-in" gesture has no destination.
   *
   * ⚠️ The reason a user reads is an instruction rather than an explanation, because there IS
   * something they can do: starting a Claude conversation has their own Claude Code renew an expired
   * login. ⚑ It names no command, so it reads the same on every computer: how to run Claude Code by
   * hand is said by the login's own sentence, with the program this computer has. Refreshing it from
   * here would be the shared-token stomp that broke Codex.
   */
  reprovisionAuth: {
    state: 'absent',
    reason:
      'There is nothing to copy — with no API key saved, Claude sessions read your machine login directly. If it has expired, starting a Claude conversation renews it.',
    checkedAgainst:
      '`internal/auth.ts` (015): `provisionCodexAuth` copies ONLY the Codex `auth.json`; the Claude bridge is `claudeKeychainTokenProvider`, which re-reads the macOS Keychain on every launch and persists nothing. Verified on this machine with `security find-generic-password`: exactly one `Claude Code-credentials` item, machine-wide, and no Claude credential file in any profile folder we provision.',
  },
  /**
   * **`absent`, and here that is the reassurance rather than the limitation** (329).
   *
   * ⚠️ **The reason a user reads is the disclosure.** On Codex a profile's folder starts out holding
   * a copy of the machine's login; on Claude it holds nothing at all, and a person choosing a
   * profile has no way to tell those apart from a screen that says the same thing to both. That is
   * `039` in copy rather than in code — the launcher's own line used to promise *"the sessions and
   * sign-in kept there"*, which was true of one provider and false of this one.
   *
   * ⛔ **`absent` and not `unwired`: nothing here is waiting to be built.** 015 ruled that no Claude
   * credential is ever written into a folder we provision, and the design that replaces it —
   * re-read the Keychain per launch, inject the access token into the child's environment for that
   * run — is finished and shipping. Wiring a copy would be the shared-token stomp that broke Codex.
   */
  homeCredential: {
    state: 'absent',
    // ⛔ **It says CLAUDE writes nothing, not that nothing is written** (corrected in 329's own
    // review). A profile's folder is per provider — `<userData>/provider-homes/default/<profile>/
    // <provider>` — and the launcher's model probe asks BOTH providers about the selected profile,
    // so the same profile name can hold a Codex credential while this sentence is on screen. An
    // unscoped *"nothing of your sign-in is written into this profile"* would be a true statement
    // about this adapter read as a false one about the profile, which is `009` by omission.
    reason:
      'Claude writes nothing of your sign-in into this profile. Claude sessions read the saved API key, or with none your machine login, at the moment they start and pass it to the agent for that run only, so there is no Claude copy here to go stale.',
    checkedAgainst:
      '`provider-homes.ts`: `prepareProviderHome`’s Claude branch calls `claudeAuthHealth` and writes no file — `provisionCodexAuth` is the only writer of a credential into a folder we provision, and it is reached only when `identity.provider === "codex"`. The token comes from `claudeKeychainTokenProvider` (re-read per call, deliberately: the macOS Keychain item, or on Windows Claude Code’s own `.credentials.json`) and reaches the child through `internal/child-env.ts` alone. `credential-disclosure.test.ts` runs both branches against a temp home and asserts this one leaves nothing behind.',
  },
  /**
   * **`ultracode`** (106) — `Settings.ultracode`, `sdk.d.ts:8967`, a `boolean` near `effortLevel`
   * rather than inside it. Wired through `Options.settings` at launch in `ClaudeRuntime.start`.
   *
   * ⚠️ **`available` is the narrowest true statement here, and the note is doing most of the work.**
   * The SDK's own description (0.3.287) is *"standing dynamic-workflow orchestration at any effort
   * level. Session-scoped — typically provided via --settings or the apply_flag_settings control
   * request; **interactive toggles never persist it**. Requires workflows to be enabled and a model
   * that supports ultracode."* ⚠️ Until 0.3.281 it was *"xhigh effort plus …"* and needed an
   * xhigh-capable model; CLI 2.1.287 no longer ties it to effort at all. Two of those clauses are
   * limits this app cannot check on the user's
   * behalf, so the honest thing is to offer the mode and say what we do not know, rather than to
   * claim a state or to hide a control we cannot explain.
   *
   * **What 106 measured, because a declared setting is not an accepted one**
   * (`smoke/model-effort-probe.smoke.ts`, real login, no turn, no tokens):
   *
   *  - Asked for at launch, asked for mid-session via `applyFlagSettings`, and asked for on `haiku` —
   *    a model that reports no effort support at all — the CLI **accepted all three with no error**.
   *  - ⚠️ And so did `{brobot2NotARealSetting: 'certainly-not'}`. **The acceptance means nothing**:
   *    the CLI does not validate keys on this path, and there is no readback — `initializationResult`
   *    carries commands/agents/models/account and no settings echo, and `SDKSystemMessage.tools`
   *    (the one signal that would show the Workflow tool) needs a real conversation to arrive.
   *
   * That is why the note says *asked for* and never *on*, and why nothing built on this may report
   * it as a running state. It is also why there is no live toggle: a control that reported success
   * it could not verify is the 085/099 shape, and this one could never do better.
   */
  /**
   * ⛔ **Measured, not read off the type** (279). `probe:provider-commands` opened a real login with
   * a prompt that never yields — no turn, no tokens — and read `initializationResult()`:
   *
   * ```
   * 44 rows in 1 918 ms · supportedCommands() then returned the same 44 names in 0 ms (cached)
   * /clear /compact /context /effort /model /usage …  ← built-ins
   * /code-review /deep-research /dataviz /verify …    ← skills
   * 44 of 44 carry a description · 17 an argumentHint · 7 aliases
   * ```
   *
   * ⚑ **The list is not fixed for the session**, which is why the adapter has a second producer:
   * `commands_changed` pushes a whole replacement *"after a mid-session change (e.g. skills
   * discovered dynamically as the agent works in a subdirectory)"*.
   */
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
  ultracode: {
    state: 'available',
    note: 'Asks Claude to organise multi-agent work on its own, at whatever effort the conversation runs. Fixed when the conversation starts, for that run only — Claude never reports back whether it took — and it needs Workflows enabled on your account and a model that supports it.',
  },
  /**
   * ⛔ **`absent`, and it took a live turn to be allowed to say so** (300 §3).
   *
   * ⚠️ **The type reading alone would not have earned this state.** `Query` declaring no output
   * reader is a claim about the SCHEMA, and `226`'s rule — absence in a capture is not absence — has
   * the same force for a `.d.ts` as for a wire log. `030` and `029` are this project's two shipped
   * `absent`s that were false, and both were type readings.
   *
   * ⚑ **So it was measured.** `probe:command-output` ran a twelve-second command that printed a
   * nonce only the process could produce — `$$`, the shell's own pid, which the model cannot guess —
   * and watched every frame with `includePartialMessages: true`, wider than this app's own launch.
   * **45 frames; none carried it before the receipt.** The detached row was the same and shorter.
   *
   * ⚠️ **`245`'s finding is the third leg and the reason this is about the provider rather than our
   * pin**: a running task's output is read by a **tool the model calls**, so the bytes are delivered
   * to the agent's own context. There is no host on that channel, and adding a method to `Query`
   * would not put one there. ⚑ (680: 245 named that tool `TaskOutput`; 0.3.281 removed it and says
   * *"Read a background task's output file with the Read tool instead"* — `sdk.d.ts:7000`. Same
   * channel, another tool.)
   *
   * ⚠️ **0.3.287 opened a host door for BACKGROUND commands only**: the `get_task_output` control
   * request (`sdk.d.ts:4207`) answers *"at most the last 8 KiB"* of a running background shell or
   * Monitor task, polled by the host. A foreground command still has none. BroBot does not ask for
   * it; whether to show a background command's output live is a product decision, so the state
   * stays `absent` and the reason says which half is which.
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
   * ⚑ **`unwired`: Claude has a reader for a background command's output, and BroBot does not use it
   * yet** (provider follow-ups 1). `get_task_output` (`sdk.d.ts:4207`, 0.3.287): *"Reads the end of
   * one background shell or Monitor task's output: at most the last 8 KiB the command wrote … a host
   * polls it while the task runs, and can read it once more after the task ends."* Wiring it is a
   * product decision W4 has deferred.
   */
  backgroundCommandOutput: {
    state: 'unwired',
    reason:
      'Claude can hand over the last part of a background command’s output while it runs, but BroCrew does not ask for it yet.',
  },
  /**
   * 🔴 **On Claude there is no sandbox to come off, and that is the disclosure** (367,
   * HO-011 §3.2).
   *
   * ⛔ **Two facts from this adapter, in the order they decide the outcome** (three until `726`):
   *
   *  1. `permissionModeFor` uses `default` for non-planning sessions rather than SDK `bypassPermissions`.
   *  2. `promptGuardHooks` and `handleCanUseTool` allow in automatic mode except while planning, where the CLI's own flow still asks and the card reaches the person. The card is what automatic mode removes.
   *  3. The app adds no protected-folder refusal above that permission flow.
   *
   * ⚠️ **So the honest Claude sentence is shorter than the Codex one**: there was never confinement
   * to lose, in either mode. ⚑ `171` fixed the vocabulary for this and stopped one surface short of
   * the mode's own name; this is that sentence, per provider, where `171` had one for both.
   *
   * ⛔ **A first draft ended *"a tool call that names a path inside this app's own data is still
   * refused"*, and a screenshot of the shipped launcher is what retired it.** It rendered directly
   * after `YOLO_MEANS`, which says a command *"can reach anything you can — this app's own data …
   * included"* — so the paragraph asserted and then withdrew the same fact, and the withdrawal read
   * as the reassuring half. Both clauses were true (one is about a structured call, the other about
   * a shell command) and together they were worse than either. ⚑ `367 §6`: *"if a mode's true
   * sentence turns out to be shorter and more alarming than the one I have sketched, ship the true
   * one."* What survived named the HOLE — the check reads paths, a shell command has none — without
   * offering the guarantee beside it; `726` · R92 removed the check, and that clause with it.
   */
  approvals: {
    state: 'available',
    note: 'On Claude nothing is sandboxed in either mode. What this mode removes is the card, except while Claude is planning: its own plan mode still asks, as the CLI’s does.',
  },
  /**
   * ⚑ **516 · measured against the pinned SDK and the door downstream of it.** `Options.mcpServers`
   * accepts `{type:'http', url}` (`sdk.d.ts:1114`), and an external server's tool is not one of
   * BroBot's rail-complete exemptions — so it reaches `canUseTool` and cards (`507` §1.1).
   *
   * 🔴 **728 · R93 — both clauses re-measured against the CLI's OWN engine** (`probe:tool-calls-as-
   * the-cli`, bundled CLI, loopback): with BroBot's hook out, the CLI itself asked before an MCP
   * tool AND before one its server marks `readOnlyHint` — so *"each of its tool calls asks you"* is
   * the CLI's behaviour in `ask`, not this app's added card. ⚑ **And a server's own form now reaches
   * the person** ({@link ClaudeSessionHandle.handleElicitation}); until `728` the SDK declined every
   * one unseen, which the old note did not say. ⛔ *"the same way every other consequential action
   * does"* went: R93 removed the card BroBot added before calls the CLI runs unasked (`Bash ls`), so
   * the comparison stopped being a fact.
   */
  externalMcpServers: {
    state: 'available',
    note: 'A server this identity may use is passed to the session as a known MCP server. In a conversation that asks you first, each of its tool calls asks you before it runs, whatever the server says about the tool — unless you allowed that tool for the conversation or kept a rule that allows it — and a form the server sends reaches you to answer.',
  },
  /**
   * ⚑ `sdk.d.ts:5136` says an unattributed turn *"fails closed at strict `isHuman()` trust gates"*.
   * A `peer` stamp changes nothing in what the model is handed. See `claudeOriginOf` in
   * `claude-runtime.ts`. ⚑ `probe:claude-origin-wire` measured the whole model-bound request
   * byte-identical for no stamp, `human` and `peer`, which is what this note says.
   */
  // 🔴 **D-013** — measured (`session-machine.ts`' unbidden burst): a backgrounded `Bash` woke the
  // agent 18.3 s after its turn had ended, and a scheduled job woke the session twice. ⚑ D-040 · a
  // background sub-agent's end does too: the bundled CLI queues it as a `task-notification` and
  // runs a turn for it.
  backgroundWake: {
    state: 'available',
    note: 'A command or a sub-agent left running in the background, or a scheduled wake-up, runs Claude again when it ends or fires, with nobody sending a message. So work whose turn ended with one pending reads as working in the background, not as stalled.',
  },
  turnProvenance: {
    state: 'available',
    note: 'What you type in the composer is marked as typed by a person, which Claude needs before a keyword such as `ultracode` in it takes effect. A message another agent sends is marked with that agent, a mark this Claude version does not keep. The app’s own messages carry no mark, including the ones that pass on an answer or a reply.',
  },
}

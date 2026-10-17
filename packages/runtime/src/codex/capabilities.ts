import type { ProviderCapabilities } from '../capabilities'

/**
 * What the Codex adapter can do, declared beside the adapter that does it (039).
 *
 * Read the rule in `../capabilities.ts` before adding to this. Each entry names the artefact it was
 * measured from — the vendored protocol in `./protocol/`, generated from our pinned tag
 * `rust-v0.160.0` and held to the bundled binary by `check-protocol`. ⚠️ Entries measured live say
 * which version they were measured on; most were taken on 0.146.0 and not re-run on the bump.
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
   * ⚠️ **`available` since 057 — and the three states this one entry has held are this file's whole
   * argument.** 030 said Codex had no plan mode, reasoning from `enteredReviewMode` (a review
   * concept that really never fires) and hardening it into a comment, a launcher branch and a test.
   * 044 falsified that for free against our own vendored types and moved it to `unwired`, while
   * warning that presence in a generated type is a SCHEMA verdict and not proof the server
   * implements it. 057 asked the server.
   *
   * **The probe** — bundled 0.146.0 binary, isolated `CODEX_HOME`, no turn started:
   *
   * ```
   * → {"method":"collaborationMode/list","params":{}}
   * ← {"data":[{"name":"Plan","mode":"plan","model":null,"reasoning_effort":"medium"},
   *            {"name":"Default","mode":"default","model":null,"reasoning_effort":null}]}
   * ```
   *
   * Implemented, not merely declared. It rides `TurnStartParams.collaborationMode` — the per-turn
   * override 034 established for the approval profile — and `codex-runtime.ts`'s
   * `collaborationModeFor` holds the exact shape the server accepts, measured field by field.
   *
   * **What it DOES, measured here rather than borrowed from Claude.** One plan-mode turn and one
   * default-mode control, same prompt, same read-only sandbox, same effort:
   *
   * | | plan | control |
   * |---|---|---|
   * | plan document (`{type:'plan', text}`) | **1**, 1,049 chars of markdown | 0 |
   * | file writes attempted | **0** | 2, both asking approval |
   * | shell commands run | 1 | 1 |
   * | `turn/plan/updated` (the checklist) | 0 | 0 |
   *
   * ⚠️ So plan mode is **not a safety gate here either** — the planning turn still ran
   * `/bin/zsh -lc "pwd && rg --files … && sed -n '1,240p' hello.js"`. What changed is what the agent
   * reached FOR: it proposed instead of patching. Same lesson as 026's Claude `Write`, measured
   * independently on this provider instead of assumed from that one.
   *
   * ⚠️ **The note used to name a gap, and 060 closed it.** The server's own plan-mode instructions
   * — 9,156 characters it injected where we sent `developer_instructions: null`, read back off
   * `thread/settings/updated` — say *"You are in Plan Mode until a developer message explicitly ends
   * it"*. 057 sent no such message and said so in the launcher rather than faking an ending. 060
   * measured what the message actually is: **switching the turn's `collaborationMode` to
   * `{mode:'default'}`**, which the server treats as the ending itself. A control thread that sent
   * nothing on its second turn re-planned; the one that switched wrote the file. So the note now
   * describes an ending that exists — and still says WHOSE gesture it is, because that is the part
   * that genuinely differs: Claude's plan mode ends when the user answers the model's own
   * `ExitPlanMode` card, Codex's ends when this app says so.
   */
  planMode: {
    state: 'available',
    // Still worded around what the USER does, not around the provider's limits — the sentence 030
    // got wrong about this exact capability. "You give the go-ahead" is the honest description of a
    // client-owned exit: it says a gesture is needed and says it is here, without implying the
    // agent was previously forbidden to act. It was not — a planning Codex turn still runs shell
    // commands (see the table above), and no copy in this feature may suggest otherwise.
    note: 'The agent researches and proposes first. You give the go-ahead, and it gets to work in the same conversation.',
  },
  /**
   * A written SUMMARY, and only because we ask for one: the adapter sets `summary: REASONING_SUMMARY`
   * — `'detailed'`, `codex-runtime.ts:894` — on `turn/start` (027). Without it, `reasoning` items
   * arrive `{summary:[],content:[]}`; that is why this is `available` rather than `unwired`, and it
   * would stop being true the moment that line changed. `content` is
   * never delivered by the server at all, so what we show is a summary OF the reasoning and never
   * the raw chain of thought — the note says so rather than letting it be read as the latter.
   */
  thinking: {
    state: 'available',
    note: 'A summary the model writes of its own reasoning — not the reasoning itself.',
  },
  /**
   * ⚠️ 029 declared this impossible below `ultra` effort and wrote it into a test. 033 disproved it
   * on the wire: four sessions at the ordinary `medium` default spawned sub-agents the moment they
   * were asked to, and every one was reported. There is no spawn RPC — they are parallel threads,
   * related by `parentThreadId` — but the capability is real and we render it.
   */
  subAgents: { state: 'available' },
  /**
   * 🔴 **713 · `available` — through Codex's own `thread/compact/start`, which `R59` wired.**
   *
   * ⛔ **It was `unwired` from 087 until 713, waiting on TWO things: the asymmetry resolved, and a
   * confirm step.** ⚑ **The first is resolved** — Claude compacts on the person's `/compact` since
   * `708` (see its declaration), and a person's `/compact` here now runs Codex's own compaction
   * instead of reaching the model as words (`R59`; `SessionHandle.compact`). ⚑ **The second was
   * the frontend's** (`R60`), and `718` built it: the Dropped tab's control is live, asks a confirm,
   * and sends the person's bare `/compact` — the one spelling Codex takes.
   *
   * ⚑ **Measured on the bundled 0.146.0** (`probe:codex-command-as-typed`): the request answers
   * `{}`, then runs as a turn of its own whose `contextCompaction` item is the transcript's
   * compaction row. ⛔ **It takes no instructions** — `{ threadId }` is the whole params type, and an
   * `instructions` field was accepted and dropped — so the note says so, and the host refuses
   * `/compact <instructions>` in words rather than losing them.
   */
  requestCompaction: {
    state: 'available',
    note: 'by /compact, which BroCrew turns into Codex’s own compaction request — Codex takes no instructions for one',
  },
  /**
   * **Rewind** (096, ruled in 092). Until 0.146.0 Codex had only `thread/rollback`, marked *"will be
   * removed soon"*; 0.160.0 removed it and added `thread/revert` (`ThreadRevertParams.ts`): *"Replace
   * a paginated thread's durable history with the prefix before one turn. This only changes
   * persisted conversation history. It does not revert local file changes."* We call it nowhere.
   *
   * ⚠️ The `rollback(...)` calls in `codex-runtime.ts` are an unrelated in-memory optimistic-value
   * helper (`next-turn.ts`) — a reader who greps for the word finds those first, and they are not this.
   */
  rewind: {
    state: 'unwired',
    reason:
      'Codex can rewind a conversation’s history, but not the files its agent changed — it says itself that those are left as they are. It is not wired because rewind writes to your files where compaction only forgets: it needs a confirm step and a defined scope, and on Codex BroCrew would have to undo the file changes itself.',
  },
  /**
   * **`available`, and asked rather than read off a type** (098). `account/login/start` is in the
   * generated client-request union, which 044 already established is a schema verdict and not proof
   * the server implements it — so it was run, in a real empty profile home, against the bundled
   * 0.146.0 binary:
   *
   * ```
   * → {"method":"account/login/start","params":{"type":"chatgpt"}}
   * ← {"type":"chatgpt","loginId":"8ed7a419-…","authUrl":"https://auth.openai.com/oauth/authorize?…"}
   * → {"method":"account/login/cancel","params":{"loginId":"8ed7a419-…"}}
   * ← {"status":"canceled"}
   * ```
   *
   * The note is about the consequence rather than the mechanism, because the consequence is the
   * reason to prefer this over re-copying the machine credential — which works, and works again
   * only until the next rotation.
   */
  signIn: {
    state: 'available',
    note: 'Signs this profile into its own Codex account. Unlike copying your machine sign-in, it does not share a token with the codex CLI, so neither one can expire the other.',
  },
  /**
   * `available`, and it is `reprovisionCodexAuth` — the one function allowed to overwrite a profile
   * credential, reachable only by an explicit gesture. The note says what it does NOT do, because
   * that is the part a user has to know before choosing it over `signIn` above.
   */
  reprovisionAuth: {
    state: 'available',
    note: 'Copies the sign-in from your machine`s codex CLI again. Quick, but the two keep sharing one token, so the next renewal by either will expire the other.',
  },
  /**
   * **`available` — and the two words that matter are "already" and "nobody asked"** (329).
   *
   * `prepareProviderHome` calls `provisionCodexAuth(home, {managedRoot})` for every Codex home it
   * touches, and that function copies the CONTENT of `~/.codex/auth.json` into the folder once, at
   * `0600`, through an `O_EXCL|O_NOFOLLOW` temp and a no-clobber `link` — never a symlink, never an
   * overwrite, and {@link AuthUnavailableError} rather than a fallback when the machine has no
   * credential to copy. `328` measured the file appearing in a fresh `--user-data-dir` five seconds
   * after launch with nothing sent.
   *
   * ⚠️ **The note says WHAT is in the folder, not what to do about it, and that boundary is
   * deliberate** (169 §1). The shared-token consequence — *"whichever renews it next expires the
   * other"* — belongs to {@link signIn} and {@link reprovisionAuth}, where a person is choosing
   * between two remedies and can act on it. Repeating it here would put one rule in three places
   * and make a disclosure read as a warning about a decision nobody is being asked to make.
   *
   * ⛔ **Not inferrable from {@link reprovisionAuth} being `available`.** That is a button; this is
   * something that has already happened.
   */
  homeCredential: {
    state: 'available',
    // ⛔ **"Where your machine has one", because it does not always** (corrected in 329's own
    // review). `provisionCodexAuth` throws `AuthUnavailableError` rather than copying when
    // `~/.codex/auth.json` is absent, and `startCodexLogin` mints a credential into the folder that
    // was never the machine's at all — which is the half `308` added to the Info panel's own
    // sentence and this one had dropped. ⚑ The minting gesture is NOT named here: `SignInPanel`
    // owns it and `credential-words.ts` owns its words (169 §1).
    note: 'This profile keeps a sign-in of its own — or, while an OpenAI API key is saved under “API key” on the Codex card in Providers, that key instead. Where your machine’s Codex CLI has one, it starts as a copy of that; where it has none, as a copy of BroBot’s own. The copy is made once, is readable only by you, and is never replaced on its own.',
  },
  /**
   * ⚠️ **`absent`, and the reason is the most interesting fact 106 turned up: Codex made the
   * opposite decision, on purpose.**
   *
   * Codex moved proactive multi-agent behavior onto its effort axis. Its protocol deprecates the separate switch in favor of `effort: "ultra"` (`protocol/v2/TurnStartParams.ts:102` and `protocol/v2/ThreadSettingsUpdateParams.ts:60`). That differs from Claude's separate ultracode setting.
   *
   * So on Codex there is nothing left to switch on: `ultra` is a value of
   * `Model.supportedReasoningEfforts`, it arrives per model from `model/list`, and it already reaches
   * this app as {@link ModelChoice.efforts} and already appears in the reasoning menu. Claude went
   * the other way and kept the orchestration mode OUT of `EffortLevel` as its own boolean.
   *
   * ⚠️ **Which means offering a second Codex control here would duplicate a level the menu already
   * has** — the same state reachable two ways, which 076 refused by name. `absent` with this reason
   * is what keeps the two apart in data, so no surface has to remember the distinction.
   *
   * The reason a user reads is an instruction, because there IS something they can do, and it is one
   * field away.
   */
  ultracode: {
    state: 'absent',
    reason:
      'Codex has no separate switch for this — it folded proactive multi-agent work into the reasoning levels. Pick `ultra` under reasoning instead.',
    checkedAgainst:
      'The vendored Codex protocol at the pinned 0.160.0: `ReasoningEffort` is an open string with `ultra` supplied per model by `model/list` (`Model.supportedReasoningEfforts`), and the ONE field that was a separate mode — `multiAgentMode`, on both `TurnStartParams` and `ThreadSettingsUpdateParams` — is deprecated in the protocol itself with "Ignored. Use `effort: \'ultra\'` for proactive multi-agent behavior." No settings/orchestration field remains: `workflow`, `orchestrat` and `ultracode` appear nowhere in `src/codex/protocol/`.',
  },
  /**
   * ⛔ **Codex publishes SKILLS and no slash commands, and that is a measurement rather than a
   * reading** (279). `279` §1 named three candidate surfaces and said not to assume any of them is
   * Claude's list; `probe:provider-commands` asked all three and a fourth against the bundled
   * 0.146.0 binary, before any thread started:
   *
   * ```
   * → skills/list             ← 6 rows · imagegen, openai-docs, plugin-creator, review-agent,
   *                             skill-creator, skill-installer — every one `scope:"system"`
   *                             (0.159.0 removed `plugin-creator`; not re-run on 0.160.0)
   * → plugin/list             ← {"marketplaces":[],"marketplaceLoadErrors":[],"featuredPluginIds":[]}
   * → collaborationMode/list  ← Plan, Default          ← MODES, not commands
   * → hooks/list              ← {"data":[{…,"hooks":[]}]}
   * ```
   *
   * ⚠️ **`/compact`, `/model` and `/usage` are Codex CLI features that its app-server does not
   * publish** — the protocol has no slash-command concept at all (`slash` appears in the vendored
   * types only inside path helpers). So the honest sentence is not *"we have not asked"*: we asked.
   *
   * ⚑ **The `$` is the provider's own.** Three of the four skills that ship an
   * `interface.defaultPrompt` write themselves `$name` in it — *"Use $imagegen to make or edit an
   * image for this project."* — and none writes `/name`.
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
   * ⛔ **Measured on the wire, twice, before a line of this was built** (300 §3) —
   * `pnpm run probe:command-output`, bundled 0.146.0.
   *
   * ```
   *  11647 ms · item/commandExecution/outputDelta item=exec-14dfe485-… "tick-2\n"
   *  12659 ms · item/commandExecution/outputDelta item=exec-14dfe485-… "tick-3\n"
   *   tool_call id=exec-14dfe485-…   ⚑ the SAME string
   * ```
   *
   * ⚑ **And it does not stop at the turn**, which is what makes it worth having: a detached command
   * emitted **39 more frames after its own `turn/completed`**, still ticking. `247`'s definition of
   * this subject is work that outlives the turn, and this is the only channel that follows it there.
   *
   * ⚠️ **The note says "while the conversation is open", because that is the real bound.** The tail
   * is a buffer in the adapter, not a file: it lives as long as the session does and no longer. A
   * conversation reopened from its ledger has the `tool_result` and no tail, which is the honest
   * state and the one `unfinished` already describes.
   */
  commandOutput: {
    state: 'available',
    note: 'Codex streams a command’s output as it runs, and keeps streaming after the turn ends — so a long command can be watched from the card that started it, while the conversation is open.',
  },
  /** ⚑ The same stream, after the turn ends too — 300's live probe: 39 output frames after `turn/completed`. */
  backgroundCommandOutput: {
    state: 'available',
    note: 'Codex streams a background command’s output the same way, so it can be watched from its card while the conversation is open.',
  },
  /**
   * 🔴 **On Codex, yolo is an OS sandbox coming off** (367, HO-011 §3.2).
   *
   * ⛔ **Read straight off `APPROVAL_PROFILES` in `codex-runtime.ts`, which is the only place this
   * adapter decides it**: `ask` opens the thread with `approvalPolicy: 'on-request'` and
   * `sandbox: 'workspace-write'` (🔴 since `736`, R96 — the Codex CLI's own default preset; until
   * then `read-only`); `auto` opens it with `approvalPolicy: 'never'` and
   * `sandbox: 'danger-full-access'`. Both values are the generated `SandboxMode` strings from the
   * vendored protocol, not guesses.
   *
   * ⚠️ **`danger-full-access` is not a wide profile, it is the ABSENCE of one**, which is the half
   * a reader gets wrong. `160` measured `ps` and `top` exiting 0 under `dangerFullAccess` on the
   * pinned binary, where they fail *"Operation not permitted"* under a sandbox. So the sentence
   * says *no sandbox at all* rather than *a wide one*.
   *
   * ⛔ **…and `366` corrected which axis that is about.** `codex-runtime.ts`'s `160` note still
   * attributes the loss of `ps`/`top`/`sudo` to `157`'s NAMED permission profile — *"the cost was
   * the profile"*. `366` re-measured `read-only`, a legacy mode with `activePermissionProfile:
   * null`, and it fails `ps` too. **The axis is any Seatbelt policy versus none**, so this note
   * says *a sandbox* and not *a named profile*. (That product comment is outside `367`'s scope and
   * `366` left it for the PM; this entry is written from the corrected fact rather than from it.)
   *
   * 🔴 **THE LAST SENTENCE IS THE ONE THIS ENTRY EXISTS FOR, and `366` is why it is there.**
   * *"Runs read-only"* was the first draft, and it reads as CONTAINMENT. It is not: `366` planted a
   * file outside the workspace and read it successfully under `read-only`, `workspace-write` and
   * `workspace-write`+net alike, and `runtime.ts` recorded the general form (in the
   * `protectedRoots` docblock `726` removed) — *"`read-only` and `workspace-write` both permit
   * reading the whole filesystem, `writable_roots` is about writes, and there is no third string
   * that narrows a read."* ⚠️ **What `ask` buys on Codex is consent, not reach**, exactly as HO-011
   * §2 frames it, and a sentence that let a person read it as reach would be criterion 9 committed
   * by the disclosure written to prevent it.
   *
   * ⚑ **And it is a fact about BOTH modes, so it is said once at the end** rather than attached to
   * the half it would flatter. `366` also measured that this app's `ask` was STRICTER than stock
   * Codex and its `auto` LAXER — 🔴 since `736` (R96) `ask` IS the Codex CLI's default preset.
   *
   * 🔴 **736 · the write clause, measured on that preset** (`probe:codex-mcp-tool-approval`'s
   * `preset` arm): a patch in the folder ran with no card, a write to `/tmp` ran with no card, and a
   * patch outside the folder was a card. ⛔ So *"cannot write outside your folder"* — true of
   * `read-only` — became false, and the note says the folder AND the temporary folders.
   *
   * ⛔ **It does not repeat what is true of both providers.** The launcher's own yolo line already
   * says nothing is asked and that a command reaches what you can; the first two clauses are what
   * is Codex's alone, and putting the shared half here again would be the paragraph `031` rules
   * against.
   */
  approvals: {
    state: 'available',
    note: 'On Codex this mode takes the sandbox off: with approvals on it writes in your folder and the temporary folders without asking, and cannot write anywhere else or reach the network unless you approve it or the config.toml of this identity opens it; with them off it runs danger-full-access, which applies no sandbox at all. Neither mode limits what it can read.',
  },
  /**
   * 🔴 **605 · `available`, and `516`'s `unwired` is withdrawn along with the ruling that wrote
   * it** (`HO-090` §1).
   *
   * ## ⛔ What this entry said until tonight, and why it had to go
   *
   * It said *"we have not wired a card for it — one that named the wrong subject would be worse
   * than none"*, which is `HO-042` §3 quoted as a live reason. ⚑ **The PO has withdrawn that
   * ruling:** *"A card that says plainly this is a tool call and we cannot yet tell you which is
   * HONEST. It is not a card naming the wrong subject … I conflated naming something falsely and
   * admitting we do not know."* ⛔ **A withdrawn ruling quoted as a live reason is standing rule
   * 19's defect**, and this one was rendered to a person on two surfaces.
   *
   * ## ⚑ And the two things that had to be TRUE before the word could move
   *
   * ⚠️ **`unwired` → `available` is a promise that a grant does something**, so it was measured
   * end to end before it was written (`probe:codex-external-mcp`, bundled 0.146.0, a loopback
   * Responses endpoint and a real streamable-HTTP MCP server — no account, no token, no spend):
   *
   * 1. ⚑ **Reach.** A granted server declared through `ThreadStartParams.config` appears in the
   *    child's `mcpServerStatus/list` with its tools, and `mcpServer/tool/call` runs one and it
   *    answers. ⛔ **The control that offered nothing registered nothing**, which is what makes
   *    the rest a measurement. See {@link codexExternalMcpConfig}.
   *
   *    🔴 **And the line it stops at, which is a finding rather than a footnote:** the server's
   *    tools are **not enumerated to the model** — absent from the developer message in BOTH
   *    turns of a two-turn arm (on 0.146.0 present only in the turn's API telemetry; on 0.160.0
   *    nowhere in the request). ⚠️ `exec`'s own instructions teach the `mcp__<server>__<tool>`
   *    spelling, so an agent that knows a name can call it, and since 0.160.0 they add that a
   *    deferred tool is listed in `ALL_TOOLS`; nothing measured says the agent finds it there. ⛔ **`available` is still the
   *    honest word** — the conversation IS handed the server, which is what this entry answers —
   *    **but a reader must not take it for *the agent is handed a catalogue*.** See `605`.
   * 2. ⚑ **The card.** `mcpServer/elicitation/request` arrives carrying `serverName`, and
   *    `turnId` arrives `null` from a client's call outside a turn (a model's call in a turn names
   *    the turn — `720`) — so the SERVER's own card names the server and says it cannot name the
   *    call. See {@link CodexSessionHandle.handleExternalMcpElicitation}.
   * 3. 🔴 **723 · Codex's OWN card** (R80). Before a model's call runs, Codex asks on the same
   *    method — the server, the tool, the parameters — and that is a card with a way to allow it
   *    (`probe:codex-mcp-tool-approval`). ⚠️ **Not for every tool**: one its server marks
   *    `readOnlyHint` ran with no ask, which the note says.
   *
   * ## ⚠️ The one fact the note does not carry, kept here because a reader will need it
   *
   * ⛔ **In `auto` the elicitation never reaches this app at all.** Arm E ran the identical tool
   * call under `approvalPolicy: 'never'` and the app-server answered `decline` itself; no frame
   * was forwarded. ⚑ **That is `HO-090` §2 measured** — *the card never appears in yolo* — and it
   * is the provider's behaviour rather than this app's, which is why no BroBot surface can offer
   * to change it.
   *
   * ⚠️ **And what is still NOT built, so the next reader does not read `available` as *finished*:**
   * ⛔ **Codex has no deny vocabulary for a tool name.** Claude's `disallowedTools` is what
   * `HO-042` §2 named as the backstop behind the registration rail; the bundled binary's only
   * tool filter is `enabled_tools`, an ALLOW list this app holds no roster to build. ⚑ The
   * registration-time collision refusal still runs and is unchanged; the race it leaves open is
   * closed on one provider and not on this one. See `605`'s response.
   */
  externalMcpServers: {
    state: 'available',
    // 🔴 **723 · R80 — *"Codex asks nothing before one of them runs"* was false for a model's call**
    // (`720` F-A, rule 8.1). ⚑ **Every clause measured** by `probe:codex-mcp-tool-approval` (bundled
    // 0.146.0): in a conversation that asks first, Codex asks before a server's tool runs, naming
    // the server, the tool and its parameters — this app shows that as a card, and the card draws
    // Codex's question, the tool and the call's parameters today; a tool the server marks
    // `readOnlyHint`, or `destructiveHint: false` with `openWorldHint: false`, ran with NO ask (the
    // `read-only` and `hints` arms); in a conversation that does not ask, Codex asked nothing (the
    // `auto` arm). ⛔ All of it is said, because a person reading only the first half would take
    // every call to be asked about. ⚑ The key clauses are pinned by name in
    // `one-local-server-one-identity.test.ts`.
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
   * ⛔ **662 · `absent`, and the search had a shape.** Every field of `TurnStartParams` and every
   * `UserInput` variant was read. `origin|provenance|author|human` was grepped across the whole
   * vendored protocol, and it found `GitInfo.originUrl` and `ConfigReadResponse.origins`, which
   * shows the grep ran. Nothing it found describes who sent a message.
   */
  // 🔴 **D-013** — `275` measured it (`background-terminals.ts`' table): the stream never names a
  // background terminal, and no `item/completed` ever arrives for one.
  backgroundWake: {
    state: 'absent',
    reason:
      'A command Codex leaves running in the background never reaches the model again when it ends, so it drives nothing: work whose turn ended over one is stalled, as any other.',
    checkedAgainst:
      '`smoke/codex-background-probe.smoke.ts` against the bundled codex-cli 0.146.0 (`275`): no `item/completed` ever arrives for a background terminal, the stream names none, and `turn/completed` does not wait for it.',
  },
  turnProvenance: {
    state: 'absent',
    reason:
      'Codex has no field for who wrote a message, so every message reaches it the same way, whoever sent it.',
    checkedAgainst:
      'The vendored Codex protocol at the pinned 0.160.0: `TurnStartParams` and every `UserInput` variant (`text`, `image`, `localImage`, `audio`, `localAudio`, `skill`, `mention`) carry no sender, author or origin. `responsesapiClientMetadata` is request metadata for the Responses API, `additionalContext` is content keyed by an opaque source, and `turnTrigger` is an opaque "source classification for the caller that starts this turn" that names no author, and none of them says who wrote the turn. `origin` appears in `src/codex/protocol/` only as a git remote (`GitInfo.originUrl`), as where a config layer came from (`ConfigReadResponse.origins`), and as which client created a whole thread (`Thread.source`, `Thread.originator`), none of them per turn.',
  },
}

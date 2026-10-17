import type { Provider } from '@brobot2/shared'
import { CLAUDE_CAPABILITIES } from './claude/capabilities'
import { CODEX_CAPABILITIES } from './codex/capabilities'

/**
 * What each provider can actually do — **declared by the backend, never inferred in the UI** (039).
 *
 * ## The rule
 *
 * > **The renderer must not branch on which provider a session is running.**
 * > It asks what the session SUPPORTS and renders that. If you find yourself writing
 * > `provider === 'claude'` to decide whether to show something, the answer is a new entry here.
 *
 * Normalize plans, thinking and checklists in the runtime so the UI can render them without provider-specific interpretation.
 *
 * The architecture already held everywhere except one line — `planAvailable` in the launcher, which
 * arrived with 030 and read `provider.value === 'claude'`. One line is not a crisis; one line is the
 * moment to fix the mechanism, because the parity push ahead of us (plan mode, thinking, sub-agents,
 * model lists, mid-turn switching) tempts the same comparison once per feature. The gate that keeps
 * it at zero is `apps/desktop/test/provider-neutrality.test.ts`, which fails on a provider literal
 * anywhere in the renderer that is not the picker or the default.
 *
 * ## Why this is not a bag of booleans
 *
 * Because the truth is not boolean, and the two ways it is not boolean are the two mistakes this
 * app has already made and had to correct on the wire:
 *
 *  - **{@link CapabilityState.unwired} vs {@link CapabilityState.absent}.** 030 wrote "Codex has no
 *    plan mode" from the wrong evidence and hardened it into a comment and a test; 044 falsified it
 *    against our own vendored protocol. 029 did the identical thing about Codex sub-agents and 033
 *    falsified it with a live session. Both times the code said *impossible* when the fact was
 *    *unbuilt* — so those are different states here, and declaring something absent costs you a
 *    written reason.
 *  - **Available, but not the same thing.** Both providers surface thinking; Claude reports a token
 *    estimate with the words redacted and Codex a written summary. Flattening that to `true` would
 *    invite a UI that promises one and renders the other.
 *
 * ## Nothing here is a guess
 *
 * Every entry cites what it was measured from — a live capture, a vendored protocol type, or the
 * pinned SDK's own declarations. A capability we have not measured is **left out**, not defaulted:
 * absent from this table means "nobody asked yet", which is honest, whereas a fabricated `absent`
 * is the exact failure 029 and 030 shipped.
 */

/**
 * How far along a capability is. Three states because two of them look identical to a user and are
 * opposite facts to a developer — see the module note above.
 */
export type CapabilityState =
  /** We offer it, and it works. */
  | 'available'
  /** The provider has it; **we have not built it**. A lead, not a limit. */
  | 'unwired'
  /** The provider genuinely does not have it, at the version we are pinned to. */
  | 'absent'

/**
 * One capability's standing with one provider.
 *
 * A discriminated union rather than `{ supported, reason? }` so that **an unavailable capability
 * cannot be declared without saying why in words a user could read**. That is 030's "honest absence"
 * rule, enforced by the type system instead of by remembering it. The `reason` is the string the UI
 * shows — the renderer owns no copy of its own, so a reason that goes stale is fixed in one place
 * and cannot be fixed in only one of two.
 */
export type CapabilityStatus =
  | {
      readonly state: 'available'
      /**
       * What it gives you, when "yes" is not the whole answer. Optional: most capabilities either
       * work or do not, and a note that restates the capability's own name is noise.
       */
      readonly note?: string
    }
  | { readonly state: 'unwired'; readonly reason: string }
  | {
      readonly state: 'absent'
      readonly reason: string
      /**
       * ⚠️ **Where you looked.** Required, and it is the whole point of this state existing.
       *
       * `absent` is the claim this project has got wrong twice — 029 about Codex sub-agents, 030
       * about Codex plan mode — and both times the mistake was not the conclusion, it was that
       * nobody had to write down what they checked. `enteredReviewMode` never firing is a fact;
       * "Codex has no plan mode" was an inference from it, and the inference was wrong because the
       * capability lived on `collaborationMode`, which nobody had looked at.
       *
       * So this field is not documentation. It is the question "did you check, or did you infer?"
       * made impossible to skip: name the vendored type, the SDK declaration, or the capture — and
       * if you cannot name one, the honest state is {@link CapabilityState.unwired}, which claims
       * nothing about the provider at all.
       */
      readonly checkedAgainst: string
    }

/** Whether the app may offer this today. The one question every surface actually asks. */
export function isAvailable(status: CapabilityStatus): boolean {
  return status.state === 'available'
}

/** Presentation artwork sent with a provider's other declared facts. */
export type ProviderMarkKind = 'letter' | 'blossom'

/**
 * Everything the app asks a provider about.
 *
 * **Deliberately short.** A capability earns a place here by being *measured* and by having, or
 * being about to have, a consumer. Things we know exist and do not consume — Claude's
 * `supportedModels()`, file checkpointing, compaction boundaries, Codex's `turn/diff/updated`, hook
 * events, rate limits — are catalogued in `Slice 2/00-parity-matrix.md`, which is where a wish list
 * belongs. Putting them here would make this table a roadmap that reads like a contract.
 */
export interface ProviderCapabilities {
  /** The provider's mark is presentation data, never a renderer inference from its name. */
  readonly mark: { readonly state: 'available'; readonly kind: ProviderMarkKind }
  /**
   * **Plan mode** — the agent works out what it intends to do and proposes it before acting (030).
   *
   * ⚠️ **Whether it is a safety gate is now a PER-PROVIDER fact, and this field is where that gets
   * said** (140, correcting a rule that had held since 030).
   *
   * The old rule was "whatever this says, it is not a safety gate", and it was right for the reason
   * it gave: the pinned SDK calls `'plan'` *"Planning mode, no actual tool execution"* and the 026
   * capture measured the model performing a `Write` while in it. 140 then measured something worse
   * and something better. Worse: the CLI was discarding `--permission-mode plan` on every launch
   * this app made, because `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` forces the mode to `default` — so an
   * agent wrote into the user's personal `~/.claude` under a header that said plan mode was on.
   * Better: the fix put the read-only floor in this app's own `PreToolUse` guard, where no provider
   * flag can silently outrank it.
   *
   * ⚠️ **`728` (R93) removed that floor.** On Claude a planning session is now governed by the CLI's
   * own plan mode (measured: it asks before a `Write` and an MCP tool, runs `ls`), and on Codex —
   * whose plan mode is the server's collaboration instructions, with 057 watching a planning turn
   * shell out before it proposed anything — as before. **Neither claim may be made about "plan mode"**;
   * each belongs in its own adapter's {@link CapabilityStatus.note}, which is what the surfaces
   * render. A shared sentence promising a refusal would be 140's own defect on the other provider.
   */
  readonly planMode: CapabilityStatus
  /**
   * **Thinking** — the model's own reasoning, surfaced as it works (026/027).
   *
   * Available on both and *different* on both. `events.ts`'s `thinkingEventSchema` carries the
   * measurement and the shape that keeps the difference visible: `text` absent with `redacted:true`
   * means "it thought, and we cannot show you what", which is not the same fact as "it did not
   * think" and must never be collapsed into one.
   */
  readonly thinking: CapabilityStatus
  /**
   * **Sub-agents** — the agent dispatching work to other agents, reported as it happens (029/033).
   *
   * ⚠️ The entry every reader should be suspicious of, because it was wrong once. 029 concluded
   * Codex could not do this without `ultra` effort and wrote it into a test; 033 spawned sub-agents
   * in four sessions at the ordinary `medium` default and every one was reported. If you are about
   * to conclude a provider cannot do something, this is the entry to remember.
   */
  readonly subAgents: CapabilityStatus
  /**
   * **Asking for a compaction** — the app telling the provider to summarize and drop context (087,
   * ruled in 086).
   *
   * ⚠️ **This entry existed to keep a control OFF, which is the opposite of the other three**, and it
   * is the reason the comment above says a capability earns its place by having a consumer: from 087
   * to 718 the consumer was a **disabled** foot in the Dropped tab that stated its own reason (since
   * `718` it is the live control's gate — see the last paragraph). Compaction is
   * lossy and irreversible, so a button that discards context on one provider and is missing on the
   * other is the asymmetry Slice 2 has spent itself removing.
   *
   * Enabling it needed **two** things and not one: the asymmetry resolved, AND a confirm step, since
   * there is no undo.
   *
   * 🔴 **713 · the first of the two is DONE, and both providers are `available`** (`R60`). ⚑ Claude
   * compacts on the person's own `/compact`, which `R42` sends to its CLI exactly as typed (`708`);
   * Codex on `thread/compact/start`, which a person's `/compact` now reaches instead of the model
   * (`R59`, `SessionHandle.compact`). ⛔ **The second is the frontend's** — *"Compact now…"* goes the
   * person's `/compact` road on both, after a confirm, and this field is no longer what holds it
   * off. ⚑ **718 built the confirm**: the control is live on both providers, and this field is one
   * of the two things its gate asks (`compaction-offer.ts` — the conversation's own send facts are
   * the other). ⚠️ The two `note`s differ because the two roads do: Claude's takes instructions,
   * Codex's takes none.
   */
  readonly requestCompaction: CapabilityStatus
  /**
   * **Taking it back** — the app putting the user's files back the way they were (096, ruled in 092).
   *
   * The entry whose consumer is a **disabled** control — the second until `718` made compaction's
   * live — and the more dangerous of the two by some distance. Compaction is *lossy*: it forgets, and
   * 086 still deferred it (until `R60`, after a confirm). Rewind **writes to
   * the working tree** — it is the only capability in this table that can destroy work the user did
   * by hand, and it does so on disk, where there is no undo to reach for.
   *
   * ⚠️ **Both providers are `unwired`, and the reason is not "there is no API."** 092 filed Claude's
   * as `absent`, on the grounds that `rewindFiles()` / `enableFileCheckpointing` *"appear in zero
   * source"* — true of OUR source, and false of the SDK, which declares both at our exact pin
   * (`sdk.d.ts:1629` and `:2980`, with a `RewindFilesResult` at `:3203`, at 0.3.281). Shipping that as `absent`
   * would have put a reason in the product that is not true, which is the failure this table exists
   * to prevent. It is `unwired`: the method is right there, and we have chosen not to call it.
   *
   * Enabling it needs a provider path we trust, a **confirm** step, a defined scope (one file, the
   * turn, the conversation), and a rule for edits the user made by hand since. This field is what
   * records that those are required rather than optional.
   */
  readonly rewind: CapabilityStatus
  /**
   * **Signing in, here** — giving this profile home its own account rather than a borrowed copy of
   * the machine's (098).
   *
   * Recovery may require signing in inside the profile rather than copying a stale machine credential again. Ask the per-provider capability instead of inferring that a sign-in button works for every adapter.
   *
   * The two providers differ in kind, not in degree:
   *
   *  - **Codex** copies `~/.codex/auth.json` into the home once, so the copy and the machine share
   *    one rotating refresh token and each invalidates the other. There is a real sign-in verb —
   *    measured, not merely declared — so this is `available`.
   *  - **Claude** copies nothing at all (015's hard rule) and re-reads the machine Keychain on every
   *    launch, so it has no credential of its own to stale and nothing to sign in *to*. The SDK also
   *    has no verb for it. Both halves are in the reason, because either one alone would be a
   *    misleading explanation of the same `absent`.
   */
  readonly signIn: CapabilityStatus
  /** An expired login is renewed by one short message when a conversation starts. */
  readonly loginRenewalMessage: CapabilityStatus
  /**
   * **Re-copying the machine credential into this profile** — the fast remedy beside
   * {@link ProviderCapabilities.signIn}'s durable one (098).
   *
   * ⚠️ **Two entries, because they are two different availabilities and the review found the cost of
   * assuming otherwise.** The panel gated only its sign-in button on a capability and drew the
   * copy button unconditionally — so a Claude user whose machine login had expired was offered
   * "Copy my machine sign-in", a gesture the host refuses outright because Claude keeps no
   * credential in the profile home to copy INTO. A button that always throws is worse than a missing
   * one: it reads as the app being broken rather than as the remedy not applying.
   *
   * The pairing is deliberate: a provider can plausibly have one without the other, and collapsing
   * them into a single "can be re-authenticated" flag would be a shorter menu rather than an honest
   * one — the same mistake `reasoningEffort`'s enum was.
   */
  readonly reprovisionAuth: CapabilityStatus
  /**
   * **What a profile's folder holds of your sign-in before anybody presses anything** (329).
   *
   * ⛔ **The third credential entry, and the only one that is not about a button.** {@link signIn}
   * and {@link reprovisionAuth} answer *"what may this app DO about a credential"*; this answers
   * *"what has already happened to one"*. They are three availabilities and not one, for the same
   * reason those two are two: a provider can plausibly have any of them without the others, and the
   * app's own behaviour differs by provider in kind rather than in degree.
   *
   *  - **Codex** — `prepareProviderHome` calls `provisionCodexAuth`, which copies the CONTENT of
   *    `~/.codex/auth.json` into the profile's folder once, at `0600`, atomically, never
   *    overwriting and never symlinked. So the profile starts out holding a copy of the machine's
   *    login, and the two share one rotating refresh token — each renewal invalidates the other.
   *  - **Claude** — 015's hard rule: nothing is written into the folder at all. The machine
   *    Keychain is re-read on every launch and the access token injected transiently into the
   *    child's environment, so the folder holds no credential to go stale and none to leak.
   *
   * ⚑ **The consumer is a sentence, not a control** — {@link commandOutput}'s shape, and the reason
   * this is a capability rather than a comment. `328` measured the copy appearing in a fresh
   * `--user-data-dir` five seconds after launch with nothing sent, and the only place the product
   * said so was the conversation Info panel, after a profile existed and the copy had happened.
   * ⛔ The launcher is where the choice is made and it is also, since `257 §2`, the screen whose own
   * model probe performs the copy — `RuntimeScreen` asks every known profile for its models on
   * mount, and `prepareProviderHome` is the first thing that probe does. A surface that causes an
   * act is the surface that has to disclose it.
   *
   * ⚠️ **This entry may not be inferred from {@link reprovisionAuth}, and that shortcut is the trap
   * worth naming.** Both are `available` on Codex and `absent` on Claude today, so a reader is
   * tempted to collapse them — but one is *"you may press a button to re-copy"* and the other is
   * *"a copy was made without anyone pressing anything"*, and a provider with a per-profile OAuth
   * mint and no machine credential at all would answer `available` to the first and `absent` to the
   * second. Collapsing them would be the shorter menu rather than the honest one.
   *
   * ⛔ **`absent` here is a claim about what the app WRITES, so its `checkedAgainst` names the
   * writer** rather than an SDK declaration. `credential-disclosure.test.ts` runs the real
   * provisioning against a temp home in both directions, so this entry cannot drift from the code
   * the way `308`'s `auth.json` note could — that sentence survived two mutants and no test.
   */
  readonly homeCredential: CapabilityStatus
  /**
   * **The provider's own maximum-effort orchestration mode** — for Claude, `ultracode` (106).
   *
   * Keep similarly named provider features on their actual axes. Codex ultra is a reasoning effort, while Claude ultracode is a separate setting; the menu must not merge them.
   *
   *  - **Codex's `ultra` is an EFFORT VALUE** — a member of `supportedReasoningEfforts`, answered per
   *    model by `model/list`, which reaches the app as {@link ModelChoice.efforts} and appears in the
   *    reasoning menu like any other level.
   *  - **Claude's `ultracode` is a BOOLEAN SETTING** sitting beside `effortLevel` rather than in it —
   *    *"standing dynamic-workflow orchestration at any effort level"* — and `EffortLevel` does not
   *    contain it.
   *
   * So this is a capability and not a level, and the renderer asks for it the way it asks for
   * everything else: by capability, never by provider name. A provider that has no such mode says so
   * here, in a reason a user could read, instead of the app hiding a control it cannot explain.
   *
   * ⚠️ **`available` here is a claim about the PROVIDER, not about the session it will run.** Both
   * of the mode's preconditions live below this table: workflows must be enabled for the login, and
   * the model must be able to do `xhigh`. The second is per-model and answerable from
   * {@link ModelChoice.efforts}; the first is not observable to us at all before a turn starts, and
   * the control's own copy is what carries that.
   */
  readonly ultracode: CapabilityStatus
  /**
   * **The commands the agent itself has** (279) — what the palette lists beside BroBot's own.
   *
   * ⛔ **Both providers answer and this is the "available, but not the same thing" case the module
   * note above warns about, in its sharpest form yet.** `probe:provider-commands` asked both, zero
   * turns and zero tokens: Claude publishes **44** rows that mix its built-ins with its skills, all
   * typed `/name`; Codex publishes **6**, all skills, typed `$name`, and **zero** of the six names
   * appear in Claude's forty-four.
   *
   * ⚠️ **So `state` alone would be a lie by omission** — flattening both to `available` is exactly
   * what *"would invite a UI that promises one and renders the other"* describes: a person who has
   * used `/compact` on Claude would look for it on Codex and find nothing, with no explanation. The
   * `note` carries the difference and the palette draws it, so the asymmetry is stated to the person
   * rather than only to the next reader of this file.
   *
   * ⚠️ **713 · `/compact` itself WORKS on Codex now** (`R59`) — BroBot turns a person's `/compact`
   * into Codex's own compaction request — while this list stays skills: the command is BroBot's,
   * not one Codex publishes. ⛔ **And "the palette draws it" is the design rather than the build**:
   * 713's sweep found no renderer file that reads `agentCommands` — the palette's sentence is
   * `command-palette.ts`' own `agentNote` — so this note reaches a test and no person.
   *
   * ⚑ **Not two entries, and not `absent` for Codex.** The capability is *"the palette can list what
   * this agent will answer to"*, and Codex can. What Codex does not have is slash commands, which is
   * a fact about its vocabulary rather than about this capability — filing it as `absent` would say
   * the band cannot be drawn, and it can.
   */
  readonly agentCommands: CapabilityStatus
  /**
   * Whether the person can send input to a running provider child from the sub-agent viewer.
   *
   * ⛔ **This is the opposite case to {@link agentCommands} and it is worth reading the two
   * together.** There, both providers answered and flattening them to one `available` would have
   * hidden a real difference. Here one provider answers and the other has nothing to answer with, so
   * the honest table has one `available` and one `absent` — and `absent` is the arm that has to name
   * where somebody looked.
   *
   * ⚠️ **It is NOT "can this app show a child"** — `112` and `115` shipped that for both providers
   * and it still works for both. The viewer FOLLOWS a live child on either provider, because both
   * write their record to disk as they go. What splits is only the direction back.
   */
  readonly childInput: CapabilityStatus
  /**
   * Whether command output can be watched while it runs.
   *
   * ⛔ **The second entry, after {@link childInput}, where one provider answers and the other has
   * nothing to answer with** — and the sharper of the two, because the asymmetry here is not about a
   * shape the app could work around. Codex puts a running command's stdout on the wire, keyed by the
   * card's own id; Claude puts it nowhere until the command finishes.
   *
   * ⚠️ **`absent` on Claude is a measurement and not a reading, and both halves are in the reason.**
   * `probe:command-output` watched a real twelve-second command over 45 frames and none carried its
   * bytes; the pinned SDK's `Query` declares `stopTask` and `backgroundTasks` and no reader of a
   * task's output at all. ⛔ **`245` recorded the third half, which is what makes this a fact about
   * the PROVIDER rather than about our pin**: a running task's output is read through a tool the
   * MODEL calls, so it is delivered to the agent and never to the host. (That tool was `TaskOutput`
   * until 0.3.281 removed it — *"Read a background task's output file with the Read tool
   * instead"*, `sdk.d.ts:7000`, 680. Same channel, another tool.) ⚠️ 0.3.287 added a host door for
   * BACKGROUND commands only — so since provider follow-ups 1 this entry is about a command in the
   * FOREGROUND, and {@link backgroundCommandOutput} is about one in the background.
   *
   * ⚑ **The consumer is a sentence, not a control** — which is why this is a capability rather than
   * only a liveness flag. The card of a running command shows the tail where there is one and says
   * this reason where there is not, once, at the only moment a person asks the question. A card that
   * simply showed nothing on one provider and a tail on the other would be `039`'s failure: an
   * asymmetry the app knows about and does not disclose.
   */
  readonly commandOutput: CapabilityStatus
  /**
   * **Watching a BACKGROUND command while it runs** — {@link commandOutput}'s other half, split from it
   * (provider follow-ups 1) because the two halves stopped having one answer.
   *
   * ⚑ Claude Code 2.1.287 gave a host its first reader of a running command's output — the
   * `get_task_output` control request, *"at most the last 8 KiB"* of a background shell or Monitor
   * task, polled — and none for a foreground one. So on Claude the background half is `unwired`
   * (the provider has it, BroBot does not ask) while the foreground half stays `absent`. Codex
   * streams both.
   *
   * ⚑ **The same consumer as {@link commandOutput}**: the card of a running command that went to the
   * background reads THIS entry. ⚠️ It says an `absent` reason where there is no tail and, by
   * `command-tail.ts`' standing rule, NOT an `unwired` one — so a Claude background command's card
   * says *"Nothing has been kept for this one."*
   */
  readonly backgroundCommandOutput: CapabilityStatus
  /**
   * 🔴 **What the yolo end of the approvals control actually does, on this provider** (367,
   * HO-011 §3.2).
   *
   * ⛔ **Both providers declare it `available` and the note is the whole entry.** This is the
   * *"available, but not the same thing"* case the module note names, in its most consequential
   * form yet: the control is one checkbox, the enum is one string (`auto`), and what that string
   * BUYS differs in kind between the two adapters rather than in degree.
   *
   *  - Codex uses `APPROVAL_PROFILES` in `codex/codex-runtime.ts`: `ask` selects `workspace-write` and `auto` selects `danger-full-access`. The sandbox narrows writes and network, not all reads; `codex/capabilities.ts` states that limit, so do not promise full containment.
   *  - Claude has no app-supplied sandbox in either mode. `permissionModeFor` requests `default`; automatic mode yields in `promptGuardHooks` and allows in `handleCanUseTool`. The app adds no protected-folder scan above those decisions.
   *
   * ⚠️ **So a single sentence for both would be false for at least one of them**, which is the
   * defect `039` exists to prevent and `329` had to fix once already on {@link homeCredential}. The
   * launcher's own `YOLO_MEANS` carries the half that IS true of both — nothing is asked, and
   * a command reaches what you can — and this note carries the half that is not.
   *
   * ⛔ **It says nothing about `ask`, deliberately.** `ask` differs in kind too — Codex is confined
   * read-only, Claude is not confined at all — but stating that here would be putting a second
   * claim in a field with one consumer, and the surfaces that show this note are the three places
   * yolo is chosen or announced. See the `367` response for the `ask` half and what it costs to
   * disclose it.
   */
  readonly approvals: CapabilityStatus
  /**
   * 🔴 **Whether an external MCP server a person registered can be granted to an identity running
   * on this provider** (516, HO-040 §4.2, `HO-042` §3).
   *
   * ⛔ **It is here rather than as a provider literal in the renderer, and this table's own opening
   * rule is why**: *"If you find yourself writing `provider === 'claude'` to decide whether to show
   * something, the answer is a new entry here."*
   *
   * ⚑ **THREE readers, one declaration** — ⚠️ **and this sentence said *two* until `605` counted
   * them**, which is the standing-rule-19 shape it is now an instance of: `566` added the Tools
   * register (`whatEachProviderDoesWithThem`) and nothing here moved. They are
   * `RuntimeHost.externalMcpContext`, which decides whether a launch is handed anything at all;
   * `CapabilitiesSheet`, which draws the entry's own words beside the grant; and the Tools
   * register, which draws them again per provider. ⛔ **None of them spells a provider's name.**
   *
   * ## 🔴 Both providers are `available` as of `605`, and the word was earned rather than assumed
   *
   * ⚠️ **Codex's entry said `unwired` from `516` to `605`**, resting on `HO-042` §3 — *"a card
   * that cannot name its subject cannot meet criterion 20 … That is not a weaker card. It is a
   * worse one."* ⛔ **The PO has WITHDRAWN that ruling** (`HO-090` §1), and `605` measured reach
   * and the card's one true fact on the wire before moving the word. See
   * `codex/capabilities.ts`' own entry for the arms.
   *
   * ⚑ **What `unwired` still means for the next entry that needs it** — *we have not built it*,
   * as against `absent`'s *the provider does not have it* — is stated where a reader meets the
   * three arms, in `the-servers-this-app-registered.ts`.
   */
  readonly externalMcpServers: CapabilityStatus
  /**
   * 🔴 **Telling the provider who wrote a turn** (662) — {@link SessionHandle.send}'s `origin`,
   * see `TurnProvenance`.
   *
   * ⚠️ **"Available, but not the same thing" once more, and the difference is inside the one
   * provider that has it.** Claude has a field for it, but a `peer` stamp changes nothing the model
   * is handed (`packages/runtime/smoke/claude-origin-wire-probe.smoke.ts` compares the request with
   * and without it, and finds no difference). The `human` arm is the one the `ultracode` keyword
   * reads, which no probe can raise. So the note says which half does something, rather than
   * letting `available` claim both.
   *
   * ⛔ **Codex is `absent`, measured against the vendored protocol**, not assumed from a missing
   * feature. Its adapter declares no such parameter, so a caller's stamp is dropped before
   * `turn/start` is written, and the wire is what an omitted origin sends on every adapter.
   */
  readonly turnProvenance: CapabilityStatus
  /**
   * 🔴 **D-013 · background work WAKES the conversation when it ends** (plan §3.7) — a backgrounded
   * command's end, or a scheduled wake-up firing, runs the model again with nobody sending a
   * message. ⚑ This is what lets a turn that ends with background work pending read *working in the
   * background* rather than *stalled*: something will drive it again. ⛔ Where the provider does
   * not wake the model, background work drives nothing, and a turn that ends over it stalls.
   */
  readonly backgroundWake: CapabilityStatus
}

/**
 * Every provider's declaration, assembled from the adapters' own.
 *
 * `Record<Provider, …>` is the enforcement: adding a third provider **fails to compile** until it
 * declares what it can do. That is why there is no `AgentRuntime.capabilities` member — it would
 * give the same guarantee at the cost of a stub in every test double, and a second place for the
 * answer to live. A running session's capabilities are `capabilitiesFor(session.provider)`.
 *
 * Frozen because it is a singleton handed out by reference: `readonly` is a compile-time promise and
 * this value is reachable from tests and from the IPC layer, where one in-place edit would rewrite
 * what every later caller in the process is told.
 */
const DECLARED: Record<Provider, ProviderCapabilities> = Object.freeze({
  claude: Object.freeze(CLAUDE_CAPABILITIES),
  codex: Object.freeze(CODEX_CAPABILITIES),
})

/** What this provider can do. The only way to find out — there is no other copy. */
export function capabilitiesFor(provider: Provider): ProviderCapabilities {
  return DECLARED[provider]
}

/**
 * Every provider's capabilities in one value, for callers that need them **before a session
 * exists**.
 *
 * That caller is the launcher, and it is not an edge case: the provider select is the one place a
 * user changes provider, and it does so with nothing running. Handing over the whole map lets the
 * surface answer a live select without a round trip per keystroke, and — the point — lets it answer
 * by *looking the provider up* rather than by naming one.
 */
export function allProviderCapabilities(): Record<Provider, ProviderCapabilities> {
  return DECLARED
}

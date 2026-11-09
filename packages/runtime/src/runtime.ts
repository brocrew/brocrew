import type { ManagedPluginObserver } from './managed-plugin-observation'
import type { ManagedPluginMcpServer } from './managed-plugin-mcp'
import type { Provider, SessionStatus } from '@brobot2/shared'
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

/** Per-profile skills supplied on both start and resume; provider-specific paths stay in adapters. */
export interface BuiltInSkillsContext {
  readonly root: string
  readonly skills: readonly {
    readonly name: string
    readonly description: string
    readonly path: string
  }[]
}

/** Launch progress names carry timing and byte counts without exposing provider payloads. */
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
  /** Absolute, app-owned per-profile state directory for this provider. */
  providerHome: string
  /** Told each phase of this launch as it is reached, so a slow launch can say where it waited. */
  startPhases?: StartPhaseSink
  /** Completed immutable view for this launch, prepared only inside its managed home. */
  builtInSkills?: BuiltInSkillsContext
  /** The writable skills root shared by every profile. */
  sharedSkillsRoot?: string
  /** Hide retained native originals before a provider reads its skill catalogue. */
  beforeSkillDiscovery?: () => Promise<void>
  /** Only exact 'auto' disables prompts; start and resume carry the selected mode. */
  approvalMode?: ApprovalMode
  /** Effort is a provider-defined request restored on resume, not a report of what ran. */
  reasoningEffort?: ReasoningEffort
  /** Send the selected model on resume; an absent request lets the provider retain its previous model. */
  model?: string
  /** Planning asks for a proposal; each provider declares how planning ends, and planning is not a sandbox. */
  planMode?: boolean
  /** Keep launch planning and its later release separate so resume can restore both facts. */
  planModeEnded?: boolean
  /** Abort before launch spawns nothing; abort during launch tears down the child; returned handles own their close. */
  signal?: AbortSignal

  /** Start and resume must offer the same supplied app tools; this catalogue grants no authority. */
  agentTools?: AgentToolset
  /** Adapters receive the resolved external server list without deciding grants or editing provider homes. */
  externalMcp?: ExternalMcpReach
  /** Authenticated per-launch plugin broker routes; absent preserves existing launch behavior. */
  managedPluginMcp?: readonly ManagedPluginMcpServer[]
  /** Internal observation of existing discovery results; never provider configuration. */
  observeManagedPlugins?: ManagedPluginObserver
  /** Extra work folders replace the prior grant list and must be supplied again on resume. */
  workFolders?: readonly string[]
}

/** Use provider-defined effort names; each adapter owns validation against its supported vocabulary. */
export type ReasoningEffort = string

/** An absent or blank effort leaves the provider choice alone instead of inventing a default. */
export function resolveReasoningEffort(
  context: { reasoningEffort?: unknown } | undefined,
): ReasoningEffort | undefined {
  // Validate only non-empty strings here; providers own the effort vocabulary.
  const value = context?.reasoningEffort
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Model choices come from the provider; free-text requests remain usable when a cached catalogue is stale. */
export interface ModelChoice {
  /** The id to send as {@link ProviderRuntimeContext.model}. The provider's own vocabulary. */
  id: string
  /** What to call it in a menu. Falls back to the id when a provider offers no display name. */
  label: string
  /** The resolved target is shown and matched, while the alias id remains the value sent. */
  resolvesTo?: string
  /** A provider default is a named catalogue entry, not an absent model choice. */
  isDefault?: true
  /** One line about what it is for, when the provider supplies one. */
  description?: string
  /** Pass through provider notices without interpreting or inventing their meaning. */
  note?: string
  /** Effort choices belong to each model; an absent list means unreported, not unsupported. */
  efforts?: readonly EffortChoice[]
  /** Default effort is a request; a provider report is separately marked on AgentInfo. */
  defaultEffort?: string
}

/** Effort choices use the provider vocabulary for the selected model. */
export interface EffortChoice {
  /** The value to send as {@link ProviderRuntimeContext.reasoningEffort}. Provider vocabulary. */
  id: string
  /** What to call it in a menu. Falls back to the id where a provider offers no display name. */
  label: string
  /** Keep the provider description so different effort behavior remains visible. */
  description?: string
}

/** Absent agent fields mean the provider has not reported them. */
export interface AgentInfo {
  /** The effective model, as the provider names it. */
  model?: string
  /** Consult reasoningEffortReported before presenting an effort request as provider fact. */
  reasoningEffort?: string
  /** False marks our request; true marks a provider report, which may arrive only when a turn ends. */
  reasoningEffortReported?: boolean
}

/** Settings are adopted together at a turn boundary so their effective values describe the same turn. */
export interface SessionSettingsState {
  /** The model we are asking for, or `undefined` where we are asking for none. */
  model: { effective: string | undefined; requested: string | undefined }
  /** The effort we are asking for, or `undefined` where we are asking for none. */
  reasoningEffort: {
    effective: ReasoningEffort | undefined
    requested: ReasoningEffort | undefined
  }
  /** False covers both never planned and released; consult planModeEnded when that distinction matters. */
  planMode: { effective: boolean; requested: boolean }
}

/** How a session handles consequential actions; absent mode defaults to 'ask'. */
export type ApprovalMode = 'ask' | 'auto'

/** Effective approval mode and the mode requested for the next turn. */
export interface ApprovalModeState {
  /** What the session is running under right now. */
  effective: ApprovalMode
  /** What it will run under from its next turn — the same value unless a change is pending. */
  requested: ApprovalMode
}

/** Only exact 'auto' disables approval prompts. */
export function isAutoApprove(context: { approvalMode?: ApprovalMode }): boolean {
  return context.approvalMode === 'auto'
}

/** Options for starting a fresh session. */
export interface StartOptions extends ProviderRuntimeContext {
  /** Retain ownership of an allocated fresh handle even if its handshake fails. */
  onSessionCreated?: (handle: SessionHandle) => void
  /** Working directory the session runs in; becomes part of its `SessionRef`. */
  cwd: string
  /**
   * Append freshly composed instructions without replacing the provider system prompt.
   * SessionRef keeps no hint: Nothing about it is persisted, and that is the design rather than a leftover.
   * On resume the host reads the current files again rather than replaying a hint from the ref.
   * what this layer GUARANTEES is the additive HAND-OFF to the provider, the last step this app observes.
   * `HO-023` §7 is WITHDRAWN. The factory layer carries BEHAVIOUR. Safety lives in the rails.
   * A Codex collaborationMode update TAKES PRECEDENCE over developerInstructions from the mode switch onwards.
   * This exposure is latent: the app passes Codex no system hint; its conversation text rides the first message of each life.
   * Do not measure it now or build a re-assert; the existing trigger is beside the factory text in
   * apps/desktop/src/main/runtime/factory-text.ts.
   */
  systemHint?: string
  /** Request orchestration only for a fresh session; it is not durable or provider-confirmed state. */
  ultracode?: boolean
}

/** Resume context includes fresh instructions and ownership notification. */
export interface ResumeOptions extends ProviderRuntimeContext {
  /** Retain ownership of an allocated resume handle even if its handshake fails. */
  onSessionCreated?: (handle: SessionHandle) => void
  /** Compose instructions again on resume so profile edits take effect instead of replaying an old snapshot. */
  systemHint?: string
}

/** Provider-neutral session operations return refs for the orchestration layer to persist. */
export interface AgentRuntime {
  readonly provider: Provider
  /** Immutable adapter support for recreating an unused missing session, subject to ownership checks. */
  readonly canRecreateMissingUnusedSession?: boolean

  /** Start a new session using its selected permission profile. */
  start(opts: StartOptions): Promise<SessionHandle>

  /** Resume the requested session and cwd in its original home; reject mismatches instead of starting fresh. Claude confirms identity on its first init. */
  resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle>

  /** Ask the current login for its model catalogue; failures preserve the free-text choice and the temporary provider is closed. */
  listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]>
}

/** Attribute only known authors: person, named peer, or absent; absence must not imply a person. */
export type TurnProvenance =
  | { readonly kind: 'person' }
  | {
      readonly kind: 'peer'
      /** Use the full sender id so attribution matches the originating conversation. */
      readonly from: string
      /** Use an actual display name when known; never substitute a category label. */
      readonly name?: string
    }

/** One event stream owns lifecycle: working per accepted turn, terminal turn before idle, and frozen state after session end or fatal error. */
export interface SessionHandle {
  /** The admitted app connection for this launch; older adapters may not provide attribution. */
  readonly connectionId?: string
  /** Carry deliveries past retirement; an idle-looking retiring handle cannot accept another turn. */
  isRetiring?(): boolean
  /** Whether this launch's SDK init confirmed the installed skill catalogue. */
  builtInSkillsConfirmed?(): boolean
  /** Refresh only at a turn boundary; absent means this provider needs a managed reopen. */
  refreshManagedPlugins?(
    servers: readonly ManagedPluginMcpServer[],
    reconnect?: readonly string[],
  ): Promise<void>
  /** Await only currently served managed routes; configured routes still starting are not awaited. */
  awaitManagedPlugins?(names: readonly string[]): void
  /** Fresh failed managed-server names; empty means ready, undefined means unknown. */
  managedPluginHealth?(
    servers: readonly ManagedPluginMcpServer[],
  ): Promise<readonly string[] | undefined>

  /** Null means no confirmed provider identity yet; Claude confirms on first init, while Codex and Fake confirm during launch. */
  readonly ref: SessionRef | null

  /** A requested launch id identifies a possible transcript, not a confirmed resumable session ref. */
  readonly launchedAs?: string | null

  /** Provider reports are distinct from launch requests; unconfirmed effort is marked explicitly. */
  readonly agentInfo?: AgentInfo

  /** Expose only an OS process genuinely owned by this handle; doubles may have none. */
  readonly providerPid?: number | undefined

  /** Resolve only on proven owned-process exit and cleanup, never a timeout; absence is unknown and repeated calls share the same promise. */
  awaitProcessExit?(): Promise<void> | undefined

  /** Expose the provider-reported instruction paths in order, not a new read of their contents. */
  readonly instructionSources?: readonly string[]

  /** Launch settings are the adapter request; absence means the adapter did not report them. */
  readonly launchSettings?: readonly LaunchSetting[]

  /** A latched launch-login change; Claude includes renewal, while Codex distinguishes account changes. */
  readonly signInSuperseded?: boolean

  /** Check at a turn boundary because inspecting the machine login can require a Keychain read. */
  checkSignIn?(): Promise<boolean>
  /** Identify the sign-in copy used at launch only when the provider keeps per-profile copies. */
  signInCopyAtLaunch?(): unknown

  /** A one-way tag correlates readings without exposing an account or reading credentials on access. */
  signInTag?(): string | null

  /** Ask the provider for its account: undefined is unreported and null is no named account. */
  account?(): SessionAccount | null | undefined

  /** Start a turn with known authorship; adapters map only provenance fields their provider supports. */
  send(text: string, origin?: TurnProvenance): Promise<void>

  /** Retry a repaired empty-input turn without inserting its already-recorded message a second time. */
  carryOn?(): Promise<void>

  /** Fetch and publish current provider commands; rejection or absence is not an empty catalogue. */
  providerCommands?(): Promise<ProviderCommandAnswer>

  /** Start native compaction as a turn; it takes no instructions, and absence leaves the provider command path in use. */
  compact?(): Promise<void>

  /** Single-consumer normalized events preserve unmapped provider payloads as unknown events. */
  events(): AsyncIterable<RuntimeEvent>

  /** Answer the original permission request id; adapters retain the provider correlation and must settle pending requests. */
  respondPermission(id: string, decision: PermissionDecision): Promise<void>

  /** Reject an unmodelled user-input request safely instead of leaving the provider waiting. */
  respondUserInput(id: string, response: UserInputResponse): Promise<void>

  /** Disclose the effective mode now and the requested mode for the next turn. */
  readonly approval: ApprovalModeState

  /** List only known session-wide tool grants, in grant order; provider-held grants may be unreported. */
  readonly blanketGrants: readonly string[]

  /** Record a mode change for the next turn; disclose the delay instead of claiming the running turn changed. */
  setApprovalMode(mode: ApprovalMode): Promise<void>

  /** Effective settings are our turn request; consult agentInfo for provider-confirmed facts. */
  readonly settings: SessionSettingsState

  /** Record the next-turn model request; a provider rejection is reported when that turn starts. */
  setModel(model: string | undefined): Promise<void>

  /** Adapters validate supported effort vocabulary where known; Codex records a request for the provider to decide on the next turn. */
  setReasoningEffort(effort: ReasoningEffort | undefined): Promise<void>

  /** End planning through the provider-supported path; a host go-ahead composes this mode change with a separate send. */
  setPlanMode(on: boolean): Promise<void>

  /** Replace work-folder grants at the next turn boundary and roll back if that turn fails to start. */
  setWorkFolders(folders: readonly string[]): void

  /** Effective folders are the last turn request, not a provider report; requested folders belong to the next turn. */
  readonly workFolders: {
    readonly effective: readonly string[]
    readonly requested: readonly string[]
  }

  /** True means this app can release planning; false also covers planning whose exit belongs to the provider. */
  readonly planNeedsGoAhead: boolean

  /** Interrupt the current turn and its owned foreground commands; the provider may report completion if it already finished. */
  interrupt(): Promise<void>

  /** An explicit stop also ends work that the stopped turn left running, where the adapter supports it. */
  endEverythingTheTurnStarted?(): void

  /** Detach foreground waiting without ending the work; false means the named work was no longer running. */
  backgroundWork?(toolCallId?: string): Promise<boolean>

  /** Ask the provider to stop one background id; true means a request went out, and its ended event proves completion. */
  stopBackgroundWork?(id: string): Promise<boolean>

  /** Read the state of a ledger-known child without sending input or changing the parent turn. */
  childState?(childId: string): Promise<ChildThreadState>

  /** Send only to an idle child; return known refusal states and preserve transport failures as errors. */
  childInput?(childId: string, text: string): Promise<ChildInputOutcome>

  /** Read an already-held command tail synchronously; null is unheld, while empty text is held without output. */
  commandOutput?(toolCallId: string): CommandTail | null

  /** Read the held answer synchronously; null is unheld, while empty parts mean a real answer with no content. */
  toolAnswer?(toolCallId: string): ToolAnswer | null

  /** The current cached status (does not re-query the provider). */
  status(): SessionStatus

  /** Join the session wait count only for this active await; the returned idempotent release ends this caller wait once. */
  waitForAPerson(): () => void

  /** End the session and reject pending permission/input requests so no caller remains waiting. */
  close(): Promise<void>
}

/** A failed resume retains its requested ref and cause; it must not silently create a fresh session. */
export class ResumeError extends Error {
  readonly ref: SessionRef

  /** Only an adapter-confirmed missing session sets this; an unrecognized attempt failure must retain the conversation. */
  readonly noSuchSession: boolean

  /** Preserve the original setup failure as the resume error cause. */
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

/** Display at most this many characters from the first provider refusal line. */
export const START_REFUSED_SAID_MAX = 300

/** A provider answered with a start refusal; unusable or missing responses use StartFailed instead. */
export class StartRefused extends Error {
  /** Expose the first bounded refusal line without UUIDs; retain paths and keep the complete message in the log. */
  readonly said: string | null

  constructor(
    provider: Provider,
    /** What the provider was asked, for the log — e.g. `thread/start`. */
    asked: string,
    providerWords: string | null,
    options: { readonly cause: unknown },
  ) {
    // Keep the complete provider message in the log; said is the displayed first line.
    super(`${provider} refused ${asked}: ${providerWords ?? 'it gave no reason'}`, {
      cause: options.cause,
    })
    this.said = firstLineOf(providerWords)
  }
}

/** Remove provider UUIDs from the displayed refusal while the log retains the complete reason. */
const AN_ID_IN_ITS_WORDS = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/** {@link StartRefused.said}'s shape: the first non-blank line, no UUID in it, bounded, or `null`. */
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

/** An unusable provider start response; spawn errno and app cancellation retain their own error shapes. */
export class StartFailed extends Error {}

/** Use the nearest matching error class on the cause chain; bounded traversal also ends loops. */
function onItsChain<T>(error: unknown, kind: abstract new (...args: never[]) => T): T | null {
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

/** The StartRefused on this error cause chain, or null. */
export function startRefusalOf(error: unknown): StartRefused | null {
  return onItsChain(error, StartRefused)
}

/** The StartFailed on this error cause chain, or null. */
export function startFailureOf(error: unknown): StartFailed | null {
  return onItsChain(error, StartFailed)
}

/** Only these temporary resource shortages are expected to clear without a person changing the setup. */
export const TRANSIENT_SETUP_CODES = ['EMFILE', 'ENFILE', 'EAGAIN', 'ENOMEM'] as const

export type TransientSetupCode = (typeof TRANSIENT_SETUP_CODES)[number]

/** The nearest string errno decides; do not skip an outer permanent cause to find a transient inner cause. */
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

/** Classify only a nearest spawn errno outside the transient set as a program failure requiring action. */
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

/** Folder-write failures require action; EEXIST counts only for mkdir, since an open lock may clear. */
export const FOLDER_CODES_A_PERSON_MUST_FIX = [
  'EACCES',
  'EPERM',
  'EROFS',
  'ENOSPC',
  'EDQUOT',
  'ENOTDIR',
] as const

/** Read-only syscalls do not describe a failure to create or write a folder. */
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

/** Classify the nearest folder-write errno, excluding spawn, read and provider-resume failures. */
export function folderAPersonMustFixOf(
  error: unknown,
  /** An open counts as a write only on a launch path that performs writes; readers pass false. */
  opensAreWrites = true,
): { readonly code: string; readonly path: string | null; readonly syscall: string | null } | null {
  const visited = new Set<unknown>()
  let step: unknown = error
  while (step !== null && typeof step === 'object' && !visited.has(step) && visited.size < 16) {
    visited.add(step)
    // Provider resume failures are handled by their own cause readers.
    if (step instanceof ResumeError) return null
    const { code, syscall, path } = step as { code?: unknown; syscall?: unknown; path?: unknown }
    if (typeof code === 'string') {
      const aSpawnsCode = typeof syscall === 'string' && syscall.startsWith('spawn')
      // A read cannot explain a failure to create or write a folder.
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

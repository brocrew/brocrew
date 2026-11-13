import {
  namesForeignThread,
  countForeignDrop,
  notificationScopeSummary,
  isTurnScopedContent,
} from './runtime-parts/notification-scope'
import {
  noteTurnMovedOn,
  newCodexTurn,
  CLOSE_FLUSH_TIMEOUT_MS,
  CLOSE_INTERRUPT_TIMEOUT_MS,
  COMMANDS_END_WITHIN_MS,
  COMMAND_LIST_TIMEOUT_MS,
  COMPACTION_START_TIMEOUT_MS,
  A_COMPACTION_IS_STILL_OUTSTANDING,
  type CodexTurn,
} from './runtime-parts/turn-state'
import {
  restatedPlan,
  toolInventoryFor,
  validateCodexProtocolVersion,
  validatedThreadRef,
  childStateFrom,
  readChildThread,
  sendChildInput,
  resolvedImage,
  withKeyErrorDetail,
} from './runtime-parts/session-views'
import {
  assertAuthHealthy,
  openingParams,
  assertPromptingProfile,
  grantKeptTools,
  logInWithCodexKey,
} from './runtime-parts/session-start'
import { answerPermission, answerUserInput } from './runtime-parts/permission-responses'
import {
  prepareApprovalRequest,
  prepareUserInputRequest,
} from './runtime-parts/request-preparation'
import {
  elicitationPayloadFor,
  declinedToolCall,
  elicitationScopeProblem,
  requestScopeProblem,
  type ForwardedUserInput,
  serverRequestKind,
  safeRefusal,
  aToolApprovalsPositives,
  codexToolCall,
  userInputPayloadFor,
  userInputDecline,
  codexDecision,
  type ServerRequestKind,
  type RequestState,
} from './runtime-parts/server-requests'
import {
  errorMessage,
  isRecord,
  readString,
  readOptionalString,
  requestKey,
  numericIdFromKey,
  readField,
  readStringArray,
} from './runtime-parts/wire-values'
import {
  initializeParams,
  phasesOf,
  sayingTheRelease,
  aFailedStart,
  planPhaseOf,
  launchSettingsFor,
  approvalProfileProblems,
  sandboxTypeOf,
  askPolicyOf,
  askBaselineOf,
  workRootsFor,
  reportedAgentInfo,
  collaborationModeFor,
  turnStartParams,
  turnInterruptParams,
  type WorkspaceWritePolicy,
  type PlanPhase,
} from './runtime-parts/request-params'
import {
  type AgentRuntime,
  type ModelChoice,
  type ProviderRuntimeContext,
  resolveReasoningEffort,
  ResumeError,
  type ResumeOptions,
  type SessionHandle,
  type StartOptions,
  type BuiltInSkillsContext,
  type StartPhaseSink,
  type AgentInfo,
  type ApprovalMode,
  isAutoApprove,
  type ReasoningEffort,
  type SessionSettingsState,
} from '../runtime'
import type { SessionRef } from '../session-ref'
import { AuthUnavailableError, type AuthHealth } from '../internal/auth'
import {
  codexAccountInNow,
  codexCopyIdentityIn,
  type CodexCopyIdentity,
  codexAccountIn,
  CodexRefusedItsSignInError,
  isTheSameCodexCopy,
} from './auth'
import { assertNotCancelled, cancelWith, withDeadline, withTimeout } from '../internal/bounded'
import type { CodexTransport } from './codex-transport'
import { codexNoLongerHasTheThread } from './lost-thread'
import { beginCodexHomeBoot } from './home-boot'
import { ensureCodexMemoryConfig, type CodexMemoryConfigResult } from './memory-config'
import { removeStaleCodexPermissionConfig } from './stale-permission-config'
import { agentToolCard, elicitationCard } from './runtime-parts/request-cards'
import { nativeAccountTag } from './account-identity'
import type { ManagedPluginMcpServer } from '../managed-plugin-mcp'
import type { ManagedPluginObserver } from '../managed-plugin-observation'
import { BUILT_IN_SKILLS_FAILURE } from '../built-in-skills'
import { registerCodexBuiltInSkills } from './built-in-skills'
import type { SessionStatus } from '@brobot2/shared'
import { beyondItsRailsOf, type AgentToolset } from '../agent-tools'
import { answerCodexToolCall } from './agent-tools'
import type { ExternalMcpReach } from '../external-mcp'
import {
  codexElicitation,
  codexToolApproval,
  McpCallsInFlight,
  opensALink,
  type ClaimedToolApproval,
} from './external-mcp'
import { keptToolApprovals } from './kept-tool-approvals'
import { ApprovalModeSwitch, type ApprovalModeState } from '../approval-mode'
import { CommandTails, type CommandTail } from '../command-output'
import { ToolAnswers, type ToolAnswer } from '../tool-answer'
import { MessageActCalls } from '../message-act'
import { NextTurnSetting, sessionSettings, requestPlanMode } from '../next-turn'
import { wrapUnknown, type PlanStep, type RuntimeEvent, type TurnLimit } from '../events'
import {
  publishedOffer,
  type PermissionDecision,
  type PermissionOutcome,
  type UserInputResponse,
} from '../permission'
import type { LaunchSetting } from '../launch-settings'
import { authStateReason, blocksLaunch } from '../auth-state'
import { probeCodexAuth } from './auth-probe'
import {
  MANAGED_PLUGIN_READY_WITHIN_MS,
  failedManagedPluginConnections,
  waitForManagedPluginTools,
} from './managed-plugin-readiness'
import { AsyncQueue } from '../internal/async-queue'
import { DeltaCoalescer } from '../internal/delta-coalescer'
import { endsOpenSubAgents, OpenSubAgents } from '../internal/open-sub-agents'
import { RequestBroker } from '../internal/request-broker'
import { isProviderWork } from '../internal/provider-work'
import { SessionMachine } from '../internal/session-machine'
import { StallWatchdog } from '../internal/stall-watchdog'
import {
  RateLimitWatch,
  codexToolAnswerParts,
  codexTurnHitItsUsageLimit,
  codexTurnFailedOnItsCredential,
  codexTurnOutcome,
  normalizeNotification,
} from './normalize'
import {
  CHILD_STATE_UNKNOWN,
  type ChildInputOutcome,
  childInputRefusal,
  type ChildThreadState,
} from '../child-conversation'
import { PatchTargets } from './patch-targets'
import { BackgroundTerminals } from './background-terminals'
import { CodexSubAgents } from './sub-agents'
import type { ThreadCompactStartParams } from './protocol/v2/ThreadCompactStartParams'
import type { ThreadResumeParams } from './protocol/v2/ThreadResumeParams'
import type { ThreadStartParams } from './protocol/v2/ThreadStartParams'
import { type TransportFactory, createSpawnTransportFactory } from './codex-transport'
import {
  MODEL_LIST_PAGE_LIMIT,
  MODEL_PROBE_TIMEOUT_MS,
  modelChoiceOf,
} from './runtime-parts/model-catalogue'
import { seedRateLimitBaseline, readProviderCommands } from './runtime-parts/initial-observations'
export {
  codexAppServerArgs,
  createSpawnTransportFactory,
  type CodexLaunchContext,
  type TransportFactory,
} from './codex-transport'
export { A_COMPACTION_IS_STILL_OUTSTANDING } from './runtime-parts/turn-state'
export { THE_AGENT_ASKS_FOR_ACCESS, CODEX_EXEC_POLICY_RULES } from './runtime-parts/server-requests'
export {
  APPROVAL_PROFILES,
  CODEX_PLAN_TOOL_CONFIG,
  CODEX_QUESTION_TOOL_CONFIG,
} from './runtime-parts/request-params'

const defaultTransport = createSpawnTransportFactory()

export const CODEX_TOOLS_TURNED_OFF: readonly string[] = [
  'request_user_input',
  'request_user_input_async',
]

export const CODEX_TOOLS_LEFT_ON: readonly string[] = []

export class CodexSessionHandle implements SessionHandle {
  private readonly provider = 'codex' as const
  private readonly eventQueue = new AsyncQueue<RuntimeEvent>()
  private readonly coalescer = new DeltaCoalescer((event) => this.deliver(event))
  private readonly machine = new SessionMachine((event) => this.emit(event))
  private readonly permissions = new RequestBroker<PermissionDecision>(
    () => this.isShuttingDown,
    () => ({ outcome: 'deny', message: 'session closed' }),
  )
  private readonly userInputs = new RequestBroker<UserInputResponse>(
    () => this.isShuttingDown,
    () => ({ kind: 'reject' }),
  )

  private _ref: SessionRef | null
  private readonly backgroundTerminals = new BackgroundTerminals({
    request: (method, params) => this.transport.request(method, params),
    emit: (event) => {
      this.closeEndedCommandOutput(event)
      this.emit(event)
    },
    threadId: () => this._ref?.sessionId,
    open: () => !this.terminated && !this.machine.isTerminal,
  })
  private readonly commandTails = new CommandTails()
  // Answers survive close for later readers; live command tails are swept during close.
  private readonly toolAnswers = new ToolAnswers()
  private currentStatus: SessionStatus = 'idle'
  private currentTurn: CodexTurn | null = null
  private managedPluginsChecked: string | undefined
  private managedPluginObservationVersion = 0
  private managedPluginFailureReported = false
  private managedPluginWait: {
    localId: CodexTurn['localId']
    controller: AbortController
  } | null = null
  private messageTurn: CodexTurn | null = null
  private messageCalls = new MessageActCalls()
  // Keep the machine turn open while its command-ending passes drain; an explicit stop can widen them.
  private completing: { readonly turn: CodexTurn; readonly done: Promise<void> } | null = null
  private lastBoundTurnId: string | null = null
  // A timed-out accepted compaction may still start. Block another until it appears or our turn ends.
  private compactionOutstanding = false
  private readonly inFlight = new Set<Promise<void>>()
  // One synchronous namespace: unseen -> claimed -> spent -> retired. Raw id types stay distinct.
  private readonly requestStates = new Map<string, RequestState>()
  // Numeric ids increase on the wire; this floor retains retired answers without one tombstone per id.
  private maxRetiredNumericId = -1
  private terminated = false
  private closing: Promise<void> | null = null

  private readonly _targetRef: SessionRef | null

  // Child status can arrive after the parent turn ends; openSubAgents seals any remaining cards.
  private readonly subAgents = new CodexSubAgents(() => this._ref?.sessionId)

  private readonly openSubAgents = new OpenSubAgents()

  private readonly patches = new PatchTargets()

  private readonly mcpCalls = new McpCallsInFlight()

  // Per-handle history: a second conversation must not inherit another conversation's warning state.
  private readonly rateLimits = new RateLimitWatch()
  private launchedOnAKey = false
  private launchAccount: string | null | undefined = undefined
  private launchCopy: CodexCopyIdentity | null = null
  private _signInSuperseded = false

  constructor(
    private readonly transport: CodexTransport,
    private readonly cwd: string,
    private readonly rotation: number,
    private readonly providerHome: string,
    targetRef?: SessionRef,
    approvalMode?: ApprovalMode,
    seedEffort?: ReasoningEffort,
    seedPlanPhase: PlanPhase = 'never',
    seedModel?: string,
    private readonly agentTools?: AgentToolset,
    private readonly externalMcp?: ExternalMcpReach,
    seedWorkFolders: readonly string[] = [],
    private readonly memoryConfig?: CodexMemoryConfigResult,
    private readonly builtInSkills?: BuiltInSkillsContext,
    private readonly sharedSkillsRoot?: string,
    private readonly beforeSkillDiscovery?: () => Promise<void>,
    private readonly managedPluginMcp?: readonly ManagedPluginMcpServer[],
    private readonly managedPluginObserver?: ManagedPluginObserver,
    private readonly apiKey?: string,
  ) {
    this._targetRef = targetRef ?? null
    this._ref = null
    this.approvals = new ApprovalModeSwitch(approvalMode)
    this.models = new NextTurnSetting<string | undefined>(seedModel)
    this.efforts = new NextTurnSetting<ReasoningEffort | undefined>(seedEffort)
    this.plan = new NextTurnSetting<PlanPhase>(seedPlanPhase)
    this.folders = new NextTurnSetting<readonly string[]>([...seedWorkFolders])
  }

  private readonly models: NextTurnSetting<string | undefined>
  private readonly efforts: NextTurnSetting<ReasoningEffort | undefined>
  private readonly plan: NextTurnSetting<PlanPhase>

  private readonly folders: NextTurnSetting<readonly string[]>

  // Ever-sent roots are removed from later server echoes, including echoes that lag a turn.
  private readonly workFoldersSent = new Set<string>()

  // Remember server roots until the first work folder is sent, then preserve that original baseline.
  private theThreadsOwnRoots: ReadonlySet<string> = new Set()

  // Requested settings take effect only when a turn adopts them; disclosures use effective settings.
  private readonly approvals: ApprovalModeSwitch

  // Re-pin the server's reported sandbox, with our work folders removed, rather than its raw echo.
  private observedAskPolicy: WorkspaceWritePolicy | null = null

  get approval(): ApprovalModeState {
    return { effective: this.approvals.effective, requested: this.approvals.requested }
  }

  get blanketGrants(): readonly string[] {
    return this.mcpCalls.grants
  }

  setApprovalMode(mode: ApprovalMode): Promise<void> {
    this.approvals.request(mode)
    return Promise.resolve()
  }

  get planNeedsGoAhead(): boolean {
    return this.plan.requested === 'planning'
  }

  get settings(): SessionSettingsState {
    return sessionSettings(this.models, this.efforts, this.plan)
  }

  setModel(model: string | undefined): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change the model: this session is no longer active'))
    }
    this.models.request(model)
    return Promise.resolve()
  }

  get workFolders(): NonNullable<SessionHandle['workFolders']> {
    return { effective: this.folders.effective, requested: this.folders.requested }
  }

  setWorkFolders(folders: readonly string[]): void {
    this.folders.request([...folders])
  }

  // Effort names are provider-owned and open-ended. Validate types, not a fixed local catalogue.
  setReasoningEffort(effort: ReasoningEffort | undefined): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change the effort: this session is no longer active'))
    }
    this.efforts.request(effort)
    return Promise.resolve()
  }

  // Never-planned stays distinct from left-plan: only the latter reasserts the sticky default mode.
  setPlanMode(on: boolean): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change plan mode: this session is no longer active'))
    }
    return requestPlanMode(this.plan, on)
  }

  get providerPid(): number | undefined {
    return this.transport.pid
  }

  awaitProcessExit(): Promise<void> | undefined {
    return this.transport.quiesced ?? this.transport.exited
  }

  private _agentInfo: AgentInfo | undefined

  get agentInfo(): AgentInfo | undefined {
    return this._agentInfo
  }

  private _instructionSources: readonly string[] | undefined

  get instructionSources(): readonly string[] | undefined {
    return this._instructionSources
  }

  private _launchSettings: readonly LaunchSetting[] | undefined

  get launchSettings(): readonly LaunchSetting[] | undefined {
    return this._launchSettings
  }

  // Merge only reported fields so a sparse update cannot erase an earlier model or effort.
  private mergeAgentInfo(next: AgentInfo): void {
    const merged = { ...this._agentInfo, ...next }
    if (
      merged.model !== this._agentInfo?.model ||
      merged.reasoningEffort !== this._agentInfo?.reasoningEffort
    ) {
      this._agentInfo = merged
    }
  }

  // Thread config carries effort too, so initial work and compaction agree with the first turn.
  private openTheThread(
    method: 'thread/start' | 'thread/resume',
    params: ThreadStartParams | ThreadResumeParams,
  ): Promise<unknown> {
    const effort = this.efforts.requested
    if (effort !== undefined) params.config = { ...params.config, model_reasoning_effort: effort }
    this._launchSettings = launchSettingsFor(
      params,
      this.memoryConfig,
      this.plan.requested,
      this.approvals.effective,
      CODEX_TOOLS_TURNED_OFF,
      CODEX_TOOLS_LEFT_ON,
    )
    return this.transport.request(method, params)
  }

  get ref(): SessionRef | null {
    return this._ref
  }

  private get isShuttingDown(): boolean {
    return this.machine.isTerminal || this.machine.state === 'closing'
  }

  async begin(
    opening: 'started' | 'resumed',
    model: string | undefined,
    systemHint?: string,
    bootSettled?: () => void,
  ): Promise<void> {
    this.machine.markStarting()
    this.startPhase('initialize-sent')
    const initResult = await this.transport.request('initialize', initializeParams())
    this.startPhase('initialized')
    bootSettled?.()
    this.validateProtocolVersion(initResult)
    this.transport.notify('initialized', {})
    await this.assertCredentialUsable()
    if (this.builtInSkills) {
      try {
        await this.beforeSkillDiscovery?.()
        await registerCodexBuiltInSkills(
          this.builtInSkills,
          this.cwd,
          (method, params) =>
            withDeadline(this.transport.request(method, params), COMMAND_LIST_TIMEOUT_MS, method),
          this.sharedSkillsRoot,
        )
      } catch (cause) {
        throw new Error(BUILT_IN_SKILLS_FAILURE, { cause })
      }
      this.startPhase('skills-registered')
    }
    const kept = keptToolApprovals(this.providerHome)
    grantKeptTools(kept, this.externalMcp, this.mcpCalls)
    const workRoots = this.sendingWorkFolders(this.approvals.effective, this.folders.effective)
    this.startPhase('thread-sent')
    const response = await this.openTheThread(
      opening === 'started' ? 'thread/start' : 'thread/resume',
      openingParams(
        opening,
        this._targetRef,
        this.cwd,
        model,
        systemHint,
        this.approvals.effective,
        this.agentTools,
        this.externalMcp,
        kept,
        workRoots,
        this.managedPluginMcp,
      ),
    )
    const answerBytes = this.transport.responseBytes?.(
      opening === 'started' ? 'thread/start' : 'thread/resume',
    )
    this.startPhase(
      'thread-answered',
      answerBytes === undefined ? undefined : { bytes: answerBytes },
    )
    this.mergeAgentInfo(
      reportedAgentInfo(
        readOptionalString(response, 'model'),
        readOptionalString(response, 'reasoningEffort'),
      ),
    )
    this._instructionSources = readStringArray(response, 'instructionSources')
    const ref = this.validateHandshake(response, opening)
    this.validateApprovalProfile(response)
    this.startPhase('validated')
    this.machine.sessionStarted(ref, opening)
    this.readRateLimitBaseline()
    this.readCommandList('thread/start')
    this.publishToolInventory(opening === 'started' ? 'thread/start' : 'thread/resume')
    void this.runLoop()
  }

  private publishToolInventory(source: string): void {
    this.emit(toolInventoryFor(source, this.agentTools))
  }

  // Do not delay launch. Seed underneath newer rolling observations when this bounded read returns.
  private readRateLimitBaseline(): void {
    seedRateLimitBaseline(this.transport, this.rateLimits, (event) => this.emit(event))
  }

  // Read skills without a throwaway thread; only discovered provider skills become commands.
  private readCommandList(why: string): void {
    readProviderCommands(this.transport, why, (event) => this.emit(event))
  }

  signInTag(): string | null {
    const account = this.launchAccount
    return account == null || account === 'api-key' ? null : nativeAccountTag(account)
  }

  // Compare account identities, not rotating sign-in tokens; latch a detected account change.
  async checkSignIn(): Promise<boolean> {
    if (this._signInSuperseded) return true
    if (this.launchAccount === null || this.launchAccount === undefined) return false
    const current = await codexAccountIn(this.providerHome)
    if (current === null || current === this.launchAccount) return false
    this._signInSuperseded = true
    return true
  }

  get signInSuperseded(): boolean {
    return this._signInSuperseded
  }

  signInCopyAtLaunch(): CodexCopyIdentity | null {
    return this.launchCopy
  }

  private startPhase: StartPhaseSink = () => {}

  noteStartPhases(sink: StartPhaseSink): void {
    this.startPhase = sink
  }

  noteLaunchAccount(account: string | null, copy: CodexCopyIdentity | null = null): void {
    this.launchAccount = account
    this.launchCopy = copy
  }

  private async assertCredentialUsable(): Promise<void> {
    if (this.apiKey !== undefined) {
      await logInWithCodexKey(this.transport, this.apiKey)
      this.launchedOnAKey = true
      return
    }
    if (this.launchAccount === undefined)
      this.noteLaunchAccount(await codexAccountIn(this.providerHome))
    const state = await probeCodexAuth(this.transport)
    this.launchedOnAKey = state.state === 'usable' && state.login === 'api-key'
    if (!blocksLaunch(state)) return
    if (state.state === 'stale') {
      const now = codexCopyIdentityIn(this.providerHome)
      throw new CodexRefusedItsSignInError(
        authStateReason(state),
        isTheSameCodexCopy(this.launchCopy, now) ? now : null,
      )
    }
    throw new AuthUnavailableError('codex', authStateReason(state))
  }

  private validateApprovalProfile(response: unknown): void {
    const r = isRecord(response) ? response : {}
    this.observeAskPolicy(r['sandbox'])
    assertPromptingProfile(r, this.approvals.effective)
  }

  // Only a complete workspaceWrite echo updates the remembered policy.
  private observeAskPolicy(value: unknown): void {
    const policy = askPolicyOf(value)
    if (policy === null) return
    this.observedAskPolicy = policy
    if (this.workFoldersSent.size === 0) this.theThreadsOwnRoots = new Set(policy.writableRoots)
  }

  // Record roots before writing the request so an immediate echo cannot become the baseline.
  private sendingWorkFolders(
    approvalMode: ApprovalMode | undefined,
    folders: readonly string[],
  ): readonly string[] {
    const roots = workRootsFor(
      approvalMode,
      this.sharedSkillsRoot ? [...new Set([...folders, this.sharedSkillsRoot])] : folders,
    )
    for (const root of roots) this.workFoldersSent.add(root)
    return roots
  }

  private validateProtocolVersion(response: unknown): void {
    validateCodexProtocolVersion(response)
  }

  private validateHandshake(response: unknown, opening: 'started' | 'resumed'): SessionRef {
    return validatedThreadRef(
      response,
      opening,
      this.provider,
      this.cwd,
      this.rotation,
      this._targetRef,
    )
  }

  // Image resolution precedes persistence; coalescing flushes deltas before non-delta events.
  private emit(event: RuntimeEvent): void {
    if (this.terminated) return
    this.coalescer.feed(event)
  }

  private readonly stallWatchdog = new StallWatchdog((idleMs, afterReasoning) =>
    this.reportStall(idleMs, afterReasoning),
  )

  private readonly reportStall = StallWatchdog.reporterFor(
    this.machine,
    () => this.terminated,
    () => this.currentStatus,
    (event) => this.emit(event),
  )

  // Advance the watchdog before provider bookkeeping; the queue receives the resulting events in order.
  private deliver(event: RuntimeEvent): void {
    this.stallWatchdog.progress(event, this.machine.hasProviderWork)
    if (isProviderWork(event)) this.machine.noteProviderWork(event.type)
    if (event.type === 'status') this.currentStatus = event.state
    if (event.type === 'session' && event.state !== 'ended') this._ref = event.ref
    if (endsOpenSubAgents(event)) {
      for (const closing of this.openSubAgents.closeAll()) {
        this.subAgents.seal(closing)
        this.eventQueue.push(closing)
      }
    }
    this.openSubAgents.note(event)
    if (event.type === 'turn') this.retireSettledRequestIds()
    this.eventQueue.push(event)
  }

  private track(handler: Promise<void>): void {
    this.inFlight.add(handler)
    void handler.finally(() => this.inFlight.delete(handler)).catch(() => {})
  }

  private async runLoop(): Promise<void> {
    try {
      for await (const incoming of this.transport.incoming()) {
        if (incoming.kind === 'notification') this.onNotification(incoming.method, incoming.params)
        else this.onServerRequest(incoming.id, incoming.method, incoming.params)
      }
      if (!this.machine.isTerminal) this.finishUnexpected('the codex app-server stream ended')
    } catch (error) {
      if (!this.machine.isTerminal) this.finishUnexpected(errorMessage(error))
    }
  }

  private notificationsSeen = 0

  // Attribute bounded method names; excess names share the overflow bucket without losing the total.
  private readonly foreignThreadDrops = new Map<string, number>()

  private frameScopeAdopted = 0

  private countForeignDrop(method: string): void {
    countForeignDrop(this.foreignThreadDrops, method)
  }

  // Adopted child reports remain a subset of dropped foreign content, not a deduction from it.
  get frameScope(): ReturnType<typeof notificationScopeSummary> {
    return notificationScopeSummary(
      this.foreignThreadDrops,
      this.notificationsSeen,
      this.frameScopeAdopted,
    )
  }

  // Notification scope tolerates absent ids; thread/status/changed names its subject, not its scope.
  private namesForeignThread(method: string, params: unknown): boolean {
    return namesForeignThread(method, params, this._ref)
  }

  // Keep thread filtering, turn filtering, parser updates and event delivery in wire order.
  private onNotification(method: string, params: unknown): void {
    if (this.terminated) return
    this.notificationsSeen += 1
    if (this.namesForeignThread(method, params)) {
      this.countForeignDrop(method)
      const reports = this.subAgents.report(method, params)
      if (reports.length > 0) this.frameScopeAdopted += 1
      for (const event of reports) this.emit(event)
      return
    }
    if (method === 'skills/changed') {
      this.readCommandList(method)
    }
    if (method === 'thread/settings/updated') {
      this.checkSettingsProfile(params)
      const settings = isRecord(params) ? params['threadSettings'] : undefined
      this.mergeAgentInfo(
        reportedAgentInfo(
          readOptionalString(settings, 'model'),
          readOptionalString(settings, 'effort'),
        ),
      )
      return
    }
    if (method === 'turn/completed') {
      const ours = this.onTurnCompleted(params)
      if (ours) this.compactionOutstanding = false
      if (ours) this.backgroundTerminals.note(method)
      return
    }
    if (method === 'serverRequest/resolved') {
      this.onServerRequestResolved(params)
      return
    }
    if (method === 'model/rerouted') {
      const toModel = readString(params, 'toModel')
      if (toModel) this.mergeAgentInfo({ model: toModel })
    }
    if (method === 'turn/started') {
      const startedId = readString(isRecord(params) ? params['turn'] : undefined, 'id')
      if (this.bindsACompactionAt(startedId)) {
        this.bindProviderTurn(startedId)
        return
      }
      if (!this.isCurrentProviderTurn(startedId)) this.compactionOutstanding = false
      if (this.currentTurn?.interruptAsked && this.isCurrentProviderTurn(startedId)) {
        void this.sendInterruptRpc(startedId)
      }
      return
    }
    if (method === 'item/completed') this.noteToolAnswer(params)
    if (method === 'item/commandExecution/outputDelta') this.noteCommandOutput(params)
    if (method === 'item/completed') this.closeCommandOutput(params)
    if (isTurnScopedContent(method) && !this.isCurrentProviderTurn(readString(params, 'turnId'))) {
      return
    }
    this.patches.note(method, params)
    this.mcpCalls.note(method, params)
    this.noteWhatTheTurnMovedOnTo(method, params)
    for (const normalized of normalizeNotification(method, params, this.rateLimits)) {
      const event = this.withMessageReceipt(normalized, method, params)
      this.subAgents.note(event)
      if (event.type === 'tool_call' && event.backgroundId !== undefined) {
        this.currentTurn?.commands.set(event.id, { movedOn: false })
      }
      this.emit(
        this.resolveImage(
          this.restatePlan(this.markTheAskedCompaction(this.sayWhichKey(event, method, params))),
        ),
      )
    }
    for (const event of this.subAgents.status(method, params)) this.emit(event)
  }

  private sayWhichKey(event: RuntimeEvent, method: string, params: unknown): RuntimeEvent {
    return withKeyErrorDetail(event, method, params, this.launchedOnAKey)
  }

  // Only the turn started by compact() receives a manual trigger; automatic compaction stays unmarked.
  private markTheAskedCompaction(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== 'compaction' || this.currentTurn?.bindsAtItsStart !== true) return event
    return { ...event, trigger: 'manual' }
  }

  private resolveImage(event: RuntimeEvent): RuntimeEvent {
    return resolvedImage(event, this.providerHome, this._ref?.sessionId)
  }

  private planSteps: PlanStep[] = []

  // A plan document restates the saved checklist; copy steps so consumers cannot mutate that memory.
  private restatePlan(event: RuntimeEvent): RuntimeEvent {
    const restated = restatedPlan(event, this.planSteps)
    if (restated.savedSteps !== undefined) this.planSteps = restated.savedSteps
    return restated.event
  }

  // Bind once from the response and send a latched interrupt; turn/started retries it when runnable.
  private bindProviderTurn(providerTurnId: string): void {
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId !== null || !providerTurnId) return
    turn.providerTurnId = providerTurnId
    this.lastBoundTurnId = providerTurnId
    if (turn.interruptPending) {
      turn.interruptPending = false
      void this.sendInterruptRpc(providerTurnId)
    }
  }

  // A delayed response for an earlier local turn must not bind the current one.
  private onTurnStartResult(localId: number, result: unknown): void {
    if (this.terminated) return
    if (this.currentTurn?.localId !== localId) return
    const providerTurnId = readString(isRecord(result) ? result['turn'] : undefined, 'id')
    if (!providerTurnId) {
      this.finishUnexpected(
        'codex turn/start returned a malformed result (missing turn id); cannot correlate the turn',
        true,
      )
      return
    }
    this.bindProviderTurn(providerTurnId)
  }

  // Only an unbound compaction can bind from a new started id; reject the previously bound id.
  private bindsACompactionAt(startedId: string): boolean {
    const turn = this.currentTurn
    return (
      turn?.bindsAtItsStart === true &&
      turn.providerTurnId === null &&
      startedId !== '' &&
      startedId !== this.lastBoundTurnId
    )
  }

  // Content cannot bind a turn. It must match the response-bound id on the current machine turn.
  private isCurrentProviderTurn(turnId: string): boolean {
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId === null) return false
    return turnId === turn.providerTurnId
  }

  // Only matching provider completion ends a local turn; keep the provider's own outcome.
  private onTurnCompleted(params: unknown): boolean {
    const p = isRecord(params) ? params : {}
    const completedTurnId = readString(isRecord(p['turn']) ? p['turn'] : undefined, 'id')
    if (!this.isCurrentProviderTurn(completedTurnId)) return false
    const outcome = codexTurnOutcome(params)
    const ended = this.currentTurn
    this.messageCalls.close()
    this.currentTurn = null
    const hitItsUsage = codexTurnHitItsUsageLimit(params)
    const outOfQuota = hitItsUsage && this.launchedOnAKey
    const limit = hitItsUsage && !outOfQuota ? this.rateLimits.reachedLimit() : undefined
    const refused = codexTurnFailedOnItsCredential(params)
      ? { loginRefused: true as const, ...(this.launchedOnAKey ? { onAKey: true as const } : {}) }
      : outOfQuota
        ? { billingRefused: true as const, onAKey: true as const }
        : undefined
    if (ended?.interruptAsked === true && ended.commands.size > 0) {
      this.completing = {
        turn: ended,
        done: this.completeOnceItsCommandsEnd(ended, outcome, limit, refused),
      }
      return true
    }
    this.machine.completeTurn(outcome.outcome, outcome.message, limit, undefined, refused)
    return true
  }

  // Wait for the last serialized ending pass, including a pass added by an explicit stop.
  private async completeOnceItsCommandsEnd(
    turn: CodexTurn,
    outcome: ReturnType<typeof codexTurnOutcome>,
    limit: TurnLimit | undefined,
    refused: Parameters<SessionMachine['completeTurn']>[4],
  ): Promise<void> {
    const giveUpAt = Date.now() + COMMANDS_END_WITHIN_MS
    let waited: Promise<void> = this.endWhatTheTurnStarted(turn)
    await withTimeout(waited, COMMANDS_END_WITHIN_MS)
    while (waited !== turn.commandsEnding && Date.now() < giveUpAt) {
      waited = turn.commandsEnding
      await withTimeout(waited, giveUpAt - Date.now())
    }
    if (this.completing?.turn === turn) this.completing = null
    if (this.machine.openTurnId === turn.localId) {
      this.machine.completeTurn(outcome.outcome, outcome.message, limit, undefined, refused)
    }
  }

  // Best-effort RPC: provider completion remains authoritative even if the interrupt is refused.
  private sendInterruptRpc(providerTurnId: string): Promise<void> {
    return Promise.resolve(
      this.transport.request(
        'turn/interrupt',
        turnInterruptParams(this._ref!.sessionId, providerTurnId),
      ),
    )
      .then(() => undefined)
      .catch(() => {})
  }

  // Cancel this card's turn without settling other open cards or invoking full-session interrupt().
  private async askTheTurnToStop(providerTurnId: string): Promise<void> {
    if (!providerTurnId) return
    await this.sendInterruptRpc(providerTurnId)
  }

  private checkSettingsProfile(params: unknown): void {
    const settings =
      isRecord(params) && isRecord(params['threadSettings']) ? params['threadSettings'] : {}
    this.observeAskPolicy(settings['sandboxPolicy'])
    const problems = approvalProfileProblems(
      settings['approvalsReviewer'],
      settings['approvalPolicy'],
      sandboxTypeOf(settings['sandboxPolicy']),
      this.approvals.effective,
    )
    if (problems.length === 0) return
    this.finishUnexpected(
      `codex changed to a non-prompting approval profile mid-session: ${problems.join('; ')}`,
      true,
    )
    void this.transport.close()
  }

  // Retire spent numeric ids at turn end; retain claimed requests and unordered string tombstones.
  private retireSettledRequestIds(): void {
    for (const [key, state] of this.requestStates) {
      if (state.phase !== 'spent') continue
      const numeric = numericIdFromKey(key)
      if (numeric !== null && numeric > this.maxRetiredNumericId) this.maxRetiredNumericId = numeric
      this.requestStates.delete(key)
    }
    this.permissions.retireSettled()
    this.userInputs.retireSettled()
  }

  private isRetiredRequestId(id: string | number): boolean {
    return typeof id === 'number' && id <= this.maxRetiredNumericId
  }

  get tombstoneCount(): number {
    return this.requestStates.size + this.permissions.answeredCount + this.userInputs.answeredCount
  }

  // Elicitation may stand between turns; a supplied turn id must still match, and malformed ids fail.
  private scopeProblemFor(kind: ServerRequestKind, params: unknown): string | null {
    if (kind.kind !== 'elicitation') return this.serverRequestScopeProblem(params)
    return elicitationScopeProblem(params, this._ref, this.currentTurn)
  }

  // Unlike notifications, actionable requests require both this thread and a bound current turn.
  private serverRequestScopeProblem(params: unknown): string | null {
    return requestScopeProblem(params, this._ref, this.currentTurn)
  }

  private phaseOf(id: string | number): 'unseen' | 'claimed' | 'spent' {
    const state = this.requestStates.get(requestKey(id))
    if (state) return state.phase
    return this.isRetiredRequestId(id) ? 'spent' : 'unseen'
  }

  // Mark spent before the wire write. Reentrant duplicates can never write a second answer.
  private spendRequest(id: string | number, write?: () => void): boolean {
    if (this.phaseOf(id) === 'spent') return false
    this.requestStates.set(requestKey(id), { phase: 'spent' })
    write?.()
    return true
  }

  // A claimed collision declines the existing owner once; spent or retired duplicates write nothing.
  private onIdCollision(id: string | number): void {
    const key = requestKey(id)
    const state = this.requestStates.get(key)
    if (state?.phase !== 'claimed') return
    if (state.messageCallId !== undefined) {
      this.messageCalls.consume(
        state.messageCallId,
        this.currentTurn?.providerTurnId ?? '',
        () => undefined,
      )
    }
    this.spendRequest(id, () => this.transport.respond(state.rawId, safeRefusal(state.kind)))
    if (this.settleOwnerFailClosed(key)) this.emit({ type: 'request_resolved', id: key })
  }

  private settleOwnerFailClosed(key: string): boolean {
    return (
      this.permissions.respond(key, {
        outcome: 'deny',
        message: 'duplicate provider request id',
      }) || this.userInputs.respond(key, { kind: 'reject' })
    )
  }

  private onServerRequest(id: string | number, method: string, params: unknown): void {
    if (this.terminated) return
    const phase = this.phaseOf(id)
    if (phase === 'spent') return
    const kind = serverRequestKind(method)
    if (kind.kind === 'unsupported') {
      if (phase === 'unseen')
        this.respondErrorToProvider(id, -32601, `unsupported request: ${method}`)
      return
    }
    if (this.scopeProblemFor(kind, params) !== null) {
      if (phase === 'unseen') this.respondToProvider(id, safeRefusal(kind))
      return
    }
    if (phase === 'claimed') {
      this.onIdCollision(id)
      return
    }
    this.requestStates.set(requestKey(id), { phase: 'claimed', rawId: id, kind })
    if (kind.kind === 'approval') {
      this.track(this.handleApproval(id, kind.approval, params))
    } else if (kind.kind === 'agentTool') {
      this.track(this.handleAgentToolCall(id, params))
    } else if (kind.kind === 'elicitation') {
      this.track(this.handleExternalMcpElicitation(id, params))
    } else {
      this.track(this.handleUserInputRequest(id, method, params))
    }
  }

  private callsForTheCurrentTurn(): MessageActCalls | undefined {
    if (this.terminated || this.currentTurn === null) return undefined
    if (this.messageTurn !== this.currentTurn) {
      this.messageCalls.close()
      this.messageCalls = new MessageActCalls()
      this.messageTurn = this.currentTurn
    }
    return this.messageCalls
  }

  private withMessageReceipt(event: RuntimeEvent, method: string, params: unknown): RuntimeEvent {
    if (method !== 'item/completed' || event.type !== 'tool_result' || !isRecord(params))
      return event
    const item = params['item']
    if (
      !isRecord(item) ||
      item['type'] !== 'dynamicToolCall' ||
      item['tool'] !== 'message_agent' ||
      (item['namespace'] !== this.agentTools?.server && item['namespace'] !== null)
    )
      return event
    const act = this.callsForTheCurrentTurn()?.consume(
      event.id,
      readString(params, 'turnId'),
      (call) => (event.ok ? call.act : undefined),
    )
    return act === undefined ? event : { ...event, messageAct: act }
  }

  // Reserve before publishing. Answer a cancelled tool before interrupting its turn; leave other cards open.
  private async handleAgentToolCall(id: string | number, params: unknown): Promise<void> {
    if (this.isShuttingDown) {
      this.respondToProvider(id, safeRefusal({ kind: 'agentTool' }))
      return
    }
    const call = codexToolCall(params)
    if (call === null) {
      this.respondToProvider(id, safeRefusal({ kind: 'agentTool' }))
      return
    }
    const turn = this.currentTurn
    const calls = this.callsForTheCurrentTurn()
    const callId = call.callId ?? ''
    const owned =
      call.tool === 'message_agent' &&
      this.agentTools?.tools.some((one) => one.name === call.tool) === true &&
      (call.namespace === null || call.namespace === this.agentTools.server)
    const messageClaim = calls?.claim(callId, turn?.providerTurnId ?? '', owned)
    const state = this.requestStates.get(requestKey(id))
    if (state?.phase === 'claimed' && messageClaim !== undefined) state.messageCallId = callId
    const completed = (answer: import('../agent-tools').AgentToolAnswer): void => {
      if (this.terminated || this.isShuttingDown || this.currentTurn !== turn) return
      calls?.remember(callId, messageClaim, answer.structured)
    }
    if (isAutoApprove({ approvalMode: this.approvals.effective })) {
      this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))
      return
    }
    const offered = this.agentTools?.tools.find((one) => one.name === call.tool)
    if (
      offered !== undefined &&
      beyondItsRailsOf(offered, call.arguments) === 'nothing-its-rails-do-not-cover'
    ) {
      this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))
      return
    }
    const reservation = this.permissions.reserve(requestKey(id))
    if (!reservation.accepted) {
      this.respondToProvider(id, safeRefusal({ kind: 'agentTool' }))
      return
    }
    const claimed = this.requestStates.get(requestKey(id))
    if (claimed?.phase === 'claimed')
      claimed.allowed = new Set<PermissionOutcome>(['allow', 'deny'])
    this.emit(agentToolCard(id, call, this.cwd))
    this.machine.beginWait()
    const decision = await reservation.response
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      this.respondToProvider(id, safeRefusal({ kind: 'agentTool' }))
      return
    }
    this.machine.endWait()
    if (decision.outcome !== 'allow') {
      this.respondToProvider(id, declinedToolCall(call.tool))
      if (decision.outcome === 'cancel') await this.askTheTurnToStop(readString(params, 'turnId'))
      return
    }
    this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))
  }

  // Spend first, settle the broker next, then dismiss a card only if it was still pending locally.
  private onServerRequestResolved(params: unknown): void {
    const p = isRecord(params) ? params : {}
    const rawId = p['requestId']
    if (typeof rawId !== 'string' && typeof rawId !== 'number') return
    const key = requestKey(rawId)
    if (this.phaseOf(rawId) === 'unseen') return
    const alreadyResponded = this.phaseOf(rawId) === 'spent'
    const state = this.requestStates.get(key)
    if (state?.phase === 'claimed' && state.messageCallId !== undefined) {
      this.messageCalls.consume(
        state.messageCallId,
        this.currentTurn?.providerTurnId ?? '',
        () => undefined,
      )
    }

    this.spendRequest(rawId)
    const wasPending =
      this.permissions.respond(key, { outcome: 'deny', message: 'resolved by the provider' }) ||
      this.userInputs.respond(key, { kind: 'reject' })
    if (wasPending && !alreadyResponded) this.emit({ type: 'request_resolved', id: key })
  }

  private respondToProvider(id: string | number, result: unknown): void {
    this.spendRequest(id, () => this.transport.respond(id, result))
  }

  private respondErrorToProvider(id: string | number, code: number, message: string): void {
    this.spendRequest(id, () => this.transport.respondError(id, code, message))
  }

  // Prepare disclosure before reservation; install metadata before publishing the actionable card.
  private async handleApproval(
    id: string | number,
    kind: 'command' | 'file',
    params: unknown,
  ): Promise<void> {
    if (this.isShuttingDown) {
      this.respondToProvider(id, { decision: 'decline' })
      return
    }
    const reservation = prepareApprovalRequest(
      id,
      kind,
      params,
      this.patches,
      this.providerHome,
      this.permissions,
      this.requestStates,
      this.approvals,
      (event) => this.emit(event),
    )
    if (reservation === null) {
      this.respondToProvider(id, { decision: 'decline' })
      return
    }
    this.machine.beginWait()

    const decision = await reservation.response
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      this.respondToProvider(id, { decision: 'decline' })
      return
    }
    if (decision.outcome === 'cancel') this.machine.requestInterrupt()
    this.machine.endWait()
    this.respondToProvider(id, { decision: codexDecision(decision) })
  }

  // Reject empty, duplicate, undeliverable and unanswerable questions before reserving or publishing.
  private async handleUserInputRequest(
    id: string | number,
    method: string,
    params: unknown,
  ): Promise<void> {
    const isPermission = method === 'item/permissions/requestApproval'
    if (this.isShuttingDown) {
      this.respondToProvider(id, userInputDecline(isPermission))
      return
    }
    const reservation = prepareUserInputRequest(
      id,
      method,
      params,
      this.userInputs,
      this.requestStates,
      (event) => this.emit(event),
    )
    if (reservation === null) {
      this.respondToProvider(id, userInputDecline(isPermission))
      return
    }
    this.machine.beginWait()

    const response = await reservation.response
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      this.respondToProvider(id, userInputDecline(isPermission))
      return
    }
    this.machine.endWait()
    const forwarded = userInputPayloadFor(isPermission, params, response)
    this.respondToProvider(
      id,
      'payload' in forwarded ? forwarded.payload : userInputDecline(isPermission),
    )
  }

  // Correlate Codex tool approvals with a pending call. A server form or link is its own request.
  private async handleExternalMcpElicitation(id: string | number, params: unknown): Promise<void> {
    const elicitation = codexElicitation(params)
    if (this.isShuttingDown || elicitation === null) {
      this.respondToProvider(id, safeRefusal({ kind: 'elicitation' }))
      return
    }
    const theFramesTurn =
      isRecord(params) && typeof params['turnId'] === 'string' ? params['turnId'] : ''
    const read = theFramesTurn === '' ? null : codexToolApproval(params)
    const claimedTool = read === null ? null : this.mcpCalls.claim(read.serverName, read.tool)
    const toolApproval: ClaimedToolApproval | null =
      read === null || claimedTool === null ? null : { ...read, tool: claimedTool }
    const confirmsAServersForm =
      toolApproval === null && elicitation.mode === 'form' && elicitation.fields.length === 0
    const askable = elicitation.mode === 'form' && toolApproval === null && !confirmsAServersForm
    // No answer cancels a server request; Codex's own approval safely declines it.
    const nobodysAnswer =
      toolApproval === null
        ? { action: 'cancel', content: null, _meta: null }
        : safeRefusal({ kind: 'elicitation' })
    const reservation = askable
      ? this.userInputs.reserve(requestKey(id))
      : this.permissions.reserve(requestKey(id))
    if (!reservation.accepted) {
      this.respondToProvider(id, nobodysAnswer)
      return
    }
    const claimed = this.requestStates.get(requestKey(id))
    const showsALink = toolApproval === null && opensALink(elicitation)
    const offer = publishedOffer(
      toolApproval !== null
        ? aToolApprovalsPositives(toolApproval)
        : confirmsAServersForm || showsALink
          ? ['allow']
          : [],
    )
    if (!askable && claimed?.phase === 'claimed') {
      claimed.allowed = new Set<PermissionOutcome>(offer)
      if (toolApproval !== null) claimed.approvesATool = toolApproval
      if (confirmsAServersForm) claimed.confirmsAServersForm = true
      if (showsALink) claimed.showsALink = true
    }
    // MCP cancellation answers the request only; it does not interrupt the turn.
    const cancelStopsNothing = { cancelStopsNothing: true as const }
    if (askable && claimed?.phase === 'claimed') {
      claimed.userInputPayload = (response): ForwardedUserInput =>
        elicitationPayloadFor(elicitation, response)
    }
    const approvalMode = isAutoApprove({ approvalMode: this.approvals.effective }) ? 'auto' : 'ask'
    this.emit(
      elicitationCard(
        id,
        elicitation,
        askable,
        toolApproval,
        approvalMode,
        this.providerHome,
        offer,
        confirmsAServersForm,
        showsALink,
        cancelStopsNothing,
      ),
    )
    this.machine.beginWait()
    await reservation.response
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      this.respondToProvider(id, nobodysAnswer)
      return
    }
    this.machine.endWait()
    this.respondToProvider(id, nobodysAnswer)
  }

  private finishUnexpected(reason: string, endedByThisAdapter = false): void {
    this.settleRequests()
    this.currentTurn = null
    this.machine.fatalError(reason, endedByThisAdapter)
    this.terminated = true
    this.eventQueue.close()
    void Promise.resolve(this.transport.close()).catch(() => {})
  }

  private settleRequests(): void {
    this.messageCalls.close()
    this.permissions.settleAll()
    this.userInputs.settleAll()
  }

  events(): AsyncIterable<RuntimeEvent> {
    return this.eventQueue
  }

  status(): SessionStatus {
    return this.currentStatus
  }

  // Share the brokers' counted wait lease so one answered card cannot resume a still-waiting session.
  waitForAPerson(): () => void {
    this.machine.beginWait()
    let held = true
    return (): void => {
      if (!held) return
      held = false
      this.machine.endWait()
    }
  }

  send(text: string): Promise<void> {
    return this.startATurn(text)
  }

  // Send no new input: the provider can answer the message already retained after a refused turn.
  carryOn(): Promise<void> {
    return this.startATurn(null)
  }

  // Adopt settings together, roll back only this attempt on rejection, and bind only its response.
  private async startATurn(text: string | null): Promise<void> {
    const plannedPhase = this.plan.requested
    if (
      plannedPhase !== 'never' &&
      !this._agentInfo?.model &&
      this.models.requested === undefined
    ) {
      throw new Error(
        `cannot start a ${plannedPhase === 'planning' ? 'plan-mode' : 'post-plan'} turn: ` +
          'the app-server has not reported a model, and a collaboration mode requires one',
      )
    }
    const localId = this.machine.beginTurn()
    if (localId === null) throw this.machine.refusedTurn()
    this.currentTurn = newCodexTurn(localId)
    const modeBefore = this.approvals.effective
    const approvalMode = this.approvals.adopt()
    const settingsBefore = {
      model: this.models.effective,
      effort: this.efforts.effective,
      phase: this.plan.effective,
      workFolders: this.folders.effective,
    }
    const askedModel = this.models.adopt()
    const askedEffort = this.efforts.adopt()
    const phase = this.plan.adopt()
    const workRoots = this.sendingWorkFolders(approvalMode, this.folders.adopt())
    const askBaseline = askBaselineOf(
      this.observedAskPolicy,
      this.workFoldersSent,
      this.theThreadsOwnRoots,
    )
    const intended = {
      ...((askedModel ?? this._agentInfo?.model)
        ? { model: askedModel ?? this._agentInfo?.model }
        : {}),
      ...((askedEffort ?? this._agentInfo?.reasoningEffort)
        ? { effort: askedEffort ?? this._agentInfo?.reasoningEffort }
        : {}),
    }
    if (this.rateLimits.awaitingTheProvidersWord()) this.readRateLimitBaseline()
    this.startAfterManagedPlugins(localId, () => {
      const send = () =>
        this.transport.request(
          'turn/start',
          turnStartParams(
            this._ref!.sessionId,
            text,
            askedEffort,
            approvalMode,
            askBaseline,
            workRoots,
            collaborationModeFor(phase, intended),
            askedModel,
          ),
        )
      const request = this.sharedSkillsRoot
        ? Promise.resolve()
            .then(() => this.beforeSkillDiscovery?.())
            .then(() =>
              withDeadline(
                this.transport.request('skills/list', { cwds: [this.cwd], forceReload: true }),
                COMMAND_LIST_TIMEOUT_MS,
                'skills/list',
              ),
            )
            .then(() => {
              if (this.currentTurn?.localId !== localId || this.currentTurn.interruptPending)
                throw new Error('turn interrupted')
              return send()
            })
        : send()
      void Promise.resolve(request).then(
        (result) => this.onTurnStartResult(localId, result),
        (error: unknown) => {
          if (this.currentTurn?.localId === localId) {
            this.currentTurn = null
            this.approvals.rollback(modeBefore)
            this.models.rollback(settingsBefore.model)
            this.efforts.rollback(settingsBefore.effort)
            this.plan.rollback(settingsBefore.phase)
            this.folders.rollback(settingsBefore.workFolders)
            this.machine.failTurn(`turn/start failed: ${errorMessage(error)}`)
          }
        },
      )
    })
  }

  async managedPluginHealth(
    servers: readonly ManagedPluginMcpServer[],
  ): Promise<readonly string[] | undefined> {
    if (!this._ref || this.status() !== 'idle') return undefined
    const scope = this.managedPluginObservationScope()
    const version = ++this.managedPluginObservationVersion
    const checked = this.managedPluginsChecked
    this.managedPluginsChecked = undefined
    const failed = await failedManagedPluginConnections(
      this.transport,
      this._ref.sessionId,
      servers.map((server) => server.name),
    )
    if (
      !this.isShuttingDown &&
      this.status() === 'idle' &&
      this.managedPluginObservationVersion === version &&
      this.managedPluginObservationScope() === scope
    )
      this.managedPluginsChecked = failed?.length === 0 ? checked : undefined
    return failed
  }

  private managedPluginsAwaited?: readonly string[]

  awaitManagedPlugins(names: readonly string[]): void {
    const configured = new Set(this.managedPluginMcp?.map((server) => server.name))
    this.managedPluginsAwaited = names.filter((name) => configured.has(name))
  }

  private awaitedManagedPlugins(): readonly string[] {
    return (
      this.managedPluginsAwaited ??
      this.managedPluginMcp?.filter((server) => !server.retained).map((server) => server.name) ??
      []
    )
  }

  private managedPluginObservationScope(): string {
    return JSON.stringify([this._ref?.sessionId, [...this.awaitedManagedPlugins()].sort()])
  }

  // A managed-plugin wait belongs to one local turn; cancellation must not dispatch it later.
  private startAfterManagedPlugins(localId: CodexTurn['localId'], dispatch: () => void): void {
    this.managedPluginObservationVersion++
    const scope = this.managedPluginObservationScope()
    const served = this.awaitedManagedPlugins()
    if (this.managedPluginsChecked === scope || !served.length) {
      dispatch()
      return
    }
    const waiting = { localId, controller: new AbortController() }
    this.managedPluginWait = waiting
    void waitForManagedPluginTools(
      this.transport,
      this._ref!.sessionId,
      served,
      waiting.controller.signal,
      this.managedPluginObserver,
    ).then((outcome) => {
      if (this.managedPluginWait !== waiting) return
      this.managedPluginWait = null
      if (
        this.isShuttingDown ||
        this.currentTurn?.localId !== localId ||
        this.managedPluginObservationScope() !== scope ||
        outcome === 'cancelled'
      )
        return
      if (outcome === 'ready') this.managedPluginsChecked = scope
      else if (!this.managedPluginFailureReported) {
        this.managedPluginFailureReported = true
        this.emit(
          wrapUnknown(
            'codex',
            {
              method: 'managed-plugin/discovery',
              outcome,
              withinMs: MANAGED_PLUGIN_READY_WITHIN_MS,
              message: 'Plugin unavailable. Try again.',
            },
            'lifecycle',
            'managed-plugin/discovery',
          ),
        )
      }
      dispatch()
    })
  }

  private cancelManagedPluginWait(): void {
    const waiting = this.managedPluginWait
    if (!waiting) return
    this.managedPluginWait = null
    this.managedPluginsChecked = undefined
    waiting.controller.abort()
  }

  // Compaction is a local turn. Its empty response starts a deadline; its notification binds the id.
  async compact(): Promise<void> {
    if (this.compactionOutstanding) throw new Error(A_COMPACTION_IS_STILL_OUTSTANDING)
    const turn = this.machine.beginTurn()
    if (turn === null) throw this.machine.refusedTurn()
    this.currentTurn = {
      localId: turn,
      providerTurnId: null,
      interruptPending: false,
      bindsAtItsStart: true,
      interruptAsked: false,
      commands: new Map(),
      endsAll: false,
      commandsEnding: Promise.resolve(),
    }
    const params: ThreadCompactStartParams = { threadId: this._ref!.sessionId }
    void Promise.resolve(this.transport.request('thread/compact/start', params)).then(
      () => this.onCompactStartAnswered(turn),
      (error: unknown) => {
        if (this.currentTurn?.localId !== turn) return
        this.currentTurn = null
        this.machine.failTurn(`thread/compact/start failed: ${errorMessage(error)}`)
      },
    )
  }

  private onCompactStartAnswered(localId: number): void {
    const turn = this.currentTurn
    if (this.terminated || turn?.localId !== localId || turn.providerTurnId !== null) return
    const giveUp = setTimeout(() => {
      if (this.terminated || this.currentTurn !== turn || turn.providerTurnId !== null) return
      this.currentTurn = null
      this.compactionOutstanding = true
      this.machine.failTurn(
        `Codex accepted the compaction and did not start it within ` +
          `${String(COMPACTION_START_TIMEOUT_MS / 1000)} seconds`,
      )
    }, COMPACTION_START_TIMEOUT_MS)
    giveUp.unref?.()
  }

  // Validate and spend synchronously before the handler resumes. Agent tools alone write their later result.
  async respondPermission(id: string, decision: PermissionDecision): Promise<void> {
    answerPermission(
      id,
      decision,
      this.requestStates,
      this.permissions,
      this.machine,
      this.providerHome,
      this.externalMcp,
      this.mcpCalls,
      (rawId, payload) => this.spendRequest(rawId, () => this.transport.respond(rawId, payload)),
    )
  }

  // An unusable answer stays pending; fallback decline belongs only to the handler with no caller left.
  async respondUserInput(id: string, response: UserInputResponse): Promise<void> {
    answerUserInput(id, response, this.requestStates, this.userInputs, (rawId, payload) =>
      this.spendRequest(rawId, () => this.transport.respond(rawId, payload)),
    )
  }

  // End this turn's awaited commands, latch early interruption, and preserve serialized completion.
  async interrupt(): Promise<void> {
    if (this.machine.isTerminal) return
    if (!this.machine.hasProviderWork && this.machine.waiting === 0) return
    if (!this.currentTurn && this.completing !== null) {
      await this.completing.done
      return
    }
    this.machine.requestInterrupt()
    this.settleRequests()
    if (this.managedPluginWait && this.managedPluginWait.localId === this.currentTurn?.localId) {
      this.cancelManagedPluginWait()
      this.currentTurn = null
      this.machine.forceEnd(false)
      return
    }
    if (!this.currentTurn) {
      this.machine.forceEnd(false)
      return
    }
    this.currentTurn.interruptAsked = true
    const turn = this.currentTurn
    if (turn.commands.size > 0) {
      await withTimeout(this.endWhatTheTurnStarted(turn), COMMANDS_END_WITHIN_MS)
    }
    const providerTurnId = turn.providerTurnId
    if (providerTurnId) {
      await this.sendInterruptRpc(providerTurnId)
    } else {
      turn.interruptPending = true
    }
  }

  private endWhatTheTurnStarted(turn: CodexTurn): Promise<void> {
    turn.commandsEnding = turn.commandsEnding.then(() => this.endTheCommandsOf(turn))
    return turn.commandsEnding
  }

  // Read movedOn and endsAll when the command list answers, so a stop can widen a pass already running.
  private async endTheCommandsOf(turn: CodexTurn): Promise<void> {
    if (turn.commands.size === 0 || this.isShuttingDown) return
    try {
      const ended = await this.backgroundTerminals.endTheseCommands((toolCallId) => {
        const command = turn.commands.get(toolCallId)
        return command !== undefined && (turn.endsAll || !command.movedOn)
      })
      this.machine.noteWhatTheStopEnded(
        turn.localId,
        ended.map((one) => one.toolCallId),
      )
    } catch {
      // The list Codex refused: the poll's own level still says what runs.
    }
  }

  endEverythingTheTurnStarted(): void {
    if (this.currentTurn !== null) {
      this.currentTurn.endsAll = true
      return
    }
    const ending = this.completing?.turn
    if (ending === undefined || ending.endsAll) return
    ending.endsAll = true
    void this.endWhatTheTurnStarted(ending)
  }

  // Only a later tool use marks prior commands detached; reasoning alone does not.
  private noteWhatTheTurnMovedOnTo(method: string, params: unknown): void {
    noteTurnMovedOn(method, params, this.currentTurn)
  }

  async stopBackgroundWork(id: string): Promise<boolean> {
    if (this.isShuttingDown) return false
    return await this.backgroundTerminals.terminate(id)
  }

  // Feed tails above the turn gate: detached commands print after completion and belong to this thread.
  private noteCommandOutput(params: unknown): void {
    this.commandTails.write(readString(params, 'itemId'), readString(params, 'delta'))
  }

  // A detached command may never emit item/completed; background-work endings also close its tail.
  private closeCommandOutput(params: unknown): void {
    const item = isRecord(params) ? params['item'] : undefined
    this.commandTails.close(readString(item, 'id'))
  }

  private closeEndedCommandOutput(event: RuntimeEvent): void {
    if (event.type !== 'background_work') return
    const toolCallId = event.ended?.toolCallId
    if (toolCallId !== undefined) this.commandTails.close(toolCallId)
  }

  commandOutput(toolCallId: string): CommandTail | null {
    return this.commandTails.read(toolCallId)
  }

  private noteToolAnswer(params: unknown): void {
    const item = isRecord(params) ? params['item'] : undefined
    const parts = codexToolAnswerParts(item)
    if (parts === null) return
    this.toolAnswers.write(readString(item, 'id'), parts)
  }

  toolAnswer(toolCallId: string): ToolAnswer | null {
    return this.toolAnswers.read(toolCallId)
  }

  // Read an already-held child without resuming a second thread; bound the request and preserve unknowns.
  async childState(childId: string): Promise<ChildThreadState> {
    if (this.terminated || this.machine.isTerminal || !this._ref) return CHILD_STATE_UNKNOWN
    const response = await readChildThread(this.transport, childId)
    return childStateFrom(response)
  }

  // Read status immediately before writing. Preserve the child's settings and the parent's local turn.
  async childInput(childId: string, text: string): Promise<ChildInputOutcome> {
    const state = await this.childState(childId)
    const refusal = childInputRefusal(state)
    if (refusal !== null) return { ok: false, reason: refusal, state }
    const result = await sendChildInput(this.transport, childId, text)
    return { ok: true, turnId: readOptionalString(readField(result, 'turn'), 'id') ?? null }
  }

  refreshBackgroundWork(): void {
    this.backgroundTerminals.refresh()
  }

  close(): Promise<void> {
    return (this.closing ??= this.doClose())
  }

  // Reject new work, settle prompts, drain response writers, flush, interrupt, then close the transport.
  private async doClose(): Promise<void> {
    this.cancelManagedPluginWait()
    this.commandTails.clear()
    this.backgroundTerminals.close()
    if (!this.machine.beginClose()) {
      this.settleRequests()
      await withTimeout(this.drainInFlight(), CLOSE_FLUSH_TIMEOUT_MS)
      this.terminated = true
      this.eventQueue.close()
      await this.transport.close()
      return
    }
    this.settleRequests()
    await withTimeout(this.drainInFlight(), CLOSE_FLUSH_TIMEOUT_MS)
    if (this.machine.hasProviderWork) {
      this.machine.requestInterrupt()
      const providerTurnId = this.currentTurn?.providerTurnId
      if (providerTurnId) {
        await withTimeout(this.sendInterruptRpc(providerTurnId), CLOSE_INTERRUPT_TIMEOUT_MS)
      }
      this.currentTurn = null
      this.machine.forceEnd()
    }
    this.machine.closeSession(this._ref)
    this.terminated = true
    this.eventQueue.close()
    await this.transport.close()
  }

  private drainInFlight(): Promise<void> {
    return Promise.allSettled([...this.inFlight]).then(() => undefined)
  }
}

export class CodexRuntime implements AgentRuntime {
  readonly provider = 'codex' as const
  readonly canRecreateMissingUnusedSession = true
  private readonly transportFactory: TransportFactory
  private readonly authHealth: ((providerHome: string) => AuthHealth) | undefined

  constructor(
    transportFactory: TransportFactory = defaultTransport,
    authHealth?: (providerHome: string) => AuthHealth,
    private readonly apiKey?: string,
  ) {
    this.transportFactory = transportFactory
    this.authHealth = authHealth
  }

  private assertAuthHealthy(providerHome: string): void {
    if (this.apiKey !== undefined) return
    assertAuthHealthy(providerHome, this.authHealth)
  }

  // Acquire the home boot lease before spawning; cancellation owns the transport until begin settles.
  async start(opts: StartOptions): Promise<SessionHandle> {
    assertNotCancelled(opts.signal, 'codex start')
    removeStaleCodexPermissionConfig(opts.providerHome)
    const memoryConfig = ensureCodexMemoryConfig(opts.providerHome)
    this.assertAuthHealthy(opts.providerHome)
    const phase = phasesOf(opts.startPhases)
    phase('boot-gate-entered')
    const bootSettled = sayingTheRelease(
      await beginCodexHomeBoot(opts.providerHome, { signal: opts.signal }),
      phase,
    )
    phase('boot-gate-passed')
    const launchAccount = this.apiKey === undefined ? codexAccountInNow(opts.providerHome) : null
    const launchCopy = this.apiKey === undefined ? codexCopyIdentityIn(opts.providerHome) : null
    let transport: CodexTransport
    try {
      transport = this.transportFactory({
        cwd: opts.cwd,
        providerHome: opts.providerHome,
        ...(this.apiKey === undefined ? {} : { apiKeyBound: true }),
      })
    } catch (error) {
      bootSettled()
      throw error
    }
    phase('spawned')
    const cancel = cancelWith(opts.signal, () => transport.close())
    const handle = new CodexSessionHandle(
      transport,
      opts.cwd,
      0,
      opts.providerHome,
      undefined,
      opts.approvalMode,
      resolveReasoningEffort(opts),
      planPhaseOf(opts),
      opts.model,
      opts.agentTools,
      opts.externalMcp,
      opts.workFolders,
      memoryConfig,
      opts.builtInSkills,
      opts.sharedSkillsRoot,
      opts.beforeSkillDiscovery,
      opts.managedPluginMcp,
      opts.observeManagedPlugins,
      this.apiKey,
    )
    handle.noteLaunchAccount(launchAccount, launchCopy)
    handle.noteStartPhases(phase)
    try {
      opts.onSessionCreated?.(handle)
      await handle.begin('started', opts.model, opts.systemHint, bootSettled)
      if (cancel.cancelled) throw new Error('codex start was cancelled')
    } catch (error) {
      await transport.close() // bounded process teardown, no leak, before rejecting
      throw aFailedStart(error)
    } finally {
      bootSettled()
      cancel.release()
    }
    return handle
  }

  // One deadline covers all pages; finally closes the probe even when initialize never answers.
  async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    assertNotCancelled(context.signal, 'codex model list')
    this.assertAuthHealthy(context.providerHome)
    const bootSettled = await beginCodexHomeBoot(context.providerHome, { signal: context.signal })
    let transport: CodexTransport
    try {
      transport = this.transportFactory({
        cwd: context.providerHome,
        providerHome: context.providerHome,
        ...(this.apiKey === undefined ? {} : { apiKeyBound: true }),
      })
    } catch (error) {
      bootSettled()
      throw error
    }
    const cancel = cancelWith(context.signal, () => transport.close())
    try {
      const deadline = Date.now() + MODEL_PROBE_TIMEOUT_MS
      const bounded = <T>(p: Promise<T>, what: string): Promise<T> =>
        withDeadline(p, Math.max(1, deadline - Date.now()), `codex ${what}`)

      await bounded(transport.request('initialize', initializeParams()), 'initialize')
      bootSettled() // the state runtime exists; `model/list` below is a network wait (180)
      transport.notify('initialized', {})
      if (this.apiKey !== undefined)
        await bounded(logInWithCodexKey(transport, this.apiKey), 'key login')
      const choices: ModelChoice[] = []
      let cursor: string | undefined
      for (let page = 0; page < MODEL_LIST_PAGE_LIMIT; page++) {
        const response = await bounded(
          transport.request('model/list', {
            ...(cursor === undefined ? {} : { cursor }),
          }),
          'model/list',
        )
        const record = isRecord(response) ? response : {}
        const data = Array.isArray(record['data']) ? record['data'] : []
        for (const row of data) {
          const choice = modelChoiceOf(row)
          if (choice) choices.push(choice)
        }
        const next = readOptionalString(record, 'nextCursor')
        if (!next) break
        cursor = next
      }
      if (cancel.cancelled) throw new Error('codex model list was cancelled')
      return choices
    } finally {
      bootSettled() // the backstop for a probe whose `initialize` never answered (180)
      cancel.release()
      await transport.close()
    }
  }

  // Setup and handshake failures keep native auth identity; only a lost thread sets noSuchSession.
  async resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle> {
    if (ref.provider !== 'codex') {
      throw new ResumeError(ref, `wrong provider: expected codex, got ${ref.provider}`)
    }
    let bootSettled: () => void
    let transport: CodexTransport
    let launchAccount: string | null
    let launchCopy: CodexCopyIdentity | null
    let memoryConfig: CodexMemoryConfigResult
    const phase = phasesOf(options.startPhases)
    try {
      assertNotCancelled(options.signal, 'codex resume') // nothing spawned, nothing to unwind (070)
      removeStaleCodexPermissionConfig(options.providerHome)
      memoryConfig = ensureCodexMemoryConfig(options.providerHome)
      this.assertAuthHealthy(options.providerHome)
      phase('boot-gate-entered')
      const settled = sayingTheRelease(
        await beginCodexHomeBoot(options.providerHome, { signal: options.signal }),
        phase,
      )
      phase('boot-gate-passed')
      bootSettled = settled
      launchAccount = this.apiKey === undefined ? codexAccountInNow(options.providerHome) : null
      launchCopy = this.apiKey === undefined ? codexCopyIdentityIn(options.providerHome) : null
      try {
        transport = this.transportFactory({
          cwd: ref.cwd,
          providerHome: options.providerHome,
          ...(this.apiKey === undefined ? {} : { apiKeyBound: true }),
        })
      } catch (error) {
        settled()
        throw error
      }
      phase('spawned')
    } catch (error) {
      if (error instanceof ResumeError || error instanceof AuthUnavailableError) throw error
      throw new ResumeError(ref, `resume setup failed: ${errorMessage(error)}`, { cause: error })
    }
    const cancel = cancelWith(options.signal, () => transport.close()) // as in `start` above (070)
    const handle = new CodexSessionHandle(
      transport,
      ref.cwd,
      ref.rotation,
      options.providerHome,
      ref,
      options.approvalMode, // a resumed yolo session keeps its mode (078)
      resolveReasoningEffort(options), // …and the effort it was created with (024)
      planPhaseOf(options),
      options.model,
      options.agentTools,
      options.externalMcp,
      options.workFolders,
      memoryConfig,
      options.builtInSkills,
      options.sharedSkillsRoot,
      options.beforeSkillDiscovery,
      options.managedPluginMcp,
      options.observeManagedPlugins,
      this.apiKey,
    )
    handle.noteLaunchAccount(launchAccount, launchCopy)
    handle.noteStartPhases(phase)
    try {
      options.onSessionCreated?.(handle)
      await handle.begin('resumed', options.model, options.systemHint, bootSettled)
      if (cancel.cancelled) throw new Error('codex resume was cancelled')
      // Only resume replays a ledger containing background processes from the previous app-server.
      handle.refreshBackgroundWork()
    } catch (error) {
      await transport.close() // bounded process teardown, no leak, before rejecting
      if (error instanceof AuthUnavailableError) throw error
      const noSuchSession = codexNoLongerHasTheThread(error, ref.sessionId, options.providerHome)
      throw new ResumeError(ref, `resume failed: ${errorMessage(error)}`, {
        cause: noSuchSession ? error : aFailedStart(error),
        noSuchSession,
      })
    } finally {
      bootSettled() // the backstop, as in `start` (180)
      cancel.release()
    }
    return handle
  }
}

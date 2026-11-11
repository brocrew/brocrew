import type { ManagedPluginMcpServer } from '../managed-plugin-mcp'
import { observeManagedPlugins, type ManagedPluginObserver } from '../managed-plugin-observation'
import { managedTranscriptSettings } from './app-transcript-retention'
import { randomUUID } from 'node:crypto'
import { BUILT_IN_SKILLS_FAILURE } from '../built-in-skills'
import { claudeBuiltInSkillOptions, verifyClaudeBuiltInSkills } from './built-in-skills'
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeMcpServersFor, forbiddenExternalSpellings } from './agent-tools'
import type { ExternalMcpReach } from '../external-mcp'
import { boundInventory, parametersOf, qualifyWith, type DeclaredToolset } from '../tool-inventory'
import { CLAUDE_TOOL_NAMING } from './tool-naming'
import { publishedServerForDisplay } from './inventory-display'
import { beyondItsRailsOf, type AgentToolset } from '../agent-tools'
import type {
  AccountInfo,
  EffortLevel,
  ElicitationRequest,
  ElicitationResult,
  ModelInfo,
  Options,
  Query,
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

import {
  mcpElicitation,
  elicitationContent,
  elicitationQuestions,
  elicitationWords,
  opensALink,
  serverAsks,
  type McpElicitation,
} from '../mcp-elicitation'
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
import { AuthUnavailableError } from '../internal/auth'
import {
  whyNoClaudeLogin,
  type ClaudeApiKeyProviderAsync,
  type ClaudeAuthTokenProvider,
  type ClaudeAuthTokenProviderAsync,
} from './auth'
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
import { StallWatchdog, stallNotice } from '../internal/stall-watchdog'
import { claudeAutoMemoryDir } from './auto-memory'
import { localSettingsFilesOf } from './local-settings-location'
import { keptRulesForALaunch } from './persisted-rules'
import { FileEdits } from './file-edits'
import { ClaudeMemoryStore } from './memory-store'
import { AnnouncedCli } from './provider-refusal'
import { ClaudeFinalAnswers } from './final-answers'
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
import { boundCommands, type ProviderCommandAnswer } from '../provider-commands'
import { CLAUDE_COMMAND_PREFIX } from './command-prefix'
import { wordsForACard } from '../words-on-a-card'
import { BackgroundTasks } from './background-tasks'
import { SessionCrons } from './session-crons'
import { SchedulingCalls } from './scheduling-calls'
import { SCHEDULING_TOOLS } from '../scheduled-work'
import { SubAgentTasks } from './sub-agent-tasks'
import { WorkflowTasks } from './workflow-tasks'
import { TodoPlan } from './todo-plan'
import { CLAUDE_DEFAULT_BY_NAME } from './default-by-name'

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const PATH_COMPLETE_TOOLS = new Set([...FILE_TOOLS, 'Read', 'NotebookRead'])

const USER_INPUT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])

const PLAN_GESTURES = new Map<string, boolean>([
  ['ExitPlanMode', false],
  ['EnterPlanMode', true],
])

function planConsentOf(gesture: boolean | undefined): { consent?: PlanConsent } {
  if (gesture === undefined) return {}
  return { consent: gesture ? 'start-planning' : 'stop-planning' }
}

const CONSENT_ONLY_USER_INPUT = new Set(['EnterPlanMode'])

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

const SEARCH_TOOLS_VOCABULARY: readonly string[] = ['preset:default', 'Grep', 'Glob']

export const CLAUDE_TOOLS_TURNED_OFF: readonly string[] = ['AskUserQuestion']

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

class SessionGrants {
  private readonly blanketGranted = new Set<string>()

  grantAll(toolName: string): void {
    this.blanketGranted.add(toolName)
  }

  get blanket(): readonly string[] {
    return [...this.blanketGranted]
  }
}

function disclosedPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = input[key]
    if (typeof value === 'string' && value) paths.push(value)
  }
  return [...new Set(paths)].sort()
}

const WHY_THIS_GUARD_ASKS = {
  questions: 'BroCrew routes questions and plans to the user, in every mode',
} as const

const OUR_OWN_ASK_REASONS: readonly string[] = Object.values(WHY_THIS_GUARD_ASKS)

function askFor(why: keyof typeof WHY_THIS_GUARD_ASKS) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: WHY_THIS_GUARD_ASKS[why],
    },
  } as const
}

function allowFor(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  } as const
}

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

type KeptRuleLists = Awaited<ReturnType<typeof keptRulesForALaunch>>

function flagPermissionsOf(
  kept: KeptRuleLists,
  workFolders: readonly string[],
): NonNullable<Settings['permissions']> | null {
  if (workFolders.length > 0) return { ...kept, additionalDirectories: [...workFolders] }
  return Object.keys(kept).length === 0 ? null : { ...kept }
}

function sameFolders(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((folder, at) => folder === b[at])
}

const RESET_SOURCE = 'conversation_reset + system/init'

function confinementFor(cwd: string, context: ProviderRuntimeContext): SessionConfinement {
  return { cwd, providerHome: context.providerHome }
}

function scheduleReaderHooks(
  note: (crons: unknown) => void,
  noteEffort: (level: string) => void,
): NonNullable<NonNullable<Options['hooks']>['Stop']> {
  return [
    {
      hooks: [
        async (input) => {
          if (input.hook_event_name === 'Stop') {
            try {
              const level = input.effort?.level
              if (typeof level === 'string' && level !== '') noteEffort(level)
            } catch {
              // An unreadable effort must not fail the turn.
            }
            try {
              note(input.session_crons)
            } catch {
              // Unreadable scheduling data must not fail the turn.
            }
          }
          return { continue: true }
        },
      ],
    },
  ]
}

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

function promptGuardHooks(
  effectiveMode: () => ApprovalMode,

  railsGateThis: (toolName: string, toolInput: unknown) => boolean,
): { PreToolUse: NonNullable<NonNullable<Options['hooks']>['PreToolUse']> } {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== 'PreToolUse') return { continue: true }

            if (USER_INPUT_TOOLS.has(input.tool_name)) {
              return askFor('questions')
            }

            if (railsGateThis(input.tool_name, input.tool_input)) {
              return allowFor('BroCrew gates its own tools with rails, not with a card')
            }

            if (isAutoApprove({ approvalMode: effectiveMode() })) return { continue: true }

            return { continue: true }
          },
        ],
      },
    ],
  }
}

export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  mcpServerStatus?: Query['mcpServerStatus']
  reconnectMcpServer?: Query['reconnectMcpServer']
  setMcpServers?(servers: NonNullable<Options['mcpServers']>): Promise<unknown>
  reloadPlugins?(): Promise<unknown>
  interrupt(): Promise<unknown>

  close(): void

  return?(value?: unknown): Promise<unknown>

  supportedModels?(): Promise<ModelInfo[]>

  accountInfo?(): Promise<AccountInfo>

  initializationResult?(): Promise<{ commands: readonly unknown[] }>

  supportedCommands?(): Promise<readonly unknown[]>

  setModel?(model?: string): Promise<void>

  setPermissionMode?(mode: PermissionMode): Promise<void>

  applyFlagSettings?(settings: {
    effortLevel?: EffortLevel | null
    permissions?: Settings['permissions'] | null
  }): Promise<void>

  backgroundTasks?(toolUseId?: string): Promise<boolean>

  stopTask?(taskId: string): Promise<void>
}

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies EffortLevel[]

type _ClaudeEffortsAreExhaustive =
  Exclude<EffortLevel, (typeof CLAUDE_EFFORTS)[number]> extends never
    ? true
    : ['missing effort levels', Exclude<EffortLevel, (typeof CLAUDE_EFFORTS)[number]>]
const claudeEffortsAreExhaustive: _ClaudeEffortsAreExhaustive = true
void claudeEffortsAreExhaustive

function claudeEffort(value: string): EffortLevel | null {
  return (CLAUDE_EFFORTS as readonly string[]).includes(value) ? (value as EffortLevel) : null
}

function permissionModeFor(planMode: boolean): PermissionMode {
  return planMode ? 'plan' : 'default'
}

const CLOSE_INTERRUPT_TIMEOUT_MS = 2000

const MODEL_PROBE_TIMEOUT_MS = 15_000

const COMMAND_READ_TIMEOUT_MS = 15_000

const INTERRUPT_ACK_TIMEOUT_MS = 2000

const SETTINGS_ACK_TIMEOUT_MS = 10_000

const CLOSE_EXIT_RECEIPT_TIMEOUT_MS = 5_000

const STDERR_CLAUSE_BYTES = 500

export type QueryFactory = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => ClaudeQuery

async function* neverSends(): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(() => {})
  yield undefined as unknown as SDKUserMessage
}

export type SessionExists = (
  sessionId: string,
  cwd: string,
  providerHome: string,
) => Promise<boolean>

interface ToolPermissionOptions {
  toolUseID: string
  title?: string
  signal?: AbortSignal

  suggestions?: PermissionUpdate[]

  decisionReason?: string

  blockedPath?: string

  suppressAlwaysAllowRule?: boolean

  defaultToNo?: boolean
}

const STOPPED_INSTEAD_OF_ANSWERING: PermissionDecision = {
  outcome: 'deny',
  message: 'The person pressed Stop instead of answering this request.',
}

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

function providerReasonOf(
  options: ToolPermissionOptions,
  marks: ReturnType<typeof askMarks>,
): { providerReason?: string } {
  const said = options.decisionReason
  if (marks.suppressAlwaysAllowRule !== true && marks.defaultToNo !== true) return {}

  const cleaned = wordsForACard(said)
  if (cleaned === null) return {}
  if (OUR_OWN_ASK_REASONS.some((ours) => cleaned.includes(ours))) return {}
  return { providerReason: cleaned }
}

export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

async function defaultSessionExists(
  sessionId: string,
  cwd: string,
  providerHome: string,
): Promise<boolean> {
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

function isAnAbsence(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'
}

function stillThere(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch (error) {
    if (isAnAbsence(error)) return false
    throw error
  }
}

const A_CONVERSATION_BUDGET_BYTES = 1024 * 1024

const A_CONVERSATION_CHUNK_BYTES = 64 * 1024

function holdsAConversation(path: string): boolean {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return true
  }
  try {
    const chunk = Buffer.alloc(A_CONVERSATION_CHUNK_BYTES)

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

const RECORDED_CWD_BUDGET_BYTES = 1024 * 1024

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

export class ClaudeSessionHandle implements SessionHandle {
  private readonly provider = 'claude' as const
  private readonly eventQueue = new AsyncQueue<RuntimeEvent>()

  private readonly coalescer = new DeltaCoalescer((event) => this.deliver(event))
  private readonly machine = new SessionMachine((event) => this.emit(event))

  private readonly commandsWaitedOn = new Set<string>()

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
  private managedPluginGeneration = 0
  private attemptedManagedPluginNames: readonly string[] = []
  configurePluginRefresh(build: NonNullable<ClaudeSessionHandle['pluginRefresh']>): void {
    this.pluginRefresh = build
  }
  async managedPluginHealth(
    servers: readonly ManagedPluginMcpServer[],
  ): Promise<readonly string[] | undefined> {
    if (!this.query?.mcpServerStatus || this.status() !== 'idle') return undefined
    try {
      const rows = await this.query.mcpServerStatus()
      if (!Array.isArray(rows)) return undefined
      const failed: string[] = []
      let unknown = false
      for (const { name } of servers) {
        const row = rows.find((one) => one?.name === name)
        if (row?.status === 'failed') failed.push(name)
        else if (row?.status !== 'connected') unknown = true
      }
      return failed.length || !unknown ? failed : undefined
    } catch {
      return undefined
    }
  }
  async refreshManagedPlugins(
    servers: readonly ManagedPluginMcpServer[],
    reconnect: readonly string[] = [],
  ): Promise<void> {
    const generation = ++this.managedPluginGeneration
    const query = this.query
    const next = servers.map((server) => ({ ...server }))
    this.attemptedManagedPluginNames = next.map(({ name }) => name)
    try {
      if (!query?.setMcpServers || !this.pluginRefresh)
        throw new Error('Plugin unavailable. Try again.')
      const result = await query.setMcpServers(this.pluginRefresh(next))
      if (
        result &&
        typeof result === 'object' &&
        'errors' in result &&
        result.errors &&
        Object.keys(result.errors).length
      )
        throw new Error('Plugin unavailable. Try again.')

      for (const name of new Set(reconnect)) {
        if (
          this.query !== query ||
          this.managedPluginGeneration !== generation ||
          this.isShuttingDown
        )
          throw new Error('Plugin unavailable. Try again.')
        if (!next.some((one) => one.name === name)) continue
        if (!query.reconnectMcpServer) throw new Error('Plugin unavailable. Try again.')
        await query.reconnectMcpServer(name)
      }
      if (
        this.query !== query ||
        this.managedPluginGeneration !== generation ||
        this.isShuttingDown
      )
        throw new Error('Plugin unavailable. Try again.')
      this.managedPluginMcp = next
      this.observeRefreshedPlugins(query, generation, next)
    } catch {
      throw new Error('Plugin unavailable. Try again.')
    }
  }
  private observeRefreshedPlugins(
    query: ClaudeQuery,
    generation: number,
    servers: readonly ManagedPluginMcpServer[],
  ): void {
    const offered = servers.map(({ name, url, pluginId }) => ({
      name,
      url,
      ...(pluginId === undefined ? {} : { pluginId }),
    }))
    // This inventory read never joins refresh, Send or close.
    void (async () => {
      try {
        if (!query.mcpServerStatus) return
        const rows = await query.mcpServerStatus()
        if (!Array.isArray(rows)) return
        for (const route of offered) {
          if (
            this.query !== query ||
            this.managedPluginGeneration !== generation ||
            this.isShuttingDown
          )
            return
          const matches = rows.filter(
            (row) =>
              row.name === route.name &&
              row.config?.type === 'http' &&
              row.config.url === route.url,
          )
          const row = matches.length === 1 ? matches[0] : undefined
          const tools =
            row?.status === 'connected' && Array.isArray(row.tools)
              ? row.tools.map(({ name }) => name)
              : undefined
          observeManagedPlugins(this.managedPluginObserver, {
            server: route.name,
            route: row ? route : null,
            ...(tools === undefined ? {} : { tools }),
            outcome:
              tools !== undefined
                ? 'discovered'
                : row?.status === 'failed' || row?.status === 'disabled'
                  ? 'unavailable'
                  : 'unknown',
          })
        }
      } catch {
        /* Best-effort SDK inventory only. */
      }
    })()
  }
  private query: ClaudeQuery | null = null

  private accountSaid: SessionAccount | null | undefined = undefined

  private child!: ClaudeChildWitness
  private _ref: SessionRef | null
  private currentStatus: SessionStatus = 'idle'
  private opening: 'started' | 'resumed' = 'started'

  private terminated = false

  private closing: Promise<void> | null = null

  private readonly _targetRef: SessionRef | null

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

  private resetPending: { readonly from: string } | null = null

  private launch: {
    readonly sessionId: string
    readonly recorded: () => Promise<string | null>
  } | null = null

  private launchCredential: string | null = null

  private launchedOnAKey = false

  private _signInSuperseded = false

  constructor(
    private readonly input: AsyncQueue<SDKUserMessage>,
    private readonly cwd: string,
    private readonly rotation: number,
    targetRef?: SessionRef,

    approvalMode?: ApprovalMode,

    requestedEffort?: ReasoningEffort,

    seedModel?: string,

    seedPlanMode?: boolean,

    private readonly authTokenProviderAsync?: ClaudeAuthTokenProviderAsync,

    seedWorkFolders: readonly string[] = [],
    private managedPluginMcp: readonly ManagedPluginMcpServer[] = [],
    private readonly managedPluginObserver?: ManagedPluginObserver,
  ) {
    this._targetRef = targetRef ?? null
    this._ref = null
    this.approvals = new ApprovalModeSwitch(approvalMode)
    this.models = new NextTurnSetting<string | undefined>(seedModel)
    this.efforts = new NextTurnSetting<ReasoningEffort | undefined>(requestedEffort)
    this.plan = new NextTurnSetting<boolean>(seedPlanMode === true)
    this.folders = new NextTurnSetting<readonly string[]>([...seedWorkFolders])
  }

  private readonly models: NextTurnSetting<string | undefined>
  private readonly efforts: NextTurnSetting<ReasoningEffort | undefined>
  private readonly plan: NextTurnSetting<boolean>

  private readonly folders: NextTurnSetting<readonly string[]>

  private keptRules: KeptRuleLists = {}

  launchFlagSettings(providerHome: string, kept: KeptRuleLists): Settings {
    this.keptRules = kept
    return flagSettingsFor(providerHome, kept, this.withSharedSkills(this.folders.effective))
  }

  private alwaysRulesFile: string | null = null

  private localSettingsFiles: readonly string[] | null = null

  noteAlwaysRulesFile(): void {
    const { files } = localSettingsFilesOf(this.cwd)
    this.localSettingsFiles = files
    this.alwaysRulesFile = files[0] ?? null
  }

  launchLocalFiles(): readonly string[] {
    if (this.localSettingsFiles === null) this.noteAlwaysRulesFile()
    return this.localSettingsFiles ?? []
  }

  private declaredToolset: DeclaredToolset | null = null

  private lastInventory = ''

  private isThisAppsTool(toolName: string): boolean {
    const declared = this.declaredToolset
    return (
      declared !== null &&
      declared.tools.some(
        (one) => qualifyWith(CLAUDE_TOOL_NAMING, declared.server, one.name) === toolName,
      )
    )
  }

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

  private publishToolInventory(
    message: Extract<SDKMessage, { type: 'system'; subtype: 'init' }>,
  ): void {
    const { tools, mcp_servers: servers } = message as unknown as Record<string, unknown>
    const namedTools = Array.isArray(tools)
      ? tools.filter((one): one is string => typeof one === 'string')
      : []

    const rawServers = Array.isArray(servers) ? servers : []
    const namedServers = rawServers
      .filter((one): one is { name: string; status: string } => {
        if (typeof one !== 'object' || one === null) return false
        const row = one as Record<string, unknown>
        return typeof row['name'] === 'string' && typeof row['status'] === 'string'
      })
      .map((server) => publishedServerForDisplay({ name: server.name, status: server.status }))

    const managedNames = new Set([
      ...this.managedPluginMcp.map(({ name }) => name),
      ...this.attemptedManagedPluginNames,
    ])
    for (const name of managedNames) {
      const status = namedServers.find((server) => server.name === name)?.status
      const connected = status === 'connected' && Array.isArray(tools)
      const unavailable = status === 'failed' || status === 'disabled'
      const prefix = `mcp__${name}__`
      observeManagedPlugins(this.managedPluginObserver, {
        server: name,
        ...(Array.isArray(tools) && (connected || unavailable)
          ? {
              tools: connected
                ? namedTools
                    .filter((tool) => tool.startsWith(prefix))
                    .map((tool) => tool.slice(prefix.length))
                : [],
            }
          : {}),
        outcome: connected ? 'discovered' : unavailable ? 'unavailable' : 'unknown',
        ...(this.managedPluginGeneration === 0 ? {} : { route: null }),
      })
    }
    if (!Array.isArray(tools)) return

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

  private readonly approvals: ApprovalModeSwitch

  get approval(): ApprovalModeState {
    return { effective: this.approvals.effective, requested: this.approvals.requested }
  }

  get planning(): boolean {
    return this.plan.effective
  }

  get blanketGrants(): readonly string[] {
    return this.sessionGrants.blanket
  }

  setApprovalMode(mode: ApprovalMode): Promise<void> {
    this.approvals.request(mode)
    return Promise.resolve()
  }

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

  private worksIn(): readonly string[] {
    return [this.cwd, ...this.folders.effective]
  }

  setWorkFolders(folders: readonly string[]): void {
    this.folders.request([...folders])
  }

  private _agentInfo: AgentInfo | undefined

  private effortReported: { level: string; model: string; asked: string | undefined } | undefined

  get agentInfo(): AgentInfo | undefined {
    return this._agentInfo
  }

  launchSettings: readonly LaunchSetting[] | undefined

  get ref(): SessionRef | null {
    return this._ref
  }

  holdLaunchRef(sessionId: string, recorded: () => Promise<string | null>): void {
    this.launch = { sessionId, recorded }
  }

  private ultracodeAsked = false

  askedForUltracode(): void {
    this.ultracodeAsked = true
  }

  get launchedAs(): string | null {
    return this.launch?.sessionId ?? null
  }

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

  attachQuery(query: ClaudeQuery, child: ClaudeChildWitness): void {
    this.query = query
    this.child = child

    void this.publishCommands(query)
    void this.learnTheAccount(query)
  }

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
      // Do not expose an account-read failure that might identify the account.
    }
    if (this.query === query) this.accountSaid = said
  }

  account(): SessionAccount | null | undefined {
    return this.accountSaid
  }

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
      // An unavailable inventory remains unreported rather than inventing provider data.
    }
  }

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

  get providerPid(): number | undefined {
    return this.child.pid
  }

  awaitProcessExit(): Promise<void> {
    return this.child.exited
  }

  begin(opening: 'started' | 'resumed'): void {
    this.opening = opening
    this.machine.markStarting()
    void this.runLoop()
  }

  private leavePlanIfTheModeDoes(updates: readonly PermissionUpdate[]): void {
    const leaves = updates.some((update) => update.type === 'setMode' && update.mode !== 'plan')
    if (leaves && this.plan.effective) this.plan.settle(false)
  }

  private noteTheCommandsWaitedOn(event: RuntimeEvent): void {
    if (
      event.type === 'tool_call' &&
      event.name === 'Bash' &&
      event.parentToolCallId === undefined
    ) {
      this.commandsWaitedOn.add(event.id)
    }
    if (event.type === 'tool_result') this.commandsWaitedOn.delete(event.id)

    if (event.type === 'turn') this.commandsWaitedOn.clear()
  }

  private emit(event: RuntimeEvent): void {
    if (this.terminated) return
    this.noteTheCommandsWaitedOn(event)

    this.coalescer.feed(event)
  }

  noteSessionCrons(raw: unknown, source: string): void {
    const event = this.sessionCrons.observe(raw, source)
    if (event) this.emit(event)
  }

  noteSchedulingCall(input: unknown): void {
    try {
      this.schedulingCalls.called(input)
    } catch {
      // Scheduling observations must not break tool calls.
    }
  }

  noteSchedulingAnswer(input: unknown): void {
    try {
      const event = this.schedulingCalls.answered(input)
      if (event !== undefined) this.emit(event)
    } catch {
      // Unreadable scheduling receipts must not break tool calls.
    }
  }

  noteReportedEffort(level: string): void {
    const model = this._agentInfo?.model
    if (model === undefined) return
    this.effortReported = { level, model, asked: this.efforts.effective }
    this._agentInfo = { model, reasoningEffort: level, reasoningEffortReported: true }
  }

  private readonly stallWatchdog = new StallWatchdog((idleMs, afterReasoning) =>
    this.reportStall(idleMs, afterReasoning),
  )

  private readonly todoPlan = new TodoPlan()

  private sentForTheTurn: { readonly turnId: number; readonly uuid: string } | null = null
  private readonly limits = new ClaudeLimitWatch()

  private readonly billing = new ClaudeBillingWatch()

  private readonly subAgentTasks = new SubAgentTasks()

  private readonly fileEdits = new FileEdits()

  private readonly workflowTasks = new WorkflowTasks()

  private readonly backgroundTasks = new BackgroundTasks()

  private readonly memoryStore = new ClaudeMemoryStore()

  private readonly toolAnswers = new ToolAnswers()
  private messageReceipts: ClaudeMessageReceipts | undefined

  private readonly announced = new AnnouncedCli()
  private readonly finalAnswers = new ClaudeFinalAnswers()

  private readonly sessionCrons = new SessionCrons()

  private readonly schedulingCalls = new SchedulingCalls()

  private readonly openSubAgents = new OpenSubAgents()
  readonly sessionGrants = new SessionGrants()

  private readonly offeredDecisions = new Map<string, ReadonlySet<PermissionOutcome>>()

  private readonly askedQuestions = new Map<string, readonly UserInputQuestion[]>()

  private readonly elicitationForms = new Map<string, McpElicitation>()

  private readonly answeredByAPerson = new Set<string>()

  private readonly planGestures = new Map<string, boolean>()

  private reportStall(idleMs: number, afterReasoning = false): void {
    if (this.terminated || this.machine.isTerminal || !this.machine.hasProviderWork) return

    if (this.currentStatus === 'waiting_permission') return
    this.emit({
      type: 'error',
      fatal: false,
      message: stallNotice(idleMs, afterReasoning),
      stall: true,
      ...(afterReasoning ? { thinking: true as const } : {}),
    })
  }

  private deliver(event: RuntimeEvent): void {
    this.stallWatchdog.progress(event, this.machine.hasProviderWork)

    if (isProviderWork(event)) this.machine.noteProviderWork(event.type)
    if (event.type === 'status') this.currentStatus = event.state
    if (event.type === 'session' && event.state !== 'ended') this._ref = event.ref

    if (event.type === 'conversation_reset') this._ref = event.ref

    if (endsOpenSubAgents(event)) {
      for (const closing of this.openSubAgents.closeAll(event)) this.eventQueue.push(closing)
    }
    this.openSubAgents.note(event)

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
          this.finalAnswers,
        )) {
          const classified =
            said.type === 'error' && said.cause === 'auth_stale'
              ? { ...said, cause: await this.rejectedCredentialCause() }
              : said
          if (this.terminated) return
          const event =
            classified.type === 'error' &&
            (classified.cause === 'auth_stale' ||
              classified.cause === 'auth' ||
              classified.billingRefused === true) &&
            this.launchedOnAKey
              ? { ...classified, onAKey: true as const }
              : classified
          this.emit(event)

          if (event.type === 'error' && event.fatal) {
            fatalReported = true
            if (event.cause === 'auth_stale' || event.cause === 'auth') loginRefused = true
          }
        }

        if (fatalReported) {
          this.finishAfterReportedFatal(loginRefused)
          return
        }

        for (const event of this.todoPlan.observe(message)) this.emit(event)

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

        if (message.type === 'system' && message.subtype === 'init') {
          this.skillCatalogueConfirmed = false
          if (this.builtInSkills) {
            verifyClaudeBuiltInSkills(message, this.builtInSkills)
            this.skillCatalogueConfirmed = true
          }
          this.publishToolInventory(message)
        }
        const candidate = claudeSessionRef(message, this.cwd, this.rotation)

        if (candidate && !this.initRead) {
          this.initRead = true

          const rawInitCwd =
            message.type === 'system' && message.subtype === 'init' ? message.cwd : ''

          const afterTheirReset =
            this.opening === 'resumed' &&
            this._targetRef !== null &&
            this.resetPending?.from === this._targetRef.sessionId
          this.resetPending = null
          const validated = this.validateInitRef(candidate, rawInitCwd, afterTheirReset)
          if (!validated) return
          if (afterTheirReset && validated.sessionId !== this._targetRef?.sessionId) {
            this.machine.sessionStarted(
              { ...validated, sessionId: this._targetRef?.sessionId ?? validated.sessionId },
              this.opening,
            )
            this.emit({ type: 'conversation_reset', ref: validated, source: RESET_SOURCE })
          } else {
            this.machine.sessionStarted(validated, this.opening)
          }
        } else if (candidate && this.resetPending !== null) {
          this.resetPending = null
          const moved = refAfterReset(this._ref, candidate.sessionId)
          if (moved) this.emit({ type: 'conversation_reset', ref: moved, source: RESET_SOURCE })
        }

        const reset = claudeConversationReset(message)
        if (reset) this.resetPending = reset

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

      if (!this.machine.isTerminal && this.closing === null) {
        this.finishUnexpected(`the provider stream ended unexpectedly${this.stderrClause()}`)
      }
    } catch (error) {
      if (!this.machine.isTerminal && this.closing === null)
        this.finishUnexpected(`${errorMessage(error)}${this.stderrClause()}`)
    }
  }

  private stderrClause(): string {
    try {
      const tail = this.child.stderrTail.trim()
      return tail === '' ? '' : `. stderr: ${tail.slice(-STDERR_CLAUSE_BYTES)}`
    } catch {
      return ''
    }
  }

  private resultIsTheTurns(message: SDKMessage): boolean {
    const sent = this.sentForTheTurn
    if (sent === null || sent.turnId !== this.machine.activeTurnId) return false
    const said = message as { user_message_uuid?: unknown; user_message_uuids?: unknown }
    return (
      said.user_message_uuid === sent.uuid ||
      (Array.isArray(said.user_message_uuids) && said.user_message_uuids.includes(sent.uuid))
    )
  }

  private finishUnexpected(reason: string, endedByThisAdapter = false): void {
    this.settleRequests()
    this.machine.fatalError(reason, endedByThisAdapter)
    this.releaseProvider()
  }

  private finishAfterReportedFatal(loginRefused: boolean): void {
    this.settleRequests()
    this.machine.fatalAfterReportedError(
      loginRefused ? { loginRefused: true, ...(this.launchedOnAKey ? { onAKey: true } : {}) } : {},
    )
    this.releaseProvider()
  }

  private releaseProvider(): void {
    this.detachQuery()
    this.input.close()
    this.terminated = true
    this.eventQueue.close()
  }

  private detachQuery(): void {
    this.messageReceipts?.close()
    if (this.query) {
      try {
        this.query.close()
      } catch {
        // Detach failure must not prevent session cleanup.
      }
    }
  }

  private async detachQueryAwaitingExit(): Promise<void> {
    const query = this.query
    this.detachQuery()
    if (!query?.return) return
    try {
      await withTimeout(Promise.resolve(query.return()), CLOSE_EXIT_RECEIPT_TIMEOUT_MS)
    } catch {
      // A synchronous return failure leaves teardown with nothing further to do.
    }
  }

  private settleRequests(permissionAnswer?: PermissionDecision): void {
    this.permissions.settleAll(permissionAnswer === undefined ? undefined : () => permissionAnswer)
    this.userInputs.settleAll()
  }

  private validateInitRef(
    candidate: SessionRef,
    rawInitCwd: string,

    afterTheirReset = false,
  ): SessionRef | null {
    const parsed = sessionRefSchema.safeParse(candidate)
    if (!parsed.success) {
      this.failResume(`malformed session init: empty or invalid session id`)
      return null
    }
    if (this.opening === 'resumed' && this._targetRef) {
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

  private failResume(reason: string): void {
    if (this.query) {
      try {
        this.query.close()
      } catch {
        // Detach failure must not replace the resume error.
      }
    }
    this.input.close()
    this.finishUnexpected(reason, true)
  }

  events(): AsyncIterable<RuntimeEvent> {
    return this.eventQueue
  }

  status(): SessionStatus {
    return this.currentStatus
  }

  isRetiring(): boolean {
    return this.machine.state === 'closing'
  }

  toolAnswer(toolCallId: string): ToolAnswer | null {
    return this.toolAnswers.read(toolCallId)
  }

  waitForAPerson(): () => void {
    this.machine.beginWait()
    let held = true
    return (): void => {
      if (!held) return
      held = false
      this.machine.endWait()
    }
  }

  noteLaunchCredential(token: string): void {
    this.launchCredential = token
  }

  noteLaunchedOnAKey(): void {
    this.launchedOnAKey = true
  }

  signInTag(): string | null {
    return null
  }

  async checkSignIn(): Promise<boolean> {
    if (this._signInSuperseded) return true
    if (this.launchCredential === null || !this.authTokenProviderAsync) return false

    const current = await this.authTokenProviderAsync()
    if (current === null) return false
    if (current === this.launchCredential) return false
    this._signInSuperseded = true
    return true
  }

  private async rejectedCredentialCause(): Promise<'auth' | 'auth_stale'> {
    if (this.launchedOnAKey || this.launchCredential === null || !this.authTokenProviderAsync) {
      return 'auth_stale'
    }
    try {
      const current = await this.authTokenProviderAsync()
      if (current !== null && current === this.launchCredential) return 'auth'
    } catch {
      // An unreadable credential cannot prove the rejected token is still current.
    }
    return 'auth_stale'
  }

  get signInSuperseded(): boolean {
    return this._signInSuperseded
  }

  async send(text: string, origin?: TurnProvenance): Promise<void> {
    const turnId = this.machine.beginTurn()

    if (turnId === null) throw this.machine.refusedTurn()

    const modeBefore = this.approvals.effective
    this.approvals.adopt()
    try {
      await this.applyPendingSettings()
    } catch (error) {
      this.approvals.rollback(modeBefore)
      throw error
    }

    if (this.terminated || this.machine.activeTurnId !== turnId) {
      throw new Error('the turn was stopped before its message could be sent')
    }

    const stamped = claudeOriginOf(origin)

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
        await this.settled(this.query?.setModel?.(this.models.requested), 'setModel')
        this.models.adopt()
      }
      if (this.efforts.pending) {
        const wanted = this.efforts.requested

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

        if (!sameFolders(next, this.folders.effective)) {
          if (!this.query?.applyFlagSettings) {
            throw new Error(
              'cannot change the work folders: the pinned SDK query exposes no applyFlagSettings()',
            )
          }

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
        await this.settled(
          this.query?.setPermissionMode?.(permissionModeFor(this.plan.requested)),
          'setPermissionMode',
        )
        this.plan.adopt()
      }
    } catch (error) {
      if (this.machine.activeTurnId === turnId)
        this.machine.failTurn(`could not apply the queued settings: ${errorMessage(error)}`, {
          neverSent: true,
        })
      if (reloadTimedOut) {
        void this.close().catch(() => {})
      }
      throw error
    }
  }

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

      const form = this.elicitationForms.get(id)
      const built = form === undefined ? null : elicitationContent(form, forward.values)
      if (built !== null && 'refusal' in built) {
        throw new AnswerRefused(
          'not-usable',
          `user-input request ${id} cannot be forwarded to the provider (${built.refusal})`,
        )
      }
    }

    const planGesture = this.planGestures.get(id)
    if (id.startsWith(ELICITATION_ID_PREFIX)) this.answeredByAPerson.add(id)
    if (!this.userInputs.respond(id, response)) {
      this.answeredByAPerson.delete(id)
      throw new AnswerRefused(
        'not-pending',
        `user-input request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }

    if (planGesture !== undefined && response.kind === 'answer') this.plan.settle(planGesture)
  }

  async interrupt(): Promise<void> {
    if (this.machine.isTerminal || !this.query) return
    if (!this.machine.hasProviderWork && this.machine.waiting === 0) return
    this.machine.requestInterrupt()

    const running = [...this.commandsWaitedOn].filter((id) => !this.permissions.has(id))
    if (running.length > 0) {
      this.machine.noteWhatTheStopEnded(this.machine.openTurnId ?? 'the-burst', running)
    }

    this.settleRequests(STOPPED_INSTEAD_OF_ANSWERING)
    try {
      await withTimeout(Promise.resolve(this.query.interrupt()), INTERRUPT_ACK_TIMEOUT_MS)
    } catch {
      // A refused interrupt must not block recovery.
    }

    if (!this.machine.isTerminal) this.machine.forceEnd()
  }

  async backgroundWork(toolCallId?: string): Promise<boolean> {
    if (this.machine.isTerminal || !this.query?.backgroundTasks) return false
    return await this.query.backgroundTasks(toolCallId)
  }

  async stopBackgroundWork(id: string): Promise<boolean> {
    if (this.isShuttingDown || !this.query?.stopTask) return false
    await this.query.stopTask(id)
    return true
  }

  close(): Promise<void> {
    return (this.closing ??= this.doClose())
  }

  private async doClose(): Promise<void> {
    if (!this.machine.beginClose()) {
      await this.detachQueryAwaitingExit()
      this.input.close()
      this.terminated = true
      this.eventQueue.close()
      return
    }
    this.settleRequests()

    if (this.machine.hasProviderWork) {
      this.machine.requestInterrupt()
      if (this.query) {
        await withTimeout(Promise.resolve(this.query.interrupt()), CLOSE_INTERRUPT_TIMEOUT_MS)
      }

      this.machine.forceEnd()
    }

    await this.detachQueryAwaitingExit()
    this.input.close()

    this._ref ??= await this.launchRefIfRecorded()
    this.machine.closeSession(this._ref)
    this.terminated = true
    this.eventQueue.close()
  }

  async handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: ToolPermissionOptions,
  ): Promise<PermissionResult> {
    const id = options.toolUseID
    if (this.isShuttingDown) return { behavior: 'deny', message: 'session closed' }
    if (USER_INPUT_TOOLS.has(toolName)) {
      if (CONSENT_ONLY_USER_INPUT.has(toolName)) {
        const gesture = PLAN_GESTURES.get(toolName)
        if (gesture !== undefined) this.plan.settle(gesture)
        return { behavior: 'allow' }
      }
      return this.handleUserInput(id, toolName, input, options)
    }

    if (isAutoApprove({ approvalMode: this.approvals.effective }) && !this.planning) {
      return { behavior: 'allow' }
    }

    const kind = FILE_TOOLS.has(toolName) ? 'file' : 'command'

    const reservation = this.permissions.reserve(id, options.signal)
    if (!reservation.accepted) {
      return { behavior: 'deny', message: 'duplicate, aborted, or closed permission request' }
    }
    const marks = askMarks(options)

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

      ...marks,

      ...providerReasonOf(options, marks),

      ...boundPermissionDetail(summarizeForDetail(toolName, input)),

      ...(options.title !== undefined && options.title.length <= MAX_PERMISSION_DETAIL_CHARS
        ? { summary: options.title }
        : {}),
      scope: {
        ...scope,

        approvalMode: isAutoApprove({ approvalMode: this.approvals.effective }) ? 'auto' : 'ask',
      },
    })

    this.machine.beginWait()

    const decision = await reservation.response
    this.offeredDecisions.delete(id)
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      return { behavior: 'deny', message: 'session closed' }
    }

    this.machine.endWait()

    switch (decision.outcome) {
      case 'allow':
        // This grant applies once; the next call still needs approval.
        return decision.updatedInput
          ? { behavior: 'allow', updatedInput: decision.updatedInput }
          : { behavior: 'allow' }
      case 'allow_for_session': {
        const updates = sessionGrantOf(row)

        if (updates.length === 0) return { behavior: 'allow' }

        for (const whole of wholeToolsOf(updates)) this.sessionGrants.grantAll(whole)
        this.leavePlanIfTheModeDoes(updates)
        return {
          behavior: 'allow',
          updatedPermissions: updates,

          decisionClassification: 'user_permanent',
        }
      }
      case 'allow_always': {
        const updates = alwaysGrantOf(row)
        if (!updates.some(keptByTheCli)) return { behavior: 'allow' }

        for (const kept of wholeToolsOf(updates)) this.sessionGrants.grantAll(kept)
        this.leavePlanIfTheModeDoes(updates)
        return {
          behavior: 'allow',
          updatedPermissions: updates,
          decisionClassification: 'user_permanent',
        }
      }
      case 'allow_all_for_session': {
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

    if (toolName === 'AskUserQuestion' && questions.length === 0) {
      return { behavior: 'deny', message: 'AskUserQuestion carried no questions to ask' }
    }

    const duplicate = duplicateAnswerKey(questions, (question) => question.prompt)
    if (toolName === 'AskUserQuestion' && duplicate !== null) {
      return {
        behavior: 'deny',
        message:
          `AskUserQuestion asked more than one question with the same text (${JSON.stringify(duplicate)}), ` +
          'and the answers are keyed by that text — ask each question in its own words',
      }
    }

    const unanswerable = unanswerableOptionLabel(questions)
    if (toolName === 'AskUserQuestion' && unanswerable !== null) {
      return {
        behavior: 'deny',
        message:
          `AskUserQuestion offered an option whose label is blank (${JSON.stringify(unanswerable)}), ` +
          'and a blank option cannot be chosen — give every option a label with something in it',
      }
    }

    const reservation = this.userInputs.reserve(id, options.signal)
    if (!reservation.accepted) return { behavior: 'deny', message: 'declined by user' }

    this.askedQuestions.set(id, questions)

    const planGesture = PLAN_GESTURES.get(toolName)
    if (planGesture !== undefined) this.planGestures.set(id, planGesture)

    const plan = planDocument(toolName, input)
    if (plan) this.emit(this.todoPlan.document(plan))
    this.emit({
      type: 'user_input_request',
      id,
      prompt: userInputPrompt(toolName, options.title, plan !== ''),
      questions,

      ...planConsentOf(planGesture),
    })

    this.machine.beginWait()

    const response = await reservation.response

    this.askedQuestions.delete(id)
    this.planGestures.delete(id)

    if (this.isShuttingDown) {
      this.machine.abandonWait()
      return { behavior: 'deny', message: 'declined by user' }
    }
    this.machine.endWait()

    if (response.kind !== 'answer') {
      const reason = response.reason?.trim() ?? ''
      return { behavior: 'deny', message: reason === '' ? 'declined by user' : reason }
    }
    if (toolName === 'AskUserQuestion') {
      const forward = answerToForward(questions, response.answers)
      if (!forward.forwardable) {
        return { behavior: 'deny', message: `answer cannot be forwarded (${forward.why})` }
      }

      const answers: Record<string, string> = Object.create(null)
      for (const q of questions)
        answers[q.prompt] = claudeAnswerText(forward.values.get(q.id) ?? [])

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

    return { behavior: 'allow' }
  }

  async handleElicitation(
    request: ElicitationRequest,
    signal: AbortSignal,
    requestId: string,
  ): Promise<ElicitationResult> {
    if (this.isShuttingDown) return { action: 'cancel' }
    const elicitation = mcpElicitation({
      serverName: request.serverName,
      message: request.message,
      mode: request.mode ?? 'form',
      requestedSchema: request.requestedSchema,
      url: request.url,
    })

    if (elicitation === null) return { action: 'cancel' }
    const id = `${ELICITATION_ID_PREFIX}${requestId}`
    const prompt = claudeElicitationPrompt(elicitation)

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

      return { action: 'accept', content: built.content as ElicitationResult['content'] }
    }

    const showsALink = opensALink(elicitation)
    const offer = publishedOffer(elicitation.mode === 'form' || showsALink ? ['allow'] : [])
    const reservation = this.permissions.reserve(id, signal)
    if (!reservation.accepted) return { action: 'cancel' }
    this.offeredDecisions.set(id, new Set(offer))
    this.emit({
      type: 'permission_request',
      id,

      kind: 'command',
      action: elicitation.serverName,
      ...boundPermissionDetail(prompt),

      mcpServerAsks: serverAsks(elicitation),

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

        underDisclosed: true,
        // Resolve settings before disclosure so a blank value cannot hide an approval request.
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

    if (decision.outcome === 'allow') {
      return showsALink ? { action: 'accept' } : { action: 'accept', content: {} }
    }
    if (decision.outcome !== 'cancel') return { action: 'decline' }

    return { action: 'cancel' }
  }
}

const ELICITATION_ID_PREFIX = 'elicitation-'

function claudeElicitationPrompt(elicitation: McpElicitation): string {
  const saying =
    `${elicitation.serverName} is asking you something. Claude names the server and not the ` +
    `call, so BroCrew cannot tell you which of this server\u2019s tools you are answering for.`
  return `${saying}${elicitationWords(elicitation)}`
}

function claudeAnswerText(values: readonly string[]): string {
  return values.join(', ')
}

function claudeFreeformResponse(typed: ReadonlyMap<string, readonly string[]>): string | undefined {
  if (typed.size !== 1) return undefined
  const [only] = [...typed.values()]
  return only?.length === 1 ? only[0] : undefined
}

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

function claudeScope(
  cwd: string,
  toolName: string,
  input: Record<string, unknown>,
  grantsWithheld = false,

  suggestions: readonly PermissionUpdate[] = [],

  alwaysFile?: string,
): PermissionScope {
  const uniquePaths = disclosedPaths(input)
  const networkHosts: string[] = []
  const url = input['url']
  if (typeof url === 'string') {
    const host = hostOf(url)
    if (host) networkHosts.push(host)
  }

  const fullyDisclosed = PATH_COMPLETE_TOOLS.has(toolName) && uniquePaths.length > 0
  const decisions = claudeDecisionsFor(fullyDisclosed, grantsWithheld, toolName, suggestions)
  const grants = claudeGrantsOf(decisions, toolName, suggestions, alwaysFile)
  return {
    cwd: SHELL_TOOLS.has(toolName) ? undefined : cwd,
    paths: uniquePaths,
    networkHosts,

    persistence: persistenceOf(decisions),
    ...(grants === null ? {} : { grants }),
    amendments: [],

    availableDecisions: publishedOffer(decisions),

    underDisclosed: !fullyDisclosed && !theCommandIsTheWholeCall(toolName, input),
  }
}

const A_SHELL_CALLS_SHOWN_FIELDS: ReadonlySet<string> = new Set([
  'command',
  'description',
  'timeout',
  'run_in_background',
])

function theCommandIsTheWholeCall(toolName: string, input: Record<string, unknown>): boolean {
  return (
    SHELL_TOOLS.has(toolName) &&
    typeof input['command'] === 'string' &&
    Object.keys(input).every((key) => A_SHELL_CALLS_SHOWN_FIELDS.has(key))
  )
}

function claudeDecisionsFor(
  fullyDisclosed: boolean,
  grantsWithheld = false,
  toolName = '',
  suggestions: readonly PermissionUpdate[] = [],
): readonly PermissionOutcome[] {
  if (grantsWithheld) {
    return CLAUDE_AVAILABLE_DECISIONS.filter(
      (outcome) =>
        outcome !== 'allow_for_session' &&
        outcome !== 'allow_all_for_session' &&
        outcome !== 'allow_always',
    )
  }

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

const KEPT_DESTINATION: PermissionUpdateDestination = 'localSettings'

const OFFERED_DESTINATIONS: ReadonlySet<PermissionUpdateDestination> = new Set([
  KEPT_DESTINATION,
  'session',
])

function keptByTheCli(update: PermissionUpdate): boolean {
  return update.destination === KEPT_DESTINATION
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

function suggestionsOf(options: ToolPermissionOptions): PermissionUpdate[] {
  return Array.isArray(options.suggestions) ? options.suggestions : []
}

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

    const rules = namedAFile
      ? update.rules.filter((rule) => rule.toolName !== toolName)
      : update.rules
    if (rules.length === 0) return []
    if (update.destination !== KEPT_DESTINATION) return [{ ...update, rules }]

    const once = rules.filter((rule) => rule.toolName === toolName && namesOneCommand(rule))
    const kept = rules.filter((rule) => !once.includes(rule))
    return [
      ...(kept.length === 0 ? [] : [{ ...update, rules: kept }]),
      ...(once.length === 0 ? [] : [{ ...update, rules: once, destination: 'session' as const }]),
    ]
  })
}

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

function namesOneCommand(rule: { readonly ruleContent?: string }): boolean {
  return rule.ruleContent !== undefined && !/(?: |:)\*$/.test(rule.ruleContent)
}

function sessionGrantOf(row: readonly PermissionUpdate[]): PermissionUpdate[] {
  return row.map((update) => ({ ...update, destination: 'session' }))
}

function alwaysGrantOf(row: readonly PermissionUpdate[]): PermissionUpdate[] {
  return row.flatMap((update): PermissionUpdate[] =>
    keptByTheCli(update) ? [update, { ...update, destination: 'session' }] : [update],
  )
}

function wholeToolsOf(updates: readonly PermissionUpdate[]): string[] {
  return updates.flatMap((update) =>
    update.type === 'addRules' && update.behavior === 'allow'
      ? update.rules.filter((rule) => rule.ruleContent === undefined).map((rule) => rule.toolName)
      : [],
  )
}

function isTheWholeTool(updates: readonly PermissionUpdate[], toolName: string): boolean {
  return updates.some(
    (update) =>
      update.type === 'addRules' &&
      update.behavior === 'allow' &&
      update.rules.some((rule) => rule.toolName === toolName && rule.ruleContent === undefined),
  )
}

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

function planDocument(toolName: string, input: Record<string, unknown>): string {
  if (toolName !== 'ExitPlanMode') return ''
  const plan = input['plan']
  return typeof plan === 'string' ? plan.trim() : ''
}

function userInputPrompt(toolName: string, title: string | undefined, hasPlan: boolean): string {
  if (title !== undefined && title !== '') return title
  switch (toolName) {
    case 'ExitPlanMode':
      return hasPlan
        ? 'The agent has finished planning and asks you to approve its plan.'
        : 'The agent asks you to approve its plan — but did not send the plan itself.'

    default:
      return toolName
  }
}

function claudeQuestions(toolName: string, input: Record<string, unknown>): UserInputQuestion[] {
  if (toolName !== 'AskUserQuestion' || !Array.isArray(input['questions'])) return []
  return input['questions'].map((q, i) => ({
    id: `q${i}`,
    prompt: isRecord(q) && typeof q['question'] === 'string' ? q['question'] : `question ${i + 1}`,

    header: (isRecord(q) && typeof q['header'] === 'string' ? q['header'] : '') || undefined,

    options:
      isRecord(q) && Array.isArray(q['options'])
        ? q['options'].map((o) =>
            isRecord(o) && typeof o['label'] === 'string'
              ? {
                  label: o['label'],

                  ...(typeof o['description'] === 'string' && o['description'] !== ''
                    ? { description: o['description'] }
                    : {}),
                }
              : { label: String(o) },
          )
        : [],

    allowOther: (isRecord(q) && Array.isArray(q['options']) ? q['options'].length : 0) > 0,

    multiSelect: isRecord(q) && q['multiSelect'] === true,
  }))
}

function summarizeForDetail(toolName: string, input: Record<string, unknown>): string {
  const command = input['command']

  if (typeof command === 'string') return command
  const filePath = input['file_path']
  if (typeof filePath === 'string') return filePath
  return toolName
}

export class ClaudeRuntime implements AgentRuntime {
  readonly provider = 'claude' as const
  private readonly queryFactory: QueryFactory
  private readonly sessionExists: SessionExists
  private readonly authTokenProvider: ClaudeAuthTokenProvider | undefined
  private readonly authTokenProviderAsync: ClaudeAuthTokenProviderAsync | undefined

  private readonly launchTokenProvider: ClaudeAuthTokenProviderAsync | undefined

  private readonly spawnChild: SpawnChild
  private readonly apiKeyProvider: ClaudeApiKeyProviderAsync | undefined

  private readonly platform: NodeJS.Platform

  private readonly program: string | undefined

  constructor(
    queryFactory: QueryFactory = query,
    sessionExists: SessionExists = defaultSessionExists,
    authTokenProvider?: ClaudeAuthTokenProvider,
    authTokenProviderAsync?: ClaudeAuthTokenProviderAsync,
    spawnChild: SpawnChild = spawnClaudeChild,
    apiKeyProvider?: ClaudeApiKeyProviderAsync,
    platform: NodeJS.Platform = process.platform,

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

  private async authForALaunch(): Promise<{ key: string | null; login?: string | null }> {
    const key = (await this.apiKeyProvider?.()) ?? null
    if (key !== null && key !== '') return { key }
    return { key: null, login: await this.launchTokenProvider?.() }
  }

  private readonly whyNoLogin: () => string

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

  private spawnWitness(): ClaudeChildWitness {
    return watchClaudeChild(this.spawnChild)
  }

  async start(opts: StartOptions): Promise<SessionHandle> {
    assertNotCancelled(opts.signal, 'claude start')
    const input = new AsyncQueue<SDKUserMessage>()

    const effort = claudeEffort(resolveReasoningEffort(opts) ?? '') ?? undefined

    const handle = new ClaudeSessionHandle(
      input,
      opts.cwd,
      0,
      undefined,
      opts.approvalMode,
      effort,
      opts.model,
      opts.planMode,

      this.authTokenProviderAsync,

      opts.workFolders,
      opts.managedPluginMcp,
      opts.observeManagedPlugins,
    )
    handle.noteAlwaysRulesFile()
    const auth = await this.authForALaunch()
    assertNotCancelled(opts.signal, 'claude start')

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

      opts.agentTools,

      opts.externalMcp,
      auth,
      kept,
      opts.builtInSkills,
      opts.sharedSkillsRoot,
      opts.managedPluginMcp,
    )
    handle.noteBuiltInSkills(opts.builtInSkills)
    handle.noteSharedSkills(opts.sharedSkillsRoot)

    if (opts.ultracode === true) {
      options.settings = { ...options.settings, ultracode: true }
      handle.askedForUltracode()
    }

    const child = this.spawnWitness()
    options.spawnClaudeCodeProcess = child.spawn

    const launchedAs = randomUUID()
    options.sessionId = launchedAs
    handle.holdLaunchRef(launchedAs, async () =>
      launchTranscriptCwd(launchedAs, opts.cwd, opts.providerHome),
    )
    let query: ClaudeQuery | null = null
    try {
      query = this.queryOrWhyNot({ prompt: input, options })

      const refusedAfterItsPipes = await child.spawnFailure()
      if (refusedAfterItsPipes !== null) throw refusedAfterItsPipes

      assertNotCancelled(opts.signal, 'claude start')
    } catch (error) {
      if (query !== null) {
        try {
          query.close()
        } catch {
          // Detach failure must not replace the original start failure.
        }
      }
      input.close()

      const spawnFailure = await child.spawnFailure()
      if (spawnFailure === null) throw error
      throw spawnFailure
    }
    handle.attachQuery(query, child)
    handle.begin('started')
    return handle
  }

  async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    assertNotCancelled(context.signal, 'claude model list')
    const auth = await this.authForALaunch()
    assertNotCancelled(context.signal, 'claude model list')

    const kept = await keptRulesForALaunch(context.providerHome, null, context.signal)
    const options = this.listOptionsFor(context.providerHome, kept, auth)

    options.spawnClaudeCodeProcess = this.spawnWitness().spawn
    const probe = this.queryOrWhyNot({ prompt: neverSends(), options })

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

      const models = await withDeadline(probe.supportedModels(), MODEL_PROBE_TIMEOUT_MS, 'claude')
      if (cancel.cancelled) throw new Error('claude model list was cancelled')
      return models.map((model) => ({
        id: model.value,
        label: model.displayName || model.value,
        ...(model.description ? { description: model.description } : {}),

        ...(model.resolvedModel && model.resolvedModel !== model.value
          ? { resolvesTo: model.resolvedModel }
          : {}),

        ...(model.value === CLAUDE_DEFAULT_BY_NAME.model ? { isDefault: true as const } : {}),

        ...(model.supportedEffortLevels && model.supportedEffortLevels.length > 0
          ? { efforts: model.supportedEffortLevels.map((level) => ({ id: level, label: level })) }
          : {}),

        // Only rows that advertise effort get BroCrew's fallback effort.
        ...(model.supportedEffortLevels?.includes(CLAUDE_DEFAULT_BY_NAME.effort)
          ? { defaultEffort: CLAUDE_DEFAULT_BY_NAME.effort }
          : {}),
      }))
    } finally {
      cancel.release()

      try {
        await closeProbe()
      } catch {
        // A probe that cannot close has no further cleanup available here.
      }
    }
  }

  private listOptionsFor(
    providerHome: string,
    kept: KeptRuleLists,
    auth?: { key: string | null; login?: string | null },
  ): Options {
    const { additions } = this.childEnvAdditions(providerHome, auth)
    const options: Options = {
      env: buildChildEnv(additions, process.env, this.platform),
      strictMcpConfig: true,

      settingSources: [],

      settings: {
        ...flagSettingsFor(providerHome, kept),
        ...managedTranscriptSettings(providerHome, this.managedProviderHomesRoot),
      },
    }
    return options
  }

  async resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle> {
    if (ref.provider !== 'claude') {
      throw new ResumeError(ref, `wrong provider: expected claude, got ${ref.provider}`)
    }

    let input: AsyncQueue<SDKUserMessage> | null = null
    let query: ClaudeQuery | null = null

    let child: ClaudeChildWitness | null = null
    try {
      assertNotCancelled(options.signal, 'claude resume')

      if (!(await this.sessionExists(ref.sessionId, ref.cwd, options.providerHome))) {
        throw new ResumeError(ref, `session not found: ${ref.sessionId}`, { noSuchSession: true })
      }
      const auth = await this.authForALaunch()

      assertNotCancelled(options.signal, 'claude resume')

      const stillPlanning = options.planMode === true && options.planModeEnded !== true
      input = new AsyncQueue<SDKUserMessage>()
      const handle = new ClaudeSessionHandle(
        input,
        ref.cwd,
        ref.rotation,
        ref,
        options.approvalMode,

        claudeEffort(resolveReasoningEffort(options) ?? '') ?? undefined,

        options.model,
        stillPlanning,

        this.authTokenProviderAsync,

        options.workFolders,
        options.managedPluginMcp,
        options.observeManagedPlugins,
      )
      handle.noteAlwaysRulesFile()

      const kept = await keptRulesForALaunch(
        options.providerHome,
        handle.launchLocalFiles(),
        options.signal,
      )
      assertNotCancelled(options.signal, 'claude resume')

      const built = this.optionsFor(
        handle,

        confinementFor(ref.cwd, options),
        options.model,

        options.systemHint,
        resolveReasoningEffort(options),

        stillPlanning,

        options.agentTools,

        options.externalMcp,
        auth,
        kept,
        options.builtInSkills,
        options.sharedSkillsRoot,
        options.managedPluginMcp,
      )
      handle.noteBuiltInSkills(options.builtInSkills)
      handle.noteSharedSkills(options.sharedSkillsRoot)

      child = this.spawnWitness()
      const resumeOptions: Options = {
        ...built,
        resume: ref.sessionId,

        spawnClaudeCodeProcess: child.spawn,
      }
      query = this.queryOrWhyNot({ prompt: input, options: resumeOptions })

      const spawnFailed = await child.spawnFailure()
      if (spawnFailed !== null) throw spawnFailed

      assertNotCancelled(options.signal, 'claude resume')
      handle.attachQuery(query, child)
      handle.begin('resumed')
      return handle
    } catch (error) {
      if (query) {
        try {
          query.close()
        } catch {
          // Detach failure must not replace the original resume failure.
        }
      }
      input?.close()

      if (
        error instanceof ResumeError ||
        error instanceof AuthUnavailableError ||
        error instanceof ClaudeUnavailableError
      ) {
        throw error
      }

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

    auth?: { key: string | null; login?: string | null },

    kept: KeptRuleLists = {},
    builtInSkills?: BuiltInSkillsContext,
    sharedSkillsRoot?: string,
    managedPluginMcp?: readonly ManagedPluginMcpServer[],
  ): Omit<Options, 'settings'> & { settings: Settings } {
    handle.noteSharedSkills(sharedSkillsRoot)

    const { cwd, providerHome } = confinement

    const { additions, onAKey } = this.childEnvAdditions(providerHome, auth)
    const injected = additions.CLAUDE_CODE_OAUTH_TOKEN
    if (injected) handle.noteLaunchCredential(injected)
    if (onAKey) handle.noteLaunchedOnAKey()

    const mcpServers = claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], managedPluginMcp)
    handle.configurePluginRefresh(
      (next) => claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], next) ?? {},
    )

    handle.noteDeclaredToolset(agentTools)

    const deniedToolNames = [...CLAUDE_TOOLS_TURNED_OFF, ...forbiddenExternalSpellings(externalMcp)]
    const guardHooks = promptGuardHooks(
      () => handle.approval.effective,

      railsAreTheWholeGate(agentTools),
    )
    const receiptHooks = schedulingReceiptHooks(
      (input) => handle.noteSchedulingCall(input),
      (input) => handle.noteSchedulingAnswer(input),
    )
    const options: Omit<Options, 'settings'> & { settings: Settings } = {
      cwd,
      includePartialMessages: true,

      perTaskStopAffordance: true,

      permissionMode: permissionModeFor(planMode === true),

      tools: [...SEARCH_TOOLS_VOCABULARY, ...(builtInSkills ? ['Skill'] : [])],

      disallowedTools: deniedToolNames,

      ...(effort && claudeEffort(effort) ? { effort: claudeEffort(effort)! } : {}),

      settingSources: [],
      ...(builtInSkills ? claudeBuiltInSkillOptions(builtInSkills, sharedSkillsRoot) : {}),

      hooks: {
        // The guard decides; the receipt hook beside it only notes what it is handed.
        PreToolUse: [...guardHooks.PreToolUse, ...receiptHooks.PreToolUse],
        PostToolUse: receiptHooks.PostToolUse,
        Stop: scheduleReaderHooks(
          (crons) => handle.noteSessionCrons(crons, 'hook/Stop'),
          (level) => handle.noteReportedEffort(level),
        ),
      },

      env: buildChildEnv(additions, process.env, this.platform),
      strictMcpConfig: true,

      settings: {
        ...handle.launchFlagSettings(providerHome, kept),
        ...managedTranscriptSettings(providerHome, this.managedProviderHomesRoot),
      },

      canUseTool: (name, toolInput, o) =>
        handle.handleCanUseTool(name, toolInput, o as ToolPermissionOptions),
    }
    if (model) options.model = model

    options.onElicitation = (request, o) => handle.handleElicitation(request, o.signal, o.requestId)

    if (mcpServers) options.mcpServers = mcpServers

    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      ...(systemHint ? { append: systemHint } : {}),
      snapshot: false,
    }
    handle.launchSettings = claudeLaunchSettings(options, handle.approval.effective)
    return options
  }

  private childEnvAdditions(
    providerHome: string,
    auth?: { key: string | null; login?: string | null },
  ): {
    additions: Record<string, string>
    onAKey: boolean
  } {
    if (!providerHome) {
      throw new Error(
        'refusing to launch Claude without an app-owned provider home: an empty CLAUDE_CONFIG_DIR ' +
          'would fall back to the personal ~/.claude',
      )
    }

    const additions: Record<string, string> = {
      CLAUDE_CONFIG_DIR: providerHome,
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    }

    const apiKey = auth?.key ?? null
    if (apiKey !== null && apiKey !== '') {
      additions.ANTHROPIC_API_KEY = apiKey
      return { additions, onAKey: true }
    }

    const token = auth?.login !== undefined ? auth.login : this.authTokenProvider?.()
    if (token !== undefined) {
      if (!token) {
        throw new AuthUnavailableError('claude', this.whyNoLogin())
      }

      additions.CLAUDE_CODE_OAUTH_TOKEN = token
    }
    return { additions, onAKey: false }
  }
}

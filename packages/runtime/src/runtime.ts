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

export interface BuiltInSkillsContext {
  readonly root: string
  readonly skills: readonly {
    readonly name: string
    readonly description: string
    readonly path: string
  }[]
}

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

export type StartPhaseSink = (phase: StartPhase, detail?: { readonly bytes?: number }) => void

export interface ProviderRuntimeContext {
  providerHome: string
  startPhases?: StartPhaseSink
  builtInSkills?: BuiltInSkillsContext
  sharedSkillsRoot?: string
  sharedSkillsGeneration?: () => number
  beforeSkillDiscovery?: () => Promise<void>
  approvalMode?: ApprovalMode
  reasoningEffort?: ReasoningEffort
  model?: string
  planMode?: boolean
  planModeEnded?: boolean
  signal?: AbortSignal
  agentTools?: AgentToolset
  externalMcp?: ExternalMcpReach
  managedPluginMcp?: readonly ManagedPluginMcpServer[]
  workFolders?: readonly string[]
}

export type ReasoningEffort = string

export function resolveReasoningEffort(
  context: { reasoningEffort?: unknown } | undefined,
): ReasoningEffort | undefined {
  const value = context?.reasoningEffort
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export interface ModelChoice {
  id: string
  label: string
  resolvesTo?: string
  isDefault?: true
  description?: string
  note?: string
  efforts?: readonly EffortChoice[]
  defaultEffort?: string
}

export interface EffortChoice {
  id: string
  label: string
  description?: string
}

export interface AgentInfo {
  model?: string
  reasoningEffort?: string
  reasoningEffortReported?: boolean
}

export interface SessionSettingsState {
  model: { effective: string | undefined; requested: string | undefined }
  reasoningEffort: {
    effective: ReasoningEffort | undefined
    requested: ReasoningEffort | undefined
  }
  planMode: { effective: boolean; requested: boolean }
}

export type ApprovalMode = 'ask' | 'auto'

export function isAutoApprove(context: { approvalMode?: ApprovalMode }): boolean {
  return context.approvalMode === 'auto'
}

export interface StartOptions extends ProviderRuntimeContext {
  onSessionCreated?: (handle: SessionHandle) => void
  cwd: string
  systemHint?: string
  ultracode?: boolean
}

export interface ResumeOptions extends ProviderRuntimeContext {
  onSessionCreated?: (handle: SessionHandle) => void
  systemHint?: string
}

export interface AgentRuntime {
  readonly provider: Provider
  readonly canRecreateMissingUnusedSession?: boolean

  start(opts: StartOptions): Promise<SessionHandle>

  resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle>

  listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]>
}

export type TurnProvenance =
  | { readonly kind: 'person' }
  | {
      readonly kind: 'peer'
      readonly from: string
      readonly name?: string
    }

export interface SessionHandle {
  readonly connectionId?: string
  isRetiring?(): boolean
  builtInSkillsConfirmed?(): boolean
  refreshManagedPlugins?(
    servers: readonly ManagedPluginMcpServer[],
    reconnect?: readonly string[],
  ): Promise<void>
  awaitManagedPlugins?(names: readonly string[]): void
  managedPluginHealth?(
    servers: readonly ManagedPluginMcpServer[],
  ): Promise<readonly string[] | undefined>

  readonly ref: SessionRef | null

  readonly launchedAs?: string | null

  readonly agentInfo?: AgentInfo

  readonly providerPid?: number | undefined

  awaitProcessExit?(): Promise<void> | undefined

  readonly instructionSources?: readonly string[]

  readonly launchSettings?: readonly LaunchSetting[]

  readonly signInSuperseded?: boolean

  checkSignIn?(): Promise<boolean>
  signInCopyAtLaunch?(): unknown

  signInTag?(): string | null

  account?(): SessionAccount | null | undefined

  send(text: string, origin?: TurnProvenance): Promise<void>

  carryOn?(): Promise<void>

  providerCommands?(): Promise<ProviderCommandAnswer>

  compact?(): Promise<void>

  events(): AsyncIterable<RuntimeEvent>

  respondPermission(id: string, decision: PermissionDecision): Promise<void>

  respondUserInput(id: string, response: UserInputResponse): Promise<void>

  readonly approval: ApprovalModeState

  readonly blanketGrants: readonly string[]

  setApprovalMode(mode: ApprovalMode): Promise<void>

  readonly settings: SessionSettingsState

  setModel(model: string | undefined): Promise<void>

  setReasoningEffort(effort: ReasoningEffort | undefined): Promise<void>

  setPlanMode(on: boolean): Promise<void>

  setWorkFolders(folders: readonly string[]): void

  readonly workFolders: {
    readonly effective: readonly string[]
    readonly requested: readonly string[]
  }

  readonly planNeedsGoAhead: boolean

  interrupt(): Promise<void>

  endEverythingTheTurnStarted?(): void

  backgroundWork?(toolCallId?: string): Promise<boolean>

  stopBackgroundWork?(id: string): Promise<boolean>

  childState?(childId: string): Promise<ChildThreadState>

  childInput?(childId: string, text: string): Promise<ChildInputOutcome>

  commandOutput?(toolCallId: string): CommandTail | null

  toolAnswer?(toolCallId: string): ToolAnswer | null

  status(): SessionStatus

  waitForAPerson(): () => void

  close(): Promise<void>
}

export class ResumeError extends Error {
  readonly ref: SessionRef

  readonly noSuchSession: boolean

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

export const START_REFUSED_SAID_MAX = 300

export class StartRefused extends Error {
  readonly said: string | null

  constructor(
    provider: Provider,
    asked: string,
    providerWords: string | null,
    options: { readonly cause: unknown },
  ) {
    super(`${provider} refused ${asked}: ${providerWords ?? 'it gave no reason'}`, {
      cause: options.cause,
    })
    this.said = firstLineOf(providerWords)
  }
}

const AN_ID_IN_ITS_WORDS = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

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

export class StartFailed extends Error {}

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

export function startRefusalOf(error: unknown): StartRefused | null {
  return onItsChain(error, StartRefused)
}

export function startFailureOf(error: unknown): StartFailed | null {
  return onItsChain(error, StartFailed)
}

export const TRANSIENT_SETUP_CODES = ['EMFILE', 'ENFILE', 'EAGAIN', 'ENOMEM'] as const

export type TransientSetupCode = (typeof TRANSIENT_SETUP_CODES)[number]

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

export const FOLDER_CODES_A_PERSON_MUST_FIX = [
  'EACCES',
  'EPERM',
  'EROFS',
  'ENOSPC',
  'EDQUOT',
  'ENOTDIR',
] as const

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

export function folderAPersonMustFixOf(
  error: unknown,
  opensAreWrites = true,
): { readonly code: string; readonly path: string | null; readonly syscall: string | null } | null {
  const visited = new Set<unknown>()
  let step: unknown = error
  while (step !== null && typeof step === 'object' && !visited.has(step) && visited.size < 16) {
    visited.add(step)
    if (step instanceof ResumeError) return null
    const { code, syscall, path } = step as { code?: unknown; syscall?: unknown; path?: unknown }
    if (typeof code === 'string') {
      const aSpawnsCode = typeof syscall === 'string' && syscall.startsWith('spawn')
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

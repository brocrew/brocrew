import { withManagedPluginMcp, type ManagedPluginMcpServer } from '../managed-plugin-mcp'
import { BUILT_IN_SKILLS_FAILURE, registerCodexBuiltInSkills } from '../built-in-skills'
import type { BuiltInSkillsContext, StartPhaseSink } from '../runtime'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SessionStatus } from '@brobot2/shared'
import { resolveGeneratedImage } from './generated-image'
import { beyondItsRailsOf, type AgentToolset } from '../agent-tools'
import { AnswerRefused } from '../answer-refused'
import type { ExternalMcpReach } from '../external-mcp'
import {
  codexElicitation,
  codexExternalMcpConfig,
  codexToolApproval,
  codexToolApprovalDetail,
  elicitationContent,
  elicitationQuestions,
  externalMcpElicitationPrompt,
  McpCallsInFlight,
  opensALink,
  serverAsks,
  type ClaimedToolApproval,
} from './external-mcp'
import {
  keepToolApproval,
  keptToolApprovals,
  keptToolApprovalsFile,
  type KeptToolApproval,
} from './kept-tool-approvals'
import { ApprovalModeSwitch, type ApprovalModeState } from '../approval-mode'
import { CommandTails, type CommandTail } from '../command-output'
import { ToolAnswers, type ToolAnswer } from '../tool-answer'
import { MessageActCalls } from '../message-act'
import { NextTurnSetting } from '../next-turn'
import {
  boundPermissionDetail,
  wrapUnknown,
  type PlanStep,
  type RuntimeEvent,
  type TurnLimit,
} from '../events'
import { wordsForACard } from '../words-on-a-card'
import {
  answerToForward,
  duplicateAnswerKey,
  isAlwaysHonoured,
  persistenceOf,
  publishedOffer,
  type GrantRule,
  type PermissionAmendment,
  type PermissionDecision,
  type PermissionGrants,
  type PermissionOutcome,
  type PermissionScope,
  unanswerableOptionLabel,
  type UserInputPermission,
  type UserInputQuestion,
  type UserInputResponse,
} from '../permission'
import {
  type AgentInfo,
  type AgentRuntime,
  type ApprovalMode,
  type EffortChoice,
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
  StartFailed,
  StartRefused,
} from '../runtime'
import type { LaunchSetting } from '../launch-settings'
import { sessionRefSchema, type SessionRef } from '../session-ref'
import { authStateReason, blocksLaunch } from '../auth-state'
import { probeCodexAuth } from './auth-probe'
import {
  MANAGED_PLUGIN_READY_WITHIN_MS,
  failedManagedPluginConnections,
  waitForManagedPluginTools,
} from './managed-plugin-readiness'
import { AsyncQueue } from '../internal/async-queue'
import {
  AuthUnavailableError,
  assertCodexSqliteHomeContained,
  codexAccountIn,
  codexAccountInNow,
  type AuthHealth,
  CodexRefusedItsSignInError,
  codexCopyIdentityIn,
  isTheSameCodexCopy,
  type CodexCopyIdentity,
} from '../internal/auth'
import { buildChildEnv } from '../internal/child-env'
import { assertNotCancelled, cancelWith, withDeadline, withTimeout } from '../internal/bounded'
import { DeltaCoalescer } from '../internal/delta-coalescer'
import { endsOpenSubAgents, OpenSubAgents } from '../internal/open-sub-agents'
import { RequestBroker } from '../internal/request-broker'
import { isProviderWork } from '../internal/provider-work'
import { SessionMachine } from '../internal/session-machine'
import { StallWatchdog, stallNotice } from '../internal/stall-watchdog'
import {
  RateLimitWatch,
  codexToolAnswerParts,
  codexErrorIsAUsageLimit,
  codexTurnHitItsUsageLimit,
  codexTurnFailedOnItsCredential,
  codexTurnOutcome,
  normalizeNotification,
  rateLimitUsage,
  readCodexSkill,
} from './normalize'
import { boundCommands, CODEX_COMMAND_PREFIX } from '../provider-commands'
import {
  CHILD_STATE_UNKNOWN,
  type ChildInputOutcome,
  childInputRefusal,
  childStatusOf,
  type ChildThreadState,
} from '../child-conversation'
import { patchTargetLabel, PatchTargets, type PatchTarget } from './patch-targets'
import { BackgroundTerminals } from './background-terminals'
import { CodexSubAgents } from './sub-agents'
import { CODEX_PROTOCOL_VERSION, codexVersionFromUserAgent } from './protocol-version'
import {
  CodexExited,
  CodexRequestRefused,
  SpawnCodexTransport,
  type CodexTransport,
} from './codex-transport'
import { codexNoLongerHasTheThread } from './lost-thread'
import { beginCodexHomeBoot } from './home-boot'
import {
  answerCodexToolCall,
  CODEX_TOOLS_DESCRIPTION,
  codexDynamicToolsFor,
  type CodexToolCall,
} from './agent-tools'
import { boundInventory, parametersOf, CODEX_TOOL_NAMING } from '../tool-inventory'
import {
  CODEX_MEMORY_SETTINGS,
  ensureCodexMemoryConfig,
  type CodexMemoryConfigResult,
} from './memory-config'
import { removeStaleCodexPermissionConfig } from './stale-permission-config'
import type { ClientInfo } from './protocol/ClientInfo'
import type { CollaborationMode } from './protocol/CollaborationMode'
import type { InitializeCapabilities } from './protocol/InitializeCapabilities'
import type { InitializeParams } from './protocol/InitializeParams'
import type { ReasoningSummary } from './protocol/ReasoningSummary'
import type { AdditionalFileSystemPermissions } from './protocol/v2/AdditionalFileSystemPermissions'
import type { CommandExecutionApprovalDecision } from './protocol/v2/CommandExecutionApprovalDecision'
import type { FileSystemSandboxEntry } from './protocol/v2/FileSystemSandboxEntry'
import type { GrantedPermissionProfile } from './protocol/v2/GrantedPermissionProfile'
import type { McpServerElicitationRequestResponse } from './protocol/v2/McpServerElicitationRequestResponse'
import type { PermissionsRequestApprovalResponse } from './protocol/v2/PermissionsRequestApprovalResponse'
import type { SandboxPolicy } from './protocol/v2/SandboxPolicy'
import type { ThreadCompactStartParams } from './protocol/v2/ThreadCompactStartParams'
import type { ThreadReadParams } from './protocol/v2/ThreadReadParams'
import type { ThreadResumeParams } from './protocol/v2/ThreadResumeParams'
import type { DynamicToolSpec } from './protocol/v2/DynamicToolSpec'
import type { ThreadStartParams } from './protocol/v2/ThreadStartParams'
import type { JsonValue } from './protocol/serde_json/JsonValue'
import type { TurnInterruptParams } from './protocol/v2/TurnInterruptParams'
import type { TurnStartParams } from './protocol/v2/TurnStartParams'

function savedKeyTagIn(home: string): string | null {
  try {
    const file = join(home, 'brobot-api-key-login.json')
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.size > 256) return null
    const revision = (JSON.parse(readFileSync(file, 'utf8')) as { setAt?: unknown }).setAt
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
      ? `api-revision:${revision}`
      : null
  } catch {
    return null
  }
}

export interface CodexLaunchContext {
  cwd: string
  providerHome: string
}

export type TransportFactory = (context: CodexLaunchContext) => CodexTransport

export function codexAppServerArgs(): string[] {
  return ['app-server']
}

export function createSpawnTransportFactory(command = 'codex'): TransportFactory {
  return (context: CodexLaunchContext): CodexTransport => {
    return new SpawnCodexTransport(command, codexAppServerArgs(), {
      cwd: context.cwd,
      env: buildChildEnv({
        CODEX_HOME: context.providerHome,
        CODEX_SQLITE_HOME: context.providerHome,
      }),
    })
  }
}

const defaultTransport = createSpawnTransportFactory()

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function readString(value: unknown, key: string): string {
  if (isRecord(value) && typeof value[key] === 'string') return value[key]
  return ''
}

function approvalProfileProblems(
  reviewer: unknown,
  policy: unknown,
  sandboxType: unknown,
  approvalMode?: ApprovalMode,
): string[] {
  const expected = isAutoApprove({ approvalMode })
    ? { reviewer: 'user', policy: 'never', sandbox: 'dangerFullAccess' }
    : { reviewer: 'user', policy: 'on-request', sandbox: 'workspaceWrite' }
  const problems: string[] = []
  if (reviewer !== expected.reviewer)
    problems.push(`approvalsReviewer=${JSON.stringify(reviewer)} (must be '${expected.reviewer}')`)
  if (policy !== expected.policy)
    problems.push(`approvalPolicy=${JSON.stringify(policy)} (must be '${expected.policy}')`)
  if (sandboxType !== expected.sandbox)
    problems.push(`sandbox=${JSON.stringify(sandboxType)} (must be '${expected.sandbox}')`)
  return problems
}

function sandboxTypeOf(value: unknown): unknown {
  return isRecord(value) ? value['type'] : value
}

function readOptionalString(value: unknown, key: string): string | undefined {
  return readString(value, key) || undefined
}

function readStringArray(value: unknown, key: string): readonly string[] | undefined {
  if (!isRecord(value)) return undefined
  const raw = value[key]
  if (!Array.isArray(raw)) return undefined
  const items = raw.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  return items.length > 0 ? items : undefined
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function outcomeOfCodexDecision(decision: unknown): PermissionOutcome | null {
  if (execPolicyAmendmentOf(decision) !== null) return 'allow_always'
  switch (decision) {
    case 'accept':
      return 'allow'
    case 'acceptForSession':
      return 'allow_for_session'
    case 'decline':
      return 'deny'
    case 'cancel':
      return 'cancel'
    default:
      return null
  }
}

export const CODEX_EXEC_POLICY_RULES = 'rules/default.rules'

function execPolicyAmendmentOf(decision: unknown): readonly string[] | null {
  if (!isRecord(decision) || Object.keys(decision).length !== 1) return null
  const inner = decision['acceptWithExecpolicyAmendment']
  if (!isRecord(inner)) return null
  const prefix = inner['execpolicy_amendment']
  if (!Array.isArray(prefix) || prefix.length === 0) return null
  if (!prefix.every((part): part is string => typeof part === 'string' && part !== '')) return null
  return prefix
}

function commandActionPaths(actions: unknown): string[] {
  if (!Array.isArray(actions)) return []
  const paths: string[] = []
  for (const a of actions) {
    const p = readString(a, 'path')
    if (p) paths.push(p)
  }
  return unique(paths)
}

const STANDARD_DECISIONS: readonly PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'deny',
  'cancel',
]

function commandNetworkHosts(params: Record<string, unknown>): string[] {
  const hosts: string[] = []
  const ctx = params['networkApprovalContext']
  const ctxHost = readString(ctx, 'host')
  if (ctxHost) {
    const protocol = readString(ctx, 'protocol')
    hosts.push(protocol ? `${protocol}://${ctxHost}` : ctxHost)
  }
  const amendments = params['proposedNetworkPolicyAmendments']
  if (Array.isArray(amendments)) {
    for (const a of amendments) {
      const h = readString(a, 'host')
      if (h) hosts.push(h)
    }
  }
  return unique(hosts)
}

function commandAmendments(params: Record<string, unknown>): PermissionAmendment[] {
  const out: PermissionAmendment[] = []
  const exec = params['proposedExecpolicyAmendment']
  if (Array.isArray(exec) && exec.length > 0) {
    out.push({
      kind: 'exec',
      detail: exec.filter((x): x is string => typeof x === 'string').join(' '),
    })
  }
  const net = params['proposedNetworkPolicyAmendments']
  if (Array.isArray(net)) {
    for (const a of net) {
      if (!isRecord(a)) continue
      const host = readString(a, 'host')
      const action = typeof a['action'] === 'string' ? a['action'] : ''
      if (host) out.push({ kind: 'network', detail: `${action} ${host}`.trim() })
    }
  }
  return out
}

interface ProfileDisclosure {
  labels: string[]
  network: boolean
  faithful: boolean
}

const KNOWN_FS_KEYS = new Set(['read', 'write', 'globScanMaxDepth', 'entries'])
const KNOWN_PROFILE_KEYS = new Set(['network', 'fileSystem'])
const KNOWN_NETWORK_KEYS = new Set(['enabled'])

function fsSpecialLabel(value: unknown): string {
  if (!isRecord(value)) return ''
  const kind = value['kind']
  if (kind === 'root' || kind === 'minimal' || kind === 'tmpdir' || kind === 'slash_tmp')
    return `special:${kind}`
  if (kind === 'project_roots') {
    const subpath = readString(value, 'subpath')
    return subpath ? `special:project_roots/${subpath}` : 'special:project_roots'
  }
  return ''
}

function fsPathLabel(path: unknown): string {
  if (!isRecord(path)) return ''
  switch (path['type']) {
    case 'path':
      return readString(path, 'path')
    case 'glob_pattern': {
      const pattern = readString(path, 'pattern')
      return pattern ? `glob:${pattern}` : ''
    }
    case 'special':
      return fsSpecialLabel(path['value'])
    default:
      return ''
  }
}

function fsEntryLabel(entry: unknown): string {
  if (!isRecord(entry)) return ''
  const access = entry['access']
  if (access !== 'read' && access !== 'write' && access !== 'deny') return ''
  const target = fsPathLabel(entry['path'])
  if (!target) return ''
  return `${access === 'deny' ? 'restrict' : access} ${target}`
}

function fileSystemDisclosure(fileSystem: unknown): { labels: string[]; faithful: boolean } {
  if (fileSystem === null || fileSystem === undefined) return { labels: [], faithful: true }
  if (!isRecord(fileSystem)) return { labels: [], faithful: false }
  const labels: string[] = []
  let faithful = Object.keys(fileSystem).every((key) => KNOWN_FS_KEYS.has(key))
  for (const mode of ['read', 'write'] as const) {
    const list = fileSystem[mode]
    if (list === null || list === undefined) continue
    if (!Array.isArray(list)) {
      faithful = false
      continue
    }
    for (const path of list) {
      if (typeof path === 'string' && path) labels.push(`${mode} ${path}`)
      else faithful = false
    }
  }
  const entries = fileSystem['entries']
  if (entries !== null && entries !== undefined) {
    if (!Array.isArray(entries)) faithful = false
    else {
      for (const entry of entries) {
        const label = fsEntryLabel(entry)
        if (label) labels.push(label)
        else faithful = false
      }
    }
  }
  return { labels: unique(labels), faithful }
}

function permissionProfileDisclosure(profile: unknown): ProfileDisclosure {
  if (profile === null || profile === undefined)
    return { labels: [], network: false, faithful: true }
  if (!isRecord(profile)) return { labels: [], network: false, faithful: false }
  const fs = fileSystemDisclosure(profile['fileSystem'])
  const known = Object.keys(profile).every((key) => KNOWN_PROFILE_KEYS.has(key))
  const rawNetwork = profile['network']
  const networkKnown =
    rawNetwork === null || rawNetwork === undefined
      ? true
      : isRecord(rawNetwork) && Object.keys(rawNetwork).every((key) => KNOWN_NETWORK_KEYS.has(key))
  const network = isRecord(rawNetwork) ? rawNetwork['enabled'] === true : false
  return { labels: fs.labels, network, faithful: fs.faithful && known && networkKnown }
}

const A_COMMAND_APPROVALS_KNOWN_FIELDS: ReadonlySet<string> = new Set([
  'kind',
  'threadId',
  'turnId',
  'itemId',
  'startedAtMs',
  'approvalId',
  'environmentId',
  'reason',
  'networkApprovalContext',
  'command',
  'cwd',
  'commandActions',
  'additionalPermissions',
  'proposedExecpolicyAmendment',
  'proposedNetworkPolicyAmendments',
  'availableDecisions',
])

function theCommandIsTheWholeRequest(
  params: Record<string, unknown>,
  paths: readonly string[],
  requested: ProfileDisclosure,
  everyAnswerDrawn: boolean,
): boolean {
  const none = (value: unknown): boolean =>
    value === undefined || value === null || (Array.isArray(value) && value.length === 0)
  const kind = params['kind']
  const command = params['command']
  return (
    (kind === undefined || kind === null || kind === 'command') &&
    typeof command === 'string' &&
    command !== '' &&
    paths.length === 0 &&
    none(params['networkApprovalContext']) &&
    none(params['proposedNetworkPolicyAmendments']) &&
    !requested.network &&
    requested.faithful &&
    everyAnswerDrawn &&
    Object.keys(params).every((key) => A_COMMAND_APPROVALS_KNOWN_FIELDS.has(key))
  )
}

function commandScope(params: unknown): {
  scope: PermissionScope
  allowed: Set<PermissionOutcome> | null
  alwaysAnswer?: unknown
} {
  const p = isRecord(params) ? params : {}
  const rawList = p['availableDecisions']
  const hasExplicitList = Array.isArray(rawList)
  const rawDecisions = hasExplicitList ? rawList : []
  const mapped = rawDecisions.map(outcomeOfCodexDecision)
  const enumerated = unique(mapped.filter((o): o is PermissionOutcome => o !== null))
  const amendments = commandAmendments(p)
  const requested = permissionProfileDisclosure(p['additionalPermissions'])
  const allowed = !requested.faithful
    ? new Set<PermissionOutcome>()
    : hasExplicitList
      ? new Set(enumerated)
      : null
  const noPositive = [...(allowed ?? STANDARD_DECISIONS)].some(
    (outcome) => !isAlwaysHonoured(outcome),
  )
    ? undefined
    : !requested.faithful
      ? ('could-not-describe-the-grant' as const)
      : mapped.some((outcome) => outcome === null)
        ? ('could-not-represent-the-answers' as const)
        : ('none-was-offered' as const)
  const paths = unique([...commandActionPaths(p['commandActions']), ...requested.labels])
  const scope: PermissionScope = {
    cwd: readOptionalString(p, 'cwd'),
    paths,
    networkHosts: commandNetworkHosts(p),
    persistence: persistenceOf([...(allowed ?? STANDARD_DECISIONS)]),
    amendments,
    availableDecisions: publishedOffer([...(allowed ?? STANDARD_DECISIONS)]),
    noPositiveBecause: noPositive,
    underDisclosed: !theCommandIsTheWholeRequest(
      p,
      paths,
      requested,
      mapped.every((outcome) => outcome !== null),
    ),
  }
  const alwaysAnswer = rawDecisions.find((decision) => execPolicyAmendmentOf(decision) !== null)
  const prefix = alwaysAnswer === undefined ? null : execPolicyAmendmentOf(alwaysAnswer)
  if (prefix !== null && allowed?.has('allow_always') === true) {
    scope.grants = { allow_always: [{ kind: 'command-prefix', prefix: [...prefix] }] }
    return { scope, allowed, alwaysAnswer }
  }
  return { scope, allowed }
}

type ServerRequestKind =
  | { kind: 'approval'; approval: 'command' | 'file' }
  | { kind: 'userInput'; isPermission: boolean }
  | { kind: 'agentTool' }
  | { kind: 'elicitation' }
  | { kind: 'unsupported' }

function serverRequestKind(method: string): ServerRequestKind {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return { kind: 'approval', approval: 'command' }
    case 'item/fileChange/requestApproval':
      return { kind: 'approval', approval: 'file' }
    case 'item/tool/requestUserInput':
      return { kind: 'userInput', isPermission: false }
    case 'item/permissions/requestApproval':
      return { kind: 'userInput', isPermission: true }
    case 'item/tool/call':
      return { kind: 'agentTool' }
    case 'mcpServer/elicitation/request':
      return { kind: 'elicitation' }
    default:
      return { kind: 'unsupported' }
  }
}

function safeRefusal(kind: Exclude<ServerRequestKind, { kind: 'unsupported' }>): unknown {
  if (kind.kind === 'approval') return { decision: 'decline' }
  if (kind.kind === 'agentTool') {
    return {
      contentItems: [{ type: 'inputText', text: 'this session cannot take tool calls right now' }],
      success: false,
    }
  }
  if (kind.kind === 'elicitation') return { action: 'decline', content: null, _meta: null }
  return userInputDecline(kind.isPermission)
}

const A_TOOLS_SESSION_GRANT: PermissionOutcome = 'allow_all_for_session'

function aToolApprovalsPositives(approval: ClaimedToolApproval): PermissionOutcome[] {
  return [
    'allow',
    ...(approval.offersSession ? [A_TOOLS_SESSION_GRANT] : []),
    ...(approval.offersAlways ? (['allow_always'] as const) : []),
  ]
}

function aToolApprovalCard(
  id: string,
  approval: ClaimedToolApproval,
  approvalMode: 'ask' | 'auto',
  providerHome?: string,
): Extract<RuntimeEvent, { type: 'permission_request' }> {
  const summary = wordsForACard(approval.question)
  const offer = publishedOffer(aToolApprovalsPositives(approval))
  const tool = wordsForACard(approval.tool) ?? ''
  return {
    type: 'permission_request',
    id,
    kind: 'command',
    action: tool,
    ...boundPermissionDetail(codexToolApprovalDetail(approval)),
    ...(summary === null ? {} : { summary }),
    mcpToolCall: {
      server: approval.serverName,
      tool,
      parameters: [...approval.parameters],
      ...(approval.parametersOmitted > 0 ? { parametersOmitted: approval.parametersOmitted } : {}),
    },
    scope: {
      paths: [],
      networkHosts: [],
      persistence: persistenceOf(offer),
      grants: aToolApprovalsGrants(approval, tool, offer, providerHome),
      amendments: [],
      availableDecisions: offer,
      underDisclosed: true,
      approvalMode,
    },
  }
}

function aToolApprovalsGrants(
  approval: ClaimedToolApproval,
  tool: string,
  offer: readonly PermissionOutcome[],
  providerHome: string | undefined,
): PermissionGrants | undefined {
  const rule: GrantRule = { kind: 'tool', tool, server: approval.serverName }
  const grants: PermissionGrants = {
    ...(offer.includes(A_TOOLS_SESSION_GRANT) ? { [A_TOOLS_SESSION_GRANT]: [rule] } : {}),
    ...(offer.includes('allow_always')
      ? {
          allow_always: [rule],
          ...(providerHome === undefined
            ? {}
            : { alwaysFile: keptToolApprovalsFile(providerHome) }),
        }
      : {}),
  }
  return Object.keys(grants).length === 0 ? undefined : grants
}

function elicitationAnswer(
  decision: PermissionDecision,
  approval: ClaimedToolApproval | undefined,
  confirmsAServersForm: boolean,
  showsALink = false,
): McpServerElicitationRequestResponse {
  if ((approval !== undefined || confirmsAServersForm) && decision.outcome === 'allow') {
    return { action: 'accept', content: {}, _meta: null }
  }
  if (showsALink && decision.outcome === 'allow') {
    return { action: 'accept', content: null, _meta: null }
  }
  if (approval !== undefined && decision.outcome === A_TOOLS_SESSION_GRANT) {
    return { action: 'accept', content: {}, _meta: { persist: 'session' } }
  }
  if (approval !== undefined && decision.outcome === 'allow_always') {
    return { action: 'accept', content: {}, _meta: { persist: 'always' } }
  }
  return {
    action: decision.outcome === 'cancel' ? 'cancel' : 'decline',
    content: null,
    _meta: null,
  }
}

function codexToolCall(params: unknown): CodexToolCall | null {
  if (!isRecord(params)) return null
  const tool = readString(params, 'tool')
  if (!tool) return null
  const namespace = readString(params, 'namespace')
  return {
    namespace: namespace ? namespace : null,
    tool,
    arguments: params['arguments'],
    callId: readString(params, 'callId'),
  }
}

type ForwardedUserInput = { readonly payload: unknown } | { readonly refusal: string }

function userInputPayloadFor(
  isPermission: boolean,
  params: unknown,
  response: UserInputResponse,
): ForwardedUserInput {
  if (response.kind !== 'answer') return { payload: userInputDecline(isPermission) }
  if (isPermission) return { payload: codexGrant(params) }
  const forward = answerToForward(codexQuestions(params), response.answers)
  if (!forward.forwardable) return { refusal: forward.why }
  return { payload: codexAnswers(params, forward.values) }
}

type SupportedRequestKind = Exclude<ServerRequestKind, { kind: 'unsupported' }>

type RequestState =
  | {
      phase: 'claimed'
      rawId: string | number
      kind: SupportedRequestKind
      messageCallId?: string
      allowed?: Set<PermissionOutcome> | null
      userInputPayload?: (response: UserInputResponse) => ForwardedUserInput
      approvesATool?: ClaimedToolApproval
      confirmsAServersForm?: true
      showsALink?: true
      alwaysAnswer?: unknown
    }
  | { phase: 'spent' }

function userInputDecline(isPermission: boolean): Record<string, unknown> {
  return isPermission
    ? ({ permissions: {}, scope: 'turn' } satisfies PermissionsRequestApprovalResponse)
    : { answers: {} }
}

function grantedPaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const paths = value.filter((p): p is string => typeof p === 'string' && p.length > 0)
  return paths.length > 0 ? paths : null
}

function grantedEntry(entry: unknown): FileSystemSandboxEntry | null {
  if (!isRecord(entry)) return null
  const access = entry['access']
  if (access !== 'read' && access !== 'write' && access !== 'deny') return null
  const path = entry['path']
  if (!isRecord(path) || !fsPathLabel(path)) return null
  return { path: path as FileSystemSandboxEntry['path'], access }
}

function grantedProfile(requested: Record<string, unknown>): GrantedPermissionProfile {
  const profile: GrantedPermissionProfile = {}
  const network = requested['network']
  if (isRecord(network)) {
    profile.network = { enabled: network['enabled'] === true }
  }
  const fileSystem = requested['fileSystem']
  if (isRecord(fileSystem)) {
    const section: AdditionalFileSystemPermissions = {
      read: grantedPaths(fileSystem['read']),
      write: grantedPaths(fileSystem['write']),
    }
    const entries = fileSystem['entries']
    if (Array.isArray(entries)) {
      const granted = entries
        .map(grantedEntry)
        .filter((e): e is FileSystemSandboxEntry => e !== null)
      if (granted.length > 0) section.entries = granted
    }
    if (typeof fileSystem['globScanMaxDepth'] === 'number') {
      section.globScanMaxDepth = fileSystem['globScanMaxDepth']
    }
    profile.fileSystem = section
  }
  return profile
}

function codexGrant(params: unknown): Record<string, unknown> {
  const requested = isRecord(params) && isRecord(params['permissions']) ? params['permissions'] : {}
  if (!permissionProfileDisclosure(requested).faithful) return userInputDecline(true)
  return {
    permissions: grantedProfile(requested),
    scope: 'turn',
  } satisfies PermissionsRequestApprovalResponse
}

function codexAnswers(
  params: unknown,
  approved: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> {
  const questions =
    isRecord(params) && Array.isArray(params['questions']) ? params['questions'] : []
  const answers: Record<string, { answers: string[] }> = Object.create(null)
  questions.forEach((q, i) => {
    const providerId = isRecord(q) ? readString(q, 'id') : ''
    const value = approved.get(providerId || `q${i}`)
    if (providerId && value !== undefined) answers[providerId] = { answers: [...value] }
  })
  return { answers }
}

function hasUndeliverableQuestionId(params: unknown): boolean {
  const questions =
    isRecord(params) && Array.isArray(params['questions']) ? params['questions'] : []
  return questions.some((q) => !(isRecord(q) && readString(q, 'id')))
}

function codexQuestions(params: unknown): UserInputQuestion[] {
  const questions =
    isRecord(params) && Array.isArray(params['questions']) ? params['questions'] : []
  return questions.map((q, i) => ({
    id: (isRecord(q) && readString(q, 'id')) || `q${i}`,
    prompt: (isRecord(q) && readString(q, 'question')) || `question ${i + 1}`,
    header: (isRecord(q) && readString(q, 'header')) || undefined,
    options:
      isRecord(q) && Array.isArray(q['options'])
        ? q['options'].map((o) =>
            isRecord(o)
              ? {
                  label: readString(o, 'label'),
                  ...(readString(o, 'description') === ''
                    ? {}
                    : { description: readString(o, 'description') }),
                }
              : { label: String(o) },
          )
        : [],
    allowOther: isRecord(q) && q['isOther'] === true,
    secret: isRecord(q) && q['isSecret'] === true,
    multiSelect: false,
  }))
}

function codexUserPermission(params: unknown): UserInputPermission {
  const p = isRecord(params) ? params : {}
  const requested = permissionProfileDisclosure(isRecord(p['permissions']) ? p['permissions'] : {})
  const agentReason = wordsForACard(p['reason'])
  return {
    cwd: readOptionalString(p, 'cwd'),
    ...(agentReason === null ? {} : { agentReason }),
    paths: requested.labels,
    network: requested.network,
  }
}

function theModelWroteTheReason(params: unknown): boolean {
  if (!isRecord(params)) return false
  const absent = (key: string): boolean => params[key] === undefined || params[key] === null
  const amendment = params['proposedExecpolicyAmendment']
  return (
    readString(params, 'command') !== '' &&
    Array.isArray(amendment) &&
    absent('networkApprovalContext') &&
    absent('approvalId') &&
    absent('additionalPermissions')
  )
}

function thePolicysWords(params: unknown): string | null {
  if (!isRecord(params)) return null
  const command = params['command']
  const said = params['reason']
  if (typeof command !== 'string' || command === '' || typeof said !== 'string') return null
  const unset = [
    'proposedExecpolicyAmendment',
    'networkApprovalContext',
    'approvalId',
    'additionalPermissions',
  ]
  if (!unset.every((key) => params[key] == null)) return null
  const head = `\`${command}\` requires approval: `
  if (!said.startsWith(head) || said.slice(head.length).trim() === '') return null
  return wordsForACard(said)
}

export const THE_AGENT_ASKS_FOR_ACCESS = 'The agent asks you to grant it more access.'

function fileScope(
  params: unknown,
  targets: readonly PatchTarget[],
): {
  scope: PermissionScope
  allowed: Set<PermissionOutcome> | null
} {
  const grantRoot = readOptionalString(isRecord(params) ? params : {}, 'grantRoot')
  const scope: PermissionScope = {
    cwd: undefined,
    paths: unique([...targets.map((target) => target.path), ...(grantRoot ? [grantRoot] : [])]),
    networkHosts: [],
    persistence: persistenceOf(STANDARD_DECISIONS),
    grantRoot,
    amendments: [],
    availableDecisions: publishedOffer(STANDARD_DECISIONS),
    underDisclosed: targets.length === 0,
  }
  return { scope, allowed: null }
}

function fileDetail(targets: readonly PatchTarget[]): string {
  if (targets.length === 0) {
    return (
      'file change — the provider did not name the files this patch touches; ' +
      'they appear in Changes once it has run'
    )
  }
  return targets.map(patchTargetLabel).join('\n')
}

function codexDecision(decision: PermissionDecision): CommandExecutionApprovalDecision {
  switch (decision.outcome) {
    case 'allow':
      return 'accept'
    case 'allow_for_session':
      return 'acceptForSession'
    case 'cancel':
      return 'cancel'
    default:
      return 'decline'
  }
}

const MODEL_LIST_PAGE_LIMIT = 20

const MODEL_PROBE_TIMEOUT_MS = 15_000

function modelChoiceOf(row: unknown): ModelChoice | null {
  if (!isRecord(row)) return null
  if (row['hidden'] === true) return null
  const id = readString(row, 'id') || readString(row, 'model')
  if (!id) return null
  const description = readString(row, 'description')
  const upgradeInfo = row['upgradeInfo']
  const migration = isRecord(upgradeInfo) ? readString(upgradeInfo, 'migrationMarkdown').trim() : ''
  const successor = readString(row, 'upgrade')
  const note = migration || (successor ? `Superseded by ${successor}.` : '')
  const efforts: EffortChoice[] = []
  const supported = row['supportedReasoningEfforts']
  if (Array.isArray(supported)) {
    for (const option of supported) {
      if (!isRecord(option)) continue
      const value = readString(option, 'reasoningEffort').trim()
      if (!value) continue
      const explains = readString(option, 'description').trim()
      efforts.push({ id: value, label: value, ...(explains ? { description: explains } : {}) })
    }
  }
  const defaultEffort = readString(row, 'defaultReasoningEffort').trim()
  const resolvesTo = readString(row, 'model').trim()
  return {
    id,
    label: readString(row, 'displayName') || id,
    ...(description ? { description } : {}),
    ...(note ? { note } : {}),
    ...(efforts.length > 0 ? { efforts } : {}),
    ...(defaultEffort ? { defaultEffort } : {}),
    ...(resolvesTo && resolvesTo !== id ? { resolvesTo } : {}),
    ...(row['isDefault'] === true ? { isDefault: true as const } : {}),
  }
}

const CLIENT_INFO: ClientInfo = { name: 'brobot2', title: null, version: '0.0.0' }
const CAPABILITIES: InitializeCapabilities = { experimentalApi: true, requestAttestation: false }

function initializeParams(): InitializeParams {
  return { clientInfo: CLIENT_INFO, capabilities: CAPABILITIES }
}

export const APPROVAL_PROFILES = {
  ask: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' },
  auto: { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' },
} as const satisfies Record<
  ApprovalMode,
  Pick<ThreadStartParams, 'approvalPolicy' | 'approvalsReviewer' | 'sandbox'>
>

function approvalProfileFor(context: { approvalMode?: ApprovalMode }) {
  return isAutoApprove(context) ? APPROVAL_PROFILES.auto : APPROVAL_PROFILES.ask
}

function askPolicyOf(value: unknown): WorkspaceWritePolicy | null {
  if (!isRecord(value) || value['type'] !== 'workspaceWrite') return null
  const writableRoots = value['writableRoots']
  const networkAccess = value['networkAccess']
  const excludeTmpdirEnvVar = value['excludeTmpdirEnvVar']
  const excludeSlashTmp = value['excludeSlashTmp']
  if (!Array.isArray(writableRoots)) return null
  if (!writableRoots.every((root): root is string => typeof root === 'string')) return null
  if (typeof networkAccess !== 'boolean') return null
  if (typeof excludeTmpdirEnvVar !== 'boolean' || typeof excludeSlashTmp !== 'boolean') return null
  return {
    type: 'workspaceWrite',
    writableRoots: [...writableRoots],
    networkAccess,
    excludeTmpdirEnvVar,
    excludeSlashTmp,
  }
}

const WORKSPACE_WRITE_UNSAID: WorkspaceWritePolicy = {
  type: 'workspaceWrite',
  writableRoots: [],
  networkAccess: false,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false,
}

type WorkspaceWritePolicy = Extract<SandboxPolicy, { type: 'workspaceWrite' }>

function sandboxPolicyOf(
  sandbox: 'workspace-write' | 'danger-full-access',
  baseline: WorkspaceWritePolicy | null,
  workRoots: readonly string[],
): SandboxPolicy {
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' }
  const policy = baseline ?? WORKSPACE_WRITE_UNSAID
  return { ...policy, writableRoots: [...new Set([...policy.writableRoots, ...workRoots])] }
}

function askBaselineOf(
  observed: WorkspaceWritePolicy | null,
  sent: ReadonlySet<string>,
  theThreadsOwn: ReadonlySet<string>,
): WorkspaceWritePolicy | null {
  if (observed === null) return null
  return {
    ...observed,
    writableRoots: observed.writableRoots.filter(
      (root) => !sent.has(root) || theThreadsOwn.has(root),
    ),
  }
}

function workRootsFor(
  approvalMode: ApprovalMode | undefined,
  folders: readonly string[],
): readonly string[] {
  return approvalProfileFor({ approvalMode }).sandbox === 'workspace-write' ? folders : []
}

export const CODEX_PLAN_TOOL_CONFIG = { 'tools.update_plan.enabled': true } as const

export const CODEX_QUESTION_TOOL_CONFIG = {
  'tools.experimental_request_user_input.enabled': false,
} as const

export const CODEX_TOOLS_TURNED_OFF: readonly string[] = ['request_user_input']

export const CODEX_TOOLS_LEFT_ON: readonly string[] = ['request_user_input_async']

function threadConfigOverlay(
  externalMcp: ExternalMcpReach | undefined,
  kept: readonly KeptToolApproval[],
  workRoots: readonly string[],
  managedPluginMcp: readonly ManagedPluginMcpServer[] = [],
): { [key in string]?: JsonValue } {
  const overlay: { [key in string]?: JsonValue } = {
    ...CODEX_PLAN_TOOL_CONFIG,
    ...CODEX_QUESTION_TOOL_CONFIG,
    ...(codexExternalMcpConfig(externalMcp, kept) ?? {}),
  }
  if (workRoots.length > 0) overlay['sandbox_workspace_write.writable_roots'] = [...workRoots]
  return withManagedPluginMcp(overlay, managedPluginMcp)
}

function threadStartParams(
  cwd: string,
  model: string | undefined,
  systemHint: string | undefined,
  approvalMode: ApprovalMode | undefined,
  dynamicTools: DynamicToolSpec[] | undefined,
  externalMcp: ExternalMcpReach | undefined,
  kept: readonly KeptToolApproval[] = [],
  workRoots: readonly string[],
  managedPluginMcp: readonly ManagedPluginMcpServer[] = [],
): ThreadStartParams {
  const params: ThreadStartParams = { cwd, ...approvalProfileFor({ approvalMode }) }
  if (model) params.model = model
  params.config = threadConfigOverlay(externalMcp, kept, workRoots, managedPluginMcp)
  if (dynamicTools) params.dynamicTools = dynamicTools
  if (systemHint) params.developerInstructions = systemHint
  return params
}

function phasesOf(sink: StartPhaseSink | undefined): StartPhaseSink {
  return (phase, detail) => {
    try {
      sink?.(phase, detail)
    } catch {}
  }
}

function sayingTheRelease(settled: () => void, phase: StartPhaseSink): () => void {
  let said = false
  return () => {
    if (!said) {
      said = true
      phase('boot-gate-released')
    }
    settled()
  }
}

function threadResumeParams(
  threadId: string,
  cwd: string,
  approvalMode: ApprovalMode | undefined,
  model: string | undefined,
  externalMcp: ExternalMcpReach | undefined,
  systemHint: string | undefined,
  kept: readonly KeptToolApproval[] = [],
  workRoots: readonly string[],
  managedPluginMcp: readonly ManagedPluginMcpServer[] = [],
): ThreadResumeParams {
  const params: ThreadResumeParams = {
    threadId,
    cwd,
    excludeTurns: true,
    ...approvalProfileFor({ approvalMode }),
    ...(model ? { model } : {}),
    ...(systemHint ? { developerInstructions: systemHint } : {}),
  }
  params.config = threadConfigOverlay(externalMcp, kept, workRoots, managedPluginMcp)
  return params
}

function reportedAgentInfo(model: string | undefined, effort: string | undefined): AgentInfo {
  return {
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort, reasoningEffortReported: true } : {}),
  }
}

function aFailedStart(error: unknown): unknown {
  if (error instanceof CodexExited) return new StartFailed(error.message, { cause: error })
  if (!(error instanceof CodexRequestRefused)) return error
  const { message } = (
    typeof error.refusal === 'object' && error.refusal !== null ? error.refusal : {}
  ) as { message?: unknown }
  return new StartRefused('codex', error.method, typeof message === 'string' ? message : null, {
    cause: error,
  })
}

function collaborationModeFor(
  phase: PlanPhase,
  intended: { model?: string; effort?: string },
): CollaborationMode | undefined {
  if (phase === 'never') return undefined
  if (intended.model === undefined || intended.model === '') return undefined
  return {
    mode: phase === 'planning' ? 'plan' : 'default',
    settings: {
      model: intended.model,
      reasoning_effort: intended.effort ?? null,
      developer_instructions: null,
    },
  }
}

type PlanPhase = 'never' | 'planning' | 'left'

function planPhaseOf(options: { planMode?: unknown; planModeEnded?: unknown }): PlanPhase {
  if (options.planMode !== true) return 'never'
  return options.planModeEnded === true ? 'left' : 'planning'
}

function turnStartParams(
  threadId: string,
  text: string | null,
  effort: ReasoningEffort | undefined,
  approvalMode: ApprovalMode,
  askBaseline: WorkspaceWritePolicy | null,
  workRoots: readonly string[],
  collaborationMode: CollaborationMode | undefined,
  model: string | undefined,
): TurnStartParams {
  const profile = approvalProfileFor({ approvalMode })
  return {
    threadId,
    approvalPolicy: profile.approvalPolicy,
    approvalsReviewer: profile.approvalsReviewer,
    sandboxPolicy: sandboxPolicyOf(profile.sandbox, askBaseline, workRoots),
    input: text === null ? [] : [{ type: 'text', text, text_elements: [] }],
    ...(effort ? { effort } : {}),
    ...(model !== undefined && model !== '' ? { model } : {}),
    ...(collaborationMode ? { collaborationMode } : {}),
    summary: REASONING_SUMMARY,
  }
}

const REASONING_SUMMARY: ReasoningSummary = 'detailed'

function turnInterruptParams(threadId: string, turnId: string): TurnInterruptParams {
  return { threadId, turnId }
}

function requestKey(id: string | number): string {
  return `${typeof id}:${id}`
}

function numericIdFromKey(key: string): number | null {
  if (!key.startsWith('number:')) return null
  const value = Number(key.slice('number:'.length))
  return Number.isFinite(value) ? value : null
}

function isTurnScopedContent(method: string): boolean {
  return TURN_SCOPED_METHODS.has(method)
}

const TURN_SCOPED_METHODS = new Set([
  'item/agentMessage/delta',
  'item/started',
  'item/completed',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'turn/plan/updated',
  'item/commandExecution/outputDelta',
  'thread/tokenUsage/updated',
  'item/fileChange/patchUpdated',
  'turn/diff/updated',
])

const THREAD_SUBJECT_METHODS = new Set(['thread/status/changed'])

const MAX_ATTRIBUTED_DROP_METHODS = 32

const OTHER_DROP_METHODS = '(other)'

const CLOSE_FLUSH_TIMEOUT_MS = 2000
const CLOSE_INTERRUPT_TIMEOUT_MS = 2000

const COMMANDS_END_WITHIN_MS = 1000

const TOOL_USES: ReadonlySet<string> = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'webSearch',
  'imageView',
  'imageGeneration',
])

const SUB_AGENT_USES: ReadonlySet<string> = new Set(['started', 'interacted'])

const RATE_LIMIT_READ = 'account/rateLimits/read'

const RATE_LIMIT_BASELINE_TIMEOUT_MS = 15_000

const COMMAND_LIST_TIMEOUT_MS = 15_000

const CHILD_READ_TIMEOUT_MS = 5_000

const CHILD_INPUT_TIMEOUT_MS = 15_000

export const A_COMPACTION_IS_STILL_OUTSTANDING =
  'You stopped the last compaction before Codex started it, and Codex may still run it, so this one ' +
  'was not asked for. Send a message: once it has finished, you can compact again.'

interface CodexTurn {
  readonly localId: number
  providerTurnId: string | null
  interruptPending: boolean
  interruptAsked: boolean
  readonly commands: Map<string, { movedOn: boolean }>
  endsAll: boolean
  commandsEnding: Promise<void>
  bindsAtItsStart?: true
}

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
  private sharedSkillsGeneration?: () => number
  private sharedSkillsLoaded?: number
  private skillsRefresh: { localId: CodexTurn['localId']; stop: () => void } | null = null
  private messageTurn: CodexTurn | null = null
  private messageCalls = new MessageActCalls()
  private completing: { readonly turn: CodexTurn; readonly done: Promise<void> } | null = null
  private lastBoundTurnId: string | null = null
  private compactionOutstanding = false
  private startNobodyClaimed: string | null = null
  private readonly inFlight = new Set<Promise<void>>()
  private readonly requestStates = new Map<string, RequestState>()
  private maxRetiredNumericId = -1
  private terminated = false
  private closing: Promise<void> | null = null

  private readonly _targetRef: SessionRef | null

  private readonly subAgents = new CodexSubAgents(() => this._ref?.sessionId)

  private readonly openSubAgents = new OpenSubAgents()

  private readonly patches = new PatchTargets()

  private readonly mcpCalls = new McpCallsInFlight()

  private readonly rateLimits = new RateLimitWatch()
  private launchedOnAKey = false
  private launchAccount: string | null | undefined = undefined
  private launchKeyTag: string | null = null
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

  private readonly workFoldersSent = new Set<string>()

  private theThreadsOwnRoots: ReadonlySet<string> = new Set()

  private readonly approvals: ApprovalModeSwitch

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
    return {
      model: { effective: this.models.effective, requested: this.models.requested },
      reasoningEffort: { effective: this.efforts.effective, requested: this.efforts.requested },
      planMode: {
        effective: this.plan.effective === 'planning',
        requested: this.plan.requested === 'planning',
      },
    }
  }

  setModel(model: string | undefined): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change the model: this session is no longer active'))
    }
    this.models.request(model)
    return Promise.resolve()
  }

  get workFolders(): {
    readonly effective: readonly string[]
    readonly requested: readonly string[]
  } {
    return { effective: this.folders.effective, requested: this.folders.requested }
  }

  setWorkFolders(folders: readonly string[]): void {
    this.folders.request([...folders])
  }

  setReasoningEffort(effort: ReasoningEffort | undefined): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change the effort: this session is no longer active'))
    }
    this.efforts.request(effort)
    return Promise.resolve()
  }

  setPlanMode(on: boolean): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change plan mode: this session is no longer active'))
    }
    const current = this.plan.requested
    const next: PlanPhase = on ? 'planning' : current === 'never' ? 'never' : 'left'
    if (next === current) {
      return Promise.reject(
        new Error(
          on
            ? 'cannot start plan mode: this session is already planning'
            : current === 'never'
              ? 'cannot stop planning: this session was not planning'
              : 'cannot stop planning: this session has already been given the go-ahead',
        ),
      )
    }
    this.plan.request(next)
    return Promise.resolve()
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

  private mergeAgentInfo(next: AgentInfo): void {
    const merged = { ...this._agentInfo, ...next }
    if (
      merged.model !== this._agentInfo?.model ||
      merged.reasoningEffort !== this._agentInfo?.reasoningEffort
    ) {
      this._agentInfo = merged
    }
  }

  private openTheThread(
    method: 'thread/start' | 'thread/resume',
    params: ThreadStartParams | ThreadResumeParams,
  ): Promise<unknown> {
    const effort = this.efforts.requested
    if (effort !== undefined) params.config = { ...params.config, model_reasoning_effort: effort }
    const config = params.config ?? {}
    const overrides = Object.entries(config).map(([key, value]) => {
      const shown =
        key === 'mcp_servers' && value !== null && typeof value === 'object'
          ? Object.keys(value)
          : value
      return `${key}=${JSON.stringify(shown)}`
    })
    const memoryKnown =
      this.memoryConfig?.outcome === 'written' || this.memoryConfig?.outcome === 'unchanged'
    const settings: LaunchSetting[] = [
      {
        key: 'memory',
        value: memoryKnown
          ? CODEX_MEMORY_SETTINGS.map((one) => `${one.table}.${one.key}=${one.value}`)
          : null,
      },
      { key: 'thread-overrides', value: overrides },
      { key: 'plan-tool', value: config['tools.update_plan.enabled'] === true },
      {
        key: 'approval-sandbox',
        value: [
          `approvalPolicy=${params.approvalPolicy}`,
          `approvalsReviewer=${params.approvalsReviewer}`,
          `sandbox=${params.sandbox}`,
        ],
      },
      { key: 'collaboration-mode', value: this.plan.requested === 'planning' ? 'plan' : 'default' },
      { key: 'approval', value: this.approvals.effective },
      {
        key: 'tools-off',
        value:
          config['tools.experimental_request_user_input.enabled'] === false
            ? [...CODEX_TOOLS_TURNED_OFF]
            : [],
      },
      { key: 'tools-left-on', value: [...CODEX_TOOLS_LEFT_ON] },
    ]
    this._launchSettings = Object.freeze(
      settings.map((one) =>
        Object.freeze({
          ...one,
          value: Array.isArray(one.value) ? Object.freeze(one.value) : one.value,
        }),
      ),
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
    assertCodexSqliteHomeContained(this.providerHome)
    this.startPhase('initialize-sent')
    const initResult = await this.transport.request('initialize', initializeParams())
    this.startPhase('initialized')
    bootSettled?.()
    this.validateProtocolVersion(initResult)
    this.validateCodexHome(initResult)
    this.transport.notify('initialized', {})
    await this.assertCredentialUsable()
    if (this.builtInSkills) {
      try {
        await this.beforeSkillDiscovery?.()
        await registerCodexBuiltInSkills(
          this.builtInSkills,
          this.cwd,
          (method, params) => this.transport.request(method, params),
          this.sharedSkillsRoot,
        )
      } catch (cause) {
        throw new Error(BUILT_IN_SKILLS_FAILURE, { cause })
      }
      this.startPhase('skills-registered')
    }
    const kept = keptToolApprovals(this.providerHome)
    for (const approval of kept) {
      const declared = this.externalMcp?.servers.some(
        (one) => one.name === approval.server && one.url === approval.url,
      )
      if (declared === true) this.mcpCalls.grant(approval.server, approval.tool)
    }
    const workRoots = this.sendingWorkFolders(this.approvals.effective, this.folders.effective)
    this.startPhase('thread-sent')
    const response =
      opening === 'started'
        ? await this.openTheThread(
            'thread/start',
            threadStartParams(
              this.cwd,
              model,
              systemHint,
              this.approvals.effective,
              codexDynamicToolsFor(this.agentTools),
              this.externalMcp,
              kept,
              workRoots,
              this.managedPluginMcp,
            ),
          )
        : await this.openTheThread(
            'thread/resume',
            threadResumeParams(
              this._targetRef!.sessionId,
              this.cwd,
              this.approvals.effective,
              model,
              this.externalMcp,
              systemHint,
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
    const bounded = boundInventory({
      naming: CODEX_TOOL_NAMING,
      declared:
        this.agentTools === undefined
          ? null
          : {
              server: this.agentTools.server,
              ...(this.agentTools.tools.length === 0
                ? {}
                : { instructions: CODEX_TOOLS_DESCRIPTION }),
              tools: this.agentTools.tools.map((one) => ({
                name: one.name,
                description: one.description,
                parameters: parametersOf(one.input),
              })),
            },
      published: null,
    })
    this.emit({
      type: 'tool_inventory',
      naming: bounded.naming,
      declared: bounded.declared,
      published: bounded.published,
      ...(bounded.dropped > 0 ? { dropped: bounded.dropped } : {}),
      source,
    })
  }

  private readRateLimitBaseline(): void {
    const askedAt = Date.now()
    void (async () => {
      let response: unknown
      try {
        response = await withDeadline(
          this.transport.request('account/rateLimits/read', undefined),
          RATE_LIMIT_BASELINE_TIMEOUT_MS,
          'account/rateLimits/read',
        )
      } catch (error) {
        this.emit(
          wrapUnknown(
            'codex',
            { method: RATE_LIMIT_READ, error: String(error) },
            'lifecycle',
            RATE_LIMIT_READ,
          ),
        )
        return
      }
      this.emit(
        wrapUnknown(
          'codex',
          { method: RATE_LIMIT_READ, result: response },
          'lifecycle',
          RATE_LIMIT_READ,
        ),
      )
      for (const line of this.rateLimits.seed(response, Date.now(), askedAt)) {
        this.emit({ type: 'error', message: line, fatal: false })
      }
      for (const bucket of this.rateLimits.heldReadings()) {
        const usage = rateLimitUsage(bucket)
        if (usage !== null) this.emit(usage)
      }
    })()
  }

  private readCommandList(why: string): void {
    void (async () => {
      let response: unknown
      try {
        response = await withDeadline(
          this.transport.request('skills/list', {}),
          COMMAND_LIST_TIMEOUT_MS,
          'skills/list',
        )
      } catch {
        return
      }
      const rows = Array.isArray(readField(response, 'data'))
        ? (readField(response, 'data') as unknown[])
        : []
      const sent = rows.flatMap((entry) => {
        const skills = readField(entry, 'skills')
        return Array.isArray(skills) ? skills : []
      })
      const { commands, dropped } = boundCommands(
        sent.filter((skill) => readField(skill, 'enabled') !== false).map(readCodexSkill),
      )
      this.emit({
        type: 'provider_commands',
        commands,
        prefix: CODEX_COMMAND_PREFIX,
        ...(dropped > 0 ? { dropped } : {}),
        source: why,
      })
    })()
  }

  signInTag(): string | null {
    const account = this.launchAccount
    if (account === 'api-key') return this.launchKeyTag
    return account === null || account === undefined ? null : `account:${account}`
  }

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

  noteLaunchAccount(
    account: string | null,
    copy: CodexCopyIdentity | null = null,
    keyTag: string | null = account === 'api-key' ? savedKeyTagIn(this.providerHome) : null,
  ): void {
    this.launchAccount = account
    this.launchCopy = copy
    this.launchKeyTag = keyTag
  }

  private async assertCredentialUsable(): Promise<void> {
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
    const problems = approvalProfileProblems(
      r['approvalsReviewer'],
      r['approvalPolicy'],
      sandboxTypeOf(r['sandbox']),
      this.approvals.effective,
    )
    if (problems.length > 0) {
      throw new StartFailed(
        `codex did not honor the prompting approval profile: ${problems.join('; ')}`,
      )
    }
  }

  private observeAskPolicy(value: unknown): void {
    const policy = askPolicyOf(value)
    if (policy === null) return
    this.observedAskPolicy = policy
    if (this.workFoldersSent.size === 0) this.theThreadsOwnRoots = new Set(policy.writableRoots)
  }

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
    const reported = codexVersionFromUserAgent(readString(response, 'userAgent'))
    if (reported === CODEX_PROTOCOL_VERSION) return
    throw new StartFailed(
      `Codex CLI ${reported ?? '(version not reported)'} ≠ vendored protocol ${CODEX_PROTOCOL_VERSION} — ` +
        'regenerate the types (pnpm run protocol:generate) or pin the CLI to the vendored version',
    )
  }

  private validateCodexHome(response: unknown): void {
    const reported = readString(response, 'codexHome')
    if (!reported) {
      throw new StartFailed(
        'codex initialize did not report a codexHome (required for home attestation)',
      )
    }
    if (canonicalPath(reported) !== canonicalPath(this.providerHome)) {
      throw new StartFailed(
        `codex did not adopt the profile home: expected ${this.providerHome}, got ${reported}`,
      )
    }
  }

  private validateHandshake(response: unknown, opening: 'started' | 'resumed'): SessionRef {
    const thread = isRecord(response) ? response['thread'] : undefined
    const responseCwd = readString(thread, 'cwd')
    const candidate = {
      provider: this.provider,
      sessionId: readString(thread, 'id'),
      cwd: opening === 'started' ? responseCwd || this.cwd : responseCwd,
      rotation: this.rotation,
    }
    const parsed = sessionRefSchema.safeParse(candidate)
    if (!parsed.success) {
      throw new StartFailed(
        `codex ${opening} returned an invalid thread ref (empty/missing id or cwd)`,
      )
    }
    if (opening === 'resumed' && this._targetRef) {
      if (
        candidate.sessionId !== this._targetRef.sessionId ||
        candidate.cwd !== this._targetRef.cwd
      ) {
        throw new StartFailed(
          `codex resume mismatch: expected ${this._targetRef.sessionId}@${this._targetRef.cwd}, ` +
            `got ${candidate.sessionId}@${candidate.cwd}`,
        )
      }
    }
    return parsed.data
  }

  private emit(event: RuntimeEvent): void {
    if (this.terminated) return
    this.coalescer.feed(event)
  }

  private readonly stallWatchdog = new StallWatchdog((idleMs, afterReasoning) =>
    this.reportStall(idleMs, afterReasoning),
  )

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

  private readonly foreignThreadDrops = new Map<string, number>()

  private frameScopeAdopted = 0

  private countForeignDrop(method: string): void {
    const key =
      this.foreignThreadDrops.has(method) ||
      this.foreignThreadDrops.size < MAX_ATTRIBUTED_DROP_METHODS
        ? method
        : OTHER_DROP_METHODS
    this.foreignThreadDrops.set(key, (this.foreignThreadDrops.get(key) ?? 0) + 1)
  }

  get frameScope(): {
    readonly seen: number
    readonly dropped: number
    readonly adopted: number
    readonly byMethod: Readonly<Record<string, number>>
  } {
    let dropped = 0
    const byMethod: Record<string, number> = {}
    for (const [method, count] of this.foreignThreadDrops) {
      dropped += count
      byMethod[method] = count
    }
    return { seen: this.notificationsSeen, dropped, adopted: this.frameScopeAdopted, byMethod }
  }

  private namesForeignThread(method: string, params: unknown): boolean {
    if (THREAD_SUBJECT_METHODS.has(method)) return false
    const ref = this._ref
    if (!ref) return false
    const threadId = readString(params, 'threadId')
    return threadId !== '' && threadId !== ref.sessionId
  }

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
      if (!this.isCurrentProviderTurn(startedId)) {
        const turn = this.currentTurn
        const ourStartIsUnanswered =
          turn !== null && turn.providerTurnId === null && turn.bindsAtItsStart !== true
        if (this.compactionOutstanding && startedId && ourStartIsUnanswered) {
          this.startNobodyClaimed = startedId
        } else if (this.compactionOutstanding && startedId) {
          this.stopTheStoppedCompaction(startedId)
        } else {
          this.compactionOutstanding = false
        }
      }
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
    if (event.type !== 'error' || !this.launchedOnAKey) return event
    if (event.cause === 'auth') return { ...event, onAKey: true }
    if (method === 'error' && codexErrorIsAUsageLimit(params)) {
      return { ...event, billingRefused: true, onAKey: true }
    }
    return event
  }

  private markTheAskedCompaction(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== 'compaction' || this.currentTurn?.bindsAtItsStart !== true) return event
    return { ...event, trigger: 'manual' }
  }

  private resolveImage(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== 'image') return event
    const threadId = this._ref?.sessionId
    const path = threadId
      ? resolveGeneratedImage({
          codexHome: this.providerHome,
          threadId,
          imageId: event.imageId,
          ...(event.path ? { savedPath: event.path } : {}),
        })
      : null
    return {
      type: 'image',
      imageId: event.imageId,
      ...(path ? { path } : {}),
      ...(event.prompt ? { prompt: event.prompt } : {}),
    }
  }

  private planSteps: PlanStep[] = []

  private restatePlan(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== 'plan_update') return event
    if (event.steps.length === 0 && event.body === undefined && !event.note) return event
    if (event.steps.length > 0 || event.body === undefined) {
      this.planSteps = event.steps.map((step) => ({ ...step }))
      return event
    }
    if (this.planSteps.length === 0) return event
    return { ...event, steps: this.planSteps.map((step) => ({ ...step })) }
  }

  private bindProviderTurn(providerTurnId: string): void {
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId !== null || !providerTurnId) return
    turn.providerTurnId = providerTurnId
    this.lastBoundTurnId = providerTurnId
    this.settleTheStartNobodyClaimed(providerTurnId)
    if (turn.interruptPending) {
      turn.interruptPending = false
      void this.sendInterruptRpc(providerTurnId)
    }
  }

  private settleTheStartNobodyClaimed(ours: string | null): void {
    const held = this.startNobodyClaimed
    if (held === null) return
    this.startNobodyClaimed = null
    if (held !== ours) this.stopTheStoppedCompaction(held)
  }

  private stopTheStoppedCompaction(startedId: string): void {
    void this.sendInterruptRpc(startedId)
    this.compactionOutstanding = false
  }

  private onTurnStartResult(localId: number, result: unknown): void {
    if (this.terminated) return
    if (this.currentTurn?.localId !== localId) {
      this.settleTheStartNobodyClaimed(null)
      return
    }
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

  private bindsACompactionAt(startedId: string): boolean {
    const turn = this.currentTurn
    return (
      turn?.bindsAtItsStart === true &&
      turn.providerTurnId === null &&
      startedId !== '' &&
      startedId !== this.lastBoundTurnId
    )
  }

  private isCurrentProviderTurn(turnId: string): boolean {
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId === null) return false
    return turnId === turn.providerTurnId
  }

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

  private scopeProblemFor(kind: ServerRequestKind, params: unknown): string | null {
    if (kind.kind !== 'elicitation') return this.serverRequestScopeProblem(params)
    if (!isRecord(params)) return 'malformed params'
    const ref = this._ref
    if (!ref) return 'no active session'
    const threadId = readString(params, 'threadId')
    if (!threadId) return 'missing threadId'
    if (threadId !== ref.sessionId) return `foreign thread ${threadId}`
    const rawTurn = params['turnId']
    if (rawTurn !== null && rawTurn !== undefined && typeof rawTurn !== 'string') {
      return 'malformed turnId'
    }
    const turnId = readString(params, 'turnId')
    if (!turnId) return null
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId === null) return 'no active turn'
    return turnId === turn.providerTurnId ? null : `stale turn ${turnId}`
  }

  private serverRequestScopeProblem(params: unknown): string | null {
    if (!isRecord(params)) return 'malformed params'
    const ref = this._ref
    if (!ref) return 'no active session'
    const threadId = readString(params, 'threadId')
    if (!threadId) return 'missing threadId'
    if (threadId !== ref.sessionId) return `foreign thread ${threadId}`
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId === null) return 'no active turn'
    const turnId = readString(params, 'turnId')
    if (!turnId) return 'missing turnId'
    if (turnId !== turn.providerTurnId) return `stale turn ${turnId}`
    return null
  }

  private phaseOf(id: string | number): 'unseen' | 'claimed' | 'spent' {
    const state = this.requestStates.get(requestKey(id))
    if (state) return state.phase
    return this.isRetiredRequestId(id) ? 'spent' : 'unseen'
  }

  private spendRequest(id: string | number, write?: () => void): boolean {
    if (this.phaseOf(id) === 'spent') return false
    this.requestStates.set(requestKey(id), { phase: 'spent' })
    write?.()
    return true
  }

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
    this.emit({
      type: 'permission_request',
      id: requestKey(id),
      kind: 'command',
      action: call.tool,
      ...boundPermissionDetail(`${call.tool} ${JSON.stringify(call.arguments)}`),
      scope: {
        cwd: this.cwd,
        paths: [],
        networkHosts: [],
        persistence: persistenceOf(['allow']),
        amendments: [],
        availableDecisions: publishedOffer(['allow']),
        underDisclosed: false,
        approvalMode: 'ask',
      },
    })
    this.machine.beginWait()
    const decision = await reservation.response
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      this.respondToProvider(id, safeRefusal({ kind: 'agentTool' }))
      return
    }
    this.machine.endWait()
    if (decision.outcome !== 'allow') {
      this.respondToProvider(id, {
        contentItems: [
          {
            type: 'inputText',
            text: `the person using this app declined the ${call.tool} call, so nothing was done`,
          },
        ],
        success: false,
      })
      if (decision.outcome === 'cancel') await this.askTheTurnToStop(readString(params, 'turnId'))
      return
    }
    this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))
  }

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

  private async handleApproval(
    id: string | number,
    kind: 'command' | 'file',
    params: unknown,
  ): Promise<void> {
    if (this.isShuttingDown) {
      this.respondToProvider(id, { decision: 'decline' })
      return
    }
    const targets = kind === 'file' ? this.patches.for(params) : []
    const action = kind === 'command' ? readString(params, 'command') || 'shell' : 'apply_patch'
    const detail = kind === 'command' ? readString(params, 'command') || kind : fileDetail(targets)
    const summary = kind === 'file' ? readOptionalString(params, 'reason') : undefined
    const agentReason =
      kind === 'command' && theModelWroteTheReason(params)
        ? wordsForACard(isRecord(params) ? params['reason'] : undefined)
        : null
    const policysWords = thePolicysWords(params)
    const { scope, allowed, alwaysAnswer } =
      kind === 'command'
        ? commandScope(params)
        : { ...fileScope(params, targets), alwaysAnswer: undefined }
    if (scope.grants?.allow_always !== undefined) {
      scope.grants.alwaysFile = join(this.providerHome, CODEX_EXEC_POLICY_RULES)
    }
    const reservation = this.permissions.reserve(requestKey(id))
    if (!reservation.accepted) {
      this.respondToProvider(id, { decision: 'decline' })
      return
    }
    const claimed = this.requestStates.get(requestKey(id))
    if (claimed?.phase === 'claimed') {
      claimed.allowed = allowed
      if (alwaysAnswer !== undefined) claimed.alwaysAnswer = alwaysAnswer
    }
    this.emit({
      type: 'permission_request',
      id: requestKey(id),
      kind,
      action,
      ...boundPermissionDetail(detail),
      ...(summary ? { summary } : {}),
      ...(agentReason === null ? {} : { agentReason }),
      ...(policysWords === null
        ? {}
        : { providerReason: policysWords, providerReasonFrom: 'a-policy-rule' as const }),
      scope: {
        ...scope,
        approvalMode: isAutoApprove({ approvalMode: this.approvals.effective }) ? 'auto' : 'ask',
      },
    })
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
    if (!isPermission && codexQuestions(params).length === 0) {
      this.respondToProvider(id, userInputDecline(false))
      return
    }
    if (!isPermission && duplicateAnswerKey(codexQuestions(params), (q) => q.id) !== null) {
      this.respondToProvider(id, userInputDecline(false))
      return
    }
    if (!isPermission && hasUndeliverableQuestionId(params)) {
      this.respondToProvider(id, userInputDecline(false))
      return
    }
    if (!isPermission && unanswerableOptionLabel(codexQuestions(params)) !== null) {
      this.respondToProvider(id, userInputDecline(false))
      return
    }
    const prompt = isPermission ? THE_AGENT_ASKS_FOR_ACCESS : questionText(params) || method
    const reservation = this.userInputs.reserve(requestKey(id))
    if (!reservation.accepted) {
      this.respondToProvider(id, userInputDecline(isPermission))
      return
    }
    const claimed = this.requestStates.get(requestKey(id))
    if (claimed?.phase === 'claimed') {
      claimed.userInputPayload = (response) => userInputPayloadFor(isPermission, params, response)
    }
    this.emit(
      isPermission
        ? {
            type: 'user_input_request',
            id: requestKey(id),
            prompt,
            questions: [],
            permission: codexUserPermission(params),
          }
        : {
            type: 'user_input_request',
            id: requestKey(id),
            prompt,
            questions: codexQuestions(params),
            ...(isRecord(params) && typeof params['isBlocking'] === 'boolean'
              ? { isBlocking: params['isBlocking'] }
              : {}),
          },
    )
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
    const cancelStopsNothing = { cancelStopsNothing: true as const }
    if (askable && claimed?.phase === 'claimed') {
      claimed.userInputPayload = (response): ForwardedUserInput => {
        if (response.kind !== 'answer') {
          return { payload: { action: 'decline', content: null, _meta: null } }
        }
        const forward = answerToForward(elicitationQuestions(elicitation), response.answers)
        if (!forward.forwardable) return { refusal: forward.why }
        const built = elicitationContent(elicitation, forward.values)
        if ('refusal' in built) return { refusal: built.refusal }
        return { payload: { action: 'accept', content: built.content, _meta: null } }
      }
    }
    const approvalMode = isAutoApprove({ approvalMode: this.approvals.effective }) ? 'auto' : 'ask'
    this.emit(
      askable
        ? {
            type: 'user_input_request',
            id: requestKey(id),
            prompt: externalMcpElicitationPrompt(elicitation),
            questions: elicitationQuestions(elicitation),
            mcpServerAsks: serverAsks(elicitation),
          }
        : toolApproval !== null
          ? {
              ...aToolApprovalCard(requestKey(id), toolApproval, approvalMode, this.providerHome),
              ...cancelStopsNothing,
            }
          : {
              type: 'permission_request',
              id: requestKey(id),
              kind: 'command',
              action: elicitation.serverName,
              ...boundPermissionDetail(externalMcpElicitationPrompt(elicitation)),
              ...cancelStopsNothing,
              mcpServerAsks: serverAsks(elicitation),
              scope: {
                paths: [],
                networkHosts: [],
                persistence: persistenceOf(offer),
                amendments: [],
                availableDecisions: offer,
                ...(confirmsAServersForm || showsALink
                  ? {}
                  : { noPositiveBecause: 'could-not-represent-the-answers' as const }),
                underDisclosed: true,
                approvalMode,
              },
            },
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

  carryOn(): Promise<void> {
    return this.startATurn(null)
  }

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
    this.currentTurn = {
      localId,
      providerTurnId: null,
      interruptPending: false,
      interruptAsked: false,
      commands: new Map(),
      endsAll: false,
      commandsEnding: Promise.resolve(),
    }
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
      const request = this.sharedSkillsMoved()
        ? this.refreshSharedSkills(localId).then(() => {
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
            this.settleTheStartNobodyClaimed(null)
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

  noteSharedSkillsGeneration(generation: (() => number) | undefined): void {
    this.sharedSkillsGeneration = generation
    this.sharedSkillsLoaded = generation?.()
  }

  private sharedSkillsMoved(): boolean {
    if (!this.sharedSkillsRoot) return false
    if (this.sharedSkillsGeneration === undefined) return true
    return this.sharedSkillsGeneration() !== this.sharedSkillsLoaded
  }

  private async refreshSharedSkills(localId: CodexTurn['localId']): Promise<void> {
    const seen = this.sharedSkillsGeneration?.()
    let stop!: () => void
    const stopped = new Promise<'stopped'>((resolve) => {
      stop = () => resolve('stopped')
    })
    const refresh = { localId, stop }
    this.skillsRefresh = refresh
    try {
      const answered = await Promise.race([
        Promise.resolve()
          .then(() => this.beforeSkillDiscovery?.())
          .then(() =>
            this.transport.request('skills/list', { cwds: [this.cwd], forceReload: true }),
          )
          .then(
            () => 'answered' as const,
            (error: unknown) => error,
          ),
        stopped,
      ])
      if (answered === 'stopped') throw new Error('turn interrupted')
      if (answered === 'answered') {
        this.sharedSkillsLoaded = seen
        return
      }
      if (this.currentTurn?.localId === localId) {
        this.emit({
          type: 'error',
          fatal: false,
          message: `Shared skills could not be refreshed: ${errorMessage(answered)}`,
        })
      }
    } finally {
      if (this.skillsRefresh === refresh) this.skillsRefresh = null
    }
  }

  private cancelSkillsRefresh(): void {
    const refresh = this.skillsRefresh
    this.skillsRefresh = null
    refresh?.stop()
  }

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
      () => undefined,
      (error: unknown) => {
        if (this.currentTurn?.localId !== turn) return
        this.currentTurn = null
        this.machine.failTurn(`thread/compact/start failed: ${errorMessage(error)}`)
      },
    )
  }

  async respondPermission(id: string, decision: PermissionDecision): Promise<void> {
    const state = this.requestStates.get(id)
    if (state?.phase !== 'claimed') {
      throw new AnswerRefused(
        'not-pending',
        `permission request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }
    const allowed = state.allowed
    const isSafeNegative = isAlwaysHonoured(decision.outcome)
    if (allowed && !isSafeNegative && !allowed.has(decision.outcome)) {
      throw new AnswerRefused(
        'not-offered',
        `decision '${decision.outcome}' is not offered by request ${id} (available: ${[...allowed].join(', ')})`,
      )
    }
    const sendsAlways =
      state.alwaysAnswer !== undefined ||
      (state.kind.kind === 'elicitation' && allowed?.has('allow_always') === true)
    if (decision.outcome === 'allow_always' && !sendsAlways) {
      throw new AnswerRefused(
        'not-offered',
        `decision 'allow_always' is not offered by request ${id}: it carries no answer that keeps a grant`,
      )
    }
    if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {
      this.machine.requestInterrupt()
    }
    if (state.kind.kind === 'agentTool') {
      this.permissions.respond(id, decision)
      return
    }
    if (state.approvesATool !== undefined && decision.outcome === 'allow_always') {
      const { serverName, tool } = state.approvesATool
      try {
        const url = this.externalMcp?.servers.find((one) => one.name === serverName)?.url
        if (url === undefined) throw new Error('this conversation declared no such server')
        keepToolApproval(this.providerHome, { server: serverName, url, tool })
      } catch (error) {
        throw new AnswerRefused(
          'not-kept',
          `could not keep "always" for ${serverName}/${tool} in ${keptToolApprovalsFile(this.providerHome)}: ${errorMessage(error)}`,
        )
      }
    }
    const answer =
      state.kind.kind === 'elicitation'
        ? elicitationAnswer(
            decision,
            state.approvesATool,
            state.confirmsAServersForm === true,
            state.showsALink === true,
          )
        : decision.outcome === 'allow_always' && state.alwaysAnswer !== undefined
          ? { decision: state.alwaysAnswer as CommandExecutionApprovalDecision }
          : { decision: codexDecision(decision) }
    this.spendRequest(state.rawId, () => this.transport.respond(state.rawId, answer))
    if (state.approvesATool !== undefined && decision.outcome === A_TOOLS_SESSION_GRANT) {
      this.mcpCalls.grant(state.approvesATool.serverName, state.approvesATool.tool)
    }
    if (state.approvesATool !== undefined && decision.outcome === 'allow_always') {
      this.mcpCalls.grant(state.approvesATool.serverName, state.approvesATool.tool)
    }
    this.permissions.respond(id, decision)
  }

  async respondUserInput(id: string, response: UserInputResponse): Promise<void> {
    const state = this.requestStates.get(id)
    if (state?.phase !== 'claimed' || !state.userInputPayload) {
      throw new AnswerRefused(
        'not-pending',
        `user-input request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }
    const forwarded = state.userInputPayload(response)
    if ('refusal' in forwarded) {
      throw new AnswerRefused(
        'not-usable',
        `user-input request ${id} cannot be forwarded to the provider (${forwarded.refusal})`,
      )
    }
    this.spendRequest(state.rawId, () => this.transport.respond(state.rawId, forwarded.payload))
    this.userInputs.respond(id, response)
  }

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
    if (this.skillsRefresh && this.skillsRefresh.localId === this.currentTurn?.localId) {
      this.cancelSkillsRefresh()
      this.currentTurn = null
      this.machine.forceEnd(false)
      return
    }
    if (!this.currentTurn) {
      this.machine.forceEnd(false)
      return
    }
    if (this.currentTurn.bindsAtItsStart && this.currentTurn.providerTurnId === null) {
      this.currentTurn = null
      this.compactionOutstanding = true
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
    } catch {}
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

  private noteWhatTheTurnMovedOnTo(method: string, params: unknown): void {
    if (method !== 'item/started' || this.currentTurn === null) return
    const item = isRecord(params) ? params['item'] : undefined
    const type = readString(item, 'type')
    const toASubAgent = type === 'subAgentActivity' && SUB_AGENT_USES.has(readString(item, 'kind'))
    if (!TOOL_USES.has(type) && !toASubAgent) return
    for (const command of this.currentTurn.commands.values()) command.movedOn = true
  }

  async stopBackgroundWork(id: string): Promise<boolean> {
    if (this.isShuttingDown) return false
    return await this.backgroundTerminals.terminate(id)
  }

  private noteCommandOutput(params: unknown): void {
    this.commandTails.write(readString(params, 'itemId'), readString(params, 'delta'))
  }

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

  async childState(childId: string): Promise<ChildThreadState> {
    if (this.terminated || this.machine.isTerminal || !this._ref) return CHILD_STATE_UNKNOWN
    const response = await withDeadline(
      Promise.resolve(
        this.transport.request('thread/read', { threadId: childId } satisfies ThreadReadParams),
      ),
      CHILD_READ_TIMEOUT_MS,
      'codex thread/read',
    )
    const thread = readField(response, 'thread')
    if (!isRecord(thread)) return CHILD_STATE_UNKNOWN
    const accepts = readField(thread, 'canAcceptDirectInput')
    const turns = readField(thread, 'turns')
    return {
      status: childStatusOf(readString(readField(thread, 'status'), 'type')),
      acceptsInput: typeof accepts === 'boolean' ? accepts : null,
      nickname: readOptionalString(thread, 'agentNickname') ?? null,
      turns: Array.isArray(turns) ? turns.length : null,
    }
  }

  async childInput(childId: string, text: string): Promise<ChildInputOutcome> {
    const state = await this.childState(childId)
    const refusal = childInputRefusal(state)
    if (refusal !== null) return { ok: false, reason: refusal, state }
    const result = await withDeadline(
      Promise.resolve(
        this.transport.request('turn/start', {
          threadId: childId,
          input: [{ type: 'text', text, text_elements: [] }],
        } as TurnStartParams),
      ),
      CHILD_INPUT_TIMEOUT_MS,
      'codex turn/start (child)',
    )
    return { ok: true, turnId: readOptionalString(readField(result, 'turn'), 'id') ?? null }
  }

  refreshBackgroundWork(): void {
    this.backgroundTerminals.refresh()
  }

  close(): Promise<void> {
    return (this.closing ??= this.doClose())
  }

  private async doClose(): Promise<void> {
    this.cancelManagedPluginWait()
    this.cancelSkillsRefresh()
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

function questionText(params: unknown): string {
  if (!isRecord(params)) return ''
  const questions = params['questions']
  if (Array.isArray(questions) && questions.length > 0) {
    const first: unknown = questions[0]
    if (isRecord(first) && typeof first['question'] === 'string') return first['question']
  }
  return ''
}

export class CodexRuntime implements AgentRuntime {
  readonly provider = 'codex' as const
  readonly canRecreateMissingUnusedSession = true
  private readonly transportFactory: TransportFactory
  private readonly authHealth: ((providerHome: string) => AuthHealth) | undefined

  constructor(
    transportFactory: TransportFactory = defaultTransport,
    authHealth?: (providerHome: string) => AuthHealth,
  ) {
    this.transportFactory = transportFactory
    this.authHealth = authHealth
  }

  private assertAuthHealthy(providerHome: string): void {
    if (!this.authHealth) return
    const health = this.authHealth(providerHome)
    if (!health.ok) {
      throw new AuthUnavailableError(
        'codex',
        health.reason ?? 'managed Codex credential unavailable',
      )
    }
  }

  private assertLaunchPreconditions(providerHome: string): void {
    this.assertAuthHealthy(providerHome)
    assertCodexSqliteHomeContained(providerHome)
  }

  async start(opts: StartOptions): Promise<SessionHandle> {
    assertNotCancelled(opts.signal, 'codex start')
    removeStaleCodexPermissionConfig(opts.providerHome)
    const memoryConfig = ensureCodexMemoryConfig(opts.providerHome)
    this.assertLaunchPreconditions(opts.providerHome)
    const phase = phasesOf(opts.startPhases)
    phase('boot-gate-entered')
    const bootSettled = sayingTheRelease(
      await beginCodexHomeBoot(opts.providerHome, { signal: opts.signal }),
      phase,
    )
    phase('boot-gate-passed')
    const launchAccount = codexAccountInNow(opts.providerHome)
    const launchCopy = codexCopyIdentityIn(opts.providerHome)
    const launchKeyTag = launchAccount === 'api-key' ? savedKeyTagIn(opts.providerHome) : null
    let transport: CodexTransport
    try {
      transport = this.transportFactory({ cwd: opts.cwd, providerHome: opts.providerHome })
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
    )
    handle.noteLaunchAccount(launchAccount, launchCopy, launchKeyTag)
    handle.noteStartPhases(phase)
    handle.noteSharedSkillsGeneration(opts.sharedSkillsGeneration)
    try {
      opts.onSessionCreated?.(handle)
      await handle.begin('started', opts.model, opts.systemHint, bootSettled)
      if (cancel.cancelled) throw new Error('codex start was cancelled')
    } catch (error) {
      await transport.close()
      throw aFailedStart(error)
    } finally {
      bootSettled()
      cancel.release()
    }
    return handle
  }

  async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    assertNotCancelled(context.signal, 'codex model list')
    this.assertLaunchPreconditions(context.providerHome)
    const bootSettled = await beginCodexHomeBoot(context.providerHome, { signal: context.signal })
    let transport: CodexTransport
    try {
      transport = this.transportFactory({
        cwd: context.providerHome,
        providerHome: context.providerHome,
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
      bootSettled()
      transport.notify('initialized', {})
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
      bootSettled()
      cancel.release()
      await transport.close()
    }
  }

  async resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle> {
    if (ref.provider !== 'codex') {
      throw new ResumeError(ref, `wrong provider: expected codex, got ${ref.provider}`)
    }
    let bootSettled: () => void
    let transport: CodexTransport
    let launchAccount: string | null
    let launchCopy: CodexCopyIdentity | null
    let launchKeyTag: string | null
    let memoryConfig: CodexMemoryConfigResult
    const phase = phasesOf(options.startPhases)
    try {
      assertNotCancelled(options.signal, 'codex resume')
      removeStaleCodexPermissionConfig(options.providerHome)
      memoryConfig = ensureCodexMemoryConfig(options.providerHome)
      this.assertLaunchPreconditions(options.providerHome)
      phase('boot-gate-entered')
      const settled = sayingTheRelease(
        await beginCodexHomeBoot(options.providerHome, { signal: options.signal }),
        phase,
      )
      phase('boot-gate-passed')
      bootSettled = settled
      launchAccount = codexAccountInNow(options.providerHome)
      launchCopy = codexCopyIdentityIn(options.providerHome)
      launchKeyTag = launchAccount === 'api-key' ? savedKeyTagIn(options.providerHome) : null
      try {
        transport = this.transportFactory({ cwd: ref.cwd, providerHome: options.providerHome })
      } catch (error) {
        settled()
        throw error
      }
      phase('spawned')
    } catch (error) {
      if (error instanceof ResumeError || error instanceof AuthUnavailableError) throw error
      throw new ResumeError(ref, `resume setup failed: ${errorMessage(error)}`, { cause: error })
    }
    const cancel = cancelWith(options.signal, () => transport.close())
    const handle = new CodexSessionHandle(
      transport,
      ref.cwd,
      ref.rotation,
      options.providerHome,
      ref,
      options.approvalMode,
      resolveReasoningEffort(options),
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
    )
    handle.noteLaunchAccount(launchAccount, launchCopy, launchKeyTag)
    handle.noteStartPhases(phase)
    handle.noteSharedSkillsGeneration(options.sharedSkillsGeneration)
    try {
      options.onSessionCreated?.(handle)
      await handle.begin('resumed', options.model, options.systemHint, bootSettled)
      if (cancel.cancelled) throw new Error('codex resume was cancelled')
      handle.refreshBackgroundWork()
    } catch (error) {
      await transport.close()
      if (error instanceof AuthUnavailableError) throw error
      const noSuchSession = codexNoLongerHasTheThread(error, ref.sessionId, options.providerHome)
      throw new ResumeError(ref, `resume failed: ${errorMessage(error)}`, {
        cause: noSuchSession ? error : aFailedStart(error),
        noSuchSession,
      })
    } finally {
      bootSettled()
      cancel.release()
    }
    return handle
  }
}

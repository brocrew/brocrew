import { codexElicitation, elicitationQuestions, elicitationContent } from '../external-mcp'
import type { SessionRef } from '../../session-ref'
import { AnswerRefused } from '../../answer-refused'
import { isRecord, readString, readOptionalString } from './wire-values'
import { toolApprovalCall } from './tool-approval-details'

import { codexToolApprovalDetail, codexToolGrant, type ClaimedToolApproval } from '../external-mcp'
import { keptToolApprovalsFile } from '../kept-tool-approvals'

import { boundPermissionDetail, type RuntimeEvent } from '../../events'
import { wordsForACard } from '../../words-on-a-card'
import {
  answerToForward,
  isAlwaysHonoured,
  persistenceOf,
  publishedOffer,
  type GrantRule,
  type PermissionAmendment,
  type PermissionDecision,
  type PermissionGrants,
  type PermissionOutcome,
  type PermissionScope,
  type UserInputPermission,
  type UserInputQuestion,
  type UserInputResponse,
} from '../../permission'

import { patchTargetLabel, type PatchTarget } from '../patch-targets'

import type { CodexToolCall } from '../agent-tools'

import type { AdditionalFileSystemPermissions } from '../protocol/v2/AdditionalFileSystemPermissions'
import type { CommandExecutionApprovalDecision } from '../protocol/v2/CommandExecutionApprovalDecision'
import type { FileSystemSandboxEntry } from '../protocol/v2/FileSystemSandboxEntry'
import type { GrantedPermissionProfile } from '../protocol/v2/GrantedPermissionProfile'
import type { McpServerElicitationRequestResponse } from '../protocol/v2/McpServerElicitationRequestResponse'
import type { PermissionsRequestApprovalResponse } from '../protocol/v2/PermissionsRequestApprovalResponse'

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

// Only representable native outcomes become positives; the offered prefix amendment means always allow.
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

// Echo only the exact offered amendment object, never a look-alike or the separate proposed rule.
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

// A grant that cannot be faithfully displayed must not acquire a positive outcome.
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

// A deny entry restricts access; label it as a restriction rather than as an opened grant.
function fsEntryLabel(entry: unknown): string {
  if (!isRecord(entry)) return ''
  const access = entry['access']
  if (access !== 'read' && access !== 'write' && access !== 'deny') return ''
  const target = fsPathLabel(entry['path'])
  if (!target) return ''
  return `${access === 'deny' ? 'restrict' : access} ${target}`
}

// Support legacy read/write lists and tagged entries. Unknown fields or undisplayable paths are not faithful.
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

// The neutral network flag can represent enabled only; unknown network fields remain undisclosed.
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

// A command is fully disclosed only when all extra fields have known meaning for its card.
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

// Parsed command paths are best-effort hints, not proof of the command's entire effect.
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

// An explicit empty decision list offers no positives; only an absent list permits the standard set.
// Derive both the published offer and its no-positive reason from the same allowed set.
export function commandScope(params: unknown): {
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

// Use one classification for scope checking and dispatch. Dynamic tool approval belongs to this app.
export type ServerRequestKind =
  | { kind: 'approval'; approval: 'command' | 'file' }
  | { kind: 'userInput'; isPermission: boolean }
  | { kind: 'agentTool' }
  | { kind: 'elicitation' }
  | { kind: 'unsupported' }

export function serverRequestKind(method: string): ServerRequestKind {
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

// Use each supported method's documented negative payload, not a JSON-RPC error that strands the request.
export function safeRefusal(kind: Exclude<ServerRequestKind, { kind: 'unsupported' }>): unknown {
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

// Codex session persistence covers the same tool with different parameters, not only this call.
export const A_TOOLS_SESSION_GRANT: PermissionOutcome = 'allow_all_for_session'

// Offer persistence only when Codex explicitly offered that persistence scope.
export function aToolApprovalsPositives(approval: ClaimedToolApproval): PermissionOutcome[] {
  return [
    'allow',
    ...(approval.offersSession ? [A_TOOLS_SESSION_GRANT] : []),
    ...(approval.offersAlways ? (['allow_always'] as const) : []),
  ]
}

// Describe the claimed tool and its actual parameters, with the standing rule that each positive grants.
export function aToolApprovalCard(
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
    mcpToolCall: toolApprovalCall(approval, tool),
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

// An always grant names its home file; a session grant names the tool it covers.
function aToolApprovalsGrants(
  approval: ClaimedToolApproval,
  tool: string,
  offer: readonly PermissionOutcome[],
  providerHome: string | undefined,
): PermissionGrants | undefined {
  const rule: GrantRule = { ...codexToolGrant(approval.serverName, approval.tool), tool }
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

// MCP answers use action/content/_meta rather than an approval decision. Cancel answers the request only.
export function elicitationAnswer(
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

export function codexToolCall(params: unknown): CodexToolCall | null {
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

// An unusable answer is a refusal to its caller, not the provider payload for a person declining.
export type ForwardedUserInput = { readonly payload: unknown } | { readonly refusal: string }

// Share answer validation between synchronous responses and handler fallbacks so they cannot disagree.
export function userInputPayloadFor(
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

// Keep the raw id, offered outcomes and response builder with the claimed id for synchronous spending.
export type RequestState =
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

// Permission decline grants nothing this turn; question decline returns no answers.
export function userInputDecline(isPermission: boolean): Record<string, unknown> {
  return isPermission
    ? ({ permissions: {}, scope: 'turn' } satisfies PermissionsRequestApprovalResponse)
    : { answers: {} }
}

function grantedPaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const paths = value.filter((p): p is string => typeof p === 'string' && p.length > 0)
  return paths.length > 0 ? paths : null
}

// Only tagged paths the card can display may be returned as granted entries.
function grantedEntry(entry: unknown): FileSystemSandboxEntry | null {
  if (!isRecord(entry)) return null
  const access = entry['access']
  if (access !== 'read' && access !== 'write' && access !== 'deny') return null
  const path = entry['path']
  if (!isRecord(path) || !fsPathLabel(path)) return null
  return { path: path as FileSystemSandboxEntry['path'], access }
}

// Omit null top-level sections; reconstruct nullable inner read/write lists in the native grant shape.
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

// Use a null-prototype map: provider ids such as __proto__ must remain ordinary answer keys.
// Return only the provider's own nonempty ids, preserving answer order and bytes.
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

// The same truthiness test as codexAnswers catches positional display ids that cannot return on the wire.
export function hasUndeliverableQuestionId(params: unknown): boolean {
  const questions =
    isRecord(params) && Array.isArray(params['questions']) ? params['questions'] : []
  return questions.some((q) => !(isRecord(q) && readString(q, 'id')))
}

// Codex questions are single-select despite their array-shaped answers. Preserve labels and metadata.
// Positional ids support display only; the session refuses missing raw ids before publishing a card.
export function codexQuestions(params: unknown): UserInputQuestion[] {
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

export function codexUserPermission(params: unknown): UserInputPermission {
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

// Attribute a reason to the model only on the measured escalation shape with an offered prefix rule.
export function theModelWroteTheReason(params: unknown): boolean {
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

// Attribute only the rule-bearing sentence for this exact raw command with escalation fields absent.
// A model command copying that sentence is indistinguishable at this protocol version.
export function thePolicysWords(params: unknown): string | null {
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

// Correlate file paths from item notifications; the approval has no changed-file list of its own.
export function fileScope(
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

// Name missing patch targets at decision time rather than substituting an uninformative file label.
export function fileDetail(targets: readonly PatchTarget[]): string {
  if (targets.length === 0) {
    return (
      'file change — the provider did not name the files this patch touches; ' +
      'they appear in Changes once it has run'
    )
  }
  return targets.map(patchTargetLabel).join('\n')
}

// Always allow is the exact offered amendment object, handled before this ordinary decision mapping.
export function codexDecision(decision: PermissionDecision): CommandExecutionApprovalDecision {
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

export function questionText(params: unknown): string {
  if (!isRecord(params)) return ''
  const questions = params['questions']
  if (Array.isArray(questions) && questions.length > 0) {
    const first: unknown = questions[0]
    if (isRecord(first) && typeof first['question'] === 'string') return first['question']
  }
  return ''
}

// Invalid answers leave the original request pending. Refusals remain usable when no positive is representable.
export function permissionAnswerState(
  state: RequestState | undefined,
  id: string,
  decision: PermissionDecision,
) {
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
  return state
}

// Both actionable request kinds must name the active thread before their differing turn checks.
function threadScopeProblem(
  params: Record<string, unknown>,
  ref: SessionRef | null,
): string | null {
  if (!ref) return 'no active session'
  const threadId = readString(params, 'threadId')
  if (!threadId) return 'missing threadId'
  if (threadId !== ref.sessionId) return `foreign thread ${threadId}`
  return null
}

// Standalone elicitation needs this thread; a supplied turn id must be well-formed and current.
export function elicitationScopeProblem(
  params: unknown,
  ref: SessionRef | null,
  turn: { providerTurnId: string | null } | null,
): string | null {
  if (!isRecord(params)) return 'malformed params'
  const threadProblem = threadScopeProblem(params, ref)
  if (threadProblem !== null) return threadProblem
  const rawTurn = params['turnId']
  if (rawTurn !== null && rawTurn !== undefined && typeof rawTurn !== 'string') {
    return 'malformed turnId'
  }
  const turnId = readString(params, 'turnId')
  if (!turnId) return null
  if (!turn || turn.providerTurnId === null) return 'no active turn'
  return turnId === turn.providerTurnId ? null : `stale turn ${turnId}`
}

// Other actionable requests require both this thread and a provider-bound current turn.
export function requestScopeProblem(
  params: unknown,
  ref: SessionRef | null,
  turn: { providerTurnId: string | null } | null,
): string | null {
  if (!isRecord(params)) return 'malformed params'
  const threadProblem = threadScopeProblem(params, ref)
  if (threadProblem !== null) return threadProblem
  if (!turn || turn.providerTurnId === null) return 'no active turn'
  const turnId = readString(params, 'turnId')
  if (!turnId) return 'missing turnId'
  if (turnId !== turn.providerTurnId) return `stale turn ${turnId}`
  return null
}

export function elicitationPayloadFor(
  elicitation: NonNullable<ReturnType<typeof codexElicitation>>,
  response: UserInputResponse,
): ForwardedUserInput {
  if (response.kind !== 'answer') {
    return { payload: { action: 'decline', content: null, _meta: null } }
  }
  const forward = answerToForward(elicitationQuestions(elicitation), response.answers)
  if (!forward.forwardable) return { refusal: forward.why }
  const built = elicitationContent(elicitation, forward.values)
  if ('refusal' in built) return { refusal: built.refusal }
  return { payload: { action: 'accept', content: built.content, _meta: null } }
}

export function declinedToolCall(tool: string) {
  return {
    contentItems: [
      {
        type: 'inputText',
        text: `the person using this app declined the ${tool} call, so nothing was done`,
      },
    ],
    success: false,
  }
}

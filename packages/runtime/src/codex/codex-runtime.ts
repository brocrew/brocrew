import { BUILT_IN_SKILLS_FAILURE, registerCodexBuiltInSkills } from '../built-in-skills'
import type { BuiltInSkillsContext, StartPhaseSink } from '../runtime'
import { realpathSync } from 'node:fs'
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
import { AsyncQueue } from '../internal/async-queue'
import {
  AuthUnavailableError,
  assertCodexSqliteHomeContained,
  codexAccountIn,
  codexAccountInNow,
  signInTagOf,
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
import { isReasoning, StallWatchdog, stallNotice } from '../internal/stall-watchdog'
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

/** Per-launch context passed to a {@link TransportFactory} so the spawn gets the profile home (021). */
export interface CodexLaunchContext {
  /** Working directory for the session (also the app-server child's cwd). */
  cwd: string
  /** Absolute, app-owned per-profile provider home → `CODEX_HOME`/`CODEX_SQLITE_HOME`. */
  providerHome: string
}

/**
 * How to obtain a transport — the real spawn by default; a fake in tests. The
 * `context` carries the profile home so the real transport can pin `CODEX_HOME`
 * (021). A zero-arg test factory stays assignable (fewer params is fine).
 */
export type TransportFactory = (context: CodexLaunchContext) => CodexTransport

/**
 * The app-server command line, the same for every launch. It carries no `--config` override, so
 * this app leaves Codex's own agents at the provider's setting for every conversation.
 *
 * Exported for focused unit coverage; callers should construct transports through
 * {@link createSpawnTransportFactory}.
 */
export function codexAppServerArgs(): string[] {
  return ['app-server']
}

/**
 * The real spawn, with the `codex` executable a parameter (014). The library default stays the
 * bare command for back-compat, but a bare command is a PATH lookup — an app launched from
 * Finder inherits launchd's minimal PATH and has no `codex` on it — so the desktop app passes
 * the absolute path of the binary it ships instead. Which binary to run is the caller's
 * knowledge; how to run it (sanitized env, pinned homes) stays here.
 */
export function createSpawnTransportFactory(command = 'codex'): TransportFactory {
  return (context: CodexLaunchContext): CodexTransport => {
    // Per-profile isolation (021, from 015): pin CODEX_HOME + CODEX_SQLITE_HOME to
    // the app-owned home and strip auth/redirector vars — the child gets a sanitized
    // env, global process.env is never mutated. cwd anchors the app-server too.
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

/** Canonical absolute path (resolves symlinks like macOS /tmp → /private/tmp), lexical if unresolvable. */
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

/** The value at `key`, or `undefined` — the sibling of {@link readString} for non-string fields. */
function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function readString(value: unknown, key: string): string {
  if (isRecord(value) && typeof value[key] === 'string') return value[key]
  return ''
}

/**
 * The prompting approval profile, as an **allow-list** (007 P1-6): the reviewer
 * must be the user, the policy must be exactly `on-request` (not `never`,
 * `untrusted`, or a granular form that could disable approvals), and the sandbox
 * must be exactly `workspaceWrite` — 🔴 since `736` (R96), the Codex CLI's own default
 * preset (*Workspace (Ask for approval)*, measured); until then `readOnly`, its *Read Only*
 * preset. ⚑ Still an allow-list: `externalSandbox` or full access in `ask` is refused.
 * Returns the reasons the effective profile is NOT prompting (empty = OK).
 */
function approvalProfileProblems(
  reviewer: unknown,
  policy: unknown,
  sandboxType: unknown,
  approvalMode?: ApprovalMode,
): string[] {
  // Fail closed PER MODE (078). In `ask` this is unchanged — anything but the prompting profile is
  // rejected (007 P1-6). In `auto` it is just as strict, against the OTHER profile: the session must
  // be EXACTLY the intended yolo shape, so a partial or wrong downgrade (approvals off but the
  // sandbox still on, or an auto-reviewer we never asked for) is caught rather than silently
  // accepted as "close enough".
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

/**
 * A list of strings from a provider response, or `undefined` when it said nothing (158).
 *
 * ⚠️ **Filtered, not trusted.** This is wire data going straight to a surface the user reads, so a
 * non-string element is dropped rather than rendered as `[object Object]`. An empty array stays
 * `undefined`: *"reported none"* and *"reported nothing"* are the same to a reader, and a heading
 * over an empty list is the empty section 086 rules out.
 */
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

/**
 * Neutral outcome for a Codex decision; null for one this app cannot represent (the network
 * amendment, and any object that is not exactly the prefix-rule amendment's shape).
 *
 * 🔴 **736 · R95 — `{ acceptWithExecpolicyAmendment }` is `allow_always`.** ⚑ Measured (`736`'s
 * scratch of the Codex terminal, bundled 0.146.0): it is the terminal's *"Yes, and don't ask again
 * for commands that start with `…`"*, which writes `prefix_rule(pattern=[…], decision="allow")` to
 * `<CODEX_HOME>/rules/default.rules`, and a NEW launch on that home ran the same command unasked
 * while a different one was asked. ⛔ Until `736` it mapped to `null`, so the card carried the rule
 * only as a disclosure (`amendments`) with no button to choose it.
 */
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
      return null // { applyNetworkPolicyAmendment }, or a shape this app was not taught
  }
}

/** 🔴 736 · R95 — where Codex keeps its *don't ask again for commands that start with …* rules, in its home. */
export const CODEX_EXEC_POLICY_RULES = 'rules/default.rules'

/**
 * The prefix of an offered `{ acceptWithExecpolicyAmendment: { execpolicy_amendment } }` — or `null`
 * when the decision is not exactly that shape, with a non-empty argv of strings (`736`, R95). ⚠️ The
 * real wire key is `execpolicy_amendment` (`CommandExecutionApprovalDecision.ts`); a look-alike is
 * not an amendment this app will echo.
 */
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

/** Standard decision set assumed when the provider does not enumerate one (see {@link commandScope}). */
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
    // Fold the egress protocol into the host so http/socks5 vs https is disclosed, not dropped.
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

// --- filesystem/permission-profile disclosure (039, fixing 036 P1-F #5) ---

/**
 * A requested permission profile rendered for the UI, plus whether EVERY shape in it was
 * representable. `faithful:false` means the payload asks for permissions the neutral scope
 * cannot truthfully display — a positive decision must then **fail closed**, because granting
 * it would hand the provider a raw grant the user was never shown (036 P1-F #5).
 */
interface ProfileDisclosure {
  /** Access-labelled targets the grant would open, e.g. `write /etc`, `read glob:**\/*.ts`. */
  labels: string[]
  /** Whether the profile asks for network access (the neutral boolean). */
  network: boolean
  /** False when any key/entry/path shape could not be displayed truthfully → fail closed. */
  faithful: boolean
}

/** The keys of `AdditionalFileSystemPermissions` we can model; anything else is undisplayable. */
const KNOWN_FS_KEYS = new Set(['read', 'write', 'globScanMaxDepth', 'entries'])
/** The keys of `AdditionalPermissionProfile`/`RequestPermissionProfile` we can model. */
const KNOWN_PROFILE_KEYS = new Set(['network', 'fileSystem'])
/** The keys of `AdditionalNetworkPermissions` we can model (the neutral scope is one boolean). */
const KNOWN_NETWORK_KEYS = new Set(['enabled'])

/** A `FileSystemSpecialPath` as text; the `unknown` variant is deliberately NOT representable. */
function fsSpecialLabel(value: unknown): string {
  if (!isRecord(value)) return ''
  const kind = value['kind']
  if (kind === 'root' || kind === 'minimal' || kind === 'tmpdir' || kind === 'slash_tmp')
    return `special:${kind}`
  if (kind === 'project_roots') {
    const subpath = readString(value, 'subpath')
    return subpath ? `special:project_roots/${subpath}` : 'special:project_roots'
  }
  return '' // `unknown` (or a future kind): cannot be shown truthfully → fail closed
}

/** A `FileSystemPath` (`path` | `glob_pattern` | `special`) as text, or '' when not representable. */
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
      return '' // a future FileSystemPath variant → not representable
  }
}

/**
 * One `FileSystemSandboxEntry` as `"<access> <target>"`, or '' when not representable.
 * A `deny` entry is a sandbox RESTRICTION, not a grant, so it is labelled `restrict` — showing
 * it as `deny /etc` in a list the UI presents as "what accepting opens" would read as a grant.
 */
function fsEntryLabel(entry: unknown): string {
  if (!isRecord(entry)) return ''
  const access = entry['access']
  if (access !== 'read' && access !== 'write' && access !== 'deny') return ''
  const target = fsPathLabel(entry['path'])
  if (!target) return ''
  return `${access === 'deny' ? 'restrict' : access} ${target}`
}

/**
 * Render an `AdditionalFileSystemPermissions` — BOTH the legacy `read`/`write` arrays and the
 * newer `entries` (path / glob / special, each with an access mode) — into access-labelled
 * display text (036 P1-F #5). Anything not modelled (an unrecognized key, a malformed entry, a
 * non-representable path shape) sets `faithful:false` so positives fail closed instead of
 * granting what the UI never displayed.
 */
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

/**
 * Render a whole requested permission profile (`AdditionalPermissionProfile` on a command
 * approval, `RequestPermissionProfile` on `item/permissions/requestApproval`) for disclosure.
 * An unrecognized top-level key is itself an undisplayable permission shape → `faithful:false`.
 */
function permissionProfileDisclosure(profile: unknown): ProfileDisclosure {
  if (profile === null || profile === undefined)
    return { labels: [], network: false, faithful: true }
  if (!isRecord(profile)) return { labels: [], network: false, faithful: false }
  const fs = fileSystemDisclosure(profile['fileSystem'])
  const known = Object.keys(profile).every((key) => KNOWN_PROFILE_KEYS.has(key))
  // The network ask reduces to ONE neutral boolean, so an unmodelled network key would also be
  // granted-but-never-shown by the profile echo — treat it as undisplayable too.
  const rawNetwork = profile['network']
  const networkKnown =
    rawNetwork === null || rawNetwork === undefined
      ? true
      : isRecord(rawNetwork) && Object.keys(rawNetwork).every((key) => KNOWN_NETWORK_KEYS.has(key))
  const network = isRecord(rawNetwork) ? rawNetwork['enabled'] === true : false
  return { labels: fs.labels, network, faithful: fs.faithful && known && networkKnown }
}

/**
 * The fields of a command approval that its card draws, or that say nothing about what Allow runs:
 * which request it is and when it started, the command and its folder, what Codex parsed out of it,
 * what it asks beyond the sandbox, the rules Codex proposes, its reason and the answers it offers.
 */
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

/**
 * Whether a command card shows the whole of what Allow runs: the command, in its folder, and nothing
 * drawn beside it that could be read as the whole of what it touches. Codex picks paths out of a
 * command best-effort, so a card that draws them may miss one (in `curl … | tee /etc/cron.d/x` the
 * file written may not be among them); a host, extra permissions, network access, an answer Codex
 * offered that the card cannot draw, or a field this app does not know are each more than it shows. With any of them
 * the card is under-disclosed, as Claude's shell card is when its call carries more than the command.
 */
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

/** Map a `commandExecution/requestApproval` to the neutral scope + the outcomes it offers (007 P1-7). */
function commandScope(params: unknown): {
  scope: PermissionScope
  allowed: Set<PermissionOutcome> | null
  /** 🔴 736 · R95 — the amendment decision Codex OFFERED, echoed verbatim if `allow_always` is pressed. */
  alwaysAnswer?: unknown
} {
  const p = isRecord(params) ? params : {}
  // PRESENCE, not length (039, fixing 036 P1-F #3): a property that is PRESENT-but-EMPTY
  // (`availableDecisions: []`) means the provider offered NO decision — which is NOT the same
  // as an ABSENT property (it enumerated nothing). The former must yield an empty allowed set
  // so every positive decision fails closed; only the latter may use the sanctioned standard
  // set. Pre-fix both collapsed to `length > 0`, so `[]` silently widened to all four choices.
  const rawList = p['availableDecisions']
  const hasExplicitList = Array.isArray(rawList)
  const rawDecisions = hasExplicitList ? rawList : []
  const mapped = rawDecisions.map(outcomeOfCodexDecision)
  const enumerated = unique(mapped.filter((o): o is PermissionOutcome => o !== null))
  const amendments = commandAmendments(p)
  // Extra permissions riding along with the command (filesystem entries / network) — disclosed
  // to the UI, and if any shape can't be displayed truthfully, positives fail closed (P1-F #5).
  const requested = permissionProfileDisclosure(p['additionalPermissions'])
  // Enforce the offered set whenever the provider gave an explicit list — even an EMPTY one
  // → every positive outcome fails closed. Only a truly absent list leaves `allowed`
  // unrestricted (null). A request whose extra permissions can't be faithfully displayed also
  // fails positives closed: accepting would grant what the user was never shown (P1-F #5).
  //
  // 🔴 **487 · this classification is made ONCE and the published offer is DERIVED from it.**
  // ⛔ It used to be written twice — the same three-way ternary, once into `availableDecisions`
  // and once into `allowed` — and the two copies said different things about the same request
  // for four inputs, which is how a card came to be published with no answer on it at all.
  // ⚠️ The GATE is exactly what it was; only the sentence below it changed.
  const allowed = !requested.faithful
    ? new Set<PermissionOutcome>()
    : hasExplicitList
      ? new Set(enumerated)
      : null
  // 🔴 **And when the gate admits no POSITIVE, say why in the event** (487) — see
  // {@link permissionScopeSchema}'s `noPositiveBecause` for why the fact has to be written rather
  // than read back out of an empty array. ⚠️ **Three reasons, and this is the only place all three
  // inputs are in hand**: whether the requested grant could be displayed, whether the provider
  // named an answer this app has no neutral outcome for, and whether it named a way to allow at
  // all. ⛔ Derived from `allowed`, so a branch added above cannot forget to classify itself.
  const noPositive = [...(allowed ?? STANDARD_DECISIONS)].some(
    (outcome) => !isAlwaysHonoured(outcome),
  )
    ? undefined
    : !requested.faithful
      ? ('could-not-describe-the-grant' as const)
      : // ⚠️ A `null` from {@link outcomeOfCodexDecision} is an offered decision we could not map —
        // the network amendment, or a look-alike (the exec-policy one is `allow_always` since `736`).
        // The provider offered a way to accept and we cannot put it on a card,
        // which is a different sentence from the provider offering none.
        mapped.some((outcome) => outcome === null)
        ? ('could-not-represent-the-answers' as const)
        : ('none-was-offered' as const)
  // `commandActions` are best-effort parse HINTS (per the protocol doc), not a proof of the
  // command's full effect; the requested grant labels are appended so the UI sees them.
  const paths = unique([...commandActionPaths(p['commandActions']), ...requested.labels])
  const scope: PermissionScope = {
    cwd: readOptionalString(p, 'cwd'),
    paths,
    networkHosts: commandNetworkHosts(p),
    // 🔴 **697 · `672` F1 — from the GATE's positives, not from what the server proposed.** ⛔ It
    // was `session` whenever an exec-policy amendment was PROPOSED — which no answer here applied
    // (since `736`, R95, the OFFERED one is `allow_always`, and reads as `always`) —
    // and read the raw list before the gate, so a card whose positives were all withheld still
    // promised a standing grant. ⚑ {@link persistenceOf} over what the card can actually send.
    persistence: persistenceOf([...(allowed ?? STANDARD_DECISIONS)]),
    amendments,
    // What the UI may actually send must match what `respondPermission` will accept — otherwise
    // the card advertises a choice the gate then rejects, which is its own lie about scope. So
    // the POSITIVES are the gate's own members: an explicit list → only the representable offered
    // decisions (an object-only or EMPTY list yields none — no invented plain allow); an absent
    // list → the sanctioned standard set; undisplayable requested permissions → none at all.
    //
    // 🔴 **And {@link publishedOffer} keeps the two refusals on every one of those** (487). The
    // gate has honoured them throughout — `respondPermission` exempts {@link ALWAYS_HONOURED} by
    // construction — so this adds no move the rails did not already admit. ⛔ **It is what makes
    // the fail-closed answerable**: withholding what a person may ALLOW is the whole point of
    // that branch, and withholding what they may REFUSE was never part of it.
    availableDecisions: publishedOffer([...(allowed ?? STANDARD_DECISIONS)]),
    // ⚑ **Undefined whenever this card can be allowed**, which is every ordinary command.
    // ⛔ **Written plainly and never through a conditional spread**: a spread writes past the
    // declared type and no source census can see what it added
    // (`a-spread-writes-past-a-declared-type`). `undefined` is what the schema's `.optional()`
    // means and what `JSON.stringify` drops on the way to the wire.
    noPositiveBecause: noPositive,
    underDisclosed: !theCommandIsTheWholeRequest(
      p,
      paths,
      requested,
      mapped.every((outcome) => outcome !== null),
    ),
  }
  // 🔴 **736 · R95 — the prefix rule Codex offered, as the rule the button installs.** Echoed as
  // Codex listed it, never rebuilt from `proposedExecpolicyAmendment` (the disclosure).
  const alwaysAnswer = rawDecisions.find((decision) => execPolicyAmendmentOf(decision) !== null)
  const prefix = alwaysAnswer === undefined ? null : execPolicyAmendmentOf(alwaysAnswer)
  if (prefix !== null && allowed?.has('allow_always') === true) {
    scope.grants = { allow_always: [{ kind: 'command-prefix', prefix: [...prefix] }] }
    return { scope, allowed, alwaysAnswer }
  }
  return { scope, allowed }
}

// --- user-input request modelling + provider-valid answer/decline payloads (007 P2-1) ---

/** The method's DOCUMENTED empty/denied payload — not a JSON-RPC error — so the turn continues. */
/**
 * The four server-request methods this adapter supports, classified ONCE (061). Both the scope
 * gate and the dispatch read this single classification, so a new method cannot be scope-checked
 * in one place and dispatched in another — an unrecognized method is `unsupported` by
 * construction and is refused with a JSON-RPC error before any scope logic runs.
 */
type ServerRequestKind =
  | { kind: 'approval'; approval: 'command' | 'file' }
  | { kind: 'userInput'; isPermission: boolean }
  /**
   * ⛔ **A tool this session declared, being called** (348) — `item/tool/call`, the answer to
   * `ThreadStartParams.dynamicTools`.
   *
   * 🔴 **This said *"Unlike the other two it publishes **no card**: nobody is asked anything"*, and
   * that stopped being true.** ⛔ {@link CodexSessionHandle.handleAgentToolCall} publishes a
   * `permission_request` in `ask` for a verb this app's own rails do not wholly gate, and has for
   * some time — a sentence that describes how the system works drifts every time the system moves
   * (standing rule 8). ⚑ **486 corrected it rather than leaving a docblock to teach the next
   * reader the old shape.**
   *
   * ⚠️ **What IS still true, and it is the part worth keeping**: no Codex approval mechanism is
   * involved. `AskForApproval`, `approvalsReviewer` and the sandbox govern this provider's own
   * command execution and file changes; a dynamic tool carries no approval field at all, so
   * whether a person is asked is BroBot's decision and only BroBot's.
   */
  | { kind: 'agentTool' }
  /**
   * 🔴 **An EXTERNAL MCP server asking the person something** (605) —
   * `mcpServer/elicitation/request`, the answer to {@link codexExternalMcpConfig}'s servers.
   *
   * ⛔ **It is the only thing this app ever hears from a granted server.** The child talks to the
   * server directly and BroBot sees none of those calls; this frame is forwarded by the
   * app-server because the SERVER asked for a person, and it names the server and nothing
   * smaller — see {@link codexElicitation} for the measured frame.
   *
   * ⚠️ **`HO-042` §3 refused to build a card for this and the PO has WITHDRAWN that ruling**
   * (`HO-090` §1): *"A card that says plainly this is a tool call and we cannot yet tell you
   * which is HONEST. It is not a card naming the wrong subject."*
   */
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

/**
 * The method-appropriate SAFE refusal payload for a supported server request (061) — the same
 * documented empty/denied shapes the shutting-down and duplicate paths already use, so a refused
 * request never leaves the app-server hanging and never carries a positive decision.
 */
function safeRefusal(kind: Exclude<ServerRequestKind, { kind: 'unsupported' }>): unknown {
  if (kind.kind === 'approval') return { decision: 'decline' }
  // ⚠️ **`success: false`, because on this path no tool ran** (348). The shutting-down and
  // out-of-scope paths are not policy decisions — nothing was refused, the call never reached a
  // tool — so they take the shape {@link answerCodexToolCall} gives a call that found nothing,
  // never the shape it gives a rail that said no.
  if (kind.kind === 'agentTool') {
    return {
      contentItems: [{ type: 'inputText', text: 'this session cannot take tool calls right now' }],
      success: false,
    }
  }
  // ⚑ **`decline` is the documented negative for an elicitation** — `McpServerElicitationAction`
  // is `accept | decline | cancel`, and `content` is nullable *"because decline/cancel responses
  // have no content"*. ⚠️ **Since `728`, only for Codex's own approval and a frame with no card**: a
  // SERVER's request nobody answered gets `cancel` (`handleExternalMcpElicitation`'s
  // `nobodysAnswer`), because `decline` there says a person refused. ⛔ The old reason — *"`cancel`
  // is a person asking the turn to stop"* — was never the wire's: `cancel` alone stops no turn
  // (`720` arm H). From `720` until `736` the stop was this app's own `turn/interrupt` (R74); since
  // R97 there is none.
  if (kind.kind === 'elicitation') return { action: 'decline', content: null, _meta: null }
  return userInputDecline(kind.isPermission)
}

/**
 * 🔴 **723 · R80 — the grant Codex's `persist: 'session'` IS, in this app's words.**
 *
 * ⚑ Measured by `probe:codex-mcp-tool-approval` (bundled 0.146.0): after a call allowed with
 * `_meta: { persist: 'session' }`, the SAME tool called again with DIFFERENT parameters ran with no
 * second ask — so the grant is the tool's, whatever it is given. ⛔ That is
 * {@link PermissionOutcome} `allow_all_for_session` and not `allow_for_session`, the provider's own
 * narrower rule for the ask (`736`, R94; scoped to what the card disclosed until then): calling this
 * grant the narrow one would be `031`'s lie, one provider over.
 */
const A_TOOLS_SESSION_GRANT: PermissionOutcome = 'allow_all_for_session'

/**
 * ⚑ **What a person may answer Codex's own approval of a tool call with** — the Codex terminal's own
 * choices: *Allow*, *Allow for this session* (when Codex offers `session`) and, 🔴 since `736` (R95,
 * withdrawing R80's *"never always"*), *Always allow* (when Codex offers `always`). The two refusals
 * come with {@link publishedOffer}, as on every card — ⚠️ the terminal itself offers no Deny here,
 * only Cancel (`728`, measured).
 */
function aToolApprovalsPositives(approval: ClaimedToolApproval): PermissionOutcome[] {
  return [
    'allow',
    ...(approval.offersSession ? [A_TOOLS_SESSION_GRANT] : []),
    ...(approval.offersAlways ? (['allow_always'] as const) : []),
  ]
}

/**
 * 🔴 **723 · R80 — the card for Codex's own approval of an external MCP tool call.**
 *
 * ⚑ **It names the server, the tool and the parameters** ({@link RuntimeEvent} `mcpToolCall`),
 * discloses the call whole in `detail`, and carries Codex's own question as `summary` — the
 * provider's one-sentence rendering, beside the disclosure and never instead of it (`071`).
 * ⚠️ **Under-disclosed**, as Claude's card for an MCP tool is: the call is named whole, and what the
 * tool does with it is the server's and no one here can say.
 */
function aToolApprovalCard(
  id: string,
  approval: ClaimedToolApproval,
  approvalMode: 'ask' | 'auto',
  /** 🔴 736 · the conversation's provider home, where an *Always allow* is kept. */
  providerHome?: string,
): Extract<RuntimeEvent, { type: 'permission_request' }> {
  const summary = wordsForACard(approval.question)
  // ⚑ **The offer, built where it is published** — and by the one derivation the handler arms the
  // gate with ({@link aToolApprovalsPositives}), so the two cannot come to differ.
  const offer = publishedOffer(aToolApprovalsPositives(approval))
  // ⚑ **Cleaned where it is drawn** — a name the server chose, as every provider string a card shows.
  const tool = wordsForACard(approval.tool) ?? ''
  return {
    type: 'permission_request',
    id,
    // ⚑ **`command`, because that is what a tool call already IS in this vocabulary** (`348`).
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
      // 🔴 **736 · R94 — what each standing button installs**: the tool, keyed as Codex keys it.
      grants: aToolApprovalsGrants(approval, tool, offer, providerHome),
      amendments: [],
      availableDecisions: offer,
      underDisclosed: true,
      approvalMode,
    },
  }
}

/** 🔴 736 · R94 — the rule each standing button on Codex's tool approval installs, and where. */
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

/**
 * 🔴 **An elicitation is answered in ITS OWN wire shape** (605) — `{action, content, _meta}`.
 *
 * ⚑ **`cancel` maps to `cancel` and every other refusal to `decline`**, the distinction
 * {@link codexDecision} makes. ⚑ **723 · R80 — and Codex's own approval of a tool call has the
 * positives**: Allow is `{action: 'accept', content: {}}`, which runs the tool, and the session
 * grant adds `_meta: { persist: 'session' }` (measured by `probe:codex-mcp-tool-approval`: the
 * answer that went out, and a second call not asked); since `736` (R95) *Always allow* adds
 * `persist: 'always'`, and the approval is also kept in the provider home ({@link keepToolApproval}).
 * ⚑ **728 · R93 — and a server's own zero-field form**: Allow is the same `{action: 'accept',
 * content: {}}`, measured as the Codex CLI's own terminal UI sends it (`728`).
 * ⚑ **W4.28 — and a url request whose link the card shows**: *I opened it* is `accept`, content null.
 * ⛔ **No other elicitation has a positive here**: a server's form with fields is answered through
 * `respondUserInput`, and `openai/form`, a user verification and a url whose link was withheld offer
 * none — the offered-set gate refuses a positive on them before this is reached.
 */
function elicitationAnswer(
  decision: PermissionDecision,
  approval: ClaimedToolApproval | undefined,
  confirmsAServersForm: boolean,
  showsALink = false,
): McpServerElicitationRequestResponse {
  if ((approval !== undefined || confirmsAServersForm) && decision.outcome === 'allow') {
    return { action: 'accept', content: {}, _meta: null }
  }
  // ⚑ **W4.28 · *I opened it* on a url request** — `accept`, with no content: MCP's url mode carries
  // none, and the type's own note says content is for a form's answers.
  if (showsALink && decision.outcome === 'allow') {
    return { action: 'accept', content: null, _meta: null }
  }
  if (approval !== undefined && decision.outcome === A_TOOLS_SESSION_GRANT) {
    return { action: 'accept', content: {}, _meta: { persist: 'session' } }
  }
  // 🔴 **736 · R95 — the Codex terminal's *Always allow*, as it answers**: `persist: 'always'`.
  // ⚠️ On this path Codex keeps nothing of it past the conversation (measured,
  // `probe:codex-mcp-tool-approval`'s `always` arm) — this app keeps it, in the provider home
  // (`kept-tool-approvals.ts`), and declares it with the server at every launch.
  if (approval !== undefined && decision.outcome === 'allow_always') {
    return { action: 'accept', content: {}, _meta: { persist: 'always' } }
  }
  return {
    action: decision.outcome === 'cancel' ? 'cancel' : 'decline',
    content: null,
    _meta: null,
  }
}

/**
 * ⛔ **One `item/tool/call`, read off the wire** (348) — or `null` when the frame names no tool.
 *
 * ⚠️ **`arguments` is passed through as it arrived, whatever it is.** Reading it into a shape here
 * would be the strip `303` B measured, moved one file earlier; {@link answerCodexToolCall} is where
 * a non-object is answered, and `341`'s door is where an undocumented KEY is refused by name.
 */
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

/**
 * What a user-input answer becomes: the provider payload, or the reason it cannot be one (142 §2).
 *
 * A PURE function of the request and the answer (067), so the synchronous answer path and the
 * handler's fallback path cannot disagree about what a given response means — and now they cannot
 * disagree about whether it means anything either.
 */
type ForwardedUserInput = { readonly payload: unknown } | { readonly refusal: string }

/**
 * ⛔ **This adapter promised nothing and 141 found it out.** `permission.ts` has said since 139 that
 * *"completeness is not usefulness"* and that empty, blank and several-for-one fail closed. Claude
 * implemented it; Codex checked only that every question id was PRESENT, so all of these crossed the
 * validated main-process boundary and reached the provider: `q = []` became `answers.q.answers = []`;
 * `q = "   "` became an array containing the blank; `q = ["blue","red"]` forwarded BOTH, though
 * {@link codexQuestions} publishes `multiSelect:false` on every question it builds; and with two
 * questions, `{q_a: "x", q_b: []}` passed completeness and forwarded a substantively partial answer.
 * The test suite blessed the third one by name. {@link answerToForward} is now the only reading of
 * an answer either adapter has.
 *
 * ⚠️ **And a refusal is not a decline.** Returning `userInputDecline` for an unusable answer — which
 * is what the completeness check did — tells the provider the user declined, while the host records
 * `Answered`: 141's HIGH 1 on the other provider. The `refusal` branch exists so
 * {@link CodexSessionHandle.respondUserInput} can throw instead, leaving the request pending and the
 * card answerable. Only the handler's fallback path, which has no caller left to tell, declines.
 */
function userInputPayloadFor(
  isPermission: boolean,
  params: unknown,
  response: UserInputResponse,
): ForwardedUserInput {
  // ⚠️ A decline's reason is not sent: neither answer Codex takes here has a place for one.
  if (response.kind !== 'answer') return { payload: userInputDecline(isPermission) }
  if (isPermission) return { payload: codexGrant(params) }
  const forward = answerToForward(codexQuestions(params), response.answers)
  if (!forward.forwardable) return { refusal: forward.why }
  return { payload: codexAnswers(params, forward.values) }
}

/** A supported server-request kind — the shape an id's response must fit. */
type SupportedRequestKind = Exclude<ServerRequestKind, { kind: 'unsupported' }>

/**
 * One id's place in the lifecycle (067). `CLAIMED` carries everything the answer path needs so it
 * can respond **synchronously**, without reaching into a second structure that could disagree:
 * the RAW id (the wire is answered with the raw id, while state is keyed by {@link requestKey}),
 * the request kind (its refusal shape), and the outcomes the request actually offered (014).
 * `SPENT` needs nothing — the id is closed.
 */
type RequestState =
  | {
      phase: 'claimed'
      rawId: string | number
      kind: SupportedRequestKind
      messageCallId?: string
      /** Outcomes this approval offers, or null = unrestricted; undefined until the card publishes. */
      allowed?: Set<PermissionOutcome> | null
      /**
       * How a user-input answer becomes a provider payload — or why it cannot (142). Registered by
       * the handler (it closes over the request's `params`) so
       * {@link CodexSessionHandle.respondUserInput} can decide and respond SYNCHRONOUSLY — the same
       * atomicity the approval path gets from `codexDecision`, now covering usability as well.
       */
      userInputPayload?: (response: UserInputResponse) => ForwardedUserInput
      /**
       * 🔴 **723 · R80 — this elicitation is CODEX's own approval of an external tool call**, so a
       * positive answer is an `accept` — see {@link elicitationAnswer}. Set by the handler with the
       * offer; absent on every other request.
       */
      approvesATool?: ClaimedToolApproval
      /**
       * 🔴 **728 · R93 — this elicitation is a SERVER's own zero-field form**, shown as the Codex CLI
       * shows it, so Allow is an `accept` with no content — see {@link elicitationAnswer}.
       */
      confirmsAServersForm?: true
      /** ⚑ W4.28 · a url request whose link the card shows — its Allow is *I opened it*, `accept`. */
      showsALink?: true
      /**
       * 🔴 **736 · R95 — the exact decision Codex offered for "don't ask again for commands that
       * start with …"**, echoed when `allow_always` is pressed. Absent on every other request.
       */
      alwaysAnswer?: unknown
    }
  | { phase: 'spent' }

function userInputDecline(isPermission: boolean): Record<string, unknown> {
  // `PermissionsRequestApprovalResponse`: grant nothing, this turn only. `satisfies` keeps the
  // grant-NOTHING payload conformant too (an empty profile is valid: both sections are optional).
  // `ToolRequestUserInputResponse`: no answers provided.
  return isPermission
    ? ({ permissions: {}, scope: 'turn' } satisfies PermissionsRequestApprovalResponse)
    : { answers: {} }
}

/** A `LegacyAppPathString[]` from a request section, or `null` — the generated shape of read/write. */
function grantedPaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const paths = value.filter((p): p is string => typeof p === 'string' && p.length > 0)
  return paths.length > 0 ? paths : null
}

/** One `FileSystemSandboxEntry`, narrowed — or null when it is not a shape we model (047/039). */
function grantedEntry(entry: unknown): FileSystemSandboxEntry | null {
  if (!isRecord(entry)) return null
  const access = entry['access']
  if (access !== 'read' && access !== 'write' && access !== 'deny') return null
  const path = entry['path']
  // Only the variants `fsPathLabel` can DISPLAY are grantable — the two stay in lock-step so a
  // grant can never carry a shape the card did not show (039's disclosure↔grant coupling).
  if (!isRecord(path) || !fsPathLabel(path)) return null
  return { path: path as FileSystemSandboxEntry['path'], access }
}

/**
 * Build the `GrantedPermissionProfile` for a request profile (047, fixing 044 P1-F).
 *
 * The request type allows `network`/`fileSystem` to be **`null`**
 * (`RequestPermissionProfile`), but the GRANT type allows those sections to be **absent or an
 * object — never top-level `null`** (`GrantedPermissionProfile`). Echoing the request raw therefore
 * produced an out-of-contract response for a protocol-valid nullable request. So the grant is
 * CONSTRUCTED: a null/absent section is **omitted**, and a present section is rebuilt field by
 * field. (`read`/`write` are REQUIRED-but-nullable inside `AdditionalFileSystemPermissions`, so
 * they are carried as `null` rather than omitted — omitting them would not type-check.)
 */
function grantedProfile(requested: Record<string, unknown>): GrantedPermissionProfile {
  const profile: GrantedPermissionProfile = {}
  const network = requested['network']
  if (isRecord(network)) {
    // EXACTLY what the card disclosed: `permissionProfileDisclosure` shows network access as
    // `enabled === true`, so the grant carries that same boolean. Deriving it identically keeps
    // shown == granted even for an out-of-spec `enabled` (e.g. `"yes"` would display as no
    // network access, and must therefore not be granted as anything else).
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

/**
 * `PermissionsRequestApprovalResponse` granting the requested profile for this turn — but ONLY
 * when that profile was faithfully displayed to the user (039, fixing 036 P1-F #5). A profile
 * containing permission shapes the neutral scope cannot show (an unmodelled key, a malformed or
 * non-representable `entries` path) **fails closed** to the documented grant-nothing payload: a
 * provider grant must always be a subset of what the reviewer actually saw — a raw grant is
 * never echoed back unseen.
 *
 * The payload is CONSTRUCTED and `satisfies PermissionsRequestApprovalResponse`, so a
 * non-conformant grant (e.g. the raw nullable request echoed back) is a **compile error** rather
 * than an invalid response the provider rejects at runtime (047, fixing 044 P1-F).
 */
function codexGrant(params: unknown): Record<string, unknown> {
  const requested = isRecord(params) && isRecord(params['permissions']) ? params['permissions'] : {}
  if (!permissionProfileDisclosure(requested).faithful) return userInputDecline(true) // grant nothing
  return {
    permissions: grantedProfile(requested),
    scope: 'turn',
  } satisfies PermissionsRequestApprovalResponse
}

/**
 * `ToolRequestUserInputResponse` mapping the APPROVED per-id values to EVERY question (033).
 *
 * ⚠️ **Takes {@link answerToForward}'s values, never the raw answer map** (142). It used to wrap
 * whatever was present — `Array.isArray(value) ? value : [value]` — which is how an empty array, a
 * blank string and two selections for a single-select question all reached the provider verbatim.
 * Taking only approved values means there is no shape left here that can carry one.
 *
 * ⛔ **An `Other` answer goes in the SAME slot as a label, and nothing here marks it** (143). This is
 * the provider's shape, not a loss: `ToolRequestUserInputAnswer` is `{answers: Array<string>}` with
 * no field for the distinction, and the pinned app-server test client puts a chosen option and a
 * free-form Other response into that one array alike. So Codex asks a question whose answer may not
 * be on the list and then offers nowhere to say that it wasn't — unlike Claude, which has a
 * top-level `response`. `answerToForward` still draws the line where the options are, which is why
 * a typed answer to a question with `isOther: false` never reaches this function at all.
 */
function codexAnswers(
  params: unknown,
  approved: ReadonlyMap<string, readonly string[]>,
): Record<string, unknown> {
  const questions =
    isRecord(params) && Array.isArray(params['questions']) ? params['questions'] : []
  // ⛔ **`Object.create(null)`, because the KEY is a provider-chosen id** (146, from 145 HIGH 2).
  // `ToolRequestUserInputQuestion.id` is an unrestricted `String` in the pinned protocol, so
  // `__proto__` is a legal id — and on an ordinary object that assignment sets the prototype
  // instead of creating a property, so the provider would receive `{answers:{}}` (its own DECLINE
  // payload, byte for byte) while BroBot recorded the question as answered.
  const answers: Record<string, { answers: string[] }> = Object.create(null)
  // Build `{ [questionId]: { answers } }` for EVERY answered question (033, fixing 023
  // P2 #1) — the neutral id equals the provider id (or positional `q{i}`), so each
  // answer is looked up by the same id `codexQuestions` assigned.
  questions.forEach((q, i) => {
    const providerId = isRecord(q) ? readString(q, 'id') : ''
    const value = approved.get(providerId || `q${i}`)
    if (providerId && value !== undefined) answers[providerId] = { answers: [...value] }
  })
  return { answers }
}

/**
 * ⛔ **Is any question's own id one this provider could never take an answer back for?** (150, 148 M5)
 *
 * ⚠️ **Deliberately the SAME truthiness test as the `if (providerId && …)` directly above**, read off
 * the same raw field by the same reader, because the two have to agree by construction. This exists
 * only to refuse in advance exactly what {@link codexAnswers} would silently drop: a question whose
 * `id` is missing, non-string or empty gets a positional `q{i}` from {@link codexQuestions} for the
 * card's addressing, and that invented key has nowhere to go on the way out.
 *
 * ⚑ **The positional fallback stays** — it is right for the card, which needs a stable handle for a
 * question the user can see. What was wrong was publishing a card that could be answered and not
 * delivered; the fallback is not the defect, the publication was.
 */
function hasUndeliverableQuestionId(params: unknown): boolean {
  const questions =
    isRecord(params) && Array.isArray(params['questions']) ? params['questions'] : []
  return questions.some((q) => !(isRecord(q) && readString(q, 'id')))
}

/**
 * Neutral questions from a `requestUserInput` params (id/prompt/options), no raw payload.
 *
 * ⛔ **Codex questions are SINGLE-select, and 139 measured that rather than assuming it.**
 * `ToolRequestUserInputQuestion` — generated from the app-server's own schema — is
 * `{id, header, question, isOther, isSecret, options: ToolRequestUserInputOption[] | null}`. There
 * is no multi-select flag on it and no shape that implies one: `isOther` offers a free-text escape,
 * `isSecret` hides what is typed, and neither says how MANY of the options may be picked.
 *
 * ⚠️ **The tempting wrong reading is the answer type.** `ToolRequestUserInputAnswer` is
 * `{answers: Array<string>}` — plural for every question, single-select ones included, and
 * {@link codexAnswers} has always wrapped one answer in a one-element array to satisfy it. A
 * response shape that CAN carry several is not a question that ASKED for several; treating it as
 * one would invent a signal the provider does not send (035), and 135 is the precedent for not
 * assuming symmetry in either direction — there, too, the asymmetry turned out to be structural.
 *
 * ⚑ **`false` is written rather than omitted** so the ledger can tell a Codex question that was
 * ruled single-select from a question built before the flag existed. See
 * {@link userInputQuestionSchema} for why the field is optional at all.
 *
 * ⚑ **`description`, `header`, `isOther` and `isSecret` are all carried now** (143) — every field on
 * the generated question except the raw payload it came in. 139 dropped the first two and reported
 * them; 141 measured what the third one cost: options are *"2–3 mutually exclusive choices"*, the
 * client adds a free-form Other, and `normalize_request_user_input_args` forces `is_other = true` on
 * every ordinary question — while BroBot rendered a text field only when the option list was empty,
 * which that same normalizer forbids. So the answer Codex guarantees a user can give was one this
 * app could never take.
 */
function codexQuestions(params: unknown): UserInputQuestion[] {
  const questions =
    isRecord(params) && Array.isArray(params['questions']) ? params['questions'] : []
  return questions.map((q, i) => ({
    id: (isRecord(q) && readString(q, 'id')) || `q${i}`,
    prompt: (isRecord(q) && readString(q, 'question')) || `question ${i + 1}`,
    // `readString` returns `''` for a missing or non-string field, and an empty header is no header
    // — `undefined` rather than a blank chip, so the card's `v-if` is asking one question.
    header: (isRecord(q) && readString(q, 'header')) || undefined,
    options:
      isRecord(q) && Array.isArray(q['options'])
        ? q['options'].map((o) =>
            isRecord(o)
              ? {
                  label: readString(o, 'label'),
                  // Codex declares `description` non-null, so a missing one is a producer that did
                  // not follow its own schema — omitted rather than rendered as an empty reason.
                  ...(readString(o, 'description') === ''
                    ? {}
                    : { description: readString(o, 'description') }),
                }
              : { label: String(o) },
          )
        : [],
    // ⛔ **Read from the question, not assumed from the normalizer** (143, 086). The pinned
    // normalizer forces this true for every ordinary question, so in practice it always is — but
    // what the card offers must come from what this request actually said, not from what the
    // provider's source code says it will say. A producer that sends `false` gets a card with no
    // free-form field, and {@link answerToForward} refuses a typed answer to it.
    allowOther: isRecord(q) && q['isOther'] === true,
    // 141 §3.1: dropped once already, and *"a latent masking gap if another valid producer sets
    // it"*. It costs one attribute on one input; see `userInputQuestionSchema.secret`.
    secret: isRecord(q) && q['isSecret'] === true,
    multiSelect: false,
  }))
}

/**
 * Neutral requested-permission scope from a `permissions/requestApproval` params, no raw payload.
 * Discloses the FULL requested filesystem profile (039, fixing 036 P1-F #5): both the legacy
 * `read`/`write` arrays and the newer `entries` (path / glob / special), each **labelled with its
 * access mode** so the UI shows what a positive decision would actually grant — pre-fix the
 * `entries` form displayed nothing while the grant was echoed back to the provider in full.
 */
function codexUserPermission(params: unknown): UserInputPermission {
  const p = isRecord(params) ? params : {}
  const requested = permissionProfileDisclosure(isRecord(p['permissions']) ? p['permissions'] : {})
  // 🔴 **709 · R44 — the model's words, under the model's name** (measured: `probe:codex-approval-
  // reason`, the permissions arm). ⛔ Not `reason`, which carried them with no author.
  const agentReason = wordsForACard(p['reason'])
  return {
    cwd: readOptionalString(p, 'cwd'),
    ...(agentReason === null ? {} : { agentReason }),
    paths: requested.labels,
    network: requested.network,
  }
}

/**
 * ⚑ **709 · R44 — is this a command approval whose `reason` was MEASURED to be the model's?**
 *
 * ⚑ `probe:codex-approval-reason`'s `justified` and `compound` turns: an `exec_command` the MODEL
 * escalated arrives with a `command`, with the prefix rule Codex offers to remember
 * (`proposedExecpolicyAmendment`), and with no `networkApprovalContext`, no `approvalId` and no
 * `additionalPermissions` — and its `reason` is the model's `justification`, verbatim, or absent.
 *
 * 🔴 **The amendment is what tells the model's ask from Codex's own** (709's review, then measured —
 * the `policy` arm): a command an exec-policy `prompt` rule stops carries the same `command` and none
 * of the three, but NO amendment, and Codex writes its `reason` itself — *"`<command>` requires
 * approval: <the rule's justification>"*, or *"… requires approval by policy"* — even over a model's
 * escalation and justification. Such a rule can come from an admin's `requirements.toml` or a trusted
 * project's `.codex/rules`. ⚠️ Codex's schema names one more of its own: *"retry without sandbox"*,
 * never raised on BroBot's `on-request` profile (the `sandbox-denied` turn: no request at all).
 *
 * ⛔ **Every other shape is unmeasured**: the managed-network approval (no command; Codex's own
 * protocol types call its `reason` *"e.g. request for network access"*), a zsh-exec-bridge subcommand
 * approval (an `approvalId`), and a command asking for additional permissions. Carrying any of their
 * `reason`s as the agent's would put words of another author under the agent's name — R44's defect,
 * inverted.
 *
 * ⚠️ **And it fails closed on a model escalation Codex offers NO rule for** — the protocol types the
 * amendment optional, and Codex's own source proposes none for a command it had to parse the hard
 * way (a heredoc, say; read, not driven). Such a card carries the model's words nowhere, as `main`
 * did: R44's carry is lost there, and no author is mislabelled.
 */
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

/**
 * 🔴 **`720` · R73 — Codex's own sentence for a command an exec-policy `prompt` rule stopped**, or
 * `null` for every other request.
 *
 * ⚑ The ruling (`709` F-5): *"A policy's own words are the provider's. Codex's '… requires approval:
 * <rule text>' is carried as the provider's words (`providerReason`), labelled as Codex's rule.
 * `700`'s 'marked asks only' contract widens to this one named case, and no further."*
 *
 * ⚑ **Measured** (`probe:codex-approval-reason`, the `policy` arm, bundled 0.146.0): the request has
 * the `command`, NO offered prefix rule and none of the other three fields
 * {@link theModelWroteTheReason} reads, and Codex writes `reason` itself — over the model's
 * escalation and justification — as *"`<command>` requires approval: <the rule's text>"*.
 *
 * ⛔ **Fails closed, and never on {@link theModelWroteTheReason}'s shape**: that one requires an
 * offered rule (any array — an offered `[]` too), this one requires every one of the four fields
 * UNSET, so one `reason` never rides both. ⚠️ An offered `[]` with Codex's sentence would ride
 * `agentReason` by `709`'s gate — a shape nobody has measured (`720` F-G). ⚠️ **The text shape is
 * what separates it from `709` F-11** — a model
 * escalation Codex offered no rule for has this same structure and the MODEL's words — so the
 * sentence must begin with THIS request's own `command` in backticks and carry a rule's text after
 * the colon. ⛔ **"And no further"**: *"`<command>` requires approval by policy"* (the rule-silent
 * branch of the same format site) names no rule and is not carried; no file, permissions, network
 * or sandbox-retry request is read here.
 *
 * ⚠️ **The bound, stated rather than hidden**: a model that escalated an unparseable command with a
 * justification copying Codex's exact sentence about that exact command would be labelled a rule.
 * Nothing on the wire at this pin can tell the two apart.
 */
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
  // ⚑ Compared RAW, before cleaning: a heredoc command holds newlines the cleaning would collapse.
  if (!said.startsWith(head) || said.slice(head.length).trim() === '') return null
  return wordsForACard(said)
}
// ⚠️ **720 · the second bound**: the `command` inside Codex's sentence is bytes the MODEL wrote, so a
// crafted argument can put its own *"… requires approval: …"* ahead of the real rule's text under
// the provider's name (review, `720` F-G). The real rule text starts at `head.length`; whether to
// carry or draw it apart from the command, which `detail` already shows, is the frontend's and the
// PM's call.

/**
 * ⚑ **709 · the headline of a permissions request, in this app's words** — never the model's (R44).
 * The Claude adapter's plan cards are the precedent (`userInputPrompt`): the card names the ask, and
 * what the agent said about it is carried separately, by its author.
 */
export const THE_AGENT_ASKS_FOR_ACCESS = 'The agent asks you to grant it more access.'

/**
 * Map a `fileChange/requestApproval` to the neutral scope.
 *
 * ⛔ **The changed files are NOT in the approval params, and they no longer have to be** (181). The
 * params carry `{threadId, turnId, itemId, startedAtMs, reason?, grantRoot?}` — the comment here used
 * to end *"full path plumbing (correlate the item by id) is a follow-up for the UI slice"*, and this
 * is that follow-up. `targets` is what the `fileChange` item under that same `itemId` already told
 * us it would change; see {@link PatchTargets} for the frame capture that established it arrives
 * **before** the approval, and for what still happens when it does not.
 *
 * ⚠️ **`underDisclosed` follows what we can NAME, and the standard is the one Claude already
 * applies.** `claudeScope` marks a `Write`/`Edit` card fully disclosed on the strength of its
 * `file_path` alone — *"a `file_path` is the whole of what a read does"* — without showing the bytes
 * either. A patch whose every file is named meets exactly that bar, and holding Codex to a stricter
 * one would mean the same act, gated by the same app, wearing a broader warning on one provider than
 * the other. With no targets the flag stays where it was: we were told nothing, and saying so is the
 * disclosure (007 P1-7 NO-SILENT-DROP).
 */
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
    // The files first, then the grant root — which is a different claim (what a session-wide accept
    // would cover) and keeps its own row on the card. `unique` because a single-file patch under a
    // grant root would otherwise list the same string twice when they coincide.
    paths: unique([...targets.map((target) => target.path), ...(grantRoot ? [grantRoot] : [])]),
    networkHosts: [],
    // 🔴 **697 · from the OFFER, as every producer's** ({@link persistenceOf}). ⛔ It was `session`
    // only beside a grant root — so every other Codex file card said `once` above an *"allow for this
    // session"* button (measured live by `probe:codex-reopen-grant`: `c3`, `r2`, `r4`, `d2`), which is
    // `058`'s *"the same class of lie in the other direction"*. ⚑ The standard set carries the session
    // accept, so a file card says what that button can grant: the same files, for the session.
    persistence: persistenceOf(STANDARD_DECISIONS),
    grantRoot,
    amendments: [],
    // File-change approvals don't enumerate decisions; the standard set applies, unrestricted.
    // ⚑ **Through {@link publishedOffer} since 487** — the value does not move, and the point is
    // that no producer in this file states the floor in its own words any more.
    availableDecisions: publishedOffer(STANDARD_DECISIONS),
    underDisclosed: targets.length === 0,
  }
  return { scope, allowed: null }
}

/**
 * **What approving a patch actually writes**, for the card's disclosure block (181 §1).
 *
 * 071's ruling for a command is that the card shows the whole of it, tail and all. The analogue for
 * a patch is every file it touches and what it does to each — one line per file, in the provider's
 * own paths.
 *
 * ⛔ **And when the provider named nothing, the card SAYS SO where the decision is made** (§1b). The
 * old string was the literal word `file`, which is a disclosure of nothing wearing the shape of one;
 * the Changes tab has always explained this afterwards, and afterwards is not when a person is
 * deciding. One line, not a paragraph (031), and it invents no path.
 */
function fileDetail(targets: readonly PatchTarget[]): string {
  if (targets.length === 0) {
    return (
      'file change — the provider did not name the files this patch touches; ' +
      'they appear in Changes once it has run'
    )
  }
  return targets.map(patchTargetLabel).join('\n')
}

/**
 * UI decision → Codex approval decision string (001 mapping). ⚠️ `allow_always` is not here: its
 * answer is the object Codex OFFERED (`736`, R95 — {@link RequestState}'s `alwaysAnswer`), and a
 * request that offered none refuses it at the offered-set gate before this is reached — so the
 * `default` below never grants what was not offered.
 */
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

/**
 * How many pages of `model/list` to follow before giving up (058).
 *
 * A runaway guard, not a policy: the measured catalogue is seven rows on one page, and this is far
 * beyond any plausible one. It exists because the loop is driven by a cursor the SERVER chooses, and
 * a server that returned a cursor pointing at itself would otherwise spin forever.
 */
const MODEL_LIST_PAGE_LIMIT = 20

/**
 * The whole `model/list` probe's budget (058 review). Measured at well under a second against the
 * bundled binary; the bound is generous because the cost of being too eager is a missing menu and
 * the cost of being too patient was a promise that never settled. See the ⚠️ in {@link
 * CodexRuntime.listModels}.
 */
const MODEL_PROBE_TIMEOUT_MS = 15_000

/**
 * One `model/list` row → a neutral {@link ModelChoice}, or `null` for a row a menu must not show.
 *
 * Two ways to be dropped, and they are different: a row with no usable `id` is malformed (an
 * unselectable menu entry is worse than a missing one), and a row the provider marks `hidden` is one
 * it has asked not to be listed. The second is redundant against the real server — 058 measured
 * `model/list` already filtering them unless `includeHidden` is passed, which is why the caller does
 * not pass it — and it stays because "the server filters" is a fact about today's server, while
 * "we never show a row marked hidden" is the rule we actually mean.
 */
function modelChoiceOf(row: unknown): ModelChoice | null {
  if (!isRecord(row)) return null
  if (row['hidden'] === true) return null
  const id = readString(row, 'id') || readString(row, 'model')
  if (!id) return null
  const description = readString(row, 'description')
  // The provider's own words, in the order it offers them: the full migration sentence when there
  // is one, else the bare "there is a successor" fact. Never composed here — 058's dispatch guessed
  // this field meant a plan gate and the probe said deprecation, so phrasing it would risk shipping
  // that guess as a warning.
  const upgradeInfo = row['upgradeInfo']
  const migration = isRecord(upgradeInfo) ? readString(upgradeInfo, 'migrationMarkdown').trim() : ''
  const successor = readString(row, 'upgrade')
  const note = migration || (successor ? `Superseded by ${successor}.` : '')
  // What efforts THIS model accepts, in the server's own order, each with the server's own sentence
  // about it (076). `supportedReasoningEfforts` is `Array<ReasoningEffortOption>` in the vendored
  // protocol — `{reasoningEffort, description}` — and the effort itself is `ReasoningEffort = string`,
  // open by construction. So this is read defensively rather than cast: a row that answers with
  // something unexpected contributes no options rather than an option named `undefined`.
  //
  // ⚠️ **Per MODEL, which is why this hangs off the row.** The same login answers differently for two
  // models, so there is no provider-wide list that would be true — see `ModelChoice.efforts`.
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
  // ⚑ **D-042 · what the row's id points at, when the server says another** (`Model.model`), and
  // ⚑ **R1 — the server's own default, by name** (`Model.isDefault`): its row, chosen by its id.
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

// --- typed request builders (checked against the generated protocol) ---

const CLIENT_INFO: ClientInfo = { name: 'brobot2', title: null, version: '0.0.0' }
const CAPABILITIES: InitializeCapabilities = { experimentalApi: true, requestAttestation: false }

function initializeParams(): InitializeParams {
  return { clientInfo: CLIENT_INFO, capabilities: CAPABILITIES }
}

/**
 * The two approval profiles, defined ONCE (078) so `thread/start`, `thread/resume` and the
 * validator can never disagree about what a mode means — a drift between them is exactly how a
 * session ends up unprotected while still claiming to prompt.
 *
 *  - `ask` — the 001 non-negotiable, unchanged: in-cwd command/file ops escalate to a UI prompt.
 *    Never `never`/`danger-full-access`/`auto_review`, and the reviewer is pinned to `user` so a
 *    host config cannot route escalation to an auto-approver.
 *  - `auto` — the explicit yolo opt-in: no approvals AND no sandbox. The enum strings are the
 *    generated ones (`AskForApproval` includes `'never'`; `SandboxMode` includes
 *    `'danger-full-access'`) — verified against the vendored protocol, not guessed.
 *
 * ## ⛔ 157 moved both modes onto NAMED permission profiles, and 160 moved them back
 *
 * Use the provider's CLI approval presets rather than custom `[permissions.<id>]` exclusions around credential directories such as `~/.codex/auth.json`. Automatic mode follows the CLI's filesystem and network posture instead of adding adapter-specific folder restrictions.
 *
 * ⚑ **What came back with the legacy modes, and it is the point rather than a side effect**: any
 * named profile — including one granting `write` on `/` — runs under a Seatbelt policy, and
 * `danger-full-access` applies none. 157 measured `ps`, `top`, `sudo`, `su`, `crontab`, `at`,
 * `traceroute`, `pgrep` and `sysctl` all failing *"Operation not permitted"* under the profile, and
 * nothing in `[permissions.<id>.filesystem]` grants them back, because they are not filesystem
 * rules. 160 re-measured the same commands under `dangerFullAccess` on the pinned binary: `ps` and
 * `top` exit 0. **An empty deny set would not have bought them back** — the cost was the profile.
 *
 * ⚑ **`ask` is byte-for-byte what it always was** through both changes, which is what 001
 * non-negotiable 1 requires. 157 could not give it the deny set anyway: a single `deny` entry
 * disables approval escalation, so an accepted card did nothing.
 *
 * The app adds no folder restriction above either provider. Codex's sandbox profiles remain `workspace-write` in `ask` and `danger-full-access` in `auto`, matching its CLI presets.
 *
 * ## 🔴 736 · R96 — `ask` is the Codex CLI's DEFAULT preset, not its *Read Only*
 *
 * ⚑ R96: *"BroBot's `ask` on Codex is the Codex CLI's default preset (`workspace-write` +
 * `on-request`), not its Read Only preset. `auto` is unchanged."* ⚑ **Measured** (`736`'s scratch
 * of the Codex terminal, bundled 0.146.0, a trusted folder, no approval or sandbox setting at all):
 * its `/status` reads *"Permissions: Workspace (Ask for approval)"*; a patch inside the folder ran
 * unasked and one outside it was asked. ⛔ Until `736` `ask` was `read-only`, so every in-folder
 * write carded here and ran unasked in a default Codex (`728` F-3).
 *
 * ## 🔴 499 · EXPORTED, for one reader, and the reader is a test
 *
 * ⛔ **`WHAT_STANDS_PAST_ITS_FOLDER` in `approval-mode.ts` says in DATA what the two rows below
 * keep past a conversation's folder on the wire** — `ask` the card and a sandbox, `auto` neither
 * (D-038) — and `spawn-rails.ts` compares two conversations with it. ⚠️ **It cannot import this
 * value**: `codex-runtime.ts` imports {@link ApprovalModeSwitch} from that file, so the arrow already
 * points this way. ⚑ **So the binding is a test that imports both**, and asserts, per mode, that the
 * card is in that table's Codex row **iff** the row's `approvalPolicy` is not `never`, and the
 * sandbox **iff** its `sandbox` is not `danger-full-access`. ⛔ Exported for that reader alone.
 */
export const APPROVAL_PROFILES = {
  ask: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' },
  auto: { approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'danger-full-access' },
} as const satisfies Record<
  ApprovalMode,
  Pick<ThreadStartParams, 'approvalPolicy' | 'approvalsReviewer' | 'sandbox'>
>

/** The profile for a launch context — `auto` only on an exact opt-in, everything else prompts. */
function approvalProfileFor(context: { approvalMode?: ApprovalMode }) {
  return isAutoApprove(context) ? APPROVAL_PROFILES.auto : APPROVAL_PROFILES.ask
}

/**
 * What the app-server said the `ask` sandbox means on THIS thread, if it said (034; 🔴 the
 * `workspace-write` sandbox since `736`, R96 — until then `read-only`).
 *
 * `ThreadStartParams.sandbox` is the bare {@link SandboxMode} string; `TurnStartParams.sandboxPolicy`
 * is the tagged {@link SandboxPolicy} object, and `workspaceWrite` carries four fields the string
 * form has no room for — its extra writable roots, its network flag and its two temp-dir flags. So
 * opening a thread with `'workspace-write'` leaves the server to pick them, and re-pinning the policy
 * every turn means asserting a value for each.
 *
 * We do not assume one. The handshake response and every `thread/settings/updated` echo the
 * EFFECTIVE policy in the tagged form, so the value we re-send is the value the server last
 * reported, which makes the re-pin a no-op by construction rather than by a captured constant. Only
 * a fully-formed `workspaceWrite` echo is remembered; anything else leaves the last good reading in
 * place.
 */
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

/**
 * 🔴 **736 · what `workspace-write` means when the server has not said** — a thread started in
 * `auto` and switched to `ask`, whose handshake echoed `dangerFullAccess`. ⚑ The values bundled
 * 0.146.0 echoes for a thread opened with `sandbox: 'workspace-write'` and no config of its own
 * (measured, `probe:codex-mcp-tool-approval`'s `preset` arm): no extra writable root — the folder
 * itself is writable by the mode — no network, and neither temp dir excluded.
 */
const WORKSPACE_WRITE_UNSAID: WorkspaceWritePolicy = {
  type: 'workspaceWrite',
  writableRoots: [],
  networkAccess: false,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false,
}

/** The `ask` sandbox's tagged form — the one {@link askPolicyOf} remembers and a turn re-pins. */
type WorkspaceWritePolicy = Extract<SandboxPolicy, { type: 'workspaceWrite' }>

/**
 * The same sandbox, in the shape `turn/start` takes (034) — 🔴 **and, since W4.189, this turn's work
 * folders as extra writable roots** ({@link ProviderRuntimeContext.workFolders}).
 *
 * `baseline` is what the server reported for this thread with every work folder taken out (see
 * {@link askBaselineOf}); the fallback is {@link WORKSPACE_WRITE_UNSAID}, for a server that never
 * echoed one. ⚑ The work folders follow the baseline's own roots, once each, and the three flags are
 * the baseline's as reported. ⛔ **`auto` carries none**: `dangerFullAccess` can already write
 * everywhere, so a root there would mean nothing — the caller passes none ({@link workRootsFor}).
 *
 * Deliberately narrow: only the two modes {@link APPROVAL_PROFILES} can produce. The parameter type
 * makes a third one a compile error rather than a runtime surprise.
 */
function sandboxPolicyOf(
  sandbox: 'workspace-write' | 'danger-full-access',
  baseline: WorkspaceWritePolicy | null,
  workRoots: readonly string[],
): SandboxPolicy {
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' }
  const policy = baseline ?? WORKSPACE_WRITE_UNSAID
  return { ...policy, writableRoots: [...new Set([...policy.writableRoots, ...workRoots])] }
}

/**
 * 🔴 **W4.189 · the `ask` sandbox a work folder is added TO — and that taking one away falls back
 * to.**
 *
 * ⚠️ **The trap it closes**: the baseline is the server's own echo ({@link askPolicyOf}), and a
 * `turn/start` that carried work folders — or a thread opened with them ({@link threadConfigOverlay})
 * — is echoed back WITH them among its `writableRoots` (`thread/settings/updated`, the handshake).
 * Taken as it came, that echo would put a folder the person had taken away back on every later turn:
 * the removal would never reach the provider.
 *
 * ⚑ **The rule**: a root this handle has EVER sent as a work folder (`sent`) is not the baseline's —
 * unless the server reported it before this handle had sent any work folder at all (`theThreadsOwn`),
 * which makes it the thread's own (its home's `config.toml`, its default) rather than ours. Only the
 * roots are filtered: `networkAccess`, `excludeTmpdirEnvVar` and `excludeSlashTmp` are the server's,
 * as reported. ⚑ "Ever sent" rather than "sent last": an echo can lag a turn, and a folder two
 * changes old is still ours.
 *
 * ⚠️ **Its limits, named.** A thread OPENED with work folders has no reading from before them, so a
 * root its config also lists goes with the grant when the grant is removed — narrower than the
 * config, never wider. Paths are matched as spelled; the folders come from this app, already
 * absolute, and an echo that re-spelled one would leave it on — ⛔ unmeasured on 0.160.0.
 */
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

/**
 * 🔴 **W4.189 · the work folders a request in this mode carries**: all of them in `ask`, as extra
 * writable roots of its `workspace-write` sandbox, and none in `auto`, whose `danger-full-access`
 * they would add nothing to.
 */
function workRootsFor(
  approvalMode: ApprovalMode | undefined,
  folders: readonly string[],
): readonly string[] {
  return approvalProfileFor({ approvalMode }).sandbox === 'workspace-write' ? folders : []
}

/**
 * 🔴 **Codex's planning checklist, turned back on for every agent BroBot runs** (provider follow-ups 1,
 * W4's ruling on the 0.160.0 bump).
 *
 * ⚑ Codex 0.152.0 turned its planning tool off by default (*"enable it with
 * `tools.update_plan.enabled = true`"*), so an agent stopped sending `turn/plan/updated` and the
 * conversation's checklist went quiet. This puts the tool back — `probe:codex-plan-tool` measured
 * `update_plan` absent from the model-bound request without it and present with it, on a start and
 * on a resume that re-sends it.
 *
 * ⛔ **A config OVERLAY on the thread, never a line in a file.** It rides `config` on `thread/start`
 * and `thread/resume` beside the granted MCP servers ({@link codexExternalMcpConfig}): nothing is
 * written into the profile's `config.toml`, which Codex co-owns, and nothing into `~/.codex`. One
 * DOTTED key, so it sets exactly that leaf and no other `tools` setting.
 */
export const CODEX_PLAN_TOOL_CONFIG = { 'tools.update_plan.enabled': true } as const

/**
 * ⚑ **Codex's own question tool, turned off for every agent this app runs.** An agent asks through
 * `ask_question`, which this app tracks and routes; a `request_user_input` card is neither.
 *
 * ⚑ The key is Codex's own: its tool plan registers `request_user_input` only where
 * `tools.experimental_request_user_input.enabled` is not `false` (0.160.0's `spec_plan.rs` and
 * `config.schema.json`). ⚠️ `request_user_input_async` has no such key there: Codex offers it by
 * the model's own catalogue, so it stays. ⛔ An overlay on the thread, as
 * {@link CODEX_PLAN_TOOL_CONFIG} is, and for its reasons.
 */
export const CODEX_QUESTION_TOOL_CONFIG = {
  'tools.experimental_request_user_input.enabled': false,
} as const

/** Codex's own tools {@link CODEX_QUESTION_TOOL_CONFIG} turns off, by Codex's names. */
export const CODEX_TOOLS_TURNED_OFF: readonly string[] = ['request_user_input']

/**
 * Codex's own question tool this app has no switch for, and leaves on: offered where the model's
 * own catalogue lists it. It posts its questions in a message of the agent's.
 */
export const CODEX_TOOLS_LEFT_ON: readonly string[] = ['request_user_input_async']

/**
 * The overlay a thread is opened with: the planning tool on and Codex's own question tool off,
 * always; the granted servers if any — 🔴 and,
 * since W4.189, its work folders if any, as `sandbox_workspace_write.writable_roots`.
 *
 * ⚑ **Why the folders ride the THREAD too, when every `turn/start` already carries them**
 * ({@link sandboxPolicyOf}): the thread's own sandbox is what a handshake reports and what anything
 * that runs before the first turn runs under, so the two agree from the start. `workRoots` is empty
 * in `auto` ({@link workRootsFor}), and absent the key is not written at all. ⚠️ **One dotted key
 * SETS that leaf**: a `writable_roots` the home's `config.toml` listed is replaced for this thread
 * while it holds a work folder — BroBot writes none there, and a later turn's `sandboxPolicy`
 * overrides the thread's either way.
 */
function threadConfigOverlay(
  externalMcp: ExternalMcpReach | undefined,
  kept: readonly KeptToolApproval[],
  workRoots: readonly string[],
): { [key in string]?: JsonValue } {
  const overlay: { [key in string]?: JsonValue } = {
    ...CODEX_PLAN_TOOL_CONFIG,
    ...CODEX_QUESTION_TOOL_CONFIG,
    ...(codexExternalMcpConfig(externalMcp, kept) ?? {}),
  }
  if (workRoots.length > 0) overlay['sandbox_workspace_write.writable_roots'] = [...workRoots]
  return overlay
}

function threadStartParams(
  cwd: string,
  model: string | undefined,
  systemHint: string | undefined,
  approvalMode: ApprovalMode | undefined,
  dynamicTools: DynamicToolSpec[] | undefined,
  externalMcp: ExternalMcpReach | undefined,
  /** 🔴 736 · R95 — the *Always allow*s kept in this home ({@link keptToolApprovals}). */
  kept: readonly KeptToolApproval[] = [],
  /** 🔴 W4.189 — the launch's work folders, in `ask` only ({@link workRootsFor}). */
  workRoots: readonly string[],
): ThreadStartParams {
  const params: ThreadStartParams = { cwd, ...approvalProfileFor({ approvalMode }) }
  if (model) params.model = model
  // 🔴 **605 · the servers a person granted this identity** — see {@link codexExternalMcpConfig}
  // for the four-arm measurement that found this door and for why it is not the home's
  // `config.toml` — and the planning tool, on every thread ({@link CODEX_PLAN_TOOL_CONFIG}), and
  // (W4.189) the work folders, so the thread's sandbox and its first turn's agree.
  params.config = threadConfigOverlay(externalMcp, kept, workRoots)
  // 🔴 **The five tools, and the ONLY place this adapter declares them** (348).
  //
  // ⛔ **`thread/resume` takes none, and it does not need to.** `ThreadResumeParams` has no such
  // field; the app-server remembers a thread's dynamic tools in its own `thread_dynamic_tools`
  // table, and `probe:codex-dynamic-tools` arm D measured a SECOND app-server process resuming this
  // thread and rebuilding the same inventory. ⚠️ So the resume path deliberately sends nothing, and
  // a reader who expects the symmetry the Claude adapter has should read that arm before adding it:
  // there is no field to add it to, and nothing to fix.
  if (dynamicTools) params.dynamicTools = dynamicTools
  // The neutral `StartOptions.systemHint` → Codex's DEVELOPER instructions (056,
  // closing 044 P2 #6). `developerInstructions` is the additive developer-message
  // layer; `baseInstructions` is deliberately NOT used — it REPLACES the agent's base
  // prompt, which would strip the built-in tool guidance the model reads.
  // Same additive semantics as the Claude side's appended system prompt.
  // Omitted hint → the field is absent, so the params are unchanged from before.
  //
  // 🔴 **555 · that clause used to say the 001 PROFILE relies on it, and HO-062 §2 withdraws
  // the framing:** *"The factory layer carries BEHAVIOUR. Safety lives in the rails."* ⛔ **The
  // profile is three fields on this same object** — {@link APPROVAL_PROFILES} puts `approvalPolicy`,
  // `approvalsReviewer` and `sandbox` into these very `ThreadStartParams`, and `baseInstructions`
  // touches none of them. ⚠️ What replacing the base prompt would cost is what the model KNOWS about
  // its own tools, which is a degradation and not a lost door.
  //
  // ⚠️ **And the LIMIT on this layer, which is the half a reader here will not otherwise find:** a
  // `collaborationMode` update TAKES PRECEDENCE over developer instructions, so anything sent in
  // this field stops being in force from the first mode switch onwards. ⚑ See
  // {@link collaborationModeFor}, which measured it, for what that costs and why nothing can be
  // passed in `developer_instructions` to prevent it.
  if (systemHint) params.developerInstructions = systemHint
  return params
}

/** A launch's phase sink that never throws into the launch it reports on. */
function phasesOf(sink: StartPhaseSink | undefined): StartPhaseSink {
  return (phase, detail) => {
    try {
      sink?.(phase, detail)
    } catch {
      // Reporting a phase must never stop the launch it reports on.
    }
  }
}

/** The home's boot gate let go, said once however often it is let go. */
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
  /** 🔴 736 · R95 — the *Always allow*s kept in this home, as on a start. */
  kept: readonly KeptToolApproval[] = [],
  /** 🔴 W4.189 — the work folders this launch carries, in `ask` only, as on a start. */
  workRoots: readonly string[],
): ThreadResumeParams {
  // The mode is re-applied on RESUME (078): a resumed yolo session that fell back to `ask` would
  // start prompting unexpectedly, and the reverse would be far worse.
  //
  // So is the MODEL (038). `ThreadResumeParams` lists it under "Configuration overrides for the
  // resumed thread". ⚠️ **682 · omitting it does NOT fall back to the app-server's default**, which
  // this said until `677` measured it (`codex-resume-model-probe.smoke.ts`, step D1): a thread
  // resumed with no model continues on the model it last ran, and one resumed with a model switches
  // and stays switched. Omitted when nobody chose, so a session that never asked still doesn't.
  //
  // …and the INSTRUCTIONS, when the caller sends any (158) — the same additive developer layer
  // `thread/start` uses, never `baseInstructions`. Absent hint → absent field, so a resume that
  // was given nothing sends nothing and the thread keeps whatever it had.
  //
  // 🔴 **…and the granted external MCP servers, RE-DECLARED** (605). ⛔ **Unlike `dynamicTools`,
  // which `348` measured surviving in the app-server's own `thread_dynamic_tools` table, this is
  // a CONFIG OVERLAY and `ThreadResumeParams` carries the field on purpose** — *"Configuration
  // overrides for the resumed thread, if any."* ⚠️ A resume that dropped it would reopen a
  // conversation whose sheet still shows the grant, so the two would disagree about the same
  // identity. ⚑ Re-read from the store at this launch rather than replayed, exactly as the model
  // and the approval profile are.
  const params: ThreadResumeParams = {
    threadId,
    cwd,
    // The thread's turns are never read here, and asking for them makes Codex rebuild every past
    // turn and item before it answers, a cost that grows with the conversation. The model's own
    // context is restored either way.
    excludeTurns: true,
    ...approvalProfileFor({ approvalMode }),
    ...(model ? { model } : {}),
    ...(systemHint ? { developerInstructions: systemHint } : {}),
  }
  // ⛔ **Written plainly and never through a conditional spread** — a spread writes past the
  // declared type and no source census can see what it added
  // (`a-spread-writes-past-a-declared-type`). ⚑ The planning tool is re-sent too: an overlay is
  // this thread's configuration for THIS app-server, and a resume is a new one. 🔴 **W4.189 · and so
  // are the work folders**, for the same reason: a resume that dropped them would reopen without its
  // grants until its first turn re-pinned them.
  params.config = threadConfigOverlay(externalMcp, kept, workRoots)
  return params
}

/**
 * What the SERVER said, shaped for {@link AgentInfo} (024).
 *
 * Codex's values are genuine reports — the handshake response and `thread/settings/updated` both
 * come from the running thread — so anything with an effort in it is flagged as reported. Claude
 * reports its effort only as a turn ends, so until then the same field is our request there.
 * An absent effort sets no flag, because "not reported" must stay distinguishable from "reported".
 */
function reportedAgentInfo(model: string | undefined, effort: string | undefined): AgentInfo {
  return {
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort, reasoningEffortReported: true } : {}),
  }
}

/**
 * 🔴 **D-039 · R2 — what a launch that did not come up met, as the type the app reads.**
 *
 * - **The app-server refused a request of this launch**: the provider refused to start the
 *   conversation ({@link StartRefused}), carrying the refusal's own words without its envelope.
 *   ⚑ The requests a launch awaits are `initialize` and `thread/start` (or `thread/resume`); the
 *   sign-in probe answers rather than throws. ⚑ **F055 is the case it was written for**:
 *   `thread/start` refused `{"code":-32600,"message":"dynamic tool namespace description must be at
 *   most 1024 characters"}`, and that envelope was what a person and a giver read.
 * - **The app-server exited before it answered** ({@link CodexExited}): {@link StartFailed}, the
 *   exit's own message for the log. ⚑ A handshake check this adapter refused throws that type itself
 *   (`validateProtocolVersion`, `validateCodexHome`, `validateHandshake`, `validateApprovalProfile`).
 *
 * ⛔ Anything else is returned as it came: a spawn's errno (its readers take the code), a sign-in
 * (`AuthUnavailableError`), this app's own close of the transport (a cancel, a deadline).
 */
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

/**
 * The collaboration mode this turn asserts (057, 060) — or `undefined` for a session that has never
 * planned, which sends **no `collaborationMode` at all**.
 *
 * ⚠️ **Switching to `{mode:'default'}` IS the "developer message" the server is waiting for, and
 * that is measured, not assumed** (060). The plan-mode instructions the server injects say *"You are
 * in Plan Mode until a developer message explicitly ends it"*; nothing in the client can write a
 * developer-role message (`UserInput` has no such variant), so the question was whether the mode
 * switch alone ends it. Two threads on the bundled 0.146.0 binary, same prompt, same read/write
 * sandbox, `approvalPolicy: 'never'` so nothing could be blamed on a prompt:
 *
 * | turn 2 sent | plan documents | commands | patches | the file |
 * |---|---|---|---|---|
 * | *(no `collaborationMode`)* | **1** — it re-planned | 0 | 0 | unchanged |
 * | `{mode:'default', settings:{…}}` | 0 | 1 | **1** | **written** |
 *
 * Both turns said `Go ahead — do it now.` The control is the important half: it reproduces 057's
 * gap exactly — asking a planning conversation to execute gets you another plan — so the switch is
 * doing the work, and no sentence of ours needed to be put in the conversation's mouth.
 *
 * ⚠️ **This is the field 030 said did not exist and 044 found in the vendored types. 057 is the
 * first time anyone asked the SERVER.** The probe, against the bundled 0.146.0 binary with an
 * isolated `CODEX_HOME`:
 *
 * ```
 * → {"method":"collaborationMode/list","params":{}}
 * ← {"data":[{"name":"Plan","mode":"plan","model":null,"reasoning_effort":"medium"},
 *            {"name":"Default","mode":"default","model":null,"reasoning_effort":null}]}
 * ```
 *
 * So it is implemented, not merely declared — and `thread/settings/updated` then echoed our own
 * `{mode:"plan"}` back with 9,156 characters of server-written plan-mode instructions filled in
 * where we sent `developer_instructions: null`.
 *
 * **Three things about the shape are not guesses, and each one bit.** The same probe sent six
 * candidate payloads against a deliberately bogus thread id — params are deserialized before the
 * thread is looked up, so the error message says which layer rejected it, and no turn ever runs:
 *
 * | sent | server said |
 * |---|---|
 * | `{mode}` | `missing field 'settings'` |
 * | `{mode, settings:{}}` | `missing field 'model'` |
 * | `settings.model: null` | `invalid type: null, expected a string` |
 * | `settings` complete | *(passed params, failed on the thread id — accepted)* |
 * | `{mode:'brainstorm'}` | `unknown variant, expected one of 'plan', 'code', 'custom', 'default', 'execute', 'pair_programming'` |
 *
 * 1. **`settings` is REQUIRED and `settings.model` is a REQUIRED non-null string.** You cannot ask
 *    for plan mode without naming a model — which is awkward here, because "we did not ask for a
 *    model" is a state this app deliberately preserves ({@link ProviderRuntimeContext.model}). The
 *    way out is not to invent one: `reported` is the model the SERVER named at the handshake, so
 *    what we send back is its own answer. A session with no reported model cannot enter plan mode
 *    and says so — see the throw in `send()`, which is loud on purpose. A plan-mode session that
 *    quietly ran without plan mode is the "toggle that silently does nothing" this task forbids.
 * 2. **It TAKES PRECEDENCE over `model`, `effort` and developer instructions** — the protocol says
 *    so at `TurnStartParams.collaborationMode` and this is why the same three fields are echoed
 *    into it rather than left null. That makes the override a no-op by construction, the same
 *    reasoning {@link askPolicyOf} uses for the sandbox: the value we re-send is the value that
 *    would have applied anyway, so nothing moves because we asked for plan mode.
 *
 *    ⚠️ **Which is why this takes what the turn INTENDS, not what the server last reported** (076).
 *    Until 076 the model and effort here were `AgentInfo`'s — the server's own last answer — and that
 *    was right while nothing could change them mid-conversation. The moment `setModel` and
 *    `setReasoningEffort` existed it became a silent trap: a planning session would put the user's
 *    new effort in `TurnStartParams.effort`, then override it from this object with the old reported
 *    one, and the control would do nothing on exactly the sessions plan mode was on. Documented
 *    precedence is what makes it silent — the server does what it was told, twice, and the second
 *    telling wins. The call site computes both values ONCE and passes them here and to
 *    {@link turnStartParams} together, so the two cannot drift again; the fallback to the reported
 *    value stays, because `settings.model` is a required non-null string and "we did not ask" has to
 *    resolve to something the server itself named.
 * 3. **`developer_instructions: null` is the one field we deliberately leave null**, because the
 *    protocol defines null as *"use the built-in instructions for the selected mode"* and the probe
 *    watched the server fill it with its own 9 KB plan-mode prompt. Putting a `systemHint` there
 *    would REPLACE that prompt with our sentence and quietly turn plan mode off while the setting
 *    still said `plan`.
 *
 * ⚠️ **And for `default` the same null is not a convention — it IS the ending** (060 review). The
 * review asked what null means for the mode 057 never measured, which was the right question and
 * the answer is decisive. `thread/settings/update` echoes the effective instructions back, so it
 * costs no turn to ask; the server fills default's null with 925 characters that open:
 *
 * ```
 * # Collaboration Mode: Default
 * You are now in Default mode. Any previous instructions for other modes (e.g. Plan mode) are no
 * longer active.
 * ```
 *
 * **That sentence is the "developer message" plan mode was waiting for.** So the obvious hardening
 * — pass our own instructions here instead of null, to stop the mode switch overwriting them —
 * would delete the feature: the same probe sent a marker string in that field and got the marker
 * back, alone, with the ending sentence gone. Null is load-bearing in both modes, for two different
 * reasons.
 *
 * What the mode switch really costs, measured rather than feared: any `developerInstructions` sent
 * at `thread/start` stop being in force from the switch onwards. That is **latent, not live** — the
 * app sends Codex no hint at all, and `AGENTS.md` is untouched by any of this. It is written down
 * here so that whoever first sends Codex a hint finds this instead of the bug.
 *
 * ⛔ **555 · the reason that sentence gives was RE-DERIVED, because the one it used to give had
 * died.** It read *"`workspaceSystemHint` returns undefined for this provider"* — and 158 deleted
 * that function; `workspace.ts` keeps its note where the code was
 * (`a-number-can-survive-the-death-of-its-derivation`, one turn later at sentence scale). ⚑ **The
 * fact survived the derivation and is still true, from today's source**: the composition root
 * passes Codex no `systemHint` — `readSessionInstructions`' Codex arm answers
 * `SessionLaunchRead.systemHint: null` — and `if (systemHint)` in `threadStartParams` leaves the
 * field absent. ⚠️ **So the exposure is latent for one reason and not the other**, and whoever
 * makes it live will be editing that arm rather than a deleted special case.
 *
 * 🔴 **D-024 · R1 composes Codex one text, and kept this latent on purpose.** What is true of one
 * conversation — who started it, its root, its grants, its profile's other conversations — cannot
 * live in the profile's shared `AGENTS.override.md`, so it rides in front of the first message of
 * each life (`SessionLaunchRead.firstTurnLead`), where no mode switch reaches it. ⚑ Sent here it
 * would have been dropped by the first switch, and a resume's copy never reaches the model at all
 * ({@link threadResumeParams}'s call site).
 *
 * 🔴 **This is also the LIMIT HO-062 §2 asks to be stated beside the guarantee**, and the trigger
 * for measuring it is in `apps/desktop/src/main/runtime/factory-text.ts` beside the table of what
 * dropping factory text costs. ⛔ **Do not measure it now** (HO-062 §1): wait for the symptom.
 *
 * ⚠️ **At this version the vendored `ModeKind` is NARROWER than the server's.** Our generated type
 * says `"plan" | "default"`; the rejection above listed six variants. Which way that gap runs is
 * itself a fact about one binary — a later one could narrow, rename or widen the set — so what to
 * take from it is not "the server has six modes" but that the generated types are a real artefact
 * and still not the last word. 056's environment-fact lesson, arriving for the second time, on the
 * other provider, in the same week.
 */
function collaborationModeFor(
  phase: PlanPhase,
  intended: { model?: string; effort?: string },
): CollaborationMode | undefined {
  if (phase === 'never') return undefined
  // Unreachable through `send()`, which throws first with a message a user can act on; the guard is
  // here so the type is honest at its own boundary rather than asserted at the call site.
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

/**
 * Where a session stands with respect to plan mode (060) — three states, because two of them are
 * the same boolean and mean opposite things on the wire.
 *
 * ⚠️ **`never` and `left` are BOTH "not planning" and they are not interchangeable.** The thread's
 * `collaborationMode` is sticky server-side, so a session that has left plan mode must keep SAYING
 * so; a session that never entered it must stay silent, because sending any mode at all overrides
 * the thread's developer instructions and would wipe a {@link StartOptions.systemHint} — the
 * workspace instructions 006 maintains. One boolean cannot carry that, which is why the launch
 * context takes two ({@link ProviderRuntimeContext.planModeEnded}).
 */
type PlanPhase =
  /** Never asked to plan: no `collaborationMode` on any turn, and the quiet path stays quiet. */
  | 'never'
  /** Planning: `{mode:'plan'}` on every turn. */
  | 'planning'
  /** Planned, then given the go-ahead: `{mode:'default'}` on every turn. */
  | 'left'

/** The phase a launch context describes — see {@link PlanPhase} for why it takes two fields. */
function planPhaseOf(options: { planMode?: unknown; planModeEnded?: unknown }): PlanPhase {
  // Exact-match on both, so a malformed value can only ever mean "not planning" / "not ended".
  if (options.planMode !== true) return 'never'
  return options.planModeEnded === true ? 'left' : 'planning'
}

function turnStartParams(
  threadId: string,
  /** The words handed over; `null` hands nothing new, and the model answers what the thread holds. */
  text: string | null,
  effort: ReasoningEffort | undefined,
  approvalMode: ApprovalMode,
  /** The server's `ask` sandbox, less every work folder ({@link askBaselineOf}). */
  askBaseline: WorkspaceWritePolicy | null,
  /** 🔴 W4.189 — the work folders this turn adopted, in `ask` only ({@link workRootsFor}). */
  workRoots: readonly string[],
  collaborationMode: CollaborationMode | undefined,
  model: string | undefined,
): TurnStartParams {
  // Re-pin the WHOLE approval profile per turn, not just the reviewer (034). Two reasons, and the
  // second is the one that made this necessary:
  //
  //  1. It closes the same hole the reviewer pin closes, for the other two fields: nothing else
  //     re-asserted the policy or the sandbox after the handshake, so a mid-session override could
  //     move them and only `thread/settings/updated` would catch it.
  //  2. It is HOW the mode changes mid-conversation. `TurnStartParams` documents these as
  //     overrides "for this turn and subsequent turns", and the 034 probe measured that on the live
  //     app-server in both directions — a turn started with the yolo profile ran its command with
  //     no approval, and the next turn started with the prompting profile prompted again. There is
  //     no mid-turn path: the same probe sent a `thread/settings/update` DURING a turn, watched the
  //     server accept it and echo `thread/settings/updated` with the new profile, and watched the
  //     very next command in that same turn prompt anyway.
  //
  // The value is the EFFECTIVE mode, adopted in `send()` in the same step that calls this, so what
  // the provider is told and what our disclosures claim are decided together or not at all.
  //
  // Effort rides here because `TurnStartParams.effort` is the one field the vendored protocol
  // gives it — `ThreadStartParams` has none of its own. The protocol documents it as "override the
  // reasoning effort for this turn and subsequent turns", which is why re-sending it every turn is
  // harmless. ⚑ **D-042 · and the thread is named it too**, through the config overlay
  // `thread/start` and `thread/resume` take (`config.model_reasoning_effort`, measured — see
  // `CodexSessionHandle.openTheThread`), so the handshake and a compaction before the first turn
  // run at it as well.
  //
  // What makes the value a provider-confirmed FACT rather than our request is that Codex reports
  // it back — on the handshake response (`thread/start` and `thread/resume` both carry
  // `reasoningEffort`, read at `begin()`) and again on `thread/settings/updated`. Either source
  // flags it reported. That is the thing Claude's SDK cannot do at all.
  //
  // Omitted when nobody chose, so the server's own configured default survives untouched.
  const profile = approvalProfileFor({ approvalMode })
  return {
    threadId,
    approvalPolicy: profile.approvalPolicy,
    approvalsReviewer: profile.approvalsReviewer,
    // `ThreadStartParams` spells it `sandbox` and takes the bare mode; `TurnStartParams` spells it
    // `sandboxPolicy` and takes the tagged object. Same profile, two shapes — which is exactly why
    // the profile is defined once and translated here rather than written out twice. 🔴 W4.189 — and
    // the work folders ride it, as writable roots, for the reason the profile does: an override
    // *"for this turn and subsequent turns"* is how a list changes between turns, removal included.
    sandboxPolicy: sandboxPolicyOf(profile.sandbox, askBaseline, workRoots),
    input: text === null ? [] : [{ type: 'text', text, text_elements: [] }],
    ...(effort ? { effort } : {}),
    // The model rides here for exactly the reason the effort does, and 076 is when it started to:
    // `TurnStartParams.model` is documented as an override "for this turn and subsequent turns", so
    // re-sending it every turn is harmless and it is the only path a mid-conversation change needs.
    // Before 076 the model was sent once, at `thread/start`/`thread/resume`, which is why changing it
    // meant starting a new conversation.
    //
    // ⚠️ **Omitted when nobody chose, and that is load-bearing rather than tidy.** Filling it with
    // the model the server REPORTED would convert "we did not ask" into "we asked for exactly this",
    // and the whole point of `AgentInfo` being a provider report is that those stay distinguishable
    // (081/082). The one place the reported model is legitimately echoed is `collaborationMode`,
    // where the protocol requires a non-null string — see the call site, which passes a different
    // value here and there for this reason.
    ...(model !== undefined && model !== '' ? { model } : {}),
    // Plan mode rides here for the same reason the approval profile does: `turn/start` is where the
    // protocol takes an override, and re-sending it every turn is what keeps the thread's sticky
    // setting and our session flag from drifting apart. A session that has LEFT plan mode keeps
    // asserting `{mode:'default'}` for that same reason (060) — the sticky value would otherwise be
    // whatever the last turn that landed set, and a `turn/start` that never landed would leave the
    // thread planning while the session believed it had stopped. Absent for a session that never
    // planned: sending a mode at all overrides the thread's model, effort AND developer
    // instructions, so the quiet path must stay quiet. See {@link collaborationModeFor}.
    ...(collaborationMode ? { collaborationMode } : {}),
    // Ask for a reasoning summary on every turn (027). WITHOUT this, Codex reasoning items arrive
    // `{summary:[], content:[]}` — captured live — and the thinking view is an empty box; with it,
    // `item/reasoning/summaryTextDelta` streams real text. A thinking indicator that only
    // sometimes has anything to show is worse than the small token cost, so it is unconditional
    // and lives in ONE constant so it is trivial to revisit.
    summary: REASONING_SUMMARY,
  }
}

/**
 * How much reasoning summary to ask Codex for (027). `detailed` because the summaries are short
 * headline lines either way, and the alternative — `auto` — is the server's discretion about
 * whether to send anything at all, which is exactly the "sometimes empty" failure this exists to
 * avoid. Note the server never delivers `content` (the raw chain of thought) regardless: this buys
 * a summary, not the thinking itself.
 *
 * Measured against the live app-server, same prompt, one turn each:
 *  - field OMITTED (what we had): **0** `summaryTextDelta` — the empty box this exists to fix.
 *  - `none`: **0**, identical. Omitting it was never a neutral default; it was `none`.
 *  - `detailed`: words — "**Formulating state notation and safety rules**".
 * The cost was in the noise: reasoning tokens ran 50 / 93 / 96 across the three, with the SUMMARISED
 * turn in the middle, so one sample cannot separate it from run-to-run variance. The summary text
 * itself was 47 characters.
 *
 * ⚠️ Do not check this against the rollout file. Its `turn_context` records `summary:"auto"` on
 * every turn regardless of what we send — it logs the thread's configured default, not the per-turn
 * override — so it reads as though the field were ignored. The wire says otherwise.
 */
const REASONING_SUMMARY: ReasoningSummary = 'detailed'

function turnInterruptParams(threadId: string, turnId: string): TurnInterruptParams {
  return { threadId, turnId }
}

/**
 * The internal key for a provider (JSON-RPC) server-request id (045, fixing 044 P1-B).
 *
 * `RequestId` is `string | number`, so numeric `1` and string `"1"` are **distinct** requests in
 * the protocol domain. Keying them with `String(id)` erased that type: the two collided, one card
 * was published, one response written, and the other request **hung** with no reply. This key
 * includes the type, so the mapping is injective — `typeof` is one of exactly two literals
 * (`number`/`string`) and everything after the first `:` is the raw id, so no id of one type can
 * ever spell the key of the other, and two ids of the same type differ iff their keys differ.
 *
 * Used for EVERY id-keyed structure (claim, response tombstone, broker reservation, approval
 * metadata) **and** as the UI-facing card id, so answering a card round-trips to exactly one
 * request. The RAW id is what goes on the wire — see {@link CodexSessionHandle.respondToProvider}.
 */
function requestKey(id: string | number): string {
  return `${typeof id}:${id}`
}

/**
 * The numeric id a {@link requestKey} encodes, or `null` for a string id (057). Type-preserving
 * by construction: only a key built from a real `number` can yield one, so string `"7"`
 * (`string:7`) never collapses into numeric `7` (`number:7`) — 045's distinction survives
 * retirement.
 */
function numericIdFromKey(key: string): number | null {
  if (!key.startsWith('number:')) return null
  const value = Number(key.slice('number:'.length))
  return Number.isFinite(value) ? value : null
}

/**
 * The FIRST-CLASS turn content that maps to neutral turn events — agent-message deltas and
 * item lifecycle (`AgentMessageDeltaNotification`, `ItemStartedNotification`,
 * `ItemCompletedNotification`), all carrying `threadId` + `turnId`. These are honored only
 * when the TURN id matches the response-bound turn, so a stale/duplicate for an old turn is
 * never mis-attributed as the current turn's assistant text or tool activity (037). ⚠️ **The
 * thread half of that sentence moved in 200** — it is now asked of every notification, by
 * {@link CodexSessionHandle.namesForeignThread}, rather than of these nine. Other
 * turn-scoped notifications (reasoning/plan/command-output deltas) normalize to opaque
 * `unknown{raw}` regardless of turn and are intentionally NOT gated here — they carry no
 * first-class content and cannot bind or terminalize a turn; per-turn attribution of that
 * diagnostic stream is a deferred hardening, out of P1-C scope.
 */
function isTurnScopedContent(method: string): boolean {
  return TURN_SCOPED_METHODS.has(method)
}

/**
 * Every notification whose content is attributed to a SPECIFIC turn, and is therefore honored only
 * when its `turnId` matches the response-bound turn. ⛔ **Membership is the right shape for THIS
 * question and the wrong shape for thread scope** (200): whether a stale frame can hurt is a
 * judgement about what each method drives, but whether a frame belongs to this conversation at all
 * is answered by the frame itself — see {@link THREAD_SUBJECT_METHODS}.
 *
 * The first three were always here. The two reasoning-summary methods HAD to join them: they were
 * exempt only because they normalized to opaque `unknown{raw}` that "carries no first-class content
 * and cannot bind or terminalize a turn" — true while nobody read them, false the moment 027
 * promoted them into `thinking`. A late `summaryTextDelta` from a finished turn would otherwise
 * append to the thinking of the turn now running.
 *
 * `turn/plan/updated` joined them in 028 for exactly the same reason, and is the sharpest case of
 * it: the plan is stated WHOLESALE, so a single late notification from a finished turn does not
 * merely add a stale line — it OVERWRITES the running turn's checklist with the old turn's, and the
 * user has no way to tell. 027 left the set at seven without it, which is precisely the trap the
 * paragraph below warns about, sprung one task later.
 *
 * The two after it are gated by CHOICE, not necessity, and the difference is worth keeping straight:
 * nothing promotes them, so a leaked one still lands as an inert `unknown` item that cannot touch
 * the pill, the thinking block or the checklist. They are here because a stale event is wrong
 * wherever it surfaces, and because a method that carries a turn id and is deliberately left ungated
 * is a trap for whoever promotes it next. Every method listed here was confirmed live to carry both
 * `threadId` and `turnId`, so gating them is possible as well as defensible.
 *
 * `thread/status/changed` is deliberately NOT here, and must not be added: it carries a `threadId`
 * and NO `turnId`, because it describes the thread rather than a turn. Gating it on a turn id it
 * does not have would drop it entirely. It may inform session-level status; it may never drive a
 * turn-scoped indicator.
 *
 * 033 turned that exemption from harmless into load-bearing, so it is worth being precise about why
 * it stays safe. The threadId it carries is the SUB-AGENT's, not this session's, and it is the only
 * signal Codex sends that a dispatched agent has finished; adding this method to the set would gate
 * it on a turn id it does not have AND on a thread id it deliberately does not match, dropping every
 * ending. What keeps it honest is not the gate but the correlation.
 *
 * ⚠️ **135 loosened that correlation, and the replacement argument is the connection rather than
 * the announcement.** `CodexSubAgents` used to act only on a thread this session was TOLD about; it
 * now also opens a card for a thread that goes `active` having been announced to nobody, because a
 * grandchild is announced to its parent — a child of ours, on a connection we do not hold — and
 * therefore never to us. What makes that safe is that this transport spawns its own `app-server`
 * per session and opens exactly one thread on it, so every thread it can ever mention is that
 * thread or a descendant of it. The one thread that is NOT a descendant is our own, and
 * `CodexSubAgents` is given its id precisely so it can refuse that one — the case
 * `codex-sub-agents.test.ts` asserts in both directions. A shared or multiplexed transport would
 * break this argument, and is the thing to re-measure if one is ever introduced.
 *
 * The sub-agent BIRTH needs no new entry either: it arrives as an ordinary `subAgentActivity` item
 * on `item/started`, which is already the first thing in this set, carrying the parent's threadId
 * and the running turnId (both verified on the wire). A birth from a stale turn is therefore already
 * dropped, and `codex-runtime.test.ts` asserts it.
 *
 * ⛔ **`item/fileChange/patchUpdated` joined the set in 184, and it is the first entry here that is
 * not about what the user SEES.** It normalizes to the same inert `activity` its neighbours do, so on
 * that ground alone it would sit in the gated-by-choice group. It is here on a stronger one: it is
 * the one method {@link PatchTargets} reads that was outside the gate, which made it the only way a
 * frame from a foreign thread or a finished turn could reach the tracker at all — either to replace
 * the running turn's entry with a benign path, or simply to fill the 64 slots and evict it (182 H3).
 * ⚑ **The three-field key already refuses to CONFUSE such a frame with the active one; the gate is
 * what stops it entering.** 182's words for the state before this line existed were exact: *"a frame
 * that never arrives and is also ungated is the worst of both."* It has still never arrived — 096's
 * 458,200 frames, 181's two runs, and four more in 184 (383 frames of approval capture, plus a
 * four-file edit turn counted at the TRANSPORT) all measured zero — so nothing that has ever been
 * observed changes behaviour because of this entry.
 *
 * ⚠️ **And gating it costs the instrument that says so, which is the honest half of this entry.**
 * `probe:file-change` decides "did it arrive?" from the normalized `unknown` stream, and a gated
 * frame never reaches the normalizer — so an OUT-OF-TURN arrival would now be invisible to the one
 * probe whose job is to notice. ⛔ **An argument that seals its own evidence is 168's failure
 * exactly**, so 184 moved that probe's detector onto the transport, where it counts raw frames
 * before anything can drop them.
 */
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
  // ⛔ **`turn/diff/updated` joined in 200, and it is the ONE name that set gained there** (192 H2,
  // corrected). It is the second entry after `item/fileChange/patchUpdated` that is not about what
  // the user reads, and it is here on the strongest ground any entry has had: it is the only member
  // of the five candidate methods where a stale frame OVERWRITES live state rather than merely
  // adding to it. Each payload is a FULL SNAPSHOT of its turn (`normalize.ts` measured three
  // byte-identical ones in a single turn), and `foldChanges` in `file-change.ts` is later-record-wins
  // by path — so one late frame from a finished turn does not leave a stale row beside the current
  // ones, it REPLACES the running turn's row for every path the old turn touched. That is
  // `turn/plan/updated`'s argument from 028, on the pane 096 built.
  //
  // ⚠️ **The other four candidates 192 named were REFUSED, and each refusal is a measurement**, not a
  // preference — see {@link CodexSessionHandle.namesForeignThread} for where they are handled instead.
  'turn/diff/updated',
])

/**
 * ⛔ **The methods whose `threadId` is the SUBJECT of the frame, not its SCOPE** (200).
 *
 * ⚠️ **This set is the reason the universal thread gate below is not a one-liner, and it is the one
 * correction 200 made to its own brief.** The dispatch's §1a read the contract at
 * {@link TURN_SCOPED_METHODS} as *"absence stays tolerated — that is the documented
 * `thread/status/changed` contract"*, i.e. as though that notification carried no `threadId`. It
 * carries one on every frame: `ThreadStatusChangedNotification = { threadId, status }`, non-nullable
 * in the generated protocol. ⛔ **And the id it carries is deliberately NOT ours** — it is the
 * CHILD's, and it is the signal that ends a sub-agent card (033). A gate that dropped every frame
 * naming another thread would therefore have dropped **every sub-agent ending in the app**, which is
 * precisely what the comment above `TURN_SCOPED_METHODS` has warned about since 033.
 *
 * ⚠️ **This set used to be the whole answer, and 226 measured that it is not.** It also said this
 * was *"the only completion signal"* and *"the only evidence a grandchild exists"*; both are false.
 * A child's `turn/completed`, its `thread/tokenUsage/updated`, its tool items and the birth of a
 * child of its OWN all arrive naming the child's thread — so they are dropped here, correctly, as
 * content, and then read as REPORTS about a card we already show. See
 * {@link CodexSessionHandle.onNotification} and {@link CodexSubAgents.report}. The difference
 * between this set and that path is that a subject-method frame is admitted whole, while a report is
 * read out of a frame that stays refused.
 *
 * ⚑ **So the split is not "some methods are exempt from scoping".** It is that `threadId` answers two
 * different questions depending on the frame, and only one of them is "which conversation is this
 * content part of". Everywhere else the id says *whose stream this belongs to*; here it says *which
 * thread this report is about*, and `SubAgents` already refuses our own id precisely so it can tell
 * the two apart. Scoping by what the frame carries means reading what the id MEANS on that frame —
 * which is exactly the failure mode 200 exists to fix, arriving from the other direction.
 */
const THREAD_SUBJECT_METHODS = new Set(['thread/status/changed'])

/**
 * How many distinct method names {@link CodexSessionHandle.frameScope} attributes drops to before it
 * stops naming them (200 §3). The generated vocabulary is well under this; the cap is about the wire
 * being able to say anything at all, not about the protocol.
 */
const MAX_ATTRIBUTED_DROP_METHODS = 32

/** Where drops go once {@link MAX_ATTRIBUTED_DROP_METHODS} distinct names have been counted. */
const OTHER_DROP_METHODS = '(other)'

/** Teardown bounds so `close()` never hangs on the app-server (007 P1-1). */
const CLOSE_FLUSH_TIMEOUT_MS = 2000
const CLOSE_INTERRUPT_TIMEOUT_MS = 2000

/**
 * ⚑ **F084 · how long a stop waits on ending its turn's commands before it asks the turn itself.**
 * The work is local requests to this session's own app-server — a list, then one terminate each —
 * so it ends in milliseconds; the bound is for an app-server that does not answer.
 */
const COMMANDS_END_WITHIN_MS = 1000

/**
 * ⚑ **F084 · the items that are a tool use** — the model going on to other work, which a command it
 * left running is no longer waited on for (`CodexSessionHandle.noteWhatTheTurnMovedOnTo`). ⚠️ Not a
 * message, reasoning, a plan or a `sleep`: a model waiting on a command does those meanwhile.
 */
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

/** ⚑ **F084** — the `subAgentActivity` kinds that are the model's own act: a spawn, and a word to one. */
const SUB_AGENT_USES: ReadonlySet<string> = new Set(['started', 'interacted'])

/** The request whose answer the sparse rate-limit updates are defined as rolling over (201 §2). */
const RATE_LIMIT_READ = 'account/rateLimits/read'

/**
 * How long the rate-limit baseline waits before giving up on itself.
 *
 * ⚑ Generous because nothing waits on it — measured at well under a second against the pinned
 * binary — and bounded because {@link withDeadline}'s own doc is the reason: a request that never
 * settles is indistinguishable from one still in flight, and this one holds a transport entry.
 */
const RATE_LIMIT_BASELINE_TIMEOUT_MS = 15_000

/**
 * How long the command-list read waits before giving up on itself (279).
 *
 * ⚑ The same 15 s as its neighbour above and for the same two reasons — nothing waits on it, and an
 * unanswered request that never settles holds a transport entry. Measured: `skills/list` answered
 * six rows in well under a second against the bundled binary, so this is two orders of magnitude
 * above the observed cost. ⚠️ **The penalty for being too eager is a palette band that is silently
 * missing**, which is the failure this dispatch exists to remove.
 */
const COMMAND_LIST_TIMEOUT_MS = 15_000

/**
 * How long a child's status read waits (296).
 *
 * ⚠️ **Five seconds rather than its neighbours' fifteen, because somebody IS waiting on this one.**
 * The two constants above cover fire-and-forget reads whose only cost of being slow is a band that
 * appears late; this one is awaited by a viewer with a composer in it, and a person looking at a
 * dark box for fifteen seconds has been told nothing. Measured (`295`, this same pin): `thread/read`
 * answered in **8 ms** live, **5 ms** on a finished child and **8 ms** on a cold process — so this is
 * roughly 600× the observed cost and still short enough that the refusal it produces reads as an
 * answer.
 */
const CHILD_READ_TIMEOUT_MS = 5_000

/**
 * How long a message to a child waits for the app-server to accept it (296).
 *
 * ⚠️ **Longer than the read, because this one starts work.** `295` measured the accept itself at
 * **1 ms** in both the busy and the idle case — the provider answers `turn/start` immediately and
 * the model's own thinking happens afterwards, on notifications this session never sees. So the
 * budget covers a busy app-server rather than a busy model. ⛔ **A rejection here is a real error and
 * rejects**, unlike the four `ok: false` arms: those are facts about the child, this is the wire.
 */
const CHILD_INPUT_TIMEOUT_MS = 15_000

/**
 * 🔴 **713 · how long an accepted compaction may take to START before its turn is given up.**
 *
 * ⚠️ **The one turn this adapter binds from a notification** — see {@link CodexTurn.bindsAtItsStart}
 * — so it is the one turn a missing `turn/started` would leave `working` forever, with a Stop that
 * cannot address it (an interrupt needs the provider's turn id). ⚑ Measured
 * (`probe:codex-command-as-typed`, bundled 0.146.0): `thread/compact/start` answered `{}` and its
 * `turn/started` followed **8 ms** later, on a thread with history and on an empty one. The model's
 * summary is written INSIDE the turn, after it starts, so this bounds the app-server rather than the
 * model — the same budget {@link CHILD_INPUT_TIMEOUT_MS} gives an accept, for the same reason.
 */
const COMPACTION_START_TIMEOUT_MS = 15_000

/**
 * 🔴 **713 · what a person reads when they ask again while a compaction the bound gave up on may
 * still start** — see {@link CodexSessionHandle.compactionOutstanding}. ⚑ It says why, and what
 * ends the wait.
 */
export const A_COMPACTION_IS_STILL_OUTSTANDING =
  'Codex accepted the last compaction but has not started it, and it may still run — BroCrew will ' +
  'not ask for another until it does, or until your next message has finished. Nothing has been sent.'

/**
 * The correlation between ONE accepted local turn (the {@link SessionMachine} turn)
 * and its provider turn (037/029, fixing 036/023 P1-C). The provider turn id is bound
 * from the AUTHORITATIVE `turn/start` RESPONSE (`TurnStartResponse.turn.id`) — the
 * JSON-RPC result correlated by request id — NOT from a later `turn/started`
 * notification (a delayed/duplicate one could otherwise bind the wrong provider turn).
 * The binding is two-phase: the local turn is accepted in `send()`, then bound the
 * instant the response resolves. Provider `turn/completed` — and the first-class content
 * it streams (agent-message deltas + item lifecycle; see {@link isTurnScopedContent}) —
 * is honored ONLY when its thread/turn id matches this binding; a stale/duplicate/
 * mismatched one is ignored and can never bind or terminalize another local turn. An
 * `interrupt()` before the response resolves latches `interruptPending`, which fires the
 * interrupt RPC the instant the id is bound — and, since 704, an interrupt asked at all is sent
 * AGAIN when Codex's own `turn/started` names this turn ({@link interruptAsked}).
 */
interface CodexTurn {
  /** The `SessionMachine` local turn id this binds to (one live turn at a time). */
  readonly localId: number
  /**
   * The provider turn id bound from the `turn/start` response, or null until it binds (037) — ⚑ or,
   * for a compaction, from its `turn/started` (713, {@link bindsAtItsStart}).
   */
  providerTurnId: string | null
  /** An interrupt requested before `providerTurnId` was known — fire the RPC once it binds. */
  interruptPending: boolean
  /**
   * 🔴 **704 · an interrupt was ASKED for this turn — kept after the RPC is sent, never spent.**
   *
   * ⛔ Binding the id is not the turn RUNNING. Codex refuses a `turn/interrupt` for a turn it has
   * accepted and not yet started — `-32600 "no active turn to interrupt"`, or `"expected active turn
   * id <this> but found <the one before>"` while the turn before still holds its active slot — and
   * then runs the turn to its end: measured by `probe:codex-early-interrupt` against the bundled
   * 0.146.0, 4 of 4, and
   * the cause of `smoke:ui` step 48's red: a count run to sixty after interrupt-and-send, and the
   * person's replacement refused by the host five seconds later. ⚑ `turn/started` for THIS turn is
   * the moment it becomes interruptible, so the RPC is sent again there (`onNotification`).
   */
  interruptAsked: boolean
  /**
   * ⚑ **F084 · the commands this turn started**, by the id of their `commandExecution` item — the
   * `itemId` Codex lists each one's process under — and whether the model has moved on from each
   * ({@link CodexSessionHandle.noteWhatTheTurnMovedOnTo}). A stop of this turn ends those still
   * running that it is waiting on, or all of them when the stop is an explicit one
   * ({@link endsAll}); a command an earlier turn left running is not in it.
   */
  readonly commands: Map<string, { movedOn: boolean }>
  /**
   * ⚑ **F084 · an explicit stop was asked of this turn** — a person's Stop, or `interrupt_agent` —
   * so a stop ends every command it started, not only the one it is waiting on
   * ({@link CodexSessionHandle.endEverythingTheTurnStarted}).
   */
  endsAll: boolean
  /**
   * ⚑ **F084 · the passes ending this turn's commands, one after the other**
   * ({@link CodexSessionHandle.endWhatTheTurnStarted}) — so a pass that ends something says so
   * before the turn's ending, which waits on the last of them, is written.
   */
  commandsEnding: Promise<void>
  /**
   * 🔴 **713 · this turn is a compaction's, and binds from Codex's own `turn/started`.**
   *
   * ⛔ **The one exception to "bound from the RESPONSE" above, and forced by the wire**:
   * `thread/compact/start` answers `{}` (`ThreadCompactStartResponse` is `Record<string, never>`), so
   * the turn it runs has no id anywhere but its notifications. ⚑ Measured on the bundled 0.146.0:
   * the answer, then `turn/started` naming a NEW turn id, then the `contextCompaction` item and
   * `turn/completed` under that id.
   *
   * ⚠️ **What keeps the notification from binding the wrong turn is where this turn begins**: only on
   * an idle session ({@link SessionMachine.beginTurn} refuses otherwise), so every turn this session
   * bound before it has already ended, and Codex writes a turn's `turn/started` before its
   * `turn/completed` on one ordered stream. ⚑ A delayed duplicate of the turn before — 037's hazard —
   * is refused by id (see {@link CodexSessionHandle.bindsACompactionAt}), and a compaction the 15 s
   * bound gave up on — ended here, not at Codex — blocks the next one until it shows itself (see
   * {@link CodexSessionHandle.compactionOutstanding}).
   */
  bindsAtItsStart?: true
}

/**
 * A live Codex session over `codex app-server`. Session/turn lifecycle is driven
 * through the shared {@link SessionMachine} (008); permission/user-input
 * resolution through the shared {@link RequestBroker} (009). The thread id is
 * known from the `thread/start`/`resume` RESPONSE, which is validated in
 * {@link CodexSessionHandle.begin} (schema + exact requested-id/cwd match on
 * resume), so `start()`/`resume()` reject a malformed/mismatched handshake and
 * the `ref` is a real, validated id the instant they resolve — never `''` or an
 * un-proven echo of the requested id (011).
 */
export class CodexSessionHandle implements SessionHandle {
  private readonly provider = 'codex' as const
  private readonly eventQueue = new AsyncQueue<RuntimeEvent>()
  /** Coalesces streamed deltas before they reach the queue; flushes before any non-delta event (019). */
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
  /**
   * ⛔ **Codex's live PTY processes, published as `background_work`** (275) — see
   * {@link BackgroundTerminals} for every measurement that decided its shape.
   *
   * ⚠️ **Constructed with four callbacks rather than with `this`**, so the watch can be unit-tested
   * against a fake wire and cannot reach anything else of this handle. `open()` is the same
   * terminal guard {@link emit} applies, asked once more here because a list request in flight can
   * outlive the frame that asked for it.
   */
  private readonly backgroundTerminals = new BackgroundTerminals({
    request: (method, params) => this.transport.request(method, params),
    // ⛔ **The ending closes the tail, and it is the ONLY thing that can for detached work** (300).
    // `275` measured that a detached command emits no `item/completed`, ever — so without this line
    // a card whose command finished minutes ago would go on presenting its last output as live.
    emit: (event) => {
      this.closeEndedCommandOutput(event)
      this.emit(event)
    },
    threadId: () => this._ref?.sessionId,
    open: () => !this.terminated && !this.machine.isTerminal,
  })
  /**
   * Hold output printed by each running command for live reads.
   *
   * ⚠️ **A buffer, deliberately not a stream of events.** See `command-output.ts` for the whole
   * argument; the short version is that every `RuntimeEvent` is recorded with an ordinal, so a delta
   * per line would put a build log in the durable ledger of every conversation that ever ran one.
   * The tail is a claim about NOW and is read on demand by the card showing that command.
   */
  private readonly commandTails = new CommandTails()
  /**
   * 🔴 **What each tool ANSWERED, whole** (462) — the bytes the 200-character summary cuts.
   *
   * ⚠️ **Not cleared on close, and that is the difference from {@link commandTails} one line up.**
   * A tail is a claim about NOW and `close()` sweeps it so a dead session cannot look live; an
   * answer is a record of what a tool said, and taking it away as the conversation closes would
   * empty the panel at exactly the moment a person is reading the last thing that happened. It dies
   * with this handle, and `tool-answer.ts`'s two ceilings bound it until then.
   */
  private readonly toolAnswers = new ToolAnswers()
  private currentStatus: SessionStatus = 'idle'
  /** The current local↔provider turn binding, or null between turns (029, 023 P1-C). */
  private currentTurn: CodexTurn | null = null
  private messageTurn: CodexTurn | null = null
  private messageCalls = new MessageActCalls()
  /**
   * ⚑ **F084 · a turn Codex has ended whose ending waits on its commands'** ({@link onTurnCompleted})
   * — and that wait. ⛔ The turn is still the machine's open one meanwhile, so a stop asked now
   * waits for that ending ({@link interrupt}) rather than writing one of its own over it, and an
   * explicit stop widens it ({@link endEverythingTheTurnStarted}).
   */
  private completing: { readonly turn: CodexTurn; readonly done: Promise<void> } | null = null
  /**
   * 🔴 **713 · the provider turn id this session bound most recently** — the one id a compaction's
   * turn may never bind to. See {@link bindsACompactionAt}.
   */
  private lastBoundTurnId: string | null = null
  /**
   * 🔴 **713 · a compaction Codex accepted and the bound gave up on — which may still START.**
   *
   * ⛔ **Its `turn/started` would carry nothing to tell it from a later compaction's**, so while it
   * is outstanding no other compaction begins ({@link CodexSessionHandle.compact} refuses, in words):
   * without this, a person who asked again would have the first one's turn bound to the second's
   * request, drawn as it, and the second's own start dropped (713's review). ⚑ Cleared the moment
   * the stray shows itself — a `turn/started` for a turn this session did not bind — or when a turn
   * of ours runs to its end. ⚠️ **The residual, named**: a stray that starts only AFTER one of our
   * turns has ended is taken as gone, and a compaction asked for then could still meet it.
   */
  private compactionOutstanding = false
  /** Server-request handlers in flight; `close()` drains them so their wire writes flush first. */
  private readonly inFlight = new Set<Promise<void>>()
  /**
   * **The single authority for every provider (JSON-RPC) server-request id** (067, fixing 066 F1+F2).
   *
   * This surface had been patched four times (024, 051, 057, 061) because the id's state lived in
   * three places at once — `claimedRequestIds`, `respondedRequestIds`, and the broker's resolver —
   * which could disagree. F1 is exactly that disagreement: the answer removed the broker resolver,
   * so a duplicate arriving before the handler's write found "no pending" and did nothing while an
   * `accept` was still on its way. One map keyed by the type-preserving {@link requestKey} (045)
   * now holds the whole lifecycle, and every transition is SYNCHRONOUS — single-threaded, so
   * synchronous means atomic: there is no instant at which one path thinks an id is free while
   * another still owns it.
   *
   *     UNSEEN (absent) → CLAIMED (card open, awaiting the user) → SPENT (its ONE wire response
   *     written) → RETIRED (entry dropped at the turn terminal; the numeric floor answers for it)
   *
   * ONE session-wide namespace spanning BOTH kinds (036 P1-B): JSON-RPC ids are session-global, so
   * a same-kind OR cross-kind reuse is a collision, detected here rather than in two independent
   * per-broker id spaces.
   */
  private readonly requestStates = new Map<string, RequestState>()
  /**
   * The O(1) barrier that survives tombstone retirement (057, fixing 044 P2 #7): every NUMERIC
   * server-request id at or below this is **spent** — claimed, responded to, and retired.
   *
   * The live app-server issues numeric ids from a per-session counter ascending from 0 (verified
   * against codex 0.145.0), so for the real protocol this is a **lossless compression** of the
   * retired id set — `retired.has(n)` ⟺ `n <= maxRetiredNumericId` — in O(1) memory instead of one
   * entry per request. It is what lets {@link retireSettledRequestIds} drop per-id tombstones
   * without reopening them: a replayed id from a finished turn is still refused.
   *
   * Fails CLOSED in the direction that matters: an id at/below the floor is treated as spent, so a
   * server that went backwards gets a refusal (no card, no second response), never a fresh
   * authorization. `-1` = nothing retired yet (id `0` is legitimately the first id).
   */
  private maxRetiredNumericId = -1
  /** Set once teardown has emitted the terminal events: late provider events are then dropped. */
  private terminated = false
  /** Single-flight close: every concurrent caller awaits ONE teardown (023 P1-A). */
  private closing: Promise<void> | null = null

  /** The ref a resume was asked to restore; used only to validate the handshake response. */
  private readonly _targetRef: SessionRef | null

  /**
   * The agents this agent dispatched, followed on their own threads (033) — and the ones it did
   * not, which reach us as a working thread nobody announced (135).
   *
   * The thread id is read through a closure because it is only known after the handshake, and it is
   * what keeps THIS session's own status from opening a card about itself.
   */
  private readonly subAgents = new CodexSubAgents(() => this._ref?.sessionId)

  /**
   * Which of those cards are still open, so a turn cannot end leaving one recorded as running (075).
   *
   * Codex needs this for a reason of its own: the ending rides the CHILD thread's `idle`, and
   * nothing makes the parent's turn wait for it — so a card whose child reports late, or not at
   * all, is stranded by an ordering the provider owns rather than by a missing message.
   */
  private readonly openSubAgents = new OpenSubAgents()

  /**
   * **Which files each proposed patch says it will touch** (181), so an approval card can name them.
   *
   * Fed from the item notifications and read once, in {@link handleApproval} — the provider's item
   * shape is parsed in ONE place, exactly as the sub-agent tracker learns from neutral events rather
   * than from a second reading of the wire.
   */
  private readonly patches = new PatchTargets()

  /**
   * 🔴 **723 · the MCP tool calls running, and which Codex has asked about** — what tells Codex's
   * own approval from a server's form wearing its marker. See {@link McpCallsInFlight}. Fed below
   * the turn gate, as {@link patches} is, so a stale turn's item cannot vouch for a frame.
   */
  private readonly mcpCalls = new McpCallsInFlight()

  /**
   * This session's memory of the account's rate-limit state (188 §2, from 182 M4).
   *
   * ⚠️ **Per HANDLE and not per process**, for the same reason {@link patches} is: the state belongs
   * to a conversation the user is watching, and a second session must not inherit a wall the first
   * one was told about — nor dedup its own first warning against a sentence it never showed.
   */
  private readonly rateLimits = new RateLimitWatch()
  /**
   * ⚑ **This launch runs on an API key and not a ChatGPT sign-in**, as the launch's own sign-in probe
   * answered ({@link assertCredentialUsable}) — so a refused credential says it was a key (`onAKey`).
   * ⚠️ Usually the key saved in Providers, which BroBot logs the home in with; a home copied from a
   * machine whose own Codex runs on a key reads the same, so the words about it hold for both.
   */
  private launchedOnAKey = false
  /**
   * The account this launch's home was signed in to, as a one-way name ({@link codexAccountIn}), or
   * `null` when it could not be read: then nothing can say the sign-in moved.
   */
  private launchAccount: string | null | undefined = undefined
  /** The copy of the sign-in the home held just before the app-server was spawned, by what tells it apart. */
  private launchCopy: CodexCopyIdentity | null = null
  /** Latched by {@link checkSignIn}; read for free by every disclosure after that. */
  private _signInSuperseded = false

  constructor(
    private readonly transport: CodexTransport,
    private readonly cwd: string,
    private readonly rotation: number,
    private readonly providerHome: string,
    targetRef?: SessionRef,
    /**
     * The mode the conversation OPENED with (078). No longer the last word on it: 034 lets the
     * user flip it mid-conversation, and {@link approvals} owns the pair from here — this
     * parameter only seeds it.
     */
    approvalMode?: ApprovalMode,
    /**
     * What effort this session asked for (024), named on `thread/start` and `thread/resume`
     * through the config overlay (D-042, {@link openTheThread}) and re-sent on every `turn/start`.
     * Undefined means nobody chose, and the server's own default is left alone. Seeds
     * {@link efforts} — 076 lets the user move it mid-conversation.
     */
    seedEffort?: ReasoningEffort,
    /**
     * Where this session stands with plan mode (057, 060), re-asserted on every `turn/start` for
     * the same reason the approval profile is. Seeds {@link plan}.
     *
     * ⚠️ **No longer fixed for the life of the session.** 057 shipped it `readonly` and said so:
     * *"a Codex session that plans, plans for good"*, because the server holds the conversation in
     * plan mode *"until a developer message explicitly ends it"* and nothing here sent one. 060
     * measured that the mode switch IS that message (see {@link collaborationModeFor}), so it
     * moved once, forwards, from `planning` to `left`. 076 lets it move back: `never → planning` is
     * how a conversation starts planning halfway through, and `left → planning` how it plans the
     * next step after finishing the last.
     */
    seedPlanPhase: PlanPhase = 'never',
    /**
     * Which model this session asked for (038), or undefined for "we did not ask" — the state this
     * app preserves rather than collapsing into a concrete id. Seeds {@link models}.
     */
    seedModel?: string,
    /**
     * 🔴 **The tools this session may call to reach the app it is running inside** (348) —
     * {@link ProviderRuntimeContext.agentTools}, translated by {@link codexDynamicToolsFor} and
     * declared on `thread/start`.
     *
     * ⚠️ **Held for the life of the handle, and read again when a call comes back.** The
     * declaration goes out once; `item/tool/call` arrives turn after turn, and each one is answered
     * by THIS toolset — the one built for this conversation, holding this session's id. A handle
     * that dropped it after the handshake would declare five tools it could no longer answer.
     */
    private readonly agentTools?: AgentToolset,
    /**
     * 🔴 **The external MCP servers this identity was granted** (605) —
     * {@link ProviderRuntimeContext.externalMcp}, translated by {@link codexExternalMcpConfig} and
     * declared as a per-thread config overlay on `thread/start` AND on `thread/resume`.
     *
     * ⚠️ **Held for the life of the handle for the RESUME, not for the answers.** Unlike
     * {@link agentTools}, nothing comes back to this object to be answered — the child talks to
     * the server directly and this app never sees those calls. ⛔ What it does see is the server's
     * own `mcpServer/elicitation/request`, and that carries the server's name itself.
     */
    private readonly externalMcp?: ExternalMcpReach,
    /**
     * 🔴 **W4.189 · the folders this session may also work in** —
     * {@link ProviderRuntimeContext.workFolders}, named on `thread/start` and `thread/resume` through
     * the config overlay ({@link threadConfigOverlay}) and re-sent on every `turn/start`. Seeds
     * {@link folders}.
     */
    seedWorkFolders: readonly string[] = [],
    private readonly memoryConfig?: CodexMemoryConfigResult,
    private readonly builtInSkills?: BuiltInSkillsContext,
  ) {
    // Never seed `_ref` from the requested resume ref: it is latched only once
    // the handshake response is validated (and, for resume, matched) — emit().
    this._targetRef = targetRef ?? null
    this._ref = null
    this.approvals = new ApprovalModeSwitch(approvalMode)
    this.models = new NextTurnSetting<string | undefined>(seedModel)
    this.efforts = new NextTurnSetting<ReasoningEffort | undefined>(seedEffort)
    this.plan = new NextTurnSetting<PlanPhase>(seedPlanPhase)
    this.folders = new NextTurnSetting<readonly string[]>([...seedWorkFolders])
  }

  /**
   * The three settings 076 made changeable mid-conversation, each carrying the pair 034 established.
   *
   * All three ride `turn/start` — `model` and `effort` are documented as overrides *"for this turn
   * and subsequent turns"*, `collaborationMode` the same — so none of them sends anything of its
   * own, exactly as {@link setApprovalMode} sends nothing. A `thread/settings/update` carrying all
   * three exists and is deliberately not used: 034 measured the server accepting one mid-turn,
   * echoing it back, and the running turn ignoring it, so riding the turn is the path with evidence
   * behind it and it means one request instead of two that could half-succeed.
   */
  private readonly models: NextTurnSetting<string | undefined>
  private readonly efforts: NextTurnSetting<ReasoningEffort | undefined>
  private readonly plan: NextTurnSetting<PlanPhase>

  /**
   * 🔴 **W4.189 · the work folders, the fourth setting that rides `turn/start`** — as extra
   * `writableRoots` of the `ask` sandbox ({@link sandboxPolicyOf}), adopted and rolled back with the
   * other three in {@link send}, for their reason: the running turn keeps the sandbox it started
   * with, and a `turn/start` that never landed adopted nothing.
   */
  private readonly folders: NextTurnSetting<readonly string[]>

  /**
   * 🔴 **W4.189 · every folder this handle has sent as a work folder**, on a thread overlay or a
   * `turn/start` — what {@link askBaselineOf} takes back out of the server's echo. Only grows: a
   * folder sent once can come back in an echo after it was removed.
   */
  private readonly workFoldersSent = new Set<string>()

  /**
   * 🔴 **W4.189 · the roots the server reported before this handle sent any work folder** — the
   * thread's own, which {@link askBaselineOf} keeps even when a work folder names the same path.
   * Re-read from every echo until the first work folder is sent, and frozen from then on.
   */
  private theThreadsOwnRoots: ReadonlySet<string> = new Set()

  /**
   * What this session prompts for now, and what it will prompt for next (034). Every read that used
   * to be `this.approvalMode` is `this.approvals.effective` — the handshake profile, the launch
   * validator, the mid-session settings guard, and the scope a permission card discloses — so there
   * is exactly one answer to "what is this session running under", and it is never a mode the
   * provider has not been told about yet.
   */
  private readonly approvals: ApprovalModeSwitch

  /**
   * The last `ask` sandbox policy (`workspaceWrite` since `736`) the app-server reported for this
   * thread, or null before it has reported one. See {@link askPolicyOf} — this is what makes the
   * per-turn sandbox re-pin an echo of the server's own value instead of an assumption about its
   * default. ⚠️ Since W4.189 an echo can carry this handle's own work folders too: it is read through
   * {@link askBaselineOf}, never re-sent as it came.
   */
  private observedAskPolicy: WorkspaceWritePolicy | null = null

  get approval(): ApprovalModeState {
    return { effective: this.approvals.effective, requested: this.approvals.requested }
  }

  /**
   * 🔴 **723 · the external MCP tools this conversation granted for itself** — and nothing else, and
   * that is a statement about where the other grants LIVE (058).
   *
   * ⚑ **An MCP tool's grant is one this adapter MADE and can name**: it answered Codex's own approval
   * `persist: 'session'`, which `probe:codex-mcp-tool-approval` measured to cover that one tool of
   * that one server whatever it is given — `allow_all_for_session` — so it is listed, by the name the
   * model calls it (`mcp__<server>__<tool>`). ⛔ Until `723`'s review it was granted and then
   * invisible. ⚠️ Since `736` (R95) an `allow_always` is listed too, and one KEPT in the provider home
   * is listed at every later launch that declares its server — a grant that does not end with the
   * conversation, which the surfaces that draw this list do not say yet (the frontend's).
   *
   * ⚠️ **A command's `acceptForSession` is still NOT listed.** Codex remembers whatever it decided that
   * covers and nothing comes back saying what is standing, so a list of those could only be assembled
   * by guessing at provider-side state — the class of invention this codebase refuses. That
   * disclosure gap is older than 058 and still needs the server asked what it holds.
   */
  get blanketGrants(): readonly string[] {
    return this.mcpCalls.grants
  }

  /**
   * Record a mode change for the NEXT turn (034). Nothing goes on the wire here: the profile rides
   * on `turn/start`, which the vendored protocol documents as the override that applies "for this
   * turn and subsequent turns", and which the 034 probe measured doing exactly that in both
   * directions. A mid-turn `thread/settings/update` was measured too — accepted, echoed back, and
   * ignored by the running turn — which is why this does not send one.
   */
  setApprovalMode(mode: ApprovalMode): Promise<void> {
    this.approvals.request(mode)
    return Promise.resolve()
  }

  get planNeedsGoAhead(): boolean {
    // `requested`, not `effective`: the question this answers is "would a go-ahead button do
    // anything", and once the user has asked to stop planning the answer is no — even though the
    // turn now in flight is still a planning one. Reading `effective` would leave the button live
    // after it had been used and invite a second press that rejects.
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

  /** Record a model change for the NEXT turn (076); nothing on the wire — see {@link models}. */
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

  /**
   * 🔴 **W4.189 · the whole list, for the NEXT turn**; nothing on the wire — see {@link folders}. ⚑ A
   * copy, so a caller that later changes its array changes nothing here.
   */
  setWorkFolders(folders: readonly string[]): void {
    this.folders.request([...folders])
  }

  /**
   * Record an effort change for the NEXT turn (076).
   *
   * **Nothing is validated against a list here, and that is not an omission.** Codex's vendored
   * `ReasoningEffort` is `string` — open by construction — and the set a given model accepts is
   * answered per model by `model/list`. This adapter is handed one session, not a catalogue, so the
   * only list it could check against is one it had written down, which is the thing 076 removed.
   * The server rejects what it does not know and its message is the one worth showing.
   *
   * ⛔ **It IS, however, a documented divergence from the neutral contract, and 182 M6 is that
   * nothing said so** (188 §2). {@link SessionHandle.setReasoningEffort} says MUST reject by name;
   * this resolves every value. What that costs is one specific case: a session running a model id
   * the catalogue does not list, whose drawer therefore offers the UNION of every model's efforts
   * (177 §4). Picking one of those returns success and the host writes the row. ⚠️ **What it does
   * not cost is a lie on screen** — the row is the REQUESTED value, `effective` is still whatever
   * the last turn actually ran with, and the drawer shows `effective`. The user sees their choice
   * take hold when a turn takes it, not before.
   *
   * ⚑ **Closing it means handing this handle the catalogue**, not adding a check — and that is a
   * seam change with its own cost (a catalogue is a live provider answer with a 15-second bound,
   * and a handle that cached one would be answering from a snapshot). Named, ranked, not smuggled
   * into a fix dispatch.
   */
  setReasoningEffort(effort: ReasoningEffort | undefined): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change the effort: this session is no longer active'))
    }
    this.efforts.request(effort)
    return Promise.resolve()
  }

  /**
   * Start or stop planning, from the next turn (076, absorbing 060's `endPlanMode`).
   *
   * Nothing on the wire here, for exactly the reason {@link setApprovalMode} sends nothing: the mode
   * rides `turn/start`, which the protocol documents as the override that applies *"for this turn
   * and subsequent turns"*. A `thread/settings/update` carrying the same field exists and is
   * deliberately not used — 034 measured the server accepting one mid-turn, echoing it back, and the
   * running turn ignoring it.
   *
   * ⚠️ **`false` on a planning session IS the go-ahead** — the same state transition 060 shipped
   * under its own name, which is why that name is gone. `never → planning` is new in 076 and is the
   * one direction with a cost worth naming: a session that has never planned sends no
   * `collaborationMode` at all, and starting to send one overrides the thread's developer
   * instructions. That is latent rather than live — this app sends Codex no hint, because the server
   * reads `AGENTS.md` from the cwd itself and what is true of one conversation rides its first
   * message (D-024 · R1) — and {@link collaborationModeFor} carries the full account for whoever
   * first sends one.
   */
  setPlanMode(on: boolean): Promise<void> {
    // ⚠️ **The liveness check comes FIRST, and it is not defensive padding** (060 review). This is a
    // state change with no wire traffic, so on a closed or errored session it would otherwise
    // "succeed" against something that can never send another turn: the flag flips, the host writes
    // `plan_ended_at`, the bar disappears — and then the `send` that was supposed to carry the switch
    // fails, leaving a dead conversation recorded as released. Nothing has moved yet at this point,
    // so refusing costs the user a click and not a lie.
    if (this.isShuttingDown) {
      return Promise.reject(new Error('cannot change plan mode: this session is no longer active'))
    }
    const current = this.plan.requested
    const next: PlanPhase = on ? 'planning' : current === 'never' ? 'never' : 'left'
    // Rejects rather than no-ops: this is the method a button calls, and a button whose backing call
    // quietly succeeded without doing anything is worse than one that errors. Asking a session that
    // never planned to stop planning is the one case that has no transition to make — `never` must
    // NOT become `left`, because `left` means "keeps asserting {mode:'default'}" and asserting a mode
    // on a thread that never planned would replace its developer instructions (see {@link PlanPhase}).
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

  /**
   * The app-server child's PID (076) — read through the transport's sanctioned accessor, never a
   * `pgrep` guess or a reach into its private child. `undefined` for a transport that owns no
   * process (a test fake), and it drops on its own once the child exits.
   */
  get providerPid(): number | undefined {
    return this.transport.pid
  }

  /**
   * ⛔ **The termination fact** (233) — see {@link SessionHandle.awaitProcessExit} and
   * {@link CodexTransport.exited}, which is where the reasoning and the caveat live.
   *
   * Through the same sanctioned accessor `providerPid` uses and for the same reason. ⚠️ **A
   * transport that owns no process returns `undefined` here, and it is NOT coalesced to
   * `Promise.resolve()`** — that would be this dispatch's own defect in one character: a settled
   * promise with nothing proven. `undefined` is the host's signal to fall back to the weaker,
   * visible thing it did before, which is what "cannot say" has to cost.
   */
  awaitProcessExit(): Promise<void> | undefined {
    return this.transport.exited
  }

  /** What Codex reports it is running; kept CURRENT as the session changes it (081). */
  private _agentInfo: AgentInfo | undefined

  get agentInfo(): AgentInfo | undefined {
    return this._agentInfo
  }

  /**
   * The instruction files Codex said it loaded, from the handshake response (158).
   *
   * ⚑ **It has been on the wire since before this app existed** — `ThreadStartResponse`,
   * `ThreadResumeResponse` and `ThreadForkResponse` all declare `instructionSources` — and 156 §4
   * found *no runtime consumer*: only the generated types and fixtures. Read once here, where the
   * response is already being validated, so the app can finally show what its own session was told.
   *
   * ⚠️ **Not merged across responses like {@link _agentInfo}.** A resume is a fresh read by the
   * provider (156: fresh threads and cold resumes reload), so the newest list REPLACES the old one
   * rather than adding to it — a merge would keep a file the resumed thread no longer loads.
   */
  private _instructionSources: readonly string[] | undefined

  get instructionSources(): readonly string[] | undefined {
    return this._instructionSources
  }

  private _launchSettings: readonly LaunchSetting[] | undefined

  get launchSettings(): readonly LaunchSetting[] | undefined {
    return this._launchSettings
  }

  /**
   * Merge what the provider just reported. Fields are only ever OVERWRITTEN by a fresh report — a
   * notification that carries a model but no effort must not erase a known effort (081).
   */
  private mergeAgentInfo(next: AgentInfo): void {
    const merged = { ...this._agentInfo, ...next }
    if (
      merged.model !== this._agentInfo?.model ||
      merged.reasoningEffort !== this._agentInfo?.reasoningEffort
    ) {
      this._agentInfo = merged
    }
  }

  /**
   * 🔴 **D-042 · R1 — `thread/start` or `thread/resume`, naming this conversation's EFFORT too** —
   * `config.model_reasoning_effort`, the per-thread config overlay both params carry, merged into
   * whatever {@link codexExternalMcpConfig} put there. ⚑ The effort the launch was seeded with,
   * which every `turn/start` names as well ({@link turnStartParams}).
   *
   * ⚑ **Measured on the bundled 0.146.0** (D-042's review, `677`'s instrument: a throwaway
   * `CODEX_HOME`, a loopback endpoint, no account): a thread started or resumed this way reports
   * the named effort in its handshake, runs a turn that names none at it, and runs a compaction at
   * it — and a resume naming it beats the effort the thread last ran, which a resume naming none
   * keeps (`677` D2). ⛔ So the handshake's report is this conversation's effort and not the
   * thread's last one, and a compaction asked before the first message runs at the effort chosen.
   * ⚠️ Absent when nothing was asked: the contract still allows it.
   */
  private openTheThread(
    method: 'thread/start' | 'thread/resume',
    params: ThreadStartParams | ThreadResumeParams,
  ): Promise<unknown> {
    const effort = this.efforts.requested
    if (effort !== undefined) params.config = { ...params.config, model_reasoning_effort: effort }
    const config = params.config ?? {}
    const overrides = Object.entries(config).map(([key, value]) => {
      // Server addresses and per-tool grants stay inside the adapter.
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
      // Default also covers a launch that sends no collaboration override.
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

  /** The validated provider ref, or `null` until the handshake establishes it (011). */
  get ref(): SessionRef | null {
    return this._ref
  }

  private get isShuttingDown(): boolean {
    return this.machine.isTerminal || this.machine.state === 'closing'
  }

  /** initialize → initialized → thread/start|resume; validates the response, emits `session`, starts the loop. */
  async begin(
    opening: 'started' | 'resumed',
    model: string | undefined,
    systemHint?: string,
    /**
     * Run the moment `initialize` has answered (180) — the app-server's sqlite state exists from
     * here, so the next one may boot on this home. See `home-boot.ts` for why that is the release
     * point and not the end of this method: everything below is a network wait.
     *
     * Optional because a directly-constructed handle has no gate to hand back, and idempotent at
     * the caller, which also releases in a `finally` for the paths where `initialize` never answers.
     */
    bootSettled?: () => void,
  ): Promise<void> {
    this.machine.markStarting()
    // Re-attest `sqlite_home` BEFORE any protocol traffic (041; 023 §6). The AUTHORITATIVE check
    // runs pre-spawn in `CodexRuntime.assertLaunchPreconditions`; this repeat catches a config
    // written between launch and handshake, and covers a directly-constructed handle (whose
    // transport this class did not create) without first completing a round-trip.
    assertCodexSqliteHomeContained(this.providerHome)
    this.startPhase('initialize-sent')
    const initResult = await this.transport.request('initialize', initializeParams())
    this.startPhase('initialized')
    bootSettled?.() // this home's state runtime exists now (180) — release before validating it
    this.validateProtocolVersion(initResult) // fail closed on CLI ↔ vendored-protocol drift (043)
    this.validateCodexHome(initResult) // fail closed if the child ignored our CODEX_HOME (021)
    this.transport.notify('initialized', {})
    await this.assertCredentialUsable()
    if (this.builtInSkills) {
      try {
        await registerCodexBuiltInSkills(this.builtInSkills, this.cwd, (method, params) =>
          withDeadline(this.transport.request(method, params), COMMAND_LIST_TIMEOUT_MS, method),
        )
      } catch (cause) {
        throw new Error(BUILT_IN_SKILLS_FAILURE, { cause })
      }
      this.startPhase('skills-registered')
    }
    // 🔴 **736 · R95 — the *Always allow*s kept in this home, read once for this launch**: sent with
    // their servers, and — for each server this launch declares at the address it was kept for —
    // counted as granted here too, so a later frame wearing Codex's marker for such a tool is read
    // as the server's (Codex asks nothing about it: measured), as in the conversation that pressed.
    const kept = keptToolApprovals(this.providerHome)
    for (const approval of kept) {
      const declared = this.externalMcp?.servers.some(
        (one) => one.name === approval.server && one.url === approval.url,
      )
      if (declared === true) this.mcpCalls.grant(approval.server, approval.tool)
    }
    // 🔴 **W4.189 · the launch's work folders, named on the thread** — in `ask` only, and remembered
    // as sent, since the handshake echoes them back ({@link askBaselineOf}).
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
            ),
          )
        : // `developerInstructions` re-applied on resume when the caller sends one (158). The
          // comment here used to say there was *"nothing honest to re-inject"*, which was true of
          // the neutral contract and not of the provider — `ThreadResumeParams` always accepted the
          // field. `ResumeOptions` carries a hint now, re-read at this launch rather than replayed.
          //
          // ⚠️ **In production this app sends Codex none**, on either path: Codex loads
          // `$CODEX_HOME/AGENTS.md` and its own project chain natively (156 §3), so a hint would
          // duplicate what the provider already read. The pass-through exists so the neutral
          // contract means the same thing on both adapters, not because we use it here.
          //
          // 🔴 **D-024 · and a hint here would not reach the model.** Its review measured it on the
          // bundled 0.146.0 over a loopback endpoint: a `thread/resume` carrying
          // `developerInstructions` puts none of it into the resumed turn's request, which holds only
          // the developer message the thread STARTED with, replayed from its rollout. ⚑ So what is
          // true of one conversation at this launch goes in front of this life's first message
          // (`SessionLaunchRead.firstTurnLead`), never here.
          await this.openTheThread(
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
            ),
          )
    // The handshake reports BOTH the effective model and the reasoning effort (082, fixing 081).
    // `ThreadStartResponse` carries `model` AND `reasoningEffort` — 081 claimed it had no effort and
    // read only `ThreadSettings.effort`, so an effort set in `config.toml` was live on the server
    // but never captured and the panel showed `…` forever. The two fields are named differently on
    // the two shapes (`reasoningEffort` here, `effort` on `ThreadSettings`), which is what made the
    // conflation easy; both are read now.
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
    // …and the instruction files it says it loaded (158). Same response, never asked for
    // separately — see {@link CodexSessionHandle.instructionSources} for why this is read at all
    // and why it replaces rather than merges.
    this._instructionSources = readStringArray(response, 'instructionSources')
    const ref = this.validateHandshake(response, opening) // throws on malformed / mismatched
    this.validateApprovalProfile(response) // throws if the prompting profile wasn't honored (013)
    this.startPhase('validated')
    this.machine.sessionStarted(ref, opening)
    // ⛔ **The baseline the sparse-update contract asks for** (201 §2). Fired here, after the
    // `session` event exists so nothing can precede it in the stream, and deliberately NOT awaited
    // — see {@link readRateLimitBaseline}.
    this.readRateLimitBaseline()
    // ⛔ **What this agent will answer to** (279). Beside the baseline above and for the same two
    // reasons: it is a fact the app has never asked for, and it must not delay the conversation it
    // describes. Measured, `skills/list` needs no thread at all — `probe:provider-commands` asks it
    // straight after `initialize` — so this is placed after the `session` event only so that nothing
    // it emits can precede the session's own start.
    this.readCommandList('thread/start')
    // ⛔ **What this thread was DECLARED, and the fact that Codex will never confirm it** (358).
    // Beside the two reads above and emitted for the opposite reason: those ask the provider a
    // question, and this one states the answer the provider does not have.
    this.publishToolInventory(opening === 'started' ? 'thread/start' : 'thread/resume')
    void this.runLoop()
  }

  /**
   * 🔴 **The tools this thread has — and the sentence that says the provider will not confirm them**
   * (358).
   *
   * ⛔ **`published: null`, on every Codex session, forever.** This is not a placeholder for a read
   * that has not been written. `348` sends `ThreadStartParams.dynamicTools` and the app-server
   * remembers the DECLARATION in its own table; every type on this protocol that could carry an
   * inventory back was read for this dispatch — `ThreadStartResponse`, `ThreadStartedNotification`,
   * `ThreadResumeResponse`, `Thread` (whose `extra` is `Record<string, never>`), `ThreadReadResponse`
   * and `ThreadSettings` — and not one has a tools field. The single echo anywhere on it is
   * `mcpServerStatus/list`, which reports servers configured in `config.toml` and is therefore about
   * the exact mechanism this app deliberately does not use.
   *
   * ⚑ **`353` saw a Codex inventory once**, and only by standing up a fake Responses endpoint and
   * reading the child's own outbound request body: the five qualified names were inside the `exec`
   * custom tool's description, a 2 455-byte delta over a control that declared none. That instrument
   * cannot exist for a conversation talking to OpenAI, so *"we cannot see it"* is the honest answer
   * and this event is where the app says so instead of leaving a surface to guess.
   *
   * ⚠️ **Stated on RESUME as well as on start, and the `source` says which.** The resume path sends
   * no `dynamicTools` — there is no field for it — but the toolset is still held by this handle and
   * still answers `item/tool/call`, so a reopened conversation that published nothing would read as
   * a conversation whose tools had gone.
   */
  private publishToolInventory(source: string): void {
    const bounded = boundInventory({
      naming: CODEX_TOOL_NAMING,
      declared:
        this.agentTools === undefined
          ? null
          : {
              server: this.agentTools.server,
              // 🔴 **D-039 · the sentence the namespace is declared with, and never the toolset's
              // instructions**, which this catalogue no longer carries — they ride the conversation
              // itself (see {@link CODEX_TOOLS_DESCRIPTION}). ⚠️ None for an empty toolset, which
              // declares no namespace at all. ⚠️ On a resume this states this build's sentence: a
              // thread started before D-039 keeps the description it started with, the instructions
              // as they stood then, and nothing on this protocol reads it back.
              ...(this.agentTools.tools.length === 0
                ? {}
                : { instructions: CODEX_TOOLS_DESCRIPTION }),
              tools: this.agentTools.tools.map((one) => ({
                name: one.name,
                description: one.description,
                parameters: parametersOf(one.input),
              })),
            },
      // ⛔ **The whole point of the arm.** See the docblock.
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

  /**
   * ⛔ **Ask the provider what the rate-limit state ALREADY is** (201 §2, from 192 H1).
   *
   * `AccountRateLimitsUpdatedNotification` is defined as a rolling update over *"the most recent
   * `account/rateLimits/read` response"*, and until now this app never fetched one. A user already
   * at the wall who opened a fresh conversation had a watch with nothing in it, so the first sparse
   * frame — a 92% window and `rateLimitReachedType: null`, because the wall was not re-sent — read
   * as *"approaching"*, or as nothing at all. ⚑ **Measured: the pinned binary answers this in well
   * under a second and fills `rateLimitsByLimitId` with TWO buckets on this account.**
   *
   * ⚠️ **Not awaited, and that is the design rather than a shortcut.** 175 is what a network wait
   * added to session start costs, and a baseline is worth nothing if it delays the conversation it
   * describes. {@link RateLimitWatch.seed} therefore merges UNDERNEATH anything already observed, so
   * a rolling frame that overtakes the response wins — it is the newer fact.
   *
   * ⚑ **It always says whether it ran.** A control that reports nothing by not executing is 174's
   * debt and 200 §8's first open item; the answer, or the failure to get one, is recorded as
   * lifecycle chatter either way, so a debug reader can tell "the account is fine" from "we never
   * asked". Bounded, because an unanswered request that simply never settles is the one thing
   * {@link withDeadline} exists to refuse.
   */
  private readRateLimitBaseline(): void {
    // ⚑ When it was ASKED — a rolling wall seen after this moment is newer than the answer.
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
      // The whole answer, unread and unsummarized, exactly as a notification's payload would be.
      this.emit(
        wrapUnknown(
          'codex',
          { method: RATE_LIMIT_READ, result: response },
          'lifecycle',
          RATE_LIMIT_READ,
        ),
      )
      for (const line of this.rateLimits.seed(response, Date.now(), askedAt)) {
        // Non-fatal, always: a throttle pauses a turn, it does not end a session (065's rule).
        this.emit({ type: 'error', message: line, fatal: false })
      }
      // ⚑ …and how full each window is, as this read says in full, for a person's Providers screen.
      for (const bucket of this.rateLimits.heldReadings()) {
        const usage = rateLimitUsage(bucket)
        if (usage !== null) this.emit(usage)
      }
    })()
  }

  /**
   * ⛔ **Ask Codex what commands this agent has** (279) — `skills/list`, and it is the whole answer.
   *
   * ⚠️ **Measured, and the measurement is the finding rather than the wiring.** `279` §1 names three
   * candidate surfaces and says not to assume any of them is Claude's slash-command list.
   * `probe:provider-commands` asked all three plus a fourth against the bundled 0.146.0 binary:
   *
   * ```
   * → skills/list             ← 6 rows: imagegen, openai-docs, plugin-creator, review-agent, …
   *                             (0.159.0 removed `plugin-creator`)
   * → plugin/list             ← {"marketplaces":[],"marketplaceLoadErrors":[],"featuredPluginIds":[]}
   * → collaborationMode/list  ← Plan, Default            ← MODES, not commands
   * → hooks/list              ← {"data":[{…,"hooks":[]}]}
   * ```
   *
   * ⛔ **So Codex publishes SKILLS and no slash commands at all.** There is no `/compact`, no
   * `/model`, no `/usage` on this protocol — not "we have not built it", but no such thing to build
   * against, which is the `absent` verdict `capabilities.ts` requires a written reason for. ⚑ **713
   * · the compaction itself IS on the protocol**, as a request rather than a command
   * (`thread/compact/start`), and a person's `/compact` reaches it through BroBot since `R59` — so
   * the COMMAND is BroBot's, and this list, which is Codex's, still carries none. The
   * `prefix` this emits is `$` because three of the four skills carrying an
   * `interface.defaultPrompt` write themselves that way in it and none writes `/name`.
   *
   * ⚠️ **`enabled: false` rows are left out, and that is a judgement worth naming.** A disabled skill
   * is not a command the agent has — listing it would put a row in the palette that the agent will
   * not answer to, which is the `106` this whole band exists to avoid. It is not counted as
   * `dropped` either: that number means *"this list is understating what the agent has"*, and a
   * disabled skill is not something it has.
   *
   * ⚑ **Called twice: once at thread start and again for every `skills/changed`.** That is the
   * asymmetry with Claude, stated rather than smoothed — Claude PUSHES the new list on
   * `commands_changed`, while `SkillsChangedNotification` is `Record<string, never>` whose own doc
   * says *"treat this as an invalidation signal and re-run `skills/list`"*. Nothing else in this
   * adapter answers a notification with a request, so the reason is written here.
   *
   * ⚠️ **Not awaited, and a failure publishes NOTHING.** `readRateLimitBaseline`'s rule for the
   * network wait, and `279` §2's rule for the silence: a registry that stayed `null` reads as *"we
   * have not been told"*, while an invented `[]` would say this agent has no commands. Those are
   * different facts and only one of them is true.
   *
   * ⚠️ **One more asymmetry with Claude, and it is worth naming because it looks like an omission.**
   * The Claude side emits its level BESIDE the `commands_changed` frame, which stays on the raw
   * stream as `unknown{lifecycle}` — so a reader can always check what the provider really said.
   * There is no such twin here: this is a REQUEST/RESPONSE, and a response was never on the
   * notification stream to be kept. ⚑ `readRateLimitBaseline` does emit its answer as chatter, and
   * this deliberately does not follow it: a rate-limit response is a handful of numbers, while a
   * skills list is the same payload the typed event already carries in full — a second copy would be
   * `052`'s growth for no reader.
   */
  private readCommandList(why: string): void {
    void (async () => {
      let response: unknown
      try {
        response = await withDeadline(
          // ⚠️ **No `cwds`, deliberately.** `SkillsListParams.cwds` documents its own default as
          // *"the current session working directory"* — which is this session's cwd, and therefore
          // the right answer — while naming one here would be this adapter deciding a scope the
          // server already knows. Measured: the probe asked for a second directory explicitly and
          // got the same six rows, so nothing is lost by not asking.
          this.transport.request('skills/list', {}),
          COMMAND_LIST_TIMEOUT_MS,
          'skills/list',
        )
      } catch {
        // See the docblock: silence is *"we were not told"*, which the palette has a sentence for.
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

  /** Of the account this session launched on; none on a key, which names no sign-in. */
  signInTag(): string | null {
    const account = this.launchAccount
    return account === null || account === undefined || account === 'api-key'
      ? null
      : signInTagOf(account)
  }

  /**
   * Has this profile's sign-in moved to another account since the launch? — **latched**, so every
   * later reader is free. By account, never by token: Codex renewing its own tokens on the same
   * account, which it does and reloads by itself, never trips it. A home that cannot be read now is
   * *cannot tell*, never a change.
   */
  async checkSignIn(): Promise<boolean> {
    if (this._signInSuperseded) return true
    if (this.launchAccount === null || this.launchAccount === undefined) return false
    const current = await codexAccountIn(this.providerHome)
    if (current === null || current === this.launchAccount) return false
    this._signInSuperseded = true
    return true
  }

  /** The latched answer — free to read, and what the liveness disclosure carries. */
  get signInSuperseded(): boolean {
    return this._signInSuperseded
  }

  /** The copy of the sign-in this session's app-server was started on; null where the home held none. */
  signInCopyAtLaunch(): CodexCopyIdentity | null {
    return this.launchCopy
  }

  /** Told each phase of this launch's opening; nothing until {@link noteStartPhases}. */
  private startPhase: StartPhaseSink = () => {}

  /** Who is told this launch's phases as {@link begin} reaches them. */
  noteStartPhases(sink: StartPhaseSink): void {
    this.startPhase = sink
  }

  /** The account the home named just before the app-server was spawned, which is what it loads. */
  noteLaunchAccount(account: string | null, copy: CodexCopyIdentity | null = null): void {
    this.launchAccount = account
    this.launchCopy = copy
  }

  /**
   * Refuse to open a session on a credential that cannot run a turn (098).
   *
   * Probe the credential before spending a message. The provider can succeed at initialize and thread/start with an expired profile copy, then report `codexErrorInfo: "unauthorized"` only as turn output, leaving a created conversation unable to run.
   *
   * Two local round trips (see `auth-probe.ts` — no network, no token consumed) turn that into a
   * launch that never happens and an {@link AuthUnavailableError} the surface already knows how to
   * show. `unknown` deliberately does not block: a probe that could not ask has learned nothing
   * about the credential, and refusing on it would report every transport hiccup as an expired
   * sign-in.
   */
  private async assertCredentialUsable(): Promise<void> {
    // The account the launch runs on, when the runtime did not note it before the spawn: a handle
    // built directly reads it here ({@link checkSignIn}).
    if (this.launchAccount === undefined)
      this.launchAccount = await codexAccountIn(this.providerHome)
    const state = await probeCodexAuth(this.transport)
    // ⚑ **What this launch runs on**, from the same answer: Codex reports a home logged in with the
    // person's key as an `apiKey` account. A refusal later says which one it refused (`onAKey`).
    this.launchedOnAKey = state.state === 'usable' && state.login === 'api-key'
    if (!blocksLaunch(state)) return
    // ⚑ Codex's own answer that a sign-in is there and it cannot use it, told apart from every
    // refusal made before Codex was asked, with the copy that was refused as it stands now.
    if (state.state === 'stale') {
      // ⛔ Named only when it is the copy this launch began on, unchanged: one put there since was
      // not what Codex refused.
      const now = codexCopyIdentityIn(this.providerHome)
      throw new CodexRefusedItsSignInError(
        authStateReason(state),
        isTheSameCodexCopy(this.launchCopy, now) ? now : null,
      )
    }
    throw new AuthUnavailableError('codex', authStateReason(state))
  }

  /**
   * Confirm the app-server actually applied the prompting approval profile (013,
   * fixing 007 P1-6). `thread/start`/`resume` echo the EFFECTIVE settings; a host
   * config could still have routed escalation to an auto-approver, opened full
   * access, or disabled approvals — in which case in-scope actions would never
   * reach the UI. Fail closed rather than run a session that silently won't
   * prompt: reviewer MUST be `user`, the policy MUST prompt (not `never`), and
   * the sandbox MUST NOT be full access.
   */
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

  /**
   * Remember the `ask` sandbox policy the server reported, so the per-turn re-pin re-sends the
   * server's own value rather than a captured one (034). Read from both places the effective
   * settings are echoed — the handshake response and every `thread/settings/updated`. A reading
   * that is not a fully-formed `workspaceWrite` policy (the `auto` profile's `dangerFullAccess`, a
   * bare mode string, a missing field) changes nothing: it is not evidence about what the `ask`
   * sandbox means here.
   */
  private observeAskPolicy(value: unknown): void {
    const policy = askPolicyOf(value)
    if (policy === null) return
    this.observedAskPolicy = policy
    // 🔴 W4.189 — until a work folder has been sent, every root reported is the thread's own.
    if (this.workFoldersSent.size === 0) this.theThreadsOwnRoots = new Set(policy.writableRoots)
  }

  /**
   * 🔴 **W4.189 · the work folders a request is about to carry**, in this mode ({@link workRootsFor})
   * — remembered as sent BEFORE the request is written, so an echo of it can never arrive first.
   */
  private sendingWorkFolders(
    approvalMode: ApprovalMode | undefined,
    folders: readonly string[],
  ): readonly string[] {
    const roots = workRootsFor(approvalMode, folders)
    for (const root of roots) this.workFoldersSent.add(root)
    return roots
  }

  /**
   * Confirm the app-server speaks the protocol we vendored types for (043, closing 036 P2-6).
   * We parse every message through the generated `protocol/` types; a PATH `codex` of another
   * version can silently mis-parse the wire (renamed fields read as `undefined`, new union
   * variants fall to our `unknown` branches), so drift must be a loud, actionable failure at
   * launch rather than confusing behavior later. Absent/unreadable version metadata is treated
   * as drift too — we never assume compatibility we could not verify.
   */
  private validateProtocolVersion(response: unknown): void {
    const reported = codexVersionFromUserAgent(readString(response, 'userAgent'))
    if (reported === CODEX_PROTOCOL_VERSION) return
    throw new StartFailed(
      `Codex CLI ${reported ?? '(version not reported)'} ≠ vendored protocol ${CODEX_PROTOCOL_VERSION} — ` +
        'regenerate the types (pnpm run protocol:generate) or pin the CLI to the vendored version',
    )
  }

  /**
   * Confirm the app-server actually adopted our per-profile `CODEX_HOME` (021,
   * from 015). The `initialize` response echoes the effective `codexHome`; if it
   * is present and does NOT canonicalize to the home we launched with, the child
   * ignored our env (or a host config overrode it) and its state would leak across
   * profiles — fail closed. Absent (test fakes / older servers) → skip, so the
   * transport seam stays fake-able without a live process.
   */
  private validateCodexHome(response: unknown): void {
    // Attestation is REQUIRED and fail-closed (027, fixing 023 P1-H): the protocol
    // mandates `codexHome` in the initialize response, so its absence is a rejection —
    // never a skipped check that would re-open the fail-open path.
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
    // (`sqlite_home` is attested pre-spawn and again at the top of `begin()` — see there.)
  }

  /**
   * Validate a `thread/start` | `thread/resume` response before accepting it as
   * the session ref (011, fixing 007 P1-4): the thread id comes ONLY from the
   * response (no `{}`→`''`, no fallback to the requested id), must pass
   * `sessionRefSchema` (non-empty id), and on resume must match the requested
   * `sessionId` + `cwd` EXACTLY. A failure throws — begin()'s callers close the
   * transport and reject (a resume failure becomes a `ResumeError`).
   *
   * ⚑ **715 · R64 has nothing to change here, and that is measured.** This reads the handshake
   * RESPONSE, once per launch — no later frame reaches it. And a model's `cd` did not move what
   * Codex reports: `probe:codex-resume-after-cd` ran `cd sub && pwd` through the bundled binary's
   * own `exec_command` — as `/bin/zsh -lc 'cd sub && pwd'`, which printed the moved folder — in a
   * fresh launch and in a resumed one. The request of the turn after it still told the model one
   * `<cwd>`, the launch folder, and no new one; and the NEXT resume's response named the launch
   * folder and passed. (The command item's own `cwd` is the `workdir` the call named.)
   */
  private validateHandshake(response: unknown, opening: 'started' | 'resumed'): SessionRef {
    const thread = isRecord(response) ? response['thread'] : undefined
    const responseCwd = readString(thread, 'cwd')
    const candidate = {
      provider: this.provider,
      sessionId: readString(thread, 'id'),
      // Started: we know the cwd we launched in, so a missing echo is fine.
      // Resumed: cwd is part of identity and must be PROVEN by the response — no
      // fallback to the requested cwd (else an omitted cwd passes the match
      // vacuously). An empty resume cwd then fails the schema below.
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
    // After terminalization, drop everything: no late notification may mutate
    // cached status or reach a consumer that has already seen `ended` (007 P1-1).
    if (this.terminated) return
    // Deltas are coalesced; the coalescer flushes them before any non-delta event
    // (message/terminal), preserving ordering (019). It calls `deliver` for real output.
    this.coalescer.feed(event)
  }

  /**
   * Makes a silent stall visible (074). Armed while the turn is `working`, reset by every event, and
   * stopped the moment the turn terminalizes or the session ends. `waiting_permission` is
   * deliberately NOT watched — a card waiting on the user is not a stall.
   */
  private readonly stallWatchdog = new StallWatchdog((idleMs, afterReasoning) =>
    this.reportStall(idleMs, afterReasoning),
  )

  /** Emit the stall notice as a NON-FATAL error: visible, but it never ends the turn or session. */
  private reportStall(idleMs: number, afterReasoning = false): void {
    // `hasProviderWork`, not `hasActiveTurn` — see the Claude adapter's copy of this guard (123).
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
    // ⚑ **Where the app learns the provider is working with no turn open** (123). Codex correlates
    // almost everything to a thread turn, so this fires far less often here than on Claude — the
    // live corpus holds 18 out-of-turn bursts and every one of them is Claude's. It is wired anyway,
    // because "the provider is busy" is a provider-neutral fact and the machine that consumes it is
    // shared (008); an adapter that quietly opted out would be the one whose sessions still lied.
    if (isProviderWork(event)) this.machine.noteProviderWork(event.type)
    if (event.type === 'status') this.currentStatus = event.state
    if (event.type === 'session' && event.state !== 'ended') this._ref = event.ref
    // ⚠️ **A sub-agent card cannot outlive its turn IN THE STREAM** (075). Here rather than in
    // `normalizeNotification` because this is the one place output order is final: the endings have
    // to land BEFORE the boundary that provoked them, or the ledger reads "the turn ended, and then
    // a sub-agent stopped", which is a different sentence.
    //
    // Told to {@link subAgents} as well, for the reason its own `note` gives about an `interrupted`
    // birth: a card that has been ended must leave that tracker's entry ended, or the child's
    // trailing `idle` reports a SECOND ending for a card already closed.
    //
    // ⛔ **`seal`, not `note`, since 226 — and the sentence this replaces was the reason why.** It
    // read *"the two endings are byte-identical — `{phase:'ended', agentId}`, no outcome — so
    // nothing is lost either way"*, and that is no longer true: a child's own `turn/completed`
    // carries an outcome and a duration, and it arrives AFTER this boundary on an interrupt. Three
    // of the child's own reports do. `note` would leave every one of them free to speak about a card
    // this line has just closed — one of them putting it back in `open`, to be closed a second time
    // on the next turn. Sealing is what makes "closed here" mean closed.
    if (endsOpenSubAgents(event)) {
      for (const closing of this.openSubAgents.closeAll()) {
        this.subAgents.seal(closing)
        this.eventQueue.push(closing)
      }
    }
    this.openSubAgents.note(event)
    // A terminal `turn` is the retention boundary (057): every request the turn owned has been
    // responded to and can no longer be referenced, so its tombstones retire into the O(1) floor.
    if (event.type === 'turn') this.retireSettledRequestIds()
    this.eventQueue.push(event)
  }

  /** Track a server-request handler so `close()` can await its wire write before teardown. */
  private track(handler: Promise<void>): void {
    this.inFlight.add(handler)
    // Observe BOTH completion and rejection (023 P1-A): a late `respond` can throw
    // "write after terminal" once the transport is torn down, which must never
    // surface as an unhandled promise rejection. `drainInFlight` uses `allSettled`,
    // so the tracked handler itself is observed safely there too.
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

  /**
   * Every notification the transport delivered to this session, counted BEFORE anything can drop
   * one (200 §3). ⚠️ **The denominator is the point.** A drop count alone cannot tell a gate that
   * started dropping frames from a provider that stopped sending them — the exact hazard §3 names —
   * and those two have opposite remedies.
   */
  private notificationsSeen = 0

  /** Frames {@link namesForeignThread} refused, per method (200 §3). See {@link frameScope}. */
  private readonly foreignThreadDrops = new Map<string, number>()

  /**
   * How many of those refused frames also yielded a report about one of our own children (226).
   *
   * ⚠️ **A third number rather than a smaller `dropped`.** The two facts are different — *this
   * frame's content is not ours* and *this frame said something about a card we show* — and folding
   * the second into the first would have made `dropped` disagree with the independent tee
   * `probe:foreign-thread` measures it against, which is the one thing keeping that counter honest.
   */
  private frameScopeAdopted = 0

  /**
   * Count one refusal, ATTRIBUTED while attribution is affordable (200 §3).
   *
   * ⚠️ **The key is a string off the wire, so this map is bounded** (052's subject, 069's angle): a
   * provider emitting unbounded distinct method names must not be able to grow a diagnostic counter
   * without limit, and `notificationCategory` already assumes nothing about the vocabulary's size.
   * Past the cap the TALLY stays exact and only the attribution is given up — which is the right way
   * round, because `dropped` is the number §3 exists to report and `byMethod` is the colour on it.
   */
  private countForeignDrop(method: string): void {
    const key =
      this.foreignThreadDrops.has(method) ||
      this.foreignThreadDrops.size < MAX_ATTRIBUTED_DROP_METHODS
        ? method
        : OTHER_DROP_METHODS
    this.foreignThreadDrops.set(key, (this.foreignThreadDrops.get(key) ?? 0) + 1)
  }

  /**
   * ⛔ **What this session's thread gate has seen and refused** — the instrument that keeps the gate
   * from sealing its own evidence (200 §3, on 184's precedent).
   *
   * ⚠️ **184 is why this exists rather than a comment saying "it should not happen".** That dispatch
   * gated `item/fileChange/patchUpdated` and, in the same breath, cost `probe:file-change` its
   * detector — the probe decided "did it arrive?" from the NORMALIZED stream, and a gated frame never
   * reaches the normalizer. Its fix was to move the detector onto the transport, where frames are
   * counted before anything can drop them. This counter is the same move made in-process: read at
   * the first statement of {@link onNotification}, so `seen` is a count of what the transport
   * delivered and `dropped` is a count of what this gate refused, with nothing between them.
   *
   * ⚑ **Diagnostics only — nothing in the app branches on it.** `probe:foreign-thread` prints it
   * beside an independent tee of the same wire, which is the check that this count is honest.
   *
   * ⚠️ **`adopted` is the third number 226 added**, and it is a subset of `dropped`, not a deduction
   * from it: a frame naming a child's thread has its content refused exactly as before AND is read
   * for what it says about that child's card. Reporting one number would have meant choosing which
   * of those two true things to hide.
   */
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

  /**
   * ⛔ **Predicate ONE of two: does this frame name a thread that is not ours?** (200 §1a)
   *
   * ⚠️ **The bug this replaces was not a missing name in a list — it was the list.** Thread scope
   * used to be decided by {@link isTurnScopedContent}, i.e. by method-name MEMBERSHIP, so every
   * method outside those nine got no correlation at all — including ones whose generated type
   * declares `threadId` REQUIRED. That set had been widened reactively three times (027, 028, 184)
   * and 192 H2/H3 was the fourth request; widening is the wrong fix, because the property that
   * decides is not what a method is CALLED, it is what its frame CARRIES.
   *
   * **So there are two predicates now, and they are applied by different things.** This one is
   * universal and reads the id. {@link isTurnScopedContent} stays a membership test, because turn
   * correlation genuinely is a per-method judgement about whether a stale frame can hurt.
   *
   * ⚠️ **"Foreign" is still the right word, and 226 did not widen it.** A frame naming a child's
   * thread is foreign — its content is another conversation's and is refused here — but it can
   * still be a REPORT about a card this session shows. That is read after the refusal, from the
   * membership `CodexSubAgents` already holds, and never from this method's answer: see
   * {@link CodexSubAgents.report}.
   *
   * ⚠️ **Absence stays tolerated**, and that leniency is inherited rather than invented: the
   * diagnostic streams do not all carry ids, and {@link serverRequestScopeProblem} records why the
   * AUTHORIZATION path is deliberately stricter than this one. A frame with no `threadId` is not a
   * frame claiming a foreign thread.
   *
   * ⛔ **`account/rateLimits/updated` is why "gate every first-class method" would have been wrong**
   * (192, refused): its generated type is `{ rateLimits }` and nothing else — no `threadId`, no
   * `turnId`, by design, because it describes the ACCOUNT rather than any thread. It therefore
   * passes here on the absence rule, and it must: it is the only warning a user gets before hitting
   * the weekly wall (177). The same absence rule is what carries `WarningNotification` and
   * `McpServerStatusUpdatedNotification`, both of which declare `threadId` as nullable.
   *
   * ⛔ **And `error` is NOT turn-gated, which this gate is what makes safe.** A rejected credential
   * arrives as an `error` notification with `codexErrorInfo: "unauthorized"` (098) and it can arrive
   * with no live turn — `isCurrentProviderTurn` returns false whenever there is no bound turn, so
   * adding `error` to the turn set would silently DROP the one message that says the session can
   * never run. Dropping it for a FOREIGN THREAD is the opposite case and the desirable one: that
   * error belongs to somebody else's conversation, and this session has nothing to say about it.
   */
  private namesForeignThread(method: string, params: unknown): boolean {
    if (THREAD_SUBJECT_METHODS.has(method)) return false
    const ref = this._ref
    // Before the handshake binds a thread there is nothing to compare against, and a session that
    // does not know its own id cannot call anything foreign — the same fail-open `SubAgents.observe`
    // makes for the same reason.
    if (!ref) return false
    const threadId = readString(params, 'threadId')
    return threadId !== '' && threadId !== ref.sessionId
  }

  private onNotification(method: string, params: unknown): void {
    if (this.terminated) return
    this.notificationsSeen += 1
    // ⛔ **Thread scope is decided HERE, once, for every notification** (200 §1a) — above
    // `thread/settings/updated`, which is the half of 192 H3 that actually bites: that handler reads
    // only `params.threadSettings` and never the `threadId` its own generated type declares
    // required, and a non-prompting profile in it reaches `checkSettingsProfile` → `finishUnexpected`
    // → `transport.close()`. ⚑ **A foreign thread could therefore KILL this session.** 192 also filed
    // *"it returns before any generic gate"* as the defect; that half is wrong and deleting the early
    // return fixes nothing, because before this line there was no generic gate to return before.
    if (this.namesForeignThread(method, params)) {
      this.countForeignDrop(method)
      // ⛔ **Counted as a drop first, and that ordering is the honest accounting** (226). This
      // frame's CONTENT is still refused — none of it enters this conversation — so `dropped` keeps
      // meaning exactly what `probe:foreign-thread` checks it against. What follows reads a REPORT
      // out of a frame we have already declined, for a card this session is already showing, and
      // says how many times it did so in a counter of its own.
      const reports = this.subAgents.report(method, params)
      if (reports.length > 0) this.frameScopeAdopted += 1
      for (const event of reports) this.emit(event)
      return
    }
    if (method === 'skills/changed') {
      // ⛔ **An invalidation signal, not a payload** (279) — `SkillsChangedNotification` is
      // `Record<string, never>`, and its own doc says to *"re-run `skills/list`"*. It still falls
      // through to the chatter line below, so the raw frame is on the stream exactly as it was:
      // this ADDS a re-read and claims nothing, the same rule `backgroundWorkEvents` follows on the
      // Claude side.
      this.readCommandList(method)
    }
    if (method === 'thread/settings/updated') {
      // The handshake profile is validated once; a mid-session change (host
      // config reload, another client, guardian) could still flip to a
      // non-prompting profile. Re-validate the effective settings and fail closed
      // rather than run blind (007 P1-6). Note: the notification field is
      // `sandboxPolicy` (vs the handshake response's `sandbox`).
      this.checkSettingsProfile(params)
      // `ThreadSettings` reports the live model AND `effort` (that is the real field name — there is
      // no `reasoning_effort` in the vendored protocol). Captured so the panel cannot go stale.
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
      // Correlated terminalization (037/029, 036/023 P1-C) — handled fully here.
      const ours = this.onTurnCompleted(params)
      // 🔴 **713 · a turn of ours ran to its end**, so a compaction the bound gave up on is taken as
      // gone — see {@link compactionOutstanding}, and its residual.
      if (ours) this.compactionOutstanding = false
      // ⛔ **The ONE edge Codex's background level has** (275), and it is here rather than at the
      // foot of this method because this branch returns. It is the instant the app is about to say
      // `idle`, over a command the probe measured still running four seconds into four hundred —
      // `250` is what a wrong answer there costs — and it is also the honest discriminator for the
      // subject: work that outlives its turn. See {@link BackgroundTerminals.note} for the ordinary
      // foreground command that asking any earlier would have broken.
      //
      // 🔴 **Only when the completion was OURS** (287 §1, finding 2). This called `note()`
      // unconditionally, three lines under a function whose entire job is rejecting a stale
      // `turn/completed` — so a delayed duplicate for an old turn A, arriving while turn B is
      // running an ordinary FOREGROUND command, asked for the level anyway. Codex lists every PTY
      // from process start, so B's live command entered the registry, was given a Stop that
      // terminates foreground work, and was polled; when it left the list the generated
      // `ended: unknown` landed on B's card and outranked its real successful result. ⛔ **The
      // discriminator this edge rests on is "a turn of ours ended", and only `onTurnCompleted`
      // knows whether one did.**
      if (ours) this.backgroundTerminals.note(method)
      return
    }
    if (method === 'serverRequest/resolved') {
      // The provider RESOLVED or CLEARED a server request (it clears them on turn
      // start/completion/interruption). Handled before generic normalization (051).
      this.onServerRequestResolved(params)
      return
    }
    if (method === 'model/rerouted') {
      // The provider moved the session to another model mid-run (081) — show what is actually
      // running, not what it started as.
      const toModel = readString(params, 'toModel')
      if (toModel) this.mergeAgentInfo({ model: toModel })
      // ⚠️ **And forwarded below, where 177 made it a VISIBLE non-fatal error rather than chatter.**
      // The two halves answer different questions and both are needed: this line keeps the header
      // showing what is actually running, and the notice is the only thing that says the model
      // changed at all — `086`'s rule, since "you are talking to the model you picked" is a state.
    }
    if (method === 'turn/started') {
      // Binding is AUTHORITATIVE from the `turn/start` RESPONSE (037, fixing 036 P1-C),
      // NOT this notification. `turn/started` carries no content and no longer binds — so
      // a delayed/duplicate one for an old provider turn can never rebind the current local
      // turn to the wrong provider turn. ⚠️ **713 · except a compaction's**, whose request answers
      // with no id: it binds here, refusing the id bound last — see {@link CodexTurn.bindsAtItsStart}.
      //
      // 🔴 **704 · but it IS the moment the turn becomes interruptible** — see
      // {@link CodexTurn.interruptAsked}. An interrupt asked for the turn it names is sent again
      // here, because Codex refused the one sent at the bind if the turn was not running yet.
      // ⚑ Only for the CURRENT provider turn: a stale `turn/started` for a turn already ended, or
      // one for a replacement nobody interrupted, sends nothing.
      const startedId = readString(isRecord(params) ? params['turn'] : undefined, 'id')
      // 🔴 **713 · …except a compaction's, which binds HERE** — see {@link CodexTurn.bindsAtItsStart}.
      // ⚑ The bind fires an interrupt asked before it, and the turn is running now, so nothing is
      // left for the resend below to do.
      if (this.bindsACompactionAt(startedId)) {
        this.bindProviderTurn(startedId)
        return
      }
      // 🔴 **713 · a turn nobody here bound has started** — a compaction the bound gave up on,
      // showing itself. ⚑ Its frames stay dropped; a compaction may be asked for again.
      if (!this.isCurrentProviderTurn(startedId)) this.compactionOutstanding = false
      if (this.currentTurn?.interruptAsked && this.isCurrentProviderTurn(startedId)) {
        void this.sendInterruptRpc(startedId)
      }
      return
    }
    // ⛔ **ABOVE the turn gate for {@link noteCommandOutput}'s own reason, and ABOVE the two lines
    // below it for a second one** (462). A completion is ADDRESSED — it lands in the hold of the id
    // it names and nowhere else — so a late or stale one cannot contaminate anything, which is the
    // property that licenses reading it outside the gate at all. ⚠️ **And it is written HERE rather
    // than between them because `300 M1` anchors on those two lines followed by the comment under
    // them**: a line inserted into that block retires a row that is still protecting something real,
    // and `142`'s rule is that the code moves rather than another dispatch's table.
    if (method === 'item/completed') this.noteToolAnswer(params)
    // ⛔ **ABOVE the turn gate, and that is the whole of 300's gap 3** — see {@link noteCommandOutput}
    // for why this one method is fed from outside it and why doing so cannot leak content.
    if (method === 'item/commandExecution/outputDelta') this.noteCommandOutput(params)
    if (method === 'item/completed') this.closeCommandOutput(params)
    // Turn-scoped CONTENT (agent-message deltas + item lifecycle) carries threadId+turnId;
    // honor it only when it matches the response-bound turn — a stale/duplicate/mismatched
    // notification for another provider turn is ignored (037, 036 P1-C). The `turn/start`
    // response always precedes its turn's notifications on the wire (the server returns the
    // Turn before streaming its events), so a bound id is always present for real content.
    if (isTurnScopedContent(method) && !this.isCurrentProviderTurn(readString(params, 'turnId'))) {
      return
    }
    // ⛔ **BELOW the turn-scope gate** (181): an item from a stale or foreign turn must not be able
    // to put a path on the card for the turn that is actually running. It cannot reach a card of its
    // own either — `handleApproval` is only entered for a request this session accepted — so the
    // gate is what keeps the correlation honest at both ends.
    //
    // ⚑ **And since 184 that is true of every method the tracker reads**, not just two of the three:
    // `item/fileChange/patchUpdated` used to arrive here having passed nothing, because it is not
    // first-class content and the gate was written about content. It is what the tracker reads that
    // decides, not what the UI renders.
    this.patches.note(method, params)
    this.mcpCalls.note(method, params)
    this.noteWhatTheTurnMovedOnTo(method, params)
    // ⚑ The watch is THIS session's, and it is the only stateful thing this call carries — see
    // `normalizeNotification`'s parameter and `RateLimitWatch` for why one notification needs it.
    for (const normalized of normalizeNotification(method, params, this.rateLimits)) {
      const event = this.withMessageReceipt(normalized, method, params)
      // The sub-agent tracker learns which threads are children from the NEUTRAL events, so the
      // provider's item shape is read in one place only (033).
      this.subAgents.note(event)
      // ⚑ **F084 · a command THIS turn started** — the gate above holds an item to the bound turn, and
      // only a command run in a process of its own carries a stop key.
      if (event.type === 'tool_call' && event.backgroundId !== undefined) {
        this.currentTurn?.commands.set(event.id, { movedOn: false })
      }
      this.emit(
        this.resolveImage(
          this.restatePlan(this.markTheAskedCompaction(this.sayWhichKey(event, method, params))),
        ),
      )
    }
    // A sub-agent's progress and its ending arrive on the CHILD's own `thread/status/changed` —
    // deliberately not turn-scoped. ⚠️ **It was "the only completion signal Codex sends" (033) until
    // 226 measured a second one**: the child's own `turn/completed`, read above in the drop branch,
    // which is the only frame that says HOW it ended. This one still ends a card whose turn we never
    // see complete, so it stays first and stays load-bearing.
    for (const event of this.subAgents.status(method, params)) this.emit(event)
  }

  /**
   * ⚑ **A refused credential says WHICH one** — normalizing cannot know what this home runs on, and
   * the launch's probe did ({@link launchedOnAKey}). ⛔ *"Sign in again"* is no remedy for a key.
   */
  private sayWhichKey(event: RuntimeEvent, method: string, params: unknown): RuntimeEvent {
    if (event.type !== 'error' || !this.launchedOnAKey) return event
    if (event.cause === 'auth') return { ...event, onAKey: true }
    // On an API key, `usageLimitExceeded` is the key's account out of quota (OpenAI's
    // `insufficient_quota`): the plan limits that share the code only apply to a ChatGPT sign-in.
    if (method === 'error' && codexErrorIsAUsageLimit(params)) {
      return { ...event, billingRefused: true, onAKey: true }
    }
    return event
  }

  /**
   * 🔴 **713 · a compaction this session ASKED for says so** — `trigger: 'manual'`, the word Claude's
   * `compact_boundary` carries for a person's `/compact`, so the transcript's row reads *"at
   * someone's request"* on both providers (`R59`: *"the transcript shows the compaction the way it
   * shows Claude's"*).
   *
   * ⚠️ **Only inside a compaction's own turn** ({@link CodexTurn.bindsAtItsStart}), which only
   * {@link CodexSessionHandle.compact} begins. ⛔ Codex's `contextCompaction` item carries no trigger
   * of its own, so an automatic compaction inside an ordinary turn keeps saying nothing about who
   * asked — which is the truth about what Codex told us.
   */
  private markTheAskedCompaction(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== 'compaction' || this.currentTurn?.bindsAtItsStart !== true) return event
    return { ...event, trigger: 'manual' }
  }

  /**
   * Turn the provider's claim about where it saved an image into a checked fact, or into nothing
   * (067).
   *
   * ⚠️ **This is the only place an image path becomes usable, and it is deliberately downstream of
   * everything.** `normalizeNotification` is a pure function with no home and no filesystem, so the
   * path it produces is the provider's own string, unexamined. That string must not reach a
   * consumer: the renderer will ask the main process to open whatever it is handed, and 050 is the
   * standing proof that "the agent wrote it" and "safe to open" are different sentences. So the
   * substitution happens here, on the one path out — `emit` — where the session's own `CODEX_HOME`
   * and thread id are both in scope and `resolveGeneratedImage` can refuse.
   *
   * **Refusal is silent and lossy on purpose.** A path that fails those checks — not there, not a
   * regular file, not a type we display — is not reported as a path we would not open; it is
   * simply absent, and the event says an image was generated whose file is not there. A consumer
   * cannot tell that case from a file the model moved away, and it should not: both mean the
   * picture cannot be shown, and a UI that distinguished them would be telling the user about our
   * checks instead of about their image.
   *
   * Resolution happens **once, here, at emit time**, so the answer is written into the ledger and a
   * resumed session replays the path it had rather than re-deriving one against a home that may
   * since have been swept.
   */
  private resolveImage(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== 'image') return event
    // No bound thread means no images directory to look in. Reachable only if an item arrived
    // before the thread was known, which the turn-scope gate above already refuses — so this is a
    // type obligation discharged honestly rather than a case with a story.
    const threadId = this._ref?.sessionId
    const path = threadId
      ? resolveGeneratedImage({
          codexHome: this.providerHome,
          threadId,
          imageId: event.imageId,
          ...(event.path ? { savedPath: event.path } : {}),
        })
      : null
    // REBUILT rather than spread over: `{...event, path}` would keep the provider's string whenever
    // resolution returned null, which is the one outcome that must not survive.
    return {
      type: 'image',
      imageId: event.imageId,
      ...(path ? { path } : {}),
      ...(event.prompt ? { prompt: event.prompt } : {}),
    }
  }

  /** The running checklist, so the plan DOCUMENT can restate it (057). See {@link restatePlan}. */
  private planSteps: PlanStep[] = []

  /**
   * Keep the neutral checklist contract true of Codex's plan DOCUMENT too (057).
   *
   * `plan_update` means "here is the COMPLETE list" (028) — every consumer replaces on it, which is
   * what stops an abandoned step surviving as a line the model has moved on from. Codex's two plans
   * arrive through different doors: the checklist on `turn/plan/updated`, the document on a `plan`
   * item, and `normalizeNotification` is a PURE function that cannot see one while producing the
   * other. So the document is emitted with `steps: []`, which under that contract is not "no
   * checklist mentioned" — it is "the checklist is now empty".
   *
   * The measurement says the two never meet: Codex's server forbids the checklist tool while
   * planning (*"if you try to use `update_plan` in Plan mode, it will return an error"*, from the
   * instructions it injected into our own probe) and `turn/plan/updated` fired zero times across the
   * plan turn and its default-mode control. That is two turns and a sentence, though, and the cost
   * of it being wrong is a checklist silently emptied on screen. Restating it here costs a field.
   *
   * This is exactly what Claude's `todoPlan.document()` already does on the other side, and for the
   * same stated reason — so the two adapters now keep the contract the same way instead of one of
   * them keeping it by argument.
   */
  private restatePlan(event: RuntimeEvent): RuntimeEvent {
    if (event.type !== 'plan_update') return event
    // ⚠️ **An event that says NOTHING must not be read as saying "empty" (064, found by 067's
    // review).** The test used to be `body === undefined` — "this is a checklist event, so it is the
    // new truth" — and a `turn/plan/updated` carrying an empty `plan` array satisfies it while
    // stating nothing at all. It wiped the memory, and the plan DOCUMENT that followed then went out
    // with `steps: []` at a consumer whose contract is to REPLACE on it (028).
    //
    // The renderer already reads that same event exactly this way — *"an empty checklist appearing
    // out of nowhere claims a plan exists and shows none"*, `transcript.ts` — so this is the two
    // sides agreeing rather than a new rule. A checklist that genuinely empties one still empties
    // it: the event reaches the consumer either way, and an emptying that says something about
    // itself (a note, or an open block to empty) is not this case.
    if (event.steps.length === 0 && event.body === undefined && !event.note) return event
    // A checklist event (or any event that states steps) IS the new truth — remember it. Copied,
    // not aliased: the event is emitted, persisted and replayed, and a shared array would let a
    // later consumer's mutation reach back into this memory.
    if (event.steps.length > 0 || event.body === undefined) {
      this.planSteps = event.steps.map((step) => ({ ...step }))
      return event
    }
    if (this.planSteps.length === 0) return event
    return { ...event, steps: this.planSteps.map((step) => ({ ...step })) }
  }

  /**
   * Bind the provider `turnId` — from the AUTHORITATIVE `turn/start` response — to the
   * current local turn, firing a latched early interrupt (037/029). Idempotent per turn:
   * once bound it never rebinds, so a later `turn/started` notification cannot move it.
   * ⚠️ **704 · the RPC fired here is usually REFUSED** — the turn is bound, not yet running — and
   * `turn/started` sends it again ({@link CodexTurn.interruptAsked}).
   * 🔴 **713 · and one turn binds from its `turn/started` instead: a compaction's**
   * ({@link CodexTurn.bindsAtItsStart}), whose request answers with no id. That turn IS running when
   * it binds, so the interrupt fired here reaches it and no resend is owed.
   */
  private bindProviderTurn(providerTurnId: string): void {
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId !== null || !providerTurnId) return
    turn.providerTurnId = providerTurnId
    this.lastBoundTurnId = providerTurnId
    if (turn.interruptPending) {
      turn.interruptPending = false
      void this.sendInterruptRpc(providerTurnId) // the early interrupt, now that the id is known
    }
  }

  /**
   * Bind the local turn to the provider turn id from the AUTHORITATIVE `turn/start`
   * response (037, fixing 036 P1-C): `TurnStartResponse = { turn: { id } }`. This is the
   * JSON-RPC result correlated by request id, so it can never bind the wrong turn the way
   * a delayed/duplicate `turn/started` notification could. A malformed/missing result is a
   * provider protocol error → fail closed (terminalize + error), never proceed uncorrelated.
   */
  private onTurnStartResult(localId: number, result: unknown): void {
    if (this.terminated) return
    // The turn may already be gone (interrupted/closed before the response resolved).
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

  /**
   * 🔴 **713 · may this `turn/started` bind the compaction waiting for its id?**
   *
   * ⚑ Only while a compaction's turn is unbound ({@link CodexTurn.bindsAtItsStart}), and ⛔ **never
   * to the id this session bound last** — a delayed duplicate of the turn before, which is the frame
   * 037 moved every other bind off notifications to refuse. ⚠️ Every EARLIER turn has ended before a
   * compaction may begin, and on one ordered stream its `turn/started` came before its end.
   */
  private bindsACompactionAt(startedId: string): boolean {
    const turn = this.currentTurn
    return (
      turn?.bindsAtItsStart === true &&
      turn.providerTurnId === null &&
      startedId !== '' &&
      startedId !== this.lastBoundTurnId
    )
  }

  /**
   * ⛔ **Predicate TWO of two: is this frame's `turnId` the turn we are running?** (037, 036 P1-C)
   * Before the id is bound, or for any other provider turn, it is false — the notification is
   * ignored, never mis-attributed to (or used to terminalize) the current turn.
   *
   * ⚠️ **It used to check the thread id as well, and 200 took that half out.** Not because the
   * check was wrong but because it was the SECOND opinion on one question, and 042's ruling about
   * three writers of `status` applies unchanged: thread scope is now decided once, at the first
   * statement of {@link onNotification}, for every notification rather than for the nine this
   * predicate happens to be called for. Both call sites are below that gate, so a frame naming
   * another thread cannot reach this function at all — and a duplicate check here would be a row
   * no mutation could turn red, which is 198's definition of code to delete rather than keep.
   */
  private isCurrentProviderTurn(turnId: string): boolean {
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId === null) return false
    return turnId === turn.providerTurnId
  }

  /**
   * Terminalize the current local turn ONLY when a `turn/completed` matches ITS bound
   * provider thread/turn id (037/029, 036/023 P1-C). A stale/duplicate completion for a
   * different or old provider turn — or one arriving before the id was bound — is ignored,
   * so it can never terminalize the newly-accepted next turn.
   *
   * ⛔ **Returns whether a turn of OURS ended** (287 finding 2). The answer used to be discarded and
   * the caller went on to raise the background level's one edge regardless — which made a rejected
   * frame do half of what an accepted one does, on the channel whose whole correctness argument is
   * *"this only ever runs at a turn boundary"*. A predicate that is consulted by the terminalization
   * and ignored by its neighbour is two readings of one fact, which is `042`'s ruling and `099`'s.
   */
  private onTurnCompleted(params: unknown): boolean {
    const p = isRecord(params) ? params : {}
    const completedTurnId = readString(isRecord(p['turn']) ? p['turn'] : undefined, 'id')
    if (!this.isCurrentProviderTurn(completedTurnId)) return false
    const outcome = codexTurnOutcome(params)
    const ended = this.currentTurn
    this.messageCalls.close()
    this.currentTurn = null
    // The usage limit a refused turn ended on rides its ending. On an API key the same code means
    // the key's account is out of quota, which no reset ends, so it is a billing refusal instead.
    const hitItsUsage = codexTurnHitItsUsageLimit(params)
    const outOfQuota = hitItsUsage && this.launchedOnAKey
    const limit = hitItsUsage && !outOfQuota ? this.rateLimits.reachedLimit() : undefined
    // ⚑ **F076 — and a turn Codex failed on the credential it was launched with says so**, as a
    // Claude turn does, with whether that credential was the person's key ({@link launchedOnAKey}).
    const refused = codexTurnFailedOnItsCredential(params)
      ? { loginRefused: true as const, ...(this.launchedOnAKey ? { onAKey: true as const } : {}) }
      : outOfQuota
        ? { billingRefused: true as const, onAKey: true as const }
        : undefined
    // ⚑ **F084 · a stopped turn's ending waits, a bounded moment, for the commands its stop ends** —
    // the pass the stop began, then one more for a command started after that pass read the list —
    // so the ending names every one. ⚠️ The turn stays the machine's open one meanwhile, so no next
    // turn can start, and a stop asked meanwhile waits for this ending ({@link completing}).
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

  /**
   * ⚑ **F084** — see {@link onTurnCompleted}: a stopped turn's ending, after its last pass — and
   * after any pass an explicit stop chained meanwhile ({@link endEverythingTheTurnStarted}), within
   * the one bound. ⚠️ Written only while that turn is still the machine's open one: a close may have
   * ended it meanwhile.
   */
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

  /**
   * Fire the `turn/interrupt` RPC (best-effort).
   *
   * ⚠️ **492 · it used to say *"the turn's completion still classifies as interrupted"*, and that
   * was a claim about the LATCH rather than about this frame.** ⛔ `SessionMachine.completeTurn`
   * overrode the provider's outcome when somebody called `requestInterrupt()` — until `709` (R43),
   * which made it record the provider's word always. ⚑ What this frame itself buys is measured: the
   * provider answers `turn/completed{status:'interrupted'}`, so the word is the provider's.
   *
   * ⛔ **704 · for a turn that is RUNNING.** For one Codex has accepted and not yet started, the
   * answer is a `-32600` refusal (`no active turn to interrupt`, or `expected active turn id … but
   * found …`) and the turn then runs to its end
   * (`probe:codex-early-interrupt`) — swallowed here, which is why an asked interrupt is sent
   * again at `turn/started` rather than read off this promise.
   */
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

  /**
   * 🔴 **Ask the provider to stop the turn THIS CARD belongs to, and ask it nothing else** (492,
   * HO-032 §1).
   *
   * ## ⛔ Why this is not {@link CodexSessionHandle.interrupt} with a different caller
   *
   * ⚠️ **That method does three things and this door may only do one of them.** It latches
   * `requestInterrupt()` — which, since `709` (R43), renames no provider ending; ⚑ since `720` (R71)
   * a Cancel latches at the PRESS instead, in `respondPermission`, on every door, so this helper
   * need not and must not (⚑ since `736`, R97, its only caller is the agent-tool door — the
   * elicitation door's R74 stop is gone); it calls
   * `settleRequests()` — which safe-rejects every other open card on the person's behalf and writes
   * no row for any of them, which is what `INTERRUPT_RAILS`' `a-person-is-being-asked` exists to
   * refuse; and it calls `forceEnd` when there is no turn to address, which manufactures a local
   * terminal for work the provider was never told about. ⛔ **A person answering one card is not an
   * instruction about the cards beside it.**
   *
   * ## ⚠️ The id is the CARD's, and never `currentTurn`'s
   *
   * ⛔ **A card is answered by a person, whenever they get to it, and `currentTurn` is whatever is
   * running when they do.** ⚑ The turn id on the request was validated against the bound turn by
   * {@link serverRequestScopeProblem} before the card was ever raised — *"nothing can be authorized
   * under a turn the provider has not confirmed"* — so it names the turn this decision is about and
   * cannot come to name a later one. ⚠️ **That same check is why the empty guard below is a
   * narrowing rather than a rule**: a request with a missing or stale `turnId` is refused before it
   * reaches a handler, so no card exists without one — ⚑ except an MCP elicitation, which may name
   * no turn at all ({@link scopeProblemFor}); since `736` (R97) no elicitation Cancel calls this.
   */
  private async askTheTurnToStop(providerTurnId: string): Promise<void> {
    if (!providerTurnId) return
    await this.sendInterruptRpc(providerTurnId)
  }

  /** Fail closed if a `thread/settings/updated` moved the session off the prompting profile. */
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
    void this.transport.close() // the process is still live — tear it down
  }

  /**
   * Retire the tombstones of **fully-settled** server requests — the lifecycle-bounded retention
   * policy (057, fixing 044 P2 #7). Called at every TURN TERMINAL, where both halves of "the
   * provider can no longer reference it" hold: we have written the id's single JSON-RPC response,
   * and the turn that owned it has ended (Codex clears its pending server requests on turn
   * start/completion/interruption — the same protocol fact 051 relies on).
   *
   * Only ids in {@link respondedRequestIds} are retired, so a request that is claimed but still
   * awaiting its response keeps its tombstone until it settles — retirement can never orphan a
   * live card. Retired NUMERIC ids are folded into {@link maxRetiredNumericId} first, so they stay
   * refused forever at O(1) cost; the per-id sets then shrink to just the still-live requests.
   */
  private retireSettledRequestIds(): void {
    for (const [key, state] of this.requestStates) {
      if (state.phase !== 'spent') continue // still claimed: keep its entry until it settles
      const numeric = numericIdFromKey(key)
      if (numeric !== null && numeric > this.maxRetiredNumericId) this.maxRetiredNumericId = numeric
      this.requestStates.delete(key)
    }
    this.permissions.retireSettled()
    this.userInputs.retireSettled()
  }

  /**
   * Whether `id` is a numeric id already retired — spent, and so refused exactly as an unretired
   * tombstone would refuse it. String ids have no order, so they cannot be represented by the
   * floor: they are answered from the per-id sets alone (the live app-server issues numeric ids,
   * so this is the unused branch in practice).
   */
  private isRetiredRequestId(id: string | number): boolean {
    return typeof id === 'number' && id <= this.maxRetiredNumericId
  }

  /**
   * Per-id tombstones currently retained across every store (tests/diagnostics, 057). Bounded by
   * the requests of the CURRENT turn — not by the session's total request count — which is the
   * property 044 P2 #7's 10,000-request probe asserts.
   */
  get tombstoneCount(): number {
    return this.requestStates.size + this.permissions.answeredCount + this.userInputs.answeredCount
  }

  /**
   * 🔴 **Which scope question this request has to answer** (605).
   *
   * ⛔ **Every other supported shape declares `turnId` as a REQUIRED, non-nullable string**, and
   * {@link serverRequestScopeProblem} fails closed on a missing one because an authorization
   * request that cannot prove which turn it belongs to is `060` P1's confused deputy.
   *
   * ⚠️ **An MCP elicitation declares `turnId: string | null`, and the protocol says why:** *"MCP
   * models elicitation as a standalone server-to-client request identified by the MCP server
   * request id. It may be triggered during a turn, but turn context is app-server correlation
   * rather than part of the protocol identity of the elicitation itself."* ⛔ **Measured `null`**
   * on the bundled 0.146.0 binary (`probe:codex-external-mcp` arm F), on an elicitation raised
   * from a tool call the CLIENT made outside any turn (`mcpServer/tool/call`) — so holding it to the
   * strict rule would refuse every such one for ever, and the card `HO-090` §1 ordered could never
   * appear. ⚑ **In a turn it names the turn** (`720`, arms H–J: a model's call, the frame's `turnId`
   * equal to the bound turn), which is what let a Cancel be addressed by the frame (R74, until
   * `736`'s R97 took that stop away).
   *
   * ⚑ **The THREAD check is unchanged and is the one that stops a foreign frame.** The turn is
   * still checked whenever the frame carries one, so this is narrower than ignoring the field:
   * a stale turn is refused exactly as before, and only *no turn named at all* is admitted.
   */
  private scopeProblemFor(kind: ServerRequestKind, params: unknown): string | null {
    if (kind.kind !== 'elicitation') return this.serverRequestScopeProblem(params)
    if (!isRecord(params)) return 'malformed params'
    const ref = this._ref
    if (!ref) return 'no active session'
    const threadId = readString(params, 'threadId')
    if (!threadId) return 'missing threadId'
    if (threadId !== ref.sessionId) return `foreign thread ${threadId}`
    // ⛔ **ABSENT is `null` or the field not being there, and nothing else** — found reviewing
    // this dispatch's diff. ⚠️ `readString` answers `''` for a NUMBER or an OBJECT too, so a
    // frame carrying `turnId: 12345` would have read as *no turn named* and been admitted on the
    // thread check alone. ⚑ The protocol declares `string | null`; anything else is a frame this
    // adapter cannot reason about, and a scope gate answers that with a refusal.
    const rawTurn = params['turnId']
    if (rawTurn !== null && rawTurn !== undefined && typeof rawTurn !== 'string') {
      return 'malformed turnId'
    }
    const turnId = readString(params, 'turnId')
    // ⚠️ **And when no turn is named, the session's own turn state is NOT consulted.** ⛔ That is
    // wider than the strict rule, which refuses `no active turn` before it reads the field at
    // all — so an elicitation arriving between turns is admitted. ⚑ It has to be: the measured
    // frame names no turn, and an MCP server's request is a standalone one by the protocol's own
    // account. The thread check is what stands in its place, and `M10` is what proves it stands.
    if (!turnId) return null
    const turn = this.currentTurn
    if (!turn || turn.providerTurnId === null) return 'no active turn'
    return turnId === turn.providerTurnId ? null : `stale turn ${turnId}`
  }

  /**
   * Why a server request is OUT OF SCOPE for this session's active thread+turn, or `null` when it
   * is in scope (061, fixing 060 P1 — a confused-deputy authorization hole).
   *
   * Every supported request shape declares `threadId` and `turnId` as REQUIRED, non-nullable
   * strings, and the app-server contract is that clients scope UI state to the active
   * conversation. Previously neither field was read: a protocol-shaped approval for a FOREIGN
   * thread, or for a STALE turn, produced an actionable card and wrote `accept` when answered.
   *
   * Deliberately STRICTER than {@link namesForeignThread} (which tolerates an ABSENT `threadId`,
   * because the diagnostic notification streams do not all carry one): an authorization request is
   * only in scope when every element is present and matches, so missing/malformed scope fails closed
   * rather than inheriting the lenient reading. ⚠️ **The two are answering different questions** —
   * that one asks "does this frame claim to belong to somebody else?", this one asks "has this
   * request proved it belongs to us?", and only the second may be answered by silence.
   */
  private serverRequestScopeProblem(params: unknown): string | null {
    if (!isRecord(params)) return 'malformed params'
    const ref = this._ref
    if (!ref) return 'no active session'
    const threadId = readString(params, 'threadId')
    if (!threadId) return 'missing threadId'
    if (threadId !== ref.sessionId) return `foreign thread ${threadId}`
    const turn = this.currentTurn
    // No live turn (idle), or one whose provider id has not bound yet: nothing can be authorized
    // under a turn the provider has not confirmed.
    if (!turn || turn.providerTurnId === null) return 'no active turn'
    const turnId = readString(params, 'turnId')
    if (!turnId) return 'missing turnId'
    if (turnId !== turn.providerTurnId) return `stale turn ${turnId}`
    return null
  }

  /**
   * The id's current phase — the ONE question every path asks (067). A retired id reads as `spent`:
   * retirement drops the per-id entry but the numeric floor (057) still answers for it, so a replay
   * after a turn terminal is as closed as one before it.
   */
  private phaseOf(id: string | number): 'unseen' | 'claimed' | 'spent' {
    const state = this.requestStates.get(requestKey(id))
    if (state) return state.phase
    return this.isRetiredRequestId(id) ? 'spent' : 'unseen'
  }

  /**
   * **The only way anything reaches the wire for a server-request id** (067). Transitions the id to
   * SPENT and writes, or returns `false` if it was already spent/retired — so "exactly one response
   * per id, ever" is a property of this one function rather than of every caller remembering to
   * check. The state is set BEFORE the write, so a re-entrant write cannot slip in behind it.
   *
   * `write` is optional: `serverRequest/resolved` (051) spends an id *without* responding, because
   * the provider already resolved it and a response would be the second one.
   */
  private spendRequest(id: string | number, write?: () => void): boolean {
    if (this.phaseOf(id) === 'spent') return false
    this.requestStates.set(requestKey(id), { phase: 'spent' })
    write?.()
    return true
  }

  /**
   * A second request arriving for an id we have already seen (067, unifying 036 P1-B + 061 + 057).
   * **Never publishes a card**, whatever the phase:
   *  - **spent / retired** — the id has had its one response; nothing more may go on the wire. This
   *    is 066 F2: a spent id must not serve a second request, or the second gets a card whose answer
   *    is silently dropped.
   *  - **claimed** — the id is now ambiguous: the provider has two outstanding requests under it and
   *    we cannot know which one a user answer would authorize. It fails closed — the id is spent
   *    with the OWNER's method-appropriate refusal (the response must fit the request the provider
   *    is waiting on), and the owner is settled so its handler unblocks. Because spending is
   *    synchronous, the subsequent answer finds the id SPENT and can never write an `accept` (F1).
   */
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
    // Retire the owner's CARD too, not just its promise. Settling the broker unblocks the handler,
    // but the `permission_request`/`user_input_request` already published stays on screen — and
    // answering it now throws, because the id is SPENT. That is a dead card: visible, unanswerable.
    // `request_resolved` (051) is the neutral "this request is gone" signal, so the UI removes it.
    if (this.settleOwnerFailClosed(key)) this.emit({ type: 'request_resolved', id: key })
  }

  /**
   * Resolve whichever broker owns `key` with its safe-negative answer, so the handler unblocks.
   * Returns whether a request was actually still pending (i.e. a card was open for it).
   */
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
    // A SPENT (or retired) id is closed to everyone (067, fixing 066 F2): it has had its one wire
    // response, so it publishes no card and writes nothing, whoever asks. Previously the duplicate
    // check ran AFTER the scope gate and only knew about *claimed* ids, so an id already spent by an
    // out-of-scope refusal still looked fresh — the second request got a card whose answer was then
    // silently dropped by the single-shot gate.
    if (phase === 'spent') return
    // ONE classification for both the scope gate and the dispatch (061), so a method can never be
    // scoped in one place and dispatched in another.
    const kind = serverRequestKind(method)
    // An ILLEGITIMATE collider — unsupported method or out of scope — is not a claim on the id at
    // all, so when the id is CLAIMED it is simply ignored: it must not be able to kill a live,
    // legitimate card by reusing its id (061's DoS guard — "a scope-rejected request does not burn a
    // legitimate id"). The owner keeps its slot and answers normally.
    if (kind.kind === 'unsupported') {
      // Unknown server request — protocol-safe reject so the app-server can't hang (001 gap 6).
      if (phase === 'unseen')
        this.respondErrorToProvider(id, -32601, `unsupported request: ${method}`)
      return
    }
    // SCOPE (061, fixing 060 P1): validated BEFORE the id is claimed and before anything is
    // published, so a foreign-thread / stale-turn / unscoped request never becomes actionable.
    if (this.scopeProblemFor(kind, params) !== null) {
      if (phase === 'unseen') this.respondToProvider(id, safeRefusal(kind))
      return
    }
    // A LEGITIMATE, in-scope request for an id that is already claimed is the genuine ambiguity
    // (036 P1-B): the provider now has two valid outstanding requests under one id and no answer can
    // be attributed. That fails closed.
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

  /**
   * 🔴 **A tool this session declared, being called** (348) — the Codex half of `347`'s five tools.
   *
   * ⛔ **No card, no broker, no user.** The other two server-request kinds ask a person and wait;
   * this one is answered by the toolset the session was launched with and the reply goes straight
   * back. It still travels the whole id lifecycle — claimed above, spent by
   * {@link respondToProvider} — so a replayed `callId` gets nothing twice, exactly like an approval.
   *
   * ⚠️ **The arguments are handed over UNPARSED.** `303` B: eight keys arrived, seven parsed, and
   * the spawn *"never started, looking exactly like a slow provider"*. `341`'s rail 1 refuses an
   * undocumented key BY NAME, and it can only do that if the key reaches it — see
   * {@link codexDynamicToolsFor} for the schema half of the same rule.
   */
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
      // ⚠️ A frame that named no tool at all. Not a policy refusal and not a broken tool — there is
      // nothing here to run, and the shape says so.
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
    // ⚑ **`auto` ends the permission path here** — the same line, in the same place, as the Claude
    // adapter's `if (isAutoApprove(…)) return { behavior: 'allow' }`.
    if (isAutoApprove({ approvalMode: this.approvals.effective })) {
      this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))
      return
    }
    // 🔴 **486 · a verb whose rails are the whole gate raises no card** (HO-031 §2.4).
    //
    // ⛔ **The ruling:** *"The brobot tools are gated by RAILS. Permissions are for acts that reach
    // outside this app."* ⚠️ **And the measurement behind it** (§2.9): a project manager needed a
    // human approval to answer its own parent, and *"double-gating them means every task needs a
    // human click to close, which breaks the loop the tools exist to make."*
    //
    // ⛔ **THIS is the second enforcer, and the exemption is worth nothing without it.** An
    // exemption honoured by one adapter and not the other would leave a verb carded on one provider
    // and free on the other — the same app, two answers. ⚑ **It is the SAME question read off the
    // same declaration**: `beyondItsRails` rides on the tool the session was constructed with, so
    // neither adapter holds a list of names that could drift from the other's.
    //
    // ⚠️ **`call.tool` is UNQUALIFIED here** — Codex addresses `brobot__<verb>` as a namespace plus
    // a name — so the comparison is against the declaration's own spelling, and the Claude side
    // qualifies because its wire name is qualified. ⛔ The lookup is `agentTools`' own, not a
    // second `find`: a tool this session does not offer is not exempted by anything. A verb may
    // class some calls differently from the rest, from the call's own arguments.
    const offered = this.agentTools?.tools.find((one) => one.name === call.tool)
    if (
      offered !== undefined &&
      beyondItsRailsOf(offered, call.arguments) === 'nothing-its-rails-do-not-cover'
    ) {
      this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))
      return
    }
    // Reserve the resolver slot BEFORE publishing the card — the shape {@link handleApproval} and
    // the Claude adapter both use, for the same reason: a duplicate or a closing session is
    // answered here with NO card.
    const reservation = this.permissions.reserve(requestKey(id))
    if (!reservation.accepted) {
      this.respondToProvider(id, safeRefusal({ kind: 'agentTool' }))
      return
    }
    // ⛔ **`allow` and `deny`, and deliberately not `allow_for_session`.** A session-wide grant for
    // `give_work` is `001` non-negotiable 1 — a tool pre-approved before anyone looks at its
    // arguments — and the Claude side is explicit that its allow is ONE-SHOT for exactly this
    // reason. `respondPermission` refuses an unoffered positive outcome, so this set is the gate.
    //
    // ⚠️ **`cancel` is NOT in this set and is still offered on the card below** (482), and the two
    // facts do not contradict: this set gates POSITIVES, and {@link ALWAYS_HONOURED} is exempt from
    // it by construction. Putting `cancel` in here would read as *the gate admits it because we
    // listed it*, which is the misreading that produced the missing button in the first place.
    const claimed = this.requestStates.get(requestKey(id))
    if (claimed?.phase === 'claimed')
      claimed.allowed = new Set<PermissionOutcome>(['allow', 'deny'])
    this.emit({
      type: 'permission_request',
      id: requestKey(id),
      // ⚠️ **`command`, because that is what a tool call already IS in this vocabulary.** The Claude
      // adapter maps every non-file tool — `mcp__brobot__give_work` included — to `command`, so
      // the card a person sees for these tools is the same card on both providers and no
      // neutral enum had to be widened to get it.
      kind: 'command',
      action: call.tool,
      ...boundPermissionDetail(`${call.tool} ${JSON.stringify(call.arguments)}`),
      scope: {
        cwd: this.cwd,
        paths: [],
        networkHosts: [],
        // ⚑ 697: the one derivation, over this card's own positives — `once`, and it follows the offer.
        persistence: persistenceOf(['allow']),
        amendments: [],
        // 🔴 **One positive, plus what the rails honour no matter what** (482, closing `478` F4).
        // ⛔ It read `['allow', 'deny']` and the adapter accepted a `cancel` on it the whole time —
        // an always-safe negative that ends the turn, with no button on any surface. ⚑ **487 moved
        // the spread into {@link publishedOffer}**, which is the same value from the same constant:
        // this card was the first producer that could not forget the floor, and now none can.
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
      // ⚠️ **`success: false`, and that is the mirror of Claude's `{behavior:'deny'}` rather than a
      // slip** (348). A RAIL's refusal is a success whose payload says refused — the door answered.
      // This is the other thing: nobody answered, the person said no, and no tool ran. The two must
      // not arrive wearing the same shape or the model cannot tell a rule from a person.
      this.respondToProvider(id, {
        contentItems: [
          {
            type: 'inputText',
            text: `the person using this app declined the ${call.tool} call, so nothing was done`,
          },
        ],
        success: false,
      })
      // 🔴 **492 · and THIS is where `cancel` stops meaning something different here** (HO-032 §1).
      //
      // ⛔ **The payload above is deliberately the same for both.** `deny` and `cancel` are both
      // *nobody ran your tool*, and a model reading two sentences for one outcome would be reading
      // a difference that is not about it. ⚑ The difference is the frame below, which is about the
      // TURN.
      //
      // ⚠️ **After the tool result and not before it.** `probe:codex-cancel-interrupt` measured both
      // orders on pinned 0.146.0 and the provider accepts either — arm A left the call outstanding
      // and still ended the turn `interrupted` in 16 ms. ⛔ But arm A also showed the app-server
      // completing that dangling call ITSELF, `status: 'failed'`, five ms AFTER `turn/completed`,
      // and sending no `serverRequest/resolved` for it — so a request this adapter still held
      // CLAIMED would be one the provider had already torn down. ⚑ Answering first leaves nothing
      // dangling on either side.
      //
      // ⚠️ **Nobody else's card is settled.** `interrupt()` calls `settleRequests()` on the line
      // after its own `requestInterrupt()`, which safe-rejects every OTHER open card and writes
      // nothing — the exact act `INTERRUPT_RAILS`' `a-person-is-being-asked` refuses an agent for.
      // ⛔ **A person answering their own card must not answer the ones beside it either**, and the
      // provider does not need us to: arm D held two tool calls open, cancelled one, and the
      // app-server completed the other on its own.
      if (decision.outcome === 'cancel') await this.askTheTurnToStop(readString(params, 'turnId'))
      return
    }
    this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))
  }

  /**
   * The provider resolved or CLEARED a server request (051, fixing 044 GO-blocking P2 #1).
   *
   * Codex clears pending server requests on turn start/completion/interruption and confirms it
   * with `serverRequest/resolved`. Ignoring it left the card actionable and — the security-relevant
   * part — let a LATE `respondPermission` write a decision for a request the provider had already
   * cleared, an out-of-lifecycle authorization.
   *
   * Retiring means: mark our response slot spent (the provider already resolved it, so the
   * settling handler must NOT write a second response), drop the disclosure metadata, settle the
   * broker so the handler unblocks and the id counts as answered — which makes any later
   * `respondPermission`/`respondUserInput` for it a refusal that never reaches the wire — and emit
   * the neutral `request_resolved` so the UI removes the card.
   */
  private onServerRequestResolved(params: unknown): void {
    const p = isRecord(params) ? params : {}
    // ⚠️ **The "a resolution for ANOTHER thread is not ours to act on" check used to be here, and
    // 200 moved it up** — not away. `serverRequest/resolved` declares `threadId` required and is not
    // a {@link THREAD_SUBJECT_METHODS} member, so {@link namesForeignThread} refuses a foreign one
    // before this method is entered, and `codex-runtime.test.ts` still asserts exactly that from the
    // outside. What changed is that the same sentence is no longer written in three places.
    // `RequestId` is `string | number`: read it type-preserved, never via a string coercion that
    // would conflate numeric `1` with string `"1"` (045).
    const rawId = p['requestId']
    if (typeof rawId !== 'string' && typeof rawId !== 'number') return
    const key = requestKey(rawId)
    if (this.phaseOf(rawId) === 'unseen') return // never ours, or already retired
    const alreadyResponded = this.phaseOf(rawId) === 'spent'
    const state = this.requestStates.get(key)
    if (state?.phase === 'claimed' && state.messageCallId !== undefined) {
      this.messageCalls.consume(
        state.messageCallId,
        this.currentTurn?.providerTurnId ?? '',
        () => undefined,
      )
    }

    // Spend the id WITHOUT writing (067): the provider already resolved it, so our response slot is
    // gone — sending one would be the second response for the id. Spending here is what makes the
    // settling handler's write, and any later answer, a no-op.
    this.spendRequest(rawId)
    // Settle whichever broker owns it so the awaiting handler unblocks and `answered` is set.
    const wasPending =
      this.permissions.respond(key, { outcome: 'deny', message: 'resolved by the provider' }) ||
      this.userInputs.respond(key, { kind: 'reject' })
    // Only tell the UI to drop a card that was actually still open on our side.
    if (wasPending && !alreadyResponded) this.emit({ type: 'request_resolved', id: key })
  }

  /**
   * Send the SINGLE provider (JSON-RPC) response for a server-request id and record it; a later
   * attempt for the same id is suppressed. JSON-RPC correlates by id, so a reused id must never get
   * two/contradictory responses (036 P1-B) — the first response for an id wins, the rest are dropped.
   */
  private respondToProvider(id: string | number, result: unknown): void {
    // One gate (067): {@link spendRequest} is where SPENT is set and the wire is written, so the
    // single-response guarantee — across duplicates, scope refusals, teardown and retirement — is a
    // property of that function rather than of each caller remembering to check.
    this.spendRequest(id, () => this.transport.respond(id, result))
  }

  /** As {@link respondToProvider}, for the JSON-RPC error reply to an unsupported request (single-shot). */
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
    // ⛔ **What this patch will write, correlated by `(threadId, turnId, itemId)`** (184, fixing
    // 181's `itemId` alone). Empty for a command approval, and empty for a file approval whose item
    // we were never told about — both of which {@link fileDetail} and {@link fileScope} handle by
    // saying so rather than by inventing one.
    //
    // ⚑ **The approval's OWN params are what asks the question**, and they are the three identities
    // {@link serverRequestScopeProblem} has already validated against this session and this turn:
    // that check runs before the id is claimed, so `threadId` is this thread and `turnId` is the
    // bound provider turn by the time anything reaches here.
    const targets = kind === 'file' ? this.patches.for(params) : []
    const action = kind === 'command' ? readString(params, 'command') || 'shell' : 'apply_patch'
    // ⛔ **704 · a command's `reason` is never the disclosure** — it used to be the fallback for an
    // empty `command`. Measured on the bundled 0.146.0 through this adapter's `ask` profile, WITH a
    // command: an `exec_command` escalated with a `justification` arrives with `reason` equal to it,
    // verbatim — the MODEL's words — and one without has no `reason` at all. 181's rule for the file
    // card, one kind over: the card shows what Allow authorizes. ⚠️ **Not measured: an approval with
    // no command at all** — the managed-network one (`networkApprovalContext`), unreachable on this
    // profile (`672`). It now reads `command` here, discloses its hosts through `scope.networkHosts`,
    // and whatever its `reason` says — Codex's or the model's — is not drawn. ⚑ **709 keeps that**:
    // `agentReason` below is carried only on the shape measured to be the model's.
    const detail = kind === 'command' ? readString(params, 'command') || kind : fileDetail(targets)
    // ⚠️ **The `reason` moved to `summary`, which is the field it was always for** (181): *"the
    // provider's own one-sentence rendering of the request … a label BESIDE the disclosure, never
    // instead of it"*. It used to BE the disclosure on a file card, so a patch that arrived with a
    // reason showed a sentence where the files belong and a patch without one showed the word
    // `file`. Neither said what Approve writes. ⚠️ **704 · whose words it would be is not
    // established**: it was `null` on every file approval 704 drove — a patch inside the cwd, one
    // outside it, and one run through `exec_command` with a model `justification` — and on the
    // command path the same field is the model's. Nothing here labels it as Codex's own.
    const summary = kind === 'file' ? readOptionalString(params, 'reason') : undefined
    // 🔴 **709 · R44 — and a command's `reason` is the AGENT's when the model escalated it, so it
    // is carried under that name.** ⚑ Measured (`probe:codex-approval-reason`): on a command the
    // model escalated it is the model's `justification`, verbatim, and absent without one. ⛔ Not
    // {@link summary} — whose author on a file card is not established — and never {@link detail},
    // which stays what Allow runs. The drawing is the frontend's. ⚠️ **Only on the shape that was
    // measured** ({@link theModelWroteTheReason}): a command a policy rule stopped carries Codex's own
    // words — as the PROVIDER's, below (720, R73) — and every other command approval's `reason` is
    // carried nowhere, as on `main`.
    const agentReason =
      kind === 'command' && theModelWroteTheReason(params)
        ? wordsForACard(isRecord(params) ? params['reason'] : undefined)
        : null
    // 🔴 **720 · R73 — a policy's own words are the provider's**, labelled as its rule. See
    // {@link thePolicysWords}: never on the shape above, and only where the request names a
    // `command` — which a file approval's params never carry.
    const policysWords = thePolicysWords(params)
    const { scope, allowed, alwaysAnswer } =
      kind === 'command'
        ? commandScope(params)
        : { ...fileScope(params, targets), alwaysAnswer: undefined }
    // ⚑ **736 · R95 — and where Codex keeps it**: the conversation's own provider home.
    if (scope.grants?.allow_always !== undefined) {
      scope.grants.alwaysFile = join(this.providerHome, CODEX_EXEC_POLICY_RULES)
    }
    // Reserve the resolver slot BEFORE writing approval metadata or publishing the card
    // (024, reserve-before-publish). Session-wide id dedup (036 P1-B) already caught any
    // duplicate in onServerRequest, so this now also guards the CLOSING case: a reserve
    // rejected by a shutting-down session is safe-declined with NO card and NO metadata write.
    const reservation = this.permissions.reserve(requestKey(id))
    if (!reservation.accepted) {
      this.respondToProvider(id, { decision: 'decline' })
      return
    }
    // The offered outcomes live ON the id's state (067) — the answer path validates and responds
    // from ONE structure, so they cannot drift apart mid-answer.
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
      // Whole, or marked (071). This adapter never truncated — 069 finding 1 is Claude's — but the
      // ceiling belongs on the EVENT rather than on one provider's path to it, or the next adapter
      // inherits the absence of a rule instead of the rule.
      ...boundPermissionDetail(detail),
      ...(summary ? { summary } : {}),
      ...(agentReason === null ? {} : { agentReason }),
      ...(policysWords === null
        ? {}
        : { providerReason: policysWords, providerReasonFrom: 'a-policy-rule' as const }),
      // RESOLVED, never raw: a disclosure that reads blank and means "ask" is not a disclosure.
      scope: {
        ...scope,
        approvalMode: isAutoApprove({ approvalMode: this.approvals.effective }) ? 'auto' : 'ask',
      },
    })
    // COUNTED, not toggled (063). A second card arriving while this one is unanswered changes the
    // count and publishes nothing — and answering this one publishes `working` only if it was last.
    this.machine.beginWait()

    const decision = await reservation.response
    if (this.isShuttingDown) {
      // The count comes down; `working` does not go out. See {@link SessionMachine.abandonWait}.
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
    // Safe-decline uses each method's DOCUMENTED empty/denied payload, never a
    // JSON-RPC error, so the turn continues predictably (007 P2-1).
    if (this.isShuttingDown) {
      this.respondToProvider(id, userInputDecline(isPermission))
      return
    }
    // ⛔ **A question request with nothing to ask is malformed, and it renders as APPROVE** (142 §2,
    // applying 064 to the provider that never had it). `ToolRequestUserInputParams.questions` is an
    // unconstrained array, pinned 0.146.0 says *"prefer 1"* rather than enforcing a minimum, and
    // `normalize_request_user_input_args` vacuously accepts an empty one. Downstream, `every([])` is
    // true and `UserInputCard`'s label branches only on `questions.length` — so BroBot drew a live
    // **Approve** button on a question card, and pressing it sent `{answers:{}}`, which is byte for
    // byte the payload {@link userInputDecline} uses to DECLINE, while the ledger recorded Answered.
    // A control that cannot act, wired to the opposite of what it says.
    //
    // Declined here, with no card, exactly as Claude's `AskUserQuestion` has been since 064: the
    // honest thing to tell the model is that its call was malformed and it can retry, rather than to
    // ask a human to approve a question nobody asked. ⚠️ **`isPermission` is excluded deliberately**
    // — a permissions/requestApproval genuinely carries no questions, and its Approve means what it
    // says.
    if (!isPermission && codexQuestions(params).length === 0) {
      this.respondToProvider(id, userInputDecline(false))
      return
    }
    // ⛔ **Two questions with the same ID are two answers only one of which can be delivered** (146,
    // from 145 HIGH 2/3). `ToolRequestUserInputResponse` is keyed by question id, the pinned
    // `request_user_input_spec.rs` validates options but neither id syntax nor uniqueness, and
    // `codexQuestions` falls back to a positional `q{i}` for a missing one — so a request carrying
    // `id: "q1"` and then a question with no id at all collides without either being malformed on
    // its face. The card would show two questions sharing one draft key: answering the first fills
    // both, and {@link codexAnswers} writes the same slot twice.
    //
    // Declined for the same reason and by the same route as the empty case above, with no card. On
    // this provider the wire key IS the neutral id, so one check covers both the card's addressing
    // and the provider's.
    if (!isPermission && duplicateAnswerKey(codexQuestions(params), (q) => q.id) !== null) {
      this.respondToProvider(id, userInputDecline(false))
      return
    }
    // ⛔ **A question whose own id is MISSING or EMPTY is answerable and undeliverable** (150, 148
    // M5). {@link codexQuestions} maps a missing id to a positional `q{i}`, that normalized id
    // passes every check above and reaches the card, `answerToForward` accepts an answer keyed by
    // it — and {@link codexAnswers} writes only when the ORIGINAL `providerId` is truthy. So the
    // user answers, the payload is `{answers:{}}` — byte for byte this provider's DECLINE shape —
    // the request is spent, and the host records `Answered`. That is 142's defect in a place 142
    // could not see, and 148's ruling is adopted: decline the malformed request rather than invent
    // a key that cannot be returned.
    //
    // ⚠️ **BELOW the duplicate check, and the order is load-bearing.** An explicit `q1` colliding
    // with a positional `q1` is already correctly refused up there; if this ran first it would
    // catch that case too, and the collision refusal would stop being the thing under test — a
    // check that can never fail is a check nobody will notice removing.
    if (!isPermission && hasUndeliverableQuestionId(params)) {
      this.respondToProvider(id, userInputDecline(false))
      return
    }
    // ⛔ **And an option nobody can click** (150, 148 M6) — the dead single-select control, refused
    // by the same route on both providers. See {@link unanswerableOptionLabel}; the labels
    // themselves are never trimmed, renamed or filtered (143/146).
    if (!isPermission && unanswerableOptionLabel(codexQuestions(params)) !== null) {
      this.respondToProvider(id, userInputDecline(false))
      return
    }
    // 🔴 **709 · R44 — a permissions request's `reason` is the AGENT's, and it is not the prompt.** ⛔
    // It was `reason || …`, so the model's sentence was the card's headline, unlabelled — and Home's
    // first line of what the grant would authorize. ⚑ The model's words ride
    // `permission.agentReason` ({@link codexUserPermission}); the headline is this app's own
    // sentence, as the Claude adapter's plan cards are.
    const prompt = isPermission ? THE_AGENT_ASKS_FOR_ACCESS : questionText(params) || method
    // Reserve before publishing (024). Cross-/same-kind duplicate ids are already caught
    // session-wide in onServerRequest (036 P1-B); this now guards the CLOSING case — a reserve
    // rejected by a shutting-down session is safe-declined with NO card.
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
            // ⚑ Data only: Codex waits for this answer whether or not it says "blocking" — see
            // `RuntimeEvent` `isBlocking`. The wait below is unconditional for that reason.
            ...(isRecord(params) && typeof params['isBlocking'] === 'boolean'
              ? { isBlocking: params['isBlocking'] }
              : {}),
          },
    )
    // WAITING ON THE USER IS NOT SILENCE (076). The permission path above already brackets its await
    // with `waiting_permission` → `working`; this one did not, so the stall watchdog (074) and the
    // liveness tracker (075) counted the user's own thinking time as provider silence.
    //
    // THE SAME LEASE AS THE PERMISSION PATH (063), not a second one: an exec approval answered while
    // a question is still open must leave the session waiting, because it is.
    this.machine.beginWait()

    const response = await reservation.response
    // Every exit below returns to `working` first — a status left on `waiting_permission` would
    // disarm the watchdog for the rest of the turn, which is the mirror of the bug being fixed.
    // Unless another request is still open, which is what the machine counts.
    // On the normal path `respondUserInput` already spent the id synchronously, so this write is
    // suppressed (067). It stays the writer for every path that settles WITHOUT spending — teardown,
    // `settleAll`, a collision that resolved us fail-closed.
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      this.respondToProvider(id, userInputDecline(isPermission))
      return
    }
    this.machine.endWait()
    // ⚠️ **The one place an unforwardable answer really does DECLINE.** Everywhere else it is
    // refused to the caller (142) — but this write only happens on the paths that settle WITHOUT
    // spending: teardown, `settleAll`, a collision resolved fail-closed. There is nobody left to
    // refuse, and the provider is still waiting, so the documented empty payload is the only honest
    // thing left to send. Reached with a `reject` in practice, since that is what those paths
    // resolve; written for the whole union rather than for the case it usually carries.
    const forwarded = userInputPayloadFor(isPermission, params, response)
    this.respondToProvider(
      id,
      'payload' in forwarded ? forwarded.payload : userInputDecline(isPermission),
    )
  }

  /**
   * 🔴 **605 · an EXTERNAL MCP server is asking the person something, and BroBot cannot say which
   * of its calls it is about** — `HO-090` §1, which WITHDRAWS `HO-042` §3.
   *
   * ## ⛔ The ruling that was withdrawn, and the one sentence that replaced it
   *
   * `HO-042` §3 refused this card: *"a card that cannot name its subject cannot meet criterion
   * 20 … That is not a weaker card. It is a worse one."* ⚑ **The PO has withdrawn it:**
   *
   * > ⚑ *"A card that says plainly **this is a tool call and we cannot yet tell you which** is
   * > HONEST. It is not a card naming the wrong subject. My ruling conflated two different
   * > things: naming something falsely, and admitting we do not know."*
   *
   * ## ⚑ What this app DOES know, measured — `probe:codex-external-mcp` arm F
   *
   * ⛔ **The server, by name**, and the schema says it is not nullable. ⚑ That is the difference
   * between this card and the one `HO-042` §3 refused: *a tool from your Kibana server* rather
   * than *a tool call*. ⚠️ **And `turnId` arrived `null`**, which the protocol's own type explains
   * — *"turn context is app-server correlation rather than part of the protocol identity of the
   * elicitation itself"* — so the frame names the server and nothing smaller.
   * ⚑ **`720` corrected that for a turn**: arm F's frame came from a CLIENT tool call outside any
   * turn; a model's call INSIDE a turn names the turn (arms H–J), which is what an elicitation's
   * Cancel was addressed by until `736` (R74; R97 took that stop away).
   *
   * ## 🔴 Two card shapes, because one of the three modes carries a form and two do not
   *
   * ⚑ **`728` · a `form` with NO fields is the permission card with a way to allow** — Allow, Deny,
   * Cancel — below; the two shapes are *fields to answer* and *nothing to answer but yes or no*.
   *
   * ⛔ **`form`** — the fields are the questions, drawn by `UserInputCard`, answered back as the
   * types the server asked for. See {@link elicitationQuestions}.
   *
   * ⛔ **`openai/form` and `url`** — an untyped schema and a browser visit — and 0.160.0's
   * `openaiForm` (a second spelling of the first) and `openai/userVerification` (a `challenge`, a
   * `title` and a `description`, and no `message`), which take the same path. ⚠️ **This app cannot
   * present either, and a silent `decline` would be the defect `HO-018` names**: the person never
   * learns their server asked. ⚑ So they get a `permission_request` whose only answers are the
   * two refusals, carrying `could-not-represent-the-answers` — the member `487` wrote for exactly
   * this: *"the provider DID offer a way to accept and this app has no neutral outcome for it"*.
   *
   * ⚑ **In practice `openai/form` may not be able to reach this app at all**: it is gated on
   * `InitializeCapabilities.mcpServerOpenaiFormElicitation`, and {@link CAPABILITIES} does not ask
   * for it. ⛔ **That is a SCHEMA READING and nothing has measured it** — reviewing this
   * dispatch's diff caught the claim that an arm had: arm G negotiates the capability, but the
   * probe's own MCP server only ever sends a STANDARD elicitation, so what G shows is that
   * asking for the flag changes nothing about a standard frame. ⚠️ **Which is why the card
   * handles the mode anyway rather than resting on the reading.**
   *
   * ## 🔴 723 · R80 — and a third card, which is not the server's at all
   *
   * ⛔ **Codex asks on this method too.** Before a model's call to a granted server's tool runs,
   * Codex sends a zero-field `form` marked `_meta.codex_approval_kind: 'mcp_tool_call'` — its OWN
   * question, *"Allow the <server> MCP server to run tool "<tool>"?"*, with the call's parameters.
   * ⚠️ **Until `723` it met `142` §2's zero-field rule and was declined with no card** (`720` F-A),
   * so in `ask` no model-driven external tool call ever ran, and the model was told the user had
   * rejected it. ⚑ It is a permission card now ({@link codexToolApproval}, `aToolApprovalCard`):
   * the server, the tool and the parameters; Allow once, the conversation's grant where Codex offers
   * `session`, 🔴 *Always allow* where it offers `always` (`736`, R95), and the two refusals. ⚑ **`728` (R93) — and a server's own
   * zero-field form is shown too**, as the server's: its words, Allow, Deny and Cancel, as the Codex
   * CLI's own terminal UI shows an unmarked one (measured). `142` §2's decline of it is gone. ⚠️ A
   * frame wearing Codex's marker that claims a call Codex ran unasked is drawn as Codex's card
   * instead (`723` F-2's residual, {@link McpCallsInFlight}).
   *
   * ## 🔴 736 · R97 — every card this door raises says its Cancel stops nothing, and it does not
   *
   * ⚑ `cancelStopsNothing` on every card: the Cancel is the Codex terminal's own Esc — the request
   * is cancelled and the turn runs on — and this app adds no stop of its own. (`723` · R81 put the
   * marker only on a frame that named no turn; R74 had every other Cancel ask its turn to stop.)
   */
  private async handleExternalMcpElicitation(id: string | number, params: unknown): Promise<void> {
    const elicitation = codexElicitation(params)
    // ⛔ **No server name, no card** — see {@link codexElicitation}. The documented negative goes
    // back so the server is not left waiting, and nothing is shown that this app cannot stand by.
    if (this.isShuttingDown || elicitation === null) {
      this.respondToProvider(id, safeRefusal({ kind: 'elicitation' }))
      return
    }
    // 🔴 **723 · R80 — CODEX asking a person before an external tool runs**, on this same method
    // ({@link codexToolApproval}). ⛔ Until `723` it met the line below: `720` F-A measured every
    // model-driven external tool call in `ask` declined here with no card, and Codex telling the
    // model *"user rejected MCP tool call"* though no person saw anything (`probe:codex-mcp-tool-
    // approval` on `main`, run `2026-09-25T16-48-47-198Z-87823`: ten asks, no card, every one declined;
    // the only tools that ran were the three Codex never asked about). ⚑ *"It is never declined
    // silently again."* It is a permission card below, with a way to allow it.
    // 🔴 **…and only when Codex's own item says a call is waiting on it** ({@link McpCallsInFlight}):
    // the marker alone is a server's to copy — measured (`probe:codex-mcp-tool-approval`, `spoof`). ⛔ A
    // frame that names no turn is never read as one either: every measured approval named its turn,
    // and 060's rule is that nothing is AUTHORIZED under a turn the provider has not confirmed.
    const theFramesTurn =
      isRecord(params) && typeof params['turnId'] === 'string' ? params['turnId'] : ''
    const read = theFramesTurn === '' ? null : codexToolApproval(params)
    // ⚠️ **`723` F-2's residual, measured by `728`** (`spoof-unasked`): a frame wearing the marker
    // during a call Codex ran UNASKED claims that call and is drawn as Codex asking. ⛔ Nothing on the
    // wire tells it apart — see {@link McpCallsInFlight}; `728` tried Codex's tool list and withdrew
    // it (the list re-asks the server).
    const claimedTool = read === null ? null : this.mcpCalls.claim(read.serverName, read.tool)
    const toolApproval: ClaimedToolApproval | null =
      read === null || claimedTool === null ? null : { ...read, tool: claimedTool }
    // 🔴 **728 · R93 — a server's own form with no fields is SHOWN, as the CLI shows it.**
    // ⛔ Until `728` it was declined here with no card — `142` §2's *"a question nobody asked"*,
    // carried from `request_user_input`, where `{answers: {}}` IS the decline. ⚑ On this method it is
    // not: MCP's accept is `{action: 'accept', content: {}}` and its decline `{action: 'decline'}`.
    // ⚑ **Measured, the Codex CLI's own terminal UI** (bundled 0.146.0, `728`): the server's words
    // with *Allow* (*"Allow this request and continue"*), *Deny* and *Cancel* — Allow sent
    // `{action:"accept",content:{}}`, Deny `{action:"decline"}`. So it is a card with a way to allow.
    // ⚑ A frame wearing Codex's marker that claims no call lands here too, as the server's — never
    // silently again; ⚠️ one that claims a call Codex ran unasked does not (`723` F-2, above).
    const confirmsAServersForm =
      toolApproval === null && elicitation.mode === 'form' && elicitation.fields.length === 0
    const askable = elicitation.mode === 'form' && toolApproval === null && !confirmsAServersForm
    // 🔴 **728 review · what goes back when NOBODY answered** (a close, a Stop, a collision). On a
    // server's own request, MCP's `decline` is *"the user explicitly declined"* — a decision nobody
    // made — so it is `cancel`, as on Claude's forms. ⚑ Codex's own approval keeps `decline`: there
    // it means *do not run the tool*, which is the one safe reading of a card nobody answered.
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
    // 🔴 **The offered set, so the gate that refuses an unoffered POSITIVE is ARMED on this door
    // too** — found reviewing this dispatch's own diff, and no test could see it.
    //
    // ⛔ **`RequestState.allowed` is `undefined until the card publishes`, and `respondPermission`
    // reads `if (allowed && …)`** — so a card that never sets it has NO positive gate at all.
    // ⚠️ This was the one card in the product built to offer no way to allow (still so for
    // `openai/form`, a user verification and a withheld link; a shown link has *I opened it*), and the one
    // whose `allow` nothing refused: the wire would (correctly) have carried `decline` while the
    // broker recorded an allow and the host wrote `Answered` beside it. ⚑ `483`'s defect in
    // reverse — there, withholding the refusals left a card nobody could answer; here, forgetting
    // the offered set left a card answerable in a way it does not offer.
    //
    // Read Codex tool-approval positives from {@link aToolApprovalsPositives}. A server's zero-field form also offers Allow. A displayed URL request offers I opened it as MCP `accept`, only from the person's press; the app does not answer the server's card itself.
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
    // 🔴 **736 · R97 — every elicitation card's Cancel is the provider's cancel and nothing more**,
    // and the card says so ({@link RuntimeEvent} `cancelStopsNothing`). ⚑ Measured (`736`'s scratch
    // of the Codex terminal, 0.146.0): Esc on Codex's own MCP approval told the model *"user
    // cancelled MCP tool call"* and the turn RAN ON (as `728` measured); `{action:'cancel'}` alone does
    // the same through the app-server (`720` arm H). ⛔ Until `736` a frame that named its turn had
    // its Cancel also ask that turn to stop — R74, which R97 amends: *"BroBot adds no stop of its own
    // to a Cancel."*
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
            // ⚠️ **The server's own words, and this app's own admission, in that order** — the
            // sentence a person reads first is the one the server wrote. See
            // {@link externalMcpElicitationPrompt} for why the admission is in the prompt rather
            // than in a footnote.
            prompt: externalMcpElicitationPrompt(elicitation),
            questions: elicitationQuestions(elicitation),
            // ⚑ 728 · the SERVER asks, not the agent — see {@link RuntimeEvent} `mcpServerAsks`.
            mcpServerAsks: serverAsks(elicitation),
          }
        : toolApproval !== null
          ? // ⚑ 736 · R97 — Codex's own approval says its Cancel stops nothing too.
            {
              ...aToolApprovalCard(requestKey(id), toolApproval, approvalMode, this.providerHome),
              ...cancelStopsNothing,
            }
          : {
              type: 'permission_request',
              id: requestKey(id),
              // ⚑ **`command`, because that is what a tool call already IS in this vocabulary** —
              // `348`'s sentence, on a new subject, so no neutral enum had to be widened.
              kind: 'command',
              action: elicitation.serverName,
              ...boundPermissionDetail(externalMcpElicitationPrompt(elicitation)),
              ...cancelStopsNothing,
              // ⚑ 728 · the SERVER asks, not the agent — never on Codex's own approval card.
              mcpServerAsks: serverAsks(elicitation),
              scope: {
                paths: [],
                networkHosts: [],
                // ⚑ 697: `once` — derived, not written, like every other card.
                persistence: persistenceOf(offer),
                amendments: [],
                availableDecisions: offer,
                // ⛔ **A card with no way to allow — `openai/form`, a user verification, a url whose
                // link was withheld — and the WORD says why** — `487`: the row carries the word and
                // the surface carries the sentence. ⚑ A server's zero-field form has one (`728`,
                // above), and a shown link has *I opened it* (W4.28), so neither carries the word.
                ...(confirmsAServersForm || showsALink
                  ? {}
                  : { noPositiveBecause: 'could-not-represent-the-answers' as const }),
                // ⚠️ **Under-disclosed, and it is the literal truth here**: the frame names the
                // server and not the call, so the full effect of answering is not representable.
                underDisclosed: true,
                approvalMode,
              },
            },
    )
    this.machine.beginWait()
    // ⚠️ **The answer is not WRITTEN here, and that is the shape both neighbours have.**
    // ⛔ `respondUserInput` and `respondPermission` write the wire response SYNCHRONOUSLY, in the
    // same step that spends the id (`067`) — this await is how the handler learns the wait is
    // over, not how the provider learns the answer.
    await reservation.response
    if (this.isShuttingDown) {
      this.machine.abandonWait()
      this.respondToProvider(id, nobodysAnswer)
      return
    }
    this.machine.endWait()
    // ⚑ **The settle-without-spending paths only** (teardown, `settleAll`, a collision resolved
    // fail-closed). On the ordinary path the id is already SPENT and {@link respondToProvider}
    // is a no-op, which is `067`'s single-response guarantee rather than a check written here.
    this.respondToProvider(id, nobodysAnswer)
    // 🔴 **736 · R97 — and nothing more for a Cancel.** ⛔ From `720` (R74) until `736` a Cancel here
    // also sent `turn/interrupt` to the frame's own turn and latched it as asked to stop, because
    // `{action:'cancel'}` alone lets the turn run on (`720` arm H). ⚑ R97: *"Cancel has the CLI's
    // effect (on Codex's own approval: the request is cancelled and the turn runs on, as
    // measured) … BroBot adds no stop of its own to a Cancel."* — so the answer IS the whole of it,
    // and every card this door raises says so (`cancelStopsNothing`, above).
  }

  private finishUnexpected(reason: string, endedByThisAdapter = false): void {
    this.settleRequests()
    this.currentTurn = null // drop the correlation; the machine terminalizes its turn below
    this.machine.fatalError(reason, endedByThisAdapter) // emits the terminal turn (if any) + errored
    this.terminated = true
    this.eventQueue.close()
    // Reap the transport process from the errored state too (023 P1-A): the stream
    // ending doesn't itself kill the app-server, and a later handle close used to
    // no-op. Best-effort, never an unhandled rejection.
    void Promise.resolve(this.transport.close()).catch(() => {})
  }

  private settleRequests(): void {
    this.messageCalls.close()
    this.permissions.settleAll()
    this.userInputs.settleAll()
  }

  // --- SessionHandle contract ---

  events(): AsyncIterable<RuntimeEvent> {
    return this.eventQueue
  }

  status(): SessionStatus {
    return this.currentStatus
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

  // ⛔ **662 · no `origin` parameter, deliberately.** `SessionHandle.send` takes a `TurnProvenance`
  // and this adapter has nowhere to put it: the pinned protocol's `turn/start` carries no sender
  // (`CODEX_CAPABILITIES.turnProvenance`, which names what was searched). A method with fewer
  // parameters still satisfies the interface, so a caller's stamp is dropped here. The wire is
  // then exactly what an omitted origin sends.
  // ⛔ Not `async`, and returning the turn's own promise: an `async` wrapper hands back a promise of
  // its own, settled ticks after the turn's, and the host writes a turn's row when it settles.
  send(text: string): Promise<void> {
    return this.startATurn(text)
  }

  /**
   * A turn with no input: Codex keeps a refused turn's message in its thread, and a turn that adds
   * nothing has the model answer it, once (measured: `codex-a-refused-turn-sent-again-probe`).
   */
  carryOn(): Promise<void> {
    return this.startATurn(null)
  }

  /** A turn on this thread, handing the agent `text`, or nothing new at all. */
  private async startATurn(text: string | null): Promise<void> {
    // A collaboration mode needs a model NAME, and the only honest source of one is the server
    // (057). Refuse the turn rather than run it un-planned: `collaborationMode.settings.model` is a
    // required non-null string — measured, see {@link collaborationModeFor} — so a session that
    // cannot fill it has to choose between failing here and silently dropping the setting the user
    // ticked. The handshake always reports a model (`ThreadStartResponse.model` is required and
    // validated), so this is a guard against a future that stops doing that, not a case seen on the
    // wire.
    //
    // ⚠️ **It covers the session that has LEFT plan mode too, and that half is not symmetry for its
    // own sake** (060). A `left` session whose mode silently vanished would send a turn with no
    // `collaborationMode` at all — which is the exact payload the probe's CONTROL sent, the one
    // that made the agent re-plan instead of act. So the failure mode of dropping it is not "the
    // turn runs unplanned", it is "the go-ahead the user just gave is silently withdrawn".
    //
    // ⚠️ BEFORE `beginTurn()`, and that ordering is the whole difference between a refusal and a
    // dead session (057 review). `beginTurn()` marks a turn live and emits `working`; throwing after
    // it leaves that turn open with nothing driving it, so the session sits at `working` forever and
    // every later `send` fails with "a turn is in progress" — a session bricked by its own guard.
    // Nothing has started yet here, so refusing costs the user one message and not the conversation.
    //
    // `plan.requested` rather than the adopted value, because the guard has to describe the turn
    // ABOUT to be written and adoption happens below — a session that has just been asked to start
    // planning must be refused here for the same reason one that was already planning is.
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
    // ⚑ **Which half of the `null` it was, as a type** (650) — see `SessionMachine.refusedTurn`.
    if (localId === null) throw this.machine.refusedTurn()
    // Accept the local turn; its provider id is bound from the AUTHORITATIVE `turn/start`
    // RESPONSE (037, fixing 036 P1-C) — see onTurnStartResult — not a later `turn/started`
    // notification, which a stale/duplicate could use to bind the wrong turn.
    this.currentTurn = {
      localId,
      providerTurnId: null,
      interruptPending: false,
      interruptAsked: false,
      commands: new Map(),
      endsAll: false,
      commandsEnding: Promise.resolve(),
    }
    // A turn is the boundary a mode change crosses (034). Adopting it HERE, before the request is
    // written, is what keeps the provider's profile and our own disclosures from disagreeing —
    // there is no window in which the thread has moved and we still claim it has not.
    //
    // BEFORE rather than on the response, deliberately, and it is a choice about which way to be
    // wrong for a few milliseconds. Adopting on the response would leave a gap in which the
    // app-server has already applied `never` while we still tell a card "this session asks", which
    // is the understatement. This way the only error is the overstatement — claiming `auto` for a
    // turn/start that never landed — and that self-corrects on the next turn, which re-sends the
    // profile whatever happened to this one. A rejected `turn/start` also terminalizes the turn
    // below, so nothing runs under either reading.
    const modeBefore = this.approvals.effective
    const approvalMode = this.approvals.adopt()
    // All four settings adopt together, in one step, before the request is written (076). Adopting
    // them separately, or reading one of them again further down, is how the payload and the
    // disclosures would come to describe different turns. 🔴 W4.189 — the work folders are a fifth,
    // and adopt and roll back with them for the same reason.
    const settingsBefore = {
      model: this.models.effective,
      effort: this.efforts.effective,
      phase: this.plan.effective,
      workFolders: this.folders.effective,
    }
    const askedModel = this.models.adopt()
    const askedEffort = this.efforts.adopt()
    const phase = this.plan.adopt()
    // ⚠️ **Sent-marked BEFORE the baseline is read**, so this turn's own folders are never mistaken
    // for the thread's — see {@link askBaselineOf}.
    const workRoots = this.sendingWorkFolders(approvalMode, this.folders.adopt())
    const askBaseline = askBaselineOf(
      this.observedAskPolicy,
      this.workFoldersSent,
      this.theThreadsOwnRoots,
    )
    // ⚠️ **Computed ONCE and handed to both, because `collaborationMode` overrides the two fields
    // beside it.** What the turn intends is what we asked for; the server's own last answer is the
    // fallback, and only for the collaboration mode, whose `settings.model` is a required non-null
    // string. `turnStartParams` gets the un-defaulted values so that "we did not ask" stays absent
    // from the wire. See {@link collaborationModeFor} §2 for the trap this closes.
    const intended = {
      ...((askedModel ?? this._agentInfo?.model)
        ? { model: askedModel ?? this._agentInfo?.model }
        : {}),
      ...((askedEffort ?? this._agentInfo?.reasoningEffort)
        ? { effort: askedEffort ?? this._agentInfo?.reasoningEffort }
        : {}),
    }
    // ⚑ The provider's last word was "ordinary usage is not allowed" (0.160.0's
    // `ordinaryUsageAllowed`), and it never comes on a rolling frame: ask again rather than infer
    // from a reset time — see {@link RateLimitWatch}. Not awaited, as at session start.
    if (this.rateLimits.awaitingTheProvidersWord()) this.readRateLimitBaseline()
    void Promise.resolve(
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
      ),
    ).then(
      (result) => this.onTurnStartResult(localId, result),
      (error: unknown) => {
        // A failed turn/start terminalizes the just-begun turn (error→failed→idle) —
        // but ONLY if it is still the current turn (never terminalize a later one, 029).
        if (this.currentTurn?.localId === localId) {
          this.currentTurn = null
          // The profile rode on that request, so a request that never landed adopted nothing. The
          // overstatement above is only tolerable because the next turn corrects it; there is no
          // next turn here, so it is corrected now. `requested` survives — the user's choice did
          // not fail, the turn did. All four roll back for the same reason and at the same moment:
          // a session left claiming a model or an effort the server was never told about is the
          // same defect as one claiming a mode, in a place a user is more likely to read.
          this.approvals.rollback(modeBefore)
          this.models.rollback(settingsBefore.model)
          this.efforts.rollback(settingsBefore.effort)
          this.plan.rollback(settingsBefore.phase)
          this.folders.rollback(settingsBefore.workFolders)
          // `failTurn`: a turn the provider refused to start sent no terminal and owes none.
          // See the Claude adapter's copy of this call for what routing it through `completeTurn`
          // costs when the previous turn was stopped (123, review).
          this.machine.failTurn(`turn/start failed: ${errorMessage(error)}`)
        }
      },
    )
  }

  /**
   * 🔴 **713 · `R59` — Codex's own compaction, run as the turn it is.** See
   * {@link SessionHandle.compact}.
   *
   * ⚑ **{@link send}'s shape, one request over**: a turn begins (or is refused the same way), the
   * request is written and not awaited, and a rejected request fails the turn. ⛔ **Nothing a turn
   * adopts is adopted here** — no approval profile, model, effort or plan phase rides on
   * `thread/compact/start`, so a change the person queued still waits for their next message, and the
   * header goes on saying so.
   *
   * ⚠️ **The id is bound from `turn/started`, not from the answer** — see
   * {@link CodexTurn.bindsAtItsStart}. ⛔ Until it binds, the turn-scope gate drops the
   * compaction's own frames, and an interrupt is latched for the bind to send.
   */
  async compact(): Promise<void> {
    // ⛔ **Before `beginTurn()`, for {@link send}'s reason** — a refusal, not a dead session.
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
        // ⛔ Only the turn this request began (029's rule, as {@link send} keeps it).
        if (this.currentTurn?.localId !== turn) return
        this.currentTurn = null
        this.machine.failTurn(`thread/compact/start failed: ${errorMessage(error)}`)
      },
    )
  }

  /**
   * ⚑ **713 · Codex accepted the compaction: now it must START it** — within
   * {@link COMPACTION_START_TIMEOUT_MS}, or the turn is failed with a sentence saying so, rather than
   * left `working` with a Stop that has no turn id to send.
   *
   * ⚠️ **A compaction that starts after that is not drawn**: its turn is no longer this session's,
   * so the turn-scope gate drops its frames — ⛔ and until it shows itself no other compaction may
   * begin, or its start would be taken for that one's ({@link compactionOutstanding}, 713's review).
   * Measured at 8 ms against fifteen seconds.
   */
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

  async respondPermission(id: string, decision: PermissionDecision): Promise<void> {
    // Validate against what the request actually offers — never send the provider
    // a decision it didn't list (014, fixing 007 P1-7). Leaves the request pending
    // so the app can retry with a valid decision.
    // ONE synchronous check-and-transition (067, fixing 066 F1). Previously the answer removed the
    // broker resolver and the WIRE WRITE happened later, in the handler's continuation — so a
    // duplicate arriving in that gap saw an id nobody owned, did nothing, and the `accept` still
    // went out. Now the id must be CLAIMED here, and the response is written in the same
    // synchronous step that spends it: no gap, and a collision either precedes the answer (which
    // then finds SPENT and refuses) or follows it (finding SPENT and writing nothing).
    const state = this.requestStates.get(id)
    if (state?.phase !== 'claimed') {
      throw new AnswerRefused(
        'not-pending',
        `permission request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }
    const allowed = state.allowed
    // `deny`/`cancel` are the always-safe negative responses — a decline is always a
    // valid Codex reply and a cancel is Codex's own (a command or file approval's ends the turn;
    // an elicitation's cancels the request and the turn runs on, `736` R97) — so they are NEVER
    // gated by the offered set. That keeps fail-closed usable even against an object-only /
    // empty offered set: the app can always decline/cancel, while an unoffered POSITIVE
    // outcome (e.g. `allow_always` where Codex offered no amendment) is rejected here and never
    // reaches the wire (023 P1-F).
    //
    // ⚑ **Named by {@link ALWAYS_HONOURED} since 482.** The Claude adapter held the same literal
    // under a differently-worded comment, and every producer of `availableDecisions` was written as
    // if neither existed — which is how a move the rails admit came to have no button (`478` F4).
    const isSafeNegative = isAlwaysHonoured(decision.outcome)
    if (allowed && !isSafeNegative && !allowed.has(decision.outcome)) {
      throw new AnswerRefused(
        'not-offered',
        `decision '${decision.outcome}' is not offered by request ${id} (available: ${[...allowed].join(', ')})`,
      )
    }
    // 🔴 **736 · R95 — *Always allow* only where this request carries the answer that IS it**: the
    // amendment Codex offered, or Codex's own MCP approval offering `always`. ⛔ A request with no
    // offered set (a file approval) passes the gate above, and would otherwise go out as `decline`
    // while the ledger recorded *Always allow* (`736`'s review).
    const sendsAlways =
      state.alwaysAnswer !== undefined ||
      (state.kind.kind === 'elicitation' && allowed?.has('allow_always') === true)
    if (decision.outcome === 'allow_always' && !sendsAlways) {
      throw new AnswerRefused(
        'not-offered',
        `decision 'allow_always' is not offered by request ${id}: it carries no answer that keeps a grant`,
      )
    }
    // 🔴 **720 · R71 — a Cancel latches on EVERY door, and before any answer goes out.** ⚑ The
    // ruling (`709` F-1): *"both latch, because a Cancel asked a stop on both, and a fault after it
    // is not the provider's word alone."* ⚠️ Since `709` (R43) the latch renames nothing the provider
    // says — Codex's own `turn/completed` is recorded as it comes — so what it decides is the word of
    // the endings the MACHINE writes after the ask: a fatal error, a turn that failed to start.
    // ⛔ **Until `720` it sat BELOW the agent-tool arm**, so *Cancel, then the stream dies* read
    // `failed` on that card and `interrupted` on a command approval, for one press. ⚑ It is above
    // the command, file and agent-tool arms now, and below the offered-set gate, so an answer
    // refused above latches nothing. ⚠️ **Not the elicitation's**: its Cancel asks no stop at all —
    // since `736` (R97) it is the provider's cancel and nothing more, and the turn runs on
    // ({@link handleExternalMcpElicitation}) — so there is nothing to latch.
    if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {
      this.machine.requestInterrupt()
    }
    // 🔴 **A tool call's answer is not a decision, so this is not the writer for it** (348).
    //
    // ⛔ Every other kind answers the provider with `{decision}`, which is why `067` could make the
    // spend and the write ONE synchronous step. An `item/tool/call` is answered with the tool's own
    // RESULT — which does not exist yet, because saying `allow` is what makes the tool run — so
    // writing here would send an approval payload to a request that asked for a tool result.
    //
    // ⚑ **The id stays CLAIMED and {@link handleAgentToolCall} is its single writer.** That does not
    // reopen `066` F1: `permissions.respond` settles the resolver, so a second answer arriving in
    // the gap finds nothing to resolve and writes nothing, and a duplicate SERVER request for the
    // same id still finds it claimed and fails closed in {@link onIdCollision}.
    //
    // 🔴 **492 · this door's Cancel ASKS the stop with an RPC** (HO-032 §1). ⛔ `483` measured what the
    // latch alone did here: the tool call refused locally, `interruptRequested` set, and
    // `SessionMachine.completeTurn` relabelling Codex's own ORDINARY completion `interrupted` — a turn
    // nobody had asked to stop, renamed. ⚑ **This door has no decision channel at all**, so the ask
    // is the RPC: {@link handleAgentToolCall} sends `turn/interrupt` after the tool result goes back,
    // and Codex ends the turn in its own word (`probe:codex-cancel-interrupt`, `turn/completed{status:
    // 'interrupted'}` 16 ms after the frame on pinned 0.146.0). ⚠️ `492` returned here ABOVE the latch
    // because the latch could only have RENAMED that answer; since `709` (R43) it renames nothing, and
    // `720` (R71) put it above this arm — see the latch above.
    if (state.kind.kind === 'agentTool') {
      this.permissions.respond(id, decision)
      return
    }
    // ⚑ **What each remaining door's Cancel tells Codex**, measured: a command approval's
    // `{decision:'cancel'}` ends the turn `interrupted` in Codex's own word
    // (`probe:codex-approval-reason`) — as its terminal's *No* does, and a file approval's Esc too
    // (`736`'s scratch of the terminal). ⛔ An elicitation's `{action:'cancel'}` does NOT: it goes to
    // the MCP server and the turn runs on to `completed` (`probe:codex-external-mcp` arm H, `720`) —
    // as the terminal's own Esc does, and since `736` (R97) this app adds nothing to it.
    // 🔴 **605 · an elicitation is answered in ITS OWN wire shape, not with a `decision`.**
    //
    // ⛔ **Found reviewing this dispatch's own diff, and the test it already had could not see
    // it**: it counted responses and never read one, so a malformed frame passed
    // (`a-positive-assertion-must-differ-from-the-default`, arriving as an assertion that asked
    // the wrong question). ⚠️ `McpServerElicitationRequestResponse` is `{action, content, _meta}`
    // and every other door on this method answers `{decision}` — so a person pressing **Deny** on
    // a card this app could not put a form on would have sent the MCP server a frame it does not
    // parse, after BroBot had recorded the answer as taken.
    //
    // ⚑ **`cancel` maps to `cancel` and every other refusal to `decline`**, which is the same
    // distinction {@link codexDecision} makes: `McpServerElicitationAction` happens to spell both
    // the way this app does. ⚑ **723 · R80 — and the positives exist on TWO cards only** since `728`:
    // Codex's own approval of a tool call, and a server's own zero-field form (Allow = `accept`, no
    // content): {@link elicitationAnswer} — ⚑ and since W4.28 a url request whose link is shown
    // (*I opened it*, `accept` with no content). ⛔ `openai/form`, a user verification and a withheld
    // link still offer none — {@link handleExternalMcpElicitation} publishes `publishedOffer([])` for
    // them, and the gate above refuses a positive before this line.
    // 🔴 **736 · R95 — Codex's *Always allow* is KEPT in this home before the answer goes**
    // ({@link keepToolApproval}), because on this path Codex keeps nothing itself (measured). ⛔ A
    // keep that fails refuses the answer as `not-kept` (`740`, R99 — until then `not-usable`, which
    // is worded as an empty answer) — the card stays live, and nothing records a grant that was never
    // kept (standing rule 18).
    if (state.approvesATool !== undefined && decision.outcome === 'allow_always') {
      const { serverName, tool } = state.approvesATool
      try {
        // ⚑ Kept with the address this launch declared the server at — its identity, not its name.
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
        : // 🔴 736 · R95 — the amendment Codex offered, verbatim; every other outcome as before.
          decision.outcome === 'allow_always' && state.alwaysAnswer !== undefined
          ? { decision: state.alwaysAnswer as CommandExecutionApprovalDecision }
          : { decision: codexDecision(decision) }
    // Atomic: spend the id and write its single response here, synchronously. The handler's own
    // post-await write then finds the id SPENT and is suppressed — it remains the writer only for
    // the paths that settle WITHOUT spending (teardown / settleAll).
    this.spendRequest(state.rawId, () => this.transport.respond(state.rawId, answer))
    // 🔴 **723 · the conversation's grant of one MCP tool, KEPT** — for the header's
    // {@link blanketGrants} (`723`'s review: it was granted and then invisible), and so a server's
    // form wearing Codex's marker for that tool is never read as Codex asking ({@link McpCallsInFlight}).
    if (state.approvesATool !== undefined && decision.outcome === A_TOOLS_SESSION_GRANT) {
      this.mcpCalls.grant(state.approvesATool.serverName, state.approvesATool.tool)
    }
    // 🔴 **736 · R95 — and an ALWAYS grant is at least that**: Codex will not ask about the tool
    // again, so a later frame wearing its marker for it is the server's, never Codex's.
    if (state.approvesATool !== undefined && decision.outcome === 'allow_always') {
      this.mcpCalls.grant(state.approvesATool.serverName, state.approvesATool.tool)
    }
    this.permissions.respond(id, decision)
  }

  async respondUserInput(id: string, response: UserInputResponse): Promise<void> {
    // Same atomic answer transition as `respondPermission` (067): the id must be CLAIMED, and its
    // single response is written in the same synchronous step that spends it.
    const state = this.requestStates.get(id)
    if (state?.phase !== 'claimed' || !state.userInputPayload) {
      throw new AnswerRefused(
        'not-pending',
        `user-input request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }
    // ⛔ **Refused BEFORE the id is spent (142 §1/§2).** An answer this adapter cannot state is not
    // a decline: declining tells the provider the user said no, and the host — which sees only that
    // this method resolved — records `Answered`. Throwing leaves the id CLAIMED and the card live,
    // so 085's `noteFailure` puts the reason on it and the user answers again.
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
    // ⚑ **F084 · a turn Codex has already ended, whose ending waits on its commands'**
    // ({@link completing}): it is over, so nothing is asked, and its own ending is waited for —
    // ⛔ never the `forceEnd` below, which that ending would then have landed on the next turn.
    if (!this.currentTurn && this.completing !== null) {
      await this.completing.done
      return
    }
    this.machine.requestInterrupt()
    this.settleRequests()
    // ⚠️ **Without a `currentTurn` there is no id to interrupt, and that is a REAL limit rather than
    // a shrug** (123). `turn/interrupt` addresses a thread turn; work Codex is doing outside one has
    // no address on this protocol. So the local half still happens — the cards are settled and
    // {@link SessionMachine.forceEnd} gives the composer back — and the RPC is simply not available
    // to send. Measured context: every one of the 18 out-of-turn bursts in the live corpus is
    // Claude's — and `conformance.test.ts` records WHY: `onNotification` drops turn-scoped content
    // that matches no bound turn (037), so this adapter would not report one. Written to be honest
    // rather than to look symmetrical.
    if (!this.currentTurn) {
      // ⛔ `false`: no RPC was sent, so nothing is owed. See `SessionMachine.forceEnd` for what a
      // debt nobody was asked to pay costs — the session goes deaf to this provider's out-of-turn
      // work until the user's next message.
      this.machine.forceEnd(false)
      return
    }
    // 🔴 **704 · asked, and kept** — {@link CodexTurn.interruptAsked}: Codex refuses an interrupt
    // for a turn it has not started yet, so `turn/started` sends this one again.
    this.currentTurn.interruptAsked = true
    const turn = this.currentTurn
    // 🔴 **F084 · its commands end FIRST, then the turn.** `turn/interrupt` ends the turn and leaves
    // its command running, as background work nobody started as such (measured on 0.146 and 0.160).
    // ⚑ Which ones: see {@link endWhatTheTurnStarted}. Ended before the turn, so what the stop's
    // ending says — and what a reader of it sees still running — is after them. ⚠️ Bounded: a list
    // Codex does not answer must not hold the stop back, and with no command the RPC goes out with
    // no wait at all, as before.
    if (turn.commands.size > 0) {
      await withTimeout(this.endWhatTheTurnStarted(turn), COMMANDS_END_WITHIN_MS)
    }
    const providerTurnId = turn.providerTurnId
    if (providerTurnId) {
      await this.sendInterruptRpc(providerTurnId)
    } else {
      // Early interrupt (before the `turn/start` RESPONSE binds the id): latch it (037/029,
      // 023 P1-C). `bindProviderTurn` — called from onTurnStartResult when the response
      // resolves — fires the RPC the instant the id is bound. ⚠️ **704 · that alone did not stop
      // the turn**: the bind is before the turn RUNS, and Codex refuses an interrupt then; the
      // `turn/started` resend is what reaches it.
      turn.interruptPending = true
    }
  }

  /**
   * 🔴 **F084 · end the commands a stopped turn started, which `turn/interrupt` leaves running** —
   * see {@link BackgroundTerminals.endTheseCommands} for how. ⚑ Which ones depends on why the turn
   * was stopped:
   *  - **every stop** ends the commands the turn is still waiting on — the ones the model has not
   *    moved on from ({@link noteWhatTheTurnMovedOnTo}). Their output is lost to the model with the
   *    turn, so they would only run on for nothing.
   *  - **an explicit stop** ({@link endEverythingTheTurnStarted}) ends every command the turn
   *    started, the ones the model left running included: whoever pressed Stop wants the work
   *    stopped.
   *
   * ⚑ **A command an earlier turn left running is never ended here**: that turn ended with it
   * running, so it is background work, which a person stops on its own row.
   *
   * ⚑ The commands it ended are said by the turn's ending (`endedCommands`), which waits on this
   * ({@link onTurnCompleted}). ⚑ Two passes: one before the stop goes out, so the turn's end finds
   * them gone, and one at the turn's end, for a command started meanwhile — chained
   * ({@link CodexTurn.commandsEnding}), so neither's word comes after the ending. ⚠️ Best-effort,
   * and silent on a failure: the level is still read, so what still runs is still listed as running.
   */
  private endWhatTheTurnStarted(turn: CodexTurn): Promise<void> {
    turn.commandsEnding = turn.commandsEnding.then(() => this.endTheCommandsOf(turn))
    return turn.commandsEnding
  }

  /** ⚑ **F084** — one pass of {@link endWhatTheTurnStarted}. */
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
      // ⚑ The list Codex refused: the poll's own level still says what runs.
    }
  }

  /**
   * ⚑ **F084 · the stop asked of this turn is an explicit one** — see {@link SessionHandle}'s. Read by
   * the pass when the list answers, which is after the host's call: the host makes it at once after
   * its `interrupt()`, which sends the list request before it waits. ⚑ A turn whose ending waits on
   * its commands' ({@link completing}) gets one more pass, which that ending waits for too.
   */
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

  /**
   * ⚑ **F084 · a later TOOL USE means the model moved on** from every command this turn started
   * before it ({@link TOOL_USES}): another command, a file change, another tool. ⚑ A command it moved
   * on from runs as background work it means to keep, and a stop that only makes way for words leaves
   * it running ({@link endWhatTheTurnStarted}).
   *
   * ⛔ **Not its message or its reasoning**: a model waiting on a long command writes and thinks
   * between its checks on it, and a check (`write_stdin`) shows on this stream as nothing at all —
   * measured on 0.160, as a function call (the tools a real model is offered) and in a code-mode
   * cell. Counted, they made the command a model was polling one it had moved on from.
   *
   * ⚠️ **What this cannot see**: two commands started together (parallel calls) — the first counts
   * as moved on from, so a stop that makes way for words leaves it running; and a command left
   * running while the model only writes or thinks still counts as waited on, so such a stop ends it.
   */
  private noteWhatTheTurnMovedOnTo(method: string, params: unknown): void {
    if (method !== 'item/started' || this.currentTurn === null) return
    const item = isRecord(params) ? params['item'] : undefined
    const type = readString(item, 'type')
    // ⚑ A sub-agent spawned or spoken to is a tool use too: it is announced as an activity, and
    // `spawnAgent` never comes as a `collabAgentToolCall` (see `normalize.ts`).
    const toASubAgent = type === 'subAgentActivity' && SUB_AGENT_USES.has(readString(item, 'kind'))
    if (!TOOL_USES.has(type) && !toASubAgent) return
    for (const command of this.currentTurn.commands.values()) command.movedOn = true
  }

  /**
   * **Stop ONE live command** (275) — see {@link SessionHandle.stopBackgroundWork}.
   *
   * ⚠️ **The guard is the Claude adapter's, word for word**: silently a no-op on a terminal session,
   * because there is nothing left running to stop and a rejection would make a closed conversation
   * look broken. A stop the PROVIDER refuses still rejects — the measured refusal is JSON-RPC -32600
   * for a `processId` it cannot parse — because that is a real answer and the caller should see it.
   *
   * ⛔ **`interrupt` is NOT this, and 275 measured why the distinction is not academic.**
   * `turn/interrupt` ended the turn and left the command in the process table 20 seconds later; this
   * ends the command and leaves the conversation alone. They are opposite halves, and before this
   * dispatch Codex shipped only the one that cannot reach the process.
   *
   * ⛔ **The guard is `isShuttingDown` and not `machine.isTerminal`** (287 finding 5). Terminal is
   * the END of teardown; `closing` is the state a conversation is in from the instant Close is
   * pressed, and the bar's Stop button was live through the whole of it. The two silent no-ops now
   * answer `false`, which is what makes the row give the control back instead of reading
   * *"Stopping…"* over a request that was never sent.
   */
  async stopBackgroundWork(id: string): Promise<boolean> {
    if (this.isShuttingDown) return false
    return await this.backgroundTerminals.terminate(id)
  }

  /**
   * Keep output printed by a running command.
   *
   * ## ⛔ Why this is fed from ABOVE the turn gate, and why that is not a hole
   *
   * ⚠️ **`item/commandExecution/outputDelta` is a member of {@link TURN_SCOPED_METHODS}, and it has
   * to stay one.** What that gate protects is CONTENT: a delta from a finished turn must never be
   * appended to the transcript of the turn now running, which is the defect `027` and `028` each
   * fixed once. Nothing below changes that — the frame still meets the gate two lines down and is
   * still refused there, so no stale byte reaches the normalizer, the card body or the ledger.
   *
   * ⛔ **But the gate would also throw away the whole subject.** `probe:command-output` measured a
   * detached command emitting **39 output frames after its own `turn/completed`**, still ticking; a
   * tail fed from inside the gate would go silent at exactly the moment the work becomes *background*
   * work, which is the only moment anybody needs to watch it. ⚑ `247`'s definition of this subject is
   * *"work that outlives the turn"*, so a channel that dies with the turn cannot serve it.
   *
   * ⚑ **What makes it safe is that a tail is ADDRESSED and content is not.** A delta lands in the
   * ring of the `itemId` it names and nowhere else; a card reads the ring for its own call id and
   * nothing else. There is no "current" anything for a stale frame to contaminate — which is the
   * property `turn/plan/updated` lacked (one late frame OVERWROTE the running turn's checklist) and
   * the reason that method's gating is not merely by choice.
   *
   * ⚠️ **The thread gate is still above this**, so a frame belonging to another conversation has
   * already been refused before this line — `namesForeignThread`, one screen up. This deliberately
   * does not ask for a turn id at all.
   */
  private noteCommandOutput(params: unknown): void {
    this.commandTails.write(readString(params, 'itemId'), readString(params, 'delta'))
  }

  /**
   * ⛔ **The provider said this command's item is over** — so the tail stops being a claim about now.
   *
   * ⚠️ **Fed from `item/completed`, which a DETACHED Codex command never sends** (275 measured it
   * over 30 seconds after the process had been killed). That is not a gap this papers over: the
   * other closer is {@link BackgroundTerminals}' own ending, which is the only thing that ever
   * reports one for detached work — see {@link closeEndedCommandOutput}.
   */
  private closeCommandOutput(params: unknown): void {
    const item = isRecord(params) ? params['item'] : undefined
    this.commandTails.close(readString(item, 'id'))
  }

  /** The registry's own ending, which is detached work's only closer — see {@link closeCommandOutput}. */
  private closeEndedCommandOutput(event: RuntimeEvent): void {
    if (event.type !== 'background_work') return
    const toolCallId = event.ended?.toolCallId
    if (toolCallId !== undefined) this.commandTails.close(toolCallId)
  }

  /**
   * **What this command has printed, as much of it as we are holding** (300) — see
   * {@link SessionHandle.commandOutput}.
   */
  commandOutput(toolCallId: string): CommandTail | null {
    return this.commandTails.read(toolCallId)
  }

  /**
   * ⛔ **Keep what a tool answered, whole** (462) — fed from `item/completed`, which is where the
   * probe measured `contentItems` is populated (`457`: it is `null` on `item/started`).
   *
   * ⚠️ **The kinds it holds and the kinds it does not are decided in `normalize.ts`**, beside the
   * two summaries that read the same arrays — one file knows this wire's item shapes, so a third
   * reading cannot drift from the two that draw the row.
   */
  private noteToolAnswer(params: unknown): void {
    const item = isRecord(params) ? params['item'] : undefined
    const parts = codexToolAnswerParts(item)
    if (parts === null) return
    this.toolAnswers.write(readString(item, 'id'), parts)
  }

  /**
   * **What this tool answered, as much of it as we are holding** (462) — see
   * {@link SessionHandle.toolAnswer}.
   */
  toolAnswer(toolCallId: string): ToolAnswer | null {
    return this.toolAnswers.read(toolCallId)
  }

  /**
   * **What the app-server says about one of this thread's children** (296).
   *
   * ## ⛔ Why this does not break the one-thread-per-connection argument
   *
   * `TURN_SCOPED_METHODS`' docblock rests the whole `CodexSubAgents` design on *"this transport
   * spawns its own `app-server` per session and opens exactly one thread on it"*, and names a shared
   * or multiplexed transport as the thing that would invalidate it. ⚑ **This opens no thread.**
   * `thread/read` is a read against a thread the server is ALREADY holding — the child was spawned by
   * our own thread on this same connection, which is exactly why its id is reachable here — so the
   * set of threads this transport can mention is unchanged. `thread/resume` would be the other thing,
   * and is deliberately not used: resuming would make this connection the holder of a second thread.
   *
   * ⚠️ **Its notifications are still refused, and they should be.** `namesForeignThread` drops every
   * frame carrying the child's `threadId`, so nothing the child says enters this conversation's
   * transcript — `245`'s rule, unchanged. The child's own words are read from the child's own rollout
   * by the viewer, which is a file the provider writes and not a stream we have to re-scope.
   *
   * ⚠️ **`thread/read` was never called by this repo before today.** `295` measured it against this
   * exact pin (0.146.0): 8 ms live, 5 ms on a finished child, 8 ms cold, and it is the reader that
   * works — `thread/items/list` answers JSON-RPC `-32601` *"not supported yet"* in all three states
   * (0.146.0; 0.159.0 added item anchors to it, and it was not re-measured on 0.160.0).
   * `includeTurns` is left off: the vendored type says `turns` comes back empty without it, and the
   * turns are what the viewer reads off disk anyway. This asks for status, not for a transcript.
   *
   * ⛔ **A deadline, because `transport.request` has none.** An app-server that is alive but silent
   * settles nothing; every other non-awaited request in this adapter carries its own named constant
   * for the same reason.
   */
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
    // ⚠️ **A response with no `thread` is "we were not told", not an idle child.** The unknown state
    // keeps the composer shut, which is the safe reading of a malformed answer.
    if (!isRecord(thread)) return CHILD_STATE_UNKNOWN
    const accepts = readField(thread, 'canAcceptDirectInput')
    const turns = readField(thread, 'turns')
    return {
      status: childStatusOf(readString(readField(thread, 'status'), 'type')),
      // ⛔ `null` is preserved rather than coerced — see `ChildThreadState.acceptsInput`.
      acceptsInput: typeof accepts === 'boolean' ? accepts : null,
      nickname: readOptionalString(thread, 'agentNickname') ?? null,
      turns: Array.isArray(turns) ? turns.length : null,
    }
  }

  /**
   * **Speak to one of this thread's children** (296) — and refuse while it is working.
   *
   * ⛔ **The refusal is the dispatch.** `295` sent this exact request to a busy child: the server
   * accepted it, answered with a turn id that appears in **one** of its 167 frames and nowhere else,
   * merged the message into the turn already running, completed that turn, and let its `sleep 20`
   * run for another 7.667 seconds. Sending anyway and calling it a message would be three false
   * statements, so {@link childInputRefusal} is asked first and nothing is written on a `working`.
   *
   * ⚠️ **The state is read again HERE rather than taken from the caller.** A composer draws itself
   * from a state that is milliseconds old; this is the read the wire write is decided by. It does not
   * close the race — the provider is the only authority on that — and the gap is stated rather than
   * papered over.
   *
   * ⛔ **This does NOT touch `machine` or `currentTurn`.** The child's turn is not this session's
   * turn: `beginTurn()` here would emit `working` for a conversation nobody sent anything to, and
   * would then wait forever for a `turn/completed` this session's gate refuses to read. The parent
   * stays exactly as busy as it was.
   *
   * ⚠️ **Nothing is overridden on the child's behalf.** `turnStartParams` re-pins model, effort,
   * approval profile and sandbox on every turn of OUR thread, and none of that is sent here: those
   * are the child's own settings, chosen when its parent spawned it, and re-pinning them from this
   * session's state would silently reconfigure somebody else's agent mid-conversation. Only
   * `threadId` and `input` cross — the two fields `TurnStartParams` declares non-optional.
   */
  async childInput(childId: string, text: string): Promise<ChildInputOutcome> {
    const state = await this.childState(childId)
    const refusal = childInputRefusal(state)
    if (refusal !== null) return { ok: false, reason: refusal, state }
    const result = await withDeadline(
      Promise.resolve(
        this.transport.request('turn/start', {
          threadId: childId,
          // The same shape `turnStartParams` writes — `text_elements` is required by the wire even
          // when there is nothing to put in it.
          input: [{ type: 'text', text, text_elements: [] }],
        } as TurnStartParams),
      ),
      CHILD_INPUT_TIMEOUT_MS,
      'codex turn/start (child)',
    )
    // ⛔ **Reported, not believed.** See `ChildInputOutcome.turnId`: this is the field 295 watched
    // the provider fill with an id it then never used again.
    return { ok: true, turnId: readOptionalString(readField(result, 'turn'), 'id') ?? null }
  }

  /**
   * ⛔ **State the level once, now** (275) — used by `resume` and by nothing else.
   *
   * ⚠️ **Not on {@link SessionHandle}, and that is deliberate.** It is not a control anybody outside
   * this file should have: the level is this adapter's business and it decides when to read it. This
   * exists because a resume is the one moment the decision belongs to the caller — see the call site
   * for the stale rows it takes off the screen.
   */
  refreshBackgroundWork(): void {
    this.backgroundTerminals.refresh()
  }

  /**
   * The teardown barrier (007 P1-1). Awaitable + idempotent. The load-bearing
   * ordering: `closing` (rejects new sends) → safe-reject pending prompts →
   * **drain in-flight approval handlers so their `decline` writes reach the wire
   * BEFORE `transport.close()`** (the pre-fix bug: close killed the transport
   * before the decline continuation wrote) → if a turn is active, `turn/interrupt`
   * and bounded-await, then force exactly one terminal `turn:'interrupted'` → the
   * sole `session:'ended'`/`status:'ended'` → only then tear down the transport.
   */
  close(): Promise<void> {
    // Single-flight: every concurrent caller awaits the SAME teardown promise, so
    // caller 2 never resolves before caller 1's transport teardown finishes (023 P1-A).
    // NOT `async` — an async wrapper would return a fresh promise per call.
    return (this.closing ??= this.doClose())
  }

  private async doClose(): Promise<void> {
    // ⛔ **The registry watch stops FIRST, on both paths** (275). It is the one thing here that would
    // otherwise send a request into a transport being closed, and `273` is the dispatch that
    // established what that costs — a clean quit that prints a handler exception. Idempotent, so the
    // already-terminal branch below is covered by the same line.
    // ⚠️ **The tails go with the session, and nothing outlives it.** They are a claim about a live
    // process; a closed conversation has none, and the card reads `unfinished` from the transcript's
    // own sweep rather than from a buffer we kept holding (074's rule, one surface over).
    //
    // ⛔ **ABOVE the watch's own close and not below it, and that is deliberate rather than tidy.**
    // `275`'s mutation `M12` anchors on `backgroundTerminals.close()` being immediately followed by
    // `if (!this.machine.beginClose())`, and a line inserted between them retires a row that is
    // still protecting something real. `142`'s rule is to correct an anchor in place rather than let
    // it lapse — and `300` may not touch another dispatch's table, so the code moves instead.
    this.commandTails.clear()
    this.backgroundTerminals.close()
    if (!this.machine.beginClose()) {
      // Already terminal (errored/closed): finishUnexpected/an earlier close already
      // emitted the terminal events — drain in-flight handlers and reap the transport.
      this.settleRequests()
      await withTimeout(this.drainInFlight(), CLOSE_FLUSH_TIMEOUT_MS)
      this.terminated = true
      this.eventQueue.close()
      await this.transport.close() // idempotent (single-flight in SpawnCodexTransport)
      return
    }
    this.settleRequests()
    // Let the settled approval/user-input handlers flush their decline/error to
    // the app-server before we close the transport.
    await withTimeout(this.drainInFlight(), CLOSE_FLUSH_TIMEOUT_MS)
    // `hasProviderWork` (123): a burst outside a turn is torn down the same way a turn is.
    if (this.machine.hasProviderWork) {
      this.machine.requestInterrupt()
      const providerTurnId = this.currentTurn?.providerTurnId
      if (providerTurnId) {
        await withTimeout(this.sendInterruptRpc(providerTurnId), CLOSE_INTERRUPT_TIMEOUT_MS)
      }
      this.currentTurn = null
      // A no-op if the provider terminalized during the ack, exactly as the old guard was.
      this.machine.forceEnd()
    }
    // Never synthesize a ref: a handshake that never confirmed a thread id has no
    // honest identity to announce as ended (011). closeSession(null) emits only
    // `status:'ended'`.
    this.machine.closeSession(this._ref)
    this.terminated = true
    // Close the event stream promptly (consumers already have the terminal
    // events), then await the transport's bounded process teardown (012).
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

/**
 * The Codex adapter: drives `codex app-server` behind a transport seam, with an
 * approval profile that prompts and streaming deltas consumed, per 001.
 */
export class CodexRuntime implements AgentRuntime {
  readonly provider = 'codex' as const
  private readonly transportFactory: TransportFactory
  private readonly authHealth: ((providerHome: string) => AuthHealth) | undefined

  /**
   * `authHealth` (022) is the host-wired managed-credential check: when set, an
   * unhealthy result (no `auth.json` in the profile home, wrong mode, or a symlink)
   * fails the launch closed with {@link AuthUnavailableError} BEFORE the app-server
   * spawns — never a fall back to the personal `~/.codex`. When unset (the library
   * default), no check runs; the app wires it once auth is provisioned.
   */
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

  /**
   * Everything that must hold BEFORE the app-server is allowed to exist (041, fixing 036 P1-H):
   * managed auth health (022) and the profile's `sqlite_home` attestation. Pre-fix the SQLite
   * attestation ran inside `begin()` — i.e. AFTER the spawn and handshake — so a config that
   * redirects Codex state out of the managed home could already be live before we looked.
   * The `initialize`-response `codexHome` check (027) stays as the post-start confirmation.
   */
  private assertLaunchPreconditions(providerHome: string): void {
    this.assertAuthHealthy(providerHome)
    assertCodexSqliteHomeContained(providerHome)
  }

  async start(opts: StartOptions): Promise<SessionHandle> {
    // Above the preconditions, so a cancelled launch does no work at all — see
    // {@link ProviderRuntimeContext.signal}.
    assertNotCancelled(opts.signal, 'codex start')
    // ⛔ **ABOVE the preconditions, and 168 M4 is why it moved** (188 §1). It used to run after
    // them, and `assertCodexSqliteHomeContained` PARSES this very file: a 157 `config.toml` whose
    // TOML no longer parses threw `AuthUnavailableError` before the line that would have deleted
    // it, so the one home that could not launch was also the one home the migration could never
    // reach — permanently, on every attempt. See {@link removeStaleCodexPermissionConfig} for why
    // removing before attesting is not a hole: it deletes ONLY a file carrying our own generated
    // header, an unreadable one is left alone, and a config this app did not write still reaches
    // the attestation below untouched.
    removeStaleCodexPermissionConfig(opts.providerHome)
    // ⛔ **The two gates, on EVERY launch and not only on provisioning** (314). A profile created
    // before this existed has no memory config at all, and there is no migration hook — so the only
    // place that reaches every home is the place the 157 migration above already stands.
    //
    // ⚠️ **Below the stale sweep and above the attestation**, and both halves of that ordering are
    // load-bearing: merging into a file the line above is about to delete would be work thrown away,
    // and `assertCodexSqliteHomeContained` parses this very file, so it must see the bytes the child
    // will. ⚑ It never throws — see {@link ensureCodexMemoryConfig}; a home whose config cannot be
    // merged launches without memory rather than not launching.
    const memoryConfig = ensureCodexMemoryConfig(opts.providerHome)
    this.assertLaunchPreconditions(opts.providerHome) // fail closed BEFORE spawning (022 + 041)
    // ⛔ **No second app-server may boot on this home while one is still creating its sqlite state**
    // (180). Taken BEFORE the spawn, because the child begins that work the moment it exists.
    //
    // ⛔ **The signal goes to the gate too, since 202** (191 H4). This caller has always held one and
    // never passed it, so a launch queued behind another sat out the whole fifteen-second wait after
    // the app had given up on it — and then spawned, five seconds after `closeAll` stopped waiting
    // for anything. The gate throws rather than hand a slot to a caller who has gone; nothing has
    // been created at this line, so there is nothing to unwind.
    const phase = phasesOf(opts.startPhases)
    phase('boot-gate-entered')
    const bootSettled = sayingTheRelease(
      await beginCodexHomeBoot(opts.providerHome, { signal: opts.signal }),
      phase,
    )
    phase('boot-gate-passed')
    // The account the app-server is about to load, read just before it is spawned.
    const launchAccount = codexAccountInNow(opts.providerHome)
    const launchCopy = codexCopyIdentityIn(opts.providerHome)
    // ⚠️ **The cancel is NOT re-asked here, and that was a deliberate reversal.** Re-asking looks
    // strictly safer and is not: 070 pins that a cancel arriving after `start` was called closes the
    // transport it had already spawned, and refusing to spawn instead left that test waiting for a
    // close on a transport that no longer existed. `cancelWith` below is what owns this interval.
    let transport: CodexTransport
    try {
      transport = this.transportFactory({ cwd: opts.cwd, providerHome: opts.providerHome })
    } catch (error) {
      bootSettled()
      throw error
    }
    phase('spawned')
    // ⚠️ **Wired on the line after the spawn, and that is the whole point** (070, from 068 finding
    // 2). The app-server is a DETACHED child that exists from `transportFactory` onward, while the
    // only thing that could stop it — the handle below — does not reach the caller until `begin()`
    // has answered. 068 named the cost: an app that exits in that interval leaves an authenticated
    // provider running with nobody left to reap it.
    const cancel = cancelWith(opts.signal, () => transport.close())
    const handle = new CodexSessionHandle(
      transport,
      opts.cwd,
      0,
      opts.providerHome,
      undefined,
      opts.approvalMode,
      resolveReasoningEffort(opts),
      // 057, widened to three states by 060. A fresh session is never `left` in practice — the
      // go-ahead is a mid-session gesture — but the phase is read from the context rather than
      // assumed, so `start` and `resume` cannot come to different conclusions about the same fields.
      planPhaseOf(opts),
      // What the launch asked for, so `settings.model.effective` opens as the truth rather than as
      // "nobody chose" on a session that did (076). It is already on `thread/start` below; this is
      // the same value, kept where a mid-conversation change can move it.
      opts.model,
      // 🔴 **The five tools** (348). See {@link CodexSessionHandle.agentTools}.
      opts.agentTools,
      // 🔴 **…and the granted external MCP servers** (605). See
      // {@link CodexSessionHandle.externalMcp}.
      opts.externalMcp,
      // 🔴 **…and the work folders** (W4.189). See {@link CodexSessionHandle.folders}.
      opts.workFolders,
      memoryConfig,
      opts.builtInSkills,
    )
    handle.noteLaunchAccount(launchAccount, launchCopy)
    handle.noteStartPhases(phase)
    try {
      // A malformed thread/start now throws from begin() (empty/missing id) —
      // close the transport so the spawned app-server can't leak, then reject.
      await handle.begin('started', opts.model, opts.systemHint, bootSettled)
      // Asked AFTER the await, because that is the interval it is about. A cancel that landed during
      // the handshake has already closed the transport above; this is what stops a dead handle being
      // handed back as a live session.
      if (cancel.cancelled) throw new Error('codex start was cancelled')
    } catch (error) {
      await transport.close() // bounded process teardown, no leak, before rejecting
      throw aFailedStart(error)
    } finally {
      // The backstop for the launches where `initialize` never answered (180) — a spawn that failed
      // must still hand the home's boot slot back, or every later Codex launch waits out its budget.
      bootSettled()
      // The handle is the caller's from here; only `close()` may stop it now.
      cancel.release()
    }
    return handle
  }

  /**
   * The models this login may run (058) — `model/list`, straight after the handshake.
   *
   * **No thread, no turn, no tokens**, measured against the bundled 0.146.0 binary in an isolated
   * `CODEX_HOME`. Seven rows came back:
   *
   * ```
   * → {"method":"model/list","params":{}}
   * ← {"data":[{"id":"gpt-5.6-sol","displayName":"GPT-5.6-Sol","hidden":false,"isDefault":true,…},
   *            …,{"id":"gpt-5.4","upgrade":"gpt-5.6-terra","upgradeInfo":{…}}], "nextCursor":null}
   * ```
   *
   * ⚠️ **`hidden` is the server's job and we must not undo it.** `ModelListParams.includeHidden` is
   * documented *"when true, include models that are hidden from the default picker list"* — so the
   * default answer is already filtered, and the way to respect `hidden` is to **not pass the flag**.
   * Proven rather than assumed: `includeHidden:true` returned one extra row, `codex-auto-review`,
   * the only row in the catalogue with `hidden:true`. The explicit filter below is belt-and-braces
   * against a server that someday sends one anyway, not the mechanism.
   *
   * ⚠️ **It pages, and a caller that took page one would silently ship a truncated catalogue.**
   * `limit:3` returned `nextCursor:"3"`. Today the unpaged call answers everything with
   * `nextCursor:null`, but that is a fact about a catalogue of seven, not a guarantee — so the
   * cursor is followed. The page bound below is a runaway guard, not a policy: it is far above any
   * plausible catalogue, and the free-text field means even a truncated list is never a dead end.
   *
   * `upgrade` is passed through as {@link ModelChoice.note} rather than dropped. 058's dispatch
   * guessed it meant "needs a plan you do not have"; measured, it means **deprecation** —
   * `gpt-5.4 → gpt-5.6-terra`, with the server's own sentence in `upgradeInfo.migrationMarkdown`.
   * Either way it is something the user needs before choosing the row, so it travels.
   */
  async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    // A probe is a launch (070, from 068 finding 7): it spawns a real app-server, so it takes the
    // same cancel as `start` and `resume`. It was outside every ownership mechanism this app had,
    // for the single reason that every mechanism was about sessions and a probe is not one.
    assertNotCancelled(context.signal, 'codex model list')
    this.assertLaunchPreconditions(context.providerHome) // same fail-closed as a launch (022 + 041)
    // ⛔ **The probe is the app-server this race is usually WON by** (180). It boots first — the
    // launcher asks on mount — and the session that follows had nothing but 159 measured
    // milliseconds of luck between it and the same home's half-created sqlite state.
    const bootSettled = await beginCodexHomeBoot(context.providerHome, { signal: context.signal })
    // `cwd` is the home itself: nothing here runs a command or reads the project, and pointing a
    // probe at a user directory it has no reason to see would be a wider spawn than the question.
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
      // ⚠️ **Every wait here is BOUNDED, and the bound is what makes the `finally` reachable**
      // (058 review). `transport.request` settles when the child answers, when it EXITS, or when
      // the transport is closed — so an app-server that is alive but silent settles nothing. The
      // `finally` below would then never run, the child would outlive the app, and `listModels`
      // would never settle at all: the host caches this probe, so one stuck app-server left every
      // future caller awaiting a promise that could not resolve. The deadline turns that into an
      // ordinary rejection, which the host already handles as "no menu for this provider".
      //
      // The whole call is bounded rather than each request, deliberately: the budget belongs to the
      // QUESTION ("what models are there?"), and a per-request bound would let a server that pages
      // slowly enough spend it twenty times over.
      const deadline = Date.now() + MODEL_PROBE_TIMEOUT_MS
      const bounded = <T>(p: Promise<T>, what: string): Promise<T> =>
        withDeadline(p, Math.max(1, deadline - Date.now()), `codex ${what}`)

      await bounded(transport.request('initialize', initializeParams()), 'initialize')
      bootSettled() // the state runtime exists; `model/list` below is a network wait (180)
      transport.notify('initialized', {})
      const choices: ModelChoice[] = []
      let cursor: string | undefined
      for (let page = 0; page < MODEL_LIST_PAGE_LIMIT; page++) {
        const response = await bounded(
          transport.request('model/list', {
            // Absent, not `false`: the ONE thing this call must not do is ask for hidden rows.
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
      // Cancelled mid-catalogue: the transport is already closing, so the pages we happen to hold
      // are a truncated answer to a question nobody is waiting for. Reject rather than return them.
      if (cancel.cancelled) throw new Error('codex model list was cancelled')
      return choices
    } finally {
      bootSettled() // the backstop for a probe whose `initialize` never answered (180)
      cancel.release()
      // ⚠️ Reached on the deadline path too, and that is the point: `withDeadline` releases the
      // AWAITER, never the child. THIS is what releases the child — `close()` is itself a bounded
      // teardown (end stdin → SIGTERM → SIGKILL), so a probe cannot leak an app-server even when
      // the reason it failed is that the app-server stopped talking.
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
    let memoryConfig: CodexMemoryConfigResult
    const phase = phasesOf(options.startPhases)
    // 🔴 **697 · `673` F-6 — Claude's boundary, over the steps BEFORE the handshake too.** ⛔ A cancel
    // already requested, the home's boot gate and a transport that could not be spawned used to
    // leave as themselves — a plain `Error`, a `CodexHomeBootAbandoned`, whatever the factory threw —
    // so a wake read a spawn failure as nothing it knew and RETHREW it where Claude's adapter, for
    // the same failure, answered *could not be resumed*. ⚑ Now the same two lines as Claude's: an
    // unusable sign-in stays an `AuthUnavailableError`, anything else is a `ResumeError` CARRYING it
    // as `cause`. ⚑ **706 · none of these is a thread that is gone** — nothing has asked the
    // app-server anything yet — so none is marked `noSuchSession`; the host's *"the thread is gone"*
    // reads that field, never whether a cause is present (`705` F-3).
    try {
      assertNotCancelled(options.signal, 'codex resume') // nothing spawned, nothing to unwind (070)
      // The same migration as `start`, in the same place and for the same reason (188 §1, from 168
      // M4) — and this is the path where it matters most: a home last opened by the 157 build is
      // most likely to turn up through a RESUME, since its sessions are the ones that already exist
      // (160). A malformed one used to strand exactly those conversations.
      removeStaleCodexPermissionConfig(options.providerHome)
      // Apply the same memory and launch gates on resume as on start so existing profiles receive current configuration before their conversations continue.
      memoryConfig = ensureCodexMemoryConfig(options.providerHome)
      this.assertLaunchPreconditions(options.providerHome) // fail closed BEFORE spawning (022 + 041)
      // As in `start` above — 180 for the gate, 202 for the signal it is given.
      phase('boot-gate-entered')
      const settled = sayingTheRelease(
        await beginCodexHomeBoot(options.providerHome, { signal: options.signal }),
        phase,
      )
      phase('boot-gate-passed')
      bootSettled = settled
      launchAccount = codexAccountInNow(options.providerHome)
      launchCopy = codexCopyIdentityIn(options.providerHome)
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
    const cancel = cancelWith(options.signal, () => transport.close()) // as in `start` above (070)
    const handle = new CodexSessionHandle(
      transport,
      ref.cwd,
      ref.rotation,
      options.providerHome,
      ref,
      options.approvalMode, // a resumed yolo session keeps its mode (078)
      resolveReasoningEffort(options), // …and the effort it was created with (024)
      // …and whether it was planning (057). The thread's `collaborationMode` is sticky server-side,
      // so a resume that forgot this would leave the thread in plan mode while the session believed
      // it was not — the setting would be invisible AND still in force. Re-sending it per turn is
      // what makes the two agree.
      //
      // ⚠️ **Which is why an APPROVED plan has to survive a resume as its own state** (060). Resume
      // it as `never` and the same stickiness bites in the other direction: nothing re-asserts
      // `default`, the thread is still whatever the last landed turn set, and a conversation the
      // user released could quietly go back to proposing. That is what the second field buys.
      planPhaseOf(options),
      // …and the model it was created with, or last moved to (076). `ProviderRuntimeContext.model`
      // already carried this across a resume; what is new is that the value can have been changed
      // mid-conversation, so the row the host persists is what comes back here.
      options.model,
      // 🔴 **…and the five tools** (348). ⛔ **Carried even though `thread/resume` declares none.**
      // The app-server remembers the DECLARATION; it does not remember how to CALL it, and every
      // `item/tool/call` on the resumed thread is answered by this object. A resume that dropped it
      // would rebuild an inventory the child could see and this app could not answer — which is
      // {@link ProviderRuntimeContext.agentTools}'s *"looks exactly like a model that chose not to
      // use them"*, arriving from the far side.
      options.agentTools,
      // 🔴 **…and the granted external MCP servers, re-read at THIS launch** (605). ⛔ A resume
      // that dropped them would reopen a conversation whose own sheet still shows the grant.
      options.externalMcp,
      // 🔴 **…and the work folders, as they stand at THIS launch** (W4.189) — the same reason, for
      // the grants a person's work gave it.
      options.workFolders,
      memoryConfig,
      options.builtInSkills,
    )
    handle.noteLaunchAccount(launchAccount, launchCopy)
    handle.noteStartPhases(phase)
    try {
      // begin() rejects on a missing thread AND on an explicit post-handshake
      // identity barrier (schema-invalid / empty id / id- or cwd-mismatch), so a
      // malformed-but-non-rejecting resume can no longer masquerade as 'resumed'.
      // …and the MODEL it was created with (038). Previously `undefined`, which let the app-server
      // apply its own configured default to a thread that had deliberately chosen otherwise.
      await handle.begin('resumed', options.model, options.systemHint, bootSettled)
      if (cancel.cancelled) throw new Error('codex resume was cancelled')
      // ⛔ **The one level a RESUME must state, and a start must not** (275, found reviewing this
      // dispatch's own diff). `background_work` is written to the ledger, and a reopened conversation
      // re-folds it — so a Codex session resumed after a relaunch comes back showing rows for
      // processes that died with the previous app-server, each with a Stop beside it. ⚠️ **A fresh
      // `start` has no ledger to replay and is deliberately left alone**: an extra request there
      // would buy a guaranteed empty answer on every session this app opens.
      handle.refreshBackgroundWork()
    } catch (error) {
      await transport.close() // bounded process teardown, no leak, before rejecting
      // 🔴 **673 · an expired sign-in stays what it is** (`663` F6). ⛔ `begin` asks
      // `assertCredentialUsable` inside this try, and every failure used to come out as one causeless
      // `ResumeError` — so *"sign in again"* and *"this thread is gone"* were one type, and a wake
      // (`663`'s `aWakeThatDidNotHappen`) told a parent the conversation could not be brought back
      // when a person's sign-in would have let it through. ⚑ Claude's adapter already rethrows it
      // untouched; these are its two lines. ⚠️ Everything else is still a `ResumeError`, and now
      // carries what it wrapped as `cause`.
      if (error instanceof AuthUnavailableError) throw error
      // 🔴 **706 · …and a thread the app-server says it does not have is MARKED as one** (`705` F-3).
      // ⛔ It carried a cause like every other failure here, and the host forgot only a causeless
      // one — so a lost Codex thread was never let go and every press failed again. ⚑ Read by what
      // the answer IS, and confirmed on disk: {@link codexNoLongerHasTheThread}.
      //
      // 🔴 **D-039 · R2 — …and any other refusal is the provider refusing to start it again**, or its
      // start failing otherwise ({@link aFailedStart}), carried as the cause. ⛔ Not a thread it no
      // longer has: that one keeps the refusal it came with, and the host replaces the conversation
      // (D-017 R10).
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

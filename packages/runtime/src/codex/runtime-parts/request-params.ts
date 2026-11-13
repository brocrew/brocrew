import type { PlanPhase } from '../../next-turn'
export type { PlanPhase } from '../../next-turn'
import type { LaunchSetting } from '../../launch-settings'
import { CODEX_MEMORY_SETTINGS, type CodexMemoryConfigResult } from '../memory-config'
import { withManagedPluginMcp, type ManagedPluginMcpServer } from '../../managed-plugin-mcp'
import {
  isAutoApprove,
  StartFailed,
  StartRefused,
  type AgentInfo,
  type ApprovalMode,
  type ReasoningEffort,
  type StartPhaseSink,
} from '../../runtime'
import type { ExternalMcpReach } from '../../external-mcp'
import { codexExternalMcpConfig } from '../external-mcp'
import type { KeptToolApproval } from '../kept-tool-approvals'
import { CodexExited, CodexRequestRefused } from '../codex-transport'
import type { ClientInfo } from '../protocol/ClientInfo'
import type { CollaborationMode } from '../protocol/CollaborationMode'
import type { InitializeCapabilities } from '../protocol/InitializeCapabilities'
import type { InitializeParams } from '../protocol/InitializeParams'
import type { ReasoningSummary } from '../protocol/ReasoningSummary'
import type { SandboxPolicy } from '../protocol/v2/SandboxPolicy'
import type { ThreadResumeParams } from '../protocol/v2/ThreadResumeParams'
import type { DynamicToolSpec } from '../protocol/v2/DynamicToolSpec'
import type { ThreadStartParams } from '../protocol/v2/ThreadStartParams'
import type { JsonValue } from '../protocol/serde_json/JsonValue'
import type { TurnInterruptParams } from '../protocol/v2/TurnInterruptParams'
import type { TurnStartParams } from '../protocol/v2/TurnStartParams'
import { isRecord } from './wire-values'

const CLIENT_INFO: ClientInfo = { name: 'brobot2', title: null, version: '0.0.0' }
const CAPABILITIES: InitializeCapabilities = { experimentalApi: true, requestAttestation: false }

export function initializeParams(): InitializeParams {
  return { clientInfo: CLIENT_INFO, capabilities: CAPABILITIES }
}

// Keep start, resume, validation and disclosure tests bound to the same native CLI profiles.
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

// Only a complete workspaceWrite echo is evidence about the server sandbox flags.
export function askPolicyOf(value: unknown): WorkspaceWritePolicy | null {
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

// Native workspace-write defaults for an auto session switching to ask before any ask-policy echo.
const WORKSPACE_WRITE_UNSAID: WorkspaceWritePolicy = {
  type: 'workspaceWrite',
  writableRoots: [],
  networkAccess: false,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false,
}

export type WorkspaceWritePolicy = Extract<SandboxPolicy, { type: 'workspaceWrite' }>

// A turn takes a tagged policy; a thread takes its bare mode. Work roots extend only workspace-write.
function sandboxPolicyOf(
  sandbox: 'workspace-write' | 'danger-full-access',
  baseline: WorkspaceWritePolicy | null,
  workRoots: readonly string[],
): SandboxPolicy {
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' }
  const policy = baseline ?? WORKSPACE_WRITE_UNSAID
  return { ...policy, writableRoots: [...new Set([...policy.writableRoots, ...workRoots])] }
}

// Remove all ever-sent work roots from echoes except roots the thread reported before any were sent.
// Match spelling exactly; a launch already carrying work roots has no earlier baseline to distinguish overlaps.
export function askBaselineOf(
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

export function workRootsFor(
  approvalMode: ApprovalMode | undefined,
  folders: readonly string[],
): readonly string[] {
  return approvalProfileFor({ approvalMode }).sandbox === 'workspace-write' ? folders : []
}

export const CODEX_PLAN_TOOL_CONFIG = { 'tools.update_plan.enabled': true } as const

export const CODEX_QUESTION_TOOL_CONFIG = {
  'tools.experimental_request_user_input.enabled': false,
} as const

// Dotted overlay keys change only these leaves for this thread; never write the shared home config.
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

// Dynamic tools are declared only on start. Developer instructions are additive; baseInstructions replaces tool guidance.
export function threadStartParams(
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

// Reporting a launch phase must never throw into the launch it describes.
export function phasesOf(sink: StartPhaseSink | undefined): StartPhaseSink {
  return (phase, detail) => {
    try {
      sink?.(phase, detail)
    } catch {}
  }
}

// Report release once, but always invoke the existing idempotent settlement callback.
export function sayingTheRelease(settled: () => void, phase: StartPhaseSink): () => void {
  let said = false
  return () => {
    if (!said) {
      said = true
      phase('boot-gate-released')
    }
    settled()
  }
}

// Codex retains dynamic tools on resume; re-send the config overlay, not a second declaration.
// excludeTurns avoids loading the full transcript while the provider restores its own model context.
export function threadResumeParams(
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

// An absent effort is distinct from a provider-reported effort; sparse reports set no flag.
export function reportedAgentInfo(
  model: string | undefined,
  effort: string | undefined,
): AgentInfo {
  return {
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { reasoningEffort: effort, reasoningEffortReported: true } : {}),
  }
}

// Keep provider refusals and exited processes distinct; leave errno, cancellation and sign-in errors intact.
export function aFailedStart(error: unknown): unknown {
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
 * What the mode switch really costs: developerInstructions sent at thread/start
 * stop being in force from the switch onwards. Mode settings override model, effort and
 * developer instructions, so the intended settings must agree in both places.
 *
 * This is latent, not live in the app's instruction path: the reason that sentence gives was RE-DERIVED
 * after the retired workspaceSystemHint helper. That name is historical, not a live citation.
 * readSessionInstructions in desktop/providers/codex/instructions.ts returns systemHint: null
 * and puts conversation text in firstTurnLead; threadStartParams omits that absent hint.
 *
 * null developer_instructions lets Codex supply its plan prompt or the default-mode ending.
 * A custom hint would replace those instructions rather than preserve the mode's behavior.
 */
export function collaborationModeFor(
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

// Never-planned sends no mode at all; left-plan must keep undoing the sticky provider plan mode.

export function planPhaseOf(options: { planMode?: unknown; planModeEnded?: unknown }): PlanPhase {
  if (options.planMode !== true) return 'never'
  return options.planModeEnded === true ? 'left' : 'planning'
}

// Adopted settings ride this turn together. Omitted model/effort preserve the provider default.
// A reported model may fill the required collaboration-mode model, but must not become a requested model here.
export function turnStartParams(
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

// Without an explicit detailed summary, Codex can produce empty reasoning summary items.
const REASONING_SUMMARY: ReasoningSummary = 'detailed'

export function turnInterruptParams(threadId: string, turnId: string): TurnInterruptParams {
  return { threadId, turnId }
}

// Validate the complete native profile for each mode, including its reviewer and sandbox.
export function approvalProfileProblems(
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

export function sandboxTypeOf(value: unknown): unknown {
  return isRecord(value) ? value['type'] : value
}

// Show the exact overlay and MCP server names, preserving the original frozen disclosure arrays.
export function launchSettingsFor(
  params: ThreadStartParams | ThreadResumeParams,
  memoryConfig: CodexMemoryConfigResult | undefined,
  planPhase: PlanPhase,
  approvalMode: ApprovalMode,
  toolsTurnedOff: readonly string[],
  toolsLeftOn: readonly string[],
): readonly LaunchSetting[] {
  const config = params.config ?? {}
  const overrides = Object.entries(config).map(([key, value]) => {
    const shown =
      key === 'mcp_servers' && value !== null && typeof value === 'object'
        ? Object.keys(value)
        : value
    return `${key}=${JSON.stringify(shown)}`
  })
  const memoryKnown = memoryConfig?.outcome === 'written' || memoryConfig?.outcome === 'unchanged'
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
    { key: 'collaboration-mode', value: planPhase === 'planning' ? 'plan' : 'default' },
    { key: 'approval', value: approvalMode },
    {
      key: 'tools-off',
      value:
        config['tools.experimental_request_user_input.enabled'] === false
          ? [...toolsTurnedOff]
          : [],
    },
    { key: 'tools-left-on', value: [...toolsLeftOn] },
  ]
  return Object.freeze(
    settings.map((one) =>
      Object.freeze({
        ...one,
        value: Array.isArray(one.value) ? Object.freeze(one.value) : one.value,
      }),
    ),
  )
}

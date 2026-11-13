import type { ApprovalMode } from '../../runtime'
import { StartFailed } from '../../runtime'
import type { SessionRef } from '../../session-ref'
import type { AgentToolset } from '../../agent-tools'
import type { ExternalMcpReach } from '../../external-mcp'
import type { ManagedPluginMcpServer } from '../../managed-plugin-mcp'
import type { McpCallsInFlight } from '../external-mcp'
import { codexDynamicToolsFor } from '../agent-tools'
import { keptToolApprovals } from '../kept-tool-approvals'
import {
  approvalProfileProblems,
  sandboxTypeOf,
  threadStartParams,
  threadResumeParams,
} from './request-params'

// Preserve the differing wire options: only a fresh thread declares dynamic tools.
export function openingParams(
  opening: 'started' | 'resumed',
  targetRef: SessionRef | null,
  cwd: string,
  model: string | undefined,
  systemHint: string | undefined,
  approvalMode: ApprovalMode,
  agentTools: AgentToolset | undefined,
  externalMcp: ExternalMcpReach | undefined,
  kept: ReturnType<typeof keptToolApprovals>,
  workRoots: readonly string[],
  managedPluginMcp: readonly ManagedPluginMcpServer[] | undefined,
) {
  return opening === 'started'
    ? threadStartParams(
        cwd,
        model,
        systemHint,
        approvalMode,
        codexDynamicToolsFor(agentTools),
        externalMcp,
        kept,
        workRoots,
        managedPluginMcp,
      )
    : threadResumeParams(
        targetRef!.sessionId,
        cwd,
        approvalMode,
        model,
        externalMcp,
        systemHint,
        kept,
        workRoots,
        managedPluginMcp,
      )
}

export function assertPromptingProfile(
  response: Record<string, unknown>,
  approvalMode: ApprovalMode,
): void {
  const problems = approvalProfileProblems(
    response['approvalsReviewer'],
    response['approvalPolicy'],
    sandboxTypeOf(response['sandbox']),
    approvalMode,
  )
  if (problems.length > 0) {
    throw new StartFailed(
      `codex did not honor the prompting approval profile: ${problems.join('; ')}`,
    )
  }
}

// Rehydrate only grants whose endpoint still matches a declaration on this launch.
export function grantKeptTools(
  kept: ReturnType<typeof keptToolApprovals>,
  externalMcp: ExternalMcpReach | undefined,
  mcpCalls: McpCallsInFlight,
): void {
  for (const approval of kept) {
    const declared = externalMcp?.servers.some(
      (one) => one.name === approval.server && one.url === approval.url,
    )
    if (declared === true) mcpCalls.grant(approval.server, approval.tool)
  }
}

import { AuthUnavailableError, type AuthHealth } from '../../internal/auth'

export function assertAuthHealthy(
  providerHome: string,
  authHealth: ((providerHome: string) => AuthHealth) | undefined,
): void {
  if (!authHealth) return
  const health = authHealth(providerHome)
  if (!health.ok) {
    throw new AuthUnavailableError('codex', health.reason ?? 'managed Codex credential unavailable')
  }
}

import type { CodexTransport } from '../codex-transport'
import { probeCodexAuth } from '../auth-probe'
import { withDeadline } from '../../internal/bounded'
import { readString } from './wire-values'
import { COMMAND_LIST_TIMEOUT_MS } from './turn-state'

export async function logInWithCodexKey(transport: CodexTransport, apiKey: string): Promise<void> {
  const response = await withDeadline(
    transport.request('account/login/start', { type: 'apiKey', apiKey }),
    COMMAND_LIST_TIMEOUT_MS,
    'codex key login',
  )
  if (readString(response, 'type') !== 'apiKey')
    throw new AuthUnavailableError('codex', 'Codex did not accept the selected API-key mode')
  const state = await withDeadline(
    probeCodexAuth(transport),
    COMMAND_LIST_TIMEOUT_MS,
    'codex key auth',
  )
  if (state.state !== 'usable' || state.login !== 'api-key')
    throw new AuthUnavailableError('codex', 'Codex did not start with the selected API key')
}

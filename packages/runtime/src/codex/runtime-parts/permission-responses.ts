import type { PermissionDecision, UserInputResponse } from '../../permission'
import { AnswerRefused } from '../../answer-refused'
import type { ExternalMcpReach } from '../../external-mcp'
import type { RequestBroker } from '../../internal/request-broker'
import type { SessionMachine } from '../../internal/session-machine'
import type { McpCallsInFlight } from '../external-mcp'
import { keepToolApproval, keptToolApprovalsFile } from '../kept-tool-approvals'
import type { CommandExecutionApprovalDecision } from '../protocol/v2/CommandExecutionApprovalDecision'
import {
  permissionAnswerState,
  elicitationAnswer,
  codexDecision,
  A_TOOLS_SESSION_GRANT,
  type RequestState,
} from './server-requests'
import { errorMessage } from './wire-values'

// Validate and keep standing grants before spending; a failed persistence write leaves the card open.
export function answerPermission(
  id: string,
  decision: PermissionDecision,
  requestStates: Map<string, RequestState>,
  permissions: RequestBroker<PermissionDecision>,
  machine: SessionMachine,
  providerHome: string,
  externalMcp: ExternalMcpReach | undefined,
  mcpCalls: McpCallsInFlight,
  answer: (rawId: string | number, payload: unknown) => void,
): void {
  const state = permissionAnswerState(requestStates.get(id), id, decision)
  if (decision.outcome === 'cancel' && state.kind.kind !== 'elicitation') {
    machine.requestInterrupt()
  }
  if (state.kind.kind === 'agentTool') {
    permissions.respond(id, decision)
    return
  }
  // Keep the standing rule before answering; a failed write leaves the card pending.
  if (state.approvesATool !== undefined && decision.outcome === 'allow_always') {
    const { serverName, tool } = state.approvesATool
    try {
      const url = externalMcp?.servers.find((one) => one.name === serverName)?.url
      if (url === undefined) throw new Error('this conversation declared no such server')
      keepToolApproval(providerHome, { server: serverName, url, tool })
    } catch (error) {
      throw new AnswerRefused(
        'not-kept',
        `could not keep "always" for ${serverName}/${tool} in ${keptToolApprovalsFile(providerHome)}: ${errorMessage(error)}`,
      )
    }
  }
  const payload =
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
  // The wire write and spent transition are one synchronous operation.
  answer(state.rawId, payload)
  if (state.approvesATool !== undefined && decision.outcome === A_TOOLS_SESSION_GRANT) {
    mcpCalls.grant(state.approvesATool.serverName, state.approvesATool.tool)
  }
  if (state.approvesATool !== undefined && decision.outcome === 'allow_always') {
    mcpCalls.grant(state.approvesATool.serverName, state.approvesATool.tool)
  }
  permissions.respond(id, decision)
}

// A rejected or unrepresentable answer does not consume the broker reservation.
export function answerUserInput(
  id: string,
  response: UserInputResponse,
  requestStates: Map<string, RequestState>,
  userInputs: RequestBroker<UserInputResponse>,
  answer: (rawId: string | number, payload: unknown) => void,
): void {
  const state = requestStates.get(id)
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
  answer(state.rawId, forwarded.payload)
  userInputs.respond(id, response)
}

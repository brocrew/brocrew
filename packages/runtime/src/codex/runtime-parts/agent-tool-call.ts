import { beyondItsRailsOf, type AgentToolAnswer, type AgentToolset } from '../../agent-tools'
import type { RuntimeEvent } from '../../events'
import type { RequestBroker } from '../../internal/request-broker'
import type { SessionMachine } from '../../internal/session-machine'
import type { MessageActCalls } from '../../message-act'
import type { PermissionDecision, PermissionOutcome } from '../../permission'
import { isAutoApprove, type ApprovalMode } from '../../runtime'
import { answerCodexToolCall } from '../agent-tools'
import { coreApprovalDeadline, CORE_APPROVAL_TIMEOUT } from '../core-tool-deadline'
import { agentToolCard } from './request-cards'
import { codexToolCall, declinedToolCall, safeRefusal, type RequestState } from './server-requests'
import type { CodexTurn } from './turn-state'
import { requestKey, readString } from './wire-values'

export interface AgentCallContext {
  readonly tools: AgentToolset | undefined
  readonly cwd: string
  readonly states: Map<string, RequestState>
  readonly permissions: RequestBroker<PermissionDecision>
  readonly machine: SessionMachine
  isShuttingDown(): boolean
  turn(): CodexTurn | null
  calls(): MessageActCalls | undefined
  mode(): ApprovalMode
  emit(event: RuntimeEvent): void
  respond(id: string | number, value: unknown): void
  track(task: Promise<void>): void
  stopTurn(id: string): Promise<void>
}

// Legacy dynamic calls and the owned MCP endpoint share this argument-sensitive approval floor.
export async function handleAgentToolCall(
  context: AgentCallContext,
  id: string | number,
  params: unknown,
  options: {
    reply?: (value: unknown) => void
    signal?: AbortSignal
    execute?: typeof answerCodexToolCall
  } = {},
): Promise<void> {
  const { signal } = options
  const reply = options.reply ?? ((value) => context.respond(id, value))
  const execute = options.execute ?? answerCodexToolCall
  if (context.isShuttingDown() || signal?.aborted) {
    reply(safeRefusal({ kind: 'agentTool' }))
    return
  }
  const call = codexToolCall(params)
  if (call === null) {
    reply(safeRefusal({ kind: 'agentTool' }))
    return
  }
  const turn = context.turn()
  const calls = context.calls()
  const callId = call.callId ?? ''
  const owned =
    call.tool === 'message_agent' &&
    context.tools?.tools.some((one) => one.name === call.tool) === true &&
    (call.namespace === null || call.namespace === context.tools.server)
  const messageClaim = calls?.claim(callId, turn?.providerTurnId ?? '', owned)
  const state = context.states.get(requestKey(id))
  if (state?.phase === 'claimed' && messageClaim !== undefined) state.messageCallId = callId
  const completed = (answer: AgentToolAnswer): void => {
    if (context.isShuttingDown() || context.turn() !== turn) return
    calls?.remember(callId, messageClaim, answer.structured)
  }
  if (isAutoApprove({ approvalMode: context.mode() })) {
    reply(await execute(context.tools, call, completed))
    return
  }
  const offered = context.tools?.tools.find((one) => one.name === call.tool)
  if (
    offered !== undefined &&
    beyondItsRailsOf(offered, call.arguments) === 'nothing-its-rails-do-not-cover'
  ) {
    reply(await execute(context.tools, call, completed))
    return
  }
  const deadline = signal === undefined ? undefined : coreApprovalDeadline(signal)
  const reservation = context.permissions.reserve(requestKey(id), deadline?.signal)
  if (!reservation.accepted) {
    deadline?.clear()
    reply(safeRefusal({ kind: 'agentTool' }))
    return
  }
  const claimed = context.states.get(requestKey(id))
  if (claimed?.phase === 'claimed') claimed.allowed = new Set<PermissionOutcome>(['allow', 'deny'])
  context.emit(agentToolCard(id, call, context.cwd))
  context.machine.beginWait()
  const decision = await reservation.response.finally(() => deadline?.clear())
  if (context.isShuttingDown() || context.turn() !== turn) {
    context.machine.abandonWait()
    reply(safeRefusal({ kind: 'agentTool' }))
    return
  }
  context.machine.endWait()
  if (deadline?.timedOut()) {
    reply({ contentItems: [{ type: 'inputText', text: CORE_APPROVAL_TIMEOUT }], success: false })
    return
  }
  if (signal?.aborted) {
    reply(safeRefusal({ kind: 'agentTool' }))
    return
  }
  if (decision.outcome !== 'allow') {
    reply(declinedToolCall(call.tool))
    if (decision.outcome === 'cancel') await context.stopTurn(readString(params, 'turnId'))
    return
  }
  reply(await execute(context.tools, call, completed))
}

import type { PermissionDecision, UserInputResponse } from '../../permission'
import { duplicateAnswerKey, unanswerableOptionLabel } from '../../permission'
import type { RequestBroker } from '../../internal/request-broker'
import type { ApprovalModeSwitch } from '../../approval-mode'
import type { PatchTargets } from '../patch-targets'
import type { RuntimeEvent } from '../../events'
import { approvalDetails, approvalCard, userInputCard } from './request-cards'
import {
  codexQuestions,
  hasUndeliverableQuestionId,
  THE_AGENT_ASKS_FOR_ACCESS,
  questionText,
  userInputPayloadFor,
  type RequestState,
} from './server-requests'
import { requestKey } from './wire-values'

// Validate questions before reserving, and install their writer before emitting the actionable card.
export function prepareUserInputRequest(
  id: string | number,
  method: string,
  params: unknown,
  userInputs: RequestBroker<UserInputResponse>,
  requestStates: Map<string, RequestState>,
  emit: (event: RuntimeEvent) => void,
) {
  const isPermission = method === 'item/permissions/requestApproval'
  if (!isPermission && codexQuestions(params).length === 0) {
    return null
  }
  if (!isPermission && duplicateAnswerKey(codexQuestions(params), (q) => q.id) !== null) {
    return null
  }
  // Keep this after duplicate detection: positional keys can collide with explicit keys.
  if (!isPermission && hasUndeliverableQuestionId(params)) {
    return null
  }
  if (!isPermission && unanswerableOptionLabel(codexQuestions(params)) !== null) {
    return null
  }
  const prompt = isPermission ? THE_AGENT_ASKS_FOR_ACCESS : questionText(params) || method
  const reservation = userInputs.reserve(requestKey(id))
  if (!reservation.accepted) {
    return null
  }
  const claimed = requestStates.get(requestKey(id))
  if (claimed?.phase === 'claimed') {
    claimed.userInputPayload = (response) => userInputPayloadFor(isPermission, params, response)
  }
  emit(userInputCard(id, isPermission, prompt, params))
  return reservation
}

// Disclosure precedes reservation, and grant metadata precedes publication.
export function prepareApprovalRequest(
  id: string | number,
  kind: 'command' | 'file',
  params: unknown,
  patches: PatchTargets,
  providerHome: string,
  permissions: RequestBroker<PermissionDecision>,
  requestStates: Map<string, RequestState>,
  approvals: ApprovalModeSwitch,
  emit: (event: RuntimeEvent) => void,
) {
  const targets = kind === 'file' ? patches.for(params) : []
  const details = approvalDetails(kind, params, targets, providerHome)
  const { allowed, alwaysAnswer } = details
  const reservation = permissions.reserve(requestKey(id))
  if (!reservation.accepted) {
    return null
  }
  const claimed = requestStates.get(requestKey(id))
  if (claimed?.phase === 'claimed') {
    claimed.allowed = allowed
    if (alwaysAnswer !== undefined) claimed.alwaysAnswer = alwaysAnswer
  }
  emit(approvalCard(id, kind, approvals.effective, details))
  return reservation
}

import { isAutoApprove } from '../../runtime'

import {
  commandScope,
  aToolApprovalCard,
  codexQuestions,
  codexUserPermission,
  theModelWroteTheReason,
  thePolicysWords,
  fileScope,
  fileDetail,
  CODEX_EXEC_POLICY_RULES,
} from './server-requests'
import { isRecord, readString, readOptionalString, requestKey } from './wire-values'

import { join } from 'node:path'

import {
  codexElicitation,
  elicitationQuestions,
  externalMcpElicitationPrompt,
  serverAsks,
  type ClaimedToolApproval,
} from '../external-mcp'

import { boundPermissionDetail, type RuntimeEvent } from '../../events'
import { wordsForACard } from '../../words-on-a-card'
import { persistenceOf, publishedOffer, type PermissionOutcome } from '../../permission'

import type { CodexToolCall } from '../agent-tools'
import type { PatchTarget } from '../patch-targets'

// Disclose what approval authorizes. Keep model reasons and provider rule text under their own authors.
export function approvalDetails(
  kind: 'command' | 'file',
  params: unknown,
  targets: readonly PatchTarget[],
  providerHome: string,
) {
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
    scope.grants.alwaysFile = join(providerHome, CODEX_EXEC_POLICY_RULES)
  }
  return { action, detail, summary, agentReason, policysWords, scope, allowed, alwaysAnswer }
}

export function agentToolCard(id: string | number, call: CodexToolCall, cwd: string): RuntimeEvent {
  return {
    type: 'permission_request',
    id: requestKey(id),
    kind: 'command',
    action: call.tool,
    ...boundPermissionDetail(`${call.tool} ${JSON.stringify(call.arguments)}`),
    scope: {
      cwd: cwd,
      paths: [],
      networkHosts: [],
      persistence: persistenceOf(['allow']),
      amendments: [],
      availableDecisions: publishedOffer(['allow']),
      underDisclosed: false,
      approvalMode: 'ask',
    },
  }
}

// isBlocking is reported data; the native request still waits for its answer in either case.
export function userInputCard(
  id: string | number,
  isPermission: boolean,
  prompt: string,
  params: unknown,
): RuntimeEvent {
  return isPermission
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
      }
}

// Keep Codex's claimed-tool approval distinct from the server's own form or link.
// Unsupported forms remain answerable through refusals, with the unrepresentable positive stated explicitly.
export function elicitationCard(
  id: string | number,
  elicitation: NonNullable<ReturnType<typeof codexElicitation>>,
  askable: boolean,
  toolApproval: ClaimedToolApproval | null,
  approvalMode: 'ask' | 'auto',
  providerHome: string,
  offer: PermissionOutcome[],
  confirmsAServersForm: boolean,
  showsALink: boolean,
  cancelStopsNothing: { cancelStopsNothing: true },
): RuntimeEvent {
  return askable
    ? {
        type: 'user_input_request',
        id: requestKey(id),
        prompt: externalMcpElicitationPrompt(elicitation),
        questions: elicitationQuestions(elicitation),
        mcpServerAsks: serverAsks(elicitation),
      }
    : toolApproval !== null
      ? {
          ...aToolApprovalCard(requestKey(id), toolApproval, approvalMode, providerHome),
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
        }
}

export function approvalCard(
  id: string | number,
  kind: 'command' | 'file',
  approvalMode: 'ask' | 'auto',
  details: ReturnType<typeof approvalDetails>,
): RuntimeEvent {
  const { action, detail, summary, agentReason, policysWords, scope } = details
  return {
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
      approvalMode: isAutoApprove({ approvalMode: approvalMode }) ? 'auto' : 'ask',
    },
  }
}

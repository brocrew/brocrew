import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type {
  PersonsDecision,
  PersonsQuestion,
  RequestOnlyAPersonCanSettle,
  RoutedRequest,
} from '../../src/shared/question-contracts'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
} from '../../src/shared/questions'

export function routedProviderQuestion(
  request: RoutedRequest,
  name: (sessionId: string) => string,
  openQuestionOf: (sessionId: string) => RoutedRequest | null = () => null,
): PersonsQuestion {
  const chain = escalationChain(request, openQuestionOf)
  return {
    request,
    chain,
    aPersonsSince: aPersonsSince(request),
    reading: chainReading(chain, name),
    sentence: chainSentence(chain, name),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy: 'the-provider',
    offered: null,
    asked: null,
  }
}

export function routedPermission(
  askedBy: string,
  requestId: string,
  at: number,
  parent: string,
): RequestOnlyAPersonCanSettle {
  return {
    askedBy,
    requestId,
    parent,
    at,
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
}

export function permissionDecisionRow(
  request: RequestOnlyAPersonCanSettle,
  name: (sessionId: string) => string,
  says = 'a command or file approval, which is a person’s to give',
): PersonsDecision {
  const reading = decisionReading(request.askedBy, name)
  return { request, reading, sentence: readingSentence(reading), says, work: [] }
}

/** Supply held permissions on the same queue used by the real waiting screen. */
export function supplyPermissionQueue(requests: readonly AttentionRequest[], now: number) {
  const name = (sessionId: string): string => sessionId
  const rows = requests.map(({ sessionId, requestId }) =>
    permissionDecisionRow(
      routedPermission(sessionId, requestId, now - 1_000, 'sess_parent'),
      name,
      'something only a person can settle',
    ),
  )
  const queue = usePersonsQueue()
  queue.supply(
    null,
    { rows, walk: 'every-conversation-that-routed', ledgers: rows.length, rowsUnread: 0 },
    {
      held: new Set(requests.map(({ sessionId }) => sessionId)),
      answerable: new Map(requests.map((request) => [request.key, request])),
      answeredFromHere: new Set(),
      now,
      lastLookAnswered: { questions: true, decisions: true },
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
  )
  return queue.view.value?.rows ?? []
}

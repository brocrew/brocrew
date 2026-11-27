import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue, type PersonsQueueWorld } from '../../src/renderer/src/lib/persons-queue'
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

/** The world a persons queue is folded in when a test says nothing about it: nothing held, every look answered. */
export function personsQueueWorld(over: Partial<PersonsQueueWorld> = {}): PersonsQueueWorld {
  return {
    held: new Set<string>(),
    answerable: new Map<string, AttentionRequest>(),
    now: 91_000,
    lastLookAnswered: { questions: true, decisions: true },
    answeredFromHere: new Set<string>(),
    ...over,
  }
}

/** A request its asker addressed to a person, as the fixtures of the persons queue plant one. */
export function askedOfAPerson(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): RoutedRequest {
  return {
    parent: 'sess_pm',
    went: { is: 'the-person-the-asker-named', to: 'a-person' },
    at: 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
    ...over,
  }
}

/** A request its asker put to its parent, escalated to a person. */
export function askedOfTheParent(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): RoutedRequest {
  return {
    parent: 'sess_pm',
    went: { is: 'the-parent', to: 'the-parent' },
    at: 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: 31_000,
    ...over,
  }
}

/** What a test may vary on a provider's question; every other field is the same in every copy. */
export type ProviderQuestionOverrides = {
  [Field in 'work' | 'about' | 'raisedBy' | 'offered' | 'asked' | 'action']?:
    PersonsQuestion[Field] | undefined
}

export function routedProviderQuestion(
  request: RoutedRequest,
  name: (sessionId: string) => string,
  openQuestionOf: (sessionId: string) => RoutedRequest | null = () => null,
  over: ProviderQuestionOverrides = {},
): PersonsQuestion {
  const chain = escalationChain(request, openQuestionOf)
  return {
    request,
    chain,
    aPersonsSince: aPersonsSince(request),
    reading: chainReading(chain, name),
    sentence: chainSentence(chain, name),
    work: over.work ?? [],
    about: over.about ?? NOTHING_NAMED_THE_WORK,
    raisedBy: over.raisedBy ?? 'the-provider',
    offered: over.offered ?? null,
    asked: over.asked ?? null,
    ...(over.action ? { action: over.action } : {}),
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

import type { MoveOffer, MoveReceipt, MoveRequestAck } from '../../shared/move-contracts'
import type { HandedPath } from '../../shared/attachment-contracts'
import type { UserTurnEvent } from '../../shared/human-answer-contracts'
import type { QueuedMessageEvent, UserDecisionEvent } from '../../shared/conversation-events'
import type { ActedBy } from '../../shared/who-did-it'
import type { SessionStore, PersistedEvent } from '../db/session-store'
import { REQUEST_IS_OPEN, aPersonsSince } from '../../shared/questions'
import { MOVE_WORDS, moveReceiptLine } from '../../shared/move-request'
import { conversationLink } from '../../shared/links'
import { TURN_ATTRIBUTION_KEYS, type RuntimeEventMessage } from '../../shared/runtime-ipc'

export function originalMoveRequest(
  store: SessionStore,
  sessionId: string,
  turn?: string | number,
): (PersistedEvent & { event: UserTurnEvent }) | null {
  const conversation = store.recordedOne(sessionId)
  if (conversation === null || conversation.foundInUserHome || conversation.restoredFromBundle)
    return null
  const row =
    typeof turn === 'string'
      ? store.recordedTurnMessage(sessionId, turn)
      : turn === undefined
        ? (store.newestOfType?.(sessionId, 'user_turn') ?? null)
        : (store.eventsFrom(sessionId, turn, 1)[0] ?? null)
  if (
    row === null ||
    row.event.type !== 'user_turn' ||
    (typeof turn === 'number' && row.ordinal !== turn)
  )
    return null
  const event = row.event
  if (
    event.parts !== undefined ||
    TURN_ATTRIBUTION_KEYS.some((key) => key !== 'movedFrom' && event[key] !== undefined)
  )
    return null
  return row as PersistedEvent & { event: UserTurnEvent }
}

function moveOffersForTurn(store: SessionStore, source: string, offered: MoveOffer): string[] {
  const original = originalMoveRequest(store, source, offered.sourceTurnId ?? offered.sourceOrdinal)
  if (original === null) return []
  const offers: string[] = []
  for (const [id, question] of store.questionsRaisedIn(source)) {
    const move = question.move
    if (move === undefined) continue
    const sameTurn =
      move.sourceTurnId !== undefined && offered.sourceTurnId !== undefined
        ? move.sourceTurnId === offered.sourceTurnId
        : (move.sourceOrdinal ?? originalMoveRequest(store, source, move.sourceTurnId)?.ordinal) ===
          original.ordinal
    if (sameTurn) offers.push(id)
  }
  return offers
}

type MoveDecision = Exclude<MoveRequestAck, { outcome: 'refused' }>

export function previousMoveDecision(
  store: SessionStore,
  source: string,
  offer: MoveOffer,
): MoveDecision | null {
  for (const id of moveOffersForTurn(store, source, offer)) {
    const decision = store.theDecisionOn(source, id)
    if (decision?.by?.who !== 'a-person') continue
    if (decision.movedTo !== undefined) return { outcome: 'moved', ...decision.movedTo }
    if (decision.outcome === 'answered') return { outcome: 'here' }
  }
  return null
}

export function moveOfferDecisions(
  store: SessionStore,
  source: string,
  requestId: string,
  offer: MoveOffer,
  by: ActedBy,
  movedTo?: MoveReceipt,
): UserDecisionEvent[] {
  return [
    {
      type: 'user_decision',
      requestId,
      outcome: 'answered',
      by,
      ...(movedTo === undefined ? {} : { movedTo }),
    },
    ...rejectOpenMoveOffersForTurn(store, source, offer, by, requestId),
  ]
}

export function rejectOpenMoveOffersForTurn(
  store: SessionStore,
  source: string,
  offer: MoveOffer,
  by: ActedBy,
  except?: string,
): UserDecisionEvent[] {
  const offers = new Set(moveOffersForTurn(store, source, offer))
  return store
    .routedRequestsOf(source)
    .flatMap((request) =>
      request.requestId !== except &&
      offers.has(request.requestId) &&
      REQUEST_IS_OPEN[request.state]
        ? [{ type: 'user_decision', requestId: request.requestId, outcome: 'rejected', by }]
        : [],
    )
}

/** Accept the target queue entry and source decision together, before dispatch. */
export function recordMovedRequest(
  store: SessionStore,
  source: string,
  requestId: string,
  offer: MoveOffer,
  sourceName: string,
  attachments: readonly HandedPath[],
  by: ActedBy,
  at: number,
  forNextStart = true,
  destinationTitle = offer.destinationName,
): { decision: MoveDecision; entries: RuntimeEventMessage[]; queued: QueuedMessageEvent | null } {
  return store.atomically(() => {
    if (by.who !== 'a-person') throw new Error(MOVE_WORDS.personOnly)
    const bound = store.questionsRaisedIn(source).get(requestId)?.move
    if (
      bound === undefined ||
      bound.destination !== offer.destination ||
      bound.sourceOrdinal !== offer.sourceOrdinal ||
      bound.sourceTurnId !== offer.sourceTurnId ||
      source === offer.destination
    )
      throw new Error(MOVE_WORDS.ended)
    const previous = previousMoveDecision(store, source, offer)
    if (previous !== null) return { decision: previous, entries: [], queued: null }
    const requests = store.routedRequestsOf(source)
    const question = requests.find((one) => one.requestId === requestId)
    if (
      question === undefined ||
      !REQUEST_IS_OPEN[question.state] ||
      aPersonsSince(question) === null
    )
      throw new Error(MOVE_WORDS.ended)
    const original = originalMoveRequest(store, source, offer.sourceTurnId ?? offer.sourceOrdinal)
    if (original === null) throw new Error(MOVE_WORDS.noOriginal)
    const messageId = `move-${source}-${requestId}`
    const destinationLink = conversationLink(offer.destination, destinationTitle)
    const receipt = {
      sessionId: offer.destination,
      messageId,
      destinationLink,
      receiptLine: moveReceiptLine(destinationLink),
    }
    const queued: QueuedMessageEvent = {
      type: 'message_queued',
      messageId,
      kind: 'work',
      text: original.event.text,
      ...(attachments.length === 0 ? {} : { attachments: [...attachments] }),
      movedFrom: { sessionId: source, name: sourceName, ordinal: original.ordinal, requestId },
      ...(forNextStart ? { forItsNextStart: true as const } : {}),
    }
    const ordinal = store.nextOrdinal(source)
    const entries: RuntimeEventMessage[] = [
      {
        sessionId: offer.destination,
        ordinal: store.nextOrdinal(offer.destination),
        at,
        event: queued,
      },
      ...moveOfferDecisions(store, source, requestId, offer, by, receipt).map((event, index) => ({
        sessionId: source,
        ordinal: ordinal + index,
        at,
        event,
      })),
    ]
    for (const entry of entries) store.append(entry.sessionId, entry.ordinal, entry.event, at)
    return { decision: { outcome: 'moved', ...receipt }, entries, queued }
  })
}

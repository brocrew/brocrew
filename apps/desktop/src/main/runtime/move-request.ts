import type { MoveOffer, MoveReceipt } from '../../shared/move-contracts'
import type { HandedPath } from '../../shared/attachment-contracts'
import type { UserTurnEvent } from '../../shared/human-answer-contracts'
import type { QueuedMessageEvent } from '../../shared/conversation-events'
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
): { receipt: MoveReceipt; entries: RuntimeEventMessage[]; queued: QueuedMessageEvent | null } {
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
    const decision = store.theDecisionOn(source, requestId)
    if (decision?.by?.who === 'a-person' && decision.movedTo !== undefined)
      return { receipt: decision.movedTo, entries: [], queued: null }
    const question = store.routedRequestsOf(source).find((one) => one.requestId === requestId)
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
    const entries: RuntimeEventMessage[] = [
      {
        sessionId: offer.destination,
        ordinal: store.nextOrdinal(offer.destination),
        at,
        event: queued,
      },
      {
        sessionId: source,
        ordinal: store.nextOrdinal(source),
        at,
        event: { type: 'user_decision', requestId, outcome: 'answered', by, movedTo: receipt },
      },
    ]
    for (const entry of entries) store.append(entry.sessionId, entry.ordinal, entry.event, at)
    return { receipt, entries, queued }
  })
}

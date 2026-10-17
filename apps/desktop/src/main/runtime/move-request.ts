import { createHash } from 'node:crypto'
import type { ActedBy } from '../../shared/who-did-it'
import type { SessionStore, PersistedEvent } from '../db/session-store'
import { REQUEST_IS_OPEN, aPersonsSince } from '../../shared/questions'
import {
  MOVE_WORDS,
  moveReceiptLine,
  type MoveOffer,
  type MoveReceipt,
} from '../../shared/move-request'
import { conversationLink } from '../../shared/links'
import {
  TURN_AUTHORSHIP_KEYS,
  type HandedPath,
  type RuntimeEventMessage,
  type UserTurnEvent,
  type QueuedMessageEvent,
} from '../../shared/runtime-ipc'

export function moveRequestDigest(row: PersistedEvent & { event: UserTurnEvent }): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        at: row.at,
        text: row.event.text,
        attachments: row.event.attachments ?? [],
        movedFrom: row.event.movedFrom ?? null,
      }),
    )
    .digest('hex')
}

export function originalMoveRequest(
  store: SessionStore,
  sessionId: string,
  ordinal?: number,
): (PersistedEvent & { event: UserTurnEvent }) | null {
  const conversation = store.recordedOne(sessionId)
  if (conversation === null || conversation.foundInUserHome || conversation.restoredFromBundle)
    return null
  const row =
    ordinal === undefined
      ? (store.newestOfType?.(sessionId, 'user_turn') ?? null)
      : (store.eventsFrom(sessionId, ordinal, 1)[0] ?? null)
  if (
    row === null ||
    row.event.type !== 'user_turn' ||
    (ordinal !== undefined && row.ordinal !== ordinal)
  )
    return null
  const event = row.event
  if (
    event.parts !== undefined ||
    TURN_AUTHORSHIP_KEYS.some((key) => key !== 'movedFrom' && event[key] !== undefined)
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
      bound.sourceGeneration !== offer.sourceGeneration ||
      bound.sourceDigest !== offer.sourceDigest ||
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
    const original = originalMoveRequest(store, source, offer.sourceOrdinal)
    if (
      original === null ||
      store.generationOf?.(source) !== offer.sourceGeneration ||
      moveRequestDigest(original) !== offer.sourceDigest
    )
      throw new Error(MOVE_WORDS.noOriginal)
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

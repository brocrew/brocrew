import { linkTargetId } from './links'

export interface MoveOffer {
  readonly destination: string
  readonly destinationName: string
  readonly sourceOrdinal: number
  readonly sourceGeneration: number
  readonly sourceDigest: string
}

export interface MoveOrigin {
  readonly sessionId: string
  readonly name: string
  readonly ordinal: number
  readonly requestId: string
}

export interface MoveReceipt {
  readonly sessionId: string
  readonly messageId: string
  /** Absent on receipts recorded before destination links were kept. */
  readonly destinationLink?: string
  readonly receiptLine?: string
}

export interface DecideMoveRequestInput {
  readonly sessionId: string
  readonly requestId: string
  readonly decision: 'move' | 'here'
}

export type MoveRequestAck =
  | ({ readonly outcome: 'moved' } & MoveReceipt)
  | { readonly outcome: 'here' }
  | { readonly outcome: 'refused'; readonly reason: string }

export const MOVE_IT = 'Move it'
export const DO_IT_HERE = 'Do it here'
export const MOVE_WORDS = {
  personOnly: 'Only the person can move a request.',
  noOriginal: 'There is no request from the person to move.',
  unavailable: 'That conversation is unavailable. Nothing was moved.',
  shape: 'A move offer must go to a person, with no options or agent.',
  hereAlready: 'That is this conversation. Nothing was moved.',
  ended: 'This move offer has ended. Nothing was moved.',
  notRecorded: 'The move could not be recorded. Nothing was moved.',
} as const

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const name = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200
const label = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1280
const ordinal = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function moveOfferOf(value: unknown): MoveOffer | undefined {
  if (
    !record(value) ||
    !name(value.destination) ||
    !label(value.destinationName) ||
    !ordinal(value.sourceOrdinal) ||
    !ordinal(value.sourceGeneration) ||
    typeof value.sourceDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sourceDigest)
  )
    return undefined
  return {
    destination: value.destination,
    destinationName: value.destinationName,
    sourceOrdinal: value.sourceOrdinal,
    sourceGeneration: value.sourceGeneration,
    sourceDigest: value.sourceDigest,
  }
}

export function moveOriginOf(value: unknown): MoveOrigin | undefined {
  if (
    !record(value) ||
    !name(value.sessionId) ||
    !label(value.name) ||
    !ordinal(value.ordinal) ||
    !name(value.requestId)
  )
    return undefined
  return {
    sessionId: value.sessionId,
    name: value.name,
    ordinal: value.ordinal,
    requestId: value.requestId,
  }
}

export function moveReceiptOf(value: unknown): MoveReceipt | undefined {
  if (!record(value) || !name(value.sessionId) || !name(value.messageId)) return undefined
  const receipt = { sessionId: value.sessionId, messageId: value.messageId }
  if (!label(value.destinationLink)) return receipt
  try {
    if (
      !value.destinationLink.startsWith('[') ||
      !value.destinationLink.endsWith(
        `](brocrew://conversation/${linkTargetId(value.sessionId)})`,
      ) ||
      value.receiptLine !== moveReceiptLine(value.destinationLink)
    )
      return receipt
    return {
      ...receipt,
      destinationLink: value.destinationLink,
      receiptLine: moveReceiptLine(value.destinationLink),
    }
  } catch {
    return receipt
  }
}

export function moveReceiptLine(destinationLink: string): string {
  return `Your request is now in ${destinationLink}.`
}

/**
 * What the agent a request was moved to is told, in front of the person's words: where it came
 * from, and that the person already chose to continue here.
 */
export function movedHereLine(sourceLink: string): string {
  return `The person moved this request here from ${sourceLink}. Continue here; don't offer to move it back.`
}

export const MOVE_SEND_UNCONFIRMED =
  'Not confirmed as sent. Check that conversation, and send it again if it is missing.'

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

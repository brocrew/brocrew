import type { OutgoingMessage } from './transcript-tool-contracts'

interface Call {
  itemId: string | null
  epoch: number
  eligible: boolean
  resultSeen: boolean
  act: string | null
}

interface Receipt {
  epoch: number
  words: OutgoingMessage
}

export interface MessageJoins {
  epoch: number
  calls: Map<string, Call>
  receipts: Map<string, Receipt>
  claims: Map<string, Call>
  poisoned: Set<string>
  pending: Set<string>
}

import type { RulesAuthor, WhoWroteIt } from './own-instructions'

/** Both values describe the rules the caller read before attempting a replacement. */
export interface RulesBaseline {
  readonly expectedVersion: number
  readonly currentText: string
}

export interface AgentRulesWrite extends RulesBaseline {
  readonly about: string
  readonly text: string
  readonly why: string
}

export interface AgentRulesReading {
  readonly profile: string
  readonly version: number
  readonly text: string
  readonly whoWroteIt: WhoWroteIt | null
  readonly author?: RulesAuthor
  readonly reason: string | null
}

/** A receipt points to durable history instead of repeating the rules in the transcript. */
export interface AgentRulesReceipt {
  readonly conversation: string
  readonly profile: string
  readonly version: number
  readonly previousVersion: number
  readonly author: RulesAuthor
  readonly replacedPersonVersion: number | null
}

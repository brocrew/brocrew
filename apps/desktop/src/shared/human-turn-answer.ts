import type { UserTurnEvent } from './runtime-ipc'
import { theMessagesOf } from './runtime-ipc'

export interface HumanFinalContext {
  promptOrdinal: number
  prompt: string
}

export interface HumanTurnAnswer extends HumanFinalContext {
  final: { ordinal: number; text: string; at: number | null } | null
}

export interface HumanAnswers {
  latest: HumanTurnAnswer | null
  /** The ledger assigns late content to its last turn until another turn opens. */
  active: HumanFinalContext | null
}

/** Only the host's observed person stamp counts; old unmarked rows make no new claim. */
export function humanPromptOf(event: UserTurnEvent): string | null {
  const human = theMessagesOf(event).filter((part) =>
    part.humanInitiated === true && part.attribution === undefined
    && part.relayedFrom === undefined && part.work === undefined && part.appNotice === undefined,
  )
  return human.length === 0 ? null : human.map((part) => part.text).join('\n\n')
}

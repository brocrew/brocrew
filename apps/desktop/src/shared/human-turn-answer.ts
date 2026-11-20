import type { UserTurnEvent } from './human-answer-contracts'

import { theMessagesOf } from './runtime-ipc'

function humanMessagesOf(event: UserTurnEvent) {
  return theMessagesOf(event).filter(
    (part) =>
      part.humanInitiated === true &&
      part.attribution === undefined &&
      part.relayedFrom === undefined &&
      part.work === undefined &&
      part.appNotice === undefined,
  )
}

/** Only the host's observed person stamp counts; old unmarked rows make no new claim. */
export function humanPromptOf(event: UserTurnEvent): string | null {
  const human = humanMessagesOf(event)
  return human.length === 0 ? null : human.map((part) => part.text).join('\n\n')
}

export function firstHumanMessageOf(event: UserTurnEvent): string | null {
  return humanMessagesOf(event)[0]?.text ?? null
}

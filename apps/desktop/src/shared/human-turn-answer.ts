import type { UserTurnEvent } from './human-answer-contracts'

import { theMessagesOf } from './runtime-ipc'

/** Only the host's observed person stamp counts; old unmarked rows make no new claim. */
export function humanPromptOf(event: UserTurnEvent): string | null {
  const human = theMessagesOf(event).filter(
    (part) =>
      part.humanInitiated === true &&
      part.attribution === undefined &&
      part.relayedFrom === undefined &&
      part.work === undefined &&
      part.appNotice === undefined,
  )
  return human.length === 0 ? null : human.map((part) => part.text).join('\n\n')
}

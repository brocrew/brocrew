import type { HumanAnswers, HumanFinalContext } from '../../../shared/human-turn-answer'
import { humanPromptOf } from '../../../shared/human-turn-answer'
import type { TranscriptEvent } from '../../../shared/runtime-ipc'
import type { AssistantItem, TranscriptItem } from './transcript'

export function startHumanAnswer(
  answers: HumanAnswers,
  event: TranscriptEvent,
  ordinal: number,
): void {
  if (event.type === 'user_turn') {
    const prompt = humanPromptOf(event)
    answers.active = prompt === null ? null : { promptOrdinal: ordinal, prompt }
    if (
      prompt === null &&
      event.humanInitiated !== false &&
      event.attribution !== 'app_authored' &&
      (answers.latest === null || ordinal > answers.latest.promptOrdinal)
    ) {
      answers.latest = null
    }
    if (
      answers.active !== null &&
      (answers.latest === null || ordinal > answers.latest.promptOrdinal)
    ) {
      answers.latest = { ...answers.active, final: null }
    }
  } else if (
    event.type === 'provider_turn' ||
    event.type === 'reopened' ||
    (event.type === 'status' && (event.state === 'ended' || event.state === 'errored'))
  ) {
    answers.active = null
  }
}

/** Called with the exact item reconciled by this message, never by searching its words. */
export function finishHumanAnswer(
  answers: HumanAnswers,
  item: AssistantItem,
  event: Extract<TranscriptEvent, { type: 'assistant_message' }>,
  ordinal: number,
  at: number | undefined,
  items: readonly TranscriptItem[],
  context?: HumanFinalContext | null,
): void {
  if (event.phase !== 'final' || event.parentToolCallId !== undefined || event.text.trim() === '')
    return
  const prompt = context === undefined ? answers.active : context
  if (prompt === null || ordinal <= prompt.promptOrdinal) return
  if (
    answers.latest?.promptOrdinal === prompt.promptOrdinal &&
    answers.latest.final !== null &&
    answers.latest.final.ordinal > ordinal
  )
    return
  for (const previous of items) {
    if (
      previous.kind === 'assistant' &&
      previous !== item &&
      previous.humanFinalPromptOrdinal === prompt.promptOrdinal
    )
      delete previous.humanFinal
  }
  item.humanFinal = true
  item.humanFinalPromptOrdinal = prompt.promptOrdinal
  if (answers.latest?.promptOrdinal !== prompt.promptOrdinal) return
  answers.latest.final = { text: event.text, ordinal, at: at ?? null }
}

export function copyHumanAnswers(answers: HumanAnswers): HumanAnswers {
  return {
    active: answers.active === null ? null : { ...answers.active },
    latest:
      answers.latest === null
        ? null
        : {
            ...answers.latest,
            final: answers.latest.final === null ? null : { ...answers.latest.final },
          },
  }
}

import type { AnsweredQuestion } from '../../../shared/runtime-ipc'
import type { TranscriptItem } from './transcript'

export function readAnsweredQuestion(value: unknown): AnsweredQuestion | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const one = value as Record<string, unknown>
  if (
    typeof one.requestId !== 'string' ||
    !one.requestId ||
    one.requestId.length > 200 ||
    !(
      one.answeredBy === null ||
      (typeof one.answeredBy === 'string' &&
        one.answeredBy.length > 0 &&
        one.answeredBy.length <= 200)
    ) ||
    typeof one.answer !== 'string' ||
    !one.answer ||
    one.answer.length > 1280 ||
    (one.cannotAnswer !== undefined && one.cannotAnswer !== true) ||
    (one.clipped !== undefined && one.clipped !== true)
  )
    return undefined
  return {
    requestId: one.requestId,
    answeredBy: one.answeredBy,
    answer: one.answer,
    ...(one.cannotAnswer === true ? { cannotAnswer: true } : {}),
    ...(one.clipped === true ? { clipped: true } : {}),
  }
}
export type AnswerItem = Extract<TranscriptItem, { kind: 'appNotice' | 'relayed' | 'queued' }>
export function answerIn(item: TranscriptItem): AnsweredQuestion | undefined {
  if (item.kind !== 'appNotice' && item.kind !== 'relayed' && item.kind !== 'queued')
    return undefined
  const answer = item.answeredQuestion
  if (!answer) return undefined
  if (answer.answeredBy === null)
    return (item.kind === 'appNotice'
      ? item.notice
      : item.kind === 'queued'
        ? item.appNotice
        : undefined) === 'an-answer-to-a-question'
      ? answer
      : undefined
  return item.kind !== 'appNotice' && item.relayedFrom === answer.answeredBy ? answer : undefined
}
export function questionItemIn(
  items: readonly TranscriptItem[],
  requestId: string,
): string | undefined {
  const matches = items.filter(
    (item) =>
      item.kind === 'tool' &&
      item.parentToolCallId === undefined &&
      item.outgoing &&
      'asked' in item.outgoing &&
      item.outgoing.asked?.requestId === requestId,
  )
  return matches.length === 1 ? matches[0]?.id : undefined
}

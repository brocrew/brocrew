import type { AnsweredQuestion } from './human-answer-contracts'

export function answeredQuestionFields(one: Readonly<Record<string, unknown>>): AnsweredQuestion {
  return {
    requestId: one.requestId as string,
    answeredBy: one.answeredBy as string | null,
    answer: one.answer as string,
    ...(one.cannotAnswer === true ? { cannotAnswer: true } : {}),
    ...(one.clipped === true ? { clipped: true } : {}),
  }
}

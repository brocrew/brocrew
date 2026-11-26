import { type AgentToolAnswer } from '@brobot2/runtime'
import type { AskOutcome } from '../question-rails'
import { carryQuestionRefusal, refusalSaid, type ToolRefusalPayload } from './refusals'
import { SHORT_REPLY_CHARACTERS, withAShortForm } from './long-replies'

// Translate answers without catching failures the tool does not classify.

/** `short`: what the reply says instead of `text` when `text` is long (`long-replies.ts`, 484). */
export const answer = (
  structured: Readonly<Record<string, unknown>>,
  text: string,
  short?: string,
): AgentToolAnswer =>
  short === undefined ? { text, structured } : withAShortForm({ text, structured }, short)

export const answerList = (
  structured: Readonly<Record<string, unknown>>,
  full: string,
  compact: () => string,
  short: string,
): AgentToolAnswer =>
  full.length <= SHORT_REPLY_CHARACTERS
    ? answer(structured, compact())
    : answer(structured, full, short)

export const refusalAnswer = (payload: ToolRefusalPayload): AgentToolAnswer =>
  answer({ ...payload }, `refused (${payload.rail}): ${payload.reason}`)

export function refusedAsk(asked: Extract<AskOutcome, { ok: false }>): AgentToolAnswer {
  if ('resourceFailure' in asked) return answer({ ...asked.refusal }, asked.refusal.reason)
  const carried = carryQuestionRefusal(asked.refusal)
  return answer(carried, `refused (${carried.rail}): ${carried.reason}`)
}

export function sendAnswer(result: AgentToolAnswer): AgentToolAnswer {
  const payload = result.structured
  if (payload?.outcome !== 'refused' || typeof payload.reason !== 'string') return result
  const reason = refusalSaid(payload.reason)
  return { ...result, structured: { ...payload, reason }, text: reason }
}

/**
 * **A give that took its label and gave nothing** — the failure as it is said alone, and the label
 * beside it in the payload (which a model reads too), so a reader who meets the label finds that no
 * piece is called by it: it is never handed out again (`work_sequence`). Not in the text: a
 * refusal's line stays short.
 */
export const itsLabelIsNotUsed = (failed: AgentToolAnswer, label: string): AgentToolAnswer =>
  answer({ ...failed.structured, label_not_used: label }, failed.text)

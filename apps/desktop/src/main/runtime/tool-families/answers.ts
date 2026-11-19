import { type AgentToolAnswer } from '@brobot2/runtime'
import type { AskOutcome } from '../question-rails'
import { carryQuestionRefusal, refusalSaid, type ToolRefusalPayload } from './refusals'

// Translate answers without catching failures the tool does not classify.

export const answer = (
  structured: Readonly<Record<string, unknown>>,
  text: string,
): AgentToolAnswer => ({
  text,
  structured,
})

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

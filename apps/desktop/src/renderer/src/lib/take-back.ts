import type { PersonTakeBackRail, WorkTakenBackByAPerson } from '../../../shared/piece-called'
import { readableError } from './session-record'

/** The press on a service's current piece. */
export const TAKE_BACK = 'Take back'

/** What each refusal of a person's take-back says. */
const NOT_TAKEN_BACK: Record<PersonTakeBackRail, string> = {
  'not-a-piece-a-service-is-on': 'Not taken back: the service is no longer on this piece.',
  'not-a-stopped-piece': 'Not taken back: it is no longer stopped.',
  'that-conversation-has-not-started':
    'Not taken back: the service is still starting. Try again in a moment.',
  'that-work-is-being-sent':
    'Not taken back: the brief is still on its way to the service. Try again in a moment.',
  'a-conversation-with-its-questions-is-starting':
    'Not taken back: a conversation with a question about it is still starting. Try again in a moment.',
  'its-questions-could-not-all-be-read':
    "Not taken back: its questions couldn't all be read. Try again.",
}

/** What a person's take-back answered, in words. */
export function takeBackSays(answer: WorkTakenBackByAPerson): string {
  if (!answer.ok) return NOT_TAKEN_BACK[answer.rail]
  return answer.askedItsTurnToStop ? 'Taken back; its turn was asked to stop.' : 'Taken back.'
}

/** Asks the door and says its answer, or a refusal it threw in the app's own sentence. */
export async function takeBackThrough(ask: () => Promise<WorkTakenBackByAPerson>): Promise<string> {
  try {
    return takeBackSays(await ask())
  } catch (cause) {
    return readableError(cause)
  }
}

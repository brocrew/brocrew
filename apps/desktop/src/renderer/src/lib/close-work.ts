import type { PersonCloseRail, WorkClosedByAPerson } from '../../../shared/piece-called'

const REASONS: Record<PersonCloseRail, string> = {
  'not-a-stopped-piece':
    'That piece is no longer stopped. Open the conversation to see where it stands.',
  'that-conversation-has-not-started': 'The conversation is still starting. Try again in a moment.',
  'that-work-is-being-sent': 'The brief is still on its way. Try again in a moment.',
  'a-conversation-with-its-questions-is-starting':
    'A conversation with a question about it is still starting. Try again in a moment.',
  'its-questions-could-not-all-be-read': 'Its questions could not all be read. Try again.',
}

export function closeWorkSays(result: WorkClosedByAPerson): { ok: boolean; said: string } {
  return result.ok
    ? { ok: true, said: `${result.label} is closed.` }
    : { ok: false, said: REASONS[result.rail] }
}

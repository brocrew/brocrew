import type { TaskState } from './tasks'

/** Work state words for views and tools. */
export const WORK_STATE_WORD: Readonly<Record<TaskState, string>> = {
  waiting: 'not handed over yet',
  working: 'being worked on',
  'waiting-on-an-answer': 'waiting on an answer',
  'waiting-on-a-person': 'waiting on a person',
  'waiting-on-a-worker': 'waiting on a worker',
  'waiting-on-the-person-who-asked': 'replied',
  stalled: 'not being worked on',
  answered: 'answered',
  withdrawn: 'taken back',
  closed: 'closed',
  'waiting-on-the-person-who-wrote': 'waiting on you',
  'waiting-on-purpose': 'waiting on purpose',
}

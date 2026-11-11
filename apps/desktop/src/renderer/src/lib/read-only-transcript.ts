import type { PersistedEventInfo } from '../../../shared/conversation-events'
import { applyEvent, createTranscript, markReadOnly } from './transcript'

type ReadOnlyEvent = Pick<PersistedEventInfo, 'event' | 'workAncestry' | 'errorFacts'> & {
  at?: number
}

/** Recovery copies and native child files share the transcript fold without live controls. */
export function readOnlyTranscript(events: Iterable<ReadOnlyEvent>, note: string) {
  const state = createTranscript()
  for (const { event, at, workAncestry, errorFacts } of events)
    applyEvent(state, event, at, undefined, undefined, workAncestry, undefined, errorFacts)
  markReadOnly(state, note)
  return state
}

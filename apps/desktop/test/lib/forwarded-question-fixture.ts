import { newAskedQuestionId } from '../../src/main/db/ids'
import type { SessionStore } from '../../src/main/db/session-store'

interface ForwardedQuestion {
  readonly asker: string
  readonly original: string
  readonly forwarder: string
  readonly to: 'the-parent' | 'a-person'
  readonly parent?: string
  readonly context?: string
}

/** Seed the two ledger rows left by a historical forward. */
export function recordForwardedQuestion(
  store: SessionStore,
  now: () => number,
  { asker, original, forwarder, to, parent, context }: ForwardedQuestion,
): string {
  const carried = store.questionsRaisedIn(asker).get(original)
  if (carried === undefined) throw new Error(`Original question ${original} is missing`)
  const copy = newAskedQuestionId()
  store.atomically(() => {
    store.append(
      forwarder,
      store.nextOrdinal(forwarder),
      {
        type: 'question_asked',
        requestId: copy,
        passedUpFrom: original,
        prompt: carried.prompt,
        questions: carried.questions,
        ...(context === undefined ? {} : { context }),
      },
      now(),
    )
    store.append(
      forwarder,
      store.nextOrdinal(forwarder),
      { type: 'request_routed', requestId: copy, to, ...(parent === undefined ? {} : { parent }) },
      now(),
    )
  })
  return copy
}

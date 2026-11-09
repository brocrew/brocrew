import type { TranscriptEvent } from '../../../shared/conversation-events'

const REFUSED_NOTICE =
  'Claude rejected the current machine sign-in. Sign in again to continue this conversation. ' +
  'Its transcript is kept. It carries on without its “Allow for this conversation” approvals ' +
  'or anything that was running in the background.'

/** Classify live errors and historical retry rows without changing their stored diagnostics. */
export function signInObservation(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'error' || event.onAKey === true) return event
  if (event.cause === 'auth') {
    return { ...event, signIn: { state: 'refused', message: REFUSED_NOTICE } }
  }
  if (!/^claude could not authenticate; retrying\b/.test(event.message)) return event
  const attempt = event.message.match(/attempt \d+\/\d+/)?.[0]
  return {
    ...event,
    signIn: {
      state: 'retrying',
      message: `Claude is retrying sign-in${attempt ? ` (${attempt})` : ''}.`,
    },
  }
}

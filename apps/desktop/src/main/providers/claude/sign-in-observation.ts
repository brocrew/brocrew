import { STALE_AUTH_NOTICE } from './error-words'
import type { TranscriptEvent } from '../../../shared/conversation-events'

const REFUSED_NOTICE =
  'Claude rejected the current machine sign-in. Sign in again to continue this conversation. ' +
  'Its transcript is kept. It carries on without its “Allow for this conversation” approvals ' +
  'or anything that was running in the background.'

const RETRY_CAPTIONS = {
  stopped: 'Claude sign-in retry stopped.',
  ended: 'Claude sign-in retry ended.',
  recovered: 'Claude sign-in recovered.',
}

/** Classify live errors and historical retry rows without changing their stored diagnostics. */
export function signInObservation(event: TranscriptEvent): TranscriptEvent {
  if (event.type !== 'error' || event.onAKey === true) return event
  if (typeof event.signIn?.message === 'string') return event
  if (event.signIn != null) {
    const message =
      event.signIn.state === 'refused'
        ? REFUSED_NOTICE
        : event.signIn.state === 'stale'
          ? STALE_AUTH_NOTICE
          : event.signIn.state === 'retrying'
            ? retryMessage(event.message)
            : undefined
    if (message === undefined) return event
    return {
      ...event,
      signIn: {
        ...event.signIn,
        message,
        ...(event.signIn.state === 'retrying'
          ? { captions: event.signIn.captions ?? RETRY_CAPTIONS }
          : {}),
      },
    }
  }
  if (event.cause === 'auth') {
    return { ...event, signIn: { state: 'refused', message: REFUSED_NOTICE } }
  }
  if (event.cause === 'auth_stale')
    return { ...event, signIn: { state: 'stale', message: STALE_AUTH_NOTICE } }
  if (!/^claude could not authenticate; retrying\b/.test(event.message)) return event
  if (event.cause !== undefined)
    return { ...event, signIn: { state: 'stale', message: STALE_AUTH_NOTICE } }
  return {
    ...event,
    signIn: {
      state: 'retrying',
      message: retryMessage(event.message),
      captions: RETRY_CAPTIONS,
    },
  }
}

function retryMessage(diagnostic: string): string {
  const attempt = diagnostic.match(/attempt \d+\/\d+/)?.[0]
  return `Claude is retrying sign-in${attempt ? ` (${attempt})` : ''}.`
}

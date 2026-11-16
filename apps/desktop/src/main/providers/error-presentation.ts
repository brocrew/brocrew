import { errorPresentationSchema, type ErrorPresentation } from '@brobot2/runtime'
import { SUPPORTED_PROVIDERS, providerDescriptor, type Provider } from '@brobot2/shared'
import type { TranscriptEvent } from '../../shared/conversation-events'
import type { ErrorFacts } from '../../shared/error-facts'
import { errorFactsForEvent } from './error-diagnostic'
import { providerDefinitions } from './index'

type ErrorEvent = Extract<TranscriptEvent, { type: 'error' }>
type Display = Required<ErrorPresentation>

const AUTH_ERROR_NOTICE =
  'This profile’s sign-in was rejected, so this conversation cannot continue. Start a new conversation to sign in again — the launcher will offer it.'
const GENERIC_STALE_NOTICE =
  'The sign-in this conversation was launched with is no longer valid. Its transcript is kept. ' +
  'Check the provider’s sign-in in Providers before continuing.'
const KEY_REFUSED_NOTICE = 'Key refused. Check its balance or switch connection.'

export function billingNotice(name: string | undefined, onAKey: boolean): string {
  if (onAKey) return KEY_REFUSED_NOTICE
  if (name === undefined) {
    return (
      'The provider would not run this turn on the account this conversation runs on, because of ' +
      'that account’s billing. Add credit to it, then send this conversation a message to carry on.'
    )
  }
  return (
    `This turn was refused on the account this conversation’s ${name} login belongs to, ` +
    'because of that account’s billing. Check its plan and billing, then send this ' +
    `conversation a message to carry on. Or save an API key under “API key” on the ${name} ` +
    'card in Providers; conversations started after that run on it.'
  )
}

export function replacedSignInNotice(name: string): string {
  return (
    `${name} refused this agent’s sign-in, so this turn stopped. This app replaces it by itself ` +
    'when a newer sign-in to the same account is on this computer, and reopens this conversation. ' +
    `Signing in to ${name} again on the ${name} card in Providers gives it one.`
  )
}

function signInWords(event: ErrorEvent, name: string | undefined): ErrorEvent {
  if (event.onAKey === true || event.signIn?.message !== undefined) return event
  const state = event.signIn?.state ?? (event.cause === 'auth_stale' ? 'stale' : undefined)
  const provider = name ?? 'The provider'
  const message =
    event.signIn?.message ??
    (state === 'stale'
      ? GENERIC_STALE_NOTICE
      : state === 'refused'
        ? `${provider} rejected this sign-in. Check its sign-in in Providers before continuing.`
        : state === 'retrying'
          ? `${provider} is retrying sign-in.`
          : undefined)
  if (state === undefined || message === undefined) return event
  const captions =
    event.signIn?.captions ??
    (state === 'retrying'
      ? {
          stopped: `${provider} sign-in retry stopped.`,
          ended: `${provider} sign-in retry ended.`,
          recovered: `${provider} sign-in recovered.`,
        }
      : undefined)
  if (event.signIn?.message === message && event.signIn?.captions === captions) return event
  return {
    ...event,
    signIn: { ...event.signIn, state, message, ...(captions === undefined ? {} : { captions }) },
  }
}

function presented(event: ErrorEvent, presentation: Display): ErrorEvent {
  return { ...event, presentation }
}

/** Resolve display outcomes only; diagnostics, session status and provider lifecycle stay intact. */
export function errorForDisplay(event: TranscriptEvent, name?: string): TranscriptEvent {
  if (event.type !== 'error') return event
  const observed = signInWords(event, name)
  // The sign-in row owns its existing grouping and ending behavior before ordinary notices.
  if (
    observed.onAKey !== true &&
    (observed.cause === 'auth_stale' || observed.signIn !== undefined)
  )
    return observed
  if (
    observed.onAKey === true &&
    (observed.cause === 'auth' ||
      observed.cause === 'auth_stale' ||
      observed.billingRefused === true)
  )
    return presented(observed, {
      message: KEY_REFUSED_NOTICE,
      level: 'error',
      terminal: observed.billingRefused === true ? false : observed.fatal,
      repeat: 'same-message-once',
    })
  const supplied = errorPresentationSchema.safeParse(observed.presentation)
  if (supplied.success && supplied.data.message.trim() !== '') {
    return presented(observed, {
      message: supplied.data.message,
      level: supplied.data.level ?? (observed.fatal ? 'error' : 'warn'),
      terminal: supplied.data.terminal ?? observed.fatal,
      repeat: supplied.data.repeat ?? 'each',
    })
  }
  if (observed.billingRefused === true)
    return presented(observed, {
      message: billingNotice(name, observed.onAKey === true),
      level: 'error',
      terminal: false,
      repeat: 'same-message-once',
    })
  if (observed.cause === 'auth' || observed.cause === 'auth_stale') {
    const message =
      observed.replacesRefusedSignIn === true && name !== undefined
        ? replacedSignInNotice(name)
        : AUTH_ERROR_NOTICE
    return presented(observed, {
      message,
      level: 'error',
      terminal: observed.fatal,
      repeat: 'each',
    })
  }
  if (observed.cause !== undefined)
    return presented(observed, {
      message: `this conversation reported a problem this version does not recognize (${String(observed.cause)})`,
      level: 'error',
      terminal: observed.fatal,
      repeat: 'each',
    })
  return observed
}

/** The same projection is used for live delivery and replay, including rows with no known owner. */
export function transcriptEventForDisplay(
  event: TranscriptEvent,
  owner?: Provider,
): TranscriptEvent {
  const provider =
    event.type === 'unknown' ? SUPPORTED_PROVIDERS.find((one) => one === event.provider) : owner
  const projected =
    provider === undefined
      ? event
      : (providerDefinitions[provider].transcripts.eventForDisplay?.(event) ?? event)
  return errorForDisplay(
    projected,
    provider === undefined ? undefined : providerDescriptor(provider).displayName,
  )
}

/** Project live and historical wrappers without writing display facts into their saved events. */
export function transcriptMessageForDisplay<T extends { event: TranscriptEvent }>(
  message: T,
  owner?: Provider,
): T & { errorFacts?: ErrorFacts } {
  const event = transcriptEventForDisplay(message.event, owner)
  if (event.type !== 'error') return event === message.event ? message : { ...message, event }
  return { ...message, event, errorFacts: errorFactsForEvent(event) }
}

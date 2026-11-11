import { STALE_AUTH_NOTICE } from '../src/main/providers/claude/error-words'
import { expect, it } from 'vitest'
import { signInObservation } from '../src/main/providers/claude/sign-in-observation'
import type { TranscriptEvent } from '../src/shared/conversation-events'

it('classifies old retry diagnostics while preserving their raw words and flags', () => {
  const event: TranscriptEvent = {
    type: 'error',
    message: 'claude could not authenticate; retrying (attempt 2/3, HTTP 401)',
    fatal: false,
  }
  expect(signInObservation(event)).toEqual({
    ...event,
    signIn: {
      state: 'retrying',
      message: 'Claude is retrying sign-in (attempt 2/3).',
      captions: {
        stopped: 'Claude sign-in retry stopped.',
        ended: 'Claude sign-in retry ended.',
        recovered: 'Claude sign-in recovered.',
      },
    },
  })
  expect(event).not.toHaveProperty('signIn')
})

it('classifies a refused login, while leaving API-key and unrelated failures unchanged', () => {
  const event: TranscriptEvent = { type: 'error', message: 'refused', cause: 'auth', fatal: true }
  expect(signInObservation(event)).toMatchObject({
    ...event,
    signIn: { state: 'refused', message: expect.stringContaining('Sign in again') },
  })
  const key = { ...event, onAKey: true as const }
  const other = { ...event, cause: undefined, message: 'disk full' }
  expect(signInObservation(key)).toBe(key)
  expect(signInObservation(other)).toBe(other)
})

it('retains a diagnosed stale-login remedy instead of restarting its old retry row', () => {
  const event: TranscriptEvent = {
    type: 'error',
    message: 'claude could not authenticate; retrying (attempt 3/3, HTTP 401)',
    fatal: true,
    cause: 'auth_stale',
  }
  expect(signInObservation(event)).toEqual({
    ...event,
    signIn: { state: 'stale', message: STALE_AUTH_NOTICE },
  })
})

it('keeps supplied sign-in messages and states authoritative', () => {
  for (const state of ['retrying', 'refused', 'stale'] as const) {
    const event: TranscriptEvent = {
      type: 'error',
      message: 'fictional raw diagnostic',
      fatal: false,
      cause: 'auth',
      signIn: { state, message: 'Fern supplied these words.' },
    }
    expect(signInObservation(event)).toBe(event)
  }
})

it('fills an existing stale row without changing its diagnostic, state or lifecycle flags', () => {
  const event: TranscriptEvent = {
    type: 'error',
    message: 'fictional raw diagnostic',
    fatal: true,
    signIn: { state: 'stale' },
  }
  expect(signInObservation(event)).toEqual({
    ...event,
    signIn: { state: 'stale', message: STALE_AUTH_NOTICE },
  })
})

it('does not replace an explicitly supplied empty sign-in message', () => {
  const event: TranscriptEvent = {
    type: 'error',
    message: 'fictional raw detail',
    fatal: false,
    signIn: { state: 'retrying', message: '' },
  }
  expect(signInObservation(event)).toBe(event)
})

it('supplies retry endings only when classifying an unfinished native observation', () => {
  const event: TranscriptEvent = {
    type: 'error',
    message: 'claude could not authenticate; retrying (attempt 1/3, HTTP 401)',
    fatal: false,
    signIn: { state: 'retrying' },
  }
  const projected = signInObservation(event)
  if (projected.type !== 'error') throw new Error('Expected an error')
  expect(projected.signIn).toEqual({
    state: 'retrying',
    message: 'Claude is retrying sign-in (attempt 1/3).',
    captions: {
      stopped: 'Claude sign-in retry stopped.',
      ended: 'Claude sign-in retry ended.',
      recovered: 'Claude sign-in recovered.',
    },
  })
  const captions = { stopped: 'Fern stopped.', ended: 'Fern ended.', recovered: 'Fern returned.' }
  const supplied = signInObservation({ ...event, signIn: { state: 'retrying', captions } })
  if (supplied.type !== 'error') throw new Error('Expected an error')
  expect(supplied.signIn?.captions).toBe(captions)
  expect(event.signIn).toEqual({ state: 'retrying' })
})

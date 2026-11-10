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
    signIn: { state: 'retrying', message: 'Claude is retrying sign-in (attempt 2/3).' },
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
  expect(signInObservation(event)).toEqual({ ...event, signIn: { state: 'stale' } })
})

import { describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import {
  errorForDisplay,
  transcriptEventForDisplay,
} from '../src/main/providers/error-presentation'

type ErrorEvent = Extract<TranscriptEvent, { type: 'error' }>
function projected(event: ErrorEvent, owner?: Provider): ErrorEvent {
  const result = transcriptEventForDisplay(event, owner)
  if (result.type !== 'error') throw new Error('An error projection changed its event kind')
  return result
}

describe('core-supplied error display outcomes', () => {
  for (const owner of ['claude', 'codex', undefined] as const) {
    for (const onAKey of [true, false]) {
      it(`keeps billing severity, early return and dedup for ${owner ?? 'unknown owner'}/${onAKey}`, () => {
        const event: ErrorEvent = Object.freeze({
          type: 'error',
          message: 'fictional billing diagnostic',
          fatal: true,
          billingRefused: true,
          ...(onAKey ? { onAKey: true as const } : {}),
        })
        const live = projected(event, owner)
        const replay = projected(JSON.parse(JSON.stringify(event)) as ErrorEvent, owner)
        expect(live).toEqual(replay)
        expect(live).toMatchObject(event)
        expect(live.presentation).toMatchObject({
          level: 'error',
          terminal: false,
          repeat: 'same-message-once',
        })
        expect(live.message).toBe('fictional billing diagnostic')
        expect(live.fatal).toBe(true)
        expect(event).not.toHaveProperty('presentation')
        if (owner === undefined) {
          expect(live.presentation?.message).toBe(
            'The provider would not run this turn on the account this conversation runs on, because of ' +
              'that account’s billing. Add credit to it, then send this conversation a message to carry on.',
          )
        } else {
          expect(live.presentation?.message).toContain(owner === 'claude' ? 'Claude' : 'Codex')
          expect(live.presentation?.message).toContain(onAKey ? 'API key' : 'login belongs to')
        }
      })
    }
  }

  it.each([false, true])(
    'keeps cause severity and fatal=%s for a supplied fictional label',
    (fatal) => {
      const event: ErrorEvent = {
        type: 'error',
        message: 'fictional rejected copy',
        cause: 'auth',
        fatal,
        replacesRefusedSignIn: true,
      }
      const result = errorForDisplay(event, 'Fern Harness')
      expect(result).toMatchObject({
        ...event,
        presentation: { level: 'error', terminal: fatal, repeat: 'each' },
      })
      if (result.type !== 'error') throw new Error('Expected an error')
      expect(result.presentation?.message).toContain('Fern Harness refused this agent’s sign-in')
      expect(result.presentation?.message).toContain('Signing in to Fern Harness again')
    },
  )

  it('retains native stale-key and stale-login words only through their known owner', () => {
    const event: ErrorEvent = {
      type: 'error',
      message: 'fictional stale credential',
      cause: 'auth_stale',
      fatal: true,
    }
    const key = projected({ ...event, onAKey: true }, 'claude')
    expect(key.presentation?.message).toContain('Anthropic refused the API key')
    expect(key.presentation).toMatchObject({ level: 'error', terminal: true, repeat: 'each' })
    const login = projected(event, 'claude')
    expect(login.signIn?.state).toBe('stale')
    expect(login.signIn?.message).toContain('machine’s Claude login')
    const unknown = projected(event)
    expect(unknown.signIn?.state).toBe('stale')
    expect(unknown.signIn?.message).not.toMatch(/Claude|Codex|Anthropic/)
    expect(unknown.message).toBe(event.message)
  })

  it('keeps stale keys on this conversation and ordinary rejected keys on a new conversation', () => {
    const event: ErrorEvent = {
      type: 'error',
      message: 'fictional key diagnostic',
      cause: 'auth',
      fatal: true,
      onAKey: true,
    }
    for (const owner of ['claude', 'codex'] as const) {
      const rejected = projected(event, owner)
      const stale = projected({ ...event, cause: 'auth_stale' }, owner)
      expect(rejected.presentation?.message).toContain('then start a new conversation')
      expect(stale.presentation?.message).toContain(
        'then send this conversation a message to carry on',
      )
      expect(stale.presentation?.message).toContain('reads the key afresh')
      expect(stale.presentation?.message).toContain('anything that was running in the background')
      expect(stale.message).toBe(event.message)
      expect(stale.fatal).toBe(true)
    }
    const fictional = errorForDisplay({ ...event, cause: 'auth_stale' }, 'Fern Harness')
    if (fictional.type !== 'error') throw new Error('Expected an error')
    expect(fictional.presentation?.message).toContain('Fern Harness card')
    expect(fictional.presentation?.message).toContain('then send this conversation a message')
    expect(fictional.presentation?.message).not.toMatch(/Claude|Codex|Anthropic/)
  })

  it('preserves supplied sign-in states/messages ahead of ordinary display notices', () => {
    for (const state of ['retrying', 'refused', 'stale'] as const) {
      for (const owner of ['claude', undefined] as const) {
        const event: ErrorEvent = {
          type: 'error',
          message: 'fictional raw detail',
          cause: 'auth',
          fatal: false,
          signIn: {
            state,
            message: 'Fern supplied this sign-in sentence.',
            captions: {
              stopped: 'Fern stopped.',
              ended: 'Fern ended.',
              recovered: 'Fern recovered.',
            },
          },
          presentation: { message: 'An ordinary notice must not replace the sign-in row.' },
        }
        expect(projected(event, owner)).toBe(event)
        expect(event.signIn).toEqual({
          state,
          message: 'Fern supplied this sign-in sentence.',
          captions: {
            stopped: 'Fern stopped.',
            ended: 'Fern ended.',
            recovered: 'Fern recovered.',
          },
        })
      }
    }
  })

  it('does not infer a native owner from raw words on an unowned historical row', () => {
    const event: ErrorEvent = {
      type: 'error',
      message: 'claude could not authenticate; retrying (attempt 1/3)',
      fatal: false,
    }
    expect(projected(event)).toBe(event)
  })

  it('normalizes legacy message-only data and retains arbitrary supplied display outcomes', () => {
    const event: ErrorEvent = {
      type: 'error',
      message: 'fictional diagnostic',
      fatal: false,
      presentation: { message: 'Fern needs its workspace opened.' },
    }
    expect(projected(event).presentation).toEqual({
      message: 'Fern needs its workspace opened.',
      level: 'warn',
      terminal: false,
      repeat: 'each',
    })
    const complete: ErrorEvent = {
      ...event,
      presentation: {
        message: 'Fern cannot bill this turn.',
        level: 'error',
        terminal: false,
        repeat: 'same-message-once',
      },
    }
    expect(projected(complete)).toEqual(complete)
  })

  it('uses known flags for malformed metadata and leaves unrelated diagnostics to existing grammar', () => {
    const billing: ErrorEvent = {
      type: 'error',
      message: 'fictional raw billing',
      fatal: false,
      billingRefused: true,
    }
    Reflect.set(billing, 'presentation', { message: 'wrong typed metadata', level: 17 })
    expect(projected(billing).presentation).toMatchObject({
      level: 'error',
      repeat: 'same-message-once',
      terminal: false,
    })
    const ordinary: ErrorEvent = { type: 'error', message: 'fictional raw text', fatal: false }
    expect(projected(ordinary)).toBe(ordinary)
    const future: ErrorEvent = { ...ordinary }
    Reflect.set(future, 'cause', 'fern-future-cause')
    expect(projected(future).presentation?.message).toBe(
      'this conversation reported a problem this version does not recognize (fern-future-cause)',
    )
  })
})

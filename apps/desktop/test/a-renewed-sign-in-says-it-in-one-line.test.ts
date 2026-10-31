import { describe, expect, it } from 'vitest'
import { A_RENEWED_SIGN_IN_SAYS } from '../src/shared/a-renewed-sign-in'
import {
  applyEvent,
  createTranscript,
  REOPENED_ON_A_RENEWED_SIGN_IN,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # A sign-in this app renewed by itself is said in one short line
 *
 * When this app replaces a refused copy of a sign-in and the conversation carries on, a person
 * reads one line; where the message was not answered, the same line and what to do.
 */
describe('a renewed sign-in says it in one line', () => {
  it('🔒 the two lines, word for word', () => {
    expect(A_RENEWED_SIGN_IN_SAYS.carriedOn('Codex')).toBe('Codex sign-in renewed.')
    expect(A_RENEWED_SIGN_IN_SAYS.sendAgain('Codex')).toBe(
      'Codex sign-in renewed. Send your message again.',
    )
  })
})

/** A Codex conversation whose turn is refused on its sign-in, as the window folds it. */
const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent
const STARTED = ev({
  type: 'session',
  state: 'started',
  ref: { provider: 'codex', sessionId: 's1' },
})
const ASKED = ev({ type: 'user_turn', text: 'read the menu' })
const RETRYING = ev({ type: 'error', message: 'Reconnecting... 2/5', fatal: false })
const REFUSED = ev({
  type: 'error',
  message: 'unauthorized',
  fatal: false,
  cause: 'auth',
  replacesRefusedSignIn: true,
})
/** The turn's own ending, as the host's carry-on reads it: failed on the refused sign-in. */
const FAILED = ev({ type: 'turn', state: 'failed', loginRefused: true })
const REOPENED = ev({
  type: 'reopened',
  because: 'the-sign-in-was-renewed',
  itsCopyWasReplaced: true,
})
const CARRIES_ON = ev({ type: 'user_turn', text: '', attribution: 'app_authored', carriesOn: true })

const folded = (...events: TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}
const rowsSaid = (state: TranscriptState): string[] =>
  state.items.flatMap((item) =>
    item.kind === 'notice' && item.level !== 'info' ? [item.text] : [],
  )
const turns = (state: TranscriptState): number =>
  state.items.filter((item) => item.kind === 'user').length

describe('the rows of a sign-in this app renewed fold into its one line', () => {
  it('an explicit app continuation says it is carrying on without asking for another send', () => {
    const started = ev({ ...STARTED, ref: { provider: 'claude', sessionId: 's2' } })
    const continued = ev({
      type: 'user_turn',
      text: 'Continue answering the last message.',
      attribution: 'app_authored',
      appNotice: 'a-turn-continued-after-sign-in',
    })
    const events = [
      started,
      ASKED,
      REFUSED,
      FAILED,
      ev({ type: 'reopened', because: 'the-sign-in-was-renewed' }),
      continued,
    ]
    const state = folded(...events)
    expect(rowsSaid(state)).toEqual(['Claude sign-in changed. The agent is carrying on.'])
    expect(turns(state)).toBe(1)
    expect(state.items.some((item) => item.kind === 'appNotice')).toBe(true)
    expect(rowsSaid(folded(...events))).toEqual(rowsSaid(state))
    expect(continued).not.toHaveProperty('carriesOn')
  })

  it('a stopped-turn notice is not evidence that a guarded continuation was sent', () => {
    const state = folded(
      STARTED,
      ASKED,
      REFUSED,
      FAILED,
      ev({ type: 'reopened', because: 'the-sign-in-was-renewed' }),
      ev({
        type: 'user_turn',
        text: 'The previous turn was stopped.',
        attribution: 'app_authored',
        appNotice: 'a-turn-a-refused-login-stopped',
      }),
    )
    expect(rowsSaid(state)).toContain(REOPENED_ON_A_RENEWED_SIGN_IN)
    expect(rowsSaid(state).join(' ')).not.toContain('The agent is carrying on.')
  })

  it('a continuation notice without app authorship does not rewrite the renewal advice', () => {
    const state = folded(
      STARTED,
      ASKED,
      REFUSED,
      FAILED,
      ev({ type: 'reopened', because: 'the-sign-in-was-renewed' }),
      ev({
        type: 'user_turn',
        text: 'Continue answering the last message.',
        appNotice: 'a-turn-continued-after-sign-in',
      }),
    )
    expect(rowsSaid(state)).toContain(REOPENED_ON_A_RENEWED_SIGN_IN)
    expect(rowsSaid(state).join(' ')).not.toContain('The agent is carrying on.')
  })

  it('a give carried on after an account change stops asking to send it again', () => {
    const changed = ev({ type: 'reopened', because: 'the-sign-in-was-renewed' })
    const state = folded(
      STARTED,
      ASKED,
      REFUSED,
      FAILED,
      changed,
      ev({ ...CARRIES_ON, carriedOnAfterAccountChange: true }),
    )
    expect(rowsSaid(state)).toContain('Codex sign-in changed. The agent is carrying on.')
    expect(rowsSaid(state).join(' ')).not.toContain('send again')
    expect(rowsSaid(state).join(' ')).not.toContain('sign-in renewed.')
    expect(turns(state)).toBe(1)
  })

  it('an ordinary reopen without the recorded account-change fact keeps its advice', () => {
    const changed = ev({ type: 'reopened', because: 'the-sign-in-was-renewed' })
    const state = folded(STARTED, ASKED, REFUSED, FAILED, changed, CARRIES_ON)
    expect(rowsSaid(state)).toContain(REOPENED_ON_A_RENEWED_SIGN_IN)
    expect(rowsSaid(state).join(' ')).not.toContain('The agent is carrying on.')
  })

  it('the account-change fact uses the existing display name for any provider', () => {
    const started = ev({
      type: 'session',
      state: 'started',
      ref: { provider: 'claude', sessionId: 's2' },
    })
    const changed = ev({ type: 'reopened', because: 'the-sign-in-was-renewed' })
    const state = folded(
      started,
      ASKED,
      REFUSED,
      FAILED,
      changed,
      ev({ ...CARRIES_ON, carriedOnAfterAccountChange: true }),
    )
    expect(rowsSaid(state)).toContain('Claude sign-in changed. The agent is carrying on.')
    expect(rowsSaid(state).join(' ')).not.toContain('send again')
  })

  it('🔴 renewed, and the agent carried on: one line, nothing to do', () => {
    const state = folded(STARTED, ASKED, RETRYING, REFUSED, FAILED, REOPENED, CARRIES_ON)
    expect(rowsSaid(state)).toEqual(['Codex sign-in renewed.'])
    // The person's message stays, and the turn that carried on draws nothing.
    expect(turns(state)).toBe(1)
  })

  it('🔴 renewed, and nothing carried on: the same line, and what to do', () => {
    const state = folded(STARTED, ASKED, RETRYING, REFUSED, FAILED, REOPENED)
    expect(rowsSaid(state)).toEqual(['Codex sign-in renewed. Send your message again.'])
  })

  it('⛔ a person’s next message, not a carrying-on turn, leaves the line asking to send again', () => {
    const state = folded(
      STARTED,
      ASKED,
      REFUSED,
      FAILED,
      REOPENED,
      ev({ type: 'user_turn', text: 'again' }),
    )
    expect(rowsSaid(state)).toEqual(['Codex sign-in renewed. Send your message again.'])
  })

  it('⛔ a refusal with no reopen keeps its rows: the person must act', () => {
    const state = folded(STARTED, ASKED, RETRYING, REFUSED, FAILED)
    const said = rowsSaid(state)
    expect(said.length).toBeGreaterThan(1)
    expect(said.some((one) => one.startsWith('Codex refused this agent’s sign-in'))).toBe(true)
    expect(said.join(' ')).not.toContain('sign-in renewed')
  })

  it('⛔ an older reopen, without the mark, reads as today', () => {
    const older = ev({ type: 'reopened', because: 'the-sign-in-was-renewed' })
    const state = folded(STARTED, ASKED, REFUSED, FAILED, older)
    expect(rowsSaid(state)).toContain(REOPENED_ON_A_RENEWED_SIGN_IN)
    expect(rowsSaid(state).join(' ')).not.toContain('sign-in renewed.')
  })

  it('⛔ a renewal does not fold the rows of an earlier turn', () => {
    const state = folded(
      STARTED,
      ASKED,
      RETRYING,
      ev({ type: 'user_turn', text: 'next' }),
      REFUSED,
      REOPENED,
    )
    expect(rowsSaid(state)).toContain('Codex sign-in renewed. Send your message again.')
    expect(rowsSaid(state).length).toBe(2)
  })

  it('🔴 the failed turn’s own ending folds with its errors', () => {
    const state = folded(STARTED, ASKED, RETRYING, REFUSED, FAILED, REOPENED, CARRIES_ON)
    expect(state.items.some((item) => item.kind === 'notice' && item.text === 'turn failed')).toBe(
      false,
    )
  })

  it('⛔ an earlier turn’s failed ending stays: only the repaired turn folds', () => {
    const earlier = ev({ type: 'turn', state: 'failed', loginRefused: true })
    const state = folded(
      STARTED,
      ASKED,
      REFUSED,
      earlier,
      ev({ type: 'user_turn', text: 'next' }),
      REFUSED,
      FAILED,
      REOPENED,
    )
    const endings = state.items.filter(
      (item) => item.kind === 'notice' && item.text === 'turn failed',
    )
    expect(endings).toHaveLength(1)
    expect(rowsSaid(state)).toContain('Codex sign-in renewed. Send your message again.')
  })

  it('⛔ a failed ending that was not a refused sign-in is not folded', () => {
    const state = folded(STARTED, ASKED, REFUSED, ev({ type: 'turn', state: 'failed' }), REOPENED)
    expect(state.items.some((item) => item.kind === 'notice' && item.text === 'turn failed')).toBe(
      true,
    )
  })
})

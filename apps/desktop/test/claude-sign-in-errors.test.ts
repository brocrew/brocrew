import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  applyEvent,
  createTranscript,
  THE_APPS_OWN_WORD,
  type NoticeItem,
} from '../src/renderer/src/lib/transcript'
import { visibleItems } from '../src/renderer/src/lib/transcript-mode'

const retry = (attempt: number): Extract<TranscriptEvent, { type: 'error' }> => ({
  type: 'error',
  message: `claude could not authenticate; retrying (attempt ${attempt}/3, retrying in 1s, HTTP 401)`,
  fatal: false,
})
const refused: Extract<TranscriptEvent, { type: 'error' }> = {
  type: 'error',
  message: 'HTTP 401: the launch sign-in was refused',
  fatal: true,
  cause: 'auth_stale',
}

function transcript() {
  const state = createTranscript()
  state.ref = { provider: 'claude', sessionId: 'bakery', cwd: '/tmp/bakery', rotation: 0 }
  return state
}
const notices = (items: ReturnType<typeof transcript>['items']) =>
  items.filter((item): item is NoticeItem => item.kind === 'notice')

describe('Claude sign-in failures', () => {
  it('updates one row through retries, refusal and failed turn, keeping every diagnostic', () => {
    const state = transcript()
    applyEvent(state, retry(1))
    const id = state.items[0]?.id
    applyEvent(state, retry(2))
    expect(notices(state.items)).toHaveLength(1)
    expect(notices(state.items)[0]?.text).toContain('attempt 2/3')
    expect(notices(state.items)[0]?.claudeSignIn?.state).toBe('retrying')
    applyEvent(state, refused)
    const restated = `turn failed: ${refused.message}`
    applyEvent(state, { type: 'error', message: restated, fatal: false })
    applyEvent(state, { type: 'turn', state: 'failed', wordOf: 'this-app' })
    const [notice] = notices(state.items)
    expect(notices(state.items)).toHaveLength(1)
    expect(notice?.id).toBe(id)
    expect(notice?.claudeSignIn).toEqual({
      state: 'refused',
      details: [
        retry(1).message,
        retry(2).message,
        refused.message,
        restated,
        `turn failed — ${THE_APPS_OWN_WORD}`,
      ],
    })
    expect(state.ended).toBe(true)
  })

  it('does not leave a retry running after a successful turn', () => {
    const state = transcript()
    applyEvent(state, retry(1))
    applyEvent(state, { type: 'turn', state: 'completed' })
    expect(notices(state.items)[0]).toMatchObject({
      text: 'Claude sign-in recovered.',
      level: 'info',
      claudeSignIn: { state: 'recovered' },
    })
    expect(visibleItems('normal', state.items)).toHaveLength(0)
  })

  it.each(['error_max_turns', 'error_during_execution'])(
    'keeps a distinct %s failure visible after a sign-in retry',
    (reason) => {
      const state = transcript()
      applyEvent(state, retry(1))
      applyEvent(state, { type: 'error', message: `turn failed: ${reason}`, fatal: false })
      applyEvent(state, { type: 'turn', state: 'failed' })
      expect(
        visibleItems('normal', state.items).map((item) =>
          item.kind === 'notice' ? item.text : '',
        ),
      ).toEqual([reason, 'turn failed'])
      expect(notices(state.items)[0]?.claudeSignIn?.state).toBe('ended')
      expect(notices(state.items).some((item) => item.claudeSignIn?.state === 'refused')).toBe(
        false,
      )
    },
  )

  it('a bare failed ending settles a retry without claiming an authentication failure', () => {
    const state = transcript()
    applyEvent(state, retry(1))
    applyEvent(state, { type: 'turn', state: 'failed' })
    expect(notices(state.items)[0]?.claudeSignIn?.state).toBe('ended')
    expect(
      visibleItems('normal', state.items).map((item) => (item.kind === 'notice' ? item.text : '')),
    ).toEqual(['turn failed'])
  })

  it('Stop during backoff settles the retry and retains the interruption', () => {
    const state = transcript()
    applyEvent(state, retry(1))
    applyEvent(state, { type: 'turn', state: 'interrupted' })
    expect(notices(state.items)[0]).toMatchObject({
      text: 'Claude sign-in retry stopped.',
      claudeSignIn: { state: 'ended' },
    })
    expect(notices(state.items)[0]?.claudeSignIn?.details).toContain('turn interrupted')
    expect(
      visibleItems('normal', state.items).map((item) => (item.kind === 'notice' ? item.text : '')),
    ).toEqual(['turn interrupted'])
  })

  it('starts another row for a new user turn and leaves other failures visible', () => {
    const state = transcript()
    applyEvent(state, refused)
    applyEvent(state, { type: 'user_turn', text: 'Try again' })
    applyEvent(state, retry(1))
    applyEvent(state, { type: 'error', message: 'disk full', fatal: false })
    expect(notices(state.items)).toHaveLength(3)
    expect(notices(state.items).at(-1)?.text).toBe('disk full')
  })

  it('keeps API key and Codex failures on their existing remedies', () => {
    const state = transcript()
    applyEvent(state, { ...refused, onAKey: true })
    expect(notices(state.items)[0]?.claudeSignIn).toBeUndefined()
    expect(notices(state.items)[0]?.text).toContain('API key')
    const codex = transcript()
    codex.ref = { ...codex.ref!, provider: 'codex' }
    applyEvent(codex, retry(1))
    expect(notices(codex.items)[0]?.claudeSignIn).toBeUndefined()
  })

  it('marks a rejected current Claude login for sign-in, without Codex launcher advice', () => {
    const state = transcript()
    applyEvent(state, { ...refused, cause: 'auth' })
    const [notice] = notices(state.items)
    expect(notice?.claudeSignIn).toMatchObject({ state: 'refused', needsSignIn: true })
    expect(notice?.text).toContain('Sign in again to continue this conversation')
    expect(notice?.text).not.toContain('Start a new conversation')
  })

  it('hides dev_intent in both conversation modes, retaining other unknown events', () => {
    const state = transcript()
    for (const label of ['dev_intent', 'new-useful-event'])
      applyEvent(state, {
        type: 'unknown',
        provider: 'claude',
        label,
        category: 'unrecognized',
        raw: { type: label },
      })
    expect(state.items).toHaveLength(2)
    for (const mode of ['normal', 'debug'] as const) {
      expect(
        visibleItems(mode, state.items).map((item) => (item.kind === 'unknown' ? item.label : '')),
      ).toEqual(['new-useful-event'])
    }
  })
})

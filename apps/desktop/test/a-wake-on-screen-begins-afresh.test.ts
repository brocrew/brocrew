import { describe, expect, it } from 'vitest'
import type { SessionRef } from '@brobot2/runtime'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  applyEvent,
  createTranscript,
  opensTurn,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * # 🔴 F080 — a turn its provider started, on screen: a quiet line, and a fresh start
 *
 * The transcript fold's `provider_turn` arm does a `user_turn`'s bookkeeping without being a
 * prompt: it says who began the turn, drops the activity pill and the error memory the turn before
 * left, and does not move the Changes pane's turn axis. `transcript.test.ts` only lists the type.
 */

const ref = (provider: 'claude' | 'codex'): SessionRef => ({
  provider,
  sessionId: 'sess-abc',
  cwd: '/tmp/scratch',
  rotation: 0,
})

function feed(state: TranscriptState, ...events: TranscriptEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

const notices = (state: TranscriptState) =>
  state.items.flatMap((item) => (item.kind === 'notice' ? [item] : []))

describe('F080 · a turn its provider started, in the transcript', () => {
  it('🔴 a quiet line naming who began it — the provider, by name', () => {
    const claude = feed(
      createTranscript(),
      { type: 'session', state: 'started', ref: ref('claude') },
      { type: 'provider_turn' },
    )
    // ⚑ The session's own start says its line first; the wake says exactly one more.
    expect(
      notices(claude)
        .filter((one) => one.text.startsWith('turn started by'))
        .map((one) => [one.level, one.text]),
    ).toEqual([['info', 'turn started by Claude itself']])
    expect(notices(claude).at(-1)?.text).toBe('turn started by Claude itself')
    const codex = feed(
      createTranscript(),
      { type: 'session', state: 'started', ref: ref('codex') },
      { type: 'provider_turn' },
    )
    expect(notices(codex).at(-1)?.text).toBe('turn started by Codex itself')
    // ⚑ Before the session has named its provider, it says the agent.
    const unnamed = feed(createTranscript(), { type: 'provider_turn' })
    expect(notices(unnamed).at(-1)?.text).toBe('turn started by the agent itself')
  })

  it('🔴 the activity pill of the turn before does not carry into it', () => {
    const state = feed(
      createTranscript(),
      { type: 'session', state: 'started', ref: ref('claude') },
      { type: 'activity', phase: 'tool', detail: 'Bash' },
    )
    // ⚑ The premise: the pill is up.
    expect(state.activity).toEqual({ phase: 'tool', detail: 'Bash' })
    feed(state, { type: 'provider_turn' })
    expect(state.activity).toBeNull()
  })

  it('🔴 the wake’s own failure is drawn, even when it repeats the turn before’s', () => {
    const before: TranscriptEvent[] = [
      { type: 'session', state: 'started', ref: ref('claude') },
      { type: 'user_turn', text: 'go' },
      { type: 'error', message: 'the model is overloaded', fatal: false },
      { type: 'turn', state: 'failed' },
    ]
    const repeat: TranscriptEvent = {
      type: 'error',
      message: 'turn failed: the model is overloaded',
      fatal: false,
    }
    const said = (state: TranscriptState) =>
      notices(state).filter((one) => one.text === 'the model is overloaded').length

    // ⚑ The control: inside the same turn the restatement is the same failure, said once.
    expect(said(feed(createTranscript(), ...before, repeat))).toBe(1)
    // ⛔ A wake is a new turn: its failure is its own, and is said.
    expect(said(feed(createTranscript(), ...before, { type: 'provider_turn' }, repeat))).toBe(2)
  })

  it('⛔ it is no prompt: the Changes pane’s turn axis does not move for it', () => {
    expect(opensTurn({ type: 'provider_turn' })).toBe(false)
    expect(opensTurn({ type: 'user_turn', text: 'go' })).toBe(true)
  })
})

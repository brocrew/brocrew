import { describe, expect, it } from 'vitest'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import {
  REOPENED_FOR_WHAT_WAITED,
  applyEvent,
  createTranscript,
} from '../src/renderer/src/lib/transcript'

/**
 * # ⚑ A conversation this app reopens by itself says so, and says why
 *
 * Landing coverage for `reopened.because`. A person's Reopen and a wake say nothing more than that the
 * app reopened it; the two reasons the app acts on by itself each draw their own line. ⚑ For a moved
 * sign-in the line names the one cost the reopen paid — its “Allow for this conversation”
 * approvals are gone — so a reader who sees the agent ask again knows why.
 */

const notices = (state: ReturnType<typeof createTranscript>) =>
  state.items.filter((item) => item.kind === 'notice')

describe('the transcript line for a reopen', () => {
  it('🔴 a reopen for what waited draws one warning that names the cost', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'reopened', because: 'the-sign-in-moved-on' })
    expect(notices(state)).toMatchObject([{ level: 'warn', text: REOPENED_FOR_WHAT_WAITED }])
    expect(REOPENED_FOR_WHAT_WAITED).toContain('“Allow for this conversation” approvals')
    expect(REOPENED_FOR_WHAT_WAITED).toContain('to deliver what was waiting for it')
  })

  it('⚑ …and the control: a plain reopen draws no such line', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'reopened' })
    expect(notices(state).map((item) => item.text)).not.toContain(REOPENED_FOR_WHAT_WAITED)
  })
})

describe('what a reader of the ledger is told a reopen was', () => {
  it('🔴 each reason has its own words, and every one says the app did it', () => {
    const plain = describeEvent({ type: 'reopened' })
    const renewed = describeEvent({ type: 'reopened', because: 'the-sign-in-was-renewed' })
    const moved = describeEvent({ type: 'reopened', because: 'the-sign-in-moved-on' })
    expect(new Set([plain, renewed, moved]).size).toBe(3)
    expect(plain).toBe('this app reopened this conversation (ours)')
    expect(renewed).toContain('on a renewed sign-in')
    expect(moved).toContain('on the current sign-in, for what waited for it')
    for (const said of [plain, renewed, moved]) expect(said).toContain('(ours)')
  })
})

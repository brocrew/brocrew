import { describe, expect, it } from 'vitest'
import {
  agentStateOf,
  agentStateWords,
  NOTHING_IN_THE_BACKGROUND,
  NOTHING_SCHEDULED,
  type AgentStateFacts,
} from '../src/shared/agent-state'
import { clockTime } from '../src/shared/clock'

/**
 * A giver whose helper stopped with a piece open (its turn ended, nothing in flight, nothing asked)
 * reads "W6.4.1 with Quinn: stopped at 00:28", not "waiting on Quinn". A helper still at work reads
 * as today.
 */

const AT = new Date(2026, 9, 9, 0, 28).getTime()

const facts = (over: Partial<AgentStateFacts>): AgentStateFacts => ({
  needsYou: false,
  active: false,
  waitingOnTheAnswerOf: null,
  owesAnAnswerTo: [],
  background: NOTHING_IN_THE_BACKGROUND,
  scheduled: NOTHING_SCHEDULED,
  waitingOnTheWorkOf: [],
  ...over,
})

describe('a helper that stopped with a given piece open', () => {
  it('is said as stopped, with its piece, its holder and the time it stopped', () => {
    const state = agentStateOf(
      facts({ stoppedWork: [{ label: 'W6.4.1', holder: 'Quinn', at: AT }] }),
      AT + 60_000,
    )
    expect(state.is).toBe('waiting-on-a-worker')
    expect(agentStateWords(state)).toBe(`W6.4.1 with Quinn: stopped at ${clockTime(AT)}`)
  })

  it('counts the other holders, stopped or still at work, after the stopped one', () => {
    const state = agentStateOf(
      facts({
        waitingOnTheWorkOf: ['Remy'],
        stoppedWork: [{ label: 'W6.4.1', holder: 'Quinn', at: AT }],
      }),
      AT + 60_000,
    )
    expect(agentStateWords(state)).toBe(`W6.4.1 with Quinn: stopped at ${clockTime(AT)} +1`)
  })

  it('a helper still at work reads as today', () => {
    const state = agentStateOf(facts({ waitingOnTheWorkOf: ['Remy'] }), AT)
    expect(agentStateWords(state)).toBe('waiting on Remy')
    expect(state.is === 'waiting-on-a-worker' && state.stopped).toBeFalsy()
  })

  it('a question asked outranks a stopped helper, as it outranks one at work', () => {
    const state = agentStateOf(
      facts({
        waitingOnTheAnswerOf: 'Ada (the owner of W1.2 · Build the pages)',
        stoppedWork: [{ label: 'W6.4.1', holder: 'Quinn', at: AT }],
      }),
      AT,
    )
    expect(state.is).toBe('waiting-on-an-answer')
  })
})

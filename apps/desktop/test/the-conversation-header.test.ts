import { describe, expect, it } from 'vitest'
import {
  sessionDoing,
  sessionFacets,
  standingOf,
  STANDINGS,
  STANDING_LABEL,
  STANDING_TONE,
  type AgentFacets,
  type Standing,
} from '../src/renderer/src/lib/agent-state'

describe('the standing vocabulary, and whether anything falls outside it', () => {
  it('TEN standings, ten words, ten tones — and no member without one', () => {
    expect([...STANDINGS]).toEqual([
      'unknown',
      'idle',
      'background',
      'owes',
      'scheduled',
      'elsewhere',
      'stalled',
      'answered',
      'working',
      'waiting',
    ])
    for (const standing of STANDINGS) {
      expect(STANDING_LABEL[standing], `${standing} has no word`).toBeTruthy()
      expect(STANDING_TONE[standing], `${standing} has no tone entry`).toBeDefined()
    }

    expect(new Set(STANDINGS.map((s) => STANDING_LABEL[s])).size).toBe(STANDINGS.length)
  })

  it('every FACET combination lands on a member — the set has no escape', () => {
    const doings = [
      undefined,
      'idle',
      'working',
      'thinking',
      'tool',
      'compacting',
      'replying',
      'unknown',
    ] as const
    const beings = [
      undefined,
      'unstarted',
      'starting',
      'live',
      'silent',
      'closing',
      'ended',
      'errored',
    ] as const
    const needings = [undefined, 'permission', 'question', 'proposal', 'plan'] as const

    const waits = [
      undefined,
      'waiting-on-an-answer',
      'waiting-on-a-person',
      'waiting-on-a-worker',
    ] as const

    const works = [undefined, { state: 'stalled' }, { state: 'answered', outcome: 'done' }] as const
    const seen = new Set<Standing>()
    for (const doing of doings)
      for (const being of beings)
        for (const needing of needings)
          for (const detached of [false, true])
            for (const scheduled of [false, true])
              for (const waiting of waits)
                for (const work of works)
                  for (const owes of [
                    undefined,
                    ['Ada (the owner of W1.2 · The pages)'],
                  ] as const) {
                    const facets = {
                      doing,
                      being,
                      needing,
                      detached,
                      scheduled,
                      waiting,
                      work,
                      ...(owes ? { owes } : {}),
                    } as AgentFacets
                    const standing = standingOf(facets)
                    expect(STANDINGS, `standingOf invented ${standing}`).toContain(standing)
                    expect(STANDING_LABEL[standing]).toBeTruthy()
                    seen.add(standing)
                  }

    expect([...seen].sort()).toEqual([...STANDINGS].sort())
  })

  it('the quiet word is never the absence of an answer — `unknown` is', () => {
    expect(sessionDoing({ status: undefined } as never)).toBe('unknown')
    expect(sessionDoing({ status: null } as never)).toBe('unknown')
    expect(standingOf({ doing: undefined, being: 'live' })).toBe('unknown')
    expect(STANDING_LABEL.unknown).toBe('Unknown')

    expect(sessionDoing({ status: 'idle' } as never)).toBe('idle')
    expect(standingOf({ doing: 'idle', being: 'live' })).toBe('idle')
    expect(STANDING_LABEL.idle).toBe('Idle')
  })

  it('launcher facets report unknown when no session has arrived', () => {
    expect(
      sessionFacets({
        phase: null,
        status: null,
        activity: null,
        streaming: false,
        liveness: null,
      }),
    ).toEqual({ doing: 'unknown' })
  })
})

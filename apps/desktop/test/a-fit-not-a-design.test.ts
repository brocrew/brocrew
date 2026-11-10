import { describe, expect, it } from 'vitest'
import { ACTIVITY_PHASES, type ActivityPhase } from '../src/shared/what-is-being-done'
import {
  STANDINGS,
  STANDING_LABEL,
  activityLine,
  activityWords,
  sessionFacets,
  standingOf,
  type ActivityLine,
} from '../src/renderer/src/lib/agent-state'
import type { SessionStatus } from '../src/shared/runtime-ipc'

describe('one derivation of the line', () => {
  it('a detail is separated from its word by exactly one space, for every phase', () => {
    const seen = new Set<ActivityPhase>()
    for (const phase of ACTIVITY_PHASES) {
      const line = activityLine({
        phase: null,
        status: 'working',
        activity: { phase, detail: 'Bash' },
        streaming: false,
        liveness: null,
      })
      if (line === null) continue
      seen.add(phase)
      const words = activityWords(line)
      expect(words, `${phase} lost its separator`).toBe(`${line.word} ${line.detail ?? ''}`.trim())
      expect(words, `${phase} doubled its separator`).not.toMatch(/ {2}/)
      if (line.detail !== undefined) {
        expect(words, `${phase} ran its words together`).toContain(' ')
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('no line is an empty string', () => {
    expect(activityWords(null)).toBe('')
  })

  it('one input, one sentence, whatever draws it', () => {
    const line: ActivityLine = { doing: 'tool', word: 'running', detail: 'Read', tone: 'live' }
    expect(activityWords(line)).toBe('running Read')
  })
})

describe('one vocabulary for the standing', () => {
  it('every standing has a word', () => {
    for (const standing of STANDINGS) {
      expect(STANDING_LABEL[standing], standing).toBeTruthy()
    }
    expect(Object.keys(STANDING_LABEL).sort()).toEqual([...STANDINGS].sort())
  })

  it('the mock chips map onto this app words, and two of them do not exist', () => {
    const standingFor = (status: SessionStatus) =>
      standingOf(
        sessionFacets({ phase: null, status, activity: null, streaming: false, liveness: null }),
      )
    expect(STANDING_LABEL[standingFor('working')]).toBe('Active')
    expect(STANDING_LABEL.waiting).toBe('Needs you')
    expect(
      sessionFacets({
        phase: null,
        status: 'waiting_permission',
        activity: null,
        streaming: false,
        liveness: null,
        needing: 'permission',
      }).needing,
    ).toBe('permission')
    expect([...STANDINGS]).not.toContain('awaiting-reply')
  })
})

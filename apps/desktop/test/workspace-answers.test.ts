import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceAnswers } from '../src/main/runtime/host-split/workspace-answers'

describe('workspace answer retention during reentrant reads', () => {
  let version: number
  let overtaken: boolean
  let answers: WorkspaceAnswers

  beforeEach(() => {
    version = 0
    overtaken = false
    answers = new WorkspaceAnswers({
      checkCommitted: vi.fn(),
      overtaken: () => overtaken,
      personsVersion: () => version,
      listingVersion: () => 0,
    })
  })

  it('returns a composition that moved its version without retaining it or asking completeness', () => {
    const first = { rows: ['before the move'] }
    const complete = vi.fn(() => true)
    expect(
      answers.forAPerson(
        'queue',
        () => {
          version++
          return first
        },
        complete,
      ),
    ).toBe(first)
    expect(complete).not.toHaveBeenCalled()

    const next = { rows: ['after the move'] }
    expect(answers.forAPerson('queue', () => next, complete)).toBe(next)
    const fallback = vi.fn(() => first)
    expect(answers.forAPerson('queue', fallback)).toBe(next)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('composes an overtaken snapshot afresh without reusing or replacing the kept answer', () => {
    const kept = { rows: ['kept answer'] }
    expect(answers.forAPerson('queue', () => kept)).toBe(kept)

    overtaken = true
    const overtakenAnswer = { rows: ['overtaken answer'] }
    expect(answers.forAPerson('queue', () => overtakenAnswer)).toBe(overtakenAnswer)

    overtaken = false
    const fallback = vi.fn(() => ({ rows: ['replacement'] }))
    expect(answers.forAPerson('queue', fallback)).toBe(kept)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('propagates a throwing composition and keeps an answer retained by its nested read', () => {
    const nested = { rows: ['nested answer'] }
    const failure = new Error('composition failed')
    expect(() =>
      answers.forAPerson('queue', () => {
        answers.forAPerson('queue', () => nested)
        throw failure
      }),
    ).toThrow(failure)

    const fallback = vi.fn(() => ({ rows: ['replacement'] }))
    expect(answers.forAPerson('queue', fallback)).toBe(nested)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('propagates a throwing predicate and keeps an answer retained during composition', () => {
    const nested = { rows: ['nested answer'] }
    const failure = new Error('completeness failed')
    expect(() =>
      answers.forAPerson(
        'queue',
        () => {
          answers.forAPerson('queue', () => nested)
          return { rows: ['outer answer'] }
        },
        () => {
          throw failure
        },
      ),
    ).toThrow(failure)

    const fallback = vi.fn(() => ({ rows: ['replacement'] }))
    expect(answers.forAPerson('queue', fallback)).toBe(nested)
    expect(fallback).not.toHaveBeenCalled()
  })
})

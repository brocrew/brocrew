import { describe, expect, it } from 'vitest'
import { refusalForDisplay } from '../src/claude/refusal-presentation'

describe('Claude supplies its refusal advice', () => {
  it('uses the model and versions actually reported with an update remedy', () => {
    expect(refusalForDisplay({
      is: 'model-needs-a-newer-cli', model: 'fictional-fern', needs: '9.2.0', runs: '9.1.0',
    })).toBe('fictional-fern needs Claude Code 9.2.0 or newer, and this app runs Claude ' +
      'Code 9.1.0. Update Claude Code, or choose another model for this conversation.')
  })

  it('states the reported output limit without repeating native environment advice', () => {
    expect(refusalForDisplay({ is: 'reply-cut-at-its-output-limit', limit: '1234' }))
      .toBe('The reply was cut off at its output limit of 1234 tokens.')
  })

  it('leaves unknown and malformed refusals to their original diagnostic', () => {
    for (const refusal of [null, undefined, { is: 'future-fern' },
      { is: 'model-needs-a-newer-cli', model: 'fern', needs: 9, runs: '8' },
      { is: 'reply-cut-at-its-output-limit', limit: 1234 }]) {
      expect(refusalForDisplay(refusal)).toBeNull()
    }
  })
})

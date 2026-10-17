import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'

/**
 * # 🔴 F081 · housekeeping frames stored before they were quiet stay quiet
 *
 * Claude's `command_lifecycle` (before 2026-10-03 15:28), `vcs_state_changed` and `ping` keepalive
 * frames were stored as `unknown` rows of category `unrecognized`, and drew as grey "Unmodeled
 * event" cards in normal mode. ⚑ The fold reads them by their label as quiet lifecycle frames:
 * hidden outside debug mode, shown in it. A frame no label names is still a card.
 */

const unknownRow = (label: string): RuntimeEvent =>
  ({ type: 'unknown', provider: 'claude', category: 'unrecognized', label, raw: '{}' }) as never

const folded = (label: string) => {
  const state = createTranscript()
  applyEvent(state, unknownRow(label))
  const item = state.items.at(-1)!
  return item
}

describe('F081 · old housekeeping frames stay quiet', () => {
  for (const label of ['command_lifecycle', 'vcs_state_changed', 'ping (incomplete)']) {
    it(`⚑ ${label}: hidden in normal mode, shown in debug mode`, () => {
      const item = folded(label)
      expect(item).toMatchObject({ kind: 'unknown', category: 'lifecycle', label })
      expect(isVisibleIn('normal', item)).toBe(false)
      expect(isVisibleIn('debug', item)).toBe(true)
    })
  }

  it('⛔ a frame no label names is still an unmodeled card in normal mode', () => {
    const item = folded('something_new')
    expect(item).toMatchObject({ kind: 'unknown', category: 'unrecognized' })
    expect(isVisibleIn('normal', item)).toBe(true)
  })
})

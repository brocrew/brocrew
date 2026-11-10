import { describe, expect, it } from 'vitest'
import { SUPPORTED_PROVIDERS, capabilitiesFor } from '@brobot2/runtime'

function declaredNote(provider: (typeof SUPPORTED_PROVIDERS)[number]): string {
  const status = capabilitiesFor(provider).approvals
  if (status.state !== 'available') throw new Error(`${provider}.approvals is not available`)
  return status.note ?? ''
}

describe('every provider declares what this mode does, and the two answers differ', () => {
  it('both declare `approvals` available with a note that says something', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const note = declaredNote(provider)
      expect(note.trim().length, provider).toBeGreaterThan(60)
      expect(note, provider).toMatch(/[a-z]{3,} [a-z]{2,}/i)
    }
  })

  it('the two notes are different, which is the whole reason the entry exists', () => {
    const notes = SUPPORTED_PROVIDERS.map(declaredNote)
    expect(new Set(notes).size, 'one sentence for both is the defect').toBe(notes.length)
  })

  it('each note carries the clause its own adapter measured, and NOT the other one’s', () => {
    const codex = declaredNote('codex')
    expect(codex, 'the sandbox mode Codex is actually started with').toContain('danger-full-access')
    expect(codex, 'what it writes unasked').toMatch(/your folder and the temporary folders/i)
    expect(codex, 'the write bound').toMatch(/anywhere else .* unless you approve it/i)
    expect(codex, 'not read-only’s bound').not.toMatch(/cannot write outside your folder/i)
    expect(codex, 'the network bound').toMatch(/network/i)
    expect(codex, 'reads are not narrowed by either mode').toMatch(/limits what it can read/i)

    const claude = declaredNote('claude')
    expect(claude).toMatch(/nothing is sandboxed in either mode/i)
    expect(claude).toMatch(/card/i)
    expect(claude, 'the note names no app path check').not.toMatch(
      /check left|shell command|refus/i,
    )
    expect(claude, 'Claude is never started with a Codex sandbox mode').not.toContain(
      'danger-full-access',
    )
  })
})

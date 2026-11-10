import { describe, expect, it } from 'vitest'
import { readableError } from '../src/renderer/src/lib/session-record'

/* ── §3 · and it strips the wrapper a running app really produces ──────────────────────────── */

describe('427 §4 · §3 the wrapper, as a live app writes it', () => {
  /**
   * 🔴 **Measured, not invented.** These are the exact strings `427`'s `probe:two-doors` read off
   * the renderer of a running build — the reason this dispatch exists is that no fake bridge in
   * this repo produces them.
   */
  const LIVE = [
    "Error invoking remote method 'runtime:command': Error: cwd does not exist: /private/var/folders/2k/x/T/b2-doors-work-XfKaiF/moved-away",
    "Error invoking remote method 'runtime:command': Error: There is already an agent called archivist. An agent's name is its identity, so it cannot be reused — and names are compared without case, because a profile is its folder.",
  ] as const

  it('🔴 strips both halves of the wrapper — the method and the class name', () => {
    expect(readableError(new Error(LIVE[0]))).toBe(
      'cwd does not exist: /private/var/folders/2k/x/T/b2-doors-work-XfKaiF/moved-away',
    )
    expect(readableError(new Error(LIVE[1]))).toBe(
      "There is already an agent called archivist. An agent's name is its identity, so it cannot " +
        'be reused — and names are compared without case, because a profile is its folder.',
    )
  })

  it('⚠️ the control: a message that never went through the wire is left exactly alone', () => {
    // ⛔ Without this the test above passes for a `readableError` that returns `''`, and passes
    // for one that strips the first colon-delimited clause of every sentence in the app.
    const ours = 'There is no project called default.'
    expect(readableError(new Error(ours))).toBe(ours)
    expect(readableError(ours)).toBe(ours)
  })
})

import { describe, expect, it } from 'vitest'
import { readableError } from '../src/renderer/src/lib/session-record'

describe('a refusal from the main process reads without the IPC wrapper', () => {
  // Exact strings read off the renderer of a running build.
  const LIVE = [
    "Error invoking remote method 'runtime:command': Error: cwd does not exist: /private/var/folders/2k/x/T/b2-doors-work-XfKaiF/moved-away",
    "Error invoking remote method 'runtime:command': Error: There is already an agent called archivist. An agent's name is its identity, so it cannot be reused — and names are compared without case, because a profile is its folder.",
  ] as const

  it('strips both halves of the wrapper — the method and the class name', () => {
    expect(readableError(new Error(LIVE[0]))).toBe(
      'cwd does not exist: /private/var/folders/2k/x/T/b2-doors-work-XfKaiF/moved-away',
    )
    expect(readableError(new Error(LIVE[1]))).toBe(
      "There is already an agent called archivist. An agent's name is its identity, so it cannot " +
        'be reused — and names are compared without case, because a profile is its folder.',
    )
  })

  it('leaves a message that never went through the wire exactly alone', () => {
    const ours = 'There is no project called default.'
    expect(readableError(new Error(ours))).toBe(ours)
    expect(readableError(ours)).toBe(ours)
  })
})

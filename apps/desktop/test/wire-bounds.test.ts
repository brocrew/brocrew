import { describe, expect, it } from 'vitest'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { LIBRARY_QUERY_MAX, MAX_PATH_CHARS } from '../src/shared/runtime-ipc'

describe('221 §3 · and the wire still refuses past the bound', () => {
  it('an action answer note accepts 1,280 characters and refuses the next one', () => {
    const answer = (note: string) => ({
      kind: 'answerAction',
      sessionId: 'fictional-session',
      request: 'fictional-request',
      done: true,
      note,
    })
    expect(runtimeCommandSchema.safeParse(answer('n'.repeat(1_280))).success).toBe(true)
    expect(runtimeCommandSchema.safeParse(answer('n'.repeat(1_281))).success).toBe(false)
  })

  it('🔴 accepts a value AT the ceiling and refuses one past it, on all three fields', () => {
    const ok = (command: unknown): boolean => runtimeCommandSchema.safeParse(command).success

    expect(ok({ kind: 'listLibrary', query: 'q'.repeat(LIBRARY_QUERY_MAX) })).toBe(true)
    expect(ok({ kind: 'listLibrary', query: 'q'.repeat(LIBRARY_QUERY_MAX + 1) })).toBe(false)

    expect(ok({ kind: 'checkCwd', path: '/'.repeat(MAX_PATH_CHARS) })).toBe(true)
    expect(ok({ kind: 'checkCwd', path: '/'.repeat(MAX_PATH_CHARS + 1) })).toBe(false)

    const bundle = (path: string) => ({ kind: 'importBundleFile', path })
    expect(ok(bundle('/'.repeat(MAX_PATH_CHARS)))).toBe(true)
    expect(ok(bundle('/'.repeat(MAX_PATH_CHARS + 1)))).toBe(false)
    // ⚠️ …and the `min(1)` beside it, which the restore button gates but the wire must still hold.
    expect(ok(bundle(''))).toBe(false)
  })
})

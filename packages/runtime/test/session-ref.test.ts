import { describe, expect, it } from 'vitest'
import {
  parseSessionRef,
  serializeSessionRef,
  sessionRefSchema,
  type SessionRef,
} from '../src/index'

const ref: SessionRef = {
  provider: 'codex',
  sessionId: 'thread_abc',
  cwd: '/tmp/scratch',
  rotation: 2,
}

describe('SessionRef', () => {
  it('validates a well-formed ref', () => {
    expect(sessionRefSchema.safeParse(ref).success).toBe(true)
  })

  it('round-trips through serialize → deserialize', () => {
    const restored = parseSessionRef(serializeSessionRef(ref))
    expect(restored).toEqual(ref)
  })

  it('round-trips through plain JSON (it is a plain object)', () => {
    expect(parseSessionRef(JSON.stringify(ref))).toEqual(ref)
  })

  it('rejects malformed refs', () => {
    expect(sessionRefSchema.safeParse({ ...ref, provider: 'gemini' }).success).toBe(false)
    expect(sessionRefSchema.safeParse({ ...ref, sessionId: '' }).success).toBe(false)
    expect(sessionRefSchema.safeParse({ ...ref, rotation: -1 }).success).toBe(false)
    expect(sessionRefSchema.safeParse({ ...ref, cwd: undefined }).success).toBe(false)
  })

  it('throws when deserializing a corrupt ref (never silently resumable)', () => {
    expect(() => parseSessionRef('{"provider":"claude"}')).toThrow()
  })
})

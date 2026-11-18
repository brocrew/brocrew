import { describe, expect, it } from 'vitest'
import { waitOnSays } from '../src/renderer/src/lib/work-waits'
import { clockTime, clockTimeFrom } from '../src/shared/clock'

/** A wait until a time says the day too when that time is not today, so it never reads overdue. */
describe('a wait until a time', () => {
  const now = new Date(2026, 10, 10, 15, 17).getTime()

  it('says only the time when it is today', () => {
    const at = new Date(2026, 10, 10, 18, 0).getTime()
    expect(waitOnSays({ kind: 'time', at }, undefined, now)).toBe(`waiting until ${clockTime(at)}`)
  })

  it('says the day and the time when it is another day', () => {
    const at = new Date(2026, 10, 12, 13, 0).getTime()
    const said = waitOnSays({ kind: 'time', at }, undefined, now)
    expect(said).toBe(`waiting until ${clockTimeFrom(at, now)}`)
    expect(said).not.toBe(`waiting until ${clockTime(at)}`)
    expect(said).toContain('12')
  })
})

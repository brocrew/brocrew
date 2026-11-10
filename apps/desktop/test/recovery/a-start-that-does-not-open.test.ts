import { afterEach, describe, expect, it } from 'vitest'
import { readTheSystemZoneNow } from '../../src/main/system-zone'

describe('the recovery window’s time zone', () => {
  const zone = process.env['TZ']
  afterEach(() => {
    if (zone === undefined) delete process.env['TZ']
    else process.env['TZ'] = zone
  })

  it('is the zone `TZ` names, or nothing when it cannot be read', () => {
    process.env['TZ'] = ':'
    expect(readTheSystemZoneNow()).toEqual({
      before: 0,
      changes: [],
      rule: { standard: 0, daylight: null },
    })
    process.env['TZ'] = '/not/a/zone/name'
    expect(readTheSystemZoneNow()).toBeNull()
  })
})

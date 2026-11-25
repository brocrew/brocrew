import { describe, expect, it } from 'vitest'
import { providerStopNotice } from '../src/renderer/src/lib/live-signal'
import { providerLimitsView, type ProviderLimitsView } from '../src/renderer/src/lib/persons-queue'
import {
  PROVIDER_LIMIT_SAYS,
  foldProviderLimits,
  readProviderLimit,
  type LimitStanding,
  type ProviderLimitSeen,
} from '../src/shared/provider-limit'

describe('the rail provider notice', () => {
  const CLAUDE_STOPPED = 'claude is rate-limited (seven_day); resets 2026-09-23T11:00:00.000Z'
  const CODEX_STOPPED =
    'codex is rate-limited (weekly) on the GPT-5.3-Codex-Spark limit; resets 2026-09-20T21:10:56.000Z'
  /** ⚑ `533` §0's own claude line, verbatim — the `about-to-stop` control. */
  const CLAUDE_APPROACHING =
    'claude is approaching its rate limit (seven_day); resets 2026-09-23T11:00:00.000Z'

  /** ⛔ Before either reset, so both walls stand. */
  const WALL_NOW = Date.UTC(2026, 8, 18, 12, 0, 0)

  const seen = (said: string): ProviderLimitSeen => {
    const wall = readProviderLimit(said, WALL_NOW - 60_000)
    // ⛔ **Asserted rather than cast** — `a-wall-he-finds-out-about.test.ts`' helper and its reason:
    // a `null` here would make every assertion below run over an empty list and pass.
    expect(wall, `not recognised as a wall: ${said}`).not.toBeNull()
    return wall as ProviderLimitSeen
  }

  /**
   * ⚑ **The BAND's own view, through the band's own function** — never a `ProviderCondition`
   * assembled by hand. ⛔ `HO-080` §4 says the rail is a second PLACE for the fact; a fixture that
   * spelled the condition here would make it a second ANSWER, which is the thing the ruling
   * forbids.
   */
  const band = (said: readonly string[], answered = true): ProviderLimitsView => {
    const view = providerLimitsView(
      {
        rows: foldProviderLimits(said.map(seen), [], WALL_NOW),
        walk: 'every-provider-wall-recently-recorded' as const,
        ledgers: 1,
        rowsUnread: 0,
      },
      answered,
      WALL_NOW,
    )
    expect(view, 'the band answered nothing to fold').not.toBeNull()
    return view as ProviderLimitsView
  }

  it('shows stopped providers in the limits view order with their full hover details', () => {
    const limits = band([CLAUDE_STOPPED, CODEX_STOPPED])
    const notice = providerStopNotice(limits)
    expect(notice?.text).toBe('Codex and Claude stopped')
    for (const wall of limits.walls) expect(notice?.title).toContain(wall.says)
    expect(notice?.title).toContain('It comes back')
    expect(notice?.text).not.toContain('It comes back')
  })

  it('omits the notice when the read answered and nothing has stopped', () => {
    expect(providerStopNotice({ walls: [], unread: false })).toBeNull()
    const approaching = band([CLAUDE_APPROACHING])
    expect(approaching.walls).toHaveLength(1)
    expect(providerStopNotice(approaching)).toBeNull()
    expect(providerStopNotice(band([CLAUDE_STOPPED]))?.text).toBe('Claude stopped')
  })

  it('draws only the standings that stop work', () => {
    const events: Record<LimitStanding, string> = {
      'about-to-stop': CLAUDE_APPROACHING,
      stopped: CLAUDE_STOPPED,
    }
    const visible = Object.keys(PROVIDER_LIMIT_SAYS).filter((key) => {
      const standing = key as LimitStanding
      const limits = band([events[standing]])
      expect(limits.walls[0]?.standing).toBe(standing)
      return providerStopNotice(limits) !== null
    })
    expect(visible).toEqual(['stopped'])
  })

  it('marks a missing read and keeps a previously reported stop under partial coverage', () => {
    for (const limits of [null, { walls: [], unread: true }]) {
      const notice = providerStopNotice(limits)
      expect(notice?.text).toBe('nothing stopped*')
      expect(notice?.title).toContain('the read that finds a walled provider did not answer')
      expect(notice?.title).not.toContain('Some rows could not be read')
    }
    const notice = providerStopNotice(band([CLAUDE_STOPPED], false))
    expect(notice?.text).toBe('Claude stopped*')
    expect(notice?.title).toContain('Work on Claude has stopped.')
    expect(notice?.title).toContain('the read that finds a walled provider did not answer')
  })
})

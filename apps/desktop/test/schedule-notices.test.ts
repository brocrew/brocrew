import { describe, expect, it } from 'vitest'
import { scheduleNoticesText, type NoticeAboutAJob } from '../src/main/runtime/runtime-host'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import { local } from './lib/scheduled-wall-time'

const DUE = local(9, 28, 14, 45)

/* ══════════════════ what a conversation is told of its jobs ══════════════════ */

describe('D-029 · what a conversation is told of its scheduled jobs', () => {
  const now = local(9, 28, 15, 0)
  const passed = (prompt: string | undefined, dueAt: number | null = DUE): NoticeAboutAJob => ({
    reason: 'offline-time-passed',
    dueAt,
    ...(prompt === undefined ? {} : { prompt }),
  })
  const gone = (prompt: string | undefined, dueAt: number | null = DUE): NoticeAboutAJob => ({
    ...passed(prompt, dueAt),
    reason: 'not-present',
  })
  const PASSED_ONE =
    'was due while this conversation was stopped. This app cannot tell whether it ran: check whether its work is still needed.'
  const PASSED_MANY =
    'were due while this conversation was stopped. This app cannot tell whether they ran: check whether their work is still needed.'
  const GONE_ONE =
    'is no longer on your schedule. This app cannot tell whether it ran or was cancelled.'

  it('each kind in a plain sentence, each job by its minute and the first line it asked', () => {
    const t1 = clockTime(DUE)
    const t2 = clockTime(local(9, 28, 14, 50))
    const t3 = clockTime(local(9, 28, 14, 55))
    expect(t1).not.toBe('')
    expect(t1).not.toBe(t2)

    // One, two and three whose time passed.
    expect(scheduleNoticesText([passed('check the deploy')], now)).toBe(
      `Your scheduled job for ${t1} (“check the deploy”) ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed('a'), passed('b', local(9, 28, 14, 50))], now)).toBe(
      `Your scheduled jobs for ${t1} (“a”) and for ${t2} (“b”) ${PASSED_MANY}`,
    )
    expect(
      scheduleNoticesText(
        [passed('a'), passed('b', local(9, 28, 14, 50)), passed('c', local(9, 28, 14, 55))],
        now,
      ),
    ).toBe(
      `Your scheduled jobs for ${t1} (“a”), for ${t2} (“b”) and for ${t3} (“c”) ${PASSED_MANY}`,
    )
    // Two kinds: a sentence each, one space between, whatever order they came in.
    expect(scheduleNoticesText([gone('b', local(9, 28, 14, 50)), passed('a')], now)).toBe(
      `Your scheduled job for ${t1} (“a”) ${PASSED_ONE} Your scheduled job for ${t2} (“b”) ${GONE_ONE}`,
    )
    // ⛔ It never says a job did not run: nothing public says which turn a job began.
    for (const reason of [
      'offline-time-passed',
      'recurring-offline-interval',
      'not-present',
      'expired-on-resume',
      'compaction-confirmed',
    ] as const) {
      const said = scheduleNoticesText([{ reason, dueAt: DUE, prompt: 'p' }], now)
      expect(said, reason).toContain(`Your scheduled job for ${t1} (“p”) `)
      expect(said, reason).not.toMatch(/did not run|will not run|never ran/)
    }
    // Nothing to tell, nothing said.
    expect(scheduleNoticesText([], now)).toBe('')

    // A job due yesterday says its day; one due today does not.
    const yesterday = local(9, 27, 14, 45)
    expect(clockTimeFrom(yesterday, now)).not.toBe(clockTime(yesterday))
    expect(scheduleNoticesText([passed('a', yesterday)], now)).toContain(
      `for ${clockTimeFrom(yesterday, now)} (“a”)`,
    )
    expect(clockTimeFrom(DUE, now)).toBe(clockTime(DUE))

    // Only the first line of what it asked is told, whatever its line breaks.
    const manyLines = scheduleNoticesText([passed('first line\r\nsecond line')], now)
    expect(manyLines).toContain('(“first line”)')
    expect(manyLines).not.toContain('second line')
    // Eighty code points are told whole; the eighty-first is the cut, marked with an ellipsis.
    expect(scheduleNoticesText([passed('😀'.repeat(80))], now)).toContain(`(“${'😀'.repeat(80)}”)`)
    const cut = scheduleNoticesText([passed('😀'.repeat(81))], now)
    expect(cut).toContain(`(“${'😀'.repeat(80)}…”)`)
    expect(cut).not.toContain('😀'.repeat(81))

    // A clause is left out when the fact behind it is absent, and present when it is not.
    expect(scheduleNoticesText([passed('p', null)], now)).toBe(
      `Your scheduled job (“p”) ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed(undefined)], now)).toBe(
      `Your scheduled job for ${t1} ${PASSED_ONE}`,
    )
    expect(scheduleNoticesText([passed(undefined, null)], now)).toBe(
      `Your scheduled job ${PASSED_ONE}`,
    )
  })
})

import { describe, expect, it } from 'vitest'
import {
  cronMatches,
  createIntlCalendar,
  formatCalendarTime,
  eligibilityBounds,
  eligibilityWithOffset,
  nextCronOccurrence,
  oneShotsThatCameDue,
  parseCron,
  planJobWake,
  reconcileScheduleReport,
  readCalendarMinute,
  whatAStartBringsBack,
  type LocalMinute,
  type CalendarSource,
  type ScheduleLevel,
  type WakeJob,
} from '../src/shared/schedule-wake'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const epoch = (text: string) => Date.parse(text)
const local = (text: string): LocalMinute => {
  const date = new Date(text)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  }
}
function matches(expression: string, text: string): boolean {
  const parsed = parseCron(expression)
  expect(parsed.kind).toBe('valid')
  if (parsed.kind !== 'valid') throw new Error('fixture grammar')
  return cronMatches(parsed.cron, local(text))
}
function next(
  expression: string,
  after: string,
  options: {
    inclusive?: boolean
    zone?: string
    calendar?: CalendarSource
    budget?: number
    horizonAt?: number
  } = {},
) {
  return nextCronOccurrence(expression, {
    after: epoch(after),
    inclusive: false,
    zone: 'UTC',
    ...options,
  })
}
function expectAt(result: ReturnType<typeof next>, expected: string) {
  expect(result.kind).toBe('known')
  if (result.kind !== 'known') throw new Error(JSON.stringify(result))
  expect(new Date(result.nominalAt).toISOString()).toBe(expected)
  return result
}
const now = epoch('2026-10-07T10:00:00Z')
const planOptions = { now, wakeLeadMs: 30_000, zone: 'UTC' }
const levelOf = (jobs: readonly WakeJob[], dropped = 0): ScheduleLevel => ({ jobs, dropped })
const oneShot = (minute: number = 0): WakeJob => ({
  id: 'synthetic',
  recurring: false,
  schedule: `${minute} 11 * * *`,
  evidence: { originalNominalAt: epoch(`2026-10-07T11:${String(minute).padStart(2, '0')}:00Z`) },
})
const recurring = (schedule: string, createdAt = now - DAY): WakeJob => ({
  id: 'repeat',
  recurring: true,
  schedule,
  evidence: { createdAt },
})

describe('documented numeric cron grammar (D6/V)', () => {
  it.each([
    ['* * * * *', '2026-01-01T00:00:00Z', true],
    ['0 0 1 1 *', '2026-01-01T00:00:00Z', true],
    ['59 23 31 12 *', '2026-12-31T23:59:00Z', true],
    ['0 0 * * 0', '2026-10-11T00:00:00Z', true],
    ['0 0 * * 7', '2026-10-11T00:00:00Z', true],
    ['0 0 * * 6', '2026-10-10T00:00:00Z', true],
    ['10-15 4-6 8-10 10-12 *', '2026-10-08T04:15:00Z', true],
    ['10-15 4-6 8-10 10-12 *', '2026-10-08T04:16:00Z', false],
    ['5,15 4,6 8,10 10,12 *', '2026-12-10T06:15:00Z', true],
    ['5,15 4,6 8,10 10,12 *', '2026-11-10T06:15:00Z', false],
    ['*/15 */3 * */2 *', '2026-11-10T06:45:00Z', true],
    ['*/15 */3 * */2 *', '2026-12-10T06:45:00Z', false],
    ['5-25/10 2-8/3 1-9/2 2-8/2 *', '2026-04-07T05:15:00Z', true],
    ['0 0 * * 1-5/2', '2026-10-07T00:00:00Z', true],
    ['0 0 * * 1-5/2', '2026-10-08T00:00:00Z', false],
    ['0 0 * * 1-6', '2026-10-10T00:00:00Z', true],
    ['0 0 * * 1-6', '2026-10-11T00:00:00Z', false],
    ['* * * * *', '2026-10-07T10:00:01Z', false],
  ])('%s at %s matches %s', (expression, text, expected) =>
    expect(matches(expression, text)).toBe(expected),
  )

  it('allows blanks and tabs without executing text', () => {
    expect(matches(' \t0\t9  * * 1\t ', '2026-10-12T09:00:00Z')).toBe(true)
    expect(parseCron('$(touch something) * * * *').kind).not.toBe('valid')
  })

  it.each([
    '* * * *',
    '* * * * * *',
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * 32 * *',
    '* * * 0 *',
    '* * * 13 *',
    '* * * * 8',
    '*/0 * * * *',
    '*/-1 * * * *',
    '1,,2 * * * *',
    '-1 * * * *',
    '1.5 * * * *',
  ])('rejects invalid %s', (text) => {
    expect(parseCron(text).kind).toBe('invalid')
    expect(next(text, '2026-10-07T10:00:00Z')).toMatchObject({ kind: 'unknown' })
  })
  it.each([
    '0 0 L * *',
    '0 0 1W * *',
    '0 0 ? * *',
    '0 0 * JAN MON',
    '@daily',
    '5/2 * * * *',
    '50-10 * * * *',
    '01 * * * *',
    '+5 * * * *',
    '*/99 * * * *',
    '*/60 * * * *',
    '* */24 * * *',
    '0 0 *,15 * 1',
    '0 0 */2,15 * 1',
    '0 0 15 * 0,*',
  ])('keeps unsupported %s uncertain', (text) => {
    expect(parseCron(text).kind).toBe('unsupported')
  })
  it('bounds parsing work for oversized expressions', () => {
    expect(parseCron('1,'.repeat(5000) + '1 * * * *')).toMatchObject({
      kind: 'unsupported',
      reason: 'expression size',
    })
  })
  it.each([
    ['0 9 1-31 * 1', '2026-10-07T09:00:00Z', true],
    ['0 9 * * 1', '2026-10-07T09:00:00Z', false],
    ['0 9 15 * 0-7', '2026-10-07T09:00:00Z', true],
    ['0 9 15 * *', '2026-10-07T09:00:00Z', false],
    ['0 9 */1 * 1', '2026-10-07T09:00:00Z', false],
    ['0 9 1-31/1 * 1', '2026-10-07T09:00:00Z', true],
    ['0 9 */2 * 1', '2026-10-05T09:00:00Z', true],
    ['0 9 */2 * 1', '2026-10-12T09:00:00Z', false],
    ['0 9 */2 * 1', '2026-10-07T09:00:00Z', false],
    ['0 9 1-31/2 * 1', '2026-10-12T09:00:00Z', true],
    ['0 9 1-31/2 * 1', '2026-10-07T09:00:00Z', true],
    ['0 9 15 * 0-6', '2026-10-07T09:00:00Z', true],
    ['0 9 15 * 1-7/2', '2026-10-07T09:00:00Z', true],
    ['0 9 15 * */2', '2026-10-15T09:00:00Z', true],
    ['0 9 15 * */2', '2026-11-15T09:00:00Z', true],
    ['0 9 15 * */2', '2026-10-07T09:00:00Z', false],
  ])('retains day-field origin for %s at %s', (expression, text, expected) => {
    expect(matches(expression, text)).toBe(expected)
  })
  it('accepts complete lists and Sunday duplicates without inventing star-origin', () => {
    const days = Array.from({ length: 31 }, (_, index) => index + 1).join(',')
    expect(matches(`0 9 ${days} * 1`, '2026-10-07T09:00:00Z')).toBe(true)
    for (const weekdays of ['0,1,2,3,4,5,6', '0,1,2,3,4,5,6,7', '0-7/1']) {
      expect(matches(`0 9 15 * ${weekdays}`, '2026-10-07T09:00:00Z')).toBe(true)
    }
    const parsed = parseCron('0 9 */1 * 0,7')
    if (parsed.kind !== 'valid') throw new Error('fixture grammar')
    expect(parsed.cron.day).toMatchObject({ starOrigin: true, unrestricted: false })
    expect(parsed.cron.weekday).toMatchObject({ values: [0], starOrigin: false })
    expect(matches('0 9 */1 * 0,7', '2026-10-11T09:00:00Z')).toBe(true)
    expect(matches('0 9 */1 * 0,7', '2026-10-12T09:00:00Z')).toBe(false)
    expectAt(next('* * 31 2 0-7', '2026-02-01T00:00:00Z'), '2026-02-01T00:01:00.000Z')
    expect(next('* * 31 2 */1', '2026-02-01T00:00:00Z').kind).toBe('impossible')
  })
})

describe('calendar days and bounded occurrence search (V/B)', () => {
  it.each([
    ['2026-05-01T04:30:00Z', true],
    ['2026-05-08T04:30:00Z', true],
    ['2026-05-15T04:30:00Z', true],
    ['2026-05-02T04:30:00Z', false],
  ])('uses the restricted day OR rule on %s', (text, expected) => {
    expect(matches('30 4 1,15 * 5', text)).toBe(expected)
  })
  it('a match of both day branches is a single occurrence', () => {
    expectAt(next('30 4 1,15 * 5', '2026-05-01T04:29:59Z'), '2026-05-01T04:30:00.000Z')
    expectAt(next('30 4 1,15 * 5', '2026-05-01T04:30:00Z'), '2026-05-08T04:30:00.000Z')
  })
  it('the unrestricted day branch leaves the other branch in control', () => {
    expect(matches('0 9 * * 1', '2026-10-07T09:00:00Z')).toBe(false)
    expect(matches('0 9 15 * *', '2026-10-07T09:00:00Z')).toBe(false)
    expect(matches('0 9 * * *', '2026-10-07T09:00:00Z')).toBe(true)
  })
  it('proves impossible dates without spending search budget, after applying OR', () => {
    expect(next('* * 31 2 *', '2026-01-01T00:00:00Z', { budget: 0 })).toMatchObject({
      kind: 'impossible',
      work: 0,
    })
    expectAt(next('* * 31 2 1', '2026-02-01T00:00:00Z'), '2026-02-02T00:00:00.000Z')
    expect(next('0 0 31 4,6,9,11 *', '2026-01-01T00:00:00Z').kind).toBe('impossible')
  })
  it('jumps calendar days to the leap date after the nonleap century', () => {
    const result = expectAt(next('0 0 29 2 *', '2096-02-29T00:00:00Z'), '2104-02-29T00:00:00.000Z')
    expect(result.work).toBeLessThan(10_000)
    expect(next('0 0 29 2 *', '2096-02-29T00:00:00Z', { budget: 100 })).toEqual({
      kind: 'unknown',
      reason: 'budget',
      work: 100,
    })
  })
  it.each([
    ['2026-10-07T10:00:00Z', true, '2026-10-07T10:00:00.000Z'],
    ['2026-10-07T10:00:00Z', false, '2026-10-07T10:05:00.000Z'],
    ['2026-10-07T09:59:59.999Z', true, '2026-10-07T10:00:00.000Z'],
    ['2026-10-07T09:59:59.999Z', false, '2026-10-07T10:00:00.000Z'],
    ['2026-10-07T10:00:00.001Z', true, '2026-10-07T10:05:00.000Z'],
  ])('honors %s with inclusive=%s', (after, inclusive, expected) => {
    expectAt(next('*/5 * * * *', after, { inclusive }), expected)
  })
  it('limits horizons and work without inventing impossibility', () => {
    expect(
      nextCronOccurrence('* * * * *', { after: 1e30, inclusive: true, zone: 'America/New_York' }),
    ).toMatchObject({ kind: 'unknown', reason: 'calendar range' })
    expect(next('0 11 * * *', '2026-10-07T10:00:00Z', { budget: 1 })).toEqual({
      kind: 'unknown',
      reason: 'budget',
      work: 1,
    })
    expect(
      next('0 0 29 2 *', '2096-03-01T00:00:00Z', { horizonAt: epoch('2100-03-01T00:00:00Z') }),
    ).toMatchObject({ kind: 'unknown', reason: 'horizon' })
    expect(next('* * * * *', '2026-10-07T10:00:00Z', { budget: 0 })).toMatchObject({
      kind: 'unknown',
      reason: 'budget',
    })
    expect(next('0 0 29 2 *', '2096-03-01T00:00:00Z', { budget: Infinity })).toMatchObject({
      kind: 'unknown',
      reason: 'invalid search bound',
    })
    expect(nextCronOccurrence('* * * * *', { after: NaN, inclusive: true, zone: 'UTC' }).kind).toBe(
      'unknown',
    )
    expect(next('* * * * *', '2026-10-07T10:00:00Z', { zone: 'invalid-zone' })).toMatchObject({
      kind: 'unknown',
      reason: 'invalid zone',
    })
  })
  it.each(['UTC', 'America/New_York'])(
    'rejects finite invalid dates in %s without throwing',
    (zone) => {
      for (const after of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 1e30, -1e30]) {
        expect(nextCronOccurrence('* * * * *', { after, inclusive: true, zone })).toMatchObject({
          kind: 'unknown',
          reason: 'calendar range',
          work: 0,
        })
        expect(
          planJobWake(
            { ...oneShot(), evidence: { originalNominalAt: after } },
            { ...planOptions, zone },
          ),
        ).toMatchObject({ kind: 'unknown', startAt: now })
      }
    },
  )
  it.each(['UTC', 'America/New_York'])('checks rounded calendar bounds in %s', (zone) => {
    const beforeMin = epoch('0099-12-31T23:59:00Z')
    const aboveMax = epoch('9998-12-31T23:59:59.999Z')
    for (const after of [beforeMin, aboveMax]) {
      expect(nextCronOccurrence('* * * * *', { after, inclusive: true, zone })).toMatchObject({
        kind: 'unknown',
        reason: 'calendar range',
        work: 0,
      })
    }
    const supported = epoch('0100-01-02T00:00:00Z')
    const rounded = nextCronOccurrence('* * * * *', {
      after: supported - 1,
      inclusive: false,
      zone,
    })
    expect(rounded).toMatchObject(
      zone === 'UTC'
        ? { kind: 'known', nominalAt: supported }
        : { kind: 'unknown', reason: 'zone precision or offset' },
    )
  })
  it('cross-checks the search traversal with a bounded UTC minute walk', () => {
    for (const expression of ['7,31 4-6 * * *', '*/11 * * * *', '0 9 8 * 5']) {
      const parsed = parseCron(expression)
      if (parsed.kind !== 'valid') throw new Error('fixture grammar')
      const after = epoch('2026-10-07T23:59:00Z')
      let expected = after + MINUTE
      const horizon = after + 2 * DAY
      while (
        expected <= horizon &&
        !cronMatches(parsed.cron, local(new Date(expected).toISOString()))
      )
        expected += MINUTE
      expect(expected).toBeLessThanOrEqual(horizon)
      const result = nextCronOccurrence(expression, { after, inclusive: false, zone: 'UTC' })
      expect(result).toMatchObject({ kind: 'known', nominalAt: expected })
    }
  })
})

describe('explicit timezone and DST calendar semantics (B, not provider fire policy)', () => {
  it('skips the nonexistent New York spring minute', () => {
    const result = expectAt(
      next('30 2 * * *', '2026-03-08T05:00:00Z', { zone: 'America/New_York' }),
      '2026-03-09T06:30:00.000Z',
    )
    expect(result.crossedOffsetChange).toBe(true)
    expect(result.gapAt).toBe(epoch('2026-03-08T07:00:00Z'))
  })
  it('enumerates both New York fold instants in ascending epoch order', () => {
    expectAt(
      next('30 1 * * *', '2026-11-01T04:00:00Z', { zone: 'America/New_York' }),
      '2026-11-01T05:30:00.000Z',
    )
    const second = expectAt(
      next('30 1 * * *', '2026-11-01T05:30:00Z', { zone: 'America/New_York' }),
      '2026-11-01T06:30:00.000Z',
    )
    expect(second.crossedOffsetChange).toBe(true)
  })
  it('handles a half-hour fold and local midnight', () => {
    expectAt(
      next('45 1 * * *', '2026-04-04T14:00:00Z', { zone: 'Australia/Lord_Howe' }),
      '2026-04-04T14:45:00.000Z',
    )
    expectAt(
      next('45 1 * * *', '2026-04-04T14:45:00Z', { zone: 'Australia/Lord_Howe' }),
      '2026-04-04T15:15:00.000Z',
    )
    expectAt(
      next('0 0 * * *', '2026-10-07T19:00:00Z', { zone: 'Asia/Kolkata' }),
      '2026-10-08T18:30:00.000Z',
    )
  })
  it('recomputes after a zone or wall-clock change', () => {
    const job = recurring('0 9 * * *', now)
    const utc = planJobWake(job, planOptions)
    const newYork = planJobWake(job, { ...planOptions, zone: 'America/New_York' })
    expect(utc).toMatchObject({ kind: 'known', nominalAt: epoch('2026-10-08T09:00:00Z') })
    expect(newYork).toMatchObject({ kind: 'known', nominalAt: epoch('2026-10-07T13:00:00Z') })
    expect(planJobWake(job, { ...planOptions, now: epoch('2026-10-08T09:20:00Z') })).toMatchObject({
      startAt: epoch('2026-10-08T09:20:00Z'),
    })
  })
  it('retains the calendar match and requests early reconciliation at a skipped target', () => {
    const beforeGap = epoch('2026-03-08T05:00:00Z')
    expect(
      planJobWake(recurring('30 2 * * *', beforeGap), {
        now: beforeGap,
        wakeLeadMs: 30_000,
        zone: 'America/New_York',
      }),
    ).toMatchObject({
      kind: 'known',
      nominalAt: epoch('2026-03-09T06:30:00Z'),
      reconciliationAt: epoch('2026-03-08T07:00:00Z'),
      executionUncertainty: 'skipped-local-time',
      startAt: epoch('2026-03-08T06:59:30Z'),
    })
  })
})

describe('host calendar normalization and transition fixtures (A13/A15)', () => {
  const shiftedCalendar = (
    offsetAt: (at: number) => number,
    monthBase: 0 | 1 = 1,
  ): CalendarSource => ({
    identity: 'synthetic-host',
    version: 'fixture-1',
    monthBase,
    read(at) {
      const fields = local(new Date(at + offsetAt(at)).toISOString())
      return { ...fields, month: fields.month - (monthBase === 0 ? 1 : 0) }
    },
  })
  const transition = epoch('2026-03-08T07:00:00Z')
  const gapCalendar = () => shiftedCalendar((at) => (at < transition ? -300 : -240) * MINUTE)

  it('uses a zero-based host calendar for planning and display despite divergent Intl data', () => {
    const calendar = shiftedCalendar(() => 120 * MINUTE, 0)
    const after = epoch('2026-10-07T10:00:00Z')
    expectAt(
      next('0 13 * * *', '2026-10-07T10:00:00Z', {
        calendar,
        zone: 'UTC',
      }),
      '2026-10-07T11:00:00.000Z',
    )
    expectAt(
      next('0 13 * * *', '2026-10-07T10:00:00Z', {
        calendar,
        zone: 'invalid-zone',
      }),
      '2026-10-07T11:00:00.000Z',
    )
    expect(readCalendarMinute(after, calendar)).toEqual(local('2026-10-07T12:00:00Z'))
    expect(formatCalendarTime(calendar, after)).toBe('2026-10-07 12:00')
    expect(readCalendarMinute(after, createIntlCalendar('UTC'))?.hour).toBe(10)
    const hostFormatter = { ...calendar, format: () => 'host · 12:00' }
    expect(formatCalendarTime(hostFormatter, after)).toBe('host · 12:00')
  })
  it('does fresh conversion after a calendar-version update', () => {
    let offset = 0
    const calendar = shiftedCalendar(() => offset)
    expectAt(next('0 13 * * *', '2026-10-07T10:00:00Z', { calendar }), '2026-10-07T13:00:00.000Z')
    offset = 2 * 60 * MINUTE
    calendar.version = 'fixture-2'
    expectAt(next('0 13 * * *', '2026-10-07T10:00:00Z', { calendar }), '2026-10-07T11:00:00.000Z')
  })
  it.each([
    { month: 0 },
    { month: 13 },
    { day: 32 },
    { day: 0 },
    { hour: 24 },
    { minute: 60 },
    { second: 60 },
    { year: 99 },
    { weekday: 0 },
    { day: 1.5 },
  ])('returns uncertainty for inconsistent calendar fields %o', (replacement) => {
    const calendar: CalendarSource = {
      identity: 'broken-fixture',
      version: '1',
      monthBase: 1,
      read: () => ({ ...local('2026-10-07T10:00:00Z'), ...replacement }),
    }
    expect(readCalendarMinute(now, calendar)).toBeNull()
    expect(formatCalendarTime(calendar, now)).toBeNull()
    expect(next('* * * * *', '2026-10-07T10:00:00Z', { calendar }).kind).toBe('unknown')
  })
  it('rejects normalized nonexistent dates, excessive offsets and unavailable conversions', () => {
    const nonexistent: CalendarSource = {
      identity: 'broken-date',
      version: '1',
      monthBase: 1,
      read: () => ({ ...local('2026-02-28T10:00:00Z'), day: 30 }),
    }
    expect(readCalendarMinute(epoch('2026-02-28T10:00:00Z'), nonexistent)).toBeNull()
    for (const calendar of [
      shiftedCalendar(() => DAY),
      shiftedCalendar(() => -DAY),
      shiftedCalendar(() => 30_000),
      { ...gapCalendar(), read: () => null },
      {
        ...gapCalendar(),
        read: (): LocalMinute => {
          throw new Error('unavailable')
        },
      },
    ]) {
      expect(readCalendarMinute(now, calendar)).toBeNull()
      expect(next('* * * * *', '2026-10-07T10:00:00Z', { calendar }).kind).toBe('unknown')
    }
    expect(
      formatCalendarTime(
        {
          ...shiftedCalendar(() => 0),
          format: () => {
            throw new Error('unavailable')
          },
        },
        now,
      ),
    ).toBeNull()
  })
  it('checks invalid epochs before calling the injected reader', () => {
    let reads = 0
    const calendar = {
      ...shiftedCalendar(() => 0),
      read: () => {
        reads++
        return null
      },
    }
    for (const after of [NaN, Infinity, 1e30, -1e30, Number.MAX_SAFE_INTEGER]) {
      expect(readCalendarMinute(after, calendar)).toBeNull()
      expect(nextCronOccurrence('* * * * *', { after, inclusive: true, calendar }).kind).toBe(
        'unknown',
      )
    }
    expect(reads).toBe(0)
  })
  it('keeps the real next match known and reports the skipped-target transition', () => {
    const calendar = gapCalendar()
    const result = expectAt(
      next('30 2 * * *', '2026-03-08T06:59:00Z', { calendar }),
      '2026-03-09T06:30:00.000Z',
    )
    expect(result).toMatchObject({ gapAt: transition, crossedOffsetChange: true })
    expect(
      next('30 2 * * *', '2026-03-08T06:59:00Z', {
        calendar,
        horizonAt: transition,
      }),
    ).toMatchObject({ kind: 'unknown', reason: 'horizon', gapAt: transition })
    const ordinary = expectAt(
      next('0 4 * * *', '2026-03-08T06:59:00Z', { calendar }),
      '2026-03-08T08:00:00.000Z',
    )
    expect(ordinary.crossedOffsetChange).toBe(true)
    expect(ordinary.gapAt).toBeUndefined()
  })
  it('counts skipped-wall inspections in the same bounded budget', () => {
    let reads = 0
    const source = gapCalendar()
    const calendar: CalendarSource = {
      ...source,
      read(at) {
        reads++
        return source.read(at)
      },
    }
    const result = next('30 2 * * *', '2026-03-08T06:59:00Z', { calendar, budget: 3 })
    expect(result).toMatchObject({ kind: 'unknown', reason: 'budget', work: 3 })
    expect(reads).toBe(2)
    expect(result).not.toHaveProperty('gapAt')
  })
  it('preserves both fold instants and the earliest branch with a host fixture', () => {
    const foldAt = epoch('2026-11-01T06:00:00Z')
    const calendar = shiftedCalendar((at) => (at < foldAt ? -240 : -300) * MINUTE)
    const first = expectAt(
      next('30 1 * * *', '2026-11-01T04:00:00Z', { calendar }),
      '2026-11-01T05:30:00.000Z',
    )
    const second = expectAt(
      next('30 1 * * *', '2026-11-01T05:30:00Z', { calendar }),
      '2026-11-01T06:30:00.000Z',
    )
    expect(second.crossedOffsetChange).toBe(true)
    expect(second.nominalAt).toBeGreaterThan(first.nominalAt)
    expect(readCalendarMinute(first.nominalAt, calendar)).toEqual(
      readCalendarMinute(second.nominalAt, calendar),
    )
    expect(second.gapAt).toBeUndefined()
  })
  it('reports only the first skipped-target transition and handles a half-hour gap', () => {
    const halfHour = shiftedCalendar((at) => (at < transition ? 0 : 30) * MINUTE)
    expect(
      next('15 7 * * *', '2026-03-08T06:59:00Z', {
        calendar: halfHour,
        horizonAt: transition,
      }),
    ).toMatchObject({ kind: 'unknown', reason: 'horizon', gapAt: transition })
    const secondTransition = transition + 15 * MINUTE
    const twoGaps = shiftedCalendar(
      (at) => (at < transition ? 0 : at < secondTransition ? 60 : 120) * MINUTE,
    )
    const result = expectAt(
      next('30 7-8 * * *', '2026-03-08T06:59:00Z', {
        calendar: twoGaps,
      }),
      '2026-03-09T05:30:00.000Z',
    )
    expect(result.gapAt).toBe(transition)
  })
})

describe('documented eligibility envelopes (D4/D5)', () => {
  it.each([MINUTE, 5 * MINUTE, 60 * MINUTE, DAY, undefined])(
    'bounds recurring lateness for interval %s',
    (interval) => {
      const bounds = eligibilityBounds(now, true, 0, interval)!
      const max = Math.min(30 * MINUTE, (interval ?? 60 * MINUTE) / 2)
      expect(bounds).toEqual({
        nominalAt: now,
        earliestEligibleAt: now,
        latestEligibleAt: now + max,
      })
      expect(eligibilityWithOffset(bounds, 0)).toBe(now)
      expect(eligibilityWithOffset(bounds, max)).toBe(now + max)
      expect(eligibilityWithOffset(bounds, -1)).toBeNull()
      expect(eligibilityWithOffset(bounds, max + 1)).toBeNull()
    },
  )
  it.each([0, 30, 3, 59])('bounds one-shot offsets at minute %s', (minute) => {
    const nominal = now + minute * MINUTE
    const bounds = eligibilityBounds(nominal, false, minute)!
    const early = minute === 0 || minute === 30 ? 90_000 : 0
    expect(bounds).toMatchObject({ earliestEligibleAt: nominal - early, latestEligibleAt: nominal })
    expect(eligibilityWithOffset(bounds, -early)).toBe(nominal - early)
    expect(eligibilityWithOffset(bounds, 0)).toBe(nominal)
    expect(eligibilityWithOffset(bounds, -early - 1)).toBeNull()
    expect(eligibilityWithOffset(bounds, 1)).toBeNull()
  })
  it('rejects invalid envelope inputs and offsets', () => {
    expect(eligibilityBounds(now + 1, true, 0)).toBeNull()
    expect(eligibilityBounds(now, true, 60)).toBeNull()
    expect(eligibilityBounds(now, true, 0, 0)).toBeNull()
    expect(eligibilityBounds(now, true, 0, Infinity)).toBeNull()
    expect(eligibilityWithOffset(eligibilityBounds(now, true, 0)!, NaN)).toBeNull()
  })
  it('narrows only uniform UTC cadence; irregular schedules use the outer cap', () => {
    const uniform = planJobWake(recurring('*/5 * * * *', now - MINUTE), planOptions)
    expect(uniform).toMatchObject({ kind: 'known', latestEligibleAt: now + 150_000 })
    for (const expression of ['1,2,59 * * * *', '0 9 7,8 * *', '0 9 * * 1-5']) {
      const result = planJobWake(recurring(expression), planOptions)
      expect(result.kind).toBe('known')
      if (result.kind === 'known')
        expect(result.latestEligibleAt - result.nominalAt).toBe(30 * MINUTE)
    }
    const monthEndNow = epoch('2026-10-30T10:00:00Z')
    const monthEnd = planJobWake(recurring('0 9 31 * *', monthEndNow - DAY), {
      ...planOptions,
      now: monthEndNow,
    })
    expect(monthEnd.kind).toBe('known')
    if (monthEnd.kind === 'known')
      expect(monthEnd.latestEligibleAt - monthEnd.nominalAt).toBe(30 * MINUTE)
  })
  it('does not invent a provider offset from an ID', () => {
    const first = planJobWake(oneShot(), planOptions)
    expect(planJobWake(oneShot(), planOptions)).toEqual(first)
    expect(planJobWake({ ...oneShot(), id: 'different-id' }, planOptions)).toEqual(first)
  })
})

describe('conservative restoration and reconciliation (B/D2/D3)', () => {
  it.each([
    ['known', levelOf([oneShot()])],
    ['unknown', levelOf([{ id: 'unreadable' }])],
    ['shortfall', levelOf([], 2)],
    [
      'mixed',
      levelOf(
        [
          oneShot(),
          { id: 'gone', evidence: { dropped: { why: 'its-time-passed', dueAt: now - DAY } } },
        ],
        2,
      ),
    ],
  ] as const)('round-trips the full retained %s level without mutation', (_label, input) => {
    const before = structuredClone(input)
    const first = whatAStartBringsBack(input, null, now, 30_000, null, { zone: 'UTC' })
    const retainedBefore = structuredClone(first.kept)
    const second = whatAStartBringsBack(first.kept, now, now, 30_000, null, { zone: 'UTC' })
    expect(second.kept).toEqual(first.kept)
    expect(first.kept.dropped).toBe(input.dropped)
    expect(second.plans).toHaveLength(first.kept.jobs.length)
    expect(second.startAt).toBe(first.startAt)
    expect(second.missed).toEqual([])
    expect(input).toEqual(before)
    expect(first.kept).toEqual(retainedBefore)
  })
  it('preserves malformed runtime rows and counts as shortfall instead of proving absence', () => {
    for (const dropped of [undefined, NaN, -1, 0.5, '2']) {
      const input = { jobs: [], dropped } as unknown as ScheduleLevel
      expect(whatAStartBringsBack(input, null, now, 30_000)).toMatchObject({
        kept: levelOf([], 1),
        startAt: now,
        expectBy: null,
      })
    }
    const malformed = {
      jobs: [null, { id: 42 }, { id: 'wrong', recurring: 'false' }, oneShot()],
      dropped: 0,
    } as unknown as ScheduleLevel
    expect(whatAStartBringsBack(malformed, null, now, 30_000)).toMatchObject({
      kept: levelOf([oneShot()], 3),
      startAt: now,
    })
  })
  it('wakes before the earliest one-shot eligibility with the supplied lead', () => {
    expect(planJobWake(oneShot(), planOptions)).toMatchObject({
      kind: 'known',
      startAt: epoch('2026-10-07T10:58:00Z'),
    })
    expect(planJobWake(oneShot(3), planOptions)).toMatchObject({
      kind: 'known',
      startAt: epoch('2026-10-07T11:02:30Z'),
    })
    expect(planJobWake(oneShot(), { ...planOptions, wakeLeadMs: 2 * 60 * MINUTE })).toMatchObject({
      startAt: now,
    })
  })
  it.each([
    '2026-10-07T10:58:30Z',
    '2026-10-07T10:59:00Z',
    '2026-10-07T11:00:00Z',
    '2027-10-07T12:00:00Z',
  ])('keeps a one-shot at the unmeasured cutoff %s without rolling it forward', (text) => {
    const at = epoch(text)
    const result = whatAStartBringsBack(levelOf([oneShot()]), now, at, 30_000, null, {
      zone: 'UTC',
    })
    expect(result).toMatchObject({
      kept: levelOf([oneShot()]),
      missed: [],
      startAt: at,
      expectBy: null,
    })
    expect(result.plans[0]!.result).toMatchObject({
      kind: 'unknown',
      reason: 'one-shot restore cutoff',
    })
  })
  it('does not use listedSince or lastBegan as a creation or original-occurrence receipt', () => {
    const job = { ...oneShot(), evidence: undefined, listedSince: now - DAY }
    const first = whatAStartBringsBack(levelOf([job]), now - DAY, now, 30_000, null, {
      zone: 'UTC',
    })
    expect(first.plans[0]!.result).toMatchObject({
      kind: 'unknown',
      reason: 'missing original occurrence',
    })
    expect(first.kept.jobs[0]!.listedSince).toBe(now - DAY)
    expect(
      planJobWake(
        { ...recurring('0 11 * * *'), evidence: undefined, listedSince: now - DAY },
        planOptions,
      ),
    ).toMatchObject({ kind: 'unknown', reason: 'missing trusted creation time' })
    const unreadable = { ...job, listedSince: 'unreadable' }
    expect(
      whatAStartBringsBack(levelOf([unreadable]), 'unreadable', now, 30_000, 'unreadable', {
        zone: 'UTC',
      }),
    ).toMatchObject({ kept: levelOf([unreadable]), missed: [], startAt: now })
  })
  it('keeps missing recurrence, missing schedule and partial lists visibly uncertain', () => {
    for (const job of [
      { id: 'missing' },
      { id: 'missing', schedule: '0 11 * * *' },
      { id: 'missing', recurring: false },
    ]) {
      expect(
        whatAStartBringsBack(levelOf([job]), null, now, 30_000, null, { zone: 'UTC' }),
      ).toMatchObject({ kept: levelOf([job]), startAt: now, missed: [], expectBy: null })
    }
    expect(whatAStartBringsBack({ jobs: [], dropped: 2 }, null, now, 30_000)).toMatchObject({
      kept: levelOf([], 2),
      startAt: now,
    })
    expect(whatAStartBringsBack({}, null, now, 30_000)).toMatchObject({ startAt: now })
    expect(whatAStartBringsBack(levelOf([]), null, now, 30_000)).toMatchObject({ startAt: null })
    expect(whatAStartBringsBack({ jobs: [] }, null, now, 30_000)).toMatchObject({
      kept: levelOf([], 1),
      startAt: now,
    })
  })
  it('treats dynamic loops, expiry ordering, unsupported inputs and exhausted budgets conservatively', () => {
    expect(
      planJobWake({ ...recurring('* * * * *'), evidence: { selfPaced: true } }, planOptions),
    ).toMatchObject({ kind: 'unknown', reason: 'self-paced restoration' })
    expect(planJobWake(recurring('0 11 * * *', now - 7 * DAY), planOptions)).toMatchObject({
      kind: 'unknown',
      reason: 'expiry ordering',
    })
    expect(planJobWake(recurring('0 11 14 10 *', now - 7 * DAY + 1), planOptions)).toMatchObject({
      kind: 'unknown',
      reason: 'expiry ordering',
    })
    expect(planJobWake(recurring('0 11 * * *'), { ...planOptions, budget: 1 })).toMatchObject({
      kind: 'unknown',
      startAt: now,
    })
    expect(planJobWake(recurring('0 0 L * *'), planOptions).kind).toBe('unknown')
    expect(planJobWake(recurring('* * 31 2 *'), planOptions).kind).toBe('impossible')
  })
  it('does not turn compaction timestamps into a drop notice', () => {
    for (const compactedAt of [now - 1, now + 1]) {
      const result = whatAStartBringsBack(
        levelOf([oneShot()]),
        now - DAY,
        now,
        30_000,
        compactedAt,
        { zone: 'UTC' },
      )
      expect(result.kept).toEqual(levelOf([oneShot()]))
      expect(result.missed).toEqual([])
    }
    const dropped = {
      ...oneShot(),
      evidence: { dropped: { why: 'made-before-a-compaction' as const, dueAt: null } },
    }
    expect(whatAStartBringsBack(levelOf([dropped]), null, now, 30_000, now)).toMatchObject({
      kept: levelOf([]),
      missed: [{ job: dropped, why: 'made-before-a-compaction', dueAt: null }],
      startAt: now,
    })
  })
  it('never infers absence or unique attribution from an unrelated busy provider turn', () => {
    const level = levelOf([oneShot()])
    const delayedRecurring = planJobWake(recurring('0 * * * *', now - 2 * 60 * MINUTE), planOptions)
    expect(delayedRecurring).toMatchObject({ kind: 'known', startAt: now })
    if (delayedRecurring.kind === 'known')
      expect(delayedRecurring.latestEligibleAt).toBeLessThan(now)
    for (const at of [now, epoch('2026-10-07T10:59:00Z'), epoch('2026-10-07T15:00:00Z')]) {
      expect(oneShotsThatCameDue(level, at)).toEqual([])
      expect(
        whatAStartBringsBack(level, null, at, 30_000, null, { zone: 'UTC' }).expectBy,
      ).toBeNull()
    }
    expect(
      oneShotsThatCameDue(
        { jobs: [oneShot(), { ...oneShot(), id: 'other' }, { id: 'unknown' }], dropped: 1 },
        now,
      ),
    ).toEqual([])
  })
  it('takes the earliest wake over multiple jobs, including uncertainty', () => {
    const a = oneShot(),
      b = oneShot(3)
    expect(
      whatAStartBringsBack(levelOf([b, a]), null, now, 30_000, null, { zone: 'UTC' }).startAt,
    ).toBe(epoch('2026-10-07T10:58:00Z'))
    expect(
      whatAStartBringsBack(levelOf([a, b, { id: 'unknown' }]), null, now, 30_000, null, {
        zone: 'UTC',
      }).startAt,
    ).toBe(now)
  })
  it('preserves observation and original-occurrence receipts across restatements', () => {
    const job = { ...oneShot(), listedSince: now - DAY }
    const restated = reconcileScheduleReport(levelOf([job]), {
      jobs: [{ ...job, listedSince: now, evidence: undefined }],
    })
    expect(restated.jobs).toEqual([job])
    const unknown = { ...job, listedSince: undefined, evidence: undefined }
    expect(
      reconcileScheduleReport(levelOf([unknown]), { jobs: [{ ...unknown, listedSince: now }] })
        .jobs,
    ).toEqual([unknown])
  })
  it('a positive listing clears a stale drop receipt while keeping timing provenance', () => {
    const original = oneShot()
    const stale = {
      ...original,
      evidence: { ...original.evidence, dropped: { why: 'its-time-passed' as const, dueAt: now } },
    }
    const positive = { ...original, evidence: undefined }
    const level = reconcileScheduleReport(levelOf([stale]), { jobs: [positive] })
    expect(level.jobs[0]!.evidence?.dropped).toBeUndefined()
    expect(level.jobs[0]!.evidence?.originalNominalAt).toBe(original.evidence?.originalNominalAt)
    expect(whatAStartBringsBack(level, null, now, 30_000, null, { zone: 'UTC' })).toMatchObject({
      missed: [],
      kept: levelOf([original]),
      startAt: epoch('2026-10-07T10:58:00Z'),
    })
  })
  it.each(['createdAt', 'originalNominalAt'] as const)(
    'conflicting %s receipts stay uncertain through restatements',
    (key) => {
      const first = key === 'createdAt' ? recurring('0 11 * * *', now) : oneShot()
      const conflicting = {
        ...first,
        evidence: { ...first.evidence, [key]: first.evidence![key]! + MINUTE },
      }
      const level = reconcileScheduleReport(levelOf([first]), { jobs: [conflicting] })
      expect(planJobWake(level.jobs[0]!, planOptions)).toMatchObject({
        kind: 'unknown',
        reason: 'conflicting timing receipts',
        startAt: now,
      })
      const restated = reconcileScheduleReport(level, { jobs: [first] })
      expect(restated.jobs[0]!.evidence?.conflictingReceipts).toBe(true)
      const changed = reconcileScheduleReport(restated, {
        jobs: [{ id: first.id, schedule: '0 12 * * *', recurring: first.recurring }],
      })
      expect(changed.jobs[0]!.evidence).toBeUndefined()
      const removed = reconcileScheduleReport(restated, { jobs: [] })
      const recreated = reconcileScheduleReport(removed, { jobs: [first] })
      expect(recreated.jobs[0]!.evidence?.conflictingReceipts).toBeUndefined()
    },
  )
  it('only a complete replacement removes omitted jobs, and changed schedules lose old evidence', () => {
    const a = oneShot(),
      b = { ...oneShot(3), id: 'second' }
    expect(reconcileScheduleReport(levelOf([a, b]), { jobs: [b], dropped: 1 }).jobs).toEqual([b, a])
    const replaced = reconcileScheduleReport(levelOf([a, b]), levelOf([b]))
    expect(replaced.jobs).toEqual([b])
    expect(whatAStartBringsBack(replaced, null, now, 30_000).missed).toEqual([])
    expect(
      reconcileScheduleReport(levelOf([a]), {
        jobs: [{ id: a.id, schedule: '0 12 * * *', recurring: false }],
      }).jobs?.[0]?.evidence,
    ).toBeUndefined()
  })
})

describe('a report that says less than a whole level', () => {
  it('a report that names no jobs keeps the jobs already known and takes its shortfall', () => {
    const job = oneShot()
    expect(reconcileScheduleReport(levelOf([job]), { dropped: 2 })).toEqual(levelOf([job], 2))
    expect(reconcileScheduleReport(levelOf([job], 3), {})).toEqual(levelOf([job], 3))
  })

  it('a shortfall that is not a whole count is counted as one job missed', () => {
    for (const dropped of [-1, 1.5, Number.NaN])
      expect(reconcileScheduleReport(levelOf([]), { dropped }).dropped).toBe(1)
  })

  it('a level that is not an object wakes a start at once, since a job may be missing', () => {
    const level = null as unknown as ScheduleLevel
    expect(whatAStartBringsBack(level, null, now, 30_000, null, { zone: 'UTC' }).startAt).toBe(now)
  })

  it('a host formatter that answers with no text says no time', () => {
    const calendar = { ...createIntlCalendar('UTC'), format: () => '' }
    expect(formatCalendarTime(calendar, now)).toBeNull()
  })
})

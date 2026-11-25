import { describe, expect, it } from 'vitest'
import type { ScheduleEvidenceRow } from '../src/main/runtime/schedule-evidence'
import { createIntlCalendar } from '../src/shared/schedule-wake'
import {
  plannedFrom,
  throughClaudesHooks,
  withAScheduleLedger,
} from './lib/scheduling-calls-fixture'

/**
 * **A scheduling call is planned the same whether it came through the provider's hooks today or
 * was stored by an older build.** The calls start as the hook inputs Claude Code sends, go through
 * its adapter, are stored as the host stores them, and are read back by the ledger query and the
 * planner. Nothing here names what the adapter calls a receipt, so the same file holds whatever the
 * receipt's own vocabulary is. The older rows are written exactly as earlier builds stored them.
 */

const CONVERSATION = 'sess_calls'
const UTC = createIntlCalendar('UTC')
const STAMP = { calendar: UTC.identity, version: UTC.version }
const MINUTE = 60_000
/** 2026-10-07 10:00:00 UTC. */
const T0 = Date.UTC(2026, 9, 7, 10, 0)
/** The one-shot's minute: 2026-10-07 10:30 UTC. */
const ONE_SHOT_AT = Date.UTC(2026, 9, 7, 10, 30)

/** The provider's tool hooks, read by its adapter. */
function theHooks() {
  /** One call through both hooks, answered at `at`: the payload the host stores for it. */
  const call = (at: number, tool: string, id: string, input: unknown, response: unknown) => {
    const event = throughClaudesHooks(tool, id, input, response, at - 3, at)
    // The host keeps a receipt with the calendar it was read under, and stores it as JSON.
    return JSON.parse(
      JSON.stringify({ ...event, receipt: { ...event.receipt, stamp: STAMP } }),
    ) as object
  }
  return {
    makes: (at: number, id: string, job: string, cron: string, recurring: boolean) =>
      call(
        at,
        'CronCreate',
        id,
        { cron, prompt: 'check the build', recurring },
        { id: job, humanSchedule: 'soon', recurring, durable: false },
      ),
    cancels: (at: number, id: string, job: string) =>
      call(at, 'CronDelete', id, { id: job }, { id: job }),
    lists: (at: number, id: string, jobs: object[]) => call(at, 'CronList', id, {}, { jobs }),
    wakes: (at: number, id: string, delaySeconds: number) =>
      call(
        at,
        'ScheduleWakeup',
        id,
        { delaySeconds, reason: 'later', prompt: 'go on' },
        { scheduledFor: at + delaySeconds * 1_000 },
      ),
  }
}

/** Receipts exactly as an earlier build stored them. */
const anOlderMaking = (at: number, toolUseId: string, job: string, cron: string) => ({
  type: 'scheduled_work',
  receipt: {
    tool: 'CronCreate',
    toolUseId,
    calledAt: at - 3,
    answeredAt: at,
    stamp: STAMP,
    input: { cron, recurring: false },
    result: { id: job, recurring: false },
  },
  source: 'hook/PostToolUse',
})
const anOlderCancelling = (at: number, toolUseId: string, job: string) => ({
  type: 'scheduled_work',
  receipt: {
    tool: 'CronDelete',
    toolUseId,
    calledAt: at - 2,
    answeredAt: at,
    stamp: STAMP,
    input: { id: job },
    result: { id: job },
  },
  source: 'hook/PostToolUse',
})
const anOlderListing = (at: number, toolUseId: string) => ({
  type: 'scheduled_work',
  receipt: { tool: 'CronList', toolUseId, answeredAt: at, stamp: STAMP, result: { jobs: [] } },
  source: 'hook/PostToolUse',
})

let ordinal = 0
const row = (at: number, type: string, payload: unknown): ScheduleEvidenceRow => ({
  ordinal: ++ordinal,
  at,
  rowType: type,
  payload,
})
const launched = (at: number) => row(at, 'launched', { type: 'launched' })
const receipt = (at: number, payload: object) => row(at, 'scheduled_work', payload)

const planned = (rows: readonly ScheduleEvidenceRow[], now: number) =>
  plannedFrom(CONVERSATION, rows, now, UTC)

describe('a scheduling call through the provider’s hooks', () => {
  it('🔴 a job made is listed with its time, a listing or a wake-up changes nothing, and a confirmed cancellation leaves the listing', () => {
    const hooks = theHooks()
    const made = [
      launched(T0),
      receipt(T0 + MINUTE, hooks.makes(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '*/5 * * * *', true)),
      receipt(
        T0 + 2 * MINUTE,
        hooks.makes(T0 + 2 * MINUTE, 'toolu_2', 'feed0001', '30 10 7 10 *', false),
      ),
    ]
    const before = planned(made, T0 + 3 * MINUTE + 2)
    expect(before.currentListing.count).toBe(2)

    const looked = [
      ...made,
      receipt(
        T0 + 3 * MINUTE,
        hooks.lists(T0 + 3 * MINUTE, 'toolu_3', [
          {
            id: 'a1b2c3d4',
            cron: '*/5 * * * *',
            humanSchedule: 'often',
            prompt: 'p',
            recurring: true,
          },
        ]),
      ),
      receipt(T0 + 3 * MINUTE + 1, hooks.wakes(T0 + 3 * MINUTE + 1, 'toolu_4', 600)),
    ]
    const listedAndWoken = planned(looked, T0 + 3 * MINUTE + 2)
    expect(listedAndWoken.currentListing).toEqual(before.currentListing)
    expect(listedAndWoken.states).toEqual(before.states)

    const after = planned(
      [...looked, receipt(T0 + 4 * MINUTE, hooks.cancels(T0 + 4 * MINUTE, 'toolu_5', 'a1b2c3d4'))],
      T0 + 5 * MINUTE,
    )
    expect(after.currentListing.count).toBe(1)
    expect(after.currentListing.jobs.map((one) => one.job.id)).toEqual(['feed0001'])
    const [state] = after.states.filter((one) => one.generation.jobId === 'feed0001')
    expect(state?.result.kind).toBe('known')
    expect(state?.pendingNominalAt).toBe(ONE_SHOT_AT)
    expect(after.wake.startAt).toBeLessThan(ONE_SHOT_AT)
    expect(after.wake.startAt).toBeGreaterThan(T0 + 5 * MINUTE)
  })

  it('⛔ a cancellation answered for another job cancels nothing', () => {
    const hooks = theHooks()
    const rows = [
      launched(T0),
      receipt(T0 + MINUTE, hooks.makes(T0 + MINUTE, 'toolu_1', 'a1b2c3d4', '*/5 * * * *', true)),
      receipt(
        T0 + 2 * MINUTE,
        // Asked for one job, answered with another.
        (() => {
          const payload = hooks.cancels(T0 + 2 * MINUTE, 'toolu_2', 'a1b2c3d4') as {
            receipt: { result: { id: string } }
          }
          payload.receipt.result.id = 'cafe0000'
          return payload
        })(),
      ),
    ]
    expect(planned(rows, T0 + 3 * MINUTE).currentListing.jobs).toMatchObject([
      { job: { id: 'a1b2c3d4' } },
    ])
  })
})

describe('a scheduling call stored by an older build', () => {
  it('🔴 a job an older build made is cancelled through the hooks today, and the reverse', () => {
    const hooks = theHooks()
    const olderMade = planned(
      [
        launched(T0),
        receipt(T0 + MINUTE, anOlderMaking(T0 + MINUTE, 'toolu_1', 'feed0001', '30 10 7 10 *')),
      ],
      T0 + 2 * MINUTE,
    )
    expect(olderMade.currentListing.jobs.map((one) => one.job.id)).toEqual(['feed0001'])
    expect(olderMade.states[0]?.pendingNominalAt).toBe(ONE_SHOT_AT)

    const cancelledToday = planned(
      [
        launched(T0),
        receipt(T0 + MINUTE, anOlderMaking(T0 + MINUTE, 'toolu_1', 'feed0001', '30 10 7 10 *')),
        receipt(T0 + 2 * MINUTE, hooks.cancels(T0 + 2 * MINUTE, 'toolu_2', 'feed0001')),
      ],
      T0 + 3 * MINUTE,
    )
    expect(cancelledToday.currentListing.count).toBe(0)

    const madeToday = planned(
      [
        launched(T0),
        receipt(
          T0 + MINUTE,
          hooks.makes(T0 + MINUTE, 'toolu_3', 'beef0002', '30 10 7 10 *', false),
        ),
        receipt(T0 + 2 * MINUTE, anOlderCancelling(T0 + 2 * MINUTE, 'toolu_4', 'beef0002')),
      ],
      T0 + 3 * MINUTE,
    )
    expect(madeToday.currentListing.count).toBe(0)
  })
})

describe('the rows the ledger query hands the evidence', () => {
  it('🔴 receipts that make or cancel a job, from the hooks today or stored by an older build; a listing’s or a wake-up’s from either is left out', () => {
    withAScheduleLedger(CONVERSATION, (put, store) => {
      const hooks = theHooks()
      put('launched', { type: 'launched' }, T0)
      put(
        'scheduled_work',
        anOlderMaking(T0 + 1, 'toolu_old_make', 'feed0001', '30 10 7 10 *'),
        T0 + 1,
      )
      put('scheduled_work', anOlderListing(T0 + 2, 'toolu_old_list'), T0 + 2)
      put('scheduled_work', anOlderCancelling(T0 + 3, 'toolu_old_cancel', 'feed0001'), T0 + 3)
      put(
        'scheduled_work',
        hooks.makes(T0 + 10, 'toolu_make', 'a1b2c3d4', '*/5 * * * *', true),
        T0 + 10,
      )
      put('scheduled_work', hooks.lists(T0 + 11, 'toolu_list', []), T0 + 11)
      put('scheduled_work', hooks.wakes(T0 + 12, 'toolu_wake', 60), T0 + 12)
      put('scheduled_work', hooks.cancels(T0 + 13, 'toolu_cancel', 'a1b2c3d4'), T0 + 13)

      const read = store.scheduleEvidenceRows(CONVERSATION)
      const receipts = read.rows.flatMap((one) => {
        const payload = one.payload as { receipt?: { toolUseId?: string } }
        return payload.receipt?.toolUseId === undefined ? [] : [payload.receipt.toolUseId]
      })
      expect(receipts).toEqual(['toolu_old_make', 'toolu_old_cancel', 'toolu_make', 'toolu_cancel'])
      expect(read.cut).toBe(false)

      // Planned from what the query read: both jobs made and confirmed cancelled.
      expect(planned(read.rows, T0 + MINUTE).currentListing.count).toBe(0)
    })
  })
})

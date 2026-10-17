import { describe, expect, it } from 'vitest'
import { createIntlCalendar, type CalendarSource } from '../src/shared/schedule-wake'
import {
  planScheduleAdmission,
  recordScheduleAdmission,
} from '../src/shared/schedule-wake-admission'
import {
  acceptScheduleNotices,
  confirmSchedulePersistence,
  dynamicScheduleReceipts,
  emptyScheduleEvidence,
  planReceiptSchedule,
  receiptGenerations,
  recordReceiptPlacements,
  recordScheduleObservation,
  validateScheduleEvidenceLedger,
  validateScheduleObservation,
  type ScheduleEvidenceLedger,
  type ScheduleObservation,
  type ScheduleScope,
} from '../src/shared/schedule-receipts'

const at = (s: string) => Date.parse(s)
const now = at('2026-10-07T10:00:10Z'),
  nominal = at('2026-10-07T11:00:00Z')
const DAY = 24 * 60 * 60_000
const scope: ScheduleScope = {
  conversationId: 'fictional-conversation',
  providerId: 'fictional-provider',
  lineageId: 'lineage',
  sessionId: 'session',
}
const calendar: CalendarSource = {
  ...createIntlCalendar('UTC'),
  identity: 'fixture-host',
  version: 'fixture-v1',
}
const emptyDelivery = { acceptedIds: [] as string[], mailbox: [] }
let sequence = 0
function base(eventId: string, observedAt = now, ownScope = scope) {
  return {
    schemaVersion: 1 as const,
    eventId,
    scope: ownScope,
    order: ++sequence,
    observedAt,
    clockEra: 'clock-a',
    cliVersion: 'fictional-cli',
    adapterVersion: 'fixture-adapter-v1',
  }
}
function pair(
  id = 'job',
  opts: {
    schedule?: string
    recurring?: boolean
    lo?: number
    hi?: number
    explicit?: boolean
    scope?: ScheduleScope
    stream?: boolean
  } = {},
): ScheduleObservation[] {
  const actual = {
    kind: 'cron' as const,
    schedule: opts.schedule ?? '0 11 * * *',
    recurring: opts.recurring ?? false,
    promptRef: 'fictional-prompt-row',
  }
  const lo = opts.lo ?? now - 9_000,
    hi = opts.hi ?? now - 8_000
  return [
    {
      ...base(`${id}-call-${sequence}`, lo, opts.scope),
      kind: 'call',
      toolUseId: `call-${id}-${sequence}`,
      toolName: 'CronCreate',
      boundary: opts.stream ? 'stream' : 'pre',
      delivery: 'live',
      calendar,
      input: actual,
    },
    {
      ...base(`${id}-result-${sequence}`, hi, opts.scope),
      kind: 'result',
      toolUseId: `call-${id}-${sequence - 1}`,
      toolName: 'CronCreate',
      boundary: opts.stream ? 'stream' : 'post',
      delivery: 'live',
      calendar,
      outcome: 'success',
      executedInput: actual,
      jobId: id,
      ...(opts.explicit
        ? {
            timing: {
              provenance: 'public-receipt' as const,
              reference: 'fictional-public-timing',
              originalNominalAt: nominal,
            },
          }
        : {}),
    },
  ]
}
function record(ledger: ScheduleEvidenceLedger, ...rows: ScheduleObservation[]) {
  for (const row of rows) {
    const next = recordScheduleObservation(ledger, row)
    expect(next.accepted).toBe(true)
    ledger = next.ledger
  }
  return ledger
}
function durable(ledger: ScheduleEvidenceLedger) {
  return confirmSchedulePersistence(ledger, {
    revision: ledger.revision,
    storageReference: 'fictional-storage-commit',
  })
}
function created(rows = pair(), source = calendar) {
  return durable(recordReceiptPlacements(record(emptyScheduleEvidence(), ...rows), source, scope))
}
function plan(
  ledger: ScheduleEvidenceLedger,
  options: Partial<Parameters<typeof planReceiptSchedule>[2]> = {},
  ownScope = scope,
) {
  return planReceiptSchedule(ledger, ownScope, {
    now,
    wakeLeadMs: 30_000,
    calendar,
    clockEra: 'clock-a',
    clockContinuous: true,
    noticeDelivery: emptyDelivery,
    ...options,
  })
}
function jobTarget(ledger: ScheduleEvidenceLedger, index = 0) {
  const g = receiptGenerations(ledger, scope)[index]!
  return { jobId: g.jobId, generation: g.generation }
}
const cause = { kind: 'provider-identity' as const, reference: 'fictional-causal-frame' }
const context = {
  zone: 'host',
  wakeLeadMs: 30_000,
  calendarIdentity: calendar.identity,
  calendarVersion: calendar.version,
  clockEra: 'clock-a',
}

function deletePair(
  input: Extract<
    NonNullable<Extract<ScheduleObservation, { kind: 'call' }>['input']>,
    { kind: 'cancel' }
  >,
  ownScope = scope,
): [
  Extract<ScheduleObservation, { kind: 'call' }>,
  Extract<ScheduleObservation, { kind: 'result' }>,
] {
  const toolUseId = `delete-use-${sequence}`
  return [
    {
      ...base(`delete-call-${sequence}`, now, ownScope),
      kind: 'call',
      toolUseId,
      toolName: 'CronDelete',
      boundary: 'stream',
      delivery: 'live',
      calendar,
      input,
    },
    {
      ...base(`delete-result-${sequence}`, now, ownScope),
      kind: 'result',
      toolUseId,
      toolName: 'CronDelete',
      boundary: 'stream',
      delivery: 'live',
      calendar,
      outcome: 'success',
      executedInput: input,
    },
  ]
}

describe('normalized persisted scheduling evidence (spec8–14)', () => {
  it('pairs successful creation, preserves executed input and original times, and replays idempotently (A1–A3)', () => {
    const rows = pair()
    const call = rows[0] as Extract<ScheduleObservation, { kind: 'call' }>
    call.input = { kind: 'cron', schedule: '0 12 * * *', recurring: false }
    const ledger = created(rows)
    const g = receiptGenerations(ledger, scope)[0]!
    expect(g.input.schedule).toBe('0 11 * * *')
    expect(g.creationWindow).toMatchObject({ lo: now - 9_000, hi: now - 8_000 })
    expect(g.creation!.call.observedAt).toBe(now - 9_000)
    expect(record(record(ledger, ...rows), ...rows)).toBe(ledger)
    expect(receiptGenerations(ledger, scope)).toHaveLength(1)
    const child = created(pair('child-job', { scope: { ...scope, childId: 'child' } }))
    expect(plan(child).wake.kept.jobs).toEqual([])
    expect(plan(child, {}, { ...scope, childId: 'child' }).wake.kept.jobs).toHaveLength(1)
  })
  it('failed, denied, unmatched, ambiguous and truncated results cannot certify creation (A1/A2)', () => {
    for (const outcome of ['failed', 'cancelled', 'interrupted', 'unknown'] as const) {
      const rows = pair(outcome)
      const result = rows[1] as Extract<ScheduleObservation, { kind: 'result' }>
      result.outcome = outcome
      expect(receiptGenerations(record(emptyScheduleEvidence(), ...rows), scope)).toEqual([])
    }
    const rows = pair('unmatched')
    const unmatched = record(emptyScheduleEvidence(), rows[1]!)
    expect(receiptGenerations(unmatched, scope)).toEqual([])
    expect(receiptGenerations(record(unmatched, rows[0]!), scope)).toHaveLength(1)
    expect(validateScheduleObservation({ ...rows[1], jobId: ['a', 'b'] }).kind).toBe('invalid')
    const incomplete = { ...rows[1]!, executedInput: undefined }
    expect(
      receiptGenerations(record(emptyScheduleEvidence(), rows[0]!, incomplete), scope),
    ).toEqual([])
    const outOfOrder = pair('reverse')
    outOfOrder[1]!.order = outOfOrder[0]!.order - 1
    const reversed = durable(record(emptyScheduleEvidence(), ...outOfOrder))
    expect(receiptGenerations(reversed, scope)).toEqual([])
    expect(plan(reversed).unresolvedReceipts).toHaveLength(1)
  })
  it('delayed acknowledgement keeps an earlier possible slot and near early-edge ambiguity (A3)', () => {
    const matchingMinute = plan(
      created(pair('matching-minute', { schedule: '0 * * * *', recurring: true })),
    )
    expect(matchingMinute.states[0]!.placement!.candidates).toEqual([
      nominal - 60 * 60_000,
      nominal,
    ])
    expect(matchingMinute.wake.startAt).toBe(now)
    expect(matchingMinute.states[0]!.display.time).toBeNull()
    const lo = at('2026-10-07T10:59:50Z'),
      hi = at('2026-10-07T11:00:10Z')
    const ledger = created(pair('delayed', { lo, hi }))
    const result = plan(ledger, { now: hi + 1 })
    expect(result.states[0]!.placement!.candidates).toEqual([nominal, nominal + DAY])
    expect(result.states[0]!.pendingNominalAt).toBeUndefined()
    expect(result.states[0]!.result.kind).toBe('unknown')
    expect(result.wake.startAt).toBe(hi + 1)
    const early = created(pair('edge', { lo: nominal - 91_000, hi: nominal - 89_000 }))
    expect(plan(early, { now: nominal - 88_000 }).states[0]!.placement!.candidates).toEqual([
      nominal,
      nominal + DAY,
    ])
  })
  it('places future explicit and uniquely derived one-shots with different provenance (A3/D4)', () => {
    for (const explicit of [true, false]) {
      const result = plan(created(pair(`future-${explicit}`, { explicit })))
      expect(result.states[0]!.pendingNominalAt).toBe(nominal)
      expect(result.states[0]!.placement!.provenance).toBe(
        explicit ? 'explicit-provider' : 'derived-window',
      )
      expect(result.wake.startAt).toBe(nominal - 120_000)
      expect(result.wake.expectBy).toBeNull()
    }
    const stream = plan(created(pair('ordinary-stream', { stream: true })))
    expect(stream.states[0]!.pendingNominalAt).toBeUndefined()
    expect(stream.wake.startAt).toBe(now)
  })
  it('list-only history stays unknown; replay preserves old times and a crash leaves persistence pending (A2/A3)', () => {
    const listing: ScheduleObservation = {
      ...base('legacy'),
      kind: 'listing',
      complete: false,
      dropped: 1,
      reference: 'fictional-list',
      jobs: [{ jobId: 'legacy', schedule: '0 11 * * *', recurring: false }],
    }
    const legacy = plan(durable(record(emptyScheduleEvidence(), listing)))
    expect(legacy.states[0]!.display.time).toBeNull()
    expect(legacy.states[0]!.result.kind).toBe('unknown')
    const ledger = created()
    const restored = validateScheduleEvidenceLedger(JSON.parse(JSON.stringify(ledger)))
    expect(restored.kind).toBe('valid')
    if (restored.kind !== 'valid') throw new Error(restored.reason)
    expect(plan(restored.ledger, { now: nominal + DAY }).states[0]!.pendingNominalAt).toBe(nominal)
    const notSaved = recordReceiptPlacements(
      record(emptyScheduleEvidence(), ...pair('not-saved')),
      calendar,
      scope,
    )
    expect(plan(notSaved).states[0]!.result).toMatchObject({
      kind: 'unknown',
      reason: 'receipt persistence pending',
    })
    expect(
      confirmSchedulePersistence(notSaved, {
        revision: notSaved.revision - 1,
        storageReference: 'stale-commit',
      }),
    ).toBe(notSaved)
  })
  it('incomplete successful receipt reconciles once without inventing a creation or job identity (A1/A3)', () => {
    const ledger = durable(record(emptyScheduleEvidence(), pair('unmatched')[1]!))
    const first = plan(ledger)
    expect(first.states).toEqual([])
    expect(first.unresolvedReceipts).toHaveLength(1)
    expect(first.wake.startAt).toBe(now)
    const admitted = recordScheduleAdmission(planScheduleAdmission(first.wake, [], context), now)
    expect(
      planScheduleAdmission(plan(ledger, { now: now + DAY }).wake, admitted, context).startAt,
    ).toBeNull()
  })
  it('only correlated progress advances a repeat while starts and compaction preserve age (A4)', () => {
    let ledger = created(pair('repeat', { schedule: '0 * * * *', recurring: true, explicit: true }))
    const initialWindow = receiptGenerations(ledger, scope)[0]!.creationWindow
    ledger = durable(
      record(
        ledger,
        { ...base('unrelated-start', nominal + 10_000), kind: 'lifecycle', phase: 'started' },
        { ...base('compact', nominal + 20_000), kind: 'lifecycle', phase: 'compacted' },
      ),
    )
    const pending = plan(ledger, { now: nominal + 30_000 })
    expect(pending.states[0]!.pendingNominalAt).toBe(nominal)
    const admitted = recordScheduleAdmission(
      planScheduleAdmission(pending.wake, [], context),
      nominal + 30_000,
    )
    expect(
      planScheduleAdmission(plan(ledger, { now: nominal + 40_000 }).wake, admitted, context)
        .startAt,
    ).toBeNull()
    ledger = durable(
      record(ledger, {
        ...base('progress', nominal + 50_000),
        kind: 'progress',
        target: jobTarget(ledger),
        proof: cause,
        throughNominalAt: nominal,
      }),
    )
    const next = plan(ledger, { now: nominal + 60_000 })
    expect(next.states[0]!.pendingNominalAt).toBe(nominal + 60 * 60_000)
    expect(next.states[0]!.display.provenance).toBe('derived-progress')
    expect(receiptGenerations(ledger, scope)[0]!.creationWindow).toEqual(initialWindow)
    expect(planScheduleAdmission(next.wake, admitted, context).startAt).not.toBeNull()
  })
  it('expiry age bands and endpoints remain uncertain; aged resume notice is once-only, live final fire unasserted (A6)', () => {
    let ledger = created(
      pair('aged', { recurring: true, lo: now - 7 * DAY - 1_000, hi: now - 7 * DAY + 1_000 }),
    )
    expect(plan(ledger).states[0]!.age).toBe('uncertain')
    expect(plan(ledger, { now: now - 1_000 }).states[0]!.age).toBe('uncertain')
    expect(plan(ledger, { now: now + 1_000 }).states[0]!.age).toBe('uncertain')
    expect(plan(ledger, { now: now + 1_001 }).notices).toEqual([])
    ledger = durable(
      record(ledger, { ...base('resume', now + 1_001), kind: 'lifecycle', phase: 'started' }),
    )
    const result = plan(ledger, { now: now + 1_001 })
    expect(result.notices[0]!.reason).toBe('expired-on-resume')
    expect(result.wake.kept.jobs).toEqual([])
    const accepted = acceptScheduleNotices(emptyDelivery, result.notices, true)
    expect(plan(ledger, { now: now + DAY, noticeDelivery: accepted }).notices).toEqual([])
    expect(plan(ledger, { now: now + DAY, clockContinuous: false }).states[0]!.age).toBe(
      'uncertain',
    )
  })
  it('dynamic wake/stop retain exact inputs and cannot cancel cron or convert Monitor (A5)', () => {
    let ledger = created()
    const call: ScheduleObservation = {
      ...base('dynamic-call'),
      kind: 'call',
      toolUseId: 'dynamic-use',
      toolName: 'ScheduleWakeup',
      boundary: 'stream',
      delivery: 'live',
      calendar,
      input: { kind: 'dynamic', delay: ' 75 seconds ' },
    }
    const result: ScheduleObservation = {
      ...base('dynamic-result'),
      kind: 'result',
      toolUseId: 'dynamic-use',
      toolName: 'ScheduleWakeup',
      boundary: 'stream',
      delivery: 'live',
      calendar,
      outcome: 'success',
      executedInput: { kind: 'dynamic', delay: ' 75 seconds ' },
    }
    ledger = record(ledger, call, result)
    const generation = dynamicScheduleReceipts(ledger, scope)[0]!.generation
    const stopCall = { ...call, ...base('stop-call'), toolUseId: 'stop-use' }
    const stopResult = {
      ...result,
      ...base('stop-result'),
      toolUseId: 'stop-use',
      executedInput: { kind: 'dynamic' as const, stop: true, targetGeneration: generation },
    }
    ledger = durable(
      record(ledger, stopCall, stopResult, {
        ...result,
        ...base('monitor'),
        toolUseId: 'monitor-use',
        toolName: 'Monitor',
        executedInput: { kind: 'monitor' },
      }),
    )
    expect(dynamicScheduleReceipts(ledger, scope)).toMatchObject([
      { input: { delay: ' 75 seconds ' }, jobId: undefined, cancelled: true },
    ])
    expect(plan(ledger).wake.kept.jobs).toHaveLength(1)
  })
  it('two dynamic wakes are two generations, and a stop cancels only the one it names', () => {
    const wake = (name: string, delay: string): ScheduleObservation[] => {
      const input = { kind: 'dynamic' as const, delay }
      return [
        {
          ...base(`${name}-call`),
          kind: 'call',
          toolUseId: `${name}-use`,
          toolName: 'ScheduleWakeup',
          boundary: 'stream',
          delivery: 'live',
          calendar,
          input,
        },
        {
          ...base(`${name}-result`),
          kind: 'result',
          toolUseId: `${name}-use`,
          toolName: 'ScheduleWakeup',
          boundary: 'stream',
          delivery: 'live',
          calendar,
          outcome: 'success',
          executedInput: input,
        },
      ]
    }
    let ledger = record(created(), ...wake('first', '60 seconds'), ...wake('second', '90 seconds'))
    const both = dynamicScheduleReceipts(ledger, scope)
    expect(both.map((row) => [row.input.delay, row.cancelled])).toEqual([
      ['60 seconds', false],
      ['90 seconds', false],
    ])
    expect(both[0]!.generation).not.toBe(both[1]!.generation)
    const [stopCall, stopResult] = wake('stop', '')
    const stop = { kind: 'dynamic' as const, stop: true, targetGeneration: both[1]!.generation }
    ledger = record(
      ledger,
      { ...stopCall!, input: stop } as ScheduleObservation,
      { ...stopResult!, executedInput: stop } as ScheduleObservation,
    )
    expect(dynamicScheduleReceipts(ledger, scope).map((row) => row.cancelled)).toEqual([
      false,
      true,
    ])
  })
  it('a correlated fire removes a one-shot at observed turn start, retaining nominal and actual history (A7/A8)', () => {
    let ledger = created()
    const fire: ScheduleObservation = {
      ...base('fire', nominal - 45_000),
      kind: 'fire',
      target: jobTarget(ledger),
      proof: cause,
      turnRef: 'fictional-active-turn',
    }
    ledger = durable(record(ledger, fire))
    const result = plan(ledger, { now: fire.observedAt })
    expect(result.wake.kept.jobs).toEqual([])
    expect(result.states[0]!.actualFireAt).toBe(nominal - 45_000)
    expect(result.states[0]!.pendingNominalAt).toBe(nominal)
    expect(result.states[0]!.dueConfirmed).toBe(true)
    expect(result.notices).toEqual([])
    expect(
      validateScheduleObservation({
        ...fire,
        proof: { kind: 'host-attribution', reference: 'temporal-candidate' },
      }).kind,
    ).toBe('invalid')
    const unconfirmed = plan(created(), { now: nominal + 1 })
    expect(unconfirmed.wake.kept.jobs).toHaveLength(1)
    expect(unconfirmed.states[0]!.display.label).toBe('due-unconfirmed')
    expect(unconfirmed.states[0]!.dueConfirmed).toBe(false)
  })
  it('same prompts, unknown competitors and reused IDs do not manufacture uniqueness or cross-generation removal (A2/A7)', () => {
    let ledger = created([...pair('a'), ...pair('b')])
    ledger = durable(
      record(ledger, {
        ...base('competitor'),
        kind: 'listing',
        complete: false,
        dropped: 1,
        reference: 'fictional-partial',
        jobs: [{ jobId: 'a' }, { jobId: 'b' }, { jobId: 'unknown' }],
      }),
    )
    const targets = receiptGenerations(ledger, scope)
      .filter((g) => g.creation)
      .map((g) => ({ jobId: g.jobId, generation: g.generation }))
    ledger = durable(
      record(
        ledger,
        ...targets.map((target, i): ScheduleObservation => ({
          ...base(`fire-${i}`, nominal),
          kind: 'fire',
          target,
          proof: cause,
          turnRef: `turn-${i}`,
        })),
      ),
    )
    expect(plan(ledger, { now: nominal }).wake.kept.jobs.map((j) => j.id)).toEqual(['unknown'])
    const old = targets[0]!
    ledger = created([...ledger.observations, ...pair('a')])
    ledger = durable(
      record(ledger, {
        ...base('old-fire-again', nominal + 1),
        kind: 'fire',
        target: old,
        proof: cause,
        turnRef: 'old-turn',
      }),
    )
    expect(plan(ledger).wake.kept.jobs.some((j) => j.id === 'a')).toBe(true)
  })
  it('complete absence removes current presence without guessing cause; partial omission and restatement preserve it (A5/A8)', () => {
    let ledger = created()
    const listing = (
      id: string,
      complete: boolean,
      jobs: { jobId: string }[],
    ): ScheduleObservation => ({
      ...base(id),
      kind: 'listing',
      complete,
      dropped: complete ? 0 : 2,
      reference: 'fictional-list',
      jobs,
    })
    ledger = durable(record(ledger, listing('partial', false, [])))
    expect(plan(ledger).wake.kept.jobs).toHaveLength(1)
    ledger = durable(record(ledger, listing('absent', true, [])))
    expect(plan(ledger).wake.kept.jobs).toEqual([])
    expect(plan(ledger).states[0]!.dueConfirmed).toBe(false)
    ledger = durable(record(ledger, listing('restated', true, [{ jobId: 'job' }])))
    expect(plan(ledger).wake.kept.jobs).toHaveLength(1)
    expect(plan(ledger).notices).toEqual([])
  })
  it('an offline past one-shot has an honest once-only notice and never rolls forward (A9)', () => {
    let ledger = created()
    ledger = durable(
      record(
        ledger,
        { ...base('stopped', nominal - 30 * 60_000), kind: 'lifecycle', phase: 'stopped' },
        { ...base('resumed', nominal + 10 * 60_000), kind: 'lifecycle', phase: 'started' },
      ),
    )
    const result = plan(ledger, { now: nominal + 10 * 60_000 })
    expect(result.notices[0]).toMatchObject({ reason: 'offline-time-passed', dueAt: nominal })
    expect(result.notices[0]!.message).toContain('check whether')
    expect(result.states[0]!.pendingNominalAt).toBe(nominal)
    const accepted = acceptScheduleNotices(emptyDelivery, result.notices, true)
    expect(plan(ledger, { now: nominal + DAY, noticeDelivery: accepted }).notices).toEqual([])
    expect(plan(ledger, { now: nominal }).notices).toEqual([])
  })
  it('aggregates recurring offline work per stopped interval, with new notices only for new due intervals (A9/A10)', () => {
    let ledger = created(
      pair('hourly-offline', { schedule: '0 * * * *', recurring: true, explicit: true }),
    )
    ledger = durable(
      record(
        ledger,
        { ...base('closed-a', nominal - 30 * 60_000), kind: 'lifecycle', phase: 'stopped' },
        {
          ...base('resumed-a', nominal + 3 * 60 * 60_000 + 1),
          kind: 'lifecycle',
          phase: 'started',
        },
      ),
    )
    const first = plan(ledger, { now: nominal + 3 * 60 * 60_000 + 1 })
    expect(first.notices).toHaveLength(1)
    expect(first.notices[0]).toMatchObject({ reason: 'recurring-offline-interval', dueAt: nominal })
    expect(first.notices[0]!.message).toContain('One or more')
    const delivered = acceptScheduleNotices(emptyDelivery, first.notices, true)
    ledger = durable(
      record(
        ledger,
        { ...base('closed-b', nominal + 4 * 60 * 60_000 + 1), kind: 'lifecycle', phase: 'stopped' },
        {
          ...base('resumed-b', nominal + 6 * 60 * 60_000 + 1),
          kind: 'lifecycle',
          phase: 'started',
        },
      ),
    )
    const second = plan(ledger, { now: nominal + 6 * 60 * 60_000 + 1, noticeDelivery: delivered })
    expect(second.notices).toHaveLength(1)
    expect(second.notices[0]!.dueAt).toBe(nominal + 5 * 60 * 60_000)
    const allDelivered = acceptScheduleNotices(delivered, second.notices, true)
    ledger = durable(
      record(
        ledger,
        {
          ...base('same-closed-b', nominal + 4 * 60 * 60_000 + 1),
          kind: 'lifecycle',
          phase: 'stopped',
        },
        {
          ...base('same-resumed-b', nominal + 6 * 60 * 60_000 + 1),
          kind: 'lifecycle',
          phase: 'started',
        },
      ),
    )
    expect(
      plan(ledger, { now: nominal + 6 * 60 * 60_000 + 1, noticeDelivery: allDelivered }).notices,
    ).toEqual([])
    ledger = durable(
      record(ledger, {
        ...base('completed', nominal + 6 * 60 * 60_000 + 1),
        kind: 'progress',
        target: jobTarget(ledger),
        proof: cause,
        throughNominalAt: nominal + 6 * 60 * 60_000,
      }),
    )
    expect(plan(ledger, { now: nominal + 6 * 60 * 60_000 + 1 }).notices).toEqual([])
  })
  it('successful cancellation is scoped to its generation and contradictory boundaries cannot cancel (A5)', () => {
    let ledger = created()
    const target = jobTarget(ledger)
    const call: ScheduleObservation = {
      ...base('delete-call'),
      kind: 'call',
      toolUseId: 'delete-use',
      toolName: 'CronDelete',
      boundary: 'stream',
      delivery: 'live',
      calendar,
      input: { kind: 'cancel', target },
    }
    const result: ScheduleObservation = {
      ...base('delete-result'),
      kind: 'result',
      toolUseId: 'delete-use',
      toolName: 'CronDelete',
      boundary: 'stream',
      delivery: 'live',
      calendar,
      outcome: 'success',
      executedInput: { kind: 'cancel', target },
    }
    const cancelled = durable(record(ledger, call, result))
    expect(plan(cancelled).wake.kept.jobs).toEqual([])
    expect(plan(cancelled).states[0]!.dueConfirmed).toBe(false)
    expect(plan(cancelled).notices).toEqual([])
    ledger = created([...cancelled.observations, ...pair('job')])
    expect(plan(ledger).wake.kept.jobs).toHaveLength(1)
    const disputed = durable(
      record(cancelled, { ...result, ...base('disputed-delete'), outcome: 'failed' }),
    )
    expect(plan(disputed).wake.kept.jobs).toHaveLength(1)
  })
  it('compaction timestamps never drop records; explicit independent restoration evidence does (A9)', () => {
    let ledger = created()
    const original = receiptGenerations(ledger, scope)[0]!.creation
    ledger = durable(
      record(ledger, { ...base('compacted'), kind: 'lifecycle', phase: 'compacted' }),
    )
    expect(plan(ledger).wake.kept.jobs).toHaveLength(1)
    expect(plan(ledger).notices).toEqual([])
    ledger = durable(
      record(ledger, {
        ...base('drop'),
        kind: 'restoration',
        target: jobTarget(ledger),
        proof: cause,
        status: 'dropped',
      }),
    )
    expect(plan(ledger).notices[0]!.reason).toBe('not-present')
    expect(plan(ledger).notices[0]!.message).not.toContain('because of compaction')
    expect(receiptGenerations(ledger, scope)[0]!.creation).toEqual(original)
    ledger = durable(
      record(ledger, {
        ...base('causal-drop'),
        kind: 'restoration',
        target: jobTarget(ledger),
        proof: cause,
        compactionCause: cause,
        status: 'dropped',
      }),
    )
    expect(plan(ledger).notices[0]!.reason).toBe('compaction-confirmed')
  })
  it('notice admission is durable/idempotent and stable IDs close the acceptance/ack crash window (A10)', () => {
    let ledger = created()
    ledger = durable(
      record(ledger, {
        ...base('absence'),
        kind: 'listing',
        complete: true,
        dropped: 0,
        jobs: [],
        reference: 'fictional-complete',
      }),
    )
    const notices = plan(ledger).notices
    expect(acceptScheduleNotices(emptyDelivery, notices, false)).toBe(emptyDelivery)
    expect(plan(ledger).notices).toEqual(notices)
    const accepted = acceptScheduleNotices(emptyDelivery, notices, true)
    expect(acceptScheduleNotices(accepted, notices, true).mailbox).toHaveLength(1)
    const crash = { acceptedIds: [] as string[], mailbox: accepted.mailbox }
    expect(acceptScheduleNotices(crash, notices, true).mailbox).toHaveLength(1)
    const replay = JSON.parse(JSON.stringify(accepted))
    ledger = durable(
      record(ledger, {
        ...base('identical-absence-later', now + 1000),
        kind: 'listing',
        complete: true,
        dropped: 0,
        jobs: [],
        reference: 'later-row',
      }),
    )
    expect(plan(ledger, { noticeDelivery: replay }).notices).toEqual([])
    const newer = created([...ledger.observations, ...pair('job')])
    const absent = durable(
      record(newer, {
        ...base('new-absence'),
        kind: 'listing',
        complete: true,
        dropped: 0,
        jobs: [],
        reference: 'new-generation-absence',
      }),
    )
    expect(plan(absent, { noticeDelivery: replay }).notices).toHaveLength(1)
  })
  it('no eligibility deadline proves completion or absence; delayed authoritative presence still reconciles (A11)', () => {
    let ledger = created(pair('waiting', { recurring: true }))
    const overdue = plan(ledger, { now: nominal + 3 * 60 * 60_000 })
    expect(overdue.wake.expectBy).toBeNull()
    expect(overdue.wake.kept.jobs).toHaveLength(1)
    expect(overdue.diagnosticRecheck?.destructive).toBe(false)
    ledger = durable(
      record(ledger, {
        ...base('late-list', nominal + 4 * 60 * 60_000),
        kind: 'listing',
        complete: true,
        dropped: 0,
        reference: 'late-public-list',
        jobs: [{ jobId: 'waiting' }],
      }),
    )
    expect(plan(ledger, { now: nominal + 4 * 60 * 60_000 }).states[0]!.pendingNominalAt).toBe(
      nominal,
    )
  })
  it('shown nominal time retains date/provenance and past/unknown work never displays next year (A12)', () => {
    const ledger = created(pair('shown', { explicit: true }))
    expect(plan(ledger).states[0]!.display).toMatchObject({
      time: '11:00',
      nominalAt: nominal,
      provenance: 'explicit-provider',
    })
    expect(plan(ledger).states[0]!.display.detail).toContain('2026-10-07')
    const past = plan(ledger, { now: nominal + 365 * DAY }).states[0]!
    expect(past.display.label).toBe('due-unconfirmed')
    expect(past.display.detail).toContain('2026-10-07')
    expect(past.pendingNominalAt).toBe(nominal)
    expect(plan(created(pair('unknown', { stream: true }))).states[0]!.display.time).toBeNull()
  })
  it('injected host calendar wins over divergent Intl; versions re-render and revalidate admission (A13)', () => {
    const original = calendar.read
    const host = {
      ...calendar,
      identity: 'divergent-host',
      format: undefined,
      read: (epoch: number) => original(epoch + 2 * 60 * 60_000),
    }
    const rows = pair('host')
    for (const row of rows)
      if (row.kind === 'call' || row.kind === 'result')
        row.calendar = { identity: host.identity, version: host.version }
    const ledger = created(rows, host)
    const result = plan(ledger, { calendar: host })
    expect(result.states[0]!.pendingNominalAt).toBe(nominal - 2 * 60 * 60_000 + DAY)
    expect(result.states[0]!.display.time).toBe('11:00')
    const first = planScheduleAdmission(result.wake, [], {
      ...context,
      calendarIdentity: host.identity,
    })
    const attempted = recordScheduleAdmission(first, first.startAt!)
    expect(
      planScheduleAdmission(result.wake, attempted, { ...context, calendarIdentity: host.identity })
        .startAt,
    ).toBeNull()
    expect(
      planScheduleAdmission(result.wake, attempted, {
        ...context,
        calendarIdentity: host.identity,
        calendarVersion: 'fixture-v2',
      }).startAt,
    ).not.toBeNull()
  })
  it('calendar updates reconcile once without consuming the retained future wake (A13)', () => {
    const ledger = created(pair('calendar-update', { explicit: true }))
    const current = {
      ...calendar,
      version: 'fixture-v2',
      read: (epoch: number) => calendar.read(epoch + 60 * 60_000),
    }
    const currentContext = { ...context, calendarVersion: current.version }
    const refreshed = plan(ledger, { calendar: current })
    expect(refreshed.wake.startAt).toBe(now)
    expect(refreshed.states[0]!.pendingNominalAt).toBe(nominal)
    expect(refreshed.states[0]!.display.time).toBe('12:00')
    expect(refreshed.wake.plans[0]!.result.startAt).toBe(nominal - 120_000)
    const admitted = recordScheduleAdmission(
      planScheduleAdmission(refreshed.wake, [], currentContext),
      now,
    )
    const again = plan(ledger, { now: now + 1_000, calendar: current })
    expect(planScheduleAdmission(again.wake, admitted, currentContext).startAt).toBe(
      nominal - 120_000,
    )
    const future = recordScheduleAdmission(
      planScheduleAdmission(again.wake, admitted, currentContext),
      nominal - 120_000,
    )
    expect(planScheduleAdmission(again.wake, future, currentContext).startAt).toBeNull()
  })
  it('DST receipt crossings stay calendar-known with earliest fold/gap wake distinct from fire policy (A15)', () => {
    const source = {
      ...createIntlCalendar('America/New_York'),
      identity: 'fixture-new-york',
      version: 'fixture-v1',
    }
    const lo = at('2026-03-08T05:00:01Z'),
      hi = lo + 1000
    const rows = pair('gap', { schedule: '30 2 * * *', recurring: true, lo, hi })
    for (const row of rows) if (row.kind === 'call' || row.kind === 'result') row.calendar = source
    const result = plan(created(rows, source), { now: hi + 1, calendar: source })
    expect(result.states[0]!.result.kind).toBe('known')
    expect(result.states[0]!.pendingNominalAt).toBe(at('2026-03-09T06:30:00Z'))
    expect(result.wake.startAt).toBe(at('2026-03-08T06:59:30Z'))
    expect(result.states[0]!.dueConfirmed).toBe(false)
    const foldRows = pair('fold', {
      schedule: '30 1 * * *',
      recurring: false,
      lo: at('2026-11-01T04:00:01Z'),
      hi: at('2026-11-01T04:00:02Z'),
    })
    for (const row of foldRows)
      if (row.kind === 'call' || row.kind === 'result') row.calendar = source
    expect(
      plan(created(foldRows, source), { now: at('2026-11-01T04:00:03Z'), calendar: source }).wake
        .startAt,
    ).toBe(at('2026-11-01T05:28:00Z'))
  })
  it('pending/idle ownership, cancelled admission and clock changes do not fabricate progress (A4/A11)', () => {
    const ledger = created(pair('pending', { recurring: true }))
    const first = plan(ledger, { now: nominal + 60_000 })
    const proposal = planScheduleAdmission(first.wake, [], context)
    expect(planScheduleAdmission(first.wake, proposal.state, context).startAt).toBe(
      nominal + 60_000,
    )
    const accepted = recordScheduleAdmission(proposal, nominal + 60_000)
    const rearmed = plan(ledger, { now: nominal + 2 * 60_000 })
    expect(planScheduleAdmission(rearmed.wake, accepted, context).startAt).toBeNull()
    expect(rearmed.states[0]!.pendingNominalAt).toBe(nominal)
    expect(plan(ledger, { clockContinuous: false }).states[0]!.result.kind).toBe('unknown')
  })
  it('conflicting same-generation observations persist until independent resolution and raw extras are stripped (A2)', () => {
    const rows = pair('conflict')
    let ledger = created(rows)
    const changed = { ...rows[1], observedAt: now + 2000 }
    const conflict = recordScheduleObservation(ledger, changed)
    expect(conflict.accepted).toBe(false)
    ledger = durable(conflict.ledger)
    expect(plan(ledger).states[0]!.result.kind).toBe('unknown')
    ledger = durable(
      record(ledger, {
        ...base('resolution'),
        kind: 'resolution',
        target: jobTarget(ledger),
        proof: cause,
        timing: {
          provenance: 'public-receipt',
          reference: 'resolved-public-time',
          originalNominalAt: nominal,
          createdAt: now - 9_000,
        },
      }),
    )
    ledger = durable(recordReceiptPlacements(ledger, calendar, scope))
    expect(plan(ledger).states[0]!.pendingNominalAt).toBe(nominal)
    const clean = validateScheduleObservation({
      ...rows[1],
      rawPayload: 'fictional raw text',
      executedInput: {
        kind: 'cron',
        schedule: '0 11 * * *',
        recurring: false,
        prompt: 'fictional full prompt',
        delay: { nested: 'raw' },
      },
    })
    expect(clean.kind).toBe('valid')
    if (clean.kind !== 'valid') throw new Error(clean.reason)
    expect(JSON.stringify(clean.observation)).not.toContain('fictional full prompt')
    expect(JSON.stringify(clean.observation)).not.toContain('fictional raw text')
  })
})

describe('confirmed cancellation projection (spec16/A16)', () => {
  it.each([false, true])(
    'removes a confirmed target and updates count during an open turn (recurring=%s)',
    (recurring) => {
      let ledger = created([
        ...pair('target', { recurring }),
        ...pair('other', { schedule: '3 11 * * *' }),
      ])
      ledger = durable(
        record(ledger, { ...base('open-turn'), kind: 'lifecycle', phase: 'started' }),
      )
      const before = plan(ledger)
      const unaffected = before.wake.plans.find((row) => row.job.id === 'other')!.result
      expect(before.currentListing.count).toBe(2)
      const receipts = deletePair({ kind: 'cancel', target: jobTarget(ledger) })
      ledger = durable(record(ledger, ...receipts))
      const after = plan(ledger)
      expect(after.currentListing).toMatchObject({
        revision: ledger.revision,
        publishable: true,
        count: 1,
      })
      expect(after.currentListing.jobs.map((row) => row.job.id)).toEqual(['other'])
      expect(after.wake.plans[0]!.result).toEqual(unaffected)
      expect(
        after.states.find((state) => state.generation.jobId === 'target')!.generation.cancellation,
      ).toBe('confirmed')
      expect(after.states.find((state) => state.generation.jobId === 'target')!.dueConfirmed).toBe(
        false,
      )
      expect(after.notices).toEqual([])
      expect(
        ledger.observations.some(
          (row) => row.kind === 'listing' || (row.kind === 'lifecycle' && row.phase === 'stopped'),
        ),
      ).toBe(false)
    },
  )
  it('keeps a pending delete visible, then publishes an empty listing on confirmed last-job deletion', () => {
    let ledger = created()
    const [call, result] = deletePair({ kind: 'cancel', target: jobTarget(ledger) })
    const originalRevision = plan(ledger).wake.kept.jobs[0]!.evidence!.receiptRevision
    ledger = durable(record(ledger, call))
    const pending = plan(ledger)
    expect(pending.currentListing.count).toBe(1)
    expect(pending.currentListing.jobs[0]).toMatchObject({
      cancellation: 'unconfirmed',
      cancellationLabel: 'cancellation not confirmed',
    })
    expect(pending.wake.kept.jobs[0]!.evidence!.receiptRevision).toBe(originalRevision)
    const unsaved = record(ledger, result)
    expect(plan(unsaved).currentListing.publishable).toBe(false)
    ledger = durable(unsaved)
    expect(plan(ledger).currentListing).toMatchObject({ count: 0, jobs: [], publishable: true })
    expect(plan(ledger).wake.startAt).toBeNull()
  })
  it.each(['failed', 'interrupted', 'cancelled', 'unknown'] as const)(
    'keeps an %s cancellation listed without false firing or notices',
    (outcome) => {
      let ledger = created()
      const [call, result] = deletePair({ kind: 'cancel', target: jobTarget(ledger) })
      result.outcome = outcome
      ledger = durable(record(ledger, call, result))
      const view = plan(ledger)
      expect(view.currentListing.count).toBe(1)
      expect(view.currentListing.jobs[0]!.cancellationLabel).toBe(
        outcome === 'failed' ? 'cancellation failed' : 'cancellation not confirmed',
      )
      expect(view.states[0]!.dueConfirmed).toBe(false)
      expect(view.notices).toEqual([])
    },
  )
  it('does not confirm unmatched, mismatched, unsupported or amended-to-another-target results', () => {
    const ledger = created([...pair('first'), ...pair('second')])
    const [call, result] = deletePair({ kind: 'cancel', target: jobTarget(ledger) })
    expect(plan(durable(record(ledger, result))).currentListing.count).toBe(2)
    expect(
      plan(durable(record(ledger, call, { ...result, toolUseId: 'unmatched' }))).currentListing
        .count,
    ).toBe(2)
    const pending = durable(record(ledger, call))
    const invalid = recordScheduleObservation(pending, { ...result, jobId: ['first', 'second'] })
    expect(invalid.accepted).toBe(false)
    expect(plan(invalid.ledger).currentListing.jobs[0]!.cancellationLabel).toBe(
      'cancellation not confirmed',
    )
    expect(
      plan(durable(record(ledger, call, { ...result, jobId: 'other-identity' }))).currentListing
        .count,
    ).toBe(2)
    const amended = durable(
      record(ledger, call, {
        ...result,
        executedInput: { kind: 'cancel', target: jobTarget(ledger, 1) },
      }),
    )
    expect(plan(amended).currentListing.jobs.map((row) => row.job.id)).toEqual(['first'])
    expect(plan(amended).currentListing.jobs[0]!.cancellationLabel).toBeNull()
  })
  it('scopes cancellation to the conversation/lineage/generation despite identical prompts and reused IDs', () => {
    const otherScope = {
      ...scope,
      conversationId: 'another-conversation',
      providerId: 'another-provider',
    }
    let ledger = created([...pair('shared-id'), ...pair('shared-id', { scope: otherScope })])
    const target = jobTarget(ledger)
    const receipts = deletePair({ kind: 'cancel', target })
    ledger = durable(record(ledger, ...receipts))
    expect(plan(ledger).currentListing.count).toBe(0)
    expect(plan(ledger, {}, otherScope).currentListing.count).toBe(1)
    ledger = created([...ledger.observations, ...pair('shared-id')])
    ledger = durable(record(ledger, ...receipts))
    expect(plan(ledger).currentListing.count).toBe(1)
    expect(plan(ledger).currentListing.jobs[0]!.job.evidence!.generation).not.toBe(
      target.generation,
    )
  })
  it('replays idempotently and a stale positive list cannot resurrect the cancelled generation', () => {
    let ledger = created()
    const receipts = deletePair({ kind: 'cancel', target: jobTarget(ledger) })
    ledger = durable(record(ledger, ...receipts))
    expect(record(ledger, ...receipts)).toBe(ledger)
    ledger = durable(
      record(ledger, {
        ...base('stale-positive'),
        kind: 'listing',
        complete: true,
        dropped: 0,
        reference: 'fictional-stale-list',
        jobs: [{ jobId: 'job', schedule: '0 11 * * *', recurring: false }],
      }),
    )
    const snapshot = validateScheduleEvidenceLedger(JSON.parse(JSON.stringify(ledger)))
    expect(snapshot.kind).toBe('valid')
    if (snapshot.kind !== 'valid') throw new Error(snapshot.reason)
    expect(plan(snapshot.ledger).currentListing.count).toBe(0)
    expect(plan(snapshot.ledger).notices).toEqual([])
    expect(plan(snapshot.ledger).wake.startAt).toBeNull()
  })
  it('fresh queued admission excludes the cancelled job and preserves unrelated requests and actual-fire history', () => {
    let ledger = created([...pair('queued'), ...pair('unrelated', { schedule: '3 11 * * *' })])
    const queued = planScheduleAdmission(plan(ledger).wake, [], context)
    ledger = durable(record(ledger, ...deletePair({ kind: 'cancel', target: jobTarget(ledger) })))
    const fresh = planScheduleAdmission(plan(ledger).wake, queued.state, context)
    expect(fresh.requests).toHaveLength(1)
    expect(fresh.requests[0]!.key).toContain('unrelated')
    const target = jobTarget(ledger, 1)
    ledger = durable(
      record(ledger, {
        ...base('already-executing', nominal),
        kind: 'fire',
        target,
        proof: cause,
        turnRef: 'fictional-active-turn',
      }),
    )
    ledger = durable(record(ledger, ...deletePair({ kind: 'cancel', target })))
    const active = plan(ledger, { now: nominal })
    expect(active.currentListing.count).toBe(0)
    expect(active.states.find((row) => row.generation.jobId === 'unrelated')).toMatchObject({
      actualFireAt: nominal,
      dueConfirmed: true,
    })
    expect(planScheduleAdmission(active.wake, fresh.state, context).startAt).toBeNull()
  })
  it('partial confirmations remove only individually acknowledged targets and aggregate later acknowledgments', () => {
    const ledger = created([...pair('a'), ...pair('b')])
    const requested = [jobTarget(ledger), jobTarget(ledger, 1)]
    const [call, result] = deletePair({ kind: 'cancel', targets: requested })
    expect(plan(durable(record(ledger, call, result))).currentListing.count).toBe(2)
    result.confirmedTargets = [requested[0]!]
    const partial = durable(record(ledger, call, result))
    expect(plan(partial).currentListing.jobs.map((row) => row.job.id)).toEqual(['b'])
    expect(plan(partial).currentListing.jobs[0]!.cancellationLabel).toBe(
      'cancellation not confirmed',
    )
    const later = {
      ...result,
      ...base('later-individual-confirmation'),
      confirmedTargets: [requested[1]!],
    }
    expect(plan(durable(record(partial, later))).currentListing.count).toBe(0)
    expect(
      validateScheduleObservation({
        ...result,
        confirmedTargets: [{ jobId: 'other', generation: 'not-requested' }],
      }).kind,
    ).toBe('invalid')
  })
})

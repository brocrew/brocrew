import type { ScheduleWakeResult, WakeJob } from './schedule-wake'

export type WakeAttempt = {
  readonly key: string
  readonly revision: string
  readonly attempted: boolean
}
export type WakeAttemptState = readonly WakeAttempt[]
export type WakeAdmissionPlan = {
  readonly state: WakeAttemptState
  readonly requests: readonly { key: string; revision: string; startAt: number }[]
  readonly startAt: number | null
}

function jobRevision(job: WakeJob): string {
  return JSON.stringify([
    job.schedule ?? null,
    job.recurring ?? null,
    job.prompt ?? null,
    job.listedSince ?? null,
    job.evidence?.createdAt === undefined ? null : String(job.evidence.createdAt),
    job.evidence?.originalNominalAt === undefined ? null : String(job.evidence.originalNominalAt),
    job.evidence?.selfPaced ?? false,
    job.evidence?.conflictingReceipts ?? false,
    job.evidence?.dropped?.why ?? null,
    job.evidence?.dropped?.dueAt ?? null,
    job.evidence?.generation ?? null,
    job.evidence?.receiptRevision ?? null,
    job.evidence?.progressNominalAt ?? null,
  ])
}

export function planScheduleAdmission(
  result: ScheduleWakeResult,
  previous: WakeAttemptState,
  context: {
    zone: string
    wakeLeadMs: number
    budget?: number
    calendarIdentity?: string
    calendarVersion?: string
    clockEra?: string
  },
): WakeAdmissionPlan {
  const old = new Map(previous.map((record) => [record.key, record]))
  const records = new Map<string, { revisions: string[]; startAt: number }>()
  const add = (key: string, revision: string, startAt: number) => {
    const before = records.get(key)
    records.set(key, {
      revisions: [...(before?.revisions ?? []), revision],
      startAt: Math.min(before?.startAt ?? Infinity, startAt),
    })
  }
  for (const { job, result: jobPlan } of result.plans)
    add(JSON.stringify(['job', job.id]), jobRevision(job), jobPlan.startAt)
  for (const { job } of result.missed)
    if (result.startAt !== null)
      add(JSON.stringify(['notice', job.id]), jobRevision(job), result.startAt)
  if (result.kept.dropped > 0 && result.startAt !== null)
    add('shortfall', String(result.kept.dropped), result.startAt)
  for (const notice of result.noticeRequests ?? [])
    add(JSON.stringify(['notice-id', notice.id]), notice.revision, notice.startAt)
  for (const record of result.reconciliationRequests ?? [])
    add(JSON.stringify(['receipt-reconciliation', record.id]), record.revision, record.startAt)

  const state: WakeAttempt[] = []
  const requests: { key: string; revision: string; startAt: number }[] = []
  for (const [key, record] of records) {
    // Clock passage and listing order cannot grant another attempt for unchanged work.
    const revision = JSON.stringify([
      record.revisions.sort(),
      context.zone,
      context.wakeLeadMs,
      context.budget ?? null,
      context.calendarIdentity ?? null,
      context.calendarVersion ?? null,
      context.clockEra ?? null,
    ])
    const attempted = old.get(key)?.revision === revision && old.get(key)!.attempted
    state.push({ key, revision, attempted })
    if (!attempted) requests.push({ key, revision, startAt: record.startAt })
  }
  return {
    state,
    requests,
    startAt:
      requests.length === 0
        ? null
        : requests.reduce((earliest, record) => Math.min(earliest, record.startAt), Infinity),
  }
}

export function recordScheduleAdmission(
  plan: WakeAdmissionPlan,
  admittedAt: number,
): WakeAttemptState {
  if (!Number.isFinite(admittedAt)) return plan.state
  const admitted = new Set(
    plan.requests.filter((request) => request.startAt <= admittedAt).map((request) => request.key),
  )
  // Call after a successful host admission, with the freshly recalculated plan.
  return plan.state.map((record) =>
    admitted.has(record.key) ? { ...record, attempted: true } : record,
  )
}

export type WakeStartQueue = {
  readonly pending: readonly string[]
  readonly active: string | null
  readonly notBefore: number
}

export function enqueueScheduleStart(queue: WakeStartQueue, conversation: string): WakeStartQueue {
  if (queue.active === conversation || queue.pending.includes(conversation)) return queue
  return { ...queue, pending: [...queue.pending, conversation] }
}

export function takeScheduleStart(
  queue: WakeStartQueue,
  now: number,
): { queue: WakeStartQueue; conversation: string | null } {
  const conversation = queue.pending[0]
  if (
    queue.active !== null ||
    !Number.isFinite(now) ||
    !Number.isFinite(queue.notBefore) ||
    now < queue.notBefore ||
    conversation === undefined
  )
    return { queue, conversation: null }
  return {
    queue: { ...queue, pending: queue.pending.slice(1), active: conversation },
    conversation,
  }
}

export function finishScheduleStart(
  queue: WakeStartQueue,
  conversation: string,
  notBefore: number,
): WakeStartQueue {
  if (queue.active !== conversation || !Number.isFinite(notBefore)) return queue
  return { ...queue, active: null, notBefore: Math.max(queue.notBefore, notBefore) }
}
